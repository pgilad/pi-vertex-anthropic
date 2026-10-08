import {
	type AnthropicOptions,
	type Api,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	anthropicMessagesApi,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { getVertexClient } from "./client.ts";
import { resolveProjectId, resolveRegion, targetFromApiKey } from "./resolution.ts";
import {
	adjustMaxTokensForThinking,
	effortFor,
	isAdaptiveThinkingModel,
	type PiThinkingLevel,
	thinkingBudgetFor,
} from "./thinking.ts";

// =============================================================================
// streamSimple: SimpleStreamOptions → AnthropicOptions, injecting Vertex client
// =============================================================================

/**
 * Pure mapping from pi's SimpleStreamOptions to the AnthropicOptions that
 * pi-ai's Anthropic Messages `stream` consumes, as pi-ai's own Anthropic
 * `streamSimple` maps them. Does NOT set `client`; streamSimple injects that
 * separately.
 *
 * Thinking routing:
 *   • adaptive models → `effort` (via effortFor)
 *   • budget models   → `thinkingBudgetTokens` + grown `maxTokens`
 *   • reasoning off / unset / model without `reasoning` → thinking disabled
 *
 * Two deliberate gaps from pi-ai's `streamSimple`:
 *   • pi-ai also lowers `max_tokens` to fit the free context window, from its
 *     own token estimate, which it does not export. Vertex accepts a prompt
 *     plus `max_tokens` over the window, so the extension sends the limit.
 *   • `apiKey`, `fetch`, and `transport` only matter when pi-ai builds its
 *     own client; the extension injects the Vertex client.
 */
export function buildAnthropicOptions(model: Model<Api>, options?: SimpleStreamOptions): AnthropicOptions {
	const opts: AnthropicOptions = {
		temperature: options?.temperature,
		samplingParams: options?.samplingParams,
		maxTokens: options?.maxTokens ?? model.maxTokens,
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
	if (!reasoning || reasoning === "off" || !model.reasoning) {
		opts.thinkingEnabled = false;
	} else if (isAdaptiveThinkingModel(model)) {
		opts.thinkingEnabled = true;
		opts.effort = effortFor(model, reasoning);
	} else {
		const budget = thinkingBudgetFor(reasoning, options?.thinkingBudgets);
		const adjusted = adjustMaxTokensForThinking(opts.maxTokens ?? model.maxTokens, model.maxTokens, budget);
		opts.thinkingEnabled = true;
		opts.maxTokens = adjusted.maxTokens;
		opts.thinkingBudgetTokens = adjusted.thinkingBudget;
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
	// Throws before the stream starts when no project is known, as pi expects
	// for missing request authentication.
	const stored = targetFromApiKey(options?.apiKey);
	const projectId = resolveProjectId(stored);
	const region = resolveRegion(stored);

	// The Vertex client loads its SDKs on the first request (see client.ts), so
	// the request starts asynchronously and its events pass through this stream.
	const stream = createAssistantMessageEventStream();
	void (async () => {
		try {
			// AnthropicVertex extends the same BaseAnthropic class but our copy of
			// @anthropic-ai/sdk lives in a different node_modules path than pi-ai's
			// nested copy. ECMAScript private fields (#private) are nominal across
			// module instances even when the classes are structurally identical, so
			// `as unknown as Anthropic` won't satisfy tsc. Runtime is fine — both
			// classes share the same shape and the streaming API path doesn't touch
			// any private state.
			opts.client = (await getVertexClient(projectId, region)) as unknown as AnthropicOptions["client"];
			for await (const event of anthropicMessages.stream(asAnthropicMessagesModel(model), context, opts)) {
				stream.push(event);
			}
		} catch (error) {
			stream.push(setupFailure(model, error, options?.signal));
		}
		stream.end();
	})();
	return stream;
}

/** The terminal event when the request can't start, for example when the SDKs fail to load. */
function setupFailure(model: Model<Api>, error: unknown, signal: AbortSignal | undefined): AssistantMessageEvent {
	const reason = signal?.aborted ? "aborted" : "error";
	return {
		type: "error",
		reason,
		error: {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: reason,
			errorMessage: error instanceof Error ? error.message : String(error),
			timestamp: Date.now(),
		},
	};
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
