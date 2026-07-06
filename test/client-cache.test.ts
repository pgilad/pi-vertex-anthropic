import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVertexClient, resetCredentialCache } from "../index.ts";

const ENV_KEYS = [
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"CLOUD_ML_REGION",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"PI_CODING_AGENT_DIR",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) delete process.env[k];
	// Give resolveProjectId/Region a deterministic source with no network/ADC.
	process.env.ANTHROPIC_VERTEX_PROJECT_ID = "test-proj";
	process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
	resetCredentialCache();
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	resetCredentialCache();
});

describe("Vertex client caching", () => {
	it("returns the same cached client on repeated calls", () => {
		const a = getVertexClient();
		const b = getVertexClient();
		expect(b).toBe(a);
	});

	it("rebuilds the client after resetCredentialCache (no restart needed to pick up new creds)", () => {
		const a = getVertexClient();
		resetCredentialCache();
		const b = getVertexClient();
		expect(b).not.toBe(a);
	});
});
