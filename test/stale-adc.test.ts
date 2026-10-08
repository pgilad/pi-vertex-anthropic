import type { Api, Context, Model } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, { resetCredentialCache } from "../index.ts";

// Regression guard for ADC that changes under a running pi. AnthropicVertex
// resolves its auth client once, in its constructor, and GoogleAuth keeps the
// credential it loads, so a cached Vertex client kept the refresh token that
// ADC had at its first request. After `gcloud auth application-default login`
// replaced a revoked or expired refresh token, every request failed until pi
// restarted.
//
// The real AnthropicVertex and @anthropic-ai/sdk run here. Only GoogleAuth is
// fake: like the real one, it loads ADC on its first getClient() and keeps that
// credential generation.
const adc = vi.hoisted(() => ({ generation: 1, revoked: new Set<number>(), loads: 0 }));

vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		#generation: number | undefined;
		async getClient() {
			if (this.#generation === undefined) {
				this.#generation = adc.generation;
				adc.loads++;
			}
			const generation = this.#generation;
			return {
				getRequestHeaders: async () => {
					if (adc.revoked.has(generation)) throw new Error("invalid_grant: Token has been expired or revoked.");
					return new Headers({ authorization: `Bearer token-${generation}` });
				},
			};
		}
	},
}));

const ENV = ["ANTHROPIC_VERTEX_PROJECT_ID", "GOOGLE_CLOUD_LOCATION"] as const;

describe("Vertex client when ADC changes under a running pi", () => {
	let saved: Record<string, string | undefined>;
	let config: any;
	let authorization: string | null | undefined;

	// One request through the registered provider. The fetch stub records the
	// Authorization header and stops the request before any network call.
	async function send(): Promise<{ authorization: string | null | undefined; errors: string[] }> {
		authorization = undefined;
		const definition = config.models.find((m: { id: string }) => m.id === "claude-haiku-4-5@20251001");
		const model = {
			...definition,
			api: config.api,
			provider: "vertex-anthropic",
			baseUrl: config.baseUrl,
		} as unknown as Model<Api>;
		const context = normalizeContext({
			messages: [{ role: "user", content: "hi", timestamp: 0 }],
		} as unknown as Context);
		const errors: string[] = [];
		for await (const event of config.streamSimple(model, context, { maxRetries: 0 })) {
			if (event.type === "error") errors.push(String(event.error.errorMessage));
		}
		return { authorization, errors };
	}

	beforeEach(() => {
		saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "stale-adc-project";
		process.env.GOOGLE_CLOUD_LOCATION = "global";
		adc.generation = 1;
		adc.revoked.clear();
		adc.loads = 0;
		vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
			authorization = new Headers(init?.headers).get("authorization");
			throw new Error("__captured__");
		});
		resetCredentialCache();
		extension({
			registerProvider: (_name: string, c: unknown) => {
				config = c;
			},
		} as unknown as Parameters<typeof extension>[0]);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("reads ADC again when the old refresh token stops working", async () => {
		expect((await send()).authorization).toBe("Bearer token-1");

		// The old refresh token is revoked, and the user re-runs
		// `gcloud auth application-default login`.
		adc.revoked.add(1);
		adc.generation = 2;

		expect((await send()).authorization).toBe("Bearer token-2");
		// The new credential stays in use: no further ADC reads.
		expect((await send()).authorization).toBe("Bearer token-2");
		expect(adc.loads).toBe(2);
	});

	it("fails the request, after one reload, when the new ADC fails too", async () => {
		expect((await send()).authorization).toBe("Bearer token-1");
		adc.revoked.add(1);
		adc.revoked.add(2);
		adc.generation = 2;

		const { authorization, errors } = await send();
		expect(authorization).toBeUndefined();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/Google OAuth credentials/);
		expect(adc.loads).toBe(2);
	});

	it("rebuilds the Vertex client on resetCredentialCache, as /login and the daily refresh call it", async () => {
		expect((await send()).authorization).toBe("Bearer token-1");

		// ADC now holds a different account, but the old token still works, so
		// no request fails to start a reload.
		adc.generation = 2;
		expect((await send()).authorization).toBe("Bearer token-1");

		resetCredentialCache();
		expect((await send()).authorization).toBe("Bearer token-2");
	});
});
