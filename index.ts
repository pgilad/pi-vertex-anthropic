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
 *
 * The provider types come from `@earendil-works/pi-coding-agent`, so tsc checks
 * the registration against pi's real contract. The import is type-only and
 * disappears at runtime, so that peer dependency stays optional.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loginAdc, refreshAdc } from "./src/login.ts";
import { MODELS } from "./src/models.ts";
import { apiKeyFromCredential } from "./src/resolution.ts";
import { streamSimple } from "./src/stream.ts";

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
			// pi passes this to streamSimple as options.apiKey: the project and
			// region that /login stored.
			getApiKey: apiKeyFromCredential,
		},

		models: MODELS,
	});
}
