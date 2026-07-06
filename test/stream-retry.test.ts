import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { resetCredentialCache } from "../index.ts";

// Each AnthropicVertex instance created by getVertexClient() pulls the next
// behavior off this queue. resetCredentialCache() clears the client cache, so a
// retry constructs a fresh instance and consumes the next entry — letting us
// assert whether a retry actually happened.
const sdk = vi.hoisted(() => ({
	rejections: [] as Error[],
	constructed: 0,
}));

vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: class {
		constructor() {
			sdk.constructed++;
		}
		messages = {
			create: () => {
				const err = sdk.rejections.shift() ?? new Error("UNEXPECTED_EXTRA_ATTEMPT");
				// Reject at the network boundary, mirroring how a real auth failure
				// surfaces: streamAnthropic turns it into a terminal `error` event.
				return { asResponse: () => Promise.reject(err) };
			},
		};
	},
}));

// biome-lint: structural reads of the registered provider config.
type ProviderConfig = any;

function streamSimpleOf(): (
	model: Model<Api>,
	context: Context,
) => AsyncIterable<{ type: string; error?: { errorMessage?: string } }> {
	let captured: ProviderConfig;
	extension({ registerProvider: (_n: string, c: ProviderConfig) => (captured = c) } as never);
	const model = { ...captured.models[0], api: captured.api, provider: "vertex-anthropic" } as unknown as Model<Api>;
	return (m = model, ctx = CONTEXT) => captured.streamSimple(m, ctx) as never;
}

const CONTEXT = { messages: [{ role: "user", content: "hi", timestamp: 0 }] } as unknown as Context;

async function collect(stream: AsyncIterable<{ type: string; error?: { errorMessage?: string } }>) {
	const events = [];
	for await (const ev of stream) events.push(ev);
	return events;
}

beforeEach(() => {
	sdk.rejections = [];
	sdk.constructed = 0;
	process.env.ANTHROPIC_VERTEX_PROJECT_ID = "test-proj";
	process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
	resetCredentialCache();
});

afterEach(() => {
	delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
	delete process.env.GOOGLE_CLOUD_LOCATION;
	resetCredentialCache();
});

describe("streamSimple auth retry", () => {
	it("rebuilds the client and retries once on an auth error, swallowing the first", async () => {
		sdk.rejections = [
			new Error("invalid_grant: Token has been expired or revoked."),
			new Error("NO_NETWORK_IN_TEST"), // retry attempt's (non-auth) failure
		];

		const events = await collect(streamSimpleOf()(undefined as never, undefined as never));

		// Two clients constructed => the stale one was evicted and rebuilt.
		expect(sdk.constructed).toBe(2);
		// Only the retry's terminal error is forwarded; the auth error was swallowed.
		const errors = events.filter((e) => e.type === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].error?.errorMessage).toContain("NO_NETWORK_IN_TEST");
	});

	it("does not retry on a non-auth error", async () => {
		sdk.rejections = [new Error("429 Too Many Requests")];

		const events = await collect(streamSimpleOf()(undefined as never, undefined as never));

		expect(sdk.constructed).toBe(1);
		const errors = events.filter((e) => e.type === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].error?.errorMessage).toContain("429");
	});

	it("retries at most once even if the auth error recurs", async () => {
		sdk.rejections = [new Error("invalid_grant: expired"), new Error("invalid_grant: still expired")];

		const events = await collect(streamSimpleOf()(undefined as never, undefined as never));

		// One retry only: two constructions, and the second auth error surfaces.
		expect(sdk.constructed).toBe(2);
		const errors = events.filter((e) => e.type === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].error?.errorMessage).toContain("still expired");
	});
});
