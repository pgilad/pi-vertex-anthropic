# pi-vertex-anthropic

A [pi](https://pi.dev) provider extension that adds Anthropic Claude models hosted on Google Cloud Vertex AI, authenticated through Google Application Default Credentials (ADC).

Use this extension if you want Claude inside pi but billed through GCP, with no API keys and no `gcloud` subprocess calls — auth is handled by `google-auth-library`, the same way every other Google Cloud client library does it.

## Quick start

1. Install the package:

```bash
pi install npm:@pgilad/pi-vertex-anthropic
```

2. Set up Application Default Credentials once (any of these works):

```bash
gcloud auth application-default login
# or
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# or run on GCE/GKE with attached workload identity
```

3. Start pi, log in, pick a model:

```bash
pi
/login          # choose "Google Vertex AI (ADC)" — prompts for region
/model          # choose vertex-anthropic/claude-opus-4-7
```

The login flow probes ADC, then prompts you to pick a Vertex region (`global` is the recommended default; `us-east5`, `us-central1`, `europe-west1`, `europe-west4`, `asia-southeast1` are offered). If `GOOGLE_CLOUD_LOCATION` is set in your environment, the picker is skipped and that value is used.

## Requirements

- Node.js 24 LTS or newer
- pi 0.75.x or newer (`@earendil-works/*` namespace). If you're still on pi 0.73.x (`@mariozechner/*`), pin this extension to `0.1.x`.
- A GCP project with Vertex AI enabled and Anthropic Claude models granted via [Model Garden](https://console.cloud.google.com/vertex-ai/model-garden)
- ADC configured locally — gcloud user creds, service account JSON, GCE/GKE workload identity, or any other ADC source

No `gcloud` CLI required at request time. The extension only uses `gcloud` if that's how you configured ADC; pure service-account or workload-identity setups work without it.

## Compatibility

| Extension version | pi namespace |
|---|---|
| `0.1.x` | `@mariozechner/*` (pi 0.73.x) — frozen |
| `0.2.x` (current) | `@earendil-works/*` (pi 0.75.x+) |

See [CHANGELOG.md](./CHANGELOG.md) for the rename details.

## Install

### Global install

```bash
pi install npm:@pgilad/pi-vertex-anthropic
```

### Project-local install

Use `-l` to record the package in the current project's `.pi/settings.json` instead of your global pi settings, so it ships with the project:

```bash
pi install -l npm:@pgilad/pi-vertex-anthropic
```

### Try from a local checkout

For development against this repository:

```bash
git clone https://github.com/pgilad/pi-vertex-anthropic ~/repos/pi-vertex-anthropic
cd ~/repos/pi-vertex-anthropic && npm install
pi install ~/repos/pi-vertex-anthropic
```

## Configuration

The extension reads (in order):

| Setting | Sources |
|---|---|
| Project ID | `ANTHROPIC_VERTEX_PROJECT_ID` → `GOOGLE_CLOUD_PROJECT` → `GCLOUD_PROJECT` → `quota_project_id` field of `~/.config/gcloud/application_default_credentials.json` → `google-auth-library`'s `auth.getProjectId()` |
| Region | `GOOGLE_CLOUD_LOCATION` → `CLOUD_ML_REGION` → interactive picker at `/login` → `"global"` |
| Credentials | Whatever `new GoogleAuth().getClient()` finds — `GOOGLE_APPLICATION_CREDENTIALS`, ADC file, GCE/GKE metadata server, workload identity |

In most cases, `gcloud auth application-default login` is the only setup needed — the project ID is recorded in the ADC file's `quota_project_id` and `google-auth-library` finds the credentials automatically.

If you want to avoid setting `GOOGLE_CLOUD_PROJECT` globally (because it leaks to gcloud, terraform, bq, and other tools), don't set it — the extension falls back to the ADC file.

## Verify your setup

After `/login`, list the registered models:

```bash
pi --list-models | grep vertex-anthropic
```

Expected output:

```
vertex-anthropic  claude-haiku-4-5@20251001              200K     64K      yes       yes
vertex-anthropic  claude-opus-4-7                        1M       128K     yes       yes
vertex-anthropic  claude-sonnet-4-6                      1M       64K      yes       yes
```

Smoke test:

```bash
pi --provider vertex-anthropic --model claude-opus-4-7 --no-tools --thinking off \
   -p "Reply with exactly: smoke test passed"
```

## Choosing a model

Pick interactively with `/model`, or pass on the command line:

```bash
pi --provider vertex-anthropic --model claude-opus-4-7
pi --provider vertex-anthropic --model claude-sonnet-4-6
pi --provider vertex-anthropic --model claude-haiku-4-5@20251001
```

Model IDs are taken verbatim from [Anthropic's Vertex AI docs](https://platform.claude.com/docs/en/about-claude/models/overview):

| Model | Vertex AI ID | Context | Max out | Thinking |
|---|---|---|---|---|
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | adaptive (effort) |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 64K | adaptive (effort) |
| Claude Haiku 4.5 | `claude-haiku-4-5@20251001` | 200K | 64K | extended (budget) |

Pi thinking levels map automatically:

- **Opus 4.7, Sonnet 4.6** (adaptive thinking): `--thinking low|medium|high|xhigh` becomes the SDK's `effort` parameter.
- **Haiku 4.5** (extended thinking): pi thinking levels map to `thinkingBudgetTokens` using the default budgets (1k / 4k / 10k / 20k / 32k), or your `settings.thinkingBudgets` overrides.

## How it works

The extension is a thin shim (~200 lines):

1. **Auth.** `oauth.login` calls `new GoogleAuth().getClient()` from `google-auth-library`. If credentials are reachable, it stores a sentinel credential in `~/.pi/agent/auth.json` and re-validates daily via `oauth.refreshToken`. Real per-request access-token refresh is handled by `google-auth-library` inside the SDK.
2. **Streaming.** `streamSimple` constructs an `AnthropicVertex` client (cached by project + region) and injects it into pi-ai's built-in `streamAnthropic` via its `client` option. All message conversion, SSE parsing, tool-call handling, prompt caching, and thinking-block plumbing come from upstream pi-ai unchanged.

No subprocess calls, no hand-rolled SSE parser, no Anthropic Messages re-implementation.

## Similar projects

- [skyfallsin/pi-vertex-anthropic](https://github.com/skyfallsin/pi-vertex-anthropic) — earlier extension solving the same problem. Uses `gcloud auth print-access-token` (subprocess per request) instead of `google-auth-library`, and ships ~1000 lines because it reimplements the Anthropic streaming pipeline rather than reusing pi-ai's.
- [SafeAI-Lab-X/ClawKeeper](https://github.com/SafeAI-Lab-X/ClawKeeper) — internal `AnthropicVertex` integration inside a broader watcher tool. The architectural pattern this extension follows (`AnthropicVertex` client injected into pi-ai's `streamAnthropic`) is adapted from `clawkeeper-watcher/src/agents/anthropic-vertex-stream.ts`.
- [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) — fork of pi-mono with a native `anthropic-vertex` provider added at the SDK layer. Cleanest long-term solution if upstream merges similar support.

## Development

```bash
npm install
npm run check    # tsc --noEmit
```

Local iteration without re-installing:

```bash
pi -e /path/to/pi-vertex-anthropic/index.ts
```

## License

MIT
