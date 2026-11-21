# Sector Forge 1.3 — Living Sector Simulation Architecture

**Status:** 1.3.2 foundation, 1.3.3 local economy, 1.3.4 inter-market logistics, 1.3.5 financial/diplomatic feedback, 1.3.6 commercial settlement/contracts, 1.3.7 condition-driven faction/corporate strategy plus persistent port/fleet infrastructure, 1.3.8 formal politics/network competition/causal Chronicle/render purity/atomic in-memory campaign turns, 1.3.9 retention/recovery/validation hardening, and 1.3.10 faction-level political autonomy, reliability-aware corporate competition, detailed archives and campaign-scoped recovery are implemented; 1.3.10.1 adds indexed hot paths, bounded archive detail, bilateral ceasefire/peace consent and legacy recovery compatibility; 1.3.10.2 adds per-turn route/search reuse, incremental sequence counters, live-ledger byte budgeting, strict campaign recovery identity, import/load recovery and expiring conflict proposals; 1.3.11 applies political transitions before market competition/dispatch and invalidates route caches on effective trade-access changes. Deployed-origin IndexedDB/Worker verification and extended coefficient calibration/playtesting remain environment- or campaign-dependent release follow-ups.

Related: [SIMULATION_DATA_MODEL.md](SIMULATION_DATA_MODEL.md) documents the saved data contracts for markets, shipments, settlement, strategy, transport, formal politics, the Chronicle, turn coordination, and remaining hardening work.

## Product objective

Sector Forge 1.3 is intended to turn the existing sector generator and campaign toolkit into a persistent, causally connected sector simulation. The sector must not change merely because a panel is rendered or an unrelated edit triggers a refresh. Changes should happen through explicit GM actions, canonical-data edits, deterministic recalculation, or an explicit simulation turn/event.

The application remains a client-side vanilla HTML/CSS/JavaScript project. There is no backend requirement, and the existing SWN import/export, compressed URL, static-hosting, and offline workflows must remain supported.

## Baseline and compatibility

The development workspace is based on the verified `sector-forge-1.2.zip` archive. The archive is preserved separately and is not modified by 1.3 development.

The 1.2 root sector model is retained. Its canonical records currently live in top-level collections and objects, including:

- `systems` (with nested `planets`, `bodies`, and points of interest)
- `tradeRoutes`
- `markets` (with nested `goods`)
- `factions` (with nested `assets`)
- `diplomacy`
- `corporations` and `corporationMarketLinks`
- `polities`, `regions`, `factionNews`, and `factionTurnHistory`
- SWN import metadata and source-record archives

The existing root `schemaVersion: 3` is deliberately not changed by the initial 1.3 migration. The simulation has its own independent `sector.simulation.schemaVersion`. This avoids conflating application version, the old sector object schema, and the new simulation-envelope schema.

## Findings from the 1.2 source audit

1. `CampaignTools.enrichSector()` is not a migration function. It ensures IDs, creates missing campaign collections, creates missing routes/markets/factions, establishes diplomacy, recalculates influence, links campaign records, and updates markets. It can create campaign content and mutate records; it must not be used as the migration mechanism for preserve-mode imports.
2. `CampaignTools.generateTradeRoutes()` is already deterministic and preserves manually authored routes. It is a topology generator, not a shipping simulator.
3. `CampaignTools.updateMarkets()` is now idempotent for ordinary repeated refreshes, but it applies a simplified local structural modifier to each good. It does not model commodity-specific output, consumption, stock, shipments, capacity, or multi-hop supply chains.
4. `CampaignTools.advanceFactionTurn()` still owns the legacy faction-turn rules and mutates faction credits, maintenance, assets, damage, actions, `factionTurn`, `factionNews`, and legacy faction history. In 1.3.2 its random decisions use independent keyed streams derived from sector seed + turn + phase + faction ID; it no longer consumes the global `Math.random` stream. The deeper strategic decision model remains future work.
5. `CampaignTools.linkCampaignRecords()` maintains record links and some denormalized labels. It is a compatibility/linking procedure, not a pure derivation boundary. In 1.3.3, `CampaignTools.updateMarkets()` also requests a deterministic local driver refresh for initialized market accounts; this refresh does not advance the economic clock or reset stock.
6. `App.refreshSectorAfterMapEdit()` currently orchestrates survey synchronization, route generation, influence, campaign links, markets, rendering, and persistence. The 1.3 migration will progressively replace this bundled path with explicit change/recalculation/turn commands.
7. The player-safe export is deliberately built through `App.censorSector()`. The new `simulation` envelope is not copied into player exports; GM campaign state and its future Chronicle must remain private by default.

## Architectural layers

### 1. Canonical sector data

The existing root records remain the authoritative source during the transition. They describe what exists: systems, worlds, coordinates, markets, factions, corporations, route definitions, diplomatic relationships, and GM-authored changes.

Canonical data must distinguish at least four origins:

- `generated`: created by Sector Forge generation.
- `imported`: originating in an external SWN dataset.
- `simulated`: created by an explicit simulation process.
- `manual`: authored or explicitly overridden by the GM.

Unknown/legacy records remain valid. Migration must not force a provenance classification when the original source cannot be established.

A GM override takes precedence over generated or simulated values. Field-level locks are supported so a future simulator can update unprotected fields without replacing GM-authored values.

### 2. Derived sector conditions

Derived conditions are calculated from canonical data and are not independent authoring records. Examples include route connectivity, reachable markets, political/economic access, transport risk, and faction influence.

The same canonical inputs must produce the same derived result. Derived calculation must be read-only. Rendering must not call a procedure that advances the campaign or rolls random values.

The foundation calculates route-graph topology and multi-hop reachability. In 1.3.4, the logistics engine separately constructs a weighted path for a specific commodity using operational routes, transit duration, freight/tolls, diplomatic tariff, and risk. Route capacity is enforced when a shipment leg is dispatched; pathfinding does not reserve capacity in advance.

### 3. Evolving simulation

The simulation layer advances only through explicit turn/event commands. Implemented systems include local production/consumption, inventories, stock-sensitive and network-competition pricing, persistent multi-hop shipments, commodity-weighted cargo, delivered-goods settlement, route/operator charges, recurring supply agreements, ports/fleets, bounded condition-driven faction action selection, corporate supply-contract and fleet investment decisions, formal treaty/sanction/war/ceasefire/peace records, directed polity relations, political border access, deterministic transit incidents, signal-driven bilateral faction diplomacy, and a causal GM Chronicle. Version 1.3.9 introduced configurable bounded hot-history windows; 1.3.10 initially preserved newly compacted records as detailed GM archives. 1.3.10.1 applies a shared configurable byte budget (512 KiB default) to those detail bodies, pruning oldest detail first while preserving aggregate counters and settlement idempotency keys; shipment settlement stubs remain when bulky terminal detail is pruned. Specialized cargo custody/handling remains outside the current abstraction.

Simulation randomness uses an immutable sector root seed and ephemeral streams derived from `(seed, turn, phase, scope)`. A draw in one phase or faction cannot shift another stream. Events must record their turn, category, type, source, actors/subjects, summary, and structured causes/effects where available.

## New 1.3 simulation envelope

The migration adds `sector.simulation` without replacing existing 1.2 collections:

```js
{
  schemaVersion: 1,
  engineVersion: "1.3.11",
  clock: {
    turn: 0,
    lastAdvancedAtTurn: 0
  },
  random: {
    algorithm: "xorshift32-keyed-v1",
    seed: 123456789
  },
  settings: {},
  chronicle: {
    events: [],
    nextSequence: 1
  },
  derived: {
    schemaVersion: 1,
    lastFingerprint: ""
  },
  migration: {
    version: 1,
    sourceSectorSchemaVersion: 3,
    sourceApplicationVersion: "1.3.8" // new sectors; legacy loads record their detected source
  }
}
```

This is the shape of the new envelope; numerical seed values are derived from the sector at migration time and will differ between sectors.

The initial migration is intentionally conservative:

- Idempotent: running it twice makes no further changes.
- Source-version handling: fresh sectors are migrated at the point of creation with the running app version; native legacy loads without a creation marker are identified as 1.2, and SWN imports without source-version metadata remain `unknown`. Existing 1.3.1 saves already stamped `1.2` cannot be safely relabelled: that build used the same marker for both newly generated sectors and loaded legacy 1.2 sectors, so its stored data does not distinguish those origins. Existing labels are therefore preserved rather than guessed.
- Additive: existing sector collections, custom fields, source archives, GM notes, and faction history are left in place.
- Non-generative: it does not create missing markets, factions, routes, or other campaign content.
- Preserve-import safe: it does not call `enrichSector()` or alter the import mode/source payload.
- Version-separated: it does not change the legacy root `schemaVersion: 3`.

The legacy `factionTurn` remains the canonical campaign-turn counter and is mirrored into `simulation.clock.turn`. The 1.3.8–1.3.10 campaign coordinator owns advancement and stages the legacy faction executor plus newer simulation phases before a single in-memory commit.

## Foundation and local-economy APIs implemented

`simulation/economy-engine.js` adds the local-market stock-flow phase. It processes due logistics arrivals before the market balance and committed shipment departures after the market balance.

| API | Contract |
|---|---|
| `initializeSector(sector)` | Explicitly initializes missing market accounts, with deterministic opening stock; preserves existing account stock and history. New generated sectors call this at creation; loaded legacy/SWN sectors wait for the GM action. |
| `isInitialized(sector)` / `getMarketState(sector, marketId)` | Queries the initialized market-account state. |
| `advanceTurn(sector, turnNumber)` | Processes due logistics arrivals, applies one sequential local production/consumption balance and bounded price response, commits waiting/new shipment departures, projects market state, and records local/logistics ledgers and Chronicle events. Duplicate turns are skipped; skipped-over turns are rejected. |
| `refreshMarketDrivers(sector, market)` | Re-derives unlocked local production/consumption schedules from current population, Tech Level, market profile, and supported exact world tags. It preserves current on-hand stock and manual rate locks; removed market goods are retained in retired-commodity history. |
| `syncMarketProjection(sector, market)` | Projects economic stock/price conditions into legacy market display fields without advancing a turn. |
| `getSummary(sector)` / `validate(sector)` | Returns compact economy summary and structural inventory/account diagnostics. |

Current local economy scope:

- Accounts are created for the commodities currently present in each market's legacy `goods[]` list (normally eight goods per generated market), while the catalogue retains the full existing trade-good catalogue.
- Population is handled through documented categorical multipliers; Tech Level, market profile, and a deliberately limited exact SWN-tag map affect local schedules. Unknown population labels use a conservative fallback; free-text descriptions are not parsed.
- Initial stock is a newly created baseline using a keyed stream scoped to the market. Legacy `supply` labels are not used to infer quantities. Imported/native legacy sectors remain economically uninitialized until an explicit GM action.
- Per-turn inventory accounting currently satisfies `closing = opening + production - consumption - overflow`. The local economy ledger records the local production/consumption balance for the inventory snapshot at the start of that phase. Logistics runs arrivals before the local balance and committed departures after it; those transfer movements and any transit losses are recorded separately in the logistics ledger.
- Price targets respond to stock coverage against target stock, with a bounded first-pass multiplier and a maximum movement of 8 index points per turn. These coefficients are initial campaign abstractions for future tuning.
- The canonical application version is `1.3.10`; the root sector schema remains version 3. Engine-version strings identify implementation revisions independently from each module’s schema lineage. The transport engine remains at `1.3.7` because its source contract did not change in this milestone; the economy, logistics, settlement and political integration were revised.


`simulation/logistics-engine.js` adds the first persistent inter-market movement layer. Its browser-global API is:

| API | Contract |
|---|---|
| `initialize(sector)` | Adds the logistics state under `sector.simulation.economy.logistics`; no shipment or turn is created. |
| `getPath(sector, fromSystemId, toSystemId, commodityId)` | Returns the current weighted operational path, route IDs, system IDs, estimated transit turns, cost components, and aggregated route-risk exposure. It does not reserve capacity. |
| `getRouteProfile(route)` | Returns configured route settings or clearly labelled provisional defaults. |
| `processArrivals(sector, turnNumber)` | Processes due in-transit legs exactly once, applies final-market storage limits, and records arrival/loss ledger events. |
| `planAndDispatch(sector, turnNumber)` | Retries waiting legs, evaluates exportable market surplus against shortages, and commits new shipments while consuming route capacity. Duplicate turns are skipped. |
| `getShipments(sector)` / `getSummary(sector)` | Returns persisted shipment records and aggregate status counts. |
| `validate(sector)` | Checks stable IDs, cargo quantities, shipment states, and route references. |

A campaign button press calls `SectorSimulation.advanceCampaignTurn()`. The coordinator JSON-clones the sector and advances the legacy faction simulation on that staged copy. The legacy faction engine remains authoritative for faction asset actions, combat, upkeep, faction credits, news and history. After syncing clocks and recording the faction phase, the coordinator refreshes derived state, runs `SectorEconomy.advanceTurn()` for contract preparation, transport charges, shipment arrivals/losses, delivered-goods payments, local production/consumption, network-aware prices, shipment dispatch, settlement, automatic faction diplomacy, formal politics and strategic/corporate decisions, then records the committed phases and validates all relevant engines. Only after successful validation does it replace the live sector's properties from the staged copy. A handled error discards the staged copy and leaves the live sector unchanged for retry. The committed-turn journal is retained according to `simulation.settings.historyRetention.turnJournal` (default: 20 entries in 1.3.10.1); older entries move to the coordinator archive. This in-memory staging is not durable browser-crash recovery. Shipment arrivals credit only final destination markets; intermediate systems do not become inventory owners. Campaign-panel rendering does not advance simulation or reconcile linked campaign data.

#### Implemented 1.3.4 logistics behaviour and limits

- Route profiles use canonical top-level `sector.tradeRoutes[]` fields: `capacityPerTurn` (abstract cargo units per turn), `transitTurns`, `freightCostPerUnit`, `tollPerUnit`, `operatingCostPerUnit`, `riskPercent`, and `direction`. The editor writes GM changes to these fields and marks each as a field override. Missing values receive derived provisional defaults without silently mutating the route record: capacity `32 / distance`, transit `max(1, ceil(distance / 2))`, freight `distance × 1.25`, toll `0`, and risk `2 + 2 × distance` percent.
- Route direction supports `both`, `forward`, and `reverse`. Capacity is counted independently per route and direction for each campaign turn. Cargo capacity is consumed in abstract cargo units: shipment lots are multiplied by each commodity’s `freightUnitsPerLot`. Category defaults vary by commodity class and a GM can override freight units and handling class. Handling classes are descriptive capacity profiles only; they do not yet enforce specialized storage, hazard controls, or spoilage.
- Weighted path selection considers per-leg transit duration, freight, toll, tariff, and risk. It uses the shared `TradeRouteRules.isOperational()` eligibility rule. A route with zero capacity is not considered. If a chosen leg later becomes unavailable, the shipment attempts a new path from its current system.
- The automatic planner exports unlocked stock above `115%` of its target stock to markets below `70%` target stock for the same commodity. Pending inbound shipments reduce repeated demand. A new-shipment cap of 250 per turn bounds planning work. These thresholds are initial policy constants, not a complete market-clearing algorithm.
- Each shipment stores its itinerary, current system/leg, per-leg arrival turns, cargo quantity, delivery remainder, costs, risk exposure, status, and creation/departure/delivery turns. Multi-hop legs cannot be skipped. If capacity is unavailable, the shipment waits; if no valid route exists, it remains delayed; if destination storage is full or GM-locked, delivery waits instead of silently discarding cargo.
- The route risk percentage is a deterministic per-leg incident chance, keyed by sector seed, turn, shipment, and route. A successful incident roll results in either a one-turn delay or a recorded loss of 5–20% of the cargo. The actual chance of cargo loss is one quarter of the route incident branch; this is a provisional game abstraction.
- Relationships between controlled systems apply basic posture defaults and optional GM trade policy. Flat editable fields are `tradeAccess`, `tradeTariffPercent`, `tradeTransitRights`, and `embargoCommodityIds`; the engine also reads nested `tradePolicy` values for compatibility. Alliances/trade pacts default to preferred access, Neutral to open, Strained/Rivalry to restricted, and Open conflict to embargoed. GM access can override the posture default; revoked transit rights or a matching commodity embargo still block the route.
- Freight, toll, and tariff totals remain recorded on shipments and logistics ledger entries. Each committed leg settles freight/toll to the route operator and tariffs to the destination controller or Customs Authority. Route operating expense is separately transferred from the route operator to the infrastructure-services account. On final delivery, the destination market-clearing account pays the shipment’s recorded sale unit price for only the quantity physically delivered; partial delivery pays only the delivered remainder and each payment is idempotent.
- The global logistics ledger and per-market `logisticsLedger` record exports, departures, transit losses, leg arrivals, final arrivals, and deliveries. Local economy turn ledgers remain specific to their local production/consumption phase. In 1.3.9, configurable hot-history limits bounded retained logistics/market/settlement/contract/transport ledger detail. In 1.3.10, records moved out of those hot windows are deep-cloned into typed GM-side `archive.records` collections; completed terminal shipments retain the full shipment object and every route leg. Active shipments remain complete and are never compacted. Detailed rows already reduced to summaries by 1.3.9 cannot be reconstructed. See the retention section near the end of this document for archive semantics and limits.

`simulation/trade-contract-engine.js` adds referee-authored recurring supply commitments under `simulation.economy.contracts`:

| API | Contract |
|---|---|
| `initialize(sector)` | Initializes contract records, ledger, sequence, and turn clock without dispatching cargo. |
| `create(sector, draft, turn)` | Validates two markets in distinct systems, matching commodity accounts, positive volume, date range, unique ID, and non-overlapping active lane terms; creates a GM-authored record. |
| `getContracts(sector)` / `getLedger(sector)` | Reads contract state and its append-only dispatch/delivery/loss ledger. |
| `prepareTurn(sector, turn)` | Archives the previous prepared turn (up to 24 entries per contract), resets per-turn counters, and expires scheduled contracts; duplicate turns are skipped. |
| `getMatchingContract(sector, origin, destination, commodity, turn)` | Returns the highest-priority eligible active agreement and remaining volume for a specific lane. |
| `recordDispatch` / `recordDelivery` / `recordLoss` | Records actual committed shipment outcomes; it does not create inventory or bypass logistics. |
| `getSummary(sector)` / `validate(sector)` | Reports active/paused/expired terms and validates IDs, lane/date conflicts, and contract terms. |

A fixed contract price is locked to the shipment at dispatch. A zero `unitPriceCr` means the regular origin/destination midpoint is used for that shipment. Contracted quantity is prioritized but limited by current export surplus, destination need, route/cargo capacity, ordinary border policy, transit results, and storage. The planner still permits spot trade for remaining need. Contracts are volume targets rather than delivery guarantees.

`simulation/settlement-engine.js` adds referee-facing campaign finance under `simulation.economy.settlement`:

| API | Contract |
|---|---|
| `initialize(sector)` | Creates missing faction, corporation, market-clearing, and service accounts once; preserves existing balances. |
| `settleRouteLeg(sector, shipment, leg, turn)` | Posts freight/toll/tariff plus route operating expenses once per committed leg and stamps the leg with settlement transaction IDs. |
| `settleCommodityDelivery(sector, shipment, deliveredQuantity, turn)` | Pays only the newly delivered, previously unpaid quantity at the shipment’s recorded dispatch-time unit price; repeated calls are idempotent. |
| `getAccounts(sector)` / `getLedger(sector)` | Returns the current Cr accounts and persistent transfer ledger. |
| `getSummary(sector)` / `validate(sector)` | Returns aggregate transfer/debt information and checks account IDs, transaction references, and before/after arithmetic. |

These are estimated Cr campaign accounts, separate from legacy SWN FacCreds. Freight, toll, tariff, route operating expenses, and final-market commodity purchases settle as balanced transfers. The persisted `creditLimit` is currently an overdraft-warning threshold, not a hard borrowing or shipment limit.

`simulation/diplomacy-engine.js` advances unlocked bilateral faction relationships after logistics processing:

| API | Contract |
|---|---|
| `advanceTurn(sector, turn)` | Uses delivered bilateral trade, shipment incidents, and hostile faction events to adjust trust/tension and unlocked posture values once per sequential turn. |
| `getSummary(sector)` / `validate(sector)` | Reports existing postures, recorded changes, and relationship integrity. |

It respects relationship-wide/manual and field-level locks. Polity relationships retain their separate vocabulary and are not evolved by this module.

`simulation/strategic-engine.js` creates bounded faction and corporate market assessments:

| API | Contract |
|---|---|
| `advanceTurn(sector, turn)` | Assesses controlled/linked market stock conditions and sets automatic import-priority signals after the current dispatch pass. |
| `getFactionReports(sector)` / `getCorporateReports(sector)` | Returns the most recent strategic/intelligence reports. |
| `getMarketImportPriority(state)` | Resolves GM-locked policy values ahead of automatic priorities. |
| `validate(sector)` | Checks stored report priority and turn fields. |

The resulting import priority influences the next logistics planning pass. This is not yet full autonomous faction or corporate action selection.

`simulation/sector-simulation.js` exposes the following browser-global API:

| API | Contract |
|---|---|
| `migrateSector(sector, options)` | Adds/normalizes the simulation envelope; preserves all existing root data. |
| `getProvenance(entity)` | Resolves known generated/imported/simulated/manual origins; returns `legacy` when unknown. |
| `isFieldOverridden(entity, field)` | Checks object-wide manual ownership or a field-level override. |
| `setFieldOverride(entity, field, value)` | Applies a GM value and records a field-level lock. |
| `clearFieldOverride(entity, field)` | Removes a field-level lock without changing its current value. |
| `createRandomStream(sector, {turn, phase, scope})` | Derives an isolated ephemeral stream from the immutable sector seed and its turn/phase/scope key. |
| `nextRandom(stream)` / `randomInteger(stream, ...)` | Advances only the supplied local stream; no sector-wide draw counter exists. |
| `syncLegacyTurn(sector)` | Keeps the new simulation clock aligned with the existing faction-turn control during the transition. |
| `recordEvent(sector, event)` | Appends a sequenced event to `simulation.chronicle.events`. |
| `calculateDerivedState(sector)` | Pure route topology and multi-hop market-reachability calculation; does not write to the sector. |
| `refreshDerivedState(sector)` | Explicitly commits the resulting fingerprint to `simulation.derived.lastFingerprint`; does not persist the full graph. |
| `isTradeRouteOperational(route)` | Alias of the single `TradeRouteRules.isOperational` predicate shared with CampaignTools. |
| `validateSector(sector)` | Read-only structural diagnostics for IDs and cross-references, including polity membership/relations. |
| `getSchemaInfo()` | Exposes current simulation and legacy schema versions. |

New sectors are migrated in `App.generateSector()` with the current `App.VERSION` as their source application version. Loaded native Forge saves and compressed links are migrated in `App.displaySector()` using existing provenance/version metadata, with unversioned native saves treated as 1.2 and SWN imports labelled unknown. The 1.3.1 build used the same incorrect `1.2` marker for new sectors and loaded 1.2 saves; those existing ambiguous labels are deliberately preserved rather than guessed. The application explicitly refreshes the compact derived fingerprint after loading and after relevant map/route changes. The migration remains separate from enrichment.

## Required invariants for later stages

1. **No hidden turn advancement:** opening a panel, rendering a map, saving, exporting, refreshing market drivers, or recalculating derived state cannot advance the simulation.
2. **Idempotent derivation:** the same canonical input produces the same derived state and fingerprint.
3. **Explicit simulation time:** production, consumption, shipments, market price changes, diplomacy evolution, and faction decisions occur in a defined campaign-turn order.
4. **GM authority:** manual values and field locks cannot be overwritten by automatic processes.
5. **Import integrity:** preserve-mode imports retain source records and imported values; migration is not content enrichment.
6. **Economic conservation:** goods transferred by shipping are debited from origin and credited to destination, with losses/fees/consumption explicitly recorded.
7. **Capacity enforcement:** shipments cannot exceed route/vehicle/network capacity.
8. **Causal event history:** major outputs point to the input/event that caused them.
9. **Private Chronicle:** referee notes and GM-only simulation records are excluded from player-safe exports unless a later explicit export policy says otherwise.
10. **Static/offline compatibility:** no backend or network connection is required for simulation operation.

## Implementation roadmap

1. **Foundation (1.3.2):** 1.2 preservation, schema envelope, accurate creation-version provenance, keyed turn/phase/scope randomness, canonical field-override map, shared route eligibility rule, pure route topology plus explicit fingerprint commit, polity-aware validation.
2. **Local economy (1.3.3):** per-market accounts, explicit initial stocks, local production/consumption, inventory conservation, unmet demand, stock-sensitive pricing, ledgers, and Chronicle integration.
3. **Inter-market logistics (1.3.4):** weighted operational paths, route capacity/direction, transit, freight/tolls, deterministic transit incidents, persistent multi-hop shipments, automatic surplus-to-shortage dispatch, and basic diplomatic border access.
4. **Financial settlement, automatic diplomacy, and strategic intelligence (1.3.5):** leg-level Cr transfers, bounded signal-driven trust/tension/posture updates, faction/corporate market assessments, and import-priority signals for the next logistics pass.
5. **Economic and logistics refinement (1.3.6):** differentiated commodity freight, delivered-goods settlement, route operating expense, recurring GM supply contracts, and contract/spot planning integration.
6. **Strategic actors and transport infrastructure (implemented 1.3.7):** condition-driven faction action scoring and target selection; bounded uncertainty and decision explanations; corporate opportunity analysis, supply-contract negotiation/performance response, capital conservation, and fleet investment; persistent port/fleet ownership, capacity, speed, reliability, and recurring operating costs.
7. **Formal politics, competition, campaign transactions and Chronicle (implemented 1.3.8):** distinct polity relations; referee-managed treaty lifecycle, scoped sanctions, war/ceasefire/peace; political route access; bounded reachable-supplier pricing; atomic in-memory turn staging and rollback; pure campaign-panel rendering; searchable Chronicle with causal shipment links; and an integrated disruption-to-recovery scenario.
8. **Final inspection and release hardening (1.3.9–1.3.10):** regression coverage, retention/recovery hardening, privacy fixes, documentation and quality-of-life corrections were completed across these releases. Deployed-browser Worker testing, real IndexedDB transaction verification, unrestricted high-volume campaigns and coefficient calibration remain open verification work. No unrelated major simulation subsystem is planned for this hardening window.

## 1.3.7 actor/transport boundary (historical; retained in 1.3.8)

1.3.7 replaces equal-weight/random faction action selection with a seeded score-and-rank model over the legal actions already exposed by the faction-turn engine. Inputs include faction goal profile, assets and their condition/readiness, faction resources, treasury pressure, market shortages/surpluses in controlled systems, system/route/market importance, legal attack targets, rival posture, neighboring relationships, and GM autonomy/manual-control settings. The selected action carries an explanation, score, confidence, risk, alternatives, target references, and an explicit note about bounded uncertainty. A close lower-scoring action may occasionally be selected; the model is deliberately fallible, not omniscient. Existing faction asset execution, combat, upkeep, and turn-history mechanics remain the execution authority.

Corporate autonomy is a separate decision path. It evaluates only markets linked to the corporation, checks actual reachable trade routes and available surplus/shortage, and can negotiate a limited recurring fixed-price supply agreement, hold capital when the case is weak, pause a repeatedly unfulfilled/high-loss owned agreement, or purchase and assign capacity to an overloaded route when capital permits. It does not simulate a full boardroom, stock market, real-time bidding, corporate mergers, or detailed profit-and-loss accounts. GM autonomy switches and actor-level manual-control/automatic-strategy locks take precedence.

Transport infrastructure adds persistent spaceports and fleets. Port handling constrains effective route throughput; commissioned fleets can add capacity, modify transit speed and reliability, and incur operating/maintenance Cr charges. A fleet's allocations across routes cannot exceed 100%. New sectors receive ports at market/route systems; old abstract routes remain operational at their previous capacity until a GM or autonomous organization adds fleet capacity. Fleet/port values are GM-editable and persistent. This remains an abstract transport model: vessels do not have individual positions, crews, fuel tanks, hull damage combat, ship classes with detailed rules, convoy schedules, docking queues, or physical cargo manifests. Specialized storage, spoilage, piracy/seizure, and port construction projects remain future work.

The 1.3.7 strategic coefficients and economic abstractions remain first-pass values requiring campaign playtesting. Strategic choices may be suboptimal and can be overridden. 1.3.10 adds bounded faction-level political autonomy that can propose and respond to selected formal instruments; it does not implement autonomous polity-to-polity diplomacy or open-ended bargaining. The 1.3.9 retention layer bounds recent hot event/ledger windows. 1.3.10.1 additionally caps detailed GM archive bodies globally (512 KiB default, configurable from 64 KiB to 10 MiB). Strategic decision logs and relation histories retain their own bounded policies; aggregate counters and long-lived settlement idempotency keys remain durable. Turn-scoped fleet/port maintenance keys are pruned after eight settled turns, with a clock-based stale-replay guard.

## Current 1.3.8–1.3.10 implementation boundary

Formal politics are referee-managed. Treaty proposals require an explicit acceptance or rejection; they do not bargain autonomously. Treaties can be renewed, terminated or breached by a signatory. Sanctions are direction- and optionally commodity-scoped. “Financial restriction” contributes a border-risk modifier; it does not freeze account balances or seize property. War, blockade, humanitarian commodity exceptions, ceasefire and peace transitions use explicit effective turns. Faction diplomacy remains a separate bilateral model. Directed polity relations are not silently reciprocated.

Network competition evaluates reachable markets with actual operational routes and combines source surplus, destination demand, estimated landed price, route costs, time and risk. It applies bounded import discounts/export premiums and weights expected inbound cargo by ETA/risk; those estimates never count as physical inventory and do not guarantee deliveries. It is a pricing influence, not a complete market-clearing algorithm, predictive planner or macroeconomic model.

The campaign turn uses a JSON-cloned staging copy and commits only after all phases and engine validations succeed. Handled failures preserve the original live sector and permit retry. The coordinator journal records committed phases only and uses the configurable `turnJournal` retention limit (default 20 in 1.3.10.1); process/browser crashes do not have durable phase-level resume data. `App.renderCampaignPanels()` no longer performs reconciliation; explicit load/edit commands own migration/linking/derived refresh. The GM Chronicle exposes category/search filters and causal metadata. Its hot event window and most engine ledgers use the configurable retention policy, and newly compacted records are first deep-cloned into typed GM-side `archive.records` arrays alongside counts/totals. A global detailed-history byte budget then prunes oldest archive bodies until under budget; the default is 512 KiB and can be configured from 64 KiB to 10 MiB. Completed shipment detail is retained until budget pruning; when pruned, a compact settlement/reconciliation stub remains. Active shipments are never compacted. Aggregate counters and long-lived settlement idempotency keys remain durable. Turn-scoped maintenance idempotency keys expire after eight settled turns; the settlement clock rejects stale replays. Detailed rows already discarded by the 1.3.9 compact-summary format cannot be reconstructed.

The 1.3.10 focused Node suites and inherited browser checks did not substitute for an unrestricted high-volume campaign audit. The 1.3.11 release adds a full coordinated-turn benchmark and exercises the shared Worker queue handlers through an adapter in inline Chromium; the actual worker source is also tested on a Node worker thread. The managed browser policy still prevents a localhost/hosted-origin run, and the opaque inline origin denies IndexedDB, so native IndexedDB transaction recovery and deployed HTTPS Worker construction remain unconfirmed. An accessibility-name audit, UI status semantics and keyboard/focus checks are included; coefficient calibration still requires real campaign playtesting.


## 1.3.10 / 1.3.10.1 history retention and campaign-scoped local recovery

`SectorSimulation.getHistoryRetentionPolicy(sector)` returns the per-sector limits. `SectorSimulation.setHistoryRetentionPolicy(sector, updates)` clamps configured limits to a safe range (4–100,000) and immediately applies compaction. The 1.3.10.1 defaults are 150 Chronicle events, 300 sector economy ledger entries, 4 entries per market commodity ledger, 500 logistics ledger entries, 500 shipment details, 300 settlement transactions, 300 contract ledger entries, 300 transport ledger entries, 200 diplomacy events, 250 politics events, 25 entries per treaty/sanction/war history, 20 turn-journal entries, and 20 faction-turn history entries.

Compaction removes old records from bounded hot arrays and temporarily preserves their detail in typed GM-side archives alongside aggregate counts/totals. A global byte budget (512 KiB default; configurable from 64 KiB to 10 MiB) then prunes the oldest detailed archive bodies first. Settlement archives preserve exact external idempotency keys and reconciliation metadata even after transaction detail is pruned. Terminal shipment detail may be pruned to a compact stub retaining IDs, cargo/payment quantities and settlement references so reconciliation can still validate; active cargo is never compacted. Shipment sequence counters advance beyond archived IDs. Detailed bodies already removed by the 1.3.9 summary-only implementation cannot be rebuilt from totals.

The Export workspace offers opt-in local recovery snapshots. Manual and debounced automatic snapshots use IndexedDB in the current browser profile and contain the full GM sector. Each snapshot is keyed by a stable campaign recovery identity; a separate latest pointer makes the most recently saved campaign easy to restore without overwriting another campaign's snapshot. Deleting a campaign snapshot preserves the others and promotes the newest remaining snapshot. They are not transmitted, synchronized or encrypted by Sector Forge. A checksum detects accidental corruption; it is not an authenticity or security mechanism. Shared devices and browser-profile access remain a privacy risk. The feature never replaces the portable GM JSON export as the primary backup. The transaction-level IndexedDB behavior is covered by a storage test double in this release but remains unverified in a real browser IndexedDB round-trip in this environment.


## 1.3.10.1 maintenance behaviour

Transport, logistics, political, market-state and settlement lookups now use object-scoped ID indexes; inbound shipment quantities are indexed once per turn rather than rescanned for each inventory line. The faction-turn control yields before synchronous turn resolution and visibly enters a busy state, but the simulation is not moved into a browser Worker: very large campaigns can still occupy the main thread during a turn.

AI ceasefire and peace flows use proposal/response records. Only the opposing war participant may accept, and an acceptance takes effect on a later turn; direct referee actions are clearly labelled as referee-authored outcomes. Rejected regular treaty proposals are suppressed during a five-turn cooldown.

Recovery uses campaign identity first and a sector-map fingerprint for legacy snapshot lookup. Cached IndexedDB connections are reset/reopened after close/version-change/invalid-state signals. The actual browser IndexedDB transaction path remains unverified in the restricted opaque-origin test environment; storage matching/reconnect behaviour is covered with a test double.

## 1.3.10.2 maintenance behaviour

The route planner keeps a runtime-only graph cache keyed by commodity and base price, plus a shortest-path tree keyed by that graph and origin system. Entries are scoped to one sector object and campaign turn. They are cleared when the turn changes, when relevant route/political/transport collection identities change, when a political or transport mutation API changes access, or when a persisted in-app campaign edit calls `App.persistSector()`. Direct script edits to sector objects must call `SectorLogistics.invalidatePathCache(sector)` before another path query. This is intentionally runtime-only: caches are not serialized and never affect deterministic campaign state.

Logistics shipment/ledger sequence counters and settlement transaction sequence counters are reconciled against persisted history on first use or when their backing arrays/archive objects change. Normal engine appends update the counters and refresh their runtime cache immediately; this removes whole-history reductions from repeated `ensure()` / `finance()` calls while retaining safe save/load reconstruction.

Live economy history has a separate 1 MiB default JSON-byte budget, configurable per sector from 128 KiB to 16 MiB through `SectorSimulation.setHistoryRetentionPolicy(sector, {liveEconomyHistoryBudgetBytes})`. It covers economy, market and market-logistics, logistics, settlement, contract, and transport ledgers. Oldest rows move into their typed archives until the budget is met, with the newest row in each individual ledger protected. The existing detailed archive-body budget remains separate at 512 KiB by default. These are history budgets, not a hard maximum for total sector JSON; active shipments, inventories, accounts, relationships and other canonical campaign state still contribute to save size.

Ceasefire and peace proposals carry a three-turn response window. On the first political turn after the window closes, unanswered proposals become `expired`, receive a history entry and Chronicle event, and no longer block a replacement proposal. CSV imports preserve complete records but omit an unfinished final quoted record with a visible diagnostic; if no complete data row remains, import fails with the diagnostic attached. The file-import UI restores the generator screen on parse/read failure or abort and does not replace the prior campaign.



## 1.3.11 political/logistics turn coherence

`SectorEconomy.advanceTurn()` now advances diplomacy and formal politics after scheduled transport/arrival processing but before the local-market competition and `SectorLogistics.planAndDispatch()` phases. Political state therefore governs the first market pricing/route evaluation and new shipment dispatch on its effective turn. The diplomacy-before-politics sub-order remains deliberate: formal faction war state writes the authoritative open-conflict relationship after bilateral diplomacy updates.

`SectorPolitics.advanceTurn()` reports `tradeAccessChanged` and invalidates the sector's runtime path cache when a pending peace settlement becomes peace, a ceasefire expires into active war, or a formal war transition writes `Open conflict`. This prevents a graph/shortest-path tree warmed earlier in the same turn from retaining old border reachability, risk, or tariffs. Direct scripted mutations to mutable route/political objects still need to call `SectorLogistics.invalidatePathCache(sector)`.

The integration regression `tests/political-turn-order.cjs` verifies the two reported cases through the real economy-turn coordinator. `tests/performance.cjs` measures `SectorSimulation.advanceCampaignTurn()` on a generated 36+ system / 70+ market sector, including faction actions and engine validation.
