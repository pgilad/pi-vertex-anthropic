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
import { resolveProjectId, resolveRegion, targetFromApiKey } from "./resolution.ts";
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
		if (isAdaptiveThinkingModel(model)) {
			opts.effort = effortFor(model, reasoning);
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
	const stored = targetFromApiKey(options?.apiKey);
	opts.client = getVertexClient(
		resolveProjectId(stored),
		resolveRegion(stored),
	) as unknown as AnthropicOptions["client"];
	return anthropicMessages.stream(asAnthropicMessagesModel(model), context, opts);
}

/**
 * Bridge our registered model into the type pi-ai's Anthropic Messages
 * implementation expects.
 *
 * The Anthropic Messages implementation expects Model<"anthropic-messages">,
 * but our model's api is "vertex-anthropic". At runtime pi-ai only reads
 * model.api to fill the output metadata, and we want our value to flow through
 * unchanged so cost and usage tracking attribute requests to this provider. If
 * pi-ai's anthropic-messages.js ever dispatches on model.api, reconsider this
 * cast.
 *
 * The model's compat flags, such as `forceAdaptiveThinking`, come from the
 * model definition in src/models.ts: pi copies the definition into the model
 * it passes to streamSimple.
 */
export function asAnthropicMessagesModel<T extends Model<Api>>(model: T): Model<"anthropic-messages"> {
	return model as unknown as Model<"anthropic-messages">;
}
