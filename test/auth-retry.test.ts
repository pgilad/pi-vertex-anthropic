import { describe, expect, it } from "vitest";
import { isRetryableAuthError } from "../index.ts";

describe("isRetryableAuthError", () => {
	it("matches stale/expired credential signatures", () => {
		for (const msg of [
			"invalid_grant: Token has been expired or revoked.",
			"Could not refresh access token: invalid_rt",
			"Reauthentication is needed. Please run `gcloud auth ...`",
			"16 UNAUTHENTICATED: Request had invalid authentication credentials.",
			"Request failed with status code 401",
			"Could not load the default credentials.",
			"ADC not configured: Application Default Credentials were not found",
		]) {
			expect(isRetryableAuthError(msg), msg).toBe(true);
		}
	});

	it("does not match non-auth or permission failures", () => {
		for (const msg of [
			undefined,
			"",
			"429 Too Many Requests",
			"7 PERMISSION_DENIED: caller does not have permission",
			"Request failed with status code 403",
			"overloaded_error: the model is temporarily overloaded",
			"The model refused to complete the request",
		]) {
			expect(isRetryableAuthError(msg), String(msg)).toBe(false);
		}
	});
});
