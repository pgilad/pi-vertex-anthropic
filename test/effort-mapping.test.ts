import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { asAnthropicMessagesModel } from "../src/stream.ts";
import { adjustMaxTokensForThinking, effortFor, isAdaptiveThinkingModel, thinkingBudgetFor } from "../src/thinking.ts";
import { registeredModel, registeredModelIds } from "./helpers.ts";

const BUDGET_MODELS = ["claude-haiku-4-5@20251001"];
const ADAPTIVE_MODELS = registeredModelIds().filter((id) => !BUDGET_MODELS.includes(id));

describe("isAdaptiveThinkingModel", () => {
	it("recognises every registered model except Haiku 4.5 as adaptive", () => {
		// Vertex rejects budgeted thinking for the adaptive-only models with
		// HTTP 400, so a model that loses the flag breaks every reasoning request.
		expect(ADAPTIVE_MODELS).toHaveLength(10);
		for (const id of ADAPTIVE_MODELS) expect(isAdaptiveThinkingModel(registeredModel(id)), id).toBe(true);
	});

	it("treats Haiku 4.5 as budget-based", () => {
		expect(isAdaptiveThinkingModel(registeredModel("claude-haiku-4-5@20251001"))).toBe(false);
	});

	it("reads the flag from the model, not from its id", () => {
		const bare = { id: "claude-opus-4-8", api: "vertex-anthropic" } as unknown as Model<Api>;
		expect(isAdaptiveThinkingModel(bare)).toBe(false);
		expect(isAdaptiveThinkingModel({ ...bare, compat: { forceAdaptiveThinking: true } } as Model<Api>)).toBe(true);
	});
});

describe("effortFor", () => {
	const adaptive = registeredModel("claude-opus-4-7");

	it("maps low pi levels to SDK 'low'", () => {
		expect(effortFor(adaptive, "minimal")).toBe("low");
		expect(effortFor(adaptive, "low")).toBe("low");
	});

	it("maps medium to medium and high to high", () => {
		expect(effortFor(adaptive, "medium")).toBe("medium");
		expect(effortFor(adaptive, "high")).toBe("high");
	});

	it("maps xhigh to 'xhigh' on every model that exposes the slot", () => {
		for (const id of [
			"claude-opus-4-7",
			"claude-opus-4-8",
			"claude-opus-5",
			"claude-opus-5-5",
			"claude-sonnet-5",
			"claude-sonnet-5-5",
			"claude-fable-5",
			"claude-fable-5-1",
		]) {
			expect(effortFor(registeredModel(id), "xhigh"), id).toBe("xhigh");
		}
	});

	it("clamps xhigh down to 'high' on models without an xhigh slot", () => {
		// Opus 4.6 and Sonnet 4.6 have no xhigh entry in their thinkingLevelMap,
		// the API rejects effort=xhigh for them, and upstream's
		// mapThinkingLevelToEffort falls through to "high".
		expect(effortFor(registeredModel("claude-opus-4-6"), "xhigh")).toBe("high");
		expect(effortFor(registeredModel("claude-sonnet-4-6"), "xhigh")).toBe("high");
	});

	it("falls back to 'high' for the 'off' sentinel (defensive default branch)", () => {
		expect(effortFor(registeredModel("claude-opus-4-8"), "off")).toBe("high");
	});
});

describe("adjustMaxTokensForThinking", () => {
	// Mirrors upstream pi-ai's api/simple-options.js:adjustMaxTokensForThinking.
	// Anthropic requires budget_tokens < max_tokens, so we grow max_tokens (up
	// to the model cap) to absorb the budget. When the cap can't fit budget +
	// MIN_OUTPUT (1024), the budget shrinks so the answer still has room.

	it("grows requested max_tokens by the budget when there's headroom", () => {
		expect(adjustMaxTokensForThinking(4_000, 64_000, 10_000)).toEqual({
			maxTokens: 14_000,
			thinkingBudget: 10_000,
		});
	});

	it("caps max_tokens at the model maximum", () => {
		expect(adjustMaxTokensForThinking(60_000, 64_000, 10_000)).toEqual({
			maxTokens: 64_000,
			thinkingBudget: 10_000,
		});
	});

	it("stays at the model cap when the caller didn't request a max", () => {
		// buildAnthropicOptions passes the model limit as the base then.
		expect(adjustMaxTokensForThinking(64_000, 64_000, 10_000)).toEqual({
			maxTokens: 64_000,
			thinkingBudget: 10_000,
		});
	});

	it("shrinks the budget to leave room for at least 1024 output tokens", () => {
		// max_tokens can't exceed the model cap of 8192, so the budget collapses
		// to 8192 - 1024 = 7168.
		expect(adjustMaxTokensForThinking(8_192, 8_192, 10_000)).toEqual({
			maxTokens: 8_192,
			thinkingBudget: 7_168,
		});
	});

	it("keeps 1024 answer tokens even when the grown max_tokens is above the budget", () => {
		// 500 + 16384 = 16884; the budget may use at most 16884 - 1024 = 15860.
		expect(adjustMaxTokensForThinking(500, 64_000, 16_384)).toEqual({
			maxTokens: 16_884,
			thinkingBudget: 15_860,
		});
	});

	it("yields a zero budget when even the model cap can't fit MIN_OUTPUT", () => {
		expect(adjustMaxTokensForThinking(512, 512, 10_000)).toEqual({
			maxTokens: 512,
			thinkingBudget: 0,
		});
	});
});

describe("thinkingBudgetFor", () => {
	it("uses pi-ai's default budgets", () => {
		expect(thinkingBudgetFor("minimal")).toBe(1024);
		expect(thinkingBudgetFor("low")).toBe(2048);
		expect(thinkingBudgetFor("medium")).toBe(8192);
		expect(thinkingBudgetFor("high")).toBe(16384);
	});

	it("uses the high budget for xhigh and max", () => {
		expect(thinkingBudgetFor("xhigh")).toBe(16384);
		expect(thinkingBudgetFor("max", { high: 3000 })).toBe(3000);
	});

	it("prefers the user's budget for the level", () => {
		expect(thinkingBudgetFor("low", { low: 500 })).toBe(500);
		expect(thinkingBudgetFor("medium", { low: 500 })).toBe(8192);
	});
});

describe("asAnthropicMessagesModel", () => {
	it("keeps the model unchanged, compat flags and api included", () => {
		const model = registeredModel("claude-opus-4-7");
		const out = asAnthropicMessagesModel(model);
		expect(out).toBe(model);
		expect(out.api).toBe("vertex-anthropic");
		expect(out.compat?.forceAdaptiveThinking).toBe(true);
	});
});
