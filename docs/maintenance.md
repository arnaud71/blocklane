# Operations and maintenance

Automation registered on 14 October 2026: `maintenance-hebdomadaire-blocklane`, attached to the project chat and active every Monday at 09:00 (Europe/Zurich). It prepares reviewable fixes, stays quiet when there is no useful change, and neither merges nor publishes anything. For local runs, keep the computer awake and the application open.

## Responsibilities

Codex can prepare fixes, updates, tests and PRs in this project. The weekly automation must be registered in Codex to trigger this work; `AGENTS.md` and Dependabot do not wake a local agent by themselves. The computer or execution environment, permissions and required accounts must be available. This repository guarantees neither continuous maintenance nor an on-call service.

The owner retains the decision to merge and publish. Public hosting needs someone responsible for accounts, the domain, incidents and costs. A verified proposed fix is not a production release.

## Configuration after creating the remote repository

The public repository [arnaud71/blocklane](https://github.com/arnaud71/blocklane) belongs to the personal arnaud71 account, separately from onchainfinity. The owner authorized public publication on 16 October 2026 after GitHub returned HTTP 403 for branch protection under the private-repository plan. The `main` rules were active before the first code upload: no bypass actors, mandatory PRs and checks, and no force pushes or deletion. Initial branch creation is exempt only from checks that cannot yet exist; subsequent updates require current results. Automatic merging remains disabled. Dependency alerts, secret scanning, push protection and private vulnerability reporting are enabled.

The configured required checks are `Lint, types, tests, build et navigateur` and `audit`. The audit runs for every PR: a path filter would leave it pending for other changes. Require a PR, up-to-date checks, resolved conversations, no administrator bypass, no force pushes and no deletion of `main`. A sole personal-account owner uses zero mandatory formal approvals to allow review without requiring self-approval; checks and the PR remain mandatory.

1. Publish the repository and protect `main`: mandatory PRs and CI checks, no force pushes, and no deletion of the protected branch.
2. Enable Dependabot and its alerts, as well as secret detection and private reporting of secrets/vulnerabilities when the repository plan permits them.
3. Keep Actions permissions minimal; do not expose deployment secrets to PRs or forks.
4. Set the security contact in `SECURITY.md` and define who approves a release.
5. Create provider secrets and limits in the server environment; check their rotation.
6. Define the HTTPS domain, reverse-proxy limits and external probes. The proxy must replace `X-Real-IP` with the client IP it observes; declare its exact socket address in `TRUSTED_PROXY_IPS`.
7. Configure a service alert and a stale/unavailable-source alert. An HTTP 200 from the server alone does not establish data freshness.
8. Verify the Codex maintenance automation in the application and its access to the project.

Repository workflows do not configure GitHub rules automatically. The settings above were applied separately; verify that they remain in place on [GitHub](https://github.com/arnaud71/blocklane/settings/rules). Hosting remains a separate operation. The initial CI run passed completely for commit `335e9af`: [quality checks, including browser tests](https://github.com/arnaud71/blocklane/actions/runs/38909153856) completed in 7m49s, and the [dependency audit](https://github.com/arnaud71/blocklane/actions/runs/38909158417) passed.

Tests resumed at the owner's request after a temporary pause. Results and limitations for each change are recorded in [validation.md](validation.md).

## Every week

- Read security alerts, Dependabot proposals and recent CI results.
- Check availability and freshness for both chains without exposing URLs containing keys in output.
- Review official announcements from Node, affected dependencies and providers when a contract changes.
- Prepare compatible updates on a `codex/maintenance-YYYY-MM-DD` branch. A clear PR can group related fixes; keep major migrations separate.
- Run `npm run check`, `npm run format:check`, `npm run test:e2e` and the applicable audit. Reproduce data issues with controlled fixtures.
- Report only an actionable change: a vulnerability, persistent outage, verifiable update, required decision or ready fix. Stay quiet if nothing actionable has changed.

Dependabot proposes versions without merging them. The automation can prepare a PR; it must not publish an application or change secrets without the corresponding authorization.

## Every month and before a migration

Check the entire dependency tree with `npm audit`, not only runtime dependencies. Review Node support, the image operating system, pinned CI actions and bundle size. Check keyboard use, mobile, pause and reduced motion. Confirm that demonstration mode is labeled, old data is identified, and the FairOnChain link remains optional.

For a major version, read the official migration guide, propose the adaptations and test the complete user journey. Do not use `npm audit fix --force`. Document contract changes, incompatibilities and rollback. Schedule the Node migration before the chosen version reaches end of support; check the [official Node release schedule](https://nodejs.org/en/about/previous-releases).

## Diagnosing a data outage

1. Check that the service responds to `GET /api/health`, then inspect chain states in the interface or API snapshots.
2. Distinguish server liveness, upstream network access and data freshness. One chain can fail without stopping the other.
3. Check DNS, HTTPS, quotas, provider status and the presence of server-side configuration. Inspect sanitized messages; do not copy a complete RPC URL.
4. Respect the shared three-second cache after each collection. Avoid refresh loops or multiplying instances: these increase upstream calls. The short delay allows more frequent collections; deduplication applies only within one server instance.
5. Reproduce a payload change with an anonymized fixture. Never disable validation to accept an unknown payload.
6. If a key is compromised, revoke it and replace it in the hosting provider's secrets.
7. If a provider must be replaced, verify the new endpoint's contract and tests, then restart with the new configuration. The displayed source must match the actual provenance.

An upstream outage can display the last snapshot for 120 seconds with a stale status. After that, the source must be unavailable. There is no automatic switch to simulation.

## Diagnosing an unmeasured flow

The Flow panel prefers `eventFlow` when a notification period is valid. Check its state, source, epoch and independent timestamps: starting a connection is not a received zero. Ethereum notifications do not cover queued transactions and may represent promotions or re-emissions. A disconnection does not recover missed history. The `BITCOIN_EVENTS_WS_URL` and `ETHEREUM_EVENTS_WS_URL` URLs are private server-side configuration; an empty value disables the stream. Public defaults are offered only while the associated HTTP provider remains the original one. A custom provider requires explicit event-stream configuration. Never publish these URLs or their parameters.

The `poolFlow` fallback requires two successive complete inventories: reconciled `getrawmempool` for Bitcoin, or the union of pending/queued from `txpool_content` for Ethereum. The first observation is a baseline. A `txpool_status` count, GBT candidate, pending block or recent-transaction sample cannot measure arrivals across the entire observed inventory. Keep “not measured” when streams and inventories are unusable; do not infer throughput from a counter's net change.

Check `poolFlow.source`, its method, its own timestamp and both timestamps of the latest interval in the public response, without displaying private configuration. Observations retain their existing cadence of about thirty seconds after collection; the three-second HTTP cache does not make them more frequent. A failure, backward clock movement, branch reset or interval over 90 seconds requires a new baseline. Context expires after 90 seconds even if blocks keep arriving. A view distributed across multiple nodes can change its contents: state this limit instead of presenting a worldwide flow.

An event connection has eight seconds to establish; thirty seconds without a recognized message closes it. Reconnection uses exponential backoff capped at thirty seconds, with budgets preserved between attempts. One minute without a live-data read closes the stream; demo mode does not maintain these reads. Active context independently expires after fifteen seconds without publication. An oversized message, excessive rate or more than 20,000 private identifiers interrupts measurement with a reported limit; do not raise these bounds to hide a provider problem. The complete schema and bounds are documented in [architecture.md](architecture.md).

Bitcoin no longer displays a lateral collective group: check `bitcoinArrivals` and its up to 384 pending IDs actually present in the response. They occupy places within the 1,920 limit, without increasing it. The reserve comes from `track-mempool`/`mempool-transactions`, without HTTP requests per hash; only each transaction's own fee and virtual size are retained, never inputs/outputs. Its timestamp is the last validated consecutive delta and expires after sixty seconds; an HTTP read, new block or general statistic does not renew it. Also check this expiry without a new HTTP response: IDs supported exclusively by the stream must leave the active selection while retaining historical avatars/details within the existing budgets. Confirmations and independent, still-fresh RPC/GBT evidence remain usable. A disconnection, loading state or sequence discontinuity must clear it. Compare its source/timestamp with the RPC inventory without merging them: an arrival observed elsewhere is not declared present in that inventory. The final mixture is neither a global fee ranking nor proof of GBT inclusion.

Ethereum's lateral collective group remains a signal outside the pending selection when the batch is first displayed; it does not count historical avatars or enter a wagon. Do not confuse it with newly discovered inclusions from the upper network station. A stable individual sample does not establish the absence of new transactions. A Bitcoin passenger displaced from the selection may remain among older observations within the existing bounds; removal or replacement must not change its status to confirmed.

## Diagnosing an unavailable USD conversion

The price has its own provenance and freshness, independent of the blockchain. A chain can remain live with `usdQuote: null`; native fees remain available. Inspect the Coinbase source, receipt time and price status without treating this failure as a Bitcoin or Ethereum outage. Renewal runs in the background: a first response without a price may be followed by one containing a price, without blocking blockchain data.

The only destinations are the fixed BTC/USD and ETH/USD spot routes at `api.coinbase.com`. For HEG, allow DNS and outbound HTTPS to `api.coinbase.com:443` if USD display is wanted. No secret, environment parameter or visitor-selected provider is added. Respect the sixty-second price cache after each attempt, separate from the three-second blockchain cache; a restart clears caches and multiple instances multiply reads.

A price request is limited to eight seconds and 16 KiB. An old price may be retained for at most five minutes after receipt, marked stale, after which conversion becomes unavailable. Do not disable these limits, invent a demonstration price or substitute zero. The Ethereum total remains an estimate using the declared gas limit, not the paid cost; the observed price is not the price at the historical block. If the payload changes, update a controlled fixture and the contract, then run the applicable validation checks. [Coinbase documentation](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices).

## Verified release

1. Start from a reviewed commit with passing CI and a clean workspace. Check the changelog and the `package.json`/lockfile version.
2. Run the required checks and build from the lockfile using `npm ci`. Browser tests use controlled data; supplement them with a live, read-only provider check before publication.
3. Build the container image and record the commit, Node version, resolved base-image digest and produced-image digest. The `node:24-bookworm-slim` base tag receives updates; retain release digests for operational reproducibility.
4. Run the image in a staging environment with the same non-secret variables. Check health, both chains, stale snapshots, errors, static files and operation without FairOnChain.
5. Retain the currently deployed image and a protected configuration export, without writing secrets into Git.
6. Present the version and verification to the owner; deploy only with the appropriate authorization.
7. After release, check the HTTPS domain, sources, proxy limits and alerts. Create the SemVer tag and release matching exactly the delivered commit.

This version has no automatic deployment job. Add a delivery pipeline only after the hosting destination and validation rules have been chosen.

## Local container

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 blocklane
docker compose down
```

The host port is published only on `127.0.0.1:3001`. HTTPS and domain publication belong at the reverse proxy. `HOST=0.0.0.0` is set inside the container; it does not publish the port on every host interface. `.env` variables also provide Compose interpolation; keep that file private.

`TRUSTED_PROXY_IPS` is a comma-separated list of exact IPv4/IPv6 addresses, limited to 64 entries and without CIDR. With a host-side proxy, the address observed from the container may be a Docker gateway rather than `127.0.0.1`. Verify the topology before declaring trust. Incorrect configuration groups visitors under the proxy's quota or allows impersonation of another client's quota. `API_RATE_LIMIT_PER_MINUTE` accepts an integer from 1 to 10000, defaulting to 120; increasing it does not replace reverse-proxy controls.

The cache needs no backup. Back up the remote repository, operational configurations and published-image references. Secrets belong in a vault or the hosting provider's protected mechanisms.

## Rollback

Redeploy the previous image by digest with compatible configuration, then check health and data provenance. With Compose, replace the service image with the previous reference in an operations file, then run `docker compose up -d`; do not rebuild an old floating tag hoping to recover the same artifact.

In-memory state may be lost without a migration. If a future version adds a database or changes a durable contract, its migration and rollback plan becomes a release prerequisite. Document the cause and fix after the incident.

## Initial CI action references

Actions are pinned to full commits verified against their official releases on 14 October 2026: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) and [upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Dependabot proposes updates. Check the release, permissions and required runtime when changing a pin; use a maintained runner.
