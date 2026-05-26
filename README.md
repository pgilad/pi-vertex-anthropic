# pi-vertex-anthropic

[![npm version](https://img.shields.io/npm/v/@pgilad/pi-vertex-anthropic.svg)](https://www.npmjs.com/package/@pgilad/pi-vertex-anthropic)
[![license](https://img.shields.io/npm/l/@pgilad/pi-vertex-anthropic.svg)](./LICENSE)

A [pi](https://pi.dev) provider extension for Anthropic Claude models hosted on Google Cloud Vertex AI, using Google Application Default Credentials (ADC) for authentication.

Use this extension if you want to use Claude in pi with billing through GCP, no API keys, and no `gcloud` subprocess calls — auth is handled by `google-auth-library`, the same way other Google Cloud client libraries do.

## Features

- Claude Opus, Sonnet, and Haiku on Google Cloud Vertex AI.
- Application Default Credentials support: `gcloud` user credentials, service account JSON, GCE/GKE metadata server, Workload Identity, and other ADC sources.
- No Anthropic API keys in pi.
- No `gcloud` subprocess calls at request time.
- Streaming, tool calls, prompt caching, image input, and thinking support through pi-ai's built-in Anthropic pipeline.
- Interactive `/login` region picker, with environment-variable overrides for non-interactive setups.

## When to use this

Use this extension if:

- You want to use Anthropic Claude models from pi through Google Cloud Vertex AI.
- You want billing, IAM, audit logs, org policy, and quota to stay in GCP.
- You already use Application Default Credentials locally, on GCE/GKE, or with Workload Identity.
- You do not want to manage Anthropic API keys in pi.

Do not use this extension if:

- You want to call Anthropic's direct API with an Anthropic API key — use pi's built-in Anthropic provider instead.
- Your GCP project does not have Vertex AI enabled or Anthropic Claude model access granted in Model Garden.
- You need this extension to provision GCP resources or request Model Garden access for you; it only connects pi to an already-configured Vertex AI project.

## Quick start

1. Install the package:

```bash
pi install npm:@pgilad/pi-vertex-anthropic
```

2. Set up Application Default Credentials once (any of these work):

```bash
gcloud auth application-default login
# or
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# or run on GCE/GKE with an attached workload identity
```

3. Start pi, log in, and pick a model:

```bash
pi
/login          # choose "Google Vertex AI (ADC)" — prompts for region
/model          # choose vertex-anthropic/claude-opus-4-7
```

The login flow probes ADC, then prompts you to pick a Vertex AI region (`global` is the recommended default; `us-east5`, `us-central1`, `europe-west1`, `europe-west4`, `asia-southeast1` are offered). If `GOOGLE_CLOUD_LOCATION` is set in your environment, the picker is skipped and that value is used.

## Requirements

- Node.js 24 LTS or newer
- pi 0.75.x or newer (`@earendil-works/*` namespace). If you're still on pi 0.73.x (`@mariozechner/*`), pin this extension to `0.1.x`.
- A GCP project with Vertex AI enabled and Anthropic Claude models granted via [Model Garden](https://console.cloud.google.com/vertex-ai/model-garden)
- ADC configured via `gcloud` user credentials, service account JSON, the GCE/GKE metadata server, Workload Identity, or any other ADC source
- The ADC principal must have permission to call Vertex AI prediction APIs, typically via `roles/aiplatform.user` on the project

No `gcloud` CLI is required at request time. The extension only uses `gcloud` if that's how you configured ADC; pure service account or Workload Identity setups work without it.

## GCP/IAM setup

At minimum, the GCP project you use with this extension needs:

1. The Vertex AI API enabled.
2. Anthropic Claude model access granted in [Vertex AI Model Garden](https://console.cloud.google.com/vertex-ai/model-garden).
3. An ADC identity authorized to call Vertex AI prediction APIs.

For most users, granting the ADC principal the Vertex AI User role is sufficient:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="user:you@example.com" \
  --role="roles/aiplatform.user"
```

For service-account ADC, grant the role to the service account instead:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:my-service-account@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

If your organization uses custom roles or stricter IAM, make sure the principal can invoke Vertex AI publisher/model prediction endpoints for the Anthropic models you enabled.

## Compatibility

| Extension version | pi namespace |
|---|---|
| `0.1.x` | `@mariozechner/*` (pi 0.73.x) — frozen |
| `0.2.x` (current) | `@earendil-works/*` (pi 0.75.x+) |

See [CHANGELOG.md](./CHANGELOG.md) for the rename details.

## Install

The GitHub repository is `pgilad/pi-vertex-anthropic`; the published npm package is scoped as `@pgilad/pi-vertex-anthropic`.

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
| Credentials | Sources resolved by `new GoogleAuth().getClient()` — `GOOGLE_APPLICATION_CREDENTIALS`, ADC file, GCE/GKE metadata server, Workload Identity |

In most cases, `gcloud auth application-default login` is the only setup needed — the project ID is recorded in the ADC file's `quota_project_id` and `google-auth-library` finds the credentials automatically.

For explicit shell-based setup, use the extension-specific project variable plus a Vertex AI region:

```bash
export ANTHROPIC_VERTEX_PROJECT_ID=my-gcp-project
export GOOGLE_CLOUD_LOCATION=global
```

For service-account ADC:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export ANTHROPIC_VERTEX_PROJECT_ID=my-gcp-project
export GOOGLE_CLOUD_LOCATION=global
```

If you want to avoid setting `GOOGLE_CLOUD_PROJECT` globally (because it affects `gcloud`, Terraform, `bq`, and other tools), don't set it — the extension falls back to the ADC file or `ANTHROPIC_VERTEX_PROJECT_ID`.

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

## Troubleshooting

### `ADC not configured`

pi could not find usable Application Default Credentials. Configure an ADC source, then run `/login` again:

```bash
gcloud auth application-default login
# or
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### `no GCP project resolvable`

Credentials were found, but no project ID could be determined. Set an explicit project for this extension:

```bash
export ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project-id
```

Or record a quota project in your local ADC file:

```bash
gcloud auth application-default set-quota-project your-gcp-project-id
```

### Permission denied

Check that:

- Vertex AI API is enabled in the project.
- The Anthropic Claude model is enabled for the project in Model Garden.
- The ADC principal has permission to call Vertex AI prediction APIs, typically `roles/aiplatform.user`.
- You are using the intended project ID; `ANTHROPIC_VERTEX_PROJECT_ID` overrides ADC project detection.

### Model or region not found

Claude availability on Vertex AI varies by region and model, and Google/Anthropic can change regional availability independently for each model. A model that works in one region may fail in another, and newly released models may not appear everywhere at the same time.

Try the `global` region first:

```bash
export GOOGLE_CLOUD_LOCATION=global
```

If you need a specific region, confirm that the selected Claude model is available there in the current Anthropic/Vertex AI documentation. If one model fails in your region, test another registered model before assuming ADC or pi is misconfigured.

### `/login` succeeds but requests still fail

`/login` only verifies that ADC exists and stores the selected project and region in pi. Access tokens are still acquired by `google-auth-library` at request time, so request failures usually mean project, IAM, Model Garden access, quota, or region/model availability issues.

## Choosing a model

Pick interactively with `/model`, or pass on the command line:

```bash
pi --provider vertex-anthropic --model claude-opus-4-7
pi --provider vertex-anthropic --model claude-sonnet-4-6
pi --provider vertex-anthropic --model claude-haiku-4-5@20251001
```

Model IDs are taken verbatim from [Anthropic's Vertex AI docs](https://platform.claude.com/docs/en/about-claude/models/overview):

| Model | Vertex AI ID | Context | Max output | Thinking |
|---|---|---|---|---|
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | adaptive (effort) |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 64K | adaptive (effort) |
| Claude Haiku 4.5 | `claude-haiku-4-5@20251001` | 200K | 64K | extended (budget) |

pi maps thinking levels automatically:

- **Opus 4.7, Sonnet 4.6** (adaptive thinking): `--thinking low|medium|high|xhigh` becomes the SDK's `effort` parameter.
- **Haiku 4.5** (extended thinking): pi thinking levels map to `thinkingBudgetTokens` using the default budgets (1k / 4k / 10k / 20k / 32k) or your `settings.thinkingBudgets` overrides. See pi's [`thinkingBudgets` settings docs](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/settings.md#thinkingbudgets) for the exact settings shape.

## Security notes

- The extension does not store Google access tokens, refresh tokens, service-account keys, or Anthropic API keys.
- pi stores only a sentinel auth record for this provider, plus the resolved `projectId` and selected `region`, in its normal auth storage.
- Request-time Google access tokens are acquired and refreshed by `google-auth-library` through `@anthropic-ai/vertex-sdk`.
- Model requests are sent to Google Cloud Vertex AI for the configured project and region.
- No `gcloud auth print-access-token` subprocess is run per request.
- If you use `GOOGLE_APPLICATION_CREDENTIALS`, the referenced service-account JSON file remains in its configured location; this extension only relies on Google ADC resolution to find it.

## How it works

The extension is a thin shim (~200 lines):

1. **Auth.** `oauth.login` calls `new GoogleAuth().getClient()` from `google-auth-library`. If credentials are available, it stores a sentinel credential in `~/.pi/agent/auth.json` and revalidates daily via `oauth.refreshToken`. Real per-request access token refresh is handled by `google-auth-library` inside the SDK.
2. **Streaming.** `streamSimple` constructs an `AnthropicVertex` client (cached by project and region) and injects it into pi-ai's built-in `streamAnthropic` via its `client` option. All message conversion, SSE parsing, tool-call handling, prompt caching, and thinking-block plumbing come from upstream pi-ai unchanged.

No subprocess calls, no hand-rolled SSE parser, no Anthropic Messages reimplementation.

## Similar projects

- [skyfallsin/pi-vertex-anthropic](https://github.com/skyfallsin/pi-vertex-anthropic) — an earlier extension that solves the same problem. It uses `gcloud auth print-access-token` (subprocess per request) instead of `google-auth-library`, and implements its own Anthropic streaming pipeline rather than delegating to pi-ai's built-in Anthropic support.
- [SafeAI-Lab-X/ClawKeeper](https://github.com/SafeAI-Lab-X/ClawKeeper) — internal `AnthropicVertex` integration inside a broader watcher tool. The architectural pattern this extension follows (`AnthropicVertex` client injected into pi-ai's `streamAnthropic`) is adapted from `clawkeeper-watcher/src/agents/anthropic-vertex-stream.ts`.
- [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) — fork of pi-mono with a native `anthropic-vertex` provider added at the SDK layer. This is likely the cleanest long-term direction if upstream merges similar support.

## Development

```bash
npm install
npm run check    # tsc --noEmit
```

Local iteration without reinstalling:

```bash
pi -e /path/to/pi-vertex-anthropic/index.ts
```

## License

MIT
