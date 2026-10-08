/**
 * pi-vertex-anthropic
 *
 * Pi extension exposing Anthropic Claude models hosted on Google Cloud Vertex AI.
 *
 * Auth: real Application Default Credentials via @anthropic-ai/vertex-sdk
 * (which uses google-auth-library internally). Supports gcloud user creds,
 * GOOGLE_APPLICATION_CREDENTIALS service-account JSON, GCE/GKE metadata
 * server, and workload identity — no `gcloud` subprocess required at request
 * time.
 *
 * Pi integration uses the `oauth` field for /login: a one-time ADC probe
 * via google-auth-library. No real OAuth flow — we just verify credentials
 * are reachable and stash a sentinel credential so pi considers the provider
 * authenticated. The AnthropicVertex SDK does its own auth and refresh per
 * request.
 *
 * Streaming: injects the AnthropicVertex client into pi-ai's built-in
 * Anthropic Messages implementation (`anthropicMessagesApi().stream`), so all
 * message conversion, SSE parsing, tool-call handling, caching, and
 * thinking-block plumbing comes from upstream pi-ai for free.
 *
 * Imports: `@earendil-works/pi-ai/compat` (pi 1.0+), which pi's extension
 * loader maps to its own bundled copy of pi-ai. For pi 0.75–0.79 use release
 * 0.7.x of this extension; for the `@mariozechner/*` namespace (pi 0.73.x)
 * use 0.1.x. See CHANGELOG.md.
 */

import type {
	Api,
	AssistantMessageEventStream,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
	SimpleStreamOptions,
	TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { loginAdc, refreshAdc } from "./src/login.ts";
import { MODELS } from "./src/models.ts";
import { streamSimple } from "./src/stream.ts";

export interface ProviderModelConfig {
	id: string;
	name: string;
	api?: Api;
	baseUrl?: string;
	reasoning: boolean;
	thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	input: Model<Api>["input"];
	cost: Model<Api>["cost"];
	contextWindow: number;
	maxTokens: number;
}

export interface ProviderConfig {
	name?: string;
	baseUrl?: string;
	api?: Api;
	streamSimple?: (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
	oauth?: {
		name: string;
		login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
		refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
		getApiKey(credentials: OAuthCredentials): string;
	};
	models?: ProviderModelConfig[];
}

export interface ExtensionAPI {
	registerProvider(name: string, config: ProviderConfig): void;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("vertex-anthropic", {
		// baseUrl is declared because pi requires *some* endpoint marker for
		// non-built-in providers. It's NOT used at request time — the
		// AnthropicVertex SDK constructs its own per-model URLs from
		// project + region.
		baseUrl: "https://aiplatform.googleapis.com",

		// Custom API tag so pi doesn't apply any built-in provider's request
		// shape. Our streamSimple handles everything.
		api: "vertex-anthropic",

		streamSimple,

		// OAuth field is the documented pattern for "auth is managed outside
		// pi". For ADC we don't have a real OAuth flow — `login` is just a
		// credential probe via google-auth-library that returns a sentinel
		// credential. AnthropicVertex does the actual per-request auth and
		// token refresh transparently.
		oauth: {
			name: "Google Vertex AI (ADC)",
			login: loginAdc,
			refreshToken: refreshAdc,
			getApiKey: () => "adc",
		},

		models: MODELS,
	});
}
