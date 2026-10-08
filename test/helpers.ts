import type { Api, Model } from "@earendil-works/pi-ai/compat";
import extension from "../index.ts";

// Provider config is read structurally in these tests (noExplicitAny is off in biome.json).
export type ProviderConfig = any;

/** Run the extension factory and return what it registered. */
export function register(): { name: string; config: ProviderConfig } {
	let captured: { name: string; config: ProviderConfig } | undefined;
	extension({
		registerProvider: (name: string, config: ProviderConfig) => {
			captured = { name, config };
		},
	} as unknown as Parameters<typeof extension>[0]);
	if (!captured) throw new Error("registerProvider was not called");
	return captured;
}

/**
 * A registered model as pi hands it to streamSimple: pi copies the definition
 * and adds the provider's api, provider id, and baseUrl.
 */
export function registeredModel(id: string, config: ProviderConfig = register().config): Model<Api> {
	const definition = config.models.find((m: { id: string }) => m.id === id);
	if (!definition) throw new Error(`model ${id} not registered`);
	return { ...definition, api: config.api, provider: "vertex-anthropic", baseUrl: config.baseUrl } as Model<Api>;
}

export function registeredModelIds(): string[] {
	return register().config.models.map((m: { id: string }) => m.id);
}
