# Changelog

## Unreleased

### Added

- Interactive region picker at `/login`. Offers `global` (recommended), `us-east5`, `us-central1`, `europe-west1`, `europe-west4`, `asia-southeast1`. Falls through to the previous behaviour (env var → `global` default) in non-interactive contexts or on cancel.
- `chooseRegionAtLogin` exported for unit testing.

### Changed

- `refreshAdc` now preserves the user's chosen region from the existing credential instead of re-resolving it. Daily refreshes never silently re-prompt or reset the region.

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
