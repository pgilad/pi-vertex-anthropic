import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { asAnthropicMessagesModel, effortFor, isAdaptiveThinkingModel } from "../index.ts";

function fakeModel(id: string, compat?: Record<string, unknown>): Model<Api> {
	// Cast through unknown — we only exercise the fields asAnthropicMessagesModel reads.
	return { id, api: "vertex-anthropic", ...(compat ? { compat } : {}) } as unknown as Model<Api>;
}

describe("isAdaptiveThinkingModel", () => {
	it("recognises Opus 4.6 / 4.7 and Sonnet 4.6 as adaptive", () => {
		expect(isAdaptiveThinkingModel("claude-opus-4-6")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-opus-4-7")).toBe(true);
		expect(isAdaptiveThinkingModel("claude-sonnet-4-6")).toBe(true);
	});

	it("treats Haiku 4.5 and older 3.x as non-adaptive", () => {
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

	it("maps xhigh to 'xhigh' on Opus 4.7 and Sonnet 4.6", () => {
		expect(effortFor("claude-opus-4-7", "xhigh")).toBe("xhigh");
		expect(effortFor("claude-sonnet-4-6", "xhigh")).toBe("xhigh");
	});

	it("maps xhigh to 'max' specifically on Opus 4.6 (only model where SDK accepts 'max')", () => {
		expect(effortFor("claude-opus-4-6", "xhigh")).toBe("max");
	});

	it("falls back to 'high' for unknown levels (defensive default)", () => {
		// @ts-expect-error — exercising the default branch with an out-of-spec value
		expect(effortFor(adaptive, "off")).toBe("high");
	});
});

describe("asAnthropicMessagesModel", () => {
	// Regression: without `compat.forceAdaptiveThinking`, pi-ai's streamAnthropic
	// silently downgrades adaptive models to legacy budget-based thinking with
	// the default 1024-token budget, dropping our computed `effort` on the floor.
	it("injects compat.forceAdaptiveThinking for adaptive models", () => {
		for (const id of ["claude-opus-4-6", "claude-opus-4-7", "claude-sonnet-4-6"]) {
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
