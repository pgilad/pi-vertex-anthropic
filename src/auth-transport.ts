import { Agent } from "node:https";
import type { GoogleAuthOptions } from "google-auth-library";

let bunClientOptions: GoogleAuthOptions["clientOptions"] | undefined;

export async function googleAuthClientOptions(): Promise<GoogleAuthOptions["clientOptions"]> {
	if (!("bun" in process.versions)) return undefined;
	if (bunClientOptions) return bunClientOptions;

	// gcp-metadata uses gaxios's shared instance rather than GoogleAuth's
	// transporter. Configure both before ADC probes the metadata server.
	const { instance } = await import("gaxios");
	const agent = new Agent();
	instance.defaults.fetchImplementation = globalThis.fetch;
	instance.defaults.agent = agent;

	// Supplying an agent skips gaxios's dynamic https-proxy-agent import.
	// Bun's fetch handles HTTP(S)_PROXY and NO_PROXY itself.
	bunClientOptions = { transporterOptions: { fetchImplementation: globalThis.fetch, agent } };
	return bunClientOptions;
}
