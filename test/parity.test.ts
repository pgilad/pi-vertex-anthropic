import type { Api, Context, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai/compat";
import { anthropicMessagesApi, getSupportedThinkingLevels, normalizeContext } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { apiKeyFromCredential } from "../src/resolution.ts";
import { asAnthropicMessagesModel } from "../src/stream.ts";
import { type ProviderConfig, register, registeredModel } from "./helpers.ts";

// The extension copies the option mapping of pi-ai's own Anthropic
// streamSimple, because pi-ai's streamSimple does not pass a client through
// (see src/thinking.ts). This test sends the same requests through both and
// fails when the request bodies differ, so an upstream change shows up when the
// pi-ai dev dependency moves.
//
// Both sides stop in onPayload, before any network call. The contexts are
// small: pi-ai also lowers max_tokens to fit the free context window, which
// the extension does not do (see buildAnthropicOptions).

const anthropicMessages = anthropicMessagesApi();
const STOP = "__payload_captured__";
const API_KEY = apiKeyFromCredential({ access: "adc", refresh: "adc", expires: 0, projectId: "p", region: "global" });

const weather = {
	name: "get_weather",
	description: "Get the weather for a city.",
	parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
} as unknown as NonNullable<Context["tools"]>[number];

const CONTEXTS: Record<string, TranscriptContext> = {
	text: normalizeContext({
		systemPrompt: "You are terse.",
		messages: [{ role: "user", content: "hi", timestamp: 1 }],
	} as Context),
	tools: normalizeContext({
		systemPrompt: "You are terse.",
		tools: [weather],
		messages: [{ role: "user", content: "Weather in Paris?", timestamp: 1 }],
	} as Context),
};

async function capture(stream: AsyncIterable<{ type: string; error?: { errorMessage?: string } }>, get: () => unknown) {
	for await (const event of stream) {
		if (event.type === "error" && event.error?.errorMessage !== STOP) throw new Error(event.error?.errorMessage);
	}
	return get();
}

/** The request body pi-ai's own Anthropic streamSimple builds. */
function upstreamPayload(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions) {
	let payload: unknown;
	const stream = anthropicMessages.streamSimple(asAnthropicMessagesModel(model), context, {
		...options,
		apiKey: "test-key",
		onPayload: (params) => {
			payload = params;
			throw new Error(STOP);
		},
	});
	return capture(stream, () => payload);
}

/** The request body the extension's streamSimple builds. */
function extensionPayload(
	config: ProviderConfig,
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions,
) {
	let payload: unknown;
	const stream = config.streamSimple(model, context, {
		...options,
		apiKey: API_KEY,
		onPayload: (params: unknown) => {
			payload = params;
			throw new Error(STOP);
		},
	});
	return capture(stream, () => payload);
}

describe("parity with pi-ai's Anthropic streamSimple", () => {
	const { config } = register();
	const ids: string[] = config.models.map((m: { id: string }) => m.id);

	for (const id of ids) {
		it(`builds the same request for ${id}`, async () => {
			const model = registeredModel(id, config);
			const levels = getSupportedThinkingLevels(model as Model<"anthropic-messages">).filter((l) => l !== "off");
			const cases: SimpleStreamOptions[] = [{}, { maxTokens: 4_000 }];
			for (const reasoning of levels) {
				cases.push({ reasoning }, { reasoning, maxTokens: 4_000 });
			}
			cases.push(
				{ reasoning: levels.at(-1), thinkingBudgets: { high: 5_000, low: 700 } },
				{ temperature: 0.3, cacheRetention: "long", sessionId: "s1", toolChoice: "auto" },
			);

			for (const [name, context] of Object.entries(CONTEXTS)) {
				for (const options of cases) {
					const label = `${id} ${name} ${JSON.stringify(options)}`;
					expect(await extensionPayload(config, model, context, options), label).toEqual(
						await upstreamPayload(model, context, options),
					);
				}
			}
		});
	}
});
