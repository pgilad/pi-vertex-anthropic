# Changelog

## Unreleased

### Added

- Registered the remaining adaptive-thinking Claude models on Vertex AI: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`, and `claude-opus-4-6`. All four are adaptive-only — Vertex rejects legacy `thinking.type.enabled` with HTTP 400 — so they are mapped in `ADAPTIVE_THINKING`; without that mapping every reasoning request fails. `claude-opus-5-5`, `claude-sonnet-5-5`, and `claude-fable-5-1` expose the `xhigh` slot; `claude-opus-4-6` has none and clamps `xhigh` to `high`, like Sonnet 4.6. Metadata mirrors pi-ai's registry: Opus 5.5 at `$4` / `$20` per MTok (cheaper than Opus 5), Fable 5.1 at `$10` / `$50` with a 0.25× cache read, Sonnet 5.5 at `$2` / `$10`, Opus 4.6 at Opus-tier rates. A registration-level test now fails if a non-budget model is ever added without an `ADAPTIVE_THINKING` entry.
- Registered Claude 5-generation models (`claude-sonnet-5`, `claude-opus-5`) in the model catalog with adaptive thinking support, including the `xhigh` effort slot on both. As in pi-ai's registry, pi does not offer `off` for `claude-opus-5`. Fixes an issue where invoking Claude 5 models on Vertex AI failed with HTTP 400 (`"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"`) because they were not mapped in `ADAPTIVE_THINKING` and fell through to legacy budget-based thinking.

### Changed

- **Breaking:** requires pi 1.0 or newer (peer dependencies `>=1.0.0`). pi-ai 1.0 removed `streamAnthropic` from its root entry point, so the extension now imports `@earendil-works/pi-ai/compat`, which pi's extension loader maps to its own bundled pi-ai, and streams through `anthropicMessagesApi().stream`. On pi 0.75.x–0.79.x, stay on `0.7.x`.
- `streamSimple` takes pi 1.0's normalized `TranscriptContext`, and `/login` and `refreshToken` honor pi's abort signal (pi 0.84+ requires it for `refreshToken`).
- Forwarded `onProviderStreamEvent`, `telemetryContext`, `env`, and `toolChoice` to pi-ai, as pi-ai's own Anthropic `streamSimple` does, so the `provider_stream_event` extension event works for this provider.
- Updated `@anthropic-ai/vertex-sdk` from `0.17.1` to `0.20.4`, which itself requires `@anthropic-ai/sdk` `>=0.115.1`. Updated `google-auth-library` from `9` to `10`, the major that `vertex-sdk` uses: the extension passes its own `GoogleAuth` to `AnthropicVertex`, so both must use the same copy (`11` fails the type check). `google-auth-library` 10 no longer pulls in `uuid`, so the `uuid` override is gone.

### Fixed

- Fixed pi crashing when ADC is broken (for example, a missing `GOOGLE_APPLICATION_CREDENTIALS` file). `AnthropicVertex` starts google-auth-library's `getClient()` in its constructor and awaits it only inside a request, so its rejection had no handler and Node stopped pi. Now the request fails with "Failed to acquire Google OAuth credentials." and pi keeps running. `google-auth-library`, which the extension imports, is now a declared dependency.
- Required `@anthropic-ai/sdk` `>=0.103.0 <1` as a direct dependency. `@anthropic-ai/vertex-sdk` accepts any core SDK from `0.50.3`, but it rewrites `/v1/messages` to the Vertex `:streamRawPredict` path only through the `backendMiddleware` hook that `@anthropic-ai/sdk` `0.103.0` added. With an older core SDK, every request went to `…/v1/v1/messages` and Google returned 404. `test/vertex-wire-shape.test.ts` checks the URL, for both `client.messages` and `client.beta.messages` (which pi-ai 1.0 uses).
- Corrected `claude-sonnet-4-6`'s output limit: it was registered with a 64K `max_tokens` cap while Vertex accepts 128K (`max_tokens: 128001 > 128000, which is the maximum allowed number of output tokens for claude-sonnet-4-6`). pi was therefore capping Sonnet 4.6 responses — and clamping its thinking-budget growth — at half the real limit. Now matches pi-ai's registry.

### Tests / tooling

- Development dependencies on pi `1.1.0`. `pi-coding-agent` 0.79.x pins vulnerable `undici`, `minimatch`, and `protobufjs` versions, so `npm audit` (and CI) failed; it now finds none.
- Updated the other development dependencies: TypeScript `7`, Vitest `5`, Biome `2.5.15` (configuration migrated with `biome migrate`), and `@types/node` `26`. The `test/vertex-wire-shape.test.ts` auth stub now returns a `Headers`, as `google-auth-library` 10's `getRequestHeaders()` does.

## 0.7.0 — 2026-06-18

### Fixed

- Corrected `claude-fable-5` pricing, limits, and `xhigh` routing. It was registered at Sonnet-tier cost (`$3` / `$15` per MTok, 200K context, 64K output) and clamped `xhigh` to `high`; Fable 5 is actually `$10` / `$50` per MTok with a 1M context window, 128K max output, and `xhigh` support, so pi was under-reporting Fable spend by roughly 3.3× and under-routing its highest thinking level. Now matches Anthropic/pi-ai model metadata.

### Changed

- De-flagged `claude-opus-4-8` pricing. Its cost block was annotated "provisional, modeled on Opus 4.7"; those numbers are in fact the published Opus-tier rates (`$5` / `$25`), so the placeholder caveat is gone.
- Mirrored the `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` peer dependencies into `devDependencies` so local development and CI resolve them explicitly instead of relying on npm's automatic peer install.
- Documented the `overrides.uuid` pin, and added a production-callable `resetCredentialCache()` (invoked by `/login` and by `refreshAdc` on each daily revalidation) so a long-lived process can no longer serve a stale project/region from the per-process auth cache.

### Removed

- Dropped the vestigial `claude-opus-4-6` entry from the internal `ADAPTIVE_THINKING` table. It was never a registered, selectable model, so it only desynced the table from the model catalog.

### Tests / tooling

- `tsconfig.json` now typechecks `test/**` (previously only `index.ts`). Type drift in the tests — where the `as unknown as` casts against pi-ai's types live — now fails CI instead of passing silently.
- Extracted the `SimpleStreamOptions` → `AnthropicOptions` mapping out of `streamSimple` into the exported, unit-tested `buildAnthropicOptions`.
- Added an always-on integration smoke test (no Vertex calls): it asserts provider/model registration, drives the mapped options through pi-ai's real `streamAnthropic` with a fake injected client (catching drift in the `forceAdaptiveThinking` / client-injection contract), and exercises the ADC login/refresh flow with a mocked `google-auth-library`. Plus direct tests for the project/region resolution precedence chain.

### Docs

- Clarified the relationship to pi-ai's built-in `google-vertex` provider (Gemini) versus this extension's `vertex-anthropic` (Claude), since both now appear in `pi --list-models`.

## 0.6.0 — 2026-06-16

### Changed

- Updated `@anthropic-ai/vertex-sdk` from `0.16.1` to `0.17.1`, and the development dependencies.
- Made `@earendil-works/pi-coding-agent` an optional peer dependency: the extension declares the provider types it uses instead of importing `ExtensionAPI` from it.

## 0.5.0 — 2026-06-14

### Added

- New models registered from the Vertex Model Garden catalog: `claude-opus-4-8` and `claude-fable-5`. (Both shipped in this release with provisional, sibling-modeled pricing; corrected in 0.7.0.)
- `adjustMaxTokensForThinking` helper (exported, tested) — mirrors upstream pi-ai's `providers/simple-options.js:adjustMaxTokensForThinking`. Grows `max_tokens` to absorb the thinking budget, capped at the model maximum, and shrinks the budget when even the cap can't fit a 1024-token minimum output window. Eliminates the failure mode where `--thinking high` on a small `--max-tokens` request produced a 400 from Anthropic (`budget_tokens` must be `< max_tokens`).
- Dependabot configuration (weekly `npm` and `github-actions` updates).
- GitHub Release creation in the release workflow.

### Changed

- Thinking-mode routing is now declarative. Replaced the regex-based `isAdaptiveThinkingModel` / `effortFor` with a per-model `ADAPTIVE_THINKING` table keyed by base model id (with `@DATE` version suffixes stripped before lookup). Each adaptive entry encodes its own `xhigh` slot, matching the shape of upstream pi-ai's `model.thinkingLevelMap`.
- Budget-based thinking (Haiku 4.5 and any future non-adaptive model) now goes through `adjustMaxTokensForThinking` instead of setting `thinkingBudgetTokens` directly, so `max_tokens` is grown automatically to satisfy Anthropic's `budget_tokens < max_tokens` requirement.

## 0.4.0 — 2026-05-26

### Changed

- Gated npm publish on the `npm-publish` GitHub environment.
- Expanded and proofread the README (configuration precedence, GCP/IAM setup, troubleshooting).

## 0.3.0 — 2026-05-25

### Added

- Interactive region picker at `/login`. Offers `global` (recommended), `us-east5`, `us-central1`, `europe-west1`, `europe-west4`, `asia-southeast1`. Falls through to the previous behaviour (env var → `global` default) in non-interactive contexts or on cancel. `chooseRegionAtLogin` is exported for unit testing.

### Changed

- `refreshAdc` now preserves the user's chosen region from the existing credential instead of re-resolving it. Daily refreshes never silently re-prompt or reset the region.

### Fixed

- Inject `compat.forceAdaptiveThinking` for adaptive models so Opus 4.7 / Sonnet 4.6 actually use the `effort` parameter. Without it, pi-ai's `streamAnthropic` silently fell back to legacy budget-based thinking with the default 1024-token budget, dropping the computed effort on the floor.
- `effortFor("claude-sonnet-4-6", "xhigh")` no longer returns `"xhigh"` — Sonnet 4.6's API rejects that effort value (upstream pi-ai ships no `thinkingLevelMap` for this model). It now clamps to `"high"`, matching upstream's `mapThinkingLevelToEffort` fallback.

## 0.2.0 — 2026-05-24

### Breaking

- Switched imports and peer dependencies from the deprecated `@mariozechner/*` namespace to the active `@earendil-works/*` namespace. Targets pi 0.75+. If you're still on pi 0.73.x, pin this extension to `0.1.x`.

### Unchanged

- Same public surface (provider name `vertex-anthropic`, same model catalog, same OAuth-via-ADC flow).
- The pi-mono namespace rename was a literal package rename — no API changes — so the only thing that moved is the import string.

## 0.1.0 — 2026-05-24

### Initial release

- Registers a `vertex-anthropic` provider for pi exposing Claude Opus 4.7, Sonnet 4.6, and Haiku 4.5 hosted on Google Cloud Vertex AI.
- Auth via Google Application Default Credentials through the official `@anthropic-ai/vertex-sdk` (no `gcloud` subprocess; works with gcloud user creds, service-account JSON, GCE/GKE workload identity, and metadata-server tokens).
- Streaming delegated to pi-ai's built-in `streamAnthropic` via the `client` injection point, so all message conversion, SSE parsing, tool calls, prompt caching, and thinking-block plumbing comes from upstream pi-ai unchanged.
- Adaptive thinking (Opus 4.7, Sonnet 4.6) mapped to the Anthropic SDK's `effort` parameter; extended thinking (Haiku 4.5) mapped to `thinkingBudgetTokens`.

### Compatibility note

This release targets the `@mariozechner/*` namespace (pi 0.73.x). The pi maintainer is migrating to the `@earendil-works/*` namespace starting at 0.75 — see [Upstream namespace migration](#upstream-namespace-migration) below.

## Upstream namespace migration

The pi monorepo is renaming its npm packages:

| Old namespace (deprecated, frozen at 0.73.1) | New namespace (active, 0.75.x+) |
|---|---|
| `@mariozechner/pi-coding-agent` | `@earendil-works/pi-coding-agent` |
| `@mariozechner/pi-ai` | `@earendil-works/pi-ai` |
| `@mariozechner/pi-tui` | `@earendil-works/pi-tui` |
| `@mariozechner/pi-agent-core` | `@earendil-works/pi-agent-core` |

The migration is a literal rename — same maintainer, same API shapes, same exports. This extension imports from `@mariozechner/*` because that's what current pi installs ship with (`@earendil-works/*` is unreleased on most users' setups as of 2026-05).

**When you upgrade your pi to a 0.75+ release (`@earendil-works/*`):** reinstall this extension. A version 0.2.0 will be cut that updates imports and peer deps to the new namespace. Both releases of this extension will continue to work — `0.1.x` for `@mariozechner` pi, `0.2.x+` for `@earendil-works` pi.

If you want to test against the new namespace before then, you can manually swap imports in `index.ts` (`@mariozechner/pi-ai` → `@earendil-works/pi-ai` and similarly for `pi-coding-agent`) and update `peerDependencies` in `package.json`. The code itself doesn't need any changes — the APIs are identical.
