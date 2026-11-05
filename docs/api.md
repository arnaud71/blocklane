# Read-only HTTP contract

The API is served on the same origin as the interface. No route signs, broadcasts or modifies a transaction. The schema in `shared/model.ts` is the executable reference.

## Language and presentation

French and English are interface preferences only. Switching language changes labels, explanatory text and localized number/date formatting; it does not change API requests, field names, enum values, units, source data, timestamps or transaction selection. Consumers must interpret the normalized fields rather than depend on the language of `coverage` or `message`. Public source labels and transaction values remain provider data; the interface may translate a known “amount not provided” placeholder without inventing an amount.

## Observed notifications — `eventFlow`

An optional nullable field for live snapshots that are available or stale: `{ source, method, state, epoch, startedAt, observedAt, lastMessageAt, history }`. `method` is `mempool-transactions` for the current Bitcoin flow and `newPendingTransactions` for Ethereum; the previous Bitcoin value `mempool-txids` remains accepted for compatibility. Subscription URLs and identifiers are never public. `observedAt` timestamps the latest published batch or state change; `lastMessageAt` retains the reception time of a recognized frame, which does not automatically count as a transaction. These clocks are independent of the block observation and may be later than it, without changing its timestamp.

`state` distinguishes `disabled`, `connecting`, `warming`, `live`, `interrupted` and `limited`. `startedAt` and `lastMessageAt` may be null outside a validated period. `epoch` changes when a new period starts, including after reconnection or interrupted reads. `live` requires at least one measured interval. Initialization, an interruption and an exceeded limit never mean zero notifications received.

Points in `history` contain `{ fromObservedAt, observedAt, enteredCount, outsideSampleEnteredCount }`. Each interval covers three to fifteen seconds; retained intervals are continuous and end at the context timestamp. At most twelve points ending within the previous sixty seconds are published, and every count is limited to 20,000. The partition outside the pending selection is calculated and frozen when the batch is first displayed; unknown remains `null`. Identifier arrays remain private and bounded. Another visitor or a new selection neither replays nor repartitions the same batch.

This context contains no mempool total and does not replace `poolFlow`. Bitcoin additions come from mempool.space's view; Ethereum notifications may include promotions and repeated notifications. Silence establishes no disappearance, and no notification proves confirmation. Covered periods are not added to another provider's periods as if their views were identical. The browser stops using an active context after fifteen seconds without a new publication, or thirty seconds without a recognized message, retaining its original timestamps.

## Individual Bitcoin arrivals — `bitcoinArrivals`

An optional nullable field for Bitcoin live snapshots that are available or stale: `{ source, method: 'mempool-transactions', observedAt, transactionIds }`. `source` is a label of 1 to 100 characters. `observedAt` timestamps the latest validated consecutive delta, including an empty one, rather than the transactions' first broadcast; it cannot exceed the snapshot timestamp and is at most sixty seconds old. Cache reads do not refresh it. On browser expiry, details supported only by this flow leave the active sample and may remain among the Canvas's historical observations; confirmations and details still supported by fresh RPC presence or fresh GBT membership are retained. Bitcoin identifiers are unique, canonical, limited to **384**, and present among the `pending` details in `Snapshot.transactions`; this context creates no confirmed status.

The reserve is included in the **1,920 pending** limit, rather than adding another 384 places: priority arrivals are followed by the GBT base selection or fallbacks, without duplicates. Individual fees and sizes are validated from objects added by the stream, without HTTP calls per identifier. Raw data, scripts, inputs and outputs are not retained. An entry without usable fees or size is rejected, without inventing a rate. An arrival may replace another detail, which may be retained as an old observation under the existing budgets.

Source and timestamp are independent of `sampling` and `poolObservation`: this flow may observe an arrival absent from the latest RPC inventory, without claiming it is present there. Removals, mining and replacements remove details from the reserve; only exact block evidence establishes inclusion. Interruption, resynchronization, a sequence gap or ageing remove this provenance. The mixture is neither a global fee ranking nor a guarantee of GBT membership or future inclusion. The lateral Bitcoin collective group is removed; Flow counters and the Ethereum collective retain their separate scopes.

Sources: [mempool.space protocol](https://mempool.space/docs/api/websocket), [delta objects](https://github.com/mempool/mempool/blob/master/backend/src/mempool.interfaces.ts#L97-L103), [virtual size in the official compact format](https://github.com/mempool/mempool/blob/master/backend/src/api/common.ts#L749-L758).

## Flow between inventories — `poolFlow`

An optional nullable field for live snapshots that are available or stale: `{ source, method, observedAt, inventoryCount, state, history }`. `method` is `getrawmempool` for Bitcoin or `txpool_content` for Ethereum. Its own timestamp is that of the latest validated complete inventory, never the cache read; it cannot exceed the snapshot timestamp. This context may exist independently of a usable block candidate. It contains no individual identifiers.

`state: warming` and `history: []` indicate an initial baseline, not zero flow. `state: ready` requires at least one point. Each point contains `{ fromObservedAt, observedAt, previousCount, currentCount, enteredCount, disappearedCount, outsideSampleEnteredCount }`. The two timestamps are strictly increasing and at most 90 seconds apart. Counts satisfy `currentCount = previousCount + enteredCount - disappearedCount`. Arrivals are identifiers present at the end and absent at the beginning, independently of disappearances; they do not necessarily mean a first arrival on the network.

`outsideSampleEnteredCount` is nullable until the interval has been published with a final pending selection. It is then frozen on the first server publication and lies between zero and `enteredCount`. It does not describe all transactions currently outside the selection or a confirmed population. The initial selection, later rank changes and identical polls create no new measured arrivals.

History is continuous and limited to twelve points ending within the sixty seconds before `poolFlow.observedAt`, with at most 100,000 identifiers per Bitcoin inventory and 50,000 for Ethereum. The last point ends exactly at `observedAt` and `inventoryCount`. Ethereum compares the pending/queued union, without counting a category change as an arrival. A failure, reset or interruption longer than 90 seconds requires a new baseline; the flow expires after 90 seconds in the cache and browser. Missing flow never means zero. Transactions that appear and disappear between observations may be missed; a disappearance proves no confirmation.

## Ethereum dependencies — `ethereumDependencies`

This optional nullable field describes the provider's known nonce constraints for tracked identifiers, independently of the top 1,920 selection. It is restricted to Ethereum live snapshots that are available or stale. It contains `{ source, observedAt, parentBlockHash, height, entries }`: the `txpool_content` observation's own timestamp, the hash of `blocks[0]` and the next height. Source and timestamp match `sampling` and `poolObservation`. The pool used for this context is anchored to the head and branch generation at the start of its collection; a new head requires a new compatible observation, without bringing forward its periodic collection.

Each entry contains `{ transactionId, from, nonce, predecessor }`. The address is normalized and nonces are canonical decimal strings of unsigned 256-bit integers. The `predecessor.state` discriminator describes the available knowledge:

| State                | Additional fields                                    | Meaning                                                                            |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `root`               | None                                                 | Child has nonce zero                                                               |
| `unobserved`         | `nonce`                                              | Predecessor never observed; an uncertain projection is allowed for a pending child |
| `gap`                | `nonce`                                              | Immediately preceding nonce missing with lower nonce context known                 |
| `unknown`            | `nonce`, `transactionId?`                            | Previously known parent whose current status is unknown                            |
| `pending` / `queued` | `nonce`, `transactionId`                             | Parent identified in the complete inventory's category                             |
| `confirmed`          | `nonce`, `transactionId`, `blockHash`, `blockHeight` | Parent identified by exact evidence in the inclusion journal                       |

Except for `root`, the predecessor nonce is exactly the child's nonce minus one; a child cannot be its own parent. Children are unique, and the union of their identifiers and their parents' identifiers fits within `poolObservation`'s 4,096 identifiers. Pending and queued categories match its lists; a confirmed resolution must match an exact public entry in `inclusions`. Metadata for children present in `transactions` must match. Inconsistent data is rejected rather than partially interpreted.

The browser expires this context sixty seconds after its observation, including during a slow request or a pause. A temporary failure preserves its timestamps; full snapshot expiry removes it. Missing context proves neither nonce availability nor confirmation. The engine may retain an unknown marker for a previously known parent, and reevaluates admissions without bypassing wagon movement rules. No additional endpoint or RPC call is introduced. Sources: [Geth txpool namespace](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool), [Ethereum transactions](https://ethereum.org/developers/docs/transactions/).

## Routes

| Route                                        | Response                                                                 | Scope                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `GET /api/health`                            | `{ "status": "ok", "service": "blockchain-observer", "readOnly": true }` | The server responds; does not certify providers or freshness |
| `GET /api/snapshot?chain=bitcoin&mode=live`  | Normalized snapshot                                                      | Live Bitcoin data                                            |
| `GET /api/snapshot?chain=ethereum&mode=live` | Normalized snapshot                                                      | Live Ethereum data                                           |
| `GET /api/snapshot?chain=bitcoin&mode=demo`  | Educational snapshot                                                     | Explicit simulation, without upstream calls                  |

`chain` accepts `bitcoin` or `ethereum`, defaulting to `bitcoin`. `mode` accepts `live` or `demo`, defaulting to `live`. An invalid chain, unknown parameter or repeated parameter is rejected. The API accepts only `GET`.

Snapshot responses remain HTTP 200 when a source is unavailable: the application state is read from `status`. Request errors use codes including 400, disallowed methods 405, rate-limit violations 429 with `Retry-After`, and internal errors 500. The browser does not cache JSON responses; the server shares upstream calls itself.

The default API limit is 120 requests per minute per client, configurable on the server. Behind an explicitly configured trusted proxy, the client address may come from `X-Real-IP`; details and precautions are in `SECURITY.md`. Consumers must respect `Retry-After` and avoid rapid retries.

## Snapshot

| Field                  | Type / units                   | Meaning                                                                                            |
| ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `chain`                | `bitcoin` / `ethereum`         | Represented network                                                                                |
| `mode`                 | `live` / `demo`                | Real or educational provenance                                                                     |
| `status`               | `ok` / `stale` / `unavailable` | Result freshness                                                                                   |
| `source`               | Bounded text                   | Provenance label; no private URL or key                                                            |
| `observedAt`           | Unix milliseconds              | Collection timestamp; preserved for an old result                                                  |
| `coverage`             | Bounded text                   | Limits of the supplied view                                                                        |
| `pendingCount`         | Safe integer or `null`         | Total of the observed provider's local mempool when available; `null` means unknown                |
| `mempool`              | Optional object or `null`      | Ethereum local count details, with their own timestamp, method and freshness                       |
| `sampling`             | Optional object or `null`      | Provenance and timestamp of a complete read used to select local high-fee transactions             |
| `poolObservation`      | Optional object or `null`      | Pending/queued presence or absence in a complete inventory, with its own timestamp                 |
| `ethereumProjection`   | Optional object or `null`      | Exact reference for the next Ethereum block, linked to the parent                                  |
| `ethereumDependencies` | Optional object or `null`      | Known immediate predecessors and limits of Ethereum nonce knowledge                                |
| `blockTemplate`        | Optional object or `null`      | Bitcoin candidate proposed by a node, with parent, timestamp and bounded known membership          |
| `candidateComparison`  | Optional object or `null`      | Complete comparison excluding coinbase of the observed candidate and latest received Bitcoin block |
| `feeRate`              | Number or `null`               | Measurement or estimate described in the interface                                                 |
| `feeUnit`              | `sat/vB` / `Gwei`              | Unit matching the chain                                                                            |
| `usdQuote`             | Optional object or `null`      | USD conversion quote independent of the blockchain source                                          |
| `latestBlockValue`     | Optional object or `null`      | Native aggregate of the latest complete block, linked to its hash and height                       |
| `transactions`         | Array, maximum 1,944           | Sample; never a promised exhaustive list                                                           |
| `blocks`               | Array, maximum 3               | Recent observed blocks                                                                             |
| `inclusions`           | Optional array, maximum 16     | Rolling journal of verified inclusions of tracked identifiers                                      |
| `message`              | Optional text                  | Explanation of a limit or incident                                                                 |

A transaction has an identifier, its chain, a size, a fee rate, `pending` or `confirmed` status, a `transfer` or `contract` kind, and a textual value. Numbers must be finite and nonnegative. Transactions in a snapshot must belong to its chain. The optional `blockHash` field carries evidence of inclusion in that block; a `pending` transaction cannot have it. An old confirmation without a hash remains readable but does not prove membership in the animated departure.

`Tx.size` is expressed in **vBytes for Bitcoin** and as the **declared gas limit for Ethereum**. The Ethereum field is neither a byte size nor actual gas consumed, including for confirmed transactions: consumers must not add these limits and claim to measure actual block usage. Gas consumed by the complete block is available separately in `Block.used`. Measured capacity concerns execution gas; the contract does not measure blob resources.

The shared `transactions` array limit increases from 984 to **1,944 objects** in the 16 October 2026 extension. Adapters retain up to **1,920 pending transactions**, with base selections favoring the highest fees in the provider's available view, and separately reserve up to **24 confirmations**, which do not count toward that selection. The inclusion journal retains its 16-block limit and a total cap of 4,096 inclusion identifiers. A lower upstream count stays lower: no simulated filler or additional traversal fills the live limit. The demonstration contains 1,920 pending transactions and 12 fictional confirmations per chain, or 1,932 transactions; its pool count is explicitly simulated and greater than the sample. The increase alone adds no provider call; the optional complete mode described below keeps its own background collection. The blockchain cache remains three seconds, and upstream size, timeout and object-count limits are preserved. Native block capacities do not grow with this display limit. Check results and their limitations are recorded in [validation.md](validation.md).

A block has a height, hash, `timestamp` in **Unix seconds**, transaction count, capacity and usage. Capacity is expressed in virtual bytes for Bitcoin and gas for Ethereum. Usage cannot exceed the declared capacity. Do not confuse `timestamp` and `observedAt` when converting dates.

Since the 15 October 2026 correction, consumers use these resources for wagons. A Bitcoin projection sums virtual sizes against **1,000,000 vBytes**; an Ethereum projection sums declared gas limits against the latest available block's `Block.capacity`, which comes from its `gasLimit`. This does not announce the next block's capacity; when absent, it remains unknown, without an artificial fallback budget. A zero size is not admitted to the projection. Outside the complete Bitcoin candidate described below, the projected percentage concerns only boarded sample travelers and carries `≈`. Once a verified departure is preparing, its percentage instead uses `Block.used / Block.capacity` of the **complete block matching that departure's hash**, whether from `blocks` or `inclusions[].block`. Its transaction count retains the sample scope. A newer journal must not substitute its latest block for the departing vehicle's block; missing metadata for that block produces an unavailable percentage, without falling back to traveler sizes. This interpretation reuses existing fields, without a schema change, Ethereum receipt or additional request, and retains the validation limits recorded in [validation.md](validation.md).

An `unavailable` snapshot has no block, transaction or inclusion entry to animate, and no non-null `mempool`, `sampling`, `blockTemplate`, `poolObservation`, `ethereumProjection`, `candidateComparison` or `latestBlockValue` object. A demonstration has status `ok`, never represents upstream availability, and cannot carry a non-null real `latestBlockValue` aggregate. The Ethereum adapter distinguishes transactions in the pending block from those in confirmed blocks; clients must not change this meaning to make them appear as pending travelers.

Bitcoin inventory recovery preserves its cadence: incremental RPC error or more than 500 additions → a complete rebuild on the next cycle, without publishing an incomplete index. Only numeric codes -32601/-32602 suspend incremental mode for five minutes. Neither an error nor an inventory removal becomes a confirmation.

## Tracked presence and Ethereum projection — 15 October 2026

Additional optional fields, forbidden in demonstration and unavailable snapshots:

- `poolObservation`: `source`, `method` (`getrawmempool` or `txpool_content`), `observedAt`, `presentTransactionIds`, `queuedTransactionIds`, `absentTransactionIds`. Same timestamp and source as `sampling`; three disjoint, unique lists limited together to 4,096 IDs. Hexadecimal hashes are normalized to lowercase. Each presence list remains no larger than the corresponding complete `sampling` count. Absence from an inventory ≠ confirmation. Client validity is 60 seconds.
- `ethereumProjection`: `parentBlockHash`, `height`, `baseFeePerGasWei` (exact decimal uint256 integer), `source` (`calculated` or `pending`), `observedAt`. Ethereum only, with the latest block as parent and the next height; client expiry after 30 seconds. `Snapshot.feeRate` keeps the latest block's base fee; the projection has its own reference.
- `Tx.ethereum`: `from` account, exact decimal integer `nonce`, legacy `gasPriceWei` or the `maxFeePerGasWei` / `maxPriorityFeePerGasWei` pair. This metadata allows exact reevaluation of known fee caps and nonces. It does not prove validator selection. `Tx.size` remains the declared gas limit.

Transaction identities must be unique within a snapshot, including across case differences. Inventory and candidate timestamps are independent; an older inventory cannot invalidate a more recent candidacy. The local three-second cache does not give unchanged upstream observations a new timestamp.

## Node Bitcoin candidate — `blockTemplate`

On 15 October 2026, the candidate obtained through `getblocktemplate({"rules":["segwit"]})` becomes the primary source of Bitcoin travelers. This is the selection proposed by the **configured RPC node**, not proof that a mining pool is working on it, a guaranteed future block or confirmed transactions. The server compares its parent and height with the latest observed REST block. A different head, reorganization, invalid response or expired timestamp removes this priority. Fallback preserves the order **complete RPC pool → first mempool.space projected block → recent transactions**, with explicit provenance; valid blocks remain usable when optional capabilities fail.

`Snapshot.blockTemplate` is optional and nullable, distinct from `sampling`: a candidate is not a mempool inventory. The producer may emit both `sampling` and the candidate when the RPC inventory is available. The contract restricts a non-null candidate to live Bitcoin on an available snapshot, with `height = blocks[0].height + 1`, `previousBlockHash = blocks[0].hash` and its own timestamp no later than the snapshot's. Transactions outside the candidate require a separate `sampling.getrawmempool` observation; only selected members contribute to the candidate's validated minimum weight. Older responses without this field remain compatible; a demonstration carries no real candidate.

| Field                    | Type / limit                                                                        | Meaning                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `source`                 | Text of 1 to 100 characters                                                         | Provider node label, without a private URL                                                                          |
| `observedAt`             | Nonnegative safe integer, Unix milliseconds                                         | Candidate's own reception timestamp                                                                                 |
| `height`                 | Nonnegative safe integer                                                            | Proposed height after the observed parent                                                                           |
| `previousBlockHash`      | 64 hexadecimal characters                                                           | Parent hash, matching the snapshot's latest block                                                                   |
| `transactionCount`       | Safe integer from 0 to 30,000                                                       | Complete transaction count **excluding coinbase**, before sample limiting                                           |
| `weight`                 | Nonnegative safe integer, at most `weightLimit`                                     | Sum of non-coinbase transaction weights; header and coinbase excluded                                               |
| `weightLimit`            | Positive safe integer, at most 4,000,000 WU                                         | Weight limit announced for this candidate                                                                           |
| `medianFeeSats`          | Optional number from 0 to 2,100,000,000,000,000 sat in increments of 0.5, or `null` | Exact median of proposed fees for all non-coinbase transactions before sampling; `null` only for an empty candidate |
| `selectedTransactionIds` | At most 4,096 unique hashes, no more than the total count                           | Candidate members among already tracked IDs and up to 1,920 current transactions, not its complete list             |

During GBT use, `Snapshot.source` names the REST provider of blocks, recommended fees and the mempool count; `blockTemplate.source` separately names the node proposing travelers. The count must not attribute its measurement to that distinct node.

The server privately retains all identifiers of a validated candidate, then sends only their intersection with known identifiers and the current sample, capped at 4,096; current transactions take priority in this list. The base selection keeps up to **1,920 members with the highest individual fees per `weight / 4`**, compared exactly before rounding to sat/vB. The final response first reserves up to 384 places for real stream arrivals, then fills from this base; the number of candidate members actually sent may therefore be lower. Declared dependencies reference only earlier entries in the complete candidate. A parent may appear more than once when multiple entries spend its outputs; these repetitions are accepted, as in Bitcoin Core. Display sorting may nevertheless omit parents: the sample is not a complete directly mineable package and does not reproduce the node's CPFP ranking. When the independent RPC pool is usable, a reserve of 384 current details accommodates transactions outside the candidate, or more if the candidate supplies fewer than 1,536 details; this reserve shares the 1,920 cap and returns unused places to candidate members.

The first Bitcoin wagon admits known members of this candidate under the native block budget; the second remains an estimate for other retained observations. While stopped and outside preparation, the first wagon's plate shows the complete candidate: `transactionCount`, virtual size `weight / 4`, capacity `weightLimit / 4`, and percentage `100 × weight / weightLimit`. The internal occupancy scope is then `template`, distinct from `sample` and `block`; this rendering marker adds no network status to the contract. Estimates for other wagons retain the count and sizes of travelers actually on board.

A noninteractive collective representation fills in known members without creating new `Tx` objects. Its count is `max(0, transactionCount - number of known pending members individually represented anywhere in the scene)`, with identifiers deduplicated, including those on the platform or walking. Boarding therefore creates no double count. The number of identifiers in `selectedTransactionIds` alone is not the number of people present. This representation exposes no invented individual identifier, fee or value; keyboard details remain limited to actually known travelers. It disappears on fallback, expiry, preparation or departure, and is never carried away as a confirmed cohort.

`medianFeeSats` is calculated from integer satoshi fees for the entire validated candidate, before high-fee sorting and the 1,920-transaction limit. For an even count, averaging the two middle values allows half a satoshi; the intermediate calculation uses `BigInt`. A value supplied for a nonempty candidate must be numeric, including zero; an empty candidate allows only `null`. Older responses omitting this field remain compatible, with the interface falling back to an explicitly labeled sample median. This metric describes neither all mempool fees nor confirmed fees. It adds no network call, individual object or Canvas capacity.

Proposed membership never sets `Tx.blockHash` or `inclusions`: real departures still require independent inclusion evidence. Once preparation starts, departure counters return to their own scopes: complete real block size for the percentage and only travelers with known inclusions for the TX count. Without a usable candidate, both wagons return to estimated projections.

The shared reader runs at most **one concurrent GBT collection per instance**, without making the main blockchain collection wait: `getblockchaininfo` check (`main`, initial synchronization complete), followed by `getblocktemplate`, within a **total eight-second budget**, with the GBT response limited to **16 MiB** and **30,000 transactions**. Successful or failed collections are separated by at least **fifteen seconds after the previous one finishes**. Validity is **thirty seconds from its own timestamp**, independently of the three-second blockchain cache; consumers must check this age even when retaining an old snapshot. If a slow inclusion check lets the candidate expire, collection retries once through fallbacks rather than publishing an expired candidate.

Hex data, identifiers, integer satoshi fees, weights, dependency indices, cumulative sizes and RPC envelopes are bounded and checked. The witness hash is compared with the double SHA256 of the received data; the SegWit `txid` remains provider-declared. This is not a complete revalidation of Bitcoin scripts or consensus. Raw data is discarded after validation; no new route, environment variable, key, dependency or database is added. The mempool counter retains its own provenance: the available RPC index count, otherwise REST `/mempool`. It is never inferred from `transactionCount`.

Sources: [Bitcoin Core `getblocktemplate`](https://bitcoincore.org/en/doc/30.0.0/rpc/mining/getblocktemplate/), [miner construction and customization](https://developer.bitcoin.org/devguide/mining.html#getblocktemplate-rpc), [BIP141 weight](https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki#block-size), [per-entry `depends` construction in Bitcoin Core 30](https://github.com/bitcoin/bitcoin/blob/v30.0/src/rpc/mining.cpp#L850-L856). Checks and their limitations are recorded in [validation.md](validation.md); a provider's support at one point in time is not an availability commitment.

## Bitcoin candidate / received block comparison — `candidateComparison`

This optional nullable object is restricted to live Bitcoin on an `ok` or `stale` snapshot. It compares the complete lists of the previously observed candidate and the received block, excluding coinbase. It adds no individual identifier to `transactions` or `inclusions`, does not describe the whole mempool and does not prove the miner's private choices.

| Field                            | Contract                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `scope`                          | `complete`; no partial comparison presented as complete                                                   |
| `blockHash`, `blockHeight`       | Same hash and height as `blocks[0]`                                                                       |
| `parentBlockHash`                | Common parent explicitly verified between candidate and block                                             |
| `candidateObservedAt`            | Candidate reception in Unix milliseconds, before or at first block detection                              |
| `blockObservedAt`                | First detection of this head by the application, in Unix milliseconds; not the block's declared timestamp |
| `candidateSource`, `blockSource` | Public labels limited to 100 characters, without private URL or secret                                    |
| `candidateTransactionCount`      | Complete candidate count excluding coinbase, safe integer from 0 to 30,000                                |
| `blockTransactionCount`          | Block count excluding coinbase, safe integer from 0 to 29,999, equal to `blocks[0].txCount - 1`           |
| `commonCount`                    | Present in the candidate and in this block                                                                |
| `candidateOnlyCount`             | Present in the candidate, not included in this block; current presence is separate                        |
| `blockOnlyCount`                 | Included in this block without appearing in the observed candidate                                        |

Counts are nonnegative safe integers. `commonCount + candidateOnlyCount = candidateTransactionCount` and `commonCount + blockOnlyCount = blockTransactionCount`. Timestamps satisfy `candidateObservedAt <= blockObservedAt <= Snapshot.observedAt`. The schema rejects inconsistent totals, the wrong chain or block, and non-null objects in demonstration or unavailable snapshots.

The server freezes the last candidate actually published when the block is detected, only with matching height and parent and a candidate no older than 30 seconds. Complete private identifiers are compared with the block identifiers already read for inclusions; the first coinbase transaction is excluded. The next candidate or one received late is never substituted. Two bounded sets of at most 30,000 IDs suffice for private retention; a failed verification can be retried for 30 minutes on this head, without a new route or additional call. A new block without a comparable reference, or a reorganization, removes the previous result.

An absent field remains compatible with older consumers; `null` means no complete comparison is available, never zero transactions. At initial startup or after a restart, a candidate must first be observed, followed by its matching block. The `stale` cache preserves timestamps and counts; unavailability removes them. The interface shows the three categories and `commonCount / candidateTransactionCount`, undefined for an empty candidate, along with sources and coverage excluding coinbase.

## Provenance of complete fee ranking

On 15 October 2026, `Snapshot.sampling` adds an **optional nullable** object, restricted to usable live data, to distinguish a ranking from a complete provider observation from fallbacks based on a projection or recent transactions:

| Field          | Type / limit                                                      | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `method`       | `getrawmempool` / `txpool_content`                                | Bitcoin or Ethereum read; method consistent with `chain`                                  |
| `source`       | Text of 1 to 100 characters                                       | Pool provider label, without private URL or secret                                        |
| `observedAt`   | Nonnegative safe integer, Unix milliseconds                       | Complete observation's own timestamp, or latest successfully reconciled Bitcoin inventory |
| `pendingCount` | Safe integer from 0 to 100,000 for Bitcoin or 50,000 for Ethereum | Complete observed `pending` count before selection                                        |
| `queuedCount`  | Required for Ethereum, nonnegative safe integer                   | Ethereum `queued` entries, excluded from travelers; `pending + queued` ≤ 50,000           |
| `update`       | Required for Bitcoin: `full` / `incremental`                      | Complete pool load or identifier reconciliation with metadata for new entries only        |

When the primary GBT candidate is unusable, Bitcoin selects the highest `base fee / (weight / 4)` rates from its complete pool table, independently of policy-adjusted `vsize`. An initial `getrawmempool(true)` read builds the table; subsequent reads use `getrawmempool(false, true)`, with identifiers and a validated sequence number under eight MiB, remove disappeared identifiers and request `getmempoolentry` only for new ones. At most 500 additions are processed per cycle in batches of 25, at most two concurrently, with responses capped at 128 KiB and a total eight-second budget for the entire Bitcoin cycle; a complete read is repeated after ten minutes, or after invalidity, the wrong network or loss of the validated baseline. An error or exceeded limit invalidates this attempt's public complete ranking and triggers fallback; missing data must not be presented as a complete ranking. After an incremental network, HTTP, RPC, timeout or volume failure, the previous private index remains available until the ten-minute expiry to retry identifiers and new details after 30 seconds. No partial metadata is retained. Invalid data, the wrong network, an initial-load error, an inconsistent clock or an expired baseline clears the index and requires a complete baseline on the next attempt. Calls are not atomic and an identifier's disappearance proves no confirmation. Blocks, recommended fees and evidence still come separately from mempool.space, which `source` and `coverage` must state. `Snapshot.pendingCount` then uses the count from the same RPC observation, with its own timestamp distinct from the block's.

Ethereum sorts only `pending` transactions eligible at the observed base fee, by effective price calculated exactly in wei before rounding to Gwei. `queued` transactions are counted in `sampling` but not admitted to wagons. An arrivals-only filter does not cover removals, evictions and `queued` categories: complete `txpool_content` reads continue to refresh rather than maintaining an incomplete incremental ranking. `Snapshot.mempool` counts remain independent, from `txpool_status` at their own timestamp. Nonces, packages, producer choices and changes since the observation prevent any promise of future inclusions. Ranking concerns the **native rate per resource unit**, never the total amount paid in dollars.

The server sends at most 1,920 pending details: the base ranking is supplemented or reduced by priority for real Bitcoin arrivals, with separate counts and provenance. `sampling` certifies the complete observation's origin, not that every final detail forms its global ranking. Bitcoin retains a compact table capped at 100,000 entries for reconciliation; Ethereum retains a compact form of `pending` candidates for at most 30 seconds to rerank effective prices against the current base fee, under a 50,000-entry limit for received `pending + queued` entries. The original RPC body is neither exposed to visitors nor permanently retained as an inventory. Only one complete pool collection can run per chain; it runs in the background with **at least 30 seconds after completion**, an eight-second maximum timeout per request and **32 MiB** at most. The ordinary two-MiB limit for other upstream routes, the three-second blockchain cache and the maximum 1,944 transactions in the response remain bounded. Bitcoin separates retries by 30 seconds after failure; Ethereum waits 60 seconds, or five minutes after an RPC refusal. Traffic, deserialization and the in-memory table add server cost, without another service, dependency or durable storage.

The Bitcoin `/mempool/recent` fallback retains an upstream limit of 1,000 validated objects: it does not promise to fill the 1,920-current-detail limit.

The field supports a complete-ranking claim only while its observation is usable and at most **30 seconds** old; consumers must compare its own timestamp with the current time, including in a retained blockchain snapshot. An invalid, oversized, truncated, refused or expired read cannot support a partial “complete” ranking. The field becomes absent or `null`, and coverage describes the fallback: first projected block then recent transactions for Bitcoin, or the `pending` candidate block for Ethereum when available. Absence does not mean an empty pool. Demonstration and unavailable snapshots cannot carry a real complete observation. The field remains optional for older producers and consumers.

The tracking of 4,096 identifiers and inclusion evidence remains limited to sampled transactions, without promising individual tracking of the complete pool. Sources: [Bitcoin Core `getrawmempool`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getrawmempool/), [`getmempoolentry`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getmempoolentry/), [Geth `txpool_content`](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-content), [Geth subscriptions](https://geth.ethereum.org/docs/interacting-with-geth/rpc/pubsub). Checks and their limitations are recorded in [validation.md](validation.md); an authorized manual trial does not validate robustness or cost.

## Native value of the latest block

`latestBlockValue`, optional and nullable, describes an aggregate of the **latest complete block `blocks[0]`**, independently of the number of displayed passengers:

| Field              | Type / limit                                            | Meaning                                                                                           |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `blockHash`        | Chain hash                                              | 64 hexadecimal characters for Bitcoin, or `0x` followed by 64 hexadecimal characters for Ethereum |
| `blockHeight`      | Nonnegative safe integer                                | Height of the aggregated block                                                                    |
| `amount`           | Canonical integer decimal string, 1 to 83 digits        | Exact nonnegative amount in smallest units; no floating-point number in this field                |
| `unit`             | `sat` / `wei`                                           | Bitcoin satoshis or Ethereum wei                                                                  |
| `method`           | `bitcoin-output-sum` / `ethereum-transaction-value-sum` | Chain-specific definition, linked to `unit` by the schema                                         |
| `transactionCount` | Nonnegative safe integer                                | Complete block transaction count, including Bitcoin coinbase even though its value is excluded    |
| `observedAt`       | Nonnegative safe integer, Unix milliseconds             | Collection timestamp of this aggregate                                                            |

The contract strictly links unit, method and chain, then requires the same hash, height and count as `blocks[0]`. A non-null field is restricted to `live` mode and cannot appear on an unavailable snapshot. A `stale` snapshot retains this observed block's aggregate and timestamp; it is not a new collection. The optional shape remains compatible with older producers and consumers.

**Bitcoin.** The adapter uses `extras.totalOutputAmt` from the enriched block already returned by `/v1/blocks`. This field comes from `getblockstats.total_out`: the sum of all **non-coinbase** transaction outputs, therefore excluding the block reward and including change returned to senders. This gross amount is not net economic volume. The supplied number must be a nonnegative safe integer before exact conversion to a string; an absent, invalid or out-of-range value produces `latestBlockValue: null` without invalidating other blockchain data. No total is extrapolated from the visible sample.

**Ethereum.** The adapter uses `BigInt` to sum the `value` fields of every transaction in the validated complete `latest` block, before sorting and limiting the public array. These are **declared native values**, not a record of transfers actually executed: without receipts, the sum may include failed calls. Fees, ERC20 tokens, internal contract transfers and validator withdrawals do not contribute to this sum. Input quantities remain limited to 256 bits and the block to 50,000 transactions, under the existing 2 MiB HTTP limit; the serialized aggregate is capped at 83 digits.

These calculations use only responses already collected: no additional endpoint, receipt, trace, paginated traversal, dependency or network request. Timeouts, the blockchain cache and live polling remain three seconds. The large board's **Value** page and the **Block** details show the total in BTC or ETH; presentation rounding does not change the API's exact integer. A secondary USD equivalent carries `≈` and uses only a still-usable current quote, never a historical block quote. A missing value or quote remains explicitly unavailable, without an invented zero. Board page rotation changes to **four seconds**, independently of data collection.

Overall validation of this contract and display change remains incomplete; checks have resumed, and their results and remaining coverage are recorded in [validation.md](validation.md). Sources: [Mempool enriched block calculation](https://github.com/mempool/mempool/blob/master/backend/src/api/blocks.ts), [Bitcoin Core definition of `total_out`](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockstats/), [Ethereum JSON-RPC and value in wei](https://ethereum.org/developers/docs/apis/json-rpc/).

## Provider mempool count

For live Bitcoin, `pendingCount` uses the count from the same RPC observation as `sampling` when complete-ranking fallback is used; with the primary GBT candidate or other fallbacks, it uses the validated `/mempool` count from the configured REST provider. This local total is not inferred from visible traveler counts. For live Ethereum, it is the **pending + queued** sum returned by the configured RPC's optional `txpool_status` method. Counts from the `txpool_content` ranking observation remain separate in `sampling`, with their own timestamp; they may differ from a count received at another time. `queued` transactions are retained for future execution and are not necessarily eligible for the next block. This field never announces a worldwide network total. A `pending` candidate block and its sample never substitute for an unavailable count.

The optional nullable `mempool` field details an Ethereum observation:

| Field        | Type / limit                                | Meaning                                              |
| ------------ | ------------------------------------------- | ---------------------------------------------------- |
| `pending`    | Nonnegative safe integer                    | Transactions locally awaiting inclusion              |
| `queued`     | Nonnegative safe integer                    | Transactions locally queued for future execution     |
| `observedAt` | Nonnegative safe integer, Unix milliseconds | Count reception time, distinct from block collection |
| `status`     | `ok` / `stale`                              | Received count or last retained value                |
| `method`     | `txpool_status`                             | RPC capability that supplies this count              |

The sum must also remain a safe integer and exactly match `pendingCount`. The contract restricts a non-null `mempool` object to Ethereum in `live` mode; Bitcoin snapshots, older contract versions and demonstration snapshots may omit it. The educational demonstration total does not become an RPC observation.

The service starts collection in the background after validating mainnet and the latest block, using the same server-side RPC. Only one request can run at a time, with **at least 30 seconds after each attempt**, an eight-second timeout and a response capped at **64 KiB**. RPC counts must be complete valid hexadecimal quantities and are then converted to safe integers; an invalid response, refusal or unsupported method produces no invented zero. A read immediately uses the latest usable count or `null`, without waiting for this optional method; the next snapshot may use a collection that has finished in the meantime.

The latest value is marked `stale` after a failure or once it exceeds 30 seconds. It remains usable for at most **120 seconds from `mempool.observedAt`**, after which `mempool` and `pendingCount` become `null`. This count's freshness is independent of `Snapshot.observedAt` and `Snapshot.status`: failure of this capability does not make blocks stale or unavailable. Consumers must also consider the count's own age, particularly as a retained blockchain snapshot ages. The cache is volatile, shared between visitors to one instance, and separate from three-second blockchain collection. The transport and clock injected into the adapter apply to this method too; future fixtures must simulate its result or unavailability without depending on a public RPC.

Sources: [Geth `txpool_status` method](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-status), [Geth implementation of hexadecimal counters](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/api.go).

## Inclusion journal

Each optional `inclusions` entry has the shape `BlockInclusions = { block: Block, transactionIds: string[] }`. It contains only identifiers already observed by the service whose presence in that block hash has been verified. An empty entry means the block was checked without finding any tracked identifier; a missing entry does not mean verification succeeded. The journal does not replace the `transactions` and `blocks` arrays and does not provide the block's exhaustive transaction list.

The contract limits the journal to **16 blocks and 4,096 identifiers in total**, with at most 4,096 identifiers in one entry. Identifiers are unique within an entry; block hashes and heights are unique within the journal. If a height also exists in `blocks`, its hash must match; other historical blocks remain allowed. In live mode, inclusion hashes and identifiers follow chain formats: 64 hexadecimal characters for Bitcoin, `0x` followed by 64 hexadecimal characters for Ethereum. No educational `demo-` identifier may appear in live data.

The server tracks at most 4,096 identifiers for 30 minutes from their last observation. During collection it may temporarily retain 4,096 old observations and 1,920 new ones, or at most 6,016 transient identifiers before verification and trimming back to the tracking limit. Catch-up examines at most eight blocks per collection. A gap whose verification fails remains retryable; it is not marked confirmed by default. The same evidence may be returned across multiple refreshes and visitors: consumers must deduplicate by hash and identifier without consuming the journal for other clients.

Tracking and the journal are volatile. Restart, expiry, eviction or an interruption beyond the limits may prevent an old observation from being recovered. Evidence incompatible with a reorganization is invalidated; observed inclusion is no guarantee of finality. The client initializes the journal received on first load without replaying historical departures. Additional evidence illustrated after a departure is catch-up for the same hash, not a new block.

Ethereum supplements height-based catch-up with a cache of 65,536 recent-block identifiers and targeted background checks for still-tracked identifiers: at most sixteen per pass, two concurrently, at least fifteen seconds after a pass finishes, and at least sixty seconds between attempts for the same identifier. The receipt is capped at 256 KiB; its canonical block is read under the ordinary two-MiB limit. Identifier, height, hash and presence in the block must agree; `null`, errors, inconsistencies and exceeded limits add no evidence. The journal reserves the latest block and then prioritizes new nonempty evidence, including old evidence, within the same sixteen entries and 4,096 identifiers. Its order therefore no longer guarantees height sorting; consumers sort departures by height. An old pending response must not reintroduce an identifier whose inclusion has already been consumed. These checks add neither a public route nor per-visitor calls and do not guarantee catching every identifier before expiry.

Read sources are documented by [Esplora](https://github.com/Blockstream/esplora/blob/master/API.md#get-blockhashtxids), the [mempool.space Bitcoin routes](https://github.com/mempool/mempool/blob/master/backend/src/api/bitcoin/bitcoin.routes.ts) and the [Ethereum JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/).

## Optional quote and USD display

`usdQuote` may be absent or `null` when no usable quote is available. When present:

| Field        | Type / limit                                    | Meaning                                                                   |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `usdPerCoin` | Finite positive number, at most `1_000_000_000` | US dollars for one BTC or ETH according to `chain`                        |
| `observedAt` | Nonnegative safe integer, Unix milliseconds     | Quote reception time, distinct from blockchain collection and market time |
| `source`     | `Coinbase`                                      | Conversion provenance                                                     |
| `status`     | `ok` / `stale`                                  | Received quote or retained old quote                                      |

The server uses fixed public Coinbase BTC/USD and ETH/USD routes, with a shared 60-second cache after each attempt, at most one concurrent request per chain, an eight-second timeout and a response capped at 16 KiB. It validates USD as the currency, the expected base asset and a bounded decimal amount before conversion. Collection runs in the background: responses immediately use an already available valid quote or `null`, without waiting for renewal. A later read may supply the new quote. An old quote remains usable for only five minutes from reception, after which `usdQuote` becomes `null`. A quote error does not change `Snapshot.status`, which concerns the blockchain; even an unavailable chain may carry a valid quote. Demonstration mode collects no quote, and the contract rejects a non-null quote in `demo` mode.

`feeRate` and `feeUnit` remain native: the interface switch changes neither the contract nor transaction ranking. This snapshot field keeps its meaning as Bitcoin's recommended rate or the latest Ethereum block's base fee; it does not become a median. Converting a rate produces USD/vB for Bitcoin and USD/gas for Ethereum. In USD, transaction details and tooltips give an estimated total marked `≈`:

- Bitcoin: `feeRate * size * usdPerCoin / 100_000_000`, with `size` in vB.
- Ethereum: `feeRate * size * usdPerCoin / 1_000_000_000`, with `size` as the declared gas limit.

The Ethereum formula provides neither gas consumed nor fees actually paid; no execution receipt is added. Conversion uses the observed quote, never a supposed quote at the block's date. Source, timestamp and retention of an old quote are indicated; an absent, invalid or expired quote makes conversion unavailable without inventing zero. Demonstration mode uses no fictional price. Sources: [Coinbase spot prices](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices), [Ethereum gas and Gwei](https://ethereum.org/developers/docs/gas/).

## Median transaction fees in the interface

The header and Network page metric prioritizes `blockTemplate.medianFeeSats / 100_000_000` BTC when a Bitcoin candidate is active and supplies its aggregate. Its “Complete candidate” label reports `transactionCount` excluding coinbase, distinct from the individual-detail count. Fees remain proposed, without a worldwide mempool median or confirmed payment. Native conversion can preserve half a satoshi; USD conversion remains approximate and depends on the current quote.

Without this aggregate, the interface computes the metric from only the received `transactions` array's `pending` transactions belonging to the displayed chain. Identifiers are deduplicated, and nonfinite or negative values and zero sizes are excluded. `confirmed` transactions, the inclusion journal and historical observations retained in the scene do not contribute. This fallback requires no additional provider call.

The calculation uses the **estimated cost of each transaction**, followed by the median of the sorted costs:

- Bitcoin: `feeRate * size / 100_000_000` BTC, with `size` in vB.
- Ethereum: `feeRate * size / 1_000_000_000` ETH, with `size` as the declared gas limit.
- Odd count: middle value; even count: average of the two middle values.
- USD conversion: median in BTC or ETH multiplied by that chain's valid `usdPerCoin` quote.

This calculation is not the product of the median rate and median size. Each Ethereum transaction's price includes the tip when it is part of the observed price; “excluding tip” applies only to the block's base fee, retained as a secondary detail. Using gas limits and rounded rates prevents presenting this metric as fees actually paid.

The metric includes its sample count. Base rankings prioritize high fees from the complete observation, projection or available recent transactions. Bitcoin also reserves up to 384 places within the same 1,920 cap for stream arrivals, so its median describes a mixed sample. This median's timestamp is `Snapshot.observedAt`, when the sample was assembled, without changing individual observation timestamps. The complete candidate median remains a separate scope and retains `blockTemplate`'s own timestamp. This selection is biased: its median is neither that of the entire mempool nor that of all network blocks. The interface shows `≈` for these estimated BTC/ETH costs or their USD conversion. An empty candidate or absent sample produces `—`; a missing or expired quote does not produce a fictional zero USD median. Stale, unavailable and demonstration states remain distinct.

## Contract evolution

Any change affecting a unit, a field's meaning, a state or a chain's capabilities must update the schema, fixtures, adapter tests, HTTP tests, interface and documentation in the same proposal. Adding an optional field may be compatible; silently changing seconds to milliseconds or replacing `null` with an invented zero is not.

The current API is internal to the application, without an external stability commitment. Before making it a documented public API for third parties, define its versioning, rate limits and consumer compatibility period.
