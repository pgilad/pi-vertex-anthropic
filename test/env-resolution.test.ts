import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFromEnv, regionFromEnv } from "../index.ts";

const PROJECT_ENVS = ["ANTHROPIC_VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"] as const;
const REGION_ENVS = ["GOOGLE_CLOUD_LOCATION", "CLOUD_ML_REGION"] as const;

function clearAll(): void {
	for (const key of PROJECT_ENVS) delete process.env[key];
	for (const key of REGION_ENVS) delete process.env[key];
}

describe("projectFromEnv", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = Object.fromEntries(PROJECT_ENVS.map((k) => [k, process.env[k]]));
		clearAll();
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("returns undefined when no relevant env vars are set", () => {
		expect(projectFromEnv()).toBeUndefined();
	});

	it("returns ANTHROPIC_VERTEX_PROJECT_ID when set", () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "my-vertex-proj";
		expect(projectFromEnv()).toBe("my-vertex-proj");
	});

	it("falls back to GOOGLE_CLOUD_PROJECT when ANTHROPIC_VERTEX_PROJECT_ID is absent", () => {
		process.env.GOOGLE_CLOUD_PROJECT = "gcp-proj";
		expect(projectFromEnv()).toBe("gcp-proj");
	});

	it("falls back to GCLOUD_PROJECT when both above are absent", () => {
		process.env.GCLOUD_PROJECT = "legacy-proj";
		expect(projectFromEnv()).toBe("legacy-proj");
	});

	it("respects precedence: ANTHROPIC_VERTEX_PROJECT_ID > GOOGLE_CLOUD_PROJECT > GCLOUD_PROJECT", () => {
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "first";
		process.env.GOOGLE_CLOUD_PROJECT = "second";
		process.env.GCLOUD_PROJECT = "third";
		expect(projectFromEnv()).toBe("first");

		delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
		expect(projectFromEnv()).toBe("second");

		delete process.env.GOOGLE_CLOUD_PROJECT;
		expect(projectFromEnv()).toBe("third");
	});

	it("trims surrounding whitespace", () => {
		process.env.GOOGLE_CLOUD_PROJECT = "  padded-proj  ";
		expect(projectFromEnv()).toBe("padded-proj");
	});

	it("treats empty strings as unset", () => {
		process.env.GOOGLE_CLOUD_PROJECT = "   ";
		expect(projectFromEnv()).toBeUndefined();
	});
});

describe("regionFromEnv", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = Object.fromEntries(REGION_ENVS.map((k) => [k, process.env[k]]));
		clearAll();
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("returns undefined when no relevant env vars are set", () => {
		expect(regionFromEnv()).toBeUndefined();
	});

	it("returns GOOGLE_CLOUD_LOCATION when set", () => {
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		expect(regionFromEnv()).toBe("us-east5");
	});

	it("falls back to CLOUD_ML_REGION", () => {
		process.env.CLOUD_ML_REGION = "europe-west1";
		expect(regionFromEnv()).toBe("europe-west1");
	});

	it("accepts the special 'global' region", () => {
		process.env.GOOGLE_CLOUD_LOCATION = "global";
		expect(regionFromEnv()).toBe("global");
	});

	it("rejects malformed region values to avoid sending garbage to the SDK", () => {
		process.env.GOOGLE_CLOUD_LOCATION = "US_EAST_5";
		expect(regionFromEnv()).toBeUndefined();

		process.env.GOOGLE_CLOUD_LOCATION = "us-east5/extra";
		expect(regionFromEnv()).toBeUndefined();

		process.env.GOOGLE_CLOUD_LOCATION = "us-east5; rm -rf /";
		expect(regionFromEnv()).toBeUndefined();
	});
});
