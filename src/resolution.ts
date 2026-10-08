import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials } from "@earendil-works/pi-ai/compat";

// =============================================================================
// Project / region resolution (ADC-aware)
//
// Two resolution paths:
//
//   resolveProjectId / resolveRegion  — used at request time (per-stream).
//                                       Chain: env override → stored credential
//                                       (set at /login, handed over by pi as
//                                       the API key) → ADC file → throw.
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

/** The project and region that /login stored on the credential. */
export interface StoredTarget {
	projectId?: string;
	region?: string;
}

/**
 * The API key pi passes to streamSimple: the stored project and region.
 *
 * pi calls oauth.getApiKey() with the stored credential and passes the result
 * to streamSimple as options.apiKey. The AnthropicVertex client does its own
 * auth, so the key is free to carry the target. This way the extension does
 * not read pi's private auth.json, and a new /login takes effect on the next
 * request.
 */
export function apiKeyFromCredential(credentials: OAuthCredentials): string {
	const target: StoredTarget = {
		projectId: typeof credentials.projectId === "string" ? credentials.projectId : undefined,
		region: typeof credentials.region === "string" ? credentials.region : undefined,
	};
	return JSON.stringify(target);
}

/**
 * Read the target back from options.apiKey. Any other key, for example one from
 * `pi --api-key`, gives an empty target, so the env vars and the ADC file
 * decide.
 */
export function targetFromApiKey(apiKey: string | undefined): StoredTarget {
	if (!apiKey?.startsWith("{")) return {};
	try {
		const parsed = JSON.parse(apiKey) as { projectId?: unknown; region?: unknown };
		return {
			projectId: typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : undefined,
			region: typeof parsed.region === "string" && parsed.region ? parsed.region : undefined,
		};
	} catch {
		return {};
	}
}

export function resolveProjectId(stored: StoredTarget = {}): string {
	const project = projectFromEnv() || stored.projectId || projectFromAdcFile();
	if (!project) {
		throw new Error(
			"pi-vertex-anthropic: no GCP project resolvable. Run /login (which probes via " +
				"google-auth-library and stores the project on the credential), or set " +
				"ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT.",
		);
	}
	return project;
}

export function resolveRegion(stored: StoredTarget = {}): string {
	const region = regionFromEnv() || stored.region;
	return region && REGION_RE.test(region) ? region : DEFAULT_REGION;
}
