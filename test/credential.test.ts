import { describe, expect, it } from "vitest";
import { apiKeyFromCredential, targetFromApiKey } from "../src/resolution.ts";

const CREDENTIAL = { access: "adc", refresh: "adc", expires: 0 };

describe("apiKeyFromCredential / targetFromApiKey", () => {
	it("carries the stored project and region through the API key", () => {
		const apiKey = apiKeyFromCredential({ ...CREDENTIAL, projectId: "my-gcp-project", region: "us-east5" });
		expect(targetFromApiKey(apiKey)).toEqual({ projectId: "my-gcp-project", region: "us-east5" });
	});

	it("tolerates a credential without projectId or region", () => {
		expect(targetFromApiKey(apiKeyFromCredential(CREDENTIAL))).toEqual({ projectId: undefined, region: undefined });
	});

	it("ignores fields that are not strings", () => {
		const apiKey = apiKeyFromCredential({ ...CREDENTIAL, projectId: 42, region: { id: "global" } });
		expect(targetFromApiKey(apiKey)).toEqual({ projectId: undefined, region: undefined });
	});

	it("gives an empty target for a missing key", () => {
		expect(targetFromApiKey(undefined)).toEqual({});
		expect(targetFromApiKey("")).toEqual({});
	});

	it("gives an empty target for any other key, such as one from `pi --api-key`", () => {
		expect(targetFromApiKey("adc")).toEqual({});
		expect(targetFromApiKey("sk-ant-api03-something")).toEqual({});
	});

	it("gives an empty target for malformed JSON instead of throwing", () => {
		expect(targetFromApiKey("{ this is not json")).toEqual({});
	});
});
