# Maintenance review — 19 October 2026

This proposal starts from `main` at `335e9af`. The owner's clean checkout and the separate French/English documentation proposal (PR #1) were preserved. All edits, installations and checks used an isolated temporary clone. No release, deployment, provider replacement, secret or global runtime installation was changed.

## Clock correction and data integrity

Previously, a negative snapshot age passed the server and browser freshness checks. Moving the server clock backwards could also leave the previous refresh deadline in the future, postponing collection until the clock caught up. A rejected future observation could later reappear in the browser when its clock caught up without another successful network response.

The server now starts a new cache period after a backwards clock correction and removes the previous snapshot. An active collection remains shared across visitors; its result is rejected if it started before that correction, even if the provider dates its result with the corrected clock. A future-dated provider snapshot is rejected rather than retained for later reuse. Retry spacing after completion remains three seconds. Bitcoin and Ethereum caches remain independent.

Server observations use the server's own clock and have no allowance for future timestamps. The browser allows up to **5,000 ms** of future skew between its clock and the server, avoiding false outages for small differences. A larger lead retires the live snapshot and its active transactions, blocks and selection context. Once retired, that payload remains unavailable until a new valid response arrives; a failed request or the passage of time cannot restore it. Demonstration remains an explicit, separate mode. The 120-second age limit and the existing independent context deadlines are unchanged.

This is a deterministic edge-case correction, not a claim that a production incident occurred. Clock changes are detected through existing polling, visibility and expiration updates, not by an instantaneous operating-system clock observer. An out-of-sync browser more than five seconds behind the server can report unavailability; synchronize both clocks before diagnosing the provider. There is no new dependency, persistent storage, background service or public API field. Reverting this proposal restores the previous behavior without a data migration.

## Runtime and dependency review

The locked main application dependency tree reports **zero npm audit vulnerabilities**, including development dependencies. GitHub returned no open Dependabot alerts at review time. The manifest and lockfile are unchanged; this does not prove the absence of unpublished vulnerabilities.

Checks use the official **Node 24.22.0 LTS** distribution, downloaded into a temporary directory and verified against its official SHA-256 checksum. The project still requires `>=24 <25`; its CI and container already select Node 24. The default local shell instead resolves Node 20.13.1 and must not be used for this project. Choose Node 24 before installing or running it; this review does not change the user's shell configuration.

Node 24 enters maintenance LTS on 20 October 2026 and is scheduled for support through 30 April 2028. Node has announced a **high-severity security release on or shortly after 21 October 2026**, affecting the 24.x line among others. No fixed release or detailed impact was published at this review date. Review that release and prepare a tested Node 24 update when available; do not treat 24.22.0 as the forthcoming security fix. Sources: [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), [Node 24.22.0 release](https://nodejs.org/en/blog/release/v24.22.0), [October security release announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

The React advisory [GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) concerns `react-server-dom-*`; those packages are absent from this Vite application's locked tree. Its presence in a different project is not evidence that this application is affected.

The ignored Sites prototype is a separate project and deployment. Its previously reported `braces` advisory remains unresolved upstream; its six high-severity dependency nodes do not represent six new advisories. No unsafe downgrade or automatic audit fix was applied. Main application checks below do not validate or deploy that prototype.

## Verification

- `npm ci` completed from the unchanged lockfile with Node 24.22.0.
- `npm run check` passed: ESLint, TypeScript, **781 tests in 64 files** and the production build.
- `npm run format:check` and `git diff --check` passed.
- `CI=1 npm run test:e2e -- --workers=2 --retries=0 --reporter=list` passed **156 browser cases in 4.4 minutes**, across desktop and emulated mobile Chromium. The new case rejects future Ethereum data, advances the clock by 65 seconds during failed requests, keeps Bitcoin live, then recovers Ethereum through a keyboard retry without entering demonstration mode.
- The new regression tests exercise rejected future data, clock rollback during a shared collection, results dated again by a provider, failed recollection, recovery, chain isolation, explicit demonstration mode and the browser's five-second boundary.
- The existing Vite warning above 500 kB remains visible: the final application JavaScript is **524.28 kB minified / 157.54 kB gzip**. No performance improvement is claimed.

A separate, one-off public-provider probe succeeded for both chains: Bitcoin returned a valid live snapshot with 10 pending details and three blocks (age 52 ms); Ethereum returned 122 pending details, 24 confirmed details, three blocks and a pending projection (age 2 ms). Fee metrics were present for both. The probe used `loadConfig({})`, no real environment file, keys, quotes or sockets, and the existing injected HTTP transport. That transport deliberately skips automatic Bitcoin WebSocket/full-pool/GBT readers. This checks the HTTP adapters, not complete inventories, GBT, continuous event streams or a global fee ranking. No transaction identifiers, private configuration or upstream URLs were retained in the report.

Automated provider and browser tests use controlled fixtures, injected clocks and transports. They do not depend on public API availability. Normal-scene desktop and mobile captures were visually inspected; the new unavailable/recovery case checks status, Canvas presence and keyboard behavior without a new visual baseline. Existing browser cases cover pause and reduced motion. Mobile checks emulate a phone in Chromium; no physical-device performance or continuous upstream availability is claimed. HEG identity and FairOnChain remain optional and unchanged.

Verification logs and captures remain outside Git in the isolated temporary workspace. The first complete run exposed an older test expecting a nullable flow after rollback; its assertion now requires the stronger unavailable state and empty active data. The final runs above include that correction and the browser retention regression found during independent review. No checks were disabled or retries used to hide failures.
