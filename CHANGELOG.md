# Changelog

## Unreleased

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

## 0.5.0 — 2026-06-14

### Added

- New models registered from the Vertex Model Garden catalog: `claude-opus-4-8` and `claude-fable-5`. (Both shipped in this release with provisional, sibling-modeled pricing; corrected under Unreleased above.)
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
