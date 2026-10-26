# Maintenance review — 26 October 2026

This proposal starts from `main` at `335e9af`. The owner's checkout remains clean at `5caf9d8`; the language/documentation PR #1 and clock-recovery PR #2 remain separate and open. All installations, edits and checks used temporary clones. No merge, deployment, provider replacement or global runtime change was performed.

## Security release and compatibility

Node **24.22.1**, released on **21 October 2026**, addresses security issues in the supported 24.x line, including high-severity DNS, TLS and Brotli decoder flaws. It also updates bundled Undici to 7.30.1. This is the security release announced during last week's review, rather than an unrelated major-version migration. Sources: [Node security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), [Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1).

BlockLane uses native `fetch` for configured upstreams. Malicious compressed upstream data is therefore a plausible exposure route for decoder defects; this is an inference, not evidence of exploitation or a compromised provider. Fixed server-side destinations and response limits remain in place. An npm dependency audit does not establish that the Node binary or an already built image is patched.

The project now requires **`>=24.22.1 <25`**, using its existing `engine-strict=true` npm policy. `.nvmrc` selects the tested patch, both CI workflows read that file, and all three container stages use `node:24.22.1-bookworm-slim`. The lockfile changes only its root engine requirement: no npm dependency version changes. The tag pins Node's patch version but can receive Debian rebuilds; authorized releases must still pull and record resolved image digests. Docker installation stages retain their existing npm configuration; their runtime guarantee here is the exact base tag, rather than a claim that `.npmrc` is copied into those stages.

The local default shell is still Node 20.13.1 and the bundled Codex binary is Node 24.19.0. Neither was upgraded globally. Validation used the official Node 24.22.1 macOS arm64 archive in a temporary directory, verified against the official SHA-256 checksum. With nvm, run `nvm install` and `nvm use` from the repository before installing dependencies. A prior image or running service requires its own verified update after release approval; this PR does not change the deployed runtime.

## Verification

- `npm ci` succeeded from the synchronized lockfile under Node **24.22.1** / npm **11.19.1**.
- `npm run check` passed: ESLint, TypeScript, **768 tests in 62 files** and the production build.
- `CI=1 npm run test:e2e -- --workers=2 --retries=0 --reporter=list` passed **154 browser cases in 4.2 minutes**, covering desktop and emulated mobile Chromium, keyboard access, pause, reduced motion, stale/unavailable states and explicit demonstration mode.
- Full and runtime-only npm audits of the main application report **zero known vulnerabilities**, including development dependencies in the full audit.
- An isolated negative install test ran `npm ci --offline --ignore-scripts --no-audit --no-fund` with Node **24.19.0**. It failed with **EBADENGINE** against the new floor and created no `node_modules`. No network or dependency scripts ran under that older binary. This verifies rejection of an old Node 24 installation; it is not an empirical test of the immediately preceding 24.22.0 patch.
- `docker build --pull -t blocklane-maintenance:20261026-node24.22.1 .` succeeded. An ephemeral container with `--network none`, no published host port and automatic removal reported **Node v24.22.1** and an internal **`GET /api/health` → 200**. No test container remains. The local image is arm64; no amd64 build was tested.
- The existing Vite warning above 500 kB remains visible: **524.04 kB minified / 157.47 kB gzip** JavaScript. No performance improvement is claimed.

The local validation image is `sha256:0d78b24b9da7f45e59faa3e82cbaef6817948ce7008bf8a511cd58a19f7eef05`, built from `335e9af` plus this proposal's runtime configuration changes. BuildKit resolved the base index to `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`, with arm64 manifest `sha256:294d33a992da016e059121deb0c979dffb4478b77a304376bca41393297c1ea2`. These are local validation records, not a published release image or deployment reference.

Automated tests use controlled fixtures and do not require real APIs. A separate one-off HTTP probe under Node 24.22.1 returned fresh `ok/live` snapshots for both networks: Bitcoin had ten pending details and three blocks; Ethereum had 55 pending details, 24 confirmed details and three blocks. Fee and last-block-value data were present. Ethereum's optional background mempool count was not yet available after the single read. The probe used `loadConfig({})`, an injected HTTP transport, inert event streams and no quotes or environment file. It deliberately omitted WebSockets, Bitcoin full-pool readers and GBT. This verifies bounded HTTP collection and TLS connectivity, not a complete mempool, a global fee ranking, continuous availability or stream behavior.

## Separate Sites prototype audit

The ignored Sites prototype is a separate Git project with no configured remote; it is not included in this PR or the Node container above. Its runtime-only npm audit is clear, but its full development tree initially reports **five affected packages: one high and four moderate**. The previous [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on 23 October, rather than fixed through a dependency update.

The new issues include `fast-uri` 3.1.8, with a compatible 3.1.9 patch, and `undici` 7.29.1 pinned by Miniflare. [Undici's high-severity advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c) is fixed in 7.30.1, but the Cloudflare versions checked during this review still pin the older package. Updating Node's bundled Undici does not replace this separately installed copy. A forced downgrade or unverified override was not applied. These are build/preview dependencies; the audit does not demonstrate that the published Worker is exploitable. Prototype maintenance and hosting remain separate from this PR and require their own validation before an authorized release.

HEG identity, the optional FairOnChain link, data provenance, live/demo separation, provider choices and animation timing are unchanged. No new service, package or database was introduced. Rolling back the configuration commit requires no data migration, but would again permit older vulnerable Node versions; prefer a verified newer Node 24 patch over lowering the security floor.
