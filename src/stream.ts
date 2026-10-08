import {
	type AnthropicOptions,
	type Api,
	type AssistantMessageEventStream,
	anthropicMessagesApi,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { getVertexClient } from "./client.ts";
import { resolveProjectId, resolveRegion } from "./resolution.ts";
import {
	adjustMaxTokensForThinking,
	DEFAULT_BUDGETS,
	effortFor,
	isAdaptiveThinkingModel,
	type PiThinkingLevel,
} from "./thinking.ts";

// =============================================================================
// streamSimple: SimpleStreamOptions → AnthropicOptions, injecting Vertex client
// =============================================================================

/**
 * Pure mapping from pi's SimpleStreamOptions to the AnthropicOptions that
 * pi-ai's Anthropic Messages `stream` consumes — extracted from streamSimple
 * so it can be unit tested without constructing a Vertex client or touching
 * the network. Does NOT set `client`; streamSimple injects that separately.
 *
 * Thinking routing:
 *   • adaptive models → `effort` (via effortFor)
 *   • budget models   → `thinkingBudgetTokens` + grown `maxTokens`
 *   • reasoning off / unset / model without `reasoning` → thinking disabled
 */
export function buildAnthropicOptions(model: Model<Api>, options?: SimpleStreamOptions): AnthropicOptions {
	const opts: AnthropicOptions = {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		signal: options?.signal,
		telemetryContext: options?.telemetryContext,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		onProviderStreamEvent: options?.onProviderStreamEvent,
		timeoutMs: options?.timeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		env: options?.env,
		toolChoice: options?.toolChoice,
	};

	const reasoning = options?.reasoning as PiThinkingLevel | undefined;
	if (reasoning && reasoning !== "off" && model.reasoning) {
		opts.thinkingEnabled = true;
		if (isAdaptiveThinkingModel(model.id)) {
			opts.effort = effortFor(model.id, reasoning);
		} else {
			// Budget-based thinking. We must keep budget_tokens < max_tokens AND
			// grow max_tokens (within the model cap) to absorb the budget so the
			// final answer still has room. Mirrors upstream pi-ai's
			// adjustMaxTokensForThinking — see the doc-comment on that helper.
			const customBudget = options?.thinkingBudgets?.[reasoning as keyof typeof options.thinkingBudgets];
			const budget = customBudget ?? DEFAULT_BUDGETS[reasoning] ?? DEFAULT_BUDGETS.medium;
			const { maxTokens, thinkingBudget } = adjustMaxTokensForThinking(
				options?.maxTokens,
				model.maxTokens ?? 64_000,
				budget,
			);
			opts.maxTokens = maxTokens;
			opts.thinkingBudgetTokens = thinkingBudget;
		}
	} else {
		opts.thinkingEnabled = false;
	}

	return opts;
}

// Loads pi-ai's Anthropic Messages implementation on the first request.
const anthropicMessages = anthropicMessagesApi();

export function streamSimple(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const opts = buildAnthropicOptions(model, options);
	// AnthropicVertex extends the same BaseAnthropic class but our copy of
	// @anthropic-ai/sdk lives in a different node_modules path than pi-ai's
	// nested copy. ECMAScript private fields (#private) are nominal across
	// module instances even when the classes are structurally identical, so
	// `as unknown as Anthropic` won't satisfy tsc. Runtime is fine — both
	// classes share the same shape and the streaming API path doesn't touch
	// any private state.
	opts.client = getVertexClient(resolveProjectId(), resolveRegion()) as unknown as AnthropicOptions["client"];
	return anthropicMessages.stream(asAnthropicMessagesModel(model), context, opts);
}

/**
 * Bridge our registered model into the shape pi-ai's Anthropic Messages
 * implementation expects.
 *
 * Two things happen here:
 *
 *   1. Type cast. The Anthropic Messages implementation expects Model<"anthropic-messages">,
 *      but our model's api is "vertex-anthropic". At runtime pi-ai only reads
 *      model.api once (to populate output metadata) — we want our value to flow
 *      through unchanged so cost/usage tracking attributes requests to the
 *      right provider. The cast is a one-place, well-bounded TypeScript escape
 *      hatch. If pi-ai's anthropic-messages.js ever starts dispatching on model.api
 *      (e.g., to gate provider-specific request shaping), this will need to be
 *      reconsidered.
 *
 *   2. Inject `compat.forceAdaptiveThinking` for adaptive models. pi-ai's
 *      Anthropic Messages `stream` decides between `thinking: { type: "adaptive" }` +
 *      `output_config.effort` vs the legacy `thinking: { type: "enabled",
 *      budget_tokens }` shape based ENTIRELY on `model.compat?.forceAdaptiveThinking
 *      === true` (see api/anthropic-messages.js, the param builder). It does NOT look at
 *      whether the caller set `effort` vs `thinkingBudgetTokens`. Without this
 *      flag, opus-4-7 / sonnet-4-6 silently fall through to budget-based
 *      thinking with the default 1024-token budget, and our computed `effort`
 *      is dropped on the floor.
 *
 *      The Model<TApi>["compat"] field is typed as AnthropicMessagesCompat
 *      only when TApi extends "anthropic-messages", and resolves to `never`
 *      for our "vertex-anthropic" tag — so we can't put `compat` on the
 *      registered model literal. We inject it here, behind the same cast.
 *
 * Shallow-cloned (not mutated) so we don't poison whatever pi caches on the
 * registered model; existing runtime compat fields are preserved, and spreading
 * preserves model.api, so the metadata-flow concern from point (1) still holds.
 */
export function asAnthropicMessagesModel<T extends Model<Api>>(model: T): Model<"anthropic-messages"> {
	if (isAdaptiveThinkingModel(model.id)) {
		const existingCompat = (model as unknown as { compat?: NonNullable<Model<"anthropic-messages">["compat"]> }).compat;
		return {
			...model,
			compat: { ...existingCompat, forceAdaptiveThinking: true },
		} as unknown as Model<"anthropic-messages">;
	}
	return model as unknown as Model<"anthropic-messages">;
}
