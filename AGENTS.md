# BlockLane maintenance instructions

## Purpose

BlockLane is a public educational observatory inspired by TxStreet's transport metaphor, with an original scene and code. Keep the interface readable, attractive and accessible in French and English. Bitcoin and Ethereum are the initial networks. HEG customization and a FairOnChain link must remain optional.

Explicit user requests take precedence over this guide. Proceed autonomously with reversible actions that are already authorized. This guide does not require another confirmation for ordinary fixes.

## Architecture to preserve

- React, strict TypeScript and Vite for the interface; native Canvas 2D for individual passengers and SVG/CSS for wagons, doors, headlights, houses, text and static collective groups. Preserve pointer selection and the keyboard-accessible HTML transaction browser, without creating a DOM element per passenger.
- A read-only Node 24 HTTP API; providers and keys configured on the server.
- A shared contract validated by Zod between adapters and the interface.
- No FairOnChain access required for loading, data or animations.
- Add a chain through a documented adapter; keep its logic outside the scene.
- Introduce a service, dependency or database only for a concrete need, recorded as a decision in `docs/architecture.md`.
- Keep repository documentation in English. The interface supports French and English, initially uses the browser's language preferences, remembers an explicit choice and falls back to English. Language must not change data, animation timing or provenance.

## Data honesty

- Never silently replace a live-data failure with simulated data.
- Keep demonstration mode, valid live data, stale data and unavailability distinct.
- The scene is a limited sample; do not present it as a complete inventory.
- Respect Ethereum's distinction between `pending` and the latest confirmed block. Never invent a worldwide mempool size.
- Bitcoin blocks have no guaranteed deadline; Ethereum slots guarantee neither inclusion nor finality.
- A visible transaction, a fee estimate or an animated movement does not prove confirmation.
- Do not add wallets, signing, transaction broadcasting or investment advice to the current scope.

## Security

- Never store secrets, RPC keys, tokens or real `.env` files in Git, screenshots or tool output.
- Keys must never appear in `src/`, `VITE_*`, the public API, error messages or the bundle.
- Visitors do not choose upstream URLs. Keep a fixed route list; no arbitrary proxy route.
- Validate and bound remote data before display. Preserve timeouts, size limits, shared caching and object limits.
- Do not weaken security controls or hide a CI failure to ship a change.
- Do not run `npm audit fix --force` or migrate a major version without analyzing compatibility.
- Do not add automatic merging or deployment. Releases require explicit approval for the chosen environment.

## Change procedure

1. Read Git status and the affected files; preserve the owner's and other agents' changes.
2. Use a `codex/...` branch for a traceable proposal. Never rewrite shared history or force-push.
3. For business-logic changes, add or adapt tests that verify the actual contract: invalid payloads, failure, age, provenance, limits or user behavior. Avoid tests that merely repeat the implementation.
4. Run `npm run check` and `npm run format:check`. Run `npm run test:e2e` for interface, API or contract changes. Automated tests must not depend on real APIs.
5. Visually verify scene changes on desktop and mobile, with the keyboard and reduced motion. Respect the pause button and avoid expensive animations.
6. Run the dependency audit when the manifest, lockfile or runtime changes. Also inspect development dependencies, even when the blocking CI audit targets the runtime.
7. Document visible changes, incompatibilities, sources and limitations in the changelog. Update affected procedures.
8. Report the checks performed and remaining limitations in the PR. Avoid unrelated bulk updates.

Before publishing on GitHub, configure branch protection and required checks. A workflow file does not activate those protections by itself.

## Periodic maintenance

Review Dependabot, Node and dependency security advisories, provider contracts and reported errors. Update compatible patches first, through a verifiable PR. Keep major migrations in separate proposals with a rollback plan. Do not promise permanent maintenance when automation, account access or hosting is not active.

Prefer official sources when checking technical changes. Record decisions that change data provenance, animation semantics, the shared contract or hosting. Read `docs/maintenance.md` and `SECURITY.md` before operational work.
