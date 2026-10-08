import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { type AuthClient, GoogleAuth } from "google-auth-library";

// AnthropicVertex clients, one per project and region.

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
function reloadingAuthClient(): AuthClient {
	const newGoogleAuth = () => new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
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

export function getVertexClient(projectId: string, region: string): AnthropicVertex {
	const key = `${projectId}|${region}`;
	let client = clientCache.get(key);
	if (!client) {
		client = new AnthropicVertex({ projectId, region, authClient: reloadingAuthClient() });
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
