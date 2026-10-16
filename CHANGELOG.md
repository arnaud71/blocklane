# Changelog

The project follows semantic versioning. Dates use the Europe/Zurich calendar. An entry describes version contents; public delivery is a separate operation.

## Unreleased

### French/English interface and English documentation — 16 October 2026

- Repository Markdown documentation translated fully into English, retaining historical decisions, limits, sources and validation qualifications.
- French/English interface selector, initial browser-language detection, persisted explicit preference and English fallback. Paired translations and a typed React context add no dependency; language changes affect presentation without modifying provider data, provenance or animation state. Blocked local storage does not prevent selection for the current session.
- Compact two-row mobile header keeps language, chain and source controls accessible while the information panel is open, including at 320 pixels wide. Dates, numbers, accessible descriptions and synthetic demo labels follow the selected language.

### GitHub repository preparation — 16 October 2026

- Dependency audit runs on every PR so it can become a required check without leaving ordinary changes pending.
- Generated TypeScript `*.tsbuildinfo` cache is excluded from Git. `.local` logs and this cache are also excluded from Docker context; secrets and local artifacts remain excluded.
- Dedicated public repository on arnaud71, with explicit owner authorization after protection was refused under the private plan. Main rules, required checks, dependency alerts, secret scanning/protection and private vulnerability reporting were configured before the first push.
- Initial CI completed successfully for commit `335e9af`: [quality, including browser tests](https://github.com/arnaud71/blocklane/actions/runs/38909153856), and [audit](https://github.com/arnaud71/blocklane/actions/runs/38909158417). This records publication checks, separately from later local campaigns.

### Real Bitcoin arrivals in the scene — 16 October 2026

- Bitcoin uses `track-mempool` details to reserve up to **384 real arrivals** within the **existing 1,920 pending transactions**, then fills remaining places from the node candidate or fallbacks. This mixture favors observed arrivals; it is neither a global ranking nor guaranteed GBT inclusion.
- Validated own fees and virtual size; no per-identifier HTTP call, input, script or output retained in the reserve. Stream sources/timestamps remain separate from the RPC inventory. `bitcoinArrivals` identifies only pending details actually returned.
- Reserve bounded to 384 details, fresh for sixty seconds after the latest valid consecutive delta; disconnection, sequence gap or provider loading resets it. An arrival can replace another sampled detail, retained as historical within existing budgets.
- Bitcoin's lateral “+X outside the sample” group is removed; identified Bitcoin passengers enter through the ordinary side. Ethereum's collective group and the late-discovered-inclusion station retain their rules. Removals and replacements never become confirmations.

### Bitcoin and Ethereum event streams — 16 October 2026

- Shared server-side event connection per network feeds the Flow section and lateral-entry collective groups more regularly. The panel distinguishes tracked events from the periodic observation used as fallback.
- Sources and periods dated independently of blocks, explicit initialization/interruption, deduplication and no replay on reconnection. An Ethereum pending notification is neither a first worldwide arrival nor confirmation.
- Native transports without a dependency, bounded memory/rate, idle shutdown and closure with the server. In this first stage, notifications fed collective counts without individual details. The Bitcoin evolution above later integrates them into the sample; inclusion evidence remains independent.

### Observed arrival flow — 16 October 2026

- New **Flow** section in the upper board: entries between two complete provider inventories, observed duration, average rate and roughly one-minute history. Entries and disappearances count separately; a stable pool size can hide substantial activity.
- Collective “+X outside the sample” groups at ordinary lateral entrances, separate from the network station and identified passengers. Quantity is measured and frozen at first publication of the observation; wagon places do not change.
- First observation, failure, reset and over-age data stay distinct from zero flow. No extra provider call, subscription, service or dependency; transactions appearing and disappearing between observations may remain unseen.

### Many network arrivals — 16 October 2026

- Passengers newly discovered in one block spread across four fan-shaped routes after leaving the station, with short staggered departures. The group becomes more visible without stacking everyone at one point.
- Routes stay above the queue and on the platform before meeting the wagon door. Known passengers keep their path; only actually identified transactions become individuals.
- Stagger fits within Bitcoin's three-second and Ethereum's 1.5-second preparation, reduced for late evidence. Door, light, network trails, pause and reduced motion still follow the same clock. No extra collection, capacity or representation limit.

### Contracts and head sizes — 16 October 2026

- Accessory for transactions classified as contracts becomes cyan, with outline and two dark marks, distinct from low-fee yellow t-shirts.
- Emphasized head-size differences: absolute logarithmic scale from 0.8 to 2.5 independent of neighboring transactions. Sizes remain Bitcoin vBytes or Ethereum declared gas limits; they change neither fees, places nor wagon capacity.
- Pointer selection and cache envelope adapted for large heads with the same clipping/surface limits.

### Departure preparation — 16 October 2026

- After receiving a block and inclusion evidence, the Bitcoin wagon waits at least **three animation seconds** before moving. Additions identified during that window join the same departure; the wagon waits longer if a known passage still needs to finish.
- Ethereum waits at least **1.5 animation seconds** before moving. Wagon travel durations, collection and API cache remain unchanged; pause, speed and reduced motion retain their rules. This visual delay predicts no block and establishes no finality.

### Network lighting and trails — 16 October 2026

- Network station lit while its passage is used: body, outline and nodes become luminous with a fixed halo. Lighting remains after the door closes until passage ends; no pulse or timer is added.
- Anticipatory sequence inside preparation: light, door opening, then new network passengers appear. Door stays open briefly before exit and after clearance. Known people retain visibility; no arrival anticipates received evidence.
- Longer trail only behind passengers currently leaving the network station, following route corners rather than a line cutting across the road. Drawing remains Canvas without a new element per person, limited to eight points and 110 units after projection.
- No trail for ordinary arrivals or other transactions even if they used the station previously. No trail at rest, aboard or before door opening. Pause, hidden tabs, reduced motion, capacities and inclusion evidence retain their rules.

### Compact network portal — 16 October 2026

- Compact network landmark at the upper outer edge: left for Bitcoin, right for Ethereum. Connected nodes replace the large strip and a door opens before passengers pass.
- Dedicated network exit route above the lowered active queue: these identified inclusions no longer cross waiting places or blend into ordinary side arrivals.
- Opening, passage and closing follow the existing clock with pause, hidden tabs and reduced motion. Preparation retains its normal-speed second; no extra collection, dependency or capacity.

### Rest of the network — 16 October 2026

- Mirrored “Rest of the network — outside the sample” box at the top of each platform. A transaction identified only at inclusion can emerge, cross the platform and join the upper door during the existing one-second preparation. This illustrates late discovery, not its real arrival time on the network.
- Known passengers, deferred admissions and archives retain provenance. An identifier without details creates no character. The received-block remainder is represented collectively in the wagon, excluding Bitcoin coinbase and without double-counting represented individuals.
- Inclusion catch-up transports only proven individuals without replaying the block's complete collective remainder.
- Transactions button moved to the elapsed-since-departure line, with compact “Tx” label on mobile: it no longer overlaps boxes or removes scene height.
- No extra worldwide count, provider call, API field, timer, dependency or individual budget. Pause, reduced motion and exact inclusion evidence remain applicable.

### Closing information panels

- Permanently available close button in the platform panel, separate from clearing a selection to return to statistics. Closing clears selection and returns focus to Information; refresh does not reopen it.
- Escape closes the panel after closing the transaction browser if open. Header stays visible during scrolling, with touch-friendly 44-pixel buttons. Closing also works without available data.

### Expanded current sample — 16 October 2026

- Current limit doubled from **960 to 1,920 pending transactions per blockchain**, with 24 separately reserved confirmations: response limited to **1,944 objects**. Adapters rank actually available transactions; a provider exposing fewer keeps its real count. Demonstration produces 1,920 candidates and twelve fictitious confirmations per network.
- Individual historical reserve independently fixed at **1,920**, or **3,840 ordinary residents** per network. Deferred admissions bounded to 1,920, departure to 6,272 and preparation to 10,112; server tracking retained at 4,096 identifiers, with at most 6,016 before verification/eviction. The 512-identifier archive and thirty-minute expiry remain.
- Bitcoin outside-candidate reserve raised to 384 when complete inventory is available. Recent-transaction REST fallback keeps its upstream 1,000-object bound. Native block capacities, Canvas surfaces, network caches and collection cadences remain; no additional provider call or fictitious live supplement.
- Bound, retention, median, selection and dependency tests adapted to new load; disjoint test cohorts and historical grouping verified. Benchmark now accepts `--sample-size 960` or `1920` with independent historical retention.

### Measured performance

- Reproducible local production-build benchmark with intercepted data: 960 current transactions then 1,920 historical observations per chain, verified departure and list opening. Three repetitions on desktop and emulated mobile, thread-load, long-task and responsiveness observations; no provider call during measurement.
- Reuse drawing of contiguous stationary groups without reordering walkers or changing individual clicks. Cache limited to one million pixels and sixteen surfaces per street, freed on removal/resize; individual drawing retained when allocation fails or limits are reached.
- Reuse stable queue alignments and Bitcoin-candidate membership. Time-dependent reordering, source changes, new candidates and layouts remain reassessed. Data, counts, durations, inclusion evidence and pause retain their rules.

### Ethereum predecessors

- Track predecessor nonces from the complete pool, including when fees leave them outside the 960 displayed transactions. A known unadmitted parent holds its child; nonconsecutive nonces are no longer linked as consecutive.
- Distinguish pending parent, queued parent, missing nonce, old parent now unknown and never-observed predecessor. Replacement updates dependency; only exact inclusion evidence resolves a confirmed parent. Disappearance, failure or expiry supplies no confirmation.
- Reason available in list, tooltip and details, with explicit uncertainty even aboard when predecessor was never observed. Bounded volatile tracking without a new RPC call or added characters; Ethereum remains a local selection estimate.

### Bitcoin candidate comparison

- Complete comparison of the latest observed Bitcoin candidate with its corresponding received block: common transactions, planned but absent from this block, and included outside this candidate. Non-coinbase calculation uses complete server-side lists, separate from the scene's limited details.
- Candidate frozen before block detection, tied to height/parent; comparison removed when another block lacks a comparable candidate. Sources/timestamps retained, no absence converted to current waiting or confirmation.
- Comparison section on the large Bitcoin board and detailed comparison under Block. No fictitious startup zero, invented real comparison in demonstration or extra provider call.

### Platform statuses and inspection

- Presence/inclusion status shared by list, tooltip and panel. Old individual details remain distinct from recently verified pending/queued presence; absence or replacement never means confirmation.
- “Observations” zone at the lower platform for unknown, absent-from-inventory or replaced characters. Nine active and three historical rows with independent free places and animated returns on reobservation. Passengers remain inspectable and wagon movement retains protection.
- Local full-hash or fragment search, case-insensitive, and All / Present / Deferred / Historical / Included filters in Transactions. Result count, reset and consistent selection after refresh. Filters affect the list; every character remains represented within existing retention limits.

### Fidelity to the observed mempool

- Bitcoin recovery after RPC error or incremental-budget overflow: complete baseline at the next thirty-second cycle, without another attempt in the current cycle. Five-minute incremental suspension only for exact -32601/-32602 codes; no raw error or URL logged.

- Bitcoin inventory maintained alongside GBT candidate; mixed sample bounded to 960, including up to 192 outside-candidate transactions when the complete RPC pool is available. Independent dates/sources retained.
- Pending, queued or absent inventory-presence evidence bounded to 4,096 IDs; no absence becomes confirmation. Hash normalization and duplicate-identity rejection.
- Reboarding of a recent GBT member despite old details, visual/accessible distinction between presence and old observations. Initial stock already on the platform; new-arrival staggering capped at 1.5 seconds.
- Ethereum projection tied to next parent with exact EIP-1559 base fee; account, nonce and caps retained to reassess waiting. Declared gas stays distinct from consumed gas.
- Independent expiry of pool evidence (sixty seconds) and Ethereum projection (thirty seconds). Waiting reasons in the panel, relative-fee legend and “Animation speed” label.

### Interface

- 10× speed option added to 0.5×, 1×, 2× and 5×. Shared passenger/wagon animation-clock ceiling raised to ten, raw step still limited to 100 ms before multiplication. Pause, hidden tabs and reduced motion retained; collection cadence, API cache, freshness and real elapsed time since departure unchanged. The 5× entry below retains the earlier stage.

- Bitcoin now prefers the node's `getblocktemplate` candidate. First wagon labeled “Node candidate” and reserved for known members; second remains estimated, receiving other still-eligible observations. Current sample stays limited to 960 transactions and 24 separate confirmations; known historical members may target the candidate without refreshing last observation or status. Source, date, individual-detail scope and absence of mining guarantee appear in details/accessible labels.
- Stationary first Bitcoin wagon represents the **complete candidate**: total non-coinbase transaction count, full weight expressed in vB and `weight / weightLimit` percentage. A static SVG group without invented identifiers/individual fees supplements known characters. It subtracts unique members actually present throughout the scene, including platform and arrivals, avoiding double counting. Example: 5,000 transactions, 3,992,000 WU out of 4,000,000 and 960 individual members give **5,000 TX · 99.8%**, with **4,040 grouped**. Non-interactive group, absent from preparation onward, during movement, fallback and expiry; no confirmed departure of an anonymous group. Estimated projections and real departures retain separate scopes. API, resident and Canvas-surface bounds retained.
- Complete Bitcoin-candidate median fee calculated before detail selection with independent count/source/timestamp. Even-count mean preserves half a satoshi, zero valid and empty candidate without median; proposed native amounts distinct from estimates/approximate USD conversion. Without the new optional field, declared fallback to estimated sample median. Neither mempool median nor confirmed fees; no extra provider call.
- Bitcoin candidate active for at most thirty seconds, tied to parent hash and next height. Real-time expiry even during a slow request or pause without redating transactions or collecting again; parent change, error or fallback removes selection. Announced fallback order: complete RPC pool, first mempool.space projected block, then recent transactions; ordinary estimated algorithm resumes without a candidate. Valid empty candidate distinct from unavailability. Doors, platform routes, stopping before exit, native weights, historical bounds and reduced-motion preference still apply. Candidate confirms nothing and triggers no departure: verified inclusions remain independent and may differ from the previous proposal.

- Older-observation reserve doubled to 1,920 per chain, or 2,880 ordinary residents with 960 current transactions. Departure cohort bounded to 4,352 and preparation to 7,232 transient residents, without increasing API sample, server tracking or Canvas surfaces. Thirty-minute expiry, fees, native resources and historical provenance retained; no measured smoothness gain.

- 5× speed option in playback controls, animation-clock ceiling raised to five; collection cadence/API cache unchanged.

- Reboarding observations that previously reached a projection's interior: exit before departure or under capacity pressure no longer loses candidacy at the next refresh. Return through platform/door after stopping under the same native budgets, Ethereum base fee, 960-historical limit and thirty-minute expiry. Last date, known status and clock retained; no invented current presence or confirmation. Observations lost before first boarding keep waiting on the platform.

- Small arrows above passengers removed during exits and queue returns.

- Fix passengers remaining after inclusion: exact evidence is consumed in reduced motion too without returning transactions to the queue. Old `pending` snapshots cannot reintroduce an already-departed identifier while its receipt is retained; active cohorts and reorganizations are handled separately. Ethereum matches new candidates against recent-block transactions and performs bounded background receipt catch-up checked against canonical blocks. Null responses, errors or sample absence still supply no confirmation.

- Pointer/keyboard selection restored for individual historical passengers. Tooltip/details show “last known observation,” actual available last state/date and unknown current mempool presence. Red may reflect old fees and triggers no reboarding without current observation; Ethereum waiting below base fee or without capacity is explained. One selection remains remembered if the character joins the group; reobservation or exact inclusion takes priority. Departure cohorts/collective groups remain non-interactive; no new network call or invented status.

- Waiting queue uses free platform places before overlap: thirteen spaced rows across usable height below legends, column count adapted to displayed width, places released at boarding and shared with older observations. Existing places retained and remaining ones allocated by fee to newcomers; a new reservation on wagon return if the old place is taken. Only overlapping passengers redistribute when room opens, routes reflow on resize, geometry `v18`. Sample of 960, wagons, native capacities, provenance, evidence and network limits retained.

- New expansion of 15 October 2026: current maximum doubled from **480 to 960 pending transactions per chain**, highest-fee selection and median over actually received candidates, with 24 separate reserved confirmations and response limited to 984 objects. Queue of 32 columns by thirty rows, historical indices from 1,920, geometry `v17`; observed-arrival places and boarded-passenger stability retained. Demonstration: 960 candidates and twelve fictitious confirmations, or 972 objects, with separate simulated pool count. Native capacities and wagons' 96-place visual grid retained. Appearance cache raised to 8,192 hashes; Canvas textures, surfaces and cadence unchanged. No provider call, pagination, dependency or fictitious live supplement; a smaller observation stays smaller. No measured smoothness gain. Following entries retain earlier-stage limits.

- Retain boarded passengers when they only disappear from the new sample or Bitcoin recommendation increases. Seats/wagons stable while candidates fit; fee-based reassignment only under native-capacity pressure, retaining Ethereum base fee. Up to 480 historical aboard observations for less than thirty minutes, clock/old provenance retained without fictitious status refresh. They count toward reservations/aboard counts; only verified inclusions depart. Promotion and reduced motion adapted, explanations corrected and targeted regression scenarios added.

- Local trial on 15 October 2026 of highest-fee ranking from an optional complete provider-mempool read: Bitcoin `getrawmempool(true)` through new PublicNode `BITCOIN_RPC_URL`, Ethereum `txpool_content` through existing RPC. Only top 480 returned after exact ranking. Bitcoin retains a compact table, reconciles identifiers and reads `getmempoolentry` only for newcomers; full resynchronization after ten minutes, invalidity or wrong network. Incremental failure removes public ranking; private index remains for retry until resynchronization without partial metadata. Ethereum retains complete reads because an arrival filter lacks a reliable removals, evictions and `queued` journal; compact pending candidates remain for at most thirty seconds to update effective prices. `queued` is counted separately and excluded from wagons, as are below-base-fee candidates. Observation provenance/date visible, combined Bitcoin sources stated and count tied to the same pool. Bitcoin projection/recent and Ethereum candidate fallbacks retained without invented complete ranking when a read is absent, expired, refused, invalid or oversized.

- Fix of 15 October 2026: admission/occupancy for both projections use native transaction size and available block room, replacing 96 illustrative units. Bitcoin uses vBytes against 1,000,000 vBytes; Ethereum compares declared gas limits with latest observed `gasLimit`, with `≈` estimate and unknown capacity if source is missing. Zero sizes not admitted; blob resources unmeasured. The 96-place grid remains visual without a 96-transaction limit; geometry moves to `v16`. Plate counts only native sizes of unique aboard identifiers, excluding en-route reservations. During first-wagon preparation/departure, percentage becomes `Block.used / Block.capacity` for the complete hash-linked block, including journal blocks; `N TX` stays sampled-passenger count. Scopes explained in tooltips/accessible labels, projection footers show reserved vBytes/gas and percentage, absence `—` without fallback to characters' gas limits. Percentage has one decimal, two below one percent, then `<0.01%` for smaller positive values. Sample of 480, other bounds, Canvas cache, durations, contract and API cache retained; no added receipt, call or dependency. Following entries retain replaced-budget history.
- Rear plate on both Bitcoin/Ethereum wagons in `N TX · P %` form: unique aboard identifiers and summed units divided by the illustrative 96-unit budget, rounded to integer. Outside reservations excluded, zero percent empty and same cohort during departure/promotion. Overlapping verified inclusions may exceed one hundred percent without an artificial ceiling; tooltip/accessible label distinguish real-block occupancy. Limits, cache, API and durations retained.
- Expansion of 15 October 2026: each projection doubles from 48 to **96 illustrative units**, with 96 places in eight columns/twelve rows in unchanged wagon dimensions. One-to-three-unit transaction cost retained: up to 96 one-unit passengers, or fewer depending on illustrative needs. Geometry shared with engine, `v15`; doors, clips, routes, rear count, evidence, 480 current passengers, other limits and departure Canvas cache retained. Verified inclusions may still overlap beyond places. Earlier entries below describe their then-current capacities, including the old 48-unit budget; the collective queue's 48 silhouettes remain independent.
- Lighter departures on 15 October 2026: prepared Canvas image of the complete first-wagon occupant cohort with clipping, moved with the vehicle instead of redrawing each occupant in every frame. Cache limited to one extra surface per street, one million pixels, 2,048 pixels per dimension and four pixels per logical unit; invalidation for cohort/projected appearance, clips, mirror or density changes, release after departure/unmount, complete individual fallback if creation fails. Avoid unnecessary USD labels for the non-interactive cohort and reuse rear counting. Passengers, overlap, appearance, doors and rear count retained; bodywork/lights remain SVG. Sample of 480 passengers, 48 units per projection, at least one-second preparation, 1.2-second departure/promotion, 0.7-second arrival and three-second API cache unchanged. Unvalidated optimization without profiling, benchmark or measured benefit.
- Departure preparation weakly reuses inclusion indices and resident/cohort identifier sets; avoids unnecessary copies/interpolation, retains residents when admission is full, and extracts poses only for departing occupants. Three passes and ordering retained; final boarding/evacuation check assessed only after the minimum second with the same departure requirements. Bounds, evidence and movement conditions unchanged.
- New expansion of 15 October 2026 after Canvas migration: current sample/highest-fee selection doubled from 240 to 480 pending passengers per chain. Sixteen-column, thirty-row queue in the same space, historical indices from 960 and overlap allowed; places retained during new collections. Demonstration: 480 pending and twelve fictitious confirmations, or 492 transactions per chain. Wagons' 48 units, routes, mirroring, caches and Canvas surface bounds unchanged. Earlier entries describe then-current limits.
- Migration on 15 October 2026 of individual passengers to a native transparent Canvas 2D per street without another dependency/animation loop. React retains panels/controls, SVG retains wagons, doors, lights, houses, text and static collective groups. Bounded small-surface cache for heads, torsos and icons; limbs, arrows and selection stay animated with fee colors/head sizes preserved. Colors apply directly without the old 300 ms CSS transition. View matrices, desktop projection, Bitcoin mirror, wagon transforms and clipping reproduced for drawing/pointer hit testing. Native HTML keyboard journey per street with transaction choice, details, Escape and focus without per-avatar DOM. Pixel ratio capped at two, four million pixels and 8,192 pixels per dimension; explicit Canvas-unavailable message. Engine bounds, sample, wagons, evidence, one-second preparation, three-second API cache and four-second panels retained. Migration unvalidated during suspended checks; no profiling or quantified benefit claimed.
- Optimize React/repeated calculations: reuse passenger drawing/stationary poses, memoize heads/accessories separately from gestures, share number formats, cache fee labels, retain medians per snapshot, memoize scene/campus with stable selection controls. Scene count publication spaced by at least 250 ms independently of roughly 24-frame-per-second animation. Sample of 240 passengers, 48 units per wagon, rear counts, collective queue, sources and three-second API cache retained. No profiling or gain measurement; no quantified benefit or validation claimed during suspended checks.
- Engine retains unchanged character/collection references, weak-reference path-measurement caches and archive copies only on change. React state publishes only when the visible scene changes while processing internal deadlines. `requestAnimationFrame` cancels in hidden tabs then restarts without a time jump; pause/reduced motion retained.
- Memoized displays wake through one-off freshness deadlines: USD price expires after five minutes, Ethereum count stale after thirty seconds then unmeasured after 120, with reassessment on visible-tab return. USD-label/shared-queue-scale invalidation even during API wait or stationary scene; timer/listener cleanup without extra interval or collection.
- `N TX` counter on each wagon's rear plate above red lights: unique identifiers represented aboard, retained during departure/promotion and readable from either side. Tooltip/accessible label explain sample limits; number is neither a real block total nor resource budget.
- Each projection's budget raised from twelve to 48 illustrative units with 48 places in four columns/twelve rows in unchanged wagon size. One-to-three-unit passenger cost retained: up to 48 one-unit transactions, or fewer according to illustrative needs. Geometry/engine share one constant; verified inclusions may overlap beyond places without changing 240 current passengers, archives, contracts or calls.
- Collective **provider-wide queue** below each street, on a 92-pixel row before coverage, aligned with a green central-campus strip. Exact local-view total/provenance visible with Ethereum `pending + queued` detail; never a worldwide total. At most 48 static silhouettes per chain, explicit shared `1, 2, 5 × 10ⁿ` scale from the largest displayed count and partial final group. Decorative silhouettes, accessible summary and tooltip without invented identifiers, individual fees or confirmations. Real zero, unknown count, simulation and stale observation retained; independent Ethereum-pool age respected. Sample of 240 passengers/older observations unchanged without a new call, timer, contract or dependency.
- Current sample raised from eighty to 240 pending passengers per chain. Queue widened to eight columns/thirty rows with place retention and observation overlap; desktop layout/Bitcoin mirroring retained. Demonstration expanded to 240 pending transactions and twelve fictitious confirmations per chain.

- City uses full desktop width with one central column of houses/HEG buildings, Bitcoin left and Ethereum right. Symmetrical outer columns: wagons, passage, waiting queue and arrivals from each edge; Bitcoin doors left and Ethereum doors right without pedestrian roadway routes.
- Horizontal arrivals at reserved-place height from Bitcoin's left edge and Ethereum's right edge, replacing top arrival. Shared canonical geometry/mirroring preserve text/glyph readability, arrow angles and older-observation paths.
- Logical SVG width adapts to viewport ratio, widening platform columns without overall wagon/character stretching. Three-column grid with compactable shared campus; header, scene and coverage rows shared through `subgrid` with fallback internal grid. Data states, one-second preparation, four-second panels, lights and existing queue places retained.
- Warm-white wagon headlights from departure preparation through movement; red brake lights during final thirty percent of promotion/arrival. Off at rest, phases preserved during pause, SVG halos without blinking/filter.
- Large information board always above each blockchain, in the header instead of static metrics, with a larger main value and five sections: Mempool, Median fees, Block, Value and Passengers, alternating every four seconds. The same board becomes compact with screen size and leaves SVG scenery, road and platform available; manual page selection and rotation pause. Rotation stops for global pause, reduced motion, selection, hidden tab or invalid data.
- Detail panel retained with more readable figures and four-second Network / Block / Passengers rotation. Page pace remains independent of API collection/wagon clock; blockchain polling/cache remain three seconds.
- Complete-latest-block Value section, native BTC/ETH main value and secondary `≈` USD equivalent at available spot price, independently of fee switch. Bitcoin: non-coinbase output sum including change, without net economic transfer measure. Ethereum: sum of declared `value`, excluding tokens, internal transfers and fees, potentially including failed-transaction value without receipt reads. Source/limits visible; absence/demonstration without invented real totals.
- Local mempool transaction count for the observed provider, separate from sampled passengers and any worldwide total: mempool.space count for Bitcoin, Ethereum `pending + queued` if `txpool_status` is available. Explicit simulated demonstration; absent/expired count not measured without sample fallback or fake zero.
- “Since departure” counter on a fixed line below each chain's large upper board, visible for every rotating section and independent per Bitcoin/Ethereum: real time since the latest animated departure begins, refreshed each second independently of speed/pause. `—` before first departure; reduced-motion static confirmations create no departure, catch-up animations count and the last reference survives temporary unavailability. Reset on reload or live/demonstration change; explicit simulation, not block age or countdown. No extra request/API-cache change.
- Median fees per transaction in headers/Network page: median estimated costs of pending transactions in the new snapshot only, count stated, confirmations/archives excluded, deduplicated identifiers and central-two mean for even counts. `≈` BTC/ETH per transaction or USD per transaction according to switch; `—` without a sample. Highest-fee selection is not a worldwide median; Ethereum uses declared gas limit, never consumed gas or paid fees.
- Recommended Bitcoin rate/Ethereum base fee retained as secondary Network-page details; median calculation changes no API field, ranking, color or animation.
- Shared native/USD fee control: median in BTC/ETH or dollars per transaction; `≈` estimated USD amounts in passenger details/tooltips using Bitcoin virtual size or Ethereum gas limit. Native rates remain available; sorting/colors retained.
- Price source/time visible; conversion at received price without claiming historical block price or actual paid Ethereum fees. Missing/over-age price means unavailable conversion without fictitious demonstration price or fake zero for small amounts.
- Platform queue keeps allocated places by observed arrival; new identifiers in one collection rank by descending fee for remaining places, stable identifier tie-break and animated returns.
- Small arrows align with each movement segment's real horizontal/vertical direction.
- Local API read every three seconds after live response, shared server cache three seconds after collection; one in-flight collection per chain, sequential client requests and hidden-tab suspension retained.
- Tracked presentation archive: up to 512 identifiers retained thirty minutes without proof, then untracked observations with unknown current status. Verified inclusion reserves the identifier until the right block's preparation, protected from expiry/eviction while waiting; at preparation the group shrinks and passenger is readmitted from its position.
- Sixteen-departure queue for intermediate blocks; old journal not animated on first load. Evidence received after its block departs is shown as CATCH-UP with the same hash.
- Departures require block verification; latest-block rollback/reorganization cancels incompatible queued/preparing departures while allowing already-moving vehicles to finish.
- T-shirt colors interpolate from low-fee yellow to orange at the mean and red from twice the mean, calculated separately over each chain's displayed pending passengers. Missing/zero mean gives neutral orange; Canvas updates color directly on each new observation.
- Reduced motion: evidence applied statically, including existing observations, without routes and while retaining observations.
- Previous-wagon occupants retained during departure until offscreen.
- Two successive projections as in TxStreet: next block above, following block below, priorities reassessed at rest.
- First wagon adjusted to received block's verified inclusions only before departure; non-included passengers remain on platform.
- Inclusion hash supplied by Bitcoin/Ethereum adapters, distinct from animated movement alone.
- High-fee sampling at collection: first mempool.space projected block for Bitcoin, provider `pending` block ranked before truncation for Ethereum; fallbacks announced.
- Faster candidate transfer and replacement arrival from below the screen on the passenger clock.
- First projection placed lower to free upper scene space; new transactions now arrive from outer sides.
- Step-free doors with characters drawn above them during passage.
- At least one animation second of preparation before block departure, shared deadline for exits/boarding. Fast exits capped at 500 ms; second-wagon passengers use remaining time to board after exit. Already-started exit accelerates only remaining path without returning toward the door. Late passages retain at least fifty milliseconds; every included passenger aboard and all others outside first wagon before departure, extending the stop if needed.
- Outside-sample passengers remain visually waiting on platform with last observation; visible grouping of oldest observations bounds memory.
- First projection lowered further to free upper scene space.
- “Why two wagons?” explanation under Understand and reminder in the latest-block panel.
- Layout adapted to large screens, laptops and small screens with compact bars freeing scene space.
- Bitcoin/Ethereum simultaneously visible with independent sources/connection states.
- Immersive window-filling view, two vertical streets on desktop and two compact scenes on mobile.
- Shared animation/data-mode controls, collapsible detail panel and network-bound selection.
- Educational navigation/data provenance accessible without a permanent sidebar.
- First wagon departs on a newly received block, second promotes into its place and replacement arrives from below.
- Shared bodywork color and wagons centered on the vertical road during movement.
- Symmetrical outer platforms, boarding through upper door and exit through lower platform-side door, with corresponding door openings.
- Passengers stay aboard during movement; needed exits start after arrival, returning to queue without crossing the road.
- Shared geometry between drawn wagons, doors and route engine.
- Bitcoin/Ethereum tracking bounded to 2,048 identifiers per chain for thirty minutes, at most 2,288 transient identifiers while verifying before eviction; sample disappearance confirms nothing.

### Contract and tracking

- Optional nullable `Snapshot.blockTemplate`: source, receipt timestamp, expected height, parent hash, complete non-coinbase count, weight, weight limit, optional `medianFeeSats` and at most 4,096 selected member identifiers. Complete median calculated using `BigInt` before truncation, bounded to 2,100,000,000,000,000 sat in 0.5 steps, null only for an empty candidate when supplied; omission compatible with older producers. Reserved for live Bitcoin, consistent with head/current transactions/bounds; no implicit inclusion proof. `getblocktemplate` reader uses the fallback pool's `BITCOIN_RPC_URL`, preliminary network/synchronization checks, SegWit rules, one in-flight attempt, at least fifteen seconds after completion and total eight-second budget. Response limited to 16 MiB, 30,000 transactions and four million weight units; identifier, byte, dependency and weight checks without complete consensus validation. Raw bytes/RPC URL kept outside public API; no extra dependency/storage. Empty `BITCOIN_RPC_URL` disables optional candidate/pool; mempool.space blocks/evidence, three-second HTTP cache and current response bounds retained.

- Expansion to 960 candidates: response limit **984**, durable tracking of **4,096 identifiers** for thirty minutes and transient maximum **5,056** before verification/eviction; sixteen-block journal with **4,096 total proofs**. Coordinated representation bounds: 1,920 ordinary residents, 960 deferred admissions, 960 individual old observations, 3,392 departure inclusions and 5,312 preparation residents; archive retained at 512 identifiers. Eight-block catch-up, provider limits, delays, caches and native capacities unchanged. Earlier entries below retain historical values.

- Optional nullable `Snapshot.sampling`: `{ method: 'getrawmempool' | 'txpool_content', source, observedAt, pendingCount, queuedCount?, update? }`, with Bitcoin `update: 'full' | 'incremental'` required, validated per chain and reserved for usable complete live observations. Ethereum `Snapshot.mempool` count remains separate, from `txpool_status` at its own time. New configurable Bitcoin destination disabled by empty value; no additional service/dependency/storage. Shared background collection, one per chain, at least thirty seconds after success and thirty-second complete-observation validity; dedicated 32-MiB/eight-second transport, maximum 100,000 Bitcoin transactions or 50,000 Ethereum `pending + queued`. Bitcoin: identifier inventory/sequence under eight MiB, then newcomer metadata only, maximum 500 additions per cycle, batches of 25 under 128 KiB, two concurrent batches and total eight-second budget for the whole cycle; complete resynchronization after ten minutes; error/inconsistent race removes public ranking and discards new partial metadata. Private index retained after network, HTTP, RPC, timeout or over-limit failure until ten-minute resynchronization; invalidity, wrong network, initial error, inconsistent clock or expiry clears it and forces full baseline. Sanitized diagnostics limited to failure categories/possible addition count without raw payload or secret. Latest reconciled inventory separately dated, without atomic snapshot. Failure retries spaced by thirty seconds Bitcoin, sixty seconds Ethereum or five minutes after Ethereum RPC refusal. Ordinary two-MiB HTTP limit, three-second blockchain cache and 504-transaction response retained; additional network/deserialization cost server-side.

- Expansion of 15 October 2026: maximum response raised from 264 to 504 transactions, including 480 candidates and 24 reserved confirmations. Coordinated bounds of 960 ordinary residents, 480 deferred admissions, 480 individual old observations, 1,952 departure inclusions and 2,912 preparation residents; archive retained at 512 identifiers. Durable 2,048-identifier tracking over thirty minutes retained, transient maximum 2,528 before verification/eviction; sixteen-block, 2,048-proof journal, eight-block catch-up, delays, network limits and three-second cache unchanged. No extra call or fictitious live supplement: fewer provider candidates still produce a smaller sample.
- High-fee selection raised from 96 to 240 candidates per chain and maximum response from 120 to 264 transactions with 24 reserved confirmations. Actual lower count retained when provider exposes fewer candidates; no extra provider call and shared three-second cache unchanged. Median calculated over all valid pending transactions received.

- Optional nullable `Snapshot.latestBlockValue`: exact decimal-string satoshi/wei total tied to latest-block hash, height and transaction count with explicit provenance/method. Bitcoin uses `totalOutputAmt` from mempool.space statistics; Ethereum sums every declared block value through `BigInt` before sample truncation. Inconsistency/unavailability gives `null`, without fake zero or fictitious demonstration total. No new provider, secret or dependency.
- Optional nullable `Snapshot.mempool` for Ethereum's local pool: `pending`, `queued`, millisecond `observedAt`, `ok` / `stale` state and `txpool_status` method. Counts are nonnegative safe integers; their sum must be safe and match `pendingCount`. Such observations are live-Ethereum-only.
- Optional background `txpool_status` collection shared by Ethereum adapter: one concurrent request, thirty-second delay after each attempt, 64-KiB response bound and count retained at most 120 seconds. Failure/absence of the method neither blocks nor invalidates blockchain data; interface separately checks count age. No additional provider, key, environment variable or dependency.
- Optional nullable `Snapshot.usdQuote`: positive finite bounded USD price, millisecond receipt time, Coinbase source and `ok` / `stale` state independent of blockchain status.
- Coinbase BTC/USD and ETH/USD spot prices through two fixed server URLs without a new dependency/key/environment variable: sixty-second shared cache after attempts, one concurrent request per chain, eight-second timeout, 16-KiB response limit and stale price retained at most five minutes before `null`. Background collection without extra blockchain-response waiting.
- Optional `Snapshot.inclusions` journal: verified blocks and tracked identifiers actually included, maximum sixteen blocks and 2,048 total identifiers, additional to 264 transactions/three current blocks.
- Catch-up of at most eight blocks per collection, gaps retried and journal replayed without first-visitor consumption. Hashes, heights and identifiers validated; consistent with displayed blocks at shared heights.
- Volatile tracking/journal sensitive to restarts, expiry, eviction and reorganizations; no exhaustive-history or finality promise.
- Representation limits: 240 pending passengers, normally 480 residents and 240 deferred admissions; preparation may temporarily retain 1,712 residents and up to 1,232 overlapping inclusions.

### Validation

- Checks authorized to resume on 15 October 2026; targeted passenger-retention scenarios passed, historical failures and TypeScript diagnostics recorded in `docs/validation.md`. Expansion 960/984: sixteen targeted Vitest tests and six desktop/mobile browser journeys passed, build and ESLint passed; ten preexisting TypeScript diagnostics remain without new diagnostics. Complete suites were not rerun after that expansion; no performance gain or global success claimed. Suspension notes below describe historical campaigns.

- Real manual trial of the new ranking/local application authorized on 15 October 2026 without resuming tests, lint, TypeScript, build, audit, profiling, benchmark or responsive QA. Contract, bounds, cost and fallbacks remain unvalidated; one-off observations and cases to resume recorded in `docs/validation.md`. No deployment or publication.

- Native-capacity correction, removal of the 96-transaction admission ceiling, projected percentage and complete departure-hash-linked percentage unvalidated. Tests/checks still suspended: no test written/run, validation API call, profiling, benchmark or measurement. Illustrative-unit suites need adaptation when authorized checks resume; cases recorded near the start of `docs/validation.md`.
- Wagon-plate percentage unvalidated; tests/checks still suspended without a written/run test or measurement. Cases to resume recorded in `docs/validation.md`.
- Expansion to 96 units/new wagon grid unvalidated. Tests, checks, profiling, benchmarks and validation API calls still suspended; no capacity/gain measurement claimed. Tests/fixtures based on 48 units and four columns require adaptation when authorized checks resume.
- Departure-cohort image, cache invalidation/cleanup and engine reuse unvalidated during suspended checks. No test written/run or performance measurement; previous results do not cover this change. Checks to resume recorded in `docs/validation.md`.
- Expansion to 480 passengers, 504-transaction response, grid and derived limits unvalidated. Tests/checks remain suspended: no test written/run, validation API call, benchmark, profiling or measured benefit. Old fixtures require adaptation when authorized checks resume; earlier results do not cover expansion.
- Canvas 2D migration, prepared images, clipping, matrices, hit tests, surface bounds, unavailability and HTML keyboard journey remain unvalidated. Old SVG-passenger suites/selectors require adaptation when authorized checks resume without changing tests during suspension. No benchmark, profiling or gain measurement.
- Tests, lint, TypeScript, build, audit and automatic/visual validation suspended at the owner's request. Projection capacity raised to 48 units/rear counter, lower collective queue/shared scale/states, sample extended to 240 passengers per chain, maximum 264-transaction response, new grids/representation bounds, full-width central city, symmetrical platforms, Bitcoin mirror, side arrivals, large board, four-second rotation, latest-block total, one-second preparation, Ethereum pool count, elapsed-since-departure counter, median transaction costs, USD conversion, contract, catch-up, transient bounds, archive counters, reduced motion and colors are not declared validated; earlier-version results do not cover them. Tests/fixtures based on the twelve-unit budget need adaptation when authorized checks resume. No extra real validation API call. Static reading, formatting and normal delivery preview only.

## 0.2.0 — 2026-10-14

### Added

- Routes to wagons, boarding, exit and queue return when a higher-priority transaction takes a projection place.
- Head size linked to Bitcoin virtual size or Ethereum gas limit on a stable bounded scale.
- Platform panel with Network, Block and Passengers pages, automatic rotation and details pinned by selection.
- Passengers visible aboard, animated doors, activity counts and illustrative candidate budget.
- Shared animation clock bounded to 24 frames per second, pause, speed, hidden tabs and reduced motion.
- Engine tests/browser journeys checking movement and absence of invented confirmations.

### Semantics

- Candidate boarding/returns remain educational projections. Real status comes exclusively from the source.
- The candidate wagon's twelve units are a representation budget, not network-block capacity.
- Not every confirmed transaction fits an illustrated wagon; excess remains on the observed platform.

## 0.1.0 — 2026-10-14

### Added

- Bitcoin/Ethereum observatory with an original SVG city and French interface.
- Read-only data adapters, shared validation and explicit live/demonstration modes.
- Source identification, unavailability handling and stale-data notices.
- HEG customization and optional FairOnChain link without dependence on that service.
- React, strict TypeScript, Vite and Node 24 server foundation.
- Unit/browser tests, lint, formatting, build and GitHub CI.
- Dependabot-proposed dependency updates without automatic merge.
- Unprivileged container and architecture, maintenance and security documentation.

### Initial limits

- Live data from shared public providers without availability commitment.
- Ethereum view limited to supplied `pending` block or latest confirmed block; no exhaustive worldwide mempool.
- Bounded scene sampling without predicting exact inclusion order.
- Domain, public hosting, operational secrets, alerts and repository protections to configure.
