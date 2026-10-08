import type { ProviderModelConfig } from "../index.ts";

// Vertex AI model IDs verified against Anthropic's docs:
// https://platform.claude.com/docs/en/about-claude/models/overview
export const MODELS: ProviderModelConfig[] = [
	{
		// Upstream marks `off` unsupported for this model, so pi does not
		// offer it.
		id: "claude-opus-5",
		name: "Claude Opus 5 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		// Adaptive-only on Vertex: `thinking.type=enabled` is rejected with
		// HTTP 400 ("not supported for this model"), live-verified at region
		// eu, so it must stay in ADAPTIVE_THINKING or every reasoning
		// request fails. Pricing/limits from Anthropic's model card, mirrored
		// by pi-ai's registry: $4 / $20 per MTok (cheaper than Opus 5),
		// cache read 0.2×, 5-min cache write 1.25×; 1M context, 128K max
		// output. Upstream marks `off` and `minimal` unsupported for this
		// model, so pi does not offer them.
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
	},
	{
		// Pricing and limits from Anthropic's published Sonnet 5 model
		// card ($2 / $10 per MTok; cache read 0.1×, 5-min cache write
		// 1.25×; 1M context, 128K max output). Vertex bills the same
		// per-token rates. xhigh is enabled to match Anthropic/pi-ai
		// model metadata.
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	},
	{
		// Sonnet-tier rates ($2 / $10 per MTok; cache read 0.2×, 5-min
		// cache write 1.25×), 1M context, 128K max output. Adaptive-only on
		// Vertex — legacy budget thinking returns HTTP 400 ("not supported
		// for this model"), live-verified at region eu — and upstream marks
		// `off` and `minimal` unsupported, so pi does not offer them.
		id: "claude-sonnet-5-5",
		name: "Claude Sonnet 5.5 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	},
	{
		id: "claude-opus-4-7",
		name: "Claude Opus 4.7 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		// GA model. Pricing verified against Anthropic's published rates
		// ($5 / $25 per MTok; cache read 0.1×, 5-min cache write 1.25×).
		// Vertex bills the same per-token rates.
		id: "claude-opus-4-8",
		name: "Claude Opus 4.8 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		// Opus 4.6 is adaptive-only but, like Sonnet 4.6, has no `xhigh` slot
		// in pi-ai's registry — its map carries only `max`, which the pinned
		// pi-ai level set does not expose — so `xhigh` clamps to `high`.
		// Opus-tier rates, 1M context, 128K max output.
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	},
	{
		// Adaptive thinking without an xhigh slot; `max_tokens` is 128K on
		// Vertex (128001 is rejected: "…is the maximum allowed number of
		// output tokens for claude-sonnet-4-6"), matching pi-ai's registry.
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high (no xhigh)
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	},
	{
		// Pricing and limits from Anthropic's published Fable 5 model card
		// ($10 / $50 per MTok; cache read 0.1×, 5-min cache write 1.25×;
		// 1M context, 128K max output). Vertex bills the same per-token
		// rates. The Vertex catalog still lists versionId `default` (no
		// dated alias yet). xhigh is enabled to match Anthropic/pi-ai model
		// metadata; off is marked unsupported as in upstream pi-ai.
		id: "claude-fable-5",
		name: "Claude Fable 5 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
	},
	{
		// Fable-tier rates ($10 / $50 per MTok) with a cheaper cache read
		// than Fable 5 (0.25× vs 1×), 5-min cache write 1.25×; 1M context,
		// 128K max output. Adaptive thinking only, exactly like Fable 5.
		id: "claude-fable-5-1",
		name: "Claude Fable 5.1 (Vertex)",
		reasoning: true, // adaptive thinking; effort: low/medium/high/xhigh
		thinkingLevelMap: { off: null, xhigh: "xhigh" },
		input: ["text", "image"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
	},
	{
		id: "claude-haiku-4-5@20251001",
		name: "Claude Haiku 4.5 (Vertex)",
		reasoning: true, // extended thinking only; uses thinkingBudgetTokens
		input: ["text", "image"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	},
];
