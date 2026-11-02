import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const importerPath = process.env.SENPI_LOADER_PATH;
if (!importerPath) throw new Error("SENPI_LOADER_PATH must point to bun-extension-importer.js");

const { createBunExtensionImporter } = await import(importerPath);
const loader = createBunExtensionImporter({});

try {
	if (process.argv[2] === "metadata") {
		const calls: string[] = [];
		globalThis.fetch = async (input) => {
			const path = new URL(input.toString()).pathname;
			calls.push(path);
			const body = path.endsWith("/token")
				? JSON.stringify({ access_token: "fake-token", expires_in: 3600, token_type: "Bearer" })
				: path.endsWith("/email")
					? "service@example.test"
					: "fake-project";
			return new Response(body, { headers: { "Metadata-Flavor": "Google" } });
		};

		const { loginAdc } = await loader.importNamespace(fileURLToPath(new URL("../src/login.ts", import.meta.url)));
		const credential = await loginAdc({ onProgress: () => {}, onSelect: async () => "global" });
		const { getVertexClient } = await loader.importNamespace(
			fileURLToPath(new URL("../src/client.ts", import.meta.url)),
		);
		const client = await getVertexClient(credential.projectId, credential.region);
		const authClient = await client._authClientPromise;
		const headers = await authClient.getRequestHeaders();
		console.log(
			JSON.stringify({
				project: credential.projectId,
				tokenAcquired: headers.get("authorization") === "Bearer fake-token",
				metadataProjectRead: calls.includes("/computeMetadata/v1/project/project-id"),
				metadataTokenRead: calls.includes("/computeMetadata/v1/instance/service-accounts/default/token"),
			}),
		);
	} else if (process.argv[2] === "proxy") {
		let requestedUrl: string | undefined;
		const server = createServer((request, response) => {
			requestedUrl = request.url;
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("proxy-ok");
		});
		const listening = once(server, "listening");
		server.listen(0, "127.0.0.1");
		await listening;
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Expected a local TCP proxy");
			process.env.HTTP_PROXY = `http://127.0.0.1:${address.port}`;
			process.env.NO_PROXY = "";

			const { googleAuthClientOptions } = await loader.importNamespace(
				fileURLToPath(new URL("../src/auth-transport.ts", import.meta.url)),
			);
			await googleAuthClientOptions();
			const { instance } = await loader.importNamespace(
				fileURLToPath(new URL("../node_modules/gaxios/build/esm/src/index.js", import.meta.url)),
			);
			const result = await instance.request({
				url: "http://example.invalid/proxy-check",
				responseType: "text",
				timeout: 3000,
			});
			console.log(JSON.stringify({ requestedUrl, body: result.data }));
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	} else {
		throw new Error(`Unknown probe: ${process.argv[2]}`);
	}
} finally {
	loader.dispose();
}
