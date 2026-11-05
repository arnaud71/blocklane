# BlockLane — HEG blockchain observatory

The scene now distinguishes the provider inventory, Bitcoin candidate and historical observations. Bitcoin pool tracking continues while GBT is active; Ethereum has a base-fee reference for the next projection and explicit waiting reasons. Animations remain a bounded representation, without claiming knowledge of a worldwide mempool or producers' private choices. See the [architecture decision](docs/architecture.md) and [verification results](docs/validation.md).

An animated city for understanding Bitcoin and Ethereum: transactions become passengers and blocks become transport. An original interpretation of the spirit of [TxStreet](https://github.com/txstreet/txstreet), with passengers drawn in native Canvas 2D, an SVG city, a French/English interface and a foundation designed for maintainability. Repository documentation is in English. The interface follows the browser's preferred languages initially, remembers an explicit language choice and falls back to English.

The Bitcoin panel also offers a **Comparison** section: the candidate observed before block detection versus the transactions actually included, with three categories and complete coverage excluding coinbase. The **Block** detail identifies sources, dates and totals. Without a valid previous candidate, the comparison remains unavailable; a planned transaction missing from that block is not declared still pending.

On Ethereum, known nonce dependencies in the complete pool remain effective even when the predecessor is outside the displayed sample. Reasons distinguish a pending parent, queued transaction, missing nonce and unknown state. Absence is not inclusion; a predecessor never observed remains an explicit limitation of the estimate. Tracking reuses data already collected, without a new RPC call.

The application starts in **live** mode. Bitcoin and Ethereum appear together in a city filling the window. The educational demonstration is a separate, visibly labeled mode. An unavailable source never triggers simulation presented as real data.

The composition uses the full desktop width: a single row of shared houses and HEG buildings in the center, Bitcoin on the left and Ethereum on the right. From each edge toward the center, the columns are **arrivals, waiting queue, movement corridor, wagons, then shared houses**. New passengers enter horizontally from the left edge for Bitcoin and the right edge for Ethereum. Doors face the outer platforms, left of Bitcoin wagons and right of Ethereum wagons; routes never cross the roadway.

Additional space widens platforms and their columns while preserving wagon and character proportions. Large information boards remain above the scenes, with shared row heights for the two networks. The campus becomes compact on smaller screens. Verification results and limitations for this layout are recorded in [docs/validation.md](docs/validation.md).

A small **Network — outside the sample** station, illustrated by connected nodes, sits at the very top of each platform's outer edge. It lights up, opens its door before new network passengers appear, and holds the door open after they pass. During preparation, these passengers reach the first wagon along a route above the queue: three seconds for Bitcoin and 1.5 seconds for Ethereum at normal speed. Their trail is reserved for this network passage. Large groups are staggered and distributed across a fan of lanes above the queue, making their number visible while retaining the same departure deadline. Ordinary arrivals remain lower down and known passengers keep their positions; block transactions without individual details remain a collective addition, excluding Bitcoin coinbase, without invented identifiers. This landmark illustrates the limits of our observation and does not measure a worldwide mempool. See the [animation rules](docs/animation.md).

In the waiting queue, passengers use free places before overlapping. Places are spaced according to platform width and released at boarding. The active queue has nine rows; an “Observations” area at the bottom of the platform has three separate rows for unknown, absent or replaced states. Existing waiting passengers keep their places; newcomers take the remaining places in descending fee order. Returning from a wagon reserves a new free place if the old one has been taken. Targeted checks and their limitations are recorded in [docs/validation.md](docs/validation.md).

The upper panels' **Flow** section prefers events received through a shared server-side connection: Bitcoin additions and Ethereum pending notifications, with measured duration, average rate and a small chart. Bitcoin now includes up to **384 real, identified arrivals within its 1,920 pending-transaction limit**, with their fees and sizes; its lateral “+X outside the sample” group has been removed. Ethereum retains that collective signal. Periodic complete inventories remain a separately named fallback. Initialization, interruption, limits and an observed zero are distinguished; an Ethereum notification may be a promotion or re-emission, without confirming inclusion or measuring worldwide traffic.

## Getting started

Requirements: Node.js **24 LTS** and npm. The 24 branch is a maintained Node release; check the [official schedule](https://nodejs.org/en/about/previous-releases) before migration.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite forwards `/api` calls to the local server on port `3001`. Provider access goes through this server; any RPC key stays out of the browser.

```sh
npm run build
npm start
```

The server then serves the built interface and API at `http://127.0.0.1:3001`. Live mode requires outbound network access to the configured providers.

## Data and scope

Bitcoin prioritizes the **candidate proposed by the node through `getblocktemplate`**: the first wagon is reserved for known members of this candidate; the second remains an estimate. A historical observation outside the candidate may enter the second wagon or wait on the platform even if the first has room. When the candidate is unavailable, both wagons return to the usual fee-and-native-capacity estimate. In estimation mode, an increased Bitcoin recommendation or disappearance from the sample alone does not remove a passenger already aboard; Ethereum retains its eligibility criterion against the observed base fee.

Up to 1,920 older observations may remain individually represented. Expiry of their candidacy after thirty minutes does not automatically remove their silhouettes from the platform: within this budget, they may remain visible longer. Those previously aboard may retain their candidacy after a temporary exit; a known Bitcoin candidate member may also board from the platform without having boarded before. These passengers carry a clock, retain their last real observation date and do not certify current mempool presence. Estimated-projection counts include them; the complete Bitcoin candidate retains its own total. Provider metrics and the median fee remain based on current observations. When a block arrives, only verified inclusions depart with it: a `getblocktemplate` proposal never supplies that proof.

An actually verified inclusion removes its passenger after departure, or immediately with reduced motion; an old `pending` response does not reintroduce it while its proof is retained. Ethereum also matches new observations against recently read blocks and progressively checks old observations through receipts, using a shared, bounded server-side budget. Proof must match the requested hash and a canonical block containing that identifier. An absent receipt leaves status unknown. Catch-up is limited to identifiers still tracked by the server; a restart loses that tracking without inventing the status of old characters retained only in the browser. Limits and checks are described in [architecture](docs/architecture.md) and [validation](docs/validation.md).

| Network  | Initial source                                           | What can honestly be shown                                                                                                                            |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin  | Replaceable mempool.space API and Bitcoin PublicNode RPC | Node candidate through `getblocktemplate` first; complete-pool, projection, then recent-transaction fallbacks; blocks and evidence from mempool.space |
| Ethereum | Replaceable public PublicNode JSON-RPC                   | Recent blocks; highest-fee `pending` pool sample through `txpool_content` when available, otherwise candidate block; optional local count             |

Public sources are shared and provide no availability guarantee here. A durable public application should use a suitable provider agreement or managed nodes. Ethereum data is **not an exhaustive worldwide mempool**: nodes have local views and some transactions use private channels. See the explanations of [Ethereum consensus](https://ethereum.org/developers/docs/consensus-mechanisms/pos/) and the [JSON-RPC contract](https://ethereum.org/developers/docs/apis/json-rpc/).

The server first requests a Bitcoin candidate through `getblocktemplate`, with SegWit rules, from the configured RPC. It returns up to **1,920 current individual details in total**, including up to **384 actual recent arrivals** received through `track-mempool`, then fills remaining places from the candidate or fallback selection. The base selection may also use independent RPC-pool details outside the candidate; prioritized arrivals can reduce the transmitted share of these other components. This mixture is not a global fee ranking. The stream reserve retains only identifier, own fee and size, without per-identifier HTTP calls or retention of inputs/outputs. It expires after sixty seconds without a validated consecutive delta and clears on disconnection or resynchronization. `bitcoinArrivals` identifies its source, timestamp and the pending identifiers actually returned, independently of the RPC observation. New passengers enter through the ordinary side entrance; a replaced detail may remain among historical observations within existing bounds.

`blockTemplate` separately retains the source, date, expected height, parent, full non-coinbase transaction count, weight, limit and complete median of proposed fees. Its selected identifiers also include members still known through bounded tracking, allowing historical passengers to be matched to the candidate. While stationary, the first wagon represents the complete candidate through these characters and a static group for the remaining transactions: no individual details are invented for this group. An arrival outside the candidate does not automatically enter the first wagon. This proposal depends on the node's view and policy; it proves neither that a mining pool is working on it nor that its transactions will be included.

This reader runs **server-side in the background**, with one in-flight attempt and at least fifteen seconds between the end of an attempt and the next. It checks the reported network, synchronization, parent, height, identifiers, dependencies and weights; it limits the response to **16 MiB**, the candidate to **30,000 transactions** and the entire attempt to **eight seconds**. Raw bytes stay server-side and are not retained for animation. These checks are not full consensus validation. A candidate must match the observed head and be at most **thirty seconds** old: after expiry, parent change, error or inconsistent response, its label is removed and the fallback is announced. The interface also enforces expiry in real time, even during a slow request or paused animation, without redating observations or adding requests. A valid empty candidate remains distinct from an unavailable candidate.

The **Bitcoin fallback** order is: highest-fee sample from the RPC's complete pool through `getrawmempool`, transactions in mempool.space's first projected block, then recent transactions from that API. The pool first loads `getrawmempool(true)`, then reconciles identifiers and retrieves metadata only for newcomers, at least thirty seconds after the previous collection finishes. Full resynchronization remains scheduled after ten minutes, invalid data or a wrong network. An incremental failure removes the public ranking and retains only the still-valid private index for retrying without downloading the entire baseline again. Fallback rankings use transactions' own fees without reproducing a producer's package-and-dependency selection. Blocks, recommended fees and inclusion evidence still come from mempool.space; these provenances are identified separately. The REST `/mempool/recent` fallback retains its limit of 1,000 validated entries and may therefore supply fewer than 1,920 details.

Ethereum retains `txpool_content` from the configured RPC: up to 1,920 candidates come from `pending` transactions eligible against the observed base fee; `queued` transactions are counted separately and do not board wagons. If this read is unusable, the declared fallback uses the provider's `pending` block. Pool collection remains in the background, with one in-flight read per reader and at least thirty seconds after completion; it does not download the pool every three seconds. Its separate transport remains limited to **32 MiB**, ordinary requests to two MiB. The Bitcoin inventory is compacted for reconciliation; Ethereum refreshes a complete read and retains its candidates for at most thirty seconds. An arrival-only filter cannot provide the removals, evictions and `queued` changes needed for a reliable complete ranking. These observations remain local, non-atomic and without a worldwide top list. Network and memory costs are bounded but unmeasured; real observations and documented checks remain available in [docs/validation.md](docs/validation.md).

The scene represents a bounded sample, not every transaction on the network. Animation illustrates mechanisms; it predicts neither the exact inclusion order nor the next block. Displayed fees are observations or estimates, never an inclusion guarantee.

Since the fix of 15 October 2026, projections use **transaction size and block capacity**, rather than a 96-unit budget. Bitcoin sums virtual sizes in vBytes against a capacity of 1,000,000 vBytes; with a node candidate, the first wagon also respects its weight limit divided by four. Ethereum sums declared gas limits against the latest observed block's `gasLimit`: a conservative estimate distinct from gas actually consumed. Missing Ethereum capacity remains unknown. The 96 drawn places, in eight columns and twelve rows, only distribute characters; they can overlap and no longer limit the number of boarded transactions.

The rear plate distinguishes scopes. With an **active Bitcoin candidate**, the first wagon shows its **complete non-coinbase count** and `100 × weight / weightLimit`; virtual size is `weight / 4`. These values describe the proposal, not a mined block. The “grouped transactions” count equals the full count minus known individually represented members throughout the scene, including those still on the platform: boarding therefore does not count them twice. A candidate with 5,000 transactions and 3,992,000 WU out of 4,000,000 WU displays **5,000 TX and 99.8%**; with 960 individually represented members, 4,040 remain grouped. Estimated projections retain **`N TX · ≈P %`**, calculated only from passengers actually aboard, excluding reservations still on the platform. During preparation and departure, the group disappears: the first wagon uses the **complete real block's** percentage, `Block.used / Block.capacity`, while its TX count remains the number of passengers with known inclusions. Tooltips and accessible labels explain these differences. Candidate fallback or expiry also removes the group and restores the estimates' earlier counts. No individual transaction, status or proof is created to complete the candidate. Verification results and limitations are recorded in [docs/validation.md](docs/validation.md).

Since the extension of 16 October 2026, each chain can display up to **1,920 waiting passengers**, previously 960. Base rankings favor high fees; the current Bitcoin selection also includes its real-arrival reserve. Up to 24 verified confirmations remain reserved separately: the response is limited to **1,944 transactions**. The queue retains adaptive columns, nine active rows and three historical rows; valid places remain stable within the same area and overlaps remain possible. A provider exposing fewer candidates produces a smaller sample without fictitious passengers added to live mode. The demonstration uses 1,920 pending transactions and twelve simulated confirmations per chain, or 1,932 transactions. The cache remains three seconds and this extension adds no provider calls. Historical retention remains fixed at **1,920 observations**, independently of the current limit: ordinary residents are bounded at **3,840**, and the archive at 512 identifiers. Native block capacities, the wagons' 96 visual places and Canvas budgets remain unchanged. Transient bounds are described in [architecture](docs/architecture.md); checks and limitations in [docs/validation.md](docs/validation.md).

Individual passengers are drawn on a **transparent Canvas 2D per street**, replacing their many SVG elements. Panels and controls remain in React; buses, doors, lights, text, houses and static collective groups remain in SVG. A bounded cache of small prepared images reuses heads, torsos and icons; limbs and arrows retain their gestures and directions. Fee colors and head sizes remain intact; colors update directly without the old 300 ms CSS transition. The same clock drives the scene, without an extra animation loop or a new dependency.

Departure also reuses a prepared image of all first-wagon occupants, with interior clipping, then moves that image with the vehicle. This avoids redrawing every boarded passenger in every departure frame. The cache adds at most one one-million-pixel surface per street, limited to 2,048 pixels per dimension; it is released after departure or unmounting. If creation fails, all occupants retain individual drawing. Platform and next-wagon passengers continue ordinary movement. Preparation of at least one second, doors and inclusion evidence retain their rules. Its validation history, subsequent checks and measurement limits are recorded in [docs/validation.md](docs/validation.md).

Selection remains available by pointer and through an HTML control for browsing transactions, choosing an identifier and displaying its details with the keyboard. Individually retained historical passengers remain selectable: their details distinguish an old observation from attested or unknown current presence. The **Transactions** button offers hash or fragment search and **Present**, **Deferred**, **Historical** and **Included** filters without hiding Canvas characters. Statuses are shared by the list, tooltip and panel. Red may reflect old fees without guaranteeing current priority. Collective groups without individual tracking remain decorative. Drawing reproduces doors, interior areas and Bitcoin mirroring; the current 1,920-passenger sample, 96-place visual grid, resident and archive bounds remain intact. Canvas resolution is capped at pixel ratio 2, four million pixels and 8,192 pixels per dimension; Canvas unavailability is explicitly reported and HTML information remains accessible.

Fee labels, number formats and medians reuse their calculations when inputs have not changed. Panel counts are sent at most every 250 ms, separately from scene movement at about 24 frames per second. One-off delays preserve USD-price and Ethereum-pool expiry even while the scene is stationary, without an additional interval or network call. The API cache remains three seconds. The initial implementation did not include profiling or a benefit measurement; subsequent controlled checks and measurements are recorded with their limits in [docs/validation.md](docs/validation.md).

The **Speed** selector offers **0.5×, 1×, 2×, 5× and 10×** for passengers and wagons. The factor accelerates their animation clock, including preparation and routes; API collection, the three-second cache, data freshness and real time since the last departure retain their pace. Pause, hidden tabs and reduced motion remain respected.

A **large information board** stays visible **above each blockchain**, in its header instead of static metrics, and changes section every **four seconds**: Mempool, Median fees, Block, Value and Passengers, with a sixth Comparison section for Bitcoin. The same board becomes compact with the screen; it leaves the SVG scenery, roadway and platform available for the scene. Sections and rotation pause remain manually accessible. Global pause, reduced motion, a selection, a hidden tab or a stale/unavailable source stops rotation; these do not turn observations into new data. The detail panel also retains selection and offers its pages at this four-second pace. Blockchain API reads and cache remain **three seconds**.

The **Value** section displays the latest block's total in **BTC or ETH**, independently of the fee switch, with a secondary approximate USD equivalent when a usable price is available. This total covers the complete block, not just sampled passengers. Bitcoin uses `totalOutputAmt` from mempool.space statistics: the sum of outputs excluding coinbase, **including change**, without measuring net economic transfer. Ethereum sums declared `value` fields of every block transaction: tokens, internal transfers and fees are excluded, and a failed transaction's value may be included because receipts are not read. Sums are retained exactly in satoshis or wei, as decimal strings calculated with `BigInt`, and tied to the latest block's hash, height and transaction count. Missing or inconsistent data displays **not measured**, never a default zero; demonstration mode receives no invented real total. The USD equivalent uses the received spot price, not a historical block price. This measure reuses existing providers without a new network service.

The **Mempool** section shows the transaction count in the **observed provider's** local view, separately from our sampled-passenger count. It does not refer to a node installed on the Mac and does not claim a worldwide total. With complete-pool Bitcoin sampling, the count and date come from the same PublicNode RPC observation; with `getblocktemplate` or a projected/recent fallback, the count comes from mempool.space. The candidate's transaction count is never used as mempool size. Ethereum retains the optional `pending + queued` count from `txpool_status`, with its own breakdown and observation time; counts from the `txpool_content` observation used for ranking remain separate in `sampling`. This read runs in the background, at most one attempt every thirty seconds after the previous attempt, without waiting for its response before serving blockchain data. During an outage, the last count is marked stale and retained for at most 120 seconds; after that, or when the method is unavailable, the value becomes **not measured**. An unknown count is never replaced with sample size or a fake zero. The demonstration distinguishes its simulated values from live data. See the [HTTP contract](docs/api.md) for fields and limits.

A **provider-wide queue** remains visible at the bottom of each street, below the scene and above its coverage notice. It collectively represents the complete supplied local count, with exact total, provenance and Ethereum's `pending + queued` breakdown. “Global” here means that provider's complete queue, never the whole network. Up to 48 small silhouettes are drawn per chain, using a shared Bitcoin/Ethereum scale chosen from `1, 2, 5 × 10ⁿ` to contain the largest displayed total; the final silhouette represents only any remainder. The scale is stated explicitly. These static groups have neither individual identifiers nor fees and do not participate in passenger routes or confirmations. A real zero displays an empty queue; an absent or expired count remains unavailable, while simulation and stale observations remain labeled. The scene retains its 1,920-passenger sample and separate older observations. This presentation reuses received data without a new API, clock or dependency. Its checks and limitations are recorded in [docs/validation.md](docs/validation.md).

T-shirts range from yellow for low fees to orange at the mean, then red from twice the mean of displayed pending passengers on the same blockchain. This mean concerns our visible sample, not the entire network.

Transactions classified as contracts carry a **cyan accessory with dark marks**, distinct from yellow t-shirts. Head-size differences are emphasized on an absolute scale bounded from 0.8 to 2.5: Bitcoin vBytes or Ethereum's declared gas limit, without changing body size or block capacity.

Wagons have warm-white headlights that switch on during preparation before departure, and red rear lights during the final part of arrival. Lights follow animation phases; pause preserves their state and reduced motion remains static.

After receiving a block, the first wagon waits for **at least three seconds of preparation for Bitcoin and 1.5 seconds for Ethereum at normal speed**. Passages and identified additions received in the meantime share this deadline: accelerated exits of at most 500 ms, then boarding within the remaining time for passengers from the second wagon. An exit already in progress accelerates from its current position without restarting the route. Departure always waits until every known inclusion is aboard and other passengers are outside the first wagon. Late evidence retains a minimum 50 ms passage and may extend the stop; pause and speed apply to this animation clock. This delay changes neither collection nor block finality.

Each chain displays **“Since departure”** on a fixed line below the large header board, regardless of the current section: real elapsed time since the start of the latest animated departure in this session. The counter advances independently of pause and speed; it is neither block age nor a countdown to the next block. It remains `—` before the first departure, including when reduced motion applies confirmations without a route. A catch-up animation also resets this counter. Temporary unavailability preserves the last known departure; reloading or switching live/demonstration resets the counter. In demonstration mode it concerns simulated departures only. This presentation adds no API request and retains the existing cache.

Headers and the Network page display **median fees per transaction** with their scope. For an active Bitcoin candidate supplying `medianFeeSats`, the server uses exact fees from **all its non-coinbase transactions**, before choosing the 1,920 characters. With an even count, the mean of the central two fees may be half a satoshi; zero remains possible, while an empty candidate has no median. “Complete candidate” identifies this count without claiming to measure the mempool median or confirmed fees. Without this aggregate, the fallback uses the median of estimated costs for current `pending` transactions only, with the count stated and confirmations/historical observations excluded. This high-fee-biased sample is not a network median; a missing metric displays `—`.

A shared control displays this median in **BTC or ETH per transaction**, or **US dollars per transaction**. The complete Bitcoin median converts exactly to its native unit, including half a satoshi; estimated sample costs and USD conversion carry `≈`. Recommended Bitcoin rates and Ethereum base fee remain available in Network-page details. In USD mode, passenger details and tooltips also give an estimated total amount. For Ethereum, calculation uses the observed gas price, including the tip when part of that price, multiplied by the declared gas limit; it represents neither actual gas consumption nor fees actually paid. Rounded adapter rates make costs approximate. Ranking and colors always use native rates.

Conversion uses a [Coinbase](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices) spot price received server-side, with visible source and time. The price has a sixty-second shared cache, separate from the three-second blockchain cache. Price collection runs in the background without waiting for its response before displaying blockchain data: on first load, conversion may remain unavailable until a later read. During an outage, a retained price remains usable for at most five minutes, then conversion becomes unavailable without substituting zero for an unknown value. Conversion uses the observed price, not the historical block price; demonstration mode receives no fictitious price. Validation history, current checks and their limitations are recorded in [docs/validation.md](docs/validation.md).

Grouped older observations retain up to 512 identifiers for thirty minutes in the interface. The server tracks up to 4,096 observed identifiers for thirty minutes and checks new blocks, with catch-up limited to eight blocks per collection. A shared journal of sixteen blocks and 4,096 total proofs recovers inclusions of retained passengers, who then leave the group for the corresponding departure. Beyond these bounds or after restart, individual tracking remains unknown; the group does not represent an exact count of transactions still pending on the network.

The server shares requests and waits at least three seconds after each collection before another can start. A last valid snapshot may be retained for up to 120 seconds, marked stale; after that the source becomes unavailable. The interface waits three seconds in live mode and five seconds in demonstration mode after each response before reading the local API again, without overlapping requests. Reads stop in hidden tabs. Collection time adds to these delays: new data every three seconds is not guaranteed. Block cadence and interface refresh frequency are separate things.

## Configuration

Variables are described in [.env.example](.env.example). Never prefix a provider key with `VITE_`: those values would be included in client code.

| Variable                    | Initial value                         | Purpose                                                                          |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `PORT`                      | `3001`                                | HTTP server port                                                                 |
| `HOST`                      | `127.0.0.1`                           | Listening interface; `0.0.0.0` inside the container                              |
| `API_RATE_LIMIT_PER_MINUTE` | `120`                                 | API request limit per client; integer from 1 to 10000                            |
| `TRUSTED_PROXY_IPS`         | Empty                                 | Comma-separated exact IP addresses of trusted reverse proxies                    |
| `BITCOIN_API_URL`           | `https://mempool.space/api`           | Bitcoin API for blocks, fees and fallback                                        |
| `BITCOIN_RPC_URL`           | `https://bitcoin-rpc.publicnode.com`  | `getblocktemplate` candidate RPC and complete-pool fallback; empty disables both |
| `ETHEREUM_RPC_URL`          | `https://ethereum-rpc.publicnode.com` | Ethereum JSON-RPC endpoint                                                       |

URLs are operator-configured, never visitor-selected. HTTPS is required for a remote provider; HTTP is accepted only for loopback addresses. A key in a URL remains a secret: protect `.env`, logs and hosting configuration.

HEG customization lives in `src/config/brand.ts`: name, text and optional FairOnChain link. The link is disabled by default. BlockLane does not depend on FairOnChain. The current visual identity is a proposal to validate before using official institutional brands or logos.

## Quality and versioning

```sh
npm run check
npm run format:check
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

`check` combines lint, strict TypeScript, unit tests and build. Browser tests cover journeys with controlled data; they do not depend on public API availability. CI repeats these checks on proposed changes. Dependabot opens weekly proposals; no automatic merge or publication is configured.

Retain `package-lock.json`, use `npm ci`, work on `codex/...` branches, use a PR and update [CHANGELOG.md](CHANGELOG.md). Versions follow SemVer; a validated release receives a `vX.Y.Z` tag. CI and `main` protection are configured in the GitHub repository; future changes pass through their required checks and a PR. Private vulnerability reporting is enabled. The initial CI run passed completely for commit `335e9af`: [quality checks, including browser tests](https://github.com/arnaud71/blocklane/actions/runs/38909153856), and [dependency audit](https://github.com/arnaud71/blocklane/actions/runs/38909158417).

## Measuring the scene locally

The benchmark uses controlled data and intercepts every API request. After installing the test tools above, run in one terminal:

```sh
npm run build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
```

Then, in a second terminal:

```sh
node --import tsx scripts/benchmark-scene.ts --label mesure-960 --sample-size 960
node --import tsx scripts/benchmark-scene.ts --label mesure-1920 --sample-size 1920
```

The script verifies counts, runs three repetitions on desktop and emulated mobile, then writes `.local/performance/<label>/report.json`. Without `--sample-size`, it uses the current 1,920 limit. Both sizes can be compared on the same build; historical retention stays separately bounded to 1,920 individuals, so larger cohorts cause eviction instead of growing this reserve. Preview on port 4173 is reserved for this test setup; ordinary live mode stays on 5173. Public APIs do not participate in measurements. Close other computational workloads and retain the same settings for comparison; results do not guarantee FPS on other devices. See [results and limitations](docs/validation.md).

## Hosting

```sh
docker compose up --build -d
```

The container listens on port `3001`, published only at `127.0.0.1:3001` on the host. It runs without privileges and with a read-only filesystem. For public access, place an HTTPS reverse proxy in front, rate-limit at the proxy, monitor the service and retain a rollback image. Do not host the site with Vite's development server.

To use USD conversion on HEG infrastructure, also allow outbound server HTTPS connections to `api.coinbase.com:443`. Both price URLs are fixed; no new environment variable, key or dependency is needed.

Set `TRUSTED_PROXY_IPS` to the proxy address actually seen by the server, and have the proxy replace `X-Real-IP`. Without this configuration, visitors behind the same proxy share the server limit. Headers from a direct visitor are not accepted as address evidence; `X-Forwarded-For` is ignored.

Initial recommendation: **a small Linux server or container platform, one Node service and replaceable data providers**. No database, Redis or blockchain infrastructure to administer initially. HEG infrastructure can host the same container. Options, tradeoffs and evolution conditions are documented in [docs/architecture.md](docs/architecture.md).

The code is public at [arnaud71/blocklane](https://github.com/arnaud71/blocklane), with protected `main` and required CI checks. Application hosting, domain, TLS, provider accounts and hosting alerts still need configuration in the chosen environment. This initial version promises no production availability.

## Maintenance

Version 0.2.0 adds wagon-bound routes, returns to the queue according to illustrative priority, heads proportional to transaction resources and a dynamic platform panel. See [animation behavior](docs/animation.md) for rules, limits and checks.

The first verification results and limitations are recorded in [docs/validation.md](docs/validation.md).

A Codex automation is registered for this chat: **Maintenance hebdomadaire BlockLane**, every Monday at **09:00, Europe/Zurich**. It checks dependencies, tests and connectors, prepares fixes for review and reports actionable changes. No automatic merging or production deployment. The Mac must be awake, the application open and the project accessible at the scheduled time.

Codex maintenance must remain traceable: inspect alerts, propose a fix on a branch, verify and present a PR. Actual periodicity depends on the automation registered in Codex; repository files do not wake the agent by themselves. Execution also depends on access to the project, tools and required accounts.

The [maintenance guide](docs/maintenance.md) describes updates, failed-source diagnosis, releases and rollback. [AGENTS.md](AGENTS.md) governs future interventions. [SECURITY.md](SECURITY.md) describes limits and vulnerability handling.

The [HTTP contract](docs/api.md) specifies routes, units, dates and availability states for future adapters and consumers.

The code and drawings in this version are original; no TxStreet code, sprites or backend are reused. Respect resource licenses and rights if external elements are added.
