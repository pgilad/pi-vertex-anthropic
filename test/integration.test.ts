import type { Api, Context, Model } from "@earendil-works/pi-ai/compat";
import { anthropicMessagesApi, normalizeContext } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetFromApiKey } from "../src/resolution.ts";
import { asAnthropicMessagesModel, buildAnthropicOptions } from "../src/stream.ts";
import { isAdaptiveThinkingModel } from "../src/thinking.ts";
import { type ProviderConfig, register, registeredModel } from "./helpers.ts";

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

function modelById(config: ProviderConfig, id: string): Model<Api> {
	return registeredModel(id, config);
}

const CONTEXT = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as unknown as Context);
const anthropicMessages = anthropicMessagesApi();

function fakeClient(capture: { params?: any }) {
	const create = (params: unknown) => {
		capture.params = params;
		// Reject at the network boundary so no real request is made.
		return { asResponse: () => Promise.reject(new Error("NO_NETWORK_IN_TEST")) };
	};
	// pi-ai 1.0 sends through client.beta.messages; 0.79 used client.messages.
	return { messages: { create }, beta: { messages: { create } } };
}

describe("provider registration", () => {
	it("registers the vertex-anthropic provider with oauth + 11 models", () => {
		const { name, config } = register();
		expect(name).toBe("vertex-anthropic");
		expect(config.api).toBe("vertex-anthropic");
		expect(config.baseUrl).toMatch(/^https:\/\//);
		expect(typeof config.oauth.login).toBe("function");
		expect(typeof config.oauth.refreshToken).toBe("function");
		expect(typeof config.oauth.getApiKey).toBe("function");

		const ids = config.models.map((m: { id: string }) => m.id).sort();
		expect(ids).toEqual(
			[
				"claude-fable-5",
				"claude-fable-5-1",
				"claude-haiku-4-5@20251001",
				"claude-opus-4-6",
				"claude-opus-4-7",
				"claude-opus-4-8",
				"claude-opus-5",
				"claude-opus-5-5",
				"claude-sonnet-4-6",
				"claude-sonnet-5",
				"claude-sonnet-5-5",
			].sort(),
		);
	});

	it("marks every registered model except Haiku 4.5 as adaptive (drift guard)", () => {
		// Haiku 4.5 is the only budget-based entry; everything else needs
		// compat.forceAdaptiveThinking or its reasoning requests 400 on Vertex.
		const { config } = register();
		const budgetBased = new Set(["claude-haiku-4-5@20251001"]);
		for (const m of config.models as Array<{ id: string }>) {
			if (budgetBased.has(m.id)) continue;
			expect(isAdaptiveThinkingModel(modelById(config, m.id)), m.id).toBe(true);
		}
	});
});

describe("Anthropic Messages stream contract (no network)", () => {
	it("drives an adaptive model through pi-ai with forceAdaptiveThinking + effort", async () => {
		const { config } = register();
		const model = modelById(config, "claude-opus-4-8");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "high" });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of anthropicMessages.stream(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		// The real pi-ai param builder produced adaptive shape only because the
		// model definition carries compat.forceAdaptiveThinking.
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
		for await (const ev of anthropicMessages.stream(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.model).toBe("claude-fable-5");
		expect(capture.params.thinking.type).toBe("adaptive");
		expect(capture.params.output_config).toEqual({ effort: "xhigh" });
		expect(events.some((e) => e.type === "error")).toBe(true);
	});

	it("drives Sonnet 5 through pi-ai as adaptive thinking with xhigh effort", async () => {
		const { config } = register();
		const model = modelById(config, "claude-sonnet-5");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "xhigh" });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of anthropicMessages.stream(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.model).toBe("claude-sonnet-5");
		expect(capture.params.thinking.type).toBe("adaptive");
		expect(capture.params.output_config).toEqual({ effort: "xhigh" });
		expect(capture.params.stream).toBe(true);
		expect(events.some((e) => e.type === "error")).toBe(true);
	});

	it("drives Opus 5 through pi-ai as adaptive thinking with xhigh effort", async () => {
		const { config } = register();
		const model = modelById(config, "claude-opus-5");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "xhigh" });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of anthropicMessages.stream(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.model).toBe("claude-opus-5");
		expect(capture.params.thinking.type).toBe("adaptive");
		// Opus 5 takes the effort in a trailing system message, so a level change
		// keeps the cached prefix (compat.supportsMidConvoEffort).
		expect(capture.params.messages.at(-1)).toEqual({ role: "system", content: [], output_config: { effort: "xhigh" } });
		expect(capture.params.stream).toBe(true);
		expect(events.some((e) => e.type === "error")).toBe(true);
	});

	it("drives a budget model through pi-ai with enabled/budget_tokens thinking", async () => {
		const { config } = register();
		const model = modelById(config, "claude-haiku-4-5@20251001");
		const capture: { params?: ProviderConfig } = {};
		const opts = buildAnthropicOptions(model, { reasoning: "high", maxTokens: 4_000 });
		opts.client = fakeClient(capture) as unknown as typeof opts.client;

		const events: Array<{ type: string }> = [];
		for await (const ev of anthropicMessages.stream(asAnthropicMessagesModel(model), CONTEXT, opts)) {
			events.push(ev);
		}

		expect(capture.params.thinking.type).toBe("enabled");
		expect(capture.params.thinking.budget_tokens).toBe(16_384);
		expect(capture.params.max_tokens).toBe(20_384);
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

	it("getApiKey hands the stored project and region to streamSimple", async () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		const { config } = register();

		const cred = await config.oauth.login(callbacks());

		expect(targetFromApiKey(config.oauth.getApiKey(cred))).toEqual({ projectId: "env-proj", region: "us-east5" });
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

	it("refreshToken rejects with the abort reason when pi cancels it", async () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		gauth.getClient.mockReturnValue(new Promise(() => {}));
		const { config } = register();
		const controller = new AbortController();

		const refresh = config.oauth.refreshToken({ access: "adc", refresh: "adc", expires: 0 }, controller.signal);
		controller.abort(new Error("cancelled"));

		await expect(refresh).rejects.toThrow("cancelled");
	});

	it("login rejects with the abort reason, not an ADC error, when pi cancels it", async () => {
		gauth.getClient.mockReturnValue(new Promise(() => {}));
		const { config } = register();
		const controller = new AbortController();

		const login = config.oauth.login({ ...callbacks(), signal: controller.signal });
		controller.abort(new Error("cancelled"));

		await expect(login).rejects.toThrow(/^cancelled$/);
	});
});
