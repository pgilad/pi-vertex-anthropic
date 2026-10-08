import type { Context } from "@earendil-works/pi-ai/compat";
import { normalizeContext } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVertexClients } from "../src/client.ts";
import { apiKeyFromCredential } from "../src/resolution.ts";
import { register, registeredModel } from "./helpers.ts";

// streamSimple sends each request to the project and region in options.apiKey,
// which pi builds with oauth.getApiKey() from the stored credential. The real
// AnthropicVertex runs; the fetch stub records the URL and stops the request.
vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		async getClient() {
			return { getRequestHeaders: async () => new Headers({ authorization: "Bearer test" }) };
		}
	},
}));

const ENV = [
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"CLOUD_ML_REGION",
	"GOOGLE_APPLICATION_CREDENTIALS",
] as const;

describe("streamSimple target", () => {
	let saved: Record<string, string | undefined>;
	let url: string | undefined;

	async function send(apiKey: string | undefined): Promise<string | undefined> {
		url = undefined;
		const { config } = register();
		const model = registeredModel("claude-haiku-4-5@20251001", config);
		const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as Context);
		for await (const _ of config.streamSimple(model, context, { apiKey, maxRetries: 0 })) {
			// Drain the stream; the fetch stub ends it with an error event.
		}
		return url;
	}

	beforeEach(() => {
		saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
		for (const k of ENV) delete process.env[k];
		// No ADC file, so the project comes from the key or the env vars only.
		process.env.GOOGLE_APPLICATION_CREDENTIALS = "/pi-vertex/does-not-exist.json";
		vi.stubGlobal("fetch", async (input: string | URL | Request) => {
			url = input instanceof Request ? input.url : String(input);
			throw new Error("__captured__");
		});
		resetVertexClients();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("uses the project and region from the API key", async () => {
		const apiKey = apiKeyFromCredential({
			access: "adc",
			refresh: "adc",
			expires: 0,
			projectId: "key-proj",
			region: "europe-west1",
		});
		expect(await send(apiKey)).toContain("/projects/key-proj/locations/europe-west1/");
	});

	it("lets the env vars override the API key", async () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		const apiKey = apiKeyFromCredential({
			access: "adc",
			refresh: "adc",
			expires: 0,
			projectId: "key-proj",
			region: "europe-west1",
		});
		expect(await send(apiKey)).toContain("/projects/env-proj/locations/us-east5/");
	});

	it("throws before streaming when no project is known", async () => {
		await expect(send(undefined)).rejects.toThrow(/no GCP project resolvable/);
	});
});
