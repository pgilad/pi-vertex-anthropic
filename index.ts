/**
 * pi-vertex-anthropic
 *
 * Pi extension exposing Anthropic Claude models hosted on Google Cloud Vertex AI.
 *
 * Auth: real Application Default Credentials via @anthropic-ai/vertex-sdk
 * (which uses google-auth-library internally). Supports gcloud user creds,
 * GOOGLE_APPLICATION_CREDENTIALS service-account JSON, GCE/GKE metadata
 * server, and workload identity — no `gcloud` subprocess required at request
 * time.
 *
 * Pi integration uses the `oauth` field for /login: a one-time ADC probe
 * via google-auth-library. No real OAuth flow — we just verify credentials
 * are reachable and stash a sentinel credential so pi considers the provider
 * authenticated. The AnthropicVertex SDK does its own auth and refresh per
 * request.
 *
 * Streaming: injects the AnthropicVertex client into pi-ai's built-in
 * `streamAnthropic`, so all message conversion, SSE parsing, tool-call
 * handling, caching, and thinking-block plumbing comes from upstream pi-ai
 * for free.
 *
 * Namespace: imports target `@earendil-works/*` (pi 0.75+). The earlier
 * `@mariozechner/*` namespace (pi 0.73.x) is frozen; if you need that, use
 * release 0.1.x of this extension. See CHANGELOG.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
	type AnthropicOptions,
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type SimpleStreamOptions,
	streamAnthropic,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Project / region resolution (ADC-aware)
//
// Two resolution paths:
//
//   resolveProjectId / resolveRegion  — used at request time (per-stream).
//                                       Chain: env override → stored credential
//                                       (set at /login) → ADC file → throw.
//
//   probeAdcProject / chooseRegionAtLogin
//                                     — used at /login time. Does NOT read the
//                                       stored credential (we're about to
//                                       overwrite it). Project falls back to
//                                       google-auth-library's auto-detection so
//                                       workload identity / metadata-server
//                                       setups work even when env + ADC file
//                                       are both empty. Region is chosen via an
//                                       interactive picker (REGION_OPTIONS),
//                                       with the env var honored silently as
//                                       an override.
//
// Both write to the same credential at the end of /login, so request-time
// resolution always finds whatever login chose. The env-var override is kept
// at request time so a user can flip project or region without re-logging-in.
// =============================================================================

const DEFAULT_REGION = "global";
const REGION_RE = /^[a-z0-9-]+$/;
const ADC_DOCS_URL = "https://cloud.google.com/docs/authentication/provide-credentials-adc";

function adcCredentialsPath(): string | undefined {
	const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
	if (explicit) return existsSync(explicit) ? explicit : undefined;

	const defaultPath =
		platform() === "win32"
			? join(
					process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
					"gcloud",
					"application_default_credentials.json",
				)
			: join(homedir(), ".config", "gcloud", "application_default_credentials.json");
	return existsSync(defaultPath) ? defaultPath : undefined;
}

export function projectFromAdcFile(): string | undefined {
	const path = adcCredentialsPath();
	if (!path) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			project_id?: unknown;
			quota_project_id?: unknown;
		};
		const project = parsed.project_id ?? parsed.quota_project_id;
		return typeof project === "string" && project.trim() ? project.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function projectFromEnv(): string | undefined {
	return (
		process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim() ||
		process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
		process.env.GCLOUD_PROJECT?.trim() ||
		undefined
	);
}

export function regionFromEnv(): string | undefined {
	const region = process.env.GOOGLE_CLOUD_LOCATION?.trim() || process.env.CLOUD_ML_REGION?.trim();
	return region && REGION_RE.test(region) ? region : undefined;
}

// Cached read of our stored credential. Pi rewrites auth.json on /login or
// /logout, after which a pi restart loads a fresh module instance — so a
// per-process cache is sufficient and avoids re-reading the file on every
// request. PI_CODING_AGENT_DIR matches pi's own settings resolution.
let _credCache: { projectId?: string; region?: string } | undefined;

/** @internal — for tests only. Clears the auth.json read cache. */
export function __resetCredCacheForTests(): void {
	_credCache = undefined;
}

export function credentialFromAuthJson(): { projectId?: string; region?: string } {
	if (_credCache) return _credCache;
	_credCache = {};
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
		const authPath = join(agentDir, "auth.json");
		if (!existsSync(authPath)) return _credCache;
		const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		const cred = auth["vertex-anthropic"] as { type?: unknown; projectId?: unknown; region?: unknown } | undefined;
		if (cred?.type !== "oauth") return _credCache;
		_credCache = {
			projectId: typeof cred.projectId === "string" ? cred.projectId : undefined,
			region: typeof cred.region === "string" ? cred.region : undefined,
		};
		return _credCache;
	} catch {
		return _credCache;
	}
}

function resolveProjectId(): string {
	const project = projectFromEnv() || credentialFromAuthJson().projectId || projectFromAdcFile();
	if (!project) {
		throw new Error(
			"pi-vertex-anthropic: no GCP project resolvable. Run /login (which probes via " +
				"google-auth-library and stores the project on the credential), or set " +
				"ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT.",
		);
	}
	return project;
}

function resolveRegion(): string {
	const region = regionFromEnv() || credentialFromAuthJson().region;
	return region && REGION_RE.test(region) ? region : DEFAULT_REGION;
}

// =============================================================================
// AnthropicVertex client (lazy, cached by project+region)
// =============================================================================

const clientCache = new Map<string, AnthropicVertex>();

function getVertexClient(): AnthropicVertex {
	const projectId = resolveProjectId();
	const region = resolveRegion();
	const key = `${projectId}|${region}`;
	let client = clientCache.get(key);
	if (!client) {
		client = new AnthropicVertex({ projectId, region });
		clientCache.set(key, client);
	}
	return client;
}

// =============================================================================
// ADC validation (oauth login flow)
// =============================================================================

// Curated list of Vertex AI regions that host Anthropic Claude models, with
// "global" first as the recommended default. Vertex's regional coverage for
// Claude expands over time and unevenly per model — users with a region not
// listed here can override with GOOGLE_CLOUD_LOCATION.
const REGION_OPTIONS: readonly { readonly id: string; readonly label: string }[] = [
	{ id: "global", label: "global — multi-region routing (recommended)" },
	{ id: "us-east5", label: "us-east5 — Columbus, Ohio" },
	{ id: "us-central1", label: "us-central1 — Iowa" },
	{ id: "europe-west1", label: "europe-west1 — Belgium" },
	{ id: "europe-west4", label: "europe-west4 — Netherlands" },
	{ id: "asia-southeast1", label: "asia-southeast1 — Singapore" },
] as const;

async function probeAdcProject(): Promise<string> {
	// Dynamic import: google-auth-library ships transitively with @anthropic-ai/vertex-sdk.
	// Loaded on demand so plain `pi --list-models` doesn't pay the cost.
	const { GoogleAuth } = await import("google-auth-library");
	const auth = new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});

	// Throws if no credential source works.
	await auth.getClient();

	// Resolve project from env / ADC file first (so the user can override
	// what google-auth-library would auto-detect), then fall back to the SDK's
	// auto-detection so workload-identity / metadata-server setups work even
	// when both env vars and the ADC file are empty. Deliberately does NOT
	// consult the stored credential — we're about to overwrite it.
	const projectId = projectFromEnv() || projectFromAdcFile() || (await auth.getProjectId().catch(() => undefined));
	if (!projectId) {
		throw new Error(
			"ADC credentials work but no GCP project could be determined. Set " +
				"ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT, or re-run " +
				"`gcloud auth application-default login` to record a project in the ADC file.",
		);
	}

	return projectId;
}

/**
 * Determine the Vertex region for this login. Precedence:
 *   1. GOOGLE_CLOUD_LOCATION / CLOUD_ML_REGION env var (honored silently, no prompt).
 *   2. Interactive picker via callbacks.onSelect (REGION_OPTIONS).
 *   3. DEFAULT_REGION ("global") when no UI is available (non-interactive
 *      modes), when the user cancels, or when the picker returns garbage.
 *
 * Exported for tests — they pass in a mock OAuthLoginCallbacks.
 */
export async function chooseRegionAtLogin(callbacks: OAuthLoginCallbacks): Promise<string> {
	const fromEnv = regionFromEnv();
	if (fromEnv) {
		callbacks.onProgress?.(`Region from environment: ${fromEnv}.`);
		return fromEnv;
	}

	let picked: string | undefined;
	try {
		picked = await callbacks.onSelect({
			message: "Select Vertex AI region for Anthropic Claude:",
			options: [...REGION_OPTIONS],
		});
	} catch {
		// Non-interactive context (print/RPC mode without a UI implementation
		// of onSelect) — fall through to the default below.
	}

	if (picked && REGION_RE.test(picked)) {
		callbacks.onProgress?.(`Region selected: ${picked}.`);
		return picked;
	}

	callbacks.onProgress?.(`Using default region: ${DEFAULT_REGION}. Set GOOGLE_CLOUD_LOCATION to override.`);
	return DEFAULT_REGION;
}

async function loginAdc(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	// Deliberately do NOT call callbacks.onAuth — pi's TUI auto-opens whatever
	// URL it receives there (because every real OAuth flow has a sign-in page).
	// ADC validation has no browser step, so we'd just be opening docs noise.
	// All status flows through onProgress instead.
	callbacks.onProgress?.("Probing for Application Default Credentials...");

	let projectId: string;
	try {
		projectId = await probeAdcProject();
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(
			`ADC not configured: ${reason}\n\n` +
				`Set up credentials with one of:\n` +
				`  • gcloud auth application-default login   (interactive user creds)\n` +
				`  • export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json   (service account)\n` +
				`  • Run on GCE/GKE with attached workload identity\n\n` +
				`Docs: ${ADC_DOCS_URL}`,
		);
	}

	const region = await chooseRegionAtLogin(callbacks);
	callbacks.onProgress?.(`Authenticated: project=${projectId}, region=${region}.`);

	return {
		// Sentinels — streamSimple ignores apiKey because the AnthropicVertex
		// SDK does its own auth via google-auth-library at request time.
		access: "adc",
		refresh: "adc",
		// Re-validate daily; google-auth-library handles real access-token
		// refresh internally and transparently.
		expires: Date.now() + 24 * 60 * 60 * 1000,
		projectId,
		region,
	};
}

async function refreshAdc(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	// google-auth-library handles real per-request token refresh internally.
	// On daily re-validation we just re-probe ADC, but we PRESERVE the user's
	// region choice from the existing credential — refreshes should never
	// silently re-prompt or reset the region.
	const projectId = await probeAdcProject();
	const storedRegion = typeof credentials.region === "string" ? credentials.region : undefined;
	const region = storedRegion && REGION_RE.test(storedRegion) ? storedRegion : DEFAULT_REGION;
	return {
		access: "adc",
		refresh: "adc",
		expires: Date.now() + 24 * 60 * 60 * 1000,
		projectId,
		region,
	};
}

// =============================================================================
// Thinking-level mapping (pi → Anthropic SDK)
//
// Two thinking shapes coexist in Anthropic's Messages API:
//
//   1. ADAPTIVE THINKING (Opus 4.6 / 4.7 / 4.8, Sonnet 4.6, Fable 5):
//      `thinking: { type: "adaptive" }` + `output_config.effort`. The model
//      decides when/how much to think; pi maps `reasoning` → an effort string
//      (low / medium / high / xhigh).
//
//   2. EXTENDED (BUDGETED) THINKING (Haiku 4.5, Sonnet 4.5, Opus 4.1 / 4.5, …):
//      `thinking: { type: "enabled", budget_tokens: N }`. Pi maps `reasoning`
//      → an integer token budget. Anthropic requires `budget_tokens` to be
//      strictly less than `max_tokens`, so we grow `max_tokens` to absorb the
//      budget — mirroring upstream pi-ai's `adjustMaxTokensForThinking`.
//
// Per-model adaptive metadata lives in ADAPTIVE_THINKING below. The map also
// gates `xhigh`: sending `effort: "xhigh"` to a model that doesn't expose an
// `xhigh` slot is a 400 from the API (e.g. Sonnet 4.6). Upstream pi-ai handles
// this via `model.thinkingLevelMap`; we keep the same shape and the same
// clamp-to-`high` fallback semantics.
// =============================================================================

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Per-model adaptive-thinking overrides, keyed by the model id with any
 * `@DATE` version suffix stripped. Presence in the table ⇒ adaptive thinking;
 * absence ⇒ extended/budgeted thinking.
 *
 * The `xhigh` field encodes which SDK effort value to send when pi requests
 * level `xhigh`. Omit it to clamp `xhigh` down to `high` (matching upstream
 * pi-ai's `mapThinkingLevelToEffort` fallback).
 *
 *   • Opus 4.6 / 4.7 / 4.8 — adaptive with xhigh. We map xhigh → "xhigh" to
 *     match pi-ai's built-in registry, which ships `thinkingLevelMap: { xhigh:
 *     "xhigh" }` for these models. (The SDK also exposes a stronger "max"
 *     effort value, but pi-ai's own registry never selects it — staying in
 *     sync avoids drift.)
 *   • Sonnet 4.6  — adaptive WITHOUT xhigh. Upstream pi-ai's built-in entry
 *     for `claude-sonnet-4-6` ships no `thinkingLevelMap`, so `xhigh` is
 *     rejected by the API and we clamp to `high`.
 *   • Fable 5     — adaptive; xhigh support unconfirmed (versionId still
 *     `default` in the Vertex catalog), treated conservatively as not
 *     supported until Anthropic's docs land. Easy to flip when confirmed.
 */
const ADAPTIVE_THINKING: Record<string, { xhigh?: "xhigh" | "max" }> = {
	"claude-opus-4-6": { xhigh: "xhigh" },
	"claude-opus-4-7": { xhigh: "xhigh" },
	"claude-opus-4-8": { xhigh: "xhigh" },
	"claude-sonnet-4-6": {},
	"claude-fable-5": {},
};

function stripVersion(modelId: string): string {
	const at = modelId.indexOf("@");
	return at === -1 ? modelId : modelId.slice(0, at);
}

// Adaptive thinking models pick effort instead of a token budget.
export function isAdaptiveThinkingModel(modelId: string): boolean {
	return stripVersion(modelId) in ADAPTIVE_THINKING;
}

export function effortFor(modelId: string, level: PiThinkingLevel): NonNullable<AnthropicOptions["effort"]> {
	const entry = ADAPTIVE_THINKING[stripVersion(modelId)];
	if (level === "xhigh") return entry?.xhigh ?? "high";
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		default:
			return "high";
	}
}

const DEFAULT_BUDGETS: Record<Exclude<PiThinkingLevel, "off">, number> = {
	minimal: 1024,
	low: 4096,
	medium: 10240,
	high: 20480,
	xhigh: 32768,
};

/**
 * Mirror of upstream pi-ai's `adjustMaxTokensForThinking`
 * (providers/simple-options.js). Anthropic requires `budget_tokens` to be
 * strictly less than `max_tokens`; this helper grows `max_tokens` (capped at
 * the model's hard cap) to absorb the thinking budget. When even the model
 * cap can't fit budget + a minimum output window, the budget is shrunk so the
 * final answer still has room.
 *
 * Returns the adjusted values that should be sent on AnthropicOptions.
 */
export function adjustMaxTokensForThinking(
	requestedMaxTokens: number | undefined,
	modelMaxTokens: number,
	budget: number,
): { maxTokens: number; thinkingBudget: number } {
	const MIN_OUTPUT_TOKENS = 1024;
	const maxTokens =
		requestedMaxTokens === undefined ? modelMaxTokens : Math.min(requestedMaxTokens + budget, modelMaxTokens);
	const thinkingBudget = maxTokens <= budget ? Math.max(0, maxTokens - MIN_OUTPUT_TOKENS) : budget;
	return { maxTokens, thinkingBudget };
}

// =============================================================================
// streamSimple: SimpleStreamOptions → AnthropicOptions, injecting Vertex client
// =============================================================================

function streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const client = getVertexClient();

	const opts: AnthropicOptions = {
		// AnthropicVertex extends the same BaseAnthropic class but our copy of
		// @anthropic-ai/sdk lives in a different node_modules path than pi-ai's
		// nested copy. ECMAScript private fields (#private) are nominal across
		// module instances even when the classes are structurally identical, so
		// `as unknown as Anthropic` won't satisfy tsc. Runtime is fine — both
		// classes share the same shape and the streaming API path doesn't touch
		// any private state.
		client: client as unknown as AnthropicOptions["client"],
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		signal: options?.signal,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		timeoutMs: options?.timeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
	};

	const reasoning = options?.reasoning as PiThinkingLevel | undefined;
	if (reasoning && reasoning !== "off" && model.reasoning) {
		opts.thinkingEnabled = true;
		if (isAdaptiveThinkingModel(model.id)) {
			opts.effort = effortFor(model.id, reasoning);
		} else {
			// Budget-based thinking. We must keep budget_tokens < max_tokens AND
			// grow max_tokens (within the model cap) to absorb the budget so the
			// final answer still has room. Mirrors upstream pi-ai's
			// adjustMaxTokensForThinking — see the doc-comment on that helper.
			const customBudget = options?.thinkingBudgets?.[reasoning as keyof typeof options.thinkingBudgets];
			const budget = customBudget ?? DEFAULT_BUDGETS[reasoning] ?? DEFAULT_BUDGETS.medium;
			const { maxTokens, thinkingBudget } = adjustMaxTokensForThinking(
				options?.maxTokens,
				model.maxTokens ?? 64_000,
				budget,
			);
			opts.maxTokens = maxTokens;
			opts.thinkingBudgetTokens = thinkingBudget;
		}
	} else {
		opts.thinkingEnabled = false;
	}

	return streamAnthropic(asAnthropicMessagesModel(model), context, opts);
}

/**
 * Bridge our registered model into the shape pi-ai's streamAnthropic expects.
 *
 * Two things happen here:
 *
 *   1. Type cast. streamAnthropic's signature requires Model<"anthropic-messages">,
 *      but our model's api is "vertex-anthropic". At runtime pi-ai only reads
 *      model.api once (to populate output metadata) — we want our value to flow
 *      through unchanged so cost/usage tracking attributes requests to the
 *      right provider. The cast is a one-place, well-bounded TypeScript escape
 *      hatch. If pi-ai's anthropic.js ever starts dispatching on model.api
 *      (e.g., to gate provider-specific request shaping), this will need to be
 *      reconsidered.
 *
 *   2. Inject `compat.forceAdaptiveThinking` for adaptive models. pi-ai's
 *      streamAnthropic decides between `thinking: { type: "adaptive" }` +
 *      `output_config.effort` vs the legacy `thinking: { type: "enabled",
 *      budget_tokens }` shape based ENTIRELY on `model.compat?.forceAdaptiveThinking
 *      === true` (see anthropic.js, the param builder). It does NOT look at
 *      whether the caller set `effort` vs `thinkingBudgetTokens`. Without this
 *      flag, opus-4-7 / sonnet-4-6 silently fall through to budget-based
 *      thinking with the default 1024-token budget, and our computed `effort`
 *      is dropped on the floor.
 *
 *      The Model<TApi>["compat"] field is typed as AnthropicMessagesCompat
 *      only when TApi extends "anthropic-messages", and resolves to `never`
 *      for our "vertex-anthropic" tag — so we can't put `compat` on the
 *      registered model literal. We inject it here, behind the same cast.
 *
 * Shallow-cloned (not mutated) so we don't poison whatever pi caches on the
 * registered model; existing runtime compat fields are preserved, and spreading
 * preserves model.api, so the metadata-flow concern from point (1) still holds.
 */
export function asAnthropicMessagesModel<T extends Model<Api>>(model: T): Model<"anthropic-messages"> {
	if (isAdaptiveThinkingModel(model.id)) {
		const existingCompat = (model as unknown as { compat?: NonNullable<Model<"anthropic-messages">["compat"]> }).compat;
		return {
			...model,
			compat: { ...existingCompat, forceAdaptiveThinking: true },
		} as unknown as Model<"anthropic-messages">;
	}
	return model as unknown as Model<"anthropic-messages">;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerProvider("vertex-anthropic", {
		// baseUrl is declared because pi requires *some* endpoint marker for
		// non-built-in providers. It's NOT used at request time — the
		// AnthropicVertex SDK constructs its own per-model URLs from
		// project + region.
		baseUrl: "https://aiplatform.googleapis.com",

		// Custom API tag so pi doesn't apply any built-in provider's request
		// shape. Our streamSimple handles everything.
		api: "vertex-anthropic",

		streamSimple,

		// OAuth field is the documented pattern for "auth is managed outside
		// pi". For ADC we don't have a real OAuth flow — `login` is just a
		// credential probe via google-auth-library that returns a sentinel
		// credential. AnthropicVertex does the actual per-request auth and
		// token refresh transparently.
		oauth: {
			name: "Google Vertex AI (ADC)",
			login: loginAdc,
			refreshToken: refreshAdc,
			getApiKey: () => "adc",
		},

		// Vertex AI model IDs verified against Anthropic's docs:
		// https://platform.claude.com/docs/en/about-claude/models/overview
		models: [
			{
				id: "claude-opus-4-7",
				name: "Claude Opus 4.7 (Vertex)",
				reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 128_000,
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
			},
			{
				// versionId is `default` in the Vertex catalog (no dated alias yet);
				// pricing/limits below are provisional, modeled on Opus 4.7 until
				// Anthropic publishes the model card.
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8 (Vertex)",
				reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 128_000,
				cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
			},
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6 (Vertex)",
				reasoning: true, // adaptive thinking; effort: low/medium/high (no xhigh)
				input: ["text", "image"],
				contextWindow: 1_000_000,
				maxTokens: 64_000,
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			},
			{
				// versionId is `default` in the Vertex catalog. Pricing/limits are
				// provisional placeholders (Sonnet-tier) until Anthropic publishes
				// the model card. Adaptive thinking is assumed by analogy with the
				// other `default`-versioned 4.x adaptive models; xhigh is gated off
				// in ADAPTIVE_THINKING and will clamp to `high` until confirmed.
				id: "claude-fable-5",
				name: "Claude Fable 5 (Vertex)",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 200_000,
				maxTokens: 64_000,
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			},
			{
				id: "claude-haiku-4-5@20251001",
				name: "Claude Haiku 4.5 (Vertex)",
				reasoning: true, // extended thinking only; uses thinkingBudgetTokens
				input: ["text", "image"],
				contextWindow: 200_000,
				maxTokens: 64_000,
				cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
			},
		],
	});
}
