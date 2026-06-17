import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildAnthropicOptions } from "../index.ts";

// Only the fields buildAnthropicOptions reads (id, reasoning, maxTokens) matter;
// cast through unknown so we don't have to fill the whole Model shape.
function fakeModel(id: string, over: Partial<Model<Api>> = {}): Model<Api> {
	return { id, api: "vertex-anthropic", reasoning: true, maxTokens: 64_000, ...over } as unknown as Model<Api>;
}

describe("buildAnthropicOptions", () => {
	it("passes simple stream options through unchanged", () => {
		const opts = buildAnthropicOptions(fakeModel("claude-opus-4-8"), {
			temperature: 0.5,
			maxTokens: 1_000,
			cacheRetention: "long",
			sessionId: "s1",
		});
		expect(opts.temperature).toBe(0.5);
		expect(opts.cacheRetention).toBe("long");
		expect(opts.sessionId).toBe("s1");
	});

	it("does not set a client (streamSimple injects it separately)", () => {
		expect(buildAnthropicOptions(fakeModel("claude-opus-4-8"), {}).client).toBeUndefined();
	});

	describe("adaptive models", () => {
		it("maps reasoning to effort with no token budget", () => {
			const opts = buildAnthropicOptions(fakeModel("claude-opus-4-8"), { reasoning: "high" });
			expect(opts.thinkingEnabled).toBe(true);
			expect(opts.effort).toBe("high");
			expect(opts.thinkingBudgetTokens).toBeUndefined();
		});

		it("keeps xhigh on Opus 4.8 and Fable 5 but clamps it to high on Sonnet 4.6", () => {
			expect(buildAnthropicOptions(fakeModel("claude-opus-4-8"), { reasoning: "xhigh" }).effort).toBe("xhigh");
			expect(buildAnthropicOptions(fakeModel("claude-fable-5"), { reasoning: "xhigh" }).effort).toBe("xhigh");
			expect(buildAnthropicOptions(fakeModel("claude-sonnet-4-6"), { reasoning: "xhigh" }).effort).toBe("high");
		});
	});

	describe("budget models", () => {
		it("sets thinkingBudgetTokens and grows maxTokens to absorb the budget", () => {
			const opts = buildAnthropicOptions(fakeModel("claude-haiku-4-5", { maxTokens: 64_000 }), {
				reasoning: "high",
				maxTokens: 4_000,
			});
			expect(opts.thinkingEnabled).toBe(true);
			expect(opts.effort).toBeUndefined();
			// high default budget is 20480; max grows 4000 -> 24480, capped at 64000.
			expect(opts.thinkingBudgetTokens).toBe(20_480);
			expect(opts.maxTokens).toBe(24_480);
		});

		it("honors a custom thinkingBudgets override", () => {
			const opts = buildAnthropicOptions(fakeModel("claude-haiku-4-5"), {
				reasoning: "high",
				maxTokens: 4_000,
				thinkingBudgets: { high: 5_000 },
			});
			expect(opts.thinkingBudgetTokens).toBe(5_000);
			expect(opts.maxTokens).toBe(9_000);
		});
	});

	describe("thinking disabled", () => {
		it("disables thinking when reasoning is the sentinel 'off'", () => {
			// pi can pass "off" at runtime even though ThinkingLevel doesn't list it.
			const opts = buildAnthropicOptions(fakeModel("claude-opus-4-8"), {
				reasoning: "off",
			} as unknown as SimpleStreamOptions);
			expect(opts.thinkingEnabled).toBe(false);
			expect(opts.effort).toBeUndefined();
		});

		it("disables thinking when reasoning is unset", () => {
			expect(buildAnthropicOptions(fakeModel("claude-opus-4-8"), {}).thinkingEnabled).toBe(false);
		});

		it("disables thinking when the model has reasoning: false, even if a level is requested", () => {
			const opts = buildAnthropicOptions(fakeModel("claude-opus-4-8", { reasoning: false }), { reasoning: "high" });
			expect(opts.thinkingEnabled).toBe(false);
			expect(opts.effort).toBeUndefined();
			expect(opts.thinkingBudgetTokens).toBeUndefined();
		});
	});
});
