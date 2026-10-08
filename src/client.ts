import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import type { AuthClient, GoogleAuth } from "google-auth-library";

// AnthropicVertex clients, one per project and region.
//
// The SDKs load on the first request, not when pi loads the extension: pi
// loads every extension at startup, also when no Vertex model is in use, and
// importing them there delayed every pi start.

type Sdks = {
	AnthropicVertex: typeof AnthropicVertex;
	GoogleAuth: typeof GoogleAuth;
};

let sdks: Promise<Sdks> | undefined;

function loadSdks(): Promise<Sdks> {
	sdks ??= Promise.all([import("@anthropic-ai/vertex-sdk"), import("google-auth-library")]).then(
		([vertex, auth]) => ({ AnthropicVertex: vertex.AnthropicVertex, GoogleAuth: auth.GoogleAuth }),
		(error) => {
			// Let the next request try again.
			sdks = undefined;
			throw error;
		},
	);
	return sdks;
}

const clientCache = new Map<string, AnthropicVertex>();

/**
 * The auth client for AnthropicVertex: it reads ADC again when a token request
 * fails.
 *
 * AnthropicVertex resolves its auth client once, in its constructor, and
 * GoogleAuth keeps the credential it loads. So a cached Vertex client kept the
 * refresh token or key that ADC had at its first request, and when ADC changed
 * under a running pi (`gcloud auth application-default login` after the old
 * refresh token expired or was revoked, or a rotated service account key),
 * every request failed until pi restarted. Now a failed token request builds a
 * new GoogleAuth, which reads ADC again, and tries once more. If that fails
 * too, the request fails with its error.
 *
 * AnthropicVertex only calls getRequestHeaders() on its auth client, and reads
 * projectId only when it has no project, hence the cast. With an authClient,
 * AnthropicVertex calls nothing in its constructor, so broken ADC fails the
 * request instead of rejecting a promise that nothing handles, which stopped
 * pi.
 */
function reloadingAuthClient(GoogleAuthClass: typeof GoogleAuth): AuthClient {
	const newGoogleAuth = () => new GoogleAuthClass({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
	let auth = newGoogleAuth();
	return {
		async getRequestHeaders(url?: string | URL): Promise<Headers> {
			const used = auth;
			try {
				return await (await used.getClient()).getRequestHeaders(url);
			} catch {
				// A concurrent request may have reloaded already.
				if (auth === used) auth = newGoogleAuth();
				return (await auth.getClient()).getRequestHeaders(url);
			}
		},
	} as unknown as AuthClient;
}

export async function getVertexClient(projectId: string, region: string): Promise<AnthropicVertex> {
	const key = `${projectId}|${region}`;
	const cached = clientCache.get(key);
	if (cached) return cached;
	const { AnthropicVertex, GoogleAuth } = await loadSdks();
	// Another request may have built it while the SDKs loaded.
	let client = clientCache.get(key);
	if (!client) {
		client = new AnthropicVertex({ projectId, region, authClient: reloadingAuthClient(GoogleAuth) });
		clientCache.set(key, client);
	}
	return client;
}

/**
 * Drop the cached Vertex clients. The next request builds a new client, which
 * reads ADC again: that picks up a changed ADC account even while the old
 * credential still works, which reloadingAuthClient() can't see.
 */
export function resetVertexClients(): void {
	clientCache.clear();
}
