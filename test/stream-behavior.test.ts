import type { AssistantMessage, AssistantMessageEvent, Context } from "@earendil-works/pi-ai/compat";
import { calculateCost, isContextOverflow, normalizeContext } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVertexClients } from "../src/client.ts";
import { apiKeyFromCredential } from "../src/resolution.ts";
import { register, registeredModel } from "./helpers.ts";

// The provider behaviors pi's custom-provider guide asks for, through the real
// streamSimple, AnthropicVertex, and pi-ai stream. Only the network is fake: a
// fetch stub answers with Vertex's response, and google-auth-library is mocked.
vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		async getClient() {
			return { getRequestHeaders: async () => new Headers({ authorization: "Bearer test" }) };
		}
	},
}));

const API_KEY = apiKeyFromCredential({ access: "adc", refresh: "adc", expires: 0, projectId: "p", region: "global" });
const CONTEXT = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as Context);
const encoder = new TextEncoder();

type Reply = (signal: AbortSignal | undefined) => Response;
let reply: Reply;

function sse(events: object[]): string {
	return events
		.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`)
		.join("");
}

/** An SSE response, sent in chunks of `chunkBytes` bytes. */
function sseResponse(body: string, chunkBytes = Number.POSITIVE_INFINITY): Response {
	const bytes = encoder.encode(body);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < bytes.length; i += Math.min(chunkBytes, bytes.length)) {
				controller.enqueue(bytes.slice(i, i + chunkBytes));
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const messageStart = (usage = { input_tokens: 100, output_tokens: 1 }) => ({
	type: "message_start",
	message: {
		id: "msg_1",
		type: "message",
		role: "assistant",
		model: "claude-opus-4-8",
		content: [],
		stop_reason: null,
		usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
	},
});

function textReply(text: string, usage = { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40 }) {
	return [
		messageStart(usage),
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
		{ type: "message_stop" },
	];
}

async function run(signal?: AbortSignal, onEvent?: (event: AssistantMessageEvent) => void) {
	const { config } = register();
	const model = registeredModel("claude-opus-4-8", config);
	const events: AssistantMessageEvent[] = [];
	for await (const event of config.streamSimple(model, CONTEXT, { apiKey: API_KEY, maxRetries: 0, signal })) {
		events.push(event);
		onEvent?.(event);
	}
	const last = events.at(-1);
	if (last?.type !== "done" && last?.type !== "error") throw new Error("stream ended without done or error");
	const message: AssistantMessage = last.type === "done" ? last.message : last.error;
	return { model, events, message };
}

describe("stream behavior", () => {
	beforeEach(() => {
		resetVertexClients();
		vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => reply(init?.signal ?? undefined));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("streams a text response with usage and cost", async () => {
		reply = () => sseResponse(sse(textReply("Hello")));
		const { model, events, message } = await run();

		expect(events.map((e) => e.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "Hello" }]);
		expect(message.provider).toBe("vertex-anthropic");
		expect(message.api).toBe("vertex-anthropic");
		expect(message.usage).toMatchObject({ input: 100, output: 7, cacheRead: 40, cacheWrite: 0 });
		// Cost comes from the registered model's rates.
		const expected = calculateCost(model, { ...message.usage, cost: { ...message.usage.cost } });
		expect(message.usage.cost.total).toBeGreaterThan(0);
		expect(message.usage.cost).toEqual(expected);
	});

	it("streams an empty text response", async () => {
		reply = () => sseResponse(sse(textReply("")));
		const { message } = await run();
		expect(message.stopReason).toBe("stop");
	});

	it("streams a tool call with parsed arguments", async () => {
		reply = () =>
			sseResponse(
				sse([
					messageStart(),
					{
						type: "content_block_start",
						index: 0,
						content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} },
					},
					{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } },
					{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Paris"}' } },
					{ type: "content_block_stop", index: 0 },
					{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
					{ type: "message_stop" },
				]),
			);
		const { message } = await run();

		expect(message.stopReason).toBe("toolUse");
		expect(message.content).toEqual([
			{ type: "toolCall", id: "toolu_1", name: "get_weather", arguments: { city: "Paris" } },
		]);
	});

	it("keeps multi-byte characters that a chunk boundary splits", async () => {
		const text = "héllo 👋 שלום";
		reply = () => sseResponse(sse(textReply(text)), 1);
		const { message } = await run();
		expect(message.content).toEqual([{ type: "text", text }]);
	});

	it("reports Vertex's prompt-too-long error as a context overflow", async () => {
		// The body Vertex returned for an oversized Haiku 4.5 prompt.
		const body = {
			type: "error",
			error: { type: "invalid_request_error", message: "prompt is too long: 372028 tokens > 200000 maximum" },
			request_id: "req_vrtx_test",
		};
		reply = () => new Response(JSON.stringify(body), { status: 400, headers: { "content-type": "application/json" } });
		const { model, message } = await run();

		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/prompt is too long/);
		expect(isContextOverflow(message, model.contextWindow)).toBe(true);
	});

	it("does not report a rate limit as a context overflow", async () => {
		const body = [{ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }];
		reply = () => new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json" } });
		const { model, message } = await run();

		expect(message.stopReason).toBe("error");
		expect(isContextOverflow(message, model.contextWindow)).toBe(false);
	});

	it("ends with an aborted message when pi cancels mid-stream", async () => {
		reply = (signal) => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(sse([messageStart()])));
					signal?.addEventListener("abort", () => controller.error(signal.reason));
				},
			});
			return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
		};
		const controller = new AbortController();
		const { events, message } = await run(controller.signal, (event) => {
			if (event.type === "start") controller.abort();
		});

		expect(events.filter((e) => e.type === "error")).toHaveLength(1);
		expect(message.stopReason).toBe("aborted");
		expect(message.errorMessage).toBeTruthy();
	});

	it("fails a stream that ends before message_stop", async () => {
		reply = () => sseResponse(sse(textReply("partial").slice(0, 3)));
		const { message } = await run();

		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/ended before message_stop|without a stop reason/);
	});

	it("fails a stream with malformed event data", async () => {
		reply = () => sseResponse(`${sse([messageStart()])}event: content_block_start\ndata: {not json\n\n`);
		const { message } = await run();

		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBeTruthy();
	});
});
