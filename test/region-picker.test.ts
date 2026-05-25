import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseRegionAtLogin } from "../index.ts";

const REGION_ENVS = ["GOOGLE_CLOUD_LOCATION", "CLOUD_ML_REGION"] as const;

type OnSelect = (prompt: { message: string; options: { id: string; label: string }[] }) => Promise<string | undefined>;

function makeCallbacks(onSelect: OnSelect) {
	return {
		onAuth: vi.fn(),
		onDeviceCode: vi.fn(),
		onPrompt: vi.fn(async () => ""),
		onProgress: vi.fn(),
		onSelect: vi.fn(onSelect),
	};
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = Object.fromEntries(REGION_ENVS.map((k) => [k, process.env[k]]));
	for (const k of REGION_ENVS) delete process.env[k];
});

afterEach(() => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("chooseRegionAtLogin", () => {
	it("honors GOOGLE_CLOUD_LOCATION without prompting", async () => {
		process.env.GOOGLE_CLOUD_LOCATION = "us-east5";
		const cb = makeCallbacks(async () => "europe-west1");

		expect(await chooseRegionAtLogin(cb)).toBe("us-east5");
		expect(cb.onSelect).not.toHaveBeenCalled();
		expect(cb.onProgress).toHaveBeenCalledWith(expect.stringContaining("Region from environment: us-east5"));
	});

	it("honors CLOUD_ML_REGION fallback without prompting", async () => {
		process.env.CLOUD_ML_REGION = "asia-southeast1";
		const cb = makeCallbacks(async () => undefined);

		expect(await chooseRegionAtLogin(cb)).toBe("asia-southeast1");
		expect(cb.onSelect).not.toHaveBeenCalled();
	});

	it("returns the user's pick when env is unset and onSelect returns a valid region", async () => {
		const cb = makeCallbacks(async () => "europe-west4");

		expect(await chooseRegionAtLogin(cb)).toBe("europe-west4");
		expect(cb.onSelect).toHaveBeenCalledOnce();
		const promptArg = cb.onSelect.mock.calls[0]?.[0];
		expect(promptArg?.options.length).toBeGreaterThan(0);
		expect(promptArg?.options[0]?.id).toBe("global");
		expect(promptArg?.message).toContain("Vertex AI");
	});

	it("falls back to the default region when the user cancels (onSelect returns undefined)", async () => {
		const cb = makeCallbacks(async () => undefined);

		expect(await chooseRegionAtLogin(cb)).toBe("global");
		expect(cb.onProgress).toHaveBeenCalledWith(expect.stringContaining("Using default region: global"));
	});

	it("falls back to the default region when onSelect throws (no UI available)", async () => {
		const cb = makeCallbacks(async () => {
			throw new Error("onSelect not implemented in this mode");
		});

		expect(await chooseRegionAtLogin(cb)).toBe("global");
	});

	it("rejects malformed values from onSelect and uses the default", async () => {
		const cb = makeCallbacks(async () => "us-east5; rm -rf /");

		expect(await chooseRegionAtLogin(cb)).toBe("global");
	});

	it("offers 'global' as the first option (the recommended default)", async () => {
		const cb = makeCallbacks(async () => "global");
		await chooseRegionAtLogin(cb);

		const options = cb.onSelect.mock.calls[0]?.[0].options ?? [];
		expect(options[0]?.id).toBe("global");
		expect(options[0]?.label).toMatch(/recommended/i);
	});
});
