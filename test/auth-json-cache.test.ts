import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetCredCacheForTests, credentialFromAuthJson } from "../index.ts";

let agentDir: string;
let savedEnv: string | undefined;

function writeAuth(contents: unknown): void {
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify(contents), { mode: 0o600 });
}

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "pi-vertex-anthropic-test-"));
	savedEnv = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	__resetCredCacheForTests();
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
	if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedEnv;
	__resetCredCacheForTests();
});

describe("credentialFromAuthJson", () => {
	it("returns empty object when auth.json is missing", () => {
		expect(credentialFromAuthJson()).toEqual({});
	});

	it("returns empty object when auth.json has no vertex-anthropic entry", () => {
		writeAuth({ anthropic: { type: "api_key", key: "sk-..." } });
		expect(credentialFromAuthJson()).toEqual({});
	});

	it("returns empty object when entry exists but is not an oauth credential", () => {
		writeAuth({ "vertex-anthropic": { type: "api_key", key: "fake" } });
		expect(credentialFromAuthJson()).toEqual({});
	});

	it("extracts projectId and region from an oauth credential", () => {
		writeAuth({
			"vertex-anthropic": {
				type: "oauth",
				access: "adc",
				refresh: "adc",
				expires: Date.now() + 86_400_000,
				projectId: "my-gcp-project",
				region: "us-east5",
			},
		});
		expect(credentialFromAuthJson()).toEqual({ projectId: "my-gcp-project", region: "us-east5" });
	});

	it("tolerates missing projectId/region fields without throwing", () => {
		writeAuth({ "vertex-anthropic": { type: "oauth", access: "adc", refresh: "adc", expires: 0 } });
		expect(credentialFromAuthJson()).toEqual({ projectId: undefined, region: undefined });
	});

	it("returns empty object on malformed JSON instead of throwing", () => {
		writeFileSync(join(agentDir, "auth.json"), "{ this is not json", { mode: 0o600 });
		expect(credentialFromAuthJson()).toEqual({});
	});

	it("caches reads — a second call returns the same result even if the file changes", () => {
		writeAuth({
			"vertex-anthropic": {
				type: "oauth",
				access: "adc",
				refresh: "adc",
				expires: 0,
				projectId: "first-call",
				region: "global",
			},
		});
		expect(credentialFromAuthJson().projectId).toBe("first-call");

		writeAuth({
			"vertex-anthropic": {
				type: "oauth",
				access: "adc",
				refresh: "adc",
				expires: 0,
				projectId: "second-call",
				region: "global",
			},
		});
		// Cache still returns first read.
		expect(credentialFromAuthJson().projectId).toBe("first-call");

		// After explicit reset, it re-reads.
		__resetCredCacheForTests();
		expect(credentialFromAuthJson().projectId).toBe("second-call");
	});
});
