import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const loaderPath = process.env.SENPI_LOADER_PATH;
if (!loaderPath) throw new Error("Set SENPI_LOADER_PATH to Senpi's bun-extension-importer.js");

const probe = fileURLToPath(new URL("./omo-probe.ts", import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));

function runProbe(mode: string, environment: NodeJS.ProcessEnv): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", [probe, mode], {
			cwd: root,
			env: { ...environment, SENPI_LOADER_PATH: loaderPath },
			signal: AbortSignal.timeout(15_000),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`omo ${mode} probe exited ${code}:\n${stderr || stdout}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch (error) {
				reject(error);
			}
		});
	});
}

test("metadata ADC resolves a project and token through omo's loader", async () => {
	const home = mkdtempSync(join(tmpdir(), "vertex-metadata-"));
	try {
		const environment: NodeJS.ProcessEnv = {
			...process.env,
			HOME: home,
			GCE_METADATA_HOST: "127.0.0.1:1",
			HTTP_PROXY: "",
			HTTPS_PROXY: "",
			ALL_PROXY: "",
			NO_PROXY: "127.0.0.1",
		};
		for (const key of [
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GOOGLE_CLOUD_PROJECT",
			"GCLOUD_PROJECT",
			"ANTHROPIC_VERTEX_PROJECT_ID",
			"CLOUDSDK_CORE_PROJECT",
		]) {
			delete environment[key];
		}

		const result = await runProbe("metadata", environment);

		assert.deepEqual(result, {
			project: "fake-project",
			tokenAcquired: true,
			metadataProjectRead: true,
			metadataTokenRead: true,
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("auth transport sends requests through a local proxy under omo's loader", async () => {
	const result = await runProbe("proxy", {
		...process.env,
		HTTP_PROXY: "",
		HTTPS_PROXY: "",
		ALL_PROXY: "",
		NO_PROXY: "",
	});

	assert.deepEqual(result, {
		requestedUrl: "http://example.invalid/proxy-check",
		body: "proxy-ok",
	});
});
