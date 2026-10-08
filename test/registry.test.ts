import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { MODELS } from "../src/models.ts";

// The model list follows pi-ai's built-in anthropic registry (see
// src/models.ts). This test compares each model with it, so a registry change
// fails here when the pi-ai dev dependency moves. CI runs it only against the
// dev dependency: an older pi has an older registry.

/**
 * Compat flags that change the request pi-ai builds. `supportsStrictTools` is
 * left out: no model sets it (see ADAPTIVE in src/models.ts).
 */
const COMPAT_KEYS = [
	"forceAdaptiveThinking",
	"supportsTemperature",
	"supportsMidConvoSystemMessages",
	"supportsMidConvoToolChanges",
	"supportsMidConvoEffort",
	"supportsEagerToolInputStreaming",
	"supportsLongCacheRetention",
	"supportsCacheControlOnTools",
	"allowEmptySignature",
] as const;

/** Deliberate differences from the registry, with the reason for each. */
const OVERRIDES: Record<string, { compat?: Record<string, unknown>; promptCache?: undefined }> = {
	// Vertex rejects temperature for Sonnet 5: "`temperature` is deprecated for
	// this model." The registry allows it.
	"claude-sonnet-5": { compat: { supportsTemperature: false } },
	// Budgeted thinking: pi's cache warmer can't tell that its replays change the
	// thinking budget (see PROMPT_CACHE in src/models.ts).
	"claude-haiku-4-5@20251001": { promptCache: undefined },
};

type AnthropicModel = Model<"anthropic-messages">;

/** Vertex pins a version with `@YYYYMMDD`; the registry uses `-YYYYMMDD`. */
function registryModel(id: string): AnthropicModel {
	const model = getBuiltinModel("anthropic", id.replace("@", "-") as never) as AnthropicModel | undefined;
	if (!model) throw new Error(`pi-ai's anthropic registry has no ${id}`);
	return model;
}

/** Drop identity entries, which mean the same as no entry, for the levels that have a default. */
function thinkingLevels(map: Model<Api>["thinkingLevelMap"]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [level, value] of Object.entries(map ?? {})) {
		if (["low", "medium", "high"].includes(level) && value === level) continue;
		out[level] = value;
	}
	return out;
}

function compatFlags(compat: AnthropicModel["compat"]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of COMPAT_KEYS) {
		const value = (compat as Record<string, unknown> | undefined)?.[key];
		if (value !== undefined) out[key] = value;
	}
	return out;
}

describe("model list matches pi-ai's anthropic registry", () => {
	it("never turns on strict tools, which an organization policy can disallow on Vertex", () => {
		for (const definition of MODELS) {
			expect((definition as unknown as AnthropicModel).compat?.supportsStrictTools, definition.id).toBeUndefined();
		}
	});

	for (const definition of MODELS) {
		const ours = definition as unknown as AnthropicModel;

		describe(definition.id, () => {
			const theirs = registryModel(definition.id);
			const override = OVERRIDES[definition.id] ?? {};

			it("has the same cost and limits", () => {
				expect(ours.cost).toEqual(theirs.cost);
				expect(ours.contextWindow).toBe(theirs.contextWindow);
				expect(ours.maxTokens).toBe(theirs.maxTokens);
				expect(ours.reasoning).toBe(theirs.reasoning);
				expect(ours.input).toEqual(theirs.input);
			});

			it("has the same thinking levels", () => {
				expect(thinkingLevels(ours.thinkingLevelMap)).toEqual(thinkingLevels(theirs.thinkingLevelMap));
			});

			it("has the same compat flags", () => {
				expect(compatFlags(ours.compat)).toEqual({ ...compatFlags(theirs.compat), ...override.compat });
			});

			it("has the same prompt cache lifetimes", () => {
				expect(ours.promptCache).toEqual("promptCache" in override ? override.promptCache : theirs.promptCache);
			});
		});
	}
});
