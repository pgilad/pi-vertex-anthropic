import type { AnthropicOptions, Api, Model } from "@earendil-works/pi-ai/compat";

// =============================================================================
// Thinking-level mapping (pi → Anthropic SDK)
//
// Two thinking shapes coexist in Anthropic's Messages API:
//
//   1. ADAPTIVE THINKING: `thinking: { type: "adaptive" }` +
//      `output_config.effort`. The model decides when and how much to think;
//      pi maps `reasoning` → an effort string.
//
//   2. EXTENDED (BUDGETED) THINKING: `thinking: { type: "enabled",
//      budget_tokens: N }`. Pi maps `reasoning` → an integer token budget.
//      Anthropic requires `budget_tokens` to be strictly less than
//      `max_tokens`, so we grow `max_tokens` to absorb the budget — mirroring
//      upstream pi-ai's `adjustMaxTokensForThinking`.
//
// Each model declares its shape where pi-ai's own registry does: on the model
// definition (src/models.ts). `compat.forceAdaptiveThinking` selects adaptive
// thinking, and `thinkingLevelMap` names the effort value for a level. A model
// without the flag uses budgeted thinking, which Vertex rejects with HTTP 400
// for the adaptive-only models.
// =============================================================================

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// Adaptive thinking models pick effort instead of a token budget.
export function isAdaptiveThinkingModel(model: Model<Api>): boolean {
	return (model as Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true;
}

/**
 * The effort value for a pi thinking level, as upstream pi-ai's
 * `mapThinkingLevelToEffort` picks it: the model's `thinkingLevelMap` entry
 * when it names one, otherwise the level itself, with `xhigh` clamped to
 * `high`. Sending `effort: "xhigh"` to a model without an `xhigh` slot is an
 * HTTP 400 (for example, Sonnet 4.6).
 */
export function effortFor(model: Model<Api>, level: PiThinkingLevel): NonNullable<AnthropicOptions["effort"]> {
	const mapped = model.thinkingLevelMap?.[level];
	if (typeof mapped === "string") return mapped as NonNullable<AnthropicOptions["effort"]>;
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
