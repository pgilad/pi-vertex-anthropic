import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { resetVertexClients } from "./client.ts";
import {
	ADC_DOCS_URL,
	DEFAULT_REGION,
	projectFromAdcFile,
	projectFromEnv,
	REGION_RE,
	regionFromEnv,
} from "./resolution.ts";

// =============================================================================
// ADC validation (oauth login flow)
// =============================================================================

// Curated list of Vertex AI regions that host Anthropic Claude models, with
// "global" first as the recommended default. Vertex's regional coverage for
// Claude expands over time and unevenly per model — users with a region not
// listed here can override with GOOGLE_CLOUD_LOCATION.
const REGION_OPTIONS: readonly { readonly id: string; readonly label: string }[] = [
	{ id: "global", label: "global — multi-region routing (recommended)" },
	{ id: "us-east5", label: "us-east5 — Columbus, Ohio" },
	{ id: "us-central1", label: "us-central1 — Iowa" },
	{ id: "europe-west1", label: "europe-west1 — Belgium" },
	{ id: "europe-west4", label: "europe-west4 — Netherlands" },
	{ id: "asia-southeast1", label: "asia-southeast1 — Singapore" },
] as const;

/**
 * Settle with the promise, or reject with the abort reason as soon as the
 * signal aborts. google-auth-library takes no AbortSignal, so this is how
 * /login and refresh return promptly when pi cancels them.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

async function probeAdcProject(): Promise<string> {
	// Loaded on demand, like the Vertex client's SDKs (see client.ts), so a pi
	// start doesn't pay the cost.
	const { GoogleAuth } = await import("google-auth-library");
	const auth = new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});

	// Throws if no credential source works.
	await auth.getClient();

	// Resolve project from env / ADC file first (so the user can override
	// what google-auth-library would auto-detect), then fall back to the SDK's
	// auto-detection so workload-identity / metadata-server setups work even
	// when both env vars and the ADC file are empty. Deliberately does NOT
	// consult the stored credential — we're about to overwrite it.
	const projectId = projectFromEnv() || projectFromAdcFile() || (await auth.getProjectId().catch(() => undefined));
	if (!projectId) {
		throw new Error(
			"ADC credentials work but no GCP project could be determined. Set " +
				"ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT, or re-run " +
				"`gcloud auth application-default login` to record a project in the ADC file.",
		);
	}

	return projectId;
}

/**
 * Determine the Vertex region for this login. Precedence:
 *   1. GOOGLE_CLOUD_LOCATION / CLOUD_ML_REGION env var (honored silently, no prompt).
 *   2. Interactive picker via callbacks.onSelect (REGION_OPTIONS).
 *   3. DEFAULT_REGION ("global") when no UI is available (non-interactive
 *      modes), when the user cancels, or when the picker returns garbage.
 *
 * Exported for tests — they pass in a mock OAuthLoginCallbacks.
 */
export async function chooseRegionAtLogin(callbacks: OAuthLoginCallbacks): Promise<string> {
	const fromEnv = regionFromEnv();
	if (fromEnv) {
		callbacks.onProgress?.(`Region from environment: ${fromEnv}.`);
		return fromEnv;
	}

	let picked: string | undefined;
	try {
		picked = await callbacks.onSelect({
			message: "Select Vertex AI region for Anthropic Claude:",
			options: [...REGION_OPTIONS],
		});
	} catch {
		// Non-interactive context (print/RPC mode without a UI implementation
		// of onSelect) — fall through to the default below.
	}

	if (picked && REGION_RE.test(picked)) {
		callbacks.onProgress?.(`Region selected: ${picked}.`);
		return picked;
	}

	callbacks.onProgress?.(`Using default region: ${DEFAULT_REGION}. Set GOOGLE_CLOUD_LOCATION to override.`);
	return DEFAULT_REGION;
}

export async function loginAdc(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	// Deliberately do NOT call callbacks.onAuth — pi's TUI auto-opens whatever
	// URL it receives there (because every real OAuth flow has a sign-in page).
	// ADC validation has no browser step, so we'd just be opening docs noise.
	// All status flows through onProgress instead.
	callbacks.onProgress?.("Probing for Application Default Credentials...");

	let projectId: string;
	try {
		projectId = await abortable(probeAdcProject(), callbacks.signal);
	} catch (err) {
		if (callbacks.signal?.aborted) throw err;
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(
			`ADC not configured: ${reason}\n\n` +
				`Set up credentials with one of:\n` +
				`  • gcloud auth application-default login   (interactive user creds)\n` +
				`  • export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json   (service account)\n` +
				`  • Run on GCE/GKE with attached workload identity\n\n` +
				`Docs: ${ADC_DOCS_URL}`,
		);
	}

	const region = await chooseRegionAtLogin(callbacks);
	callbacks.onProgress?.(`Authenticated: project=${projectId}, region=${region}.`);
	// Drop the Vertex clients so the next request builds a new one, which reads
	// ADC again and picks up a changed ADC account.
	resetVertexClients();

	return {
		// Sentinels — streamSimple ignores apiKey because the AnthropicVertex
		// SDK does its own auth via google-auth-library at request time.
		access: "adc",
		refresh: "adc",
		// Re-validate daily; google-auth-library handles real access-token
		// refresh internally and transparently.
		expires: Date.now() + 24 * 60 * 60 * 1000,
		projectId,
		region,
	};
}

export async function refreshAdc(credentials: OAuthCredentials, signal?: AbortSignal): Promise<OAuthCredentials> {
	// google-auth-library handles real per-request token refresh internally.
	// On daily re-validation we just re-probe ADC, but we PRESERVE the user's
	// region choice from the existing credential — refreshes should never
	// silently re-prompt or reset the region. pi passes an abort signal (pi
	// 0.84+ requires refreshToken to honor it).
	const projectId = await abortable(probeAdcProject(), signal);
	const storedRegion = typeof credentials.region === "string" ? credentials.region : undefined;
	const region = storedRegion && REGION_RE.test(storedRegion) ? storedRegion : DEFAULT_REGION;
	// Drop the Vertex clients so the next request reads ADC again, even in a
	// long-lived process.
	resetVertexClients();
	return {
		access: "adc",
		refresh: "adc",
		expires: Date.now() + 24 * 60 * 60 * 1000,
		projectId,
		region,
	};
}
