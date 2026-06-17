import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetCredentialCache, resolveProjectId, resolveRegion } from "../index.ts";

const ENV_KEYS = [
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"CLOUD_ML_REGION",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"PI_CODING_AGENT_DIR",
] as const;

let tmp: string;
let saved: Record<string, string | undefined>;

function writeAuthCred(cred: Record<string, unknown> | undefined): void {
	const body = cred ? { "vertex-anthropic": cred } : {};
	writeFileSync(join(tmp, "auth.json"), JSON.stringify(body), { mode: 0o600 });
	resetCredentialCache();
}

function writeAdcFile(contents: Record<string, unknown>): string {
	const p = join(tmp, "adc.json");
	writeFileSync(p, JSON.stringify(contents), { mode: 0o600 });
	return p;
}

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "pi-vertex-resolution-"));
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) delete process.env[k];
	process.env.PI_CODING_AGENT_DIR = tmp;
	// Bogus path so projectFromAdcFile() returns undefined by default instead of
	// falling through to the developer's real ~/.config/gcloud ADC file.
	process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tmp, "does-not-exist.json");
	resetCredentialCache();
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	resetCredentialCache();
});

describe("resolveProjectId precedence", () => {
	it("prefers the env var over the stored credential and the ADC file", () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		writeAuthCred({ type: "oauth", projectId: "cred-proj" });
		process.env.GOOGLE_APPLICATION_CREDENTIALS = writeAdcFile({ project_id: "adc-proj" });
		resetCredentialCache();
		expect(resolveProjectId()).toBe("env-proj");
	});

	it("falls back to the stored credential when no env var is set", () => {
		writeAuthCred({ type: "oauth", projectId: "cred-proj" });
		expect(resolveProjectId()).toBe("cred-proj");
	});

	it("falls back to the ADC file when env var and credential are absent", () => {
		writeAuthCred(undefined);
		process.env.GOOGLE_APPLICATION_CREDENTIALS = writeAdcFile({ project_id: "adc-proj" });
		resetCredentialCache();
		expect(resolveProjectId()).toBe("adc-proj");
	});

	it("reads quota_project_id from the ADC file when project_id is absent", () => {
		writeAuthCred(undefined);
		process.env.GOOGLE_APPLICATION_CREDENTIALS = writeAdcFile({ quota_project_id: "quota-proj" });
		resetCredentialCache();
		expect(resolveProjectId()).toBe("quota-proj");
	});

	it("throws a helpful error when no project can be resolved", () => {
		writeAuthCred(undefined);
		expect(() => resolveProjectId()).toThrow(/no GCP project resolvable/);
	});
});

describe("resolveRegion precedence", () => {
	it("prefers GOOGLE_CLOUD_LOCATION over the stored credential", () => {
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		writeAuthCred({ type: "oauth", region: "europe-west1" });
		expect(resolveRegion()).toBe("us-east5");
	});

	it("falls back to CLOUD_ML_REGION", () => {
		process.env.CLOUD_ML_REGION = "asia-southeast1";
		expect(resolveRegion()).toBe("asia-southeast1");
	});

	it("falls back to the stored credential region", () => {
		writeAuthCred({ type: "oauth", region: "europe-west4" });
		expect(resolveRegion()).toBe("europe-west4");
	});

	it("defaults to global when nothing is set", () => {
		writeAuthCred(undefined);
		expect(resolveRegion()).toBe("global");
	});

	it("rejects a malformed stored region and uses the default", () => {
		writeAuthCred({ type: "oauth", region: "US_EAST_5" });
		expect(resolveRegion()).toBe("global");
	});
});
