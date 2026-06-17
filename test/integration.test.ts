import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { streamAnthropic } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension, {
	asAnthropicMessagesModel,
	buildAnthropicOptions,
	credentialFromAuthJson,
	resetCredentialCache,
} from "../index.ts";

// Mock google-auth-library so the ADC probe never touches real credentials or
// the network. probeAdcProject's dynamic import resolves to this mock.
const gauth = vi.hoisted(() => ({
	getClient: vi.fn(),
	getProjectId: vi.fn(),
}));
vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		getClient() {
			return gauth.getClient();
		}
		getProjectId() {
			return gauth.getProjectId();
		}
	},
}));

// Provider config is read structurally in these tests (noExplicitAny is off in biome.json).
type ProviderConfig = any;

function register(): { name: string; config: ProviderConfig } {
	let captured: { name: string; config: ProviderConfig } | undefined;
	const pi = {
		registerProvider: (name: string, config: ProviderConfig) => {
			captured = { name, config };
		},
	};
	extension(pi as unknown as Parameters<typeof extension>[0]);
	if (!captured) throw new Error("registerProvider was not called");
	return captured;
}

function modelById(config: ProviderConfig, id: string): Model<Api> {
	const m = config.models.find((x: { id: string }) => x.id === id);
	if (!m) throw new Error(`model ${id} not registered`);
	// pi injects api/provider onto each model before handing it to streamSimple.
	return { ...m, api: config.api, provider: "vertex-anthropic" } as unknown as Model<Api>;
}

const CONTEXT = { messages: [{ role: "user", content: "hi", timestamp: 0 }] } as unknown as Context;

function fakeClient(capture: { params?: any }) {
	return {
		messages: {
			create: (params: unknown) => {
				capture.params = params;
				// Reject at the network boundary so no real request is made.
				return { asResponse: () => Promise.reject(new Error("NO_NETWORK_IN_TEST")) };
			},
		},
	};
}

describe("provider registration", () => {
	it("registers the vertex-anthropic provider with oauth + 5 models", () => {
		const { name, config } = register();
		expect(name).toBe("vertex-anthropic");
		expect(config.api).toBe("vertex-anthropic");
		expect(config.baseUrl).toMatch(/^https:\/\//);
		expect(typeof config.oauth.login).toBe("function");
		expect(typeof config.oauth.refreshToken).toBe("function");
		expect(config.oauth.getApiKey()).toBe("adc");

		const ids = config.models.map((m: { id: string }) => m.id).sort();
		expect(ids).toEqual(
			["claude-fable-5", "claude-haiku-4-5@20251001", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6"].sort(),
		);
	});

	it("registers fable-5 with corrected pricing, limits, and xhigh metadata", () => {
		const { config } = register();
		const fable = config.models.find((m: { id: string }) => m.id === "claude-fable-5");
		expect(fable.contextWindow).toBe(1_000_000);
		expect(fable.maxTokens).toBe(128_000);
		expect(fable.cost).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 });
		expect(fable.thinkingLevelMap).toEqual({ off: null, xhigh: "xhigh" });
	});

	it("registers opus-4-8 at Opus-tier pricing with xhigh metadata", () => {
		const { config } = register();
		const opus = config.models.find((m: { id: string }) => m.id === "claude-opus-4-8");
		expect(opus.cost).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
		expect(opus.thinkingLevelMap).toEqual({ xhigh: "xhigh" });
	});
});

describe("streamAnthropic contract (no network)", () => {
	it("drives an adaptive model through pi-ai with forceAdaptiveThinking + effort", async () => {
		const { config } = register();
		const model = modelById(config, "claude-opus-4-8");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "high" });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of streamAnthropic(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		// The real pi-ai param builder produced adaptive shape only because
		// asAnthropicMessagesModel injected compat.forceAdaptiveThinking.
		expect(capture.params.model).toBe("claude-opus-4-8");
		expect(capture.params.thinking.type).toBe("adaptive");
		expect(capture.params.output_config).toEqual({ effort: "high" });
		expect(capture.params.stream).toBe(true);
		// The injected client was used: its sentinel surfaced as an error event.
		expect(events.some((e) => e.type === "error")).toBe(true);
	});

	it("drives Fable 5 xhigh through pi-ai as effort=xhigh", async () => {
		const { config } = register();
		const model = modelById(config, "claude-fable-5");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "xhigh" });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of streamAnthropic(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.model).toBe("claude-fable-5");
		expect(capture.params.thinking.type).toBe("adaptive");
		expect(capture.params.output_config).toEqual({ effort: "xhigh" });
		expect(events.some((e) => e.type === "error")).toBe(true);
	});

	it("drives a budget model through pi-ai with enabled/budget_tokens thinking", async () => {
		const { config } = register();
		const model = modelById(config, "claude-haiku-4-5@20251001");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "high", maxTokens: 4_000 });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of streamAnthropic(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.thinking.type).toBe("enabled");
		expect(capture.params.thinking.budget_tokens).toBe(20_480);
		expect(capture.params.max_tokens).toBe(24_480);
		expect(events.some((e) => e.type === "error")).toBe(true);
	});
});

describe("ADC auth flow (mocked google-auth-library)", () => {
	const ENV = [
		"ANTHROPIC_VERTEX_PROJECT_ID",
		"GOOGLE_CLOUD_PROJECT",
		"GCLOUD_PROJECT",
		"GOOGLE_CLOUD_LOCATION",
		"CLOUD_ML_REGION",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"PI_CODING_AGENT_DIR",
	] as const;
	let saved: Record<string, string | undefined>;

	function callbacks() {
		return {
			onAuth: vi.fn(),
			onDeviceCode: vi.fn(),
			onPrompt: vi.fn(async () => ""),
			onProgress: vi.fn(),
			onSelect: vi.fn(async () => "europe-west1"),
		};
	}

	beforeEach(() => {
		saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
		for (const k of ENV) delete process.env[k];
		// Bogus path so projectFromAdcFile() returns undefined and the probe must
		// use either the env var or google-auth-library's getProjectId().
		process.env.GOOGLE_APPLICATION_CREDENTIALS = "/pi-vertex/does-not-exist.json";
		gauth.getClient.mockReset().mockResolvedValue({});
		gauth.getProjectId.mockReset().mockResolvedValue("detected-proj");
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("login returns a sentinel credential built from env project + region", async () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		const { config } = register();

		const cred = await config.oauth.login(callbacks());

		expect(cred).toMatchObject({ access: "adc", refresh: "adc", projectId: "env-proj", region: "us-east5" });
		expect(gauth.getProjectId).not.toHaveBeenCalled();
	});

	it("login falls back to google-auth-library project detection + the region picker", async () => {
		const cb = callbacks();
		const { config } = register();

		const cred = await config.oauth.login(cb);

		expect(cred.projectId).toBe("detected-proj");
		expect(cred.region).toBe("europe-west1");
		expect(cb.onSelect).toHaveBeenCalledOnce();
	});

	it("login clears the cached auth.json snapshot in long-lived processes", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "pi-vertex-login-cache-"));
		try {
			process.env.PI_CODING_AGENT_DIR = tmp;
			writeFileSync(
				join(tmp, "auth.json"),
				JSON.stringify({ "vertex-anthropic": { type: "oauth", projectId: "old-proj", region: "global" } }),
				{ mode: 0o600 },
			);
			resetCredentialCache();
			expect(credentialFromAuthJson().projectId).toBe("old-proj");

			writeFileSync(
				join(tmp, "auth.json"),
				JSON.stringify({ "vertex-anthropic": { type: "oauth", projectId: "new-proj", region: "us-east5" } }),
				{ mode: 0o600 },
			);
			process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
			process.env.GOOGLE_CLOUD_LOCATION = "global";
			const { config } = register();

			await config.oauth.login(callbacks());

			expect(credentialFromAuthJson().projectId).toBe("new-proj");
		} finally {
			resetCredentialCache();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("login throws a configuration error when ADC is unavailable", async () => {
		gauth.getClient.mockRejectedValue(new Error("Could not load the default credentials"));
		const { config } = register();

		await expect(config.oauth.login(callbacks())).rejects.toThrow(/ADC not configured/);
	});

	it("refreshToken preserves the stored region", async () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		const { config } = register();

		const cred = await config.oauth.refreshToken({
			access: "adc",
			refresh: "adc",
			expires: 0,
			projectId: "env-proj",
			region: "asia-southeast1",
		});

		expect(cred.region).toBe("asia-southeast1");
		expect(cred.projectId).toBe("env-proj");
	});
});
