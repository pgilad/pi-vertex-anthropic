import type { Context } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyFromCredential } from "../src/resolution.ts";
import { register, registeredModel } from "./helpers.ts";

// pi loads every extension at startup, also when no Vertex model is in use, so
// the extension must not load the Vertex SDK until a request needs it.
const loaded = vi.hoisted(() => ({ vertex: 0, fail: false }));

// The developer's real ADC must not decide the outcome of the second request.
vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		async getClient() {
			return { getRequestHeaders: async () => new Headers({ authorization: "Bearer test" }) };
		}
	},
}));

vi.mock("@anthropic-ai/vertex-sdk", async (importOriginal) => {
	loaded.vertex++;
	if (loaded.fail) throw new Error("Cannot find package '@anthropic-ai/vertex-sdk'");
	return importOriginal();
});

const API_KEY = apiKeyFromCredential({ access: "adc", refresh: "adc", expires: 0, projectId: "p", region: "global" });
const CONTEXT = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as Context);

describe("lazy SDK loading", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("__no_network__");
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loads the Vertex SDK on the first request, not at registration, and reports a load failure as an error event", async () => {
		loaded.fail = true;
		const { config } = register();
		expect(loaded.vertex).toBe(0);

		const model = registeredModel("claude-opus-4-8", config);
		const events: { type: string; error?: { stopReason: string; errorMessage?: string } }[] = [];
		for await (const event of config.streamSimple(model, CONTEXT, { apiKey: API_KEY, maxRetries: 0 })) {
			events.push(event);
		}

		expect(loaded.vertex).toBe(1);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("error");
		expect(events[0].error?.stopReason).toBe("error");
		// Vitest replaces the mock factory's error message with its own.
		expect(events[0].error?.errorMessage).toBeTruthy();

		// A failed load is not cached: the next request tries again.
		loaded.fail = false;
		const next: string[] = [];
		for await (const event of config.streamSimple(model, CONTEXT, { apiKey: API_KEY, maxRetries: 0 })) {
			next.push(event.type === "error" ? String(event.error.errorMessage) : event.type);
		}
		expect(loaded.vertex).toBe(2);
		expect(next).toEqual([expect.stringMatching(/Connection error|__no_network__/)]);
	});
});
