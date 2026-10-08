import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { resetVertexClients } from "./client.ts";

// =============================================================================
// Project / region resolution (ADC-aware)
//
// Two resolution paths:
//
//   resolveProjectId / resolveRegion  — used at request time (per-stream).
//                                       Chain: env override → stored credential
//                                       (set at /login) → ADC file → throw.
//
//   probeAdcProject / chooseRegionAtLogin
//                                     — used at /login time. Does NOT read the
//                                       stored credential (we're about to
//                                       overwrite it). Project falls back to
//                                       google-auth-library's auto-detection so
//                                       workload identity / metadata-server
//                                       setups work even when env + ADC file
//                                       are both empty. Region is chosen via an
//                                       interactive picker (REGION_OPTIONS),
//                                       with the env var honored silently as
//                                       an override.
//
// Both write to the same credential at the end of /login, so request-time
// resolution always finds whatever login chose. The env-var override is kept
// at request time so a user can flip project or region without re-logging-in.
// =============================================================================

export const DEFAULT_REGION = "global";
export const REGION_RE = /^[a-z0-9-]+$/;
export const ADC_DOCS_URL = "https://cloud.google.com/docs/authentication/provide-credentials-adc";

function adcCredentialsPath(): string | undefined {
	const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
	if (explicit) return existsSync(explicit) ? explicit : undefined;

	const defaultPath =
		platform() === "win32"
			? join(
					process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
					"gcloud",
					"application_default_credentials.json",
				)
			: join(homedir(), ".config", "gcloud", "application_default_credentials.json");
	return existsSync(defaultPath) ? defaultPath : undefined;
}

export function projectFromAdcFile(): string | undefined {
	const path = adcCredentialsPath();
	if (!path) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			project_id?: unknown;
			quota_project_id?: unknown;
		};
		const project = parsed.project_id ?? parsed.quota_project_id;
		return typeof project === "string" && project.trim() ? project.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function projectFromEnv(): string | undefined {
	return (
		process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim() ||
		process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
		process.env.GCLOUD_PROJECT?.trim() ||
		undefined
	);
}

export function regionFromEnv(): string | undefined {
	const region = process.env.GOOGLE_CLOUD_LOCATION?.trim() || process.env.CLOUD_ML_REGION?.trim();
	return region && REGION_RE.test(region) ? region : undefined;
}

// Cached read of our stored credential. Pi rewrites auth.json on /login or
// /logout, after which a pi restart loads a fresh module instance — so a
// per-process cache is sufficient and avoids re-reading the file on every
// request. PI_CODING_AGENT_DIR matches pi's own settings resolution.
let _credCache: { projectId?: string; region?: string } | undefined;

/**
 * Clear the cached auth.json read and the cached Vertex clients.
 * Production-callable: the per-process cache (see above) assumes pi reloads the
 * module after /login or /logout. If that assumption ever stops holding, call
 * this to force the next resolution to re-read auth.json. `/login` and
 * `refreshAdc` call it after successful ADC probes, so staleness in a
 * long-lived process is bounded to the next auth validation. The next request
 * also builds a new Vertex client, which reads ADC again: that picks up a
 * changed ADC account even while the old credential still works, which
 * reloadingAuthClient() can't see.
 */
export function resetCredentialCache(): void {
	_credCache = undefined;
	resetVertexClients();
}

export function credentialFromAuthJson(): { projectId?: string; region?: string } {
	if (_credCache) return _credCache;
	_credCache = {};
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
		const authPath = join(agentDir, "auth.json");
		if (!existsSync(authPath)) return _credCache;
		const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		const cred = auth["vertex-anthropic"] as { type?: unknown; projectId?: unknown; region?: unknown } | undefined;
		if (cred?.type !== "oauth") return _credCache;
		_credCache = {
			projectId: typeof cred.projectId === "string" ? cred.projectId : undefined,
			region: typeof cred.region === "string" ? cred.region : undefined,
		};
		return _credCache;
	} catch {
		return _credCache;
	}
}

export function resolveProjectId(): string {
	const project = projectFromEnv() || credentialFromAuthJson().projectId || projectFromAdcFile();
	if (!project) {
		throw new Error(
			"pi-vertex-anthropic: no GCP project resolvable. Run /login (which probes via " +
				"google-auth-library and stores the project on the credential), or set " +
				"ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT.",
		);
	}
	return project;
}

export function resolveRegion(): string {
	const region = regionFromEnv() || credentialFromAuthJson().region;
	return region && REGION_RE.test(region) ? region : DEFAULT_REGION;
}
