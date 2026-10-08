import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// Vertex AI model IDs verified against Anthropic's docs:
// https://platform.claude.com/docs/en/about-claude/models/overview
//
// Cost, limits, thinking level maps, compat flags, and prompt cache lifetimes
// follow pi-ai's built-in anthropic registry. test/registry.test.ts compares
// every model with it and lists the deliberate differences, so a registry
// change shows up when the pi-ai dev dependency moves.
//
// pi-ai's Anthropic request builder sends the request shapes these flags turn
// on. Ad-hoc requests to Vertex in this extension's project accepted them for
// the models that project can call; the commit that added the flags records
// what was checked. Sonnet 5.5 and Fable 5 / 5.1 were not reachable there, so
// their flags follow the registry only.

/**
 * Adaptive thinking (effort instead of a token budget). Vertex rejects
 * budgeted thinking for these models with HTTP 400.
 *
 * No model sets `supportsStrictTools`, unlike the registry. Vertex treats
 * strict tools as the `structured_outputs` partner-model feature, which an
 * organization policy (constraints/vertexai.allowedPartnerModelFeatures) can
 * disallow; every request with pi's tools then fails with HTTP 400. Without the
 * flag, pi-ai sends the tools without `strict`.
 */
const ADAPTIVE = { forceAdaptiveThinking: true } as const;

/** Vertex rejects `temperature` for these models: "`temperature` is deprecated for this model." */
const NO_TEMPERATURE = { supportsTemperature: false } as const;

/**
 * Mid-conversation system messages and tool changes. pi-ai then sends a tool
 * that pi adds mid-conversation as a `tool_addition` block instead of a new
 * tool list, so the cached prompt prefix survives the change.
 */
const MID_CONVERSATION = { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } as const;

/** A thinking level change mid-conversation keeps the cached prompt prefix. */
const MID_CONVERSATION_EFFORT = { supportsMidConvoEffort: true } as const;

/**
 * Prompt cache lifetimes in seconds, so pi keeps an idle cache warm. Vertex
 * honors both cache TTLs that pi-ai sends. Only for adaptive models: pi's
 * cache warmer replays a request with a one-token output cap, and it detects
 * the budgeted models that can't replay only when their api is
 * "anthropic-messages", which ours is not.
 */
const PROMPT_CACHE = { short: 300, long: 3600 };

export const MODELS: ProviderModelConfig[] = [
	{
		id: "claude-opus-5",
		name: "Claude Opus 5 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE, ...MID_CONVERSATION, ...MID_CONVERSATION_EFFORT },
		promptCache: PROMPT_CACHE,
	},
	{
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE, ...MID_CONVERSATION, ...MID_CONVERSATION_EFFORT },
		promptCache: PROMPT_CACHE,
	},
	{
		// The registry allows temperature for this model, but Vertex rejects it.
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE },
		promptCache: PROMPT_CACHE,
	},
	{
		id: "claude-sonnet-5-5",
		name: "Claude Sonnet 5.5 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE, ...MID_CONVERSATION, ...MID_CONVERSATION_EFFORT },
		promptCache: PROMPT_CACHE,
	},
	{
		id: "claude-opus-4-7",
		name: "Claude Opus 4.7 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE },
		promptCache: PROMPT_CACHE,
	},
	{
		id: "claude-opus-4-8",
		name: "Claude Opus 4.8 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		compat: { ...ADAPTIVE, ...NO_TEMPERATURE, ...MID_CONVERSATION },
		promptCache: PROMPT_CACHE,
	},
	{
		// No xhigh slot: the API rejects effort=xhigh, so pi clamps xhigh to high.
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		compat: ADAPTIVE,
		promptCache: PROMPT_CACHE,
	},
	{
		// No xhigh slot: the API rejects effort=xhigh, so pi clamps xhigh to high.
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		compat: ADAPTIVE,
		promptCache: PROMPT_CACHE,
	},
	{
		// The Vertex catalog lists versionId `default` (no dated alias). The
		// registry's server-side fallback models name the direct Anthropic
		// provider, so the extension does not declare them.
		id: "claude-fable-5",
		name: "Claude Fable 5 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
		compat: { ...ADAPTIVE, ...MID_CONVERSATION },
		promptCache: PROMPT_CACHE,
	},
	{
		id: "claude-fable-5-1",
		name: "Claude Fable 5.1 (Vertex)",
		reasoning: true,
		thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
		compat: { ...ADAPTIVE, ...MID_CONVERSATION, ...MID_CONVERSATION_EFFORT },
		promptCache: PROMPT_CACHE,
	},
	{
		// Budgeted thinking, so no prompt cache lifetimes (see PROMPT_CACHE).
		id: "claude-haiku-4-5@20251001",
		name: "Claude Haiku 4.5 (Vertex)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	},
];
