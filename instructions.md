# Publishing

How to ship **@pgilad/pi-vertex-anthropic** to npm. CI handles all releases after the one-time bootstrap.

## One-time setup

1. **Push the repo to GitHub** at `pgilad/pi-vertex-anthropic`:

   ```bash
   git remote add origin git@github.com:pgilad/pi-vertex-anthropic.git
   git add -A && git commit -m "Initial commit"
   git push -u origin main
   ```

2. **First publish — manually, from your laptop**, so the package exists on npm and you can attach a trusted publisher to it:

   ```bash
   npm login                       # account: pgilad, 2FA via WebAuthn
   npm ci
   npm run lint && npm run check && npm test
   npm publish --dry-run           # sanity check — inspect the file list
   npm publish                     # uses publishConfig: access=public, provenance=true
   ```

3. **Configure npm Trusted Publisher** so CI can publish without a token:
   - https://www.npmjs.com/package/@pgilad/pi-vertex-anthropic/access → **Settings** tab
   - **Trusted Publisher** section → **Add trusted publisher**
   - Provider: **GitHub Actions**
   - Organization or user: `pgilad`
   - Repository: `pi-vertex-anthropic`
   - Workflow filename: `release.yml`
   - Environment: *(leave blank)*

4. **Verify install end-to-end:**

   ```bash
   npm view @pgilad/pi-vertex-anthropic
   pi install npm:@pgilad/pi-vertex-anthropic
   pi --list-models | grep vertex-anthropic
   ```

## Cutting a release (recurring)

1. **Update `CHANGELOG.md`** — move `## Unreleased` entries into a new dated section, leave an empty `## Unreleased` at the top:

   ```markdown
   ## Unreleased

   ## 0.2.1 — 2026-05-25

   ### Fixed
   - …
   ```

2. **Commit, bump, tag, push:**

   ```bash
   git add CHANGELOG.md
   git commit -m "docs: changelog for 0.2.1"

   npm version patch       # patch | minor | major — bumps package.json, commits, tags v0.2.1
   git push --follow-tags
   ```

3. The `v*` tag push triggers `.github/workflows/release.yml` → lint + typecheck + test + `npm publish`. Watch it in the **Actions** tab. Provenance is attached automatically via OIDC.

> Off-cycle / re-run: **Actions → Release → Run workflow** publishes from whatever branch you pick. Skips the tag step.

## Pre-publish sanity check (optional)

For risky releases, install the unpublished tarball locally before tagging:

```bash
npm ci && npm test
npm pack                  # writes pgilad-pi-vertex-anthropic-0.x.y.tgz
cd /tmp && pi install ~/repos/pi-vertex-anthropic/pgilad-pi-vertex-anthropic-*.tgz
pi --list-models | grep vertex-anthropic
```

## Rolling back

```bash
# Within 72h of publish: full unpublish (use sparingly)
npm unpublish @pgilad/pi-vertex-anthropic@0.2.1

# After 72h, or preferred default: deprecate — keeps it installable but warns
npm deprecate @pgilad/pi-vertex-anthropic@0.2.1 "Broken release, use 0.2.2"
```

Then cut a fix release following the normal flow.

## Version bumps

- **patch** (`0.2.0 → 0.2.1`): bug fixes, doc updates, internal changes
- **minor** (`0.2.0 → 0.3.0`): new features, additive behavior
- **major** (`0.2.0 → 1.0.0`): breaking — provider name, model IDs, auth flow, peer dep range

When a new pi minor ships and you've validated against it, bump `peerDependencies` in `package.json` (e.g., `">=0.75.0"` → `">=0.76.0"`) and cut a minor.
