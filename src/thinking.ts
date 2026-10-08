import type { AnthropicOptions } from "@earendil-works/pi-ai/compat";

// =============================================================================
// Thinking-level mapping (pi → Anthropic SDK)
//
// Two thinking shapes coexist in Anthropic's Messages API:
//
//   1. ADAPTIVE THINKING (Opus 4.6 / 4.7 / 4.8 / 5 / 5.5, Sonnet 4.6 / 5 / 5.5,
//      Fable 5 / 5.1):
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

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Per-model adaptive-thinking overrides, keyed by the model id with any
 * `@DATE` version suffix stripped. Presence in the table ⇒ adaptive thinking;
 * absence ⇒ extended/budgeted thinking.
 *
 * The `xhigh` field encodes which SDK effort value to send when pi requests
 * level `xhigh`. Omit it to clamp `xhigh` down to `high` (matching upstream
 * pi-ai's `mapThinkingLevelToEffort` fallback).
 *
 *   • Opus 4.7 / 4.8 / 5 / 5.5, Sonnet 5 / 5.5, and Fable 5 / 5.1 — adaptive
 *     with xhigh. We map xhigh → "xhigh" to match pi-ai's built-in registry,
 *     which ships `thinkingLevelMap: { xhigh: "xhigh" }` for these models.
 *   • Opus 4.6 and Sonnet 4.6 — adaptive WITHOUT an xhigh slot. pi-ai's
 *     built-in entry ships only `{ max: "max" }` for them, so `xhigh` is
 *     rejected by the API and we clamp to `high`.
 *
 * Membership is not a judgement call: it mirrors upstream pi-ai's registry
 * (`dist/providers/data/anthropic.json`), where every one of these models
 * carries `compat.forceAdaptiveThinking: true`. A model missing from this table
 * falls through to legacy budget-based thinking, which Vertex rejects with
 * HTTP 400 for the whole Claude 5 family.
 *
 * The registry's newer `max` level is deliberately not declared: the pinned
 * pi-ai level set ends at `xhigh`, so pi never offers `max` for these models.
 */
const ADAPTIVE_THINKING: Record<string, { xhigh?: "xhigh" | "max" }> = {
	"claude-opus-4-6": {},
	"claude-opus-4-7": { xhigh: "xhigh" },
	"claude-opus-4-8": { xhigh: "xhigh" },
	"claude-opus-5": { xhigh: "xhigh" },
	"claude-opus-5-5": { xhigh: "xhigh" },
	"claude-sonnet-4-6": {},
	"claude-sonnet-5": { xhigh: "xhigh" },
	"claude-sonnet-5-5": { xhigh: "xhigh" },
	"claude-fable-5": { xhigh: "xhigh" },
	"claude-fable-5-1": { xhigh: "xhigh" },
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

export const DEFAULT_BUDGETS: Record<Exclude<PiThinkingLevel, "off">, number> = {
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
