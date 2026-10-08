import type { AnthropicOptions, Api, Model, ModelThinkingLevel, ThinkingBudgets } from "@earendil-works/pi-ai/compat";

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
//      `max_tokens`, so we grow `max_tokens` to absorb the budget.
//
// pi-ai's own Anthropic `streamSimple` does this mapping, but it does not pass
// a `client` through, so the extension calls `stream` and copies the mapping
// (pi-ai's api/anthropic-messages.js and api/simple-options.js).
// test/parity.test.ts sends the same requests through both and fails when
// they differ.
//
// Each model declares its shape where pi-ai's own registry does: on the model
// definition (src/models.ts). `compat.forceAdaptiveThinking` selects adaptive
// thinking, and `thinkingLevelMap` names the effort value for a level. A model
// without the flag uses budgeted thinking, which Vertex rejects with HTTP 400
// for the adaptive-only models.
// =============================================================================

export type PiThinkingLevel = ModelThinkingLevel;

// Adaptive thinking models pick effort instead of a token budget.
export function isAdaptiveThinkingModel(model: Model<Api>): boolean {
	return (model as Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true;
}

/**
 * The effort value for a pi thinking level, as upstream pi-ai's
 * `mapThinkingLevelToEffort` picks it: the model's `thinkingLevelMap` entry
 * when it names one, otherwise the level itself, with `xhigh` and `max`
 * clamped to `high`. Sending `effort: "xhigh"` to a model without an `xhigh` slot is an
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

/** pi-ai's DEFAULT_THINKING_BUDGETS. `xhigh` and `max` use the `high` budget. */
export const DEFAULT_BUDGETS: Required<ThinkingBudgets> = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
};

/** Tokens always left for the answer when a thinking budget shares max_tokens. */
const MIN_ANSWER_TOKENS = 1024;

/** pi-ai's thinkingBudgetForLevel: the user's budget for the level, else the default. */
export function thinkingBudgetFor(level: Exclude<PiThinkingLevel, "off">, custom?: ThinkingBudgets): number {
	const budgets = { ...DEFAULT_BUDGETS, ...custom };
	const clamped = level === "xhigh" || level === "max" ? "high" : level;
	return budgets[clamped];
}

/**
 * pi-ai's adjustMaxTokensForThinking. Grows `max_tokens` (capped at the model's
 * limit) to absorb the thinking budget, and shrinks the budget when even the
 * cap leaves no room for the answer.
 */
export function adjustMaxTokensForThinking(
	baseMaxTokens: number,
	modelMaxTokens: number,
	budget: number,
): { maxTokens: number; thinkingBudget: number } {
	const maxTokens = Math.min(baseMaxTokens + budget, modelMaxTokens);
	const thinkingBudget = Math.min(budget, Math.max(0, maxTokens - MIN_ANSWER_TOKENS));
	return { maxTokens, thinkingBudget };
}
