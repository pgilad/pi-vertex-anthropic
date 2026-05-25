import { describe, expect, it } from "vitest";
import { effortFor, isAdaptiveThinkingModel } from "../index.ts";

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
