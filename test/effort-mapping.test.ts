import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { adjustMaxTokensForThinking, asAnthropicMessagesModel, effortFor, isAdaptiveThinkingModel } from "../index.ts";

function fakeModel(id: string, compat?: Record<string, unknown>): Model<Api> {
	// Cast through unknown — we only exercise the fields asAnthropicMessagesModel reads.
	return { id, api: "vertex-anthropic", ...(compat ? { compat } : {}) } as unknown as Model<Api>;
}

describe("isAdaptiveThinkingModel", () => {
	it("recognises every adaptive-thinking model in the registry", () => {
		expect(isAdaptiveThinkingModel("claude-opus-4-7")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-opus-4-8")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-sonnet-4-6")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-fable-5")).toBe(true);
	});

	it("strips the @DATE version suffix before lookup", () => {
		// Vertex sometimes pins models with @YYYYMMDD; the adaptive table is
		// keyed by the base id, so suffixed ids must still resolve.
		expect(isAdaptiveThinkingModel("claude-opus-4-8@20260101")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-sonnet-4-6@20260201")).toBe(true);
	});

	it("treats Haiku 4.5 and older 3.x as non-adaptive (budget-based path)", () => {
		expect(isAdaptiveThinkingModel("claude-haiku-4-5@20251001")).toBe(false);
		expect(isAdaptiveThinkingModel("claude-sonnet-4-5@20250929")).toBe(false);
		expect(isAdaptiveThinkingModel("claude-3-5-sonnet@20241022")).toBe(false);
		expect(isAdaptiveThinkingModel("claude-3-opus@20240229")).toBe(false);
	});
});

describe("effortFor", () => {
	const adaptive = "claude-opus-4-7";

	it("maps low pi levels to SDK 'low'", () => {
		expect(effortFor(adaptive, "minimal")).toBe("low");
		expect(effortFor(adaptive, "low")).toBe("low");
	});

	it("maps medium to medium and high to high", () => {
		expect(effortFor(adaptive, "medium")).toBe("medium");
		expect(effortFor(adaptive, "high")).toBe("high");
	});

	it("maps xhigh to 'xhigh' on Opus 4.7 / 4.8 and Fable 5 (models that expose the slot)", () => {
		// Matches upstream pi-ai's built-in registry, which ships
		// thinkingLevelMap: { xhigh: "xhigh" } for these models.
		expect(effortFor("claude-opus-4-7", "xhigh")).toBe("xhigh");
		expect(effortFor("claude-opus-4-8", "xhigh")).toBe("xhigh");
		expect(effortFor("claude-fable-5", "xhigh")).toBe("xhigh");
	});

	it("clamps xhigh down to 'high' on models without an xhigh slot", () => {
		// Sonnet 4.6 — upstream pi-ai's built-in entry has no thinkingLevelMap,
		// the API rejects effort=xhigh, and upstream's mapThinkingLevelToEffort
		// falls through to "high". We must match that or the API will 400.
		expect(effortFor("claude-sonnet-4-6", "xhigh")).toBe("high");
	});

	it("resolves effort for @DATE-suffixed model ids", () => {
		expect(effortFor("claude-opus-4-7@20260301", "xhigh")).toBe("xhigh");
		expect(effortFor("claude-sonnet-4-6@20260301", "xhigh")).toBe("high");
	});

	it("falls back to 'high' for the 'off' sentinel (defensive default branch)", () => {
		expect(effortFor(adaptive, "off")).toBe("high");
	});
});

describe("adjustMaxTokensForThinking", () => {
	// Mirrors upstream pi-ai's providers/simple-options.js:adjustMaxTokensForThinking.
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

	it("uses the model cap when the caller didn't request a max", () => {
		expect(adjustMaxTokensForThinking(undefined, 64_000, 10_000)).toEqual({
			maxTokens: 64_000,
			thinkingBudget: 10_000,
		});
	});

	it("shrinks the budget to leave room for at least 1024 output tokens", () => {
		// modelMax=8192, budget=10000 — max_tokens stays at 8192 (already > budget?
		// no, 8192 < 10000), so thinkingBudget collapses to 8192 - 1024 = 7168.
		expect(adjustMaxTokensForThinking(undefined, 8_192, 10_000)).toEqual({
			maxTokens: 8_192,
			thinkingBudget: 7_168,
		});
	});

	it("yields a zero budget when even the model cap can't fit MIN_OUTPUT", () => {
		expect(adjustMaxTokensForThinking(undefined, 512, 10_000)).toEqual({
			maxTokens: 512,
			thinkingBudget: 0,
		});
	});
});

describe("asAnthropicMessagesModel", () => {
	// Regression: without `compat.forceAdaptiveThinking`, pi-ai's streamAnthropic
	// silently downgrades adaptive models to legacy budget-based thinking with
	// the default 1024-token budget, dropping our computed `effort` on the floor.
	it("injects compat.forceAdaptiveThinking for adaptive models", () => {
		for (const id of ["claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6", "claude-fable-5"]) {
			const out = asAnthropicMessagesModel(fakeModel(id)) as Model<Api> & {
				compat?: { forceAdaptiveThinking?: boolean };
			};
			expect(out.compat?.forceAdaptiveThinking).toBe(true);
		}
	});

	it("merges existing compat for adaptive models", () => {
		const existingCompat = { supportsLongCacheRetention: false, forceAdaptiveThinking: false };
		const out = asAnthropicMessagesModel(fakeModel("claude-opus-4-7", existingCompat)) as Model<Api> & {
			compat?: { supportsLongCacheRetention?: boolean; forceAdaptiveThinking?: boolean };
		};

		expect(out.compat).toEqual({ supportsLongCacheRetention: false, forceAdaptiveThinking: true });
		expect(out.compat).not.toBe(existingCompat);
		expect(existingCompat).toEqual({ supportsLongCacheRetention: false, forceAdaptiveThinking: false });
	});

	it("does not set compat on non-adaptive models (budget-based path)", () => {
		for (const id of ["claude-haiku-4-5@20251001", "claude-3-5-sonnet@20241022"]) {
			const out = asAnthropicMessagesModel(fakeModel(id)) as Model<Api> & {
				compat?: { forceAdaptiveThinking?: boolean };
			};
			expect(out.compat).toBeUndefined();
		}
	});

	it("preserves model.api unchanged so output metadata still attributes to vertex-anthropic", () => {
		const out = asAnthropicMessagesModel(fakeModel("claude-opus-4-7"));
		expect(out.api).toBe("vertex-anthropic");
	});

	it("returns a clone for adaptive models (does not mutate the registered model object)", () => {
		const original = fakeModel("claude-opus-4-7");
		const out = asAnthropicMessagesModel(original);
		expect(out).not.toBe(original);
		expect((original as Model<Api> & { compat?: unknown }).compat).toBeUndefined();
	});
});
