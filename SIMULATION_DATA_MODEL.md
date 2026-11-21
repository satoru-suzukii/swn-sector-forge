# Sector Forge 1.3 — Simulation Domain Model

**Status:** Local market accounts (1.3.3), inter-market logistics and trade access (1.3.4), financial settlement and limited automatic faction diplomacy (1.3.5), delivered commodity payment and recurring supply contracts (1.3.6), condition-driven faction/corporate strategy plus port/fleet infrastructure (1.3.7), formal politics, network competition, causal Chronicle, render purity and atomic in-memory campaign turns (1.3.8), configurable hot-history retention (1.3.9), and faction-level political autonomy, reliability-aware corporate supplier competition, detailed archives and campaign-scoped local recovery (1.3.10) are implemented; 1.3.10.1 adds a global detail-byte budget, bilateral conflict-transition consent and legacy snapshot lookup; 1.3.10.2 adds runtime path/sequence caches, a separate live-history byte budget, campaign-ID-safe recovery, CSV truncation diagnostics and finite conflict-proposal response windows; 1.3.11 synchronizes effective political turn changes with market pricing and logistics dispatch and invalidates stale route caches. Specialized cargo custody and durable process-crash phase recovery remain outside the current simulation model. Newly compacted records initially retained full detail in 1.3.10; 1.3.10.1 caps detailed archive bodies at 512 KiB by default and prunes oldest detail while retaining aggregates and reconciliation keys. Older 1.3.9 summary-only records cannot be reconstructed. Historical version references below identify when each contract was introduced.

Related: [SIMULATION_ARCHITECTURE.md](SIMULATION_ARCHITECTURE.md)

## Local-market state (implemented in 1.3.3; extended in 1.3.4)

The current implementation is `simulation/economy-engine.js` (`SectorEconomy`). It stores dynamic local market state at `sector.simulation.economy`, with one active record per initialized market in `marketStates[]`:

- `schemaVersion`, `engineVersion`, `initialized`, `initializedAtTurn`, and `clock` describe the local economy version and explicit turn position.
- `commodities[]` is the catalogue snapshot available to this sector.
- `marketStates[]` contains `marketId`, current world references (`systemId`, `planetId`), population/Tech Level factors, production and consumption schedules, inventory, local prices, policies, and per-market ledgers.
- `ledger[]` is a compact sector-level index to full market ledgers; line details remain inside each market state.
- `retiredCommodities[]` on a market state retains former stock/price/rate records if a commodity is removed from the market list.

Each current inventory line includes `commodityId`, `onHand`, `reserved`, `targetStock`, `storageCapacity`, `averageUnitCost`, and `source`. In 1.3.6 the catalogue assigns category-based `freightUnitsPerLot` and a `storageClass`; prior GM overrides are preserved during migration. Production and consumption records include `quantityPerTurn`, `generatedQuantityPerTurn`, `source`, and a reason. Price records keep a reference price/index, current and target price indices, source, and last-turn movement.

**Initialization rules:**

- A newly generated Sector Forge 1.3.3+ sector initializes local market accounts automatically.
- A native legacy sector or Sectors Without Number import stays uninitialized until the GM presses **Initialize local economy**. That action creates an explicit new stock baseline; it does not reconstruct historical inventories.
- Opening stock is derived deterministically from current local rates using the keyed stream `economy.initial-stock` scoped by market ID. The legacy `supply` label (`surplus`, `available`, `shortage`, `rare`) is never used to infer quantity.
- Accounts currently cover only the goods present in each market's existing `goods[]` list (normally eight per generated market), not every catalogue commodity at every market.
- Initial local schedules use categorical population factors, Tech Level, market profile, and a deliberately limited exact mapping of selected SWN tags. Unknown population descriptions use a conservative fallback; arbitrary descriptions and all SWN tags are not interpreted automatically.
- A world/market driver refresh updates unlocked production/consumption schedules and target-stock baselines without resetting existing stock. Manually locked schedule quantities remain intact. Goods removed from a market are retained under `retiredCommodities[]` rather than silently discarded.

**Local economy ledger accounting:** for each local commodity account during the local production/consumption phase, the implemented ledger satisfies:

```text
closing = opening + production - consumption - overflow
```

Manual stock locks pause the automatic production/consumption adjustment for that stock line. Reservations are protected from consumption. Current prices respond to closing stock relative to `targetStock`; target prices are clamped to 40–300 index points and the displayed index moves by at most 8 points per campaign turn. These are initial tunable coefficients, not calibrated economic forecasts. In 1.3.4, shipment arrivals are processed before the local market phase and shipment departures are committed after it; those transfers and transit losses are recorded in a separate logistics ledger rather than mixed into the local production/consumption ledger.

The legacy market goods and their `supply`, `priceIndex`, and `localPrice` fields remain the compatibility/display layer. Economic account state lives in the GM simulation envelope; the existing player-safe export projection continues to omit that simulation envelope.

### 1.3.3 first-pass coefficient defaults

These constants are initial campaign abstractions and are intentionally tunable in `simulation/economy-engine.js`:

- Population factors: failed colony `0.25`, outpost `0.4`, fewer than a million `0.65`, several million `1.0`, hundreds of millions `1.8`, billions `2.8`, alien inhabitants `0.9`; unknown labels conservatively use `0.65`.
- Tech Level factor: `clamp(0.55 + TL × 0.14, 0.55, 1.3)`.
- Category demand rates are multiplied by the population factor. Current base weights are Agricultural `1.1`, Food `1.25`, Medical `0.22`, Industrial `0.32 × tech`, Technology `0.16 × tech`, Energy `0.3 × tech`, Bulk `0.35`, Cultural `0.1`, Luxury `0.08`, Mineral `0.12 × tech`, Biological `0.18`, Consumer `0.3`, Restricted `0.06`, and Salvage `0.05`.
- Generated output is `populationFactor × techFactor × productionMultiplier × 0.48`. The multiplier combines a market-profile specialization with `1.45` for each supported exact tag mapping; controlled markets receive a small `1.04` factor. The current mapping is deliberately limited and does not attempt to interpret all SWN tags or arbitrary descriptions.
- `targetStock = max(2, demandPerTurn × 4 + productionPerTurn × 1.5)`. Opening stock uses a keyed factor from `0.75` to `1.25` of target stock, capped at three times target stock. Storage capacity is at least three times target stock.
- Price target multiplier is `clamp(1.3 - min(2, available / targetStock) × 0.3, 0.7, 1.3)`, applied to the reference price index. Target indices are clamped to 40–300; current indices move no more than 8 points per turn.
- A Post-Scarcity world tag reduces the affected local demand schedules to 35%; a Refugees tag increases Food, Medical, and Agricultural demand by 50%.

These are not claimed as economically calibrated values. Later milestones should use controlled scenarios and GM playtesting to adjust the rates while retaining monotonic scarcity behavior, bounded prices, and ledger conservation.

## 1. Design decisions

1. The existing 1.2 sector collections remain the canonical source for systems, worlds, markets, routes, factions, corporations, polities, and faction diplomatic relationships. Polity relations remain nested under each polity and use their own vocabulary.
2. Dynamic campaign state belongs under the versioned `sector.simulation` envelope; it must not be confused with generated world facts or GM-authored descriptions.
3. Derived topology, influence, access, and market reachability are calculated from canonical data and are not treated as independent facts.
4. Economy, logistics, diplomacy, and faction turns advance through an explicit turn coordinator. UI rendering and saving never run a simulation phase.
5. Old saves are migrated additively. Unknown quantities stay unknown until an explicit initialization process establishes them; a legacy `supply` label is not a measured inventory.
6. Every automatic value has a traceable origin. GM overrides take precedence over automatic calculation.
7. All quantities and capacities must use documented units. The engine must not add or compare incompatible units.

## 2. Ownership map

| Information | Authoritative owner | Notes |
|---|---|---|
| System coordinates, names, star data | `sector.systems[]` | GM/import/generated canonical facts. |
| World population label, Tech Level, tags, resources | `sector.systems[].planets[]` | Source for economic potential; explicit GM overrides win. |
| Market identity, location, profile, GM traits | `sector.markets[]` | Canonical market record. |
| Commodity catalogue | Versioned Sector Forge catalogue + sector custom definitions | Existing 28 `CampaignTools.TRADE_GOODS` are the migration source, not an inventory. |
| Market production and consumption schedules | `sector.simulation.economy.marketStates[]` | Dynamic or GM-overridden rates. |
| Market inventory and reservations | `sector.simulation.economy.marketStates[].inventory[]` | Authoritative current quantities. |
| Market price state | `sector.simulation.economy.marketStates[].prices[]` | Target, current, and GM reference prices. |
| Trade-route endpoints, type, status, custom notes | `sector.tradeRoutes[]` | Canonical route definition; manual routes remain GM-owned. |
| Route logistics and GM overrides | Top-level fields on `sector.tradeRoutes[]` | `capacityPerTurn` (cargo units/turn), `transitTurns`, `freightCostPerUnit`, `tollPerUnit`, `operatingCostPerUnit`, `riskPercent`, and `direction`; missing fields use derived provisional defaults. |
| Actual shipments and cargo ledger | `sector.simulation.economy.logistics` | Persistent itineraries, per-leg progress, cargo-unit capacity use, costs, delivered-goods price/payment fields, and global ledger. |
| Commodity catalogue freight profiles | `sector.simulation.economy.commodities[]` | Category-default `freightUnitsPerLot` and descriptive `storageClass`; explicit GM overrides persist. |
| Recurring supply contracts | `sector.simulation.economy.contracts.records[]` | GM-authored per-turn shipment targets, pricing, active dates/status, priority, delivery/loss history, and contract ledger. |
| Route infrastructure expenses | `sector.simulation.economy.settlement` | Separate operator-to-infrastructure service transfers per dispatched cargo unit. |
| Relationship posture, trust, tension | `sector.diplomacy[]` | Existing exact GM-editable relationship records remain authoritative. |
| Trade permissions, tariffs, embargo rules | `sector.diplomacy[]` | Flat editable fields `tradeAccess`, `tradeTariffPercent`, `tradeTransitRights`, `embargoCommodityIds`; nested `tradePolicy` is also read if present. |
| Faction identity, stats, assets, strategic goal | `sector.factions[]` | Existing faction model remains canonical, with simulated changes tagged by provenance. |
| Polity identity, government, capital, members, policy, stability | `sector.polities[]` | Separate political-bloc model; member systems point back through `system.polityId` / `system.polityName`. |
| Polity-to-polity relations | `sector.polities[].relations[]` | Directed records keyed by `polityId`; uses the polity vocabulary below, not faction diplomacy states. |
| Faction decision evaluations and event history | `sector.simulation` + Chronicle | Inputs, selected actions, rolls, causes, and effects are recorded. |

### Provenance and field ownership

New field-level GM locks use one canonical map: `fieldOverrides: { fieldName: true }`. The older 1.3.1 `manualOverrides` map is accepted only as a migration input; when provenance/override helpers touch a record, its true entries are merged into `fieldOverrides` and the legacy key is removed. New writes must never create `manualOverrides`. Object-wide `manualOverride` / `isManual` flags remain separate provenance signals and are not aliases for the field map.

`source` classifies a record as `generated`, `imported`, `simulated`, or `manual` when known. Unknown legacy records remain valid. Derived caches are not canonical records: `simulation.derived.lastFingerprint` stores the last committed fingerprint only; topology and reachability are rebuilt from authoritative inputs.

## 3. Commodity catalogue

The existing 28 goods are retained. They gain stable IDs and consistent abstract trade units. A catalogue entry should look like:

```js
{
  id: "machine-parts",
  name: "Machine parts",
  category: "Industrial",
  unit: "trade-lot",
  basePrice: 1100,
  freightUnitsPerLot: 2,
  storageClass: "standard",
  canBeProduced: true,
  canBeConsumed: true,
  tags: ["industrial-input"]
}
```

`trade-lot` is an abstract, consistent unit for the campaign economy. The unit is deliberately not assumed to mean a tonne, crate, individual machine, or any other physical measure. `freightUnitsPerLot` converts commodity quantity into shared route-capacity units.

Catalogue requirements:

- Each commodity has a stable ID independent of its displayed name.
- Existing display names and base prices remain available for compatibility.
- Custom GM-defined goods receive stable sector-local IDs and must survive export/import.
- Catalogue revisions are versioned. A future catalogue update must not silently reinterpret an old saved inventory.
- A commodity can have optional storage rules (perishability, degradation, hazardous handling, restricted status) without requiring every good to use every rule.
- A good's base reference price is not its current local market price.

The initial economy baseline must not infer stock quantities from existing `supply`, `priceIndex`, or `localPrice` fields. Those are legacy market indicators, not measured cargo ledgers.

## 4. Per-market economic state

Dynamic economic accounts live in `sector.simulation.economy.marketStates[]`, keyed by `marketId`, rather than replacing canonical market identity fields. The following compact shape shows the current 1.3.3 record plus selected future extension points:

```js
{
  marketId: "MARKET-004",
  initialized: true,
  source: "generated",
  production: [
    { commodityId: "machine-parts", quantityPerTurn: 18, source: "generated" }
  ],
  consumption: [
    { commodityId: "machine-parts", quantityPerTurn: 11, source: "generated" }
  ],
  inventory: [
    {
      commodityId: "machine-parts",
      onHand: 42,
      reserved: 4,
      targetStock: 30,
      storageCapacity: 160,
      averageUnitCost: 1040,
      source: "simulated"
    }
  ],
  prices: [
    {
      commodityId: "machine-parts",
      referencePrice: 1100,
      currentPrice: 1155,
      currentPriceIndex: 105,
      targetPriceIndex: 108,
      lastTurnChange: 2
    }
  ],
  policies: {
    importPriority: "normal",
    exportPriority: "normal"
  }
}
```

The numeric rates and values above are illustrative only. In 1.3.3 the account also includes `systemId`, `planetId`, `initializedAtTurn`, `generatedQuantityPerTurn`, `storageCapacity`, `retiredCommodities`, and full per-turn ledger lines. The local schedule coefficients are implemented first-pass abstractions; the catalogue still uses `trade-lot` as an abstract campaign unit.

### Quantity rules

- `onHand` is the physical inventory available at the market.
- `reserved` is already committed cargo and cannot be sold or consumed twice.
- `available = onHand - reserved`.
- `targetStock` represents desired buffer stock, not a guaranteed amount.
- `storageCapacity` is a hard limit; arrivals that exceed it must be rejected, diverted, or handled by an explicit overflow rule.
- `quantityPerTurn` is expressed in the commodity's catalogue `unit`.
- All calculations use finite non-negative quantities. Fractional quantities are allowed only where the commodity's unit definition allows them; rounding rules must be consistent.
- Production and consumption rates are schedules. A turn applies the rate once; rendering does not apply it again.

### Production and consumption derivation

In 1.3.3, initial and refreshed local schedules use a limited implemented subset of these drivers: categorical population, Tech Level, market profile, and explicit exact world-tag mappings. The remaining drivers are future extensions. The design target is a combination of:

- world tags and resources;
- Tech Level;
- population category;
- market profile and industrial specialization;
- infrastructure and relevant faction/corporate assets;
- local environment or special world conditions.

A world's population descriptions are categorical labels rather than exact population counts. The model must use explicit population bands or a documented scale factor rather than pretending the descriptions contain exact headcounts.

Each generated production/consumption line records its provenance and source reason (for example, the world tag or facility that contributed). GM-edited rates become manual overrides and are not recalculated until the GM clears the override.

## 5. Inventory accounting and market balance

The 1.3.3 local-ledger contract, retained by 1.3.4 for its local production/consumption phase, satisfies:

```text
closing on-hand
  = opening on-hand
  + production
  - consumption
  - overflow
```

The combined inventory accounting must include both market stock and cargo currently in transit:

```text
closing market stock + closing cargo in transit
  = opening market stock + opening cargo in transit
  + production
  - consumption
  - overflow
  - recorded transit losses
  + explicit GM adjustments
```

Shipment departure transfers quantity from origin stock into the persisted shipment; final delivery transfers it from the shipment into destination stock. Intermediate systems do not receive market inventory. The current implementation realizes this accounting across two ledger layers: local turn ledgers capture the production/consumption phase, while `economy.logistics.ledger` and each market state's `logisticsLedger` capture export/departure/arrival/loss movement. This split reflects the current turn order: arrivals occur before the local market balance; committed departures occur afterward. Transit cargo is represented by each active shipment's `remainingQuantity`.

Reservations are tracked separately and must not be double-counted as on-hand cargo. Current local turn lines record opening, production, actual/requested consumption, unmet demand, overflow, reserved amount, closing, price before/after, and whether stock was GM-locked. Every current balance is stored in a per-market turn ledger and the sector-level ledger index.

The simulation must never create or destroy goods silently. Losses (spoilage, piracy, accident, seizure, destruction) are explicit entries. Credits, tariffs, freight fees, and corporate income are accounted separately from physical cargo so a payment cannot alter inventory by accident.

### Surplus and shortage

- `surplus = max(0, available - targetStock)`.
- `shortfall = max(0, targetStock - available)`.
- Local demand should distinguish current-turn consumption from the desired buffer stock.
- A market can have high production and still be a net importer of another commodity.
- A market can be connected to suppliers and still experience shortage if capacity, trade access, or available surplus is insufficient.

## 6. Trade-route logistics

Existing `sector.tradeRoutes[]` remain canonical route records. In 1.3.4, route-operating settings are stored as top-level route fields so existing route identity/custom metadata remain intact:

```js
{
  capacityPerTurn: 120,
  transitTurns: 1,
  freightCostPerUnit: 3,
  tollPerUnit: 0,
  operatingCostPerUnit: 0.9,
  riskPercent: 8,
  direction: "both" // both | forward | reverse
}
```

These are illustrative configuration values. A route's general map distance is not automatically the same as travel duration, freight cost, or capacity. `capacityPerTurn` is expressed in abstract cargo units; `freightCostPerUnit`, `tollPerUnit`, and `operatingCostPerUnit` are assessed per cargo unit. When fields are absent, the 1.3.7 engine derives a provisional profile for simulation queries without writing those defaults back onto the route. The route editor can commit explicit GM values and stores field-level overrides.

Implemented 1.3.4 behaviour and remaining requirements:

- A route has explicit operational eligibility. Scout-only, closed, blocked, disrupted, suspended, and overextended routes do not carry ordinary commercial shipments.
- Missing profiles use these provisional defaults: capacity `32 / distance` cargo units per turn, transit `max(1, ceil(distance / 2))` turns, freight `distance × 1.25` per cargo unit, toll `0`, and risk `2 + 2 × distance` percent (capped at 95%). Defaults are not persisted until the GM explicitly configures the route.
- Capacity is measured in common `cargoUnits`, calculated from quantity × commodity `freightUnitsPerLot`.
- Capacity is shared by all shipments using the same corridor in the same turn and direction. Capacity is charged in cargo units using each commodity’s `freightUnitsPerLot` multiplier.
- A route can impose freight cost, toll, transit duration, risk, directionality, and diplomatic border restrictions. Route operating expense is now settled separately to the infrastructure-services account. Security service costs and detailed operator profitability remain unimplemented.
- A route can be made ineligible through its existing canonical status/topology fields (for example, blocked, disrupted, suspended, closed, or overextended); its canonical identity remains intact. Diplomatic access is additionally evaluated at each controlled border. Automatic blockade events, piracy events, seizure, and route recovery decisions are not yet generated.
- If a system moves, topology and distance-derived conditions recalculate. Existing manual routes remain present and may become overextended; shipment eligibility is recomputed rather than deleting the route. Current path selection does not reserve capacity in advance; if a route is full at dispatch, the shipment waits.

### Current 1.3.7 route and policy defaults

- `capacityPerTurn`: provisional `32 / distance`; `0` disables the corridor for cargo.
- `transitTurns`: provisional `max(1, ceil(distance / 2))`.
- `freightCostPerUnit`: provisional `distance × 1.25` per cargo unit; `tollPerUnit` defaults to `0`; `operatingCostPerUnit` defaults to `distance × 0.3` per cargo unit.
- `riskPercent`: provisional `2 + 2 × distance`, capped at 95. The per-leg deterministic incident roll can produce a one-turn delay or cargo loss of 5–20%.
- `direction`: `both`, `forward`, or `reverse`.
- Weighted path cost includes transit, freight, toll, tariff, and risk. Each segment checks the shared operational-route predicate and the controller relationship for that border.
- The planner automatically considers unlocked origin stock above 115% of target and destination deficits below 70% of target. Pending inbound cargo reduces the remaining deficit. A maximum of 250 new shipment records can be created in one turn.
- Catalogue defaults assign category-sensitive freight units and handling classes. `freightUnitsPerLot` changes abstract cargo-capacity consumption; the handling class is currently descriptive metadata and does not enforce refrigeration, hazardous-material rules, specialized storage, or spoilage.

## 7. Multi-hop shipment records

Trade should move through a path of connected markets, not only direct neighbours. A shipment is a persistent order with a route itinerary and progress:

```js
{
  id: "SHIP-0000123",
  commodityId: "machine-parts",
  quantity: 20,
  remainingQuantity: 20,
  deliveredQuantity: 0,
  cargoUnits: 20,
  originMarketId: "MARKET-001",
  destinationMarketId: "MARKET-014",
  originSystemId: "SYS-01",
  destinationSystemId: "SYS-14",
  currentSystemId: "SYS-08",
  routeIds: ["ROUTE-01", "ROUTE-08", "ROUTE-13"],
  currentLegIndex: 1,
  legs: [],
  status: "in-transit",
  departedTurn: 8,
  estimatedArrivalTurn: 11,
  ownerFactionId: "FACTION-02",
  freightCost: 6,
  tollCost: 0,
  tariffCost: 0,
  riskPercent: 8,
  source: "simulated",
  createdTurn: 8
}
```

The 1.3.4 persisted record stores `remainingQuantity`, `deliveredQuantity`, `currentSystemId`, `currentLegIndex`, `legs[]` (route, endpoints, departure/arrival turns, cargo units, costs, risk, incident, and loss), `currentLeg`, costs, and delay reason. It is a dynamic GM campaign record under `sector.simulation.economy.logistics.shipments[]`. Capacity use for each route/direction/turn is stored in `capacityUsage`; it is not a future capacity reservation.

Implemented shipment rules:

1. A shipment must have an origin, destination, commodity, positive quantity, and a valid connected itinerary.
2. Each route in the itinerary must connect to the next route's endpoint; no teleporting between unconnected systems.
3. The origin reserves or debits cargo when dispatch is committed, not merely when an offer is considered.
4. Every leg consumes capacity in the correct turn/direction.
5. Multi-turn transit persists across save/load. Cargo arrives only when its leg/itinerary completes.
6. A shortage, blockade, capacity loss, or political restriction currently causes waiting/delay or rerouting when a new operational path is available. Cancellation, seizure, and explicit GM adjudication workflows remain future features.
7. A reroute cannot make the cargo appear at destination earlier without accounting for transit.
8. On arrival, cargo is credited only up to destination storage capacity; remaining cargo waits until storage becomes available or the GM changes the relevant state.
9. Shipment costs and losses are recorded independently from cargo quantity.

The current weighted path cost uses per-leg transit duration, freight, toll, tariff and risk. It does not yet model dynamic route reliability or vessel/fleet availability. The automatic planner chooses a single origin/destination/commodity shipment at a time and may split the same market need across turns or suppliers; it does not optimize a global multi-commodity fleet schedule. Capacity shortages queue shipments for later retry.

## 8. Price formation

Existing `market.goods[]` remains a compatibility/UI projection while the new economy is introduced. Its legacy `supply`, `priceIndex`, and `localPrice` fields must not be mistaken for inventory truth.

The current 1.3.4 local price target uses:

- scarcity/surplus through stock coverage relative to target stock;
- recorded delivered freight/toll/tariff pressure, capped at 35% and decayed by 35% each turn;
- the GM/reference price and field-level overrides.

Expected-arrival forecasts, supplier reliability, direct tariff/market competition modelling, instability shocks, and corporate market power remain future price drivers. The tariff/freight cost is recorded on shipments; it is not automatically paid from a faction/corporate account.

Price response should be gradual rather than jump randomly on redraw. A stable approach is to calculate a target price index, then move the current index a bounded fraction toward it each turn. The response rate and hard bounds are implemented and tested; commodity-specific sensitivity and supplier competition remain future improvements. The current implementation uses the existing 40–300 index bounds for compatibility; the future model should make the reason for each change visible.

A displayed supply label should ultimately derive from inventory coverage or shortage pressure, not from the price index alone.

## 9. Diplomatic trade access

Relationship posture, trust, and tension remain separate values. The current six postures are retained:

- Alliance
- Trade pact
- Neutral
- Strained
- Rivalry
- Open conflict

The posture provides a default policy profile, not a complete trade decision by itself. A relationship may have an explicit GM policy override. The current UI stores the flat fields described below; the following nested form is accepted by the engine for forward compatibility:

```js
tradePolicy: {
  access: "preferred",       // preferred | open | restricted | embargoed
  tariffPercent: 0,
  transitRights: true,
  embargoCommodityIds: [],
  manualOverride: false
}
```

These fields are editable in the campaign diplomacy table. The engine also reads a nested `tradePolicy` object for forward compatibility.

Implemented trade access is evaluated separately for every route edge using the controller of each endpoint system. It currently checks:

- system controllers on the two sides of the border;
- each controlled border represented by an individual route leg (the engine evaluates one edge at a time);
- explicit transit-rights denial and commodity embargoes;
- relationship posture defaults and explicit GM access/tariff values;
- route direction, operating status, freight and tolls;
- GM overrides.

A faction's presence in an entire sector must not apply a global discount or penalty to every market. Effects should occur at relevant markets, routes, border crossings, and trade partners.

Alliances and trade pacts can grant preferred access or reduced friction; strained relationships can impose inspections or costs; rivalries can create competition and restrictions; open conflict can enable embargoes, seizures, and blockades. Current posture defaults: Alliance (preferred, 0% default tariff), Trade pact (preferred, 2%), Neutral (open, 5%), Strained (restricted, 10%), Rivalry (restricted, 16%), and Open conflict (embargoed). A GM may override general access and tariff, but a revoked transit right or explicit matching commodity embargo still blocks travel. If both endpoint systems have different controllers but no formal relationship record exists, a neutral trade default with a 5% tariff is used. No relationship tariff is applied when either endpoint is uncontrolled or both are controlled by the same faction. Polity-to-polity relations are not yet consulted by the logistics engine. These are provisional rules, not a full diplomatic AI or negotiation system.

### Polities are a separate political layer

Polities are not factions and must not be migrated into `sector.diplomacy`. The existing polity record vocabulary is distinct:

```js
{
  id: "POLITY-01",
  name: "The Meridian League",
  government: "Loose trade league",
  capitalSystemId: "SYS-04",
  memberSystemIds: ["SYS-04", "SYS-09"],
  policy: "secure a jump corridor",
  stability: 4,
  relations: [
    { polityId: "POLITY-02", type: "trade pact" }
  ]
}
```

The current polity relation types are `rivalry`, `cold peace`, `mutual aid`, `trade pact`, and `proxy conflict`. Each entry is stored on the source polity and points to another polity by `polityId`; do not assume a reciprocal entry exists unless a future reconciliation rule explicitly creates one. A system's `polityId` / `polityName` identifies its membership. `capitalSystemId` and every `memberSystemIds` entry should resolve to a system.

Faction diplomacy remains a different relationship model in `sector.diplomacy[]`: faction pairs use `factionAId` / `factionBId`, one of the six posture values `Alliance`, `Trade pact`, `Neutral`, `Strained`, `Rivalry`, or `Open conflict`, plus independent `trust` and `tension` values. Those records govern relationships between campaign factions. Polity relations represent inter-polity political posture and must keep their own vocabulary and directionality. Future economic access can consider both layers, but must not collapse them into one table or silently translate between their values.

## 10. Faction strategy inputs

The new faction decision system must inspect real state rather than selecting an action from an unweighted random list.

Potential decision inputs:

- faction resources, credits, stats, active assets, maintenance burden, and strategic goal;
- controlled and influenced systems;
- market dependencies, shortages, surpluses, and trade exposure;
- route access and vulnerable corridors;
- diplomatic posture, trust, tension, allies, rivals, and current treaties;
- nearby threats, military posture, and strategic opportunities;
- corporate interests and assets that materially affect the faction.

In 1.3.7 these inputs feed a score-and-rank model for legal faction actions and corporate commercial choices. The faction chooser runs inside the legacy faction-turn phase, before the new economic coordinator, using the last committed market and diplomacy state plus current assets, goals, treasury/resources, threats, and available legal action candidates. Each candidate is checked against the existing turn engine's viable action list, then scored for its goals, assets, resources, market conditions, threats, system importance, and diplomatic posture. The chosen action records a reason, confidence, risk, alternatives, and target references. Controlled seeded uncertainty can occasionally prefer a close alternative; it is not allowed to create an illegal action. Corporations separately analyze linked markets and reachable paths after the current turn's shipment/diplomacy phases, before the economy clock commits, and may negotiate supply contracts, pause unviable ones, or invest in transport capacity. GM-authored relationships, field overrides, global autonomy switches, and actor manual-control locks take precedence.

## 11. Current turn order and future extensions

A **campaign turn** is entered through `SectorSimulation.advanceCampaignTurn()` and is staged on a JSON clone of the full sector. First, `CampaignTools.advanceFactionTurn()` runs on that clone using the previously committed economic/diplomatic state. The 1.3.7 scorer ranks only legal action options already produced by that engine; the selected action is executed by the existing repair/buy/income/expand/attack routines and its reason/outcome is attached to faction history. This phase advances the legacy faction clock. The coordinator then synchronizes clocks, records a faction Chronicle event and refreshes derived state.

Second, `SectorEconomy.advanceTurn()` processes the economic coordinator on the staged copy:

1. **Contract preparation and transport charges:** prepare recurring-contract turn counters, then settle fleet/port operating and maintenance charges through idempotent settlement transfers.
2. **Arrivals:** resolve shipments due to arrive; credit final-market cargo subject to storage and GM locks, pay only physically delivered lots to the origin seller, and record incidents/losses.
3. **Local production/consumption and price update:** apply the market balance once per turn and create local economic ledgers/Chronicle events.
4. **Shipment retry and dispatch:** retry active shipments waiting for capacity; plan new unlocked surplus-to-shortage shipments; debit origin stock when dispatch is committed and consume that turn/direction route capacity; settle freight/toll/tariff and route operator expense.
5. **Automatic faction diplomacy:** evaluate delivered cross-border trade, shipment incidents, and hostile faction attack events. Apply bounded trust/tension changes and posture thresholds to unlocked bilateral faction relationships; preserve GM locks.
6. **Formal politics and strategic phase:** apply scheduled treaty/sanction/war/ceasefire/peace transitions and directed polity policy; update market import priorities; evaluate corporate linked-market opportunities, contract performance and capacity bottlenecks. Eligible corporations may negotiate limited supply contracts, pause persistently unviable owned agreements, purchase/assign transport fleets, or conserve capital.
7. **Clock and invariant commit:** advance economy/logistics/contract/transport/settlement/diplomacy/politics/strategy clocks once, mark settlement complete, and validate the staged engines.

Only after all phases succeed and the staged economy, logistics, settlement, faction diplomacy, politics and strategy validations pass does the coordinator commit the staged copy to the live sector. A handled failure discards the staged copy, preserving the live campaign for retry. The persistent coordinator journal contains the latest committed turns and their phase summaries, bounded by `simulation.settings.historyRetention.turnJournal` (default: 20 in 1.3.10.1); older journal entries move to the coordinator archive. This is an in-memory transaction/rollback boundary, not durable process-crash or browser-restart recovery. Already-committed economy turns remain idempotently skipped, and skipped economic turns are rejected.

## 12. Chronicle event contract

The 1.3.8 `recordEvent()` API provides stable event ID and sequence, turn, category, type, source, visibility, actor IDs, affected entity IDs, location system IDs, summary, reasons, causes and effects where available. Engines may add domain-specific references such as shipment, market, treaty, sanction, war, ledger or turn IDs. A representative event is:

```js
{
  id: "SIM-EVENT-0000123",
  sequence: 123,
  turn: 9,
  category: "logistics",
  type: "shipment-delayed",
  source: "simulation",
  actorIds: ["FACTION-02"],
  affectedEntityIds: ["MARKET-001", "MARKET-014", "ROUTE-08"],
  locationSystemIds: ["SYS-02", "SYS-08"],
  summary: "A disrupted corridor delayed machine-parts shipments.",
  causes: ["SIM-EVENT-0000120"],
  effects: [
    {entityId:"SHIP-000012", field:"status", before:"in-transit", after:"delayed"}
  ],
  visibility: "gm"
}
```

The GM Chronicle panel supports category filtering and text search, and displays participants, locations, causes, reasons and effects. GM notes and the entire simulation envelope remain excluded from player-safe export. Shipment event ordering is dispatch → physical arrival → delivered-goods payment settlement → contract delivery completion; later events carry the preceding relevant event ID in `causes`.

## 13. Migration strategy for the economy

The 1.3.3 economy initialization is explicit and additive; it is separate from the schema-envelope migration. Its current behavior is:

1. Preserve every existing `market.goods[]` entry and unknown custom field.
2. Map catalogue goods to stable slug-based commodity IDs; retain custom goods in the sector catalogue snapshot.
3. Preserve legacy base/current price information as the local reference/current price baseline.
4. Leave old `supply` labels as legacy annotations; do not convert them to invented stock quantities.
5. Automatically initialize new generated sectors. Native legacy sectors and imported SWN sectors remain uninitialized until the GM presses **Initialize local economy**.
6. Derive first-pass local production/consumption schedules from supported world and market drivers and mark them generated with source reasons.
7. Initialize new stocks deterministically from the economy seed policy. The current UI commits this baseline immediately when the GM presses Initialize; a pre-commit preview workflow is not yet implemented.
8. Preserve current stock when market drivers change. New goods receive their own initialized accounts and removed goods are archived in `retiredCommodities[]`.
9. Keep the existing market UI/display/export records synchronized as a compatibility projection; dynamic local state remains in the GM simulation envelope.
10. The original imported source archive and 1.2 market records remain intact as canonical source information. A dedicated economic rollback/preview workflow and more granular retention policy controls remain future improvements.

## 14. Save size, history retention, and share-link policy

The 1.3.10.1 retention policy keeps hot arrays bounded without silently changing the canonical sector or the state needed to continue simulation. Limits are saved per sector in `sector.simulation.settings.historyRetention` and can be read or changed through `SectorSimulation.getHistoryRetentionPolicy()` / `setHistoryRetentionPolicy()`. Values are clamped from 4 to 100,000; lowering a value compacts immediately. Defaults are: Chronicle 150 events; sector economy 300 ledger rows; each market ledger 4 rows; logistics ledger 500 rows; shipment details 500; settlement 300 transactions; contract 300 rows; transport 300 rows; diplomacy 200 events; politics 250 events; per treaty/sanction/war history 25 entries; turn coordinator 20 entries; and faction-turn history 20 entries.

### Detailed records and bounded GM archives

- Chronicle and supported ledger arrays retain the most recent records. Older records are first moved into typed GM-side archives with a full deep-cloned `records[]` entry plus record counts, turn ranges, type/category counts, and domain-specific totals. Archive dictionaries use prefixed keys to avoid special object property names colliding with built-in JavaScript object properties. In 1.3.10.1, detailed archive bodies are then subject to the global campaign byte budget; aggregate summaries remain.
- Settlement compaction initially preserves the full transaction object in `archive.records`; once detailed-archive pruning is required, exact external idempotency keys and reconciliation metadata remain available. Replayed external transfers therefore remain no-ops after the original detailed row leaves the hot ledger. Archived commodity-payment metadata remains available to validate shipment settlement references.
- Completed shipment records are compacted only after they reach a terminal status and their completion turn is earlier than the current campaign turn. Active shipments are never removed. The hot list is bounded by `shipmentRecords`; the GM-side `shipmentArchive.shipments` index preserves the complete terminal shipment, including stable ID, all route legs, incidents, costs, contract references and settlement transaction IDs. The archive maintains delivered/paid totals and the latest shipment sequence so ID reuse cannot occur after compaction or reload.
- `SectorLogistics.getShipments()` returns detailed retained shipment records for current planning, transit, trade signals and the GM table. `getSummary()` includes retained and archived counts/totals. Shipment validation and settlement validation inspect both retained records and archived summaries.
- Older faction-turn event arrays are retained as detailed records in the faction-turn archive, including referee-authored `gmNotes`, subject to the shared detail-byte budget. Relation/strategy logs that already have fixed-size limits retain their existing policies.
- New historical event text and per-leg shipment detail are retained while within the campaign-wide detailed-archive byte budget (512 KiB by default, configurable from 64 KiB to 10 MiB). The oldest detail is pruned first when the budget is exceeded. Aggregate counters and settlement idempotency keys remain available; pruned shipment details retain compact reconciliation stubs. This budget applies to detailed archives only, not total GM JSON size or live campaign data. Export complete GM sector backups regularly. Bodies already discarded by the 1.3.9 compact-summary format cannot be reconstructed.

### Browser-local recovery

The Export workspace provides opt-in IndexedDB snapshots of the full GM sector. It supports manual save, restore, delete, and debounced automatic snapshots after a persisted edit. Each campaign has an independent key, while a latest pointer identifies the most recently saved campaign. Updating or deleting one campaign does not overwrite or remove another campaign's snapshot. A checksum protects against accidental storage corruption; it is not cryptographic authentication. Sector Forge does not upload or encrypt these snapshots. Anyone with access to the same browser profile or device account may be able to access them, so recovery should not be enabled on shared devices. Browser storage can be cleared or evicted; portable GM JSON remains the authoritative backup. Real browser IndexedDB transaction behavior remains to be verified outside the current managed browser restrictions.

### Compressed share URL

- A share URL is a convenience snapshot, not the canonical backup. Measure the final encoded/compressed payload before publishing the link; use a configurable maximum length appropriate to the browser and sharing channel.
- If the full snapshot exceeds that limit, do not cut the JSON string or silently drop old history. Disable/omit that URL with a clear explanation and direct the GM to the full JSON download.
- A future **Create compact share snapshot** option may project a deliberately reduced sector copy (for example, recent detailed events plus compact turn summaries, excluding ledger detail not needed by the recipient). It must be an explicit user choice and visibly label the snapshot as reduced/as-of a specific turn. It must never modify the underlying GM sector or the full GM JSON archive.
- Apply player-safe censorship before compressing a player link. GM notes, private Chronicle events/causes, and other referee-only data must be excluded from the player projection before any size calculation.
- A share snapshot must include its projection/version metadata so an imported reduced snapshot is not mistaken for a complete GM archive. The GM can always return to the full-fidelity JSON export for continued campaign play.


## 15. Required economy/logistics tests

The current test suite covers deterministic local initialization, no legacy-stock inference, production/consumption ledger conservation, bounded local price movement, field-level overrides, one-turn idempotency, Chronicle integration, schedule refresh, multi-hop shipments, route direction/capacity, route disruption and recovery, cargo conservation, deterministic incidents, diplomatic access/embargoes, GM-stock locks, and GM JSON round-trips.

- Same initial sector + same seed + same settings produce the same initial economic state.
- Repeated derivation and panel rendering do not change inventory, prices, or turn.
- Production and consumption apply once per committed turn, not once per render/retry.
- Cargo is conserved across origin debit, transit, destination credit, and explicitly recorded loss.
- No route segment exceeds capacity; directional limits are respected.
- No shipment crosses a disconnected/closed/blocked route or prohibited border.
- Multi-hop path is contiguous and delivery time respects each leg.
- New route connectivity creates new reachable supplier options without teleporting goods.
- Removing a route or introducing a blockade delays/reroutes shipments and exposes affected shortages.
- Price pressure is commodity-specific and reacts monotonically to controlled stock changes.
- Manual stock, production, consumption, price, route, and diplomatic-policy overrides survive recalculation/turns.
- Existing 1.2 imported markets and custom fields survive initialization and export/import.
- A GM can inspect why each price, shipment, policy, and faction action changed.

## 16. 1.3.7 scope boundaries and explicit non-goals

This model is not intended to reproduce every detail of real-world macroeconomics or every procedure in *Suns of Gold*. It is a referee-facing campaign simulation with coherent internal accounting, meaningful strategic consequences, tunable abstractions, and transparent GM control. Faction/corporate decisions are bounded, explainable, and sometimes imperfect; they are not omniscient or fully autonomous planners. The transport model has ports and fleet capacity but not physical vessels, crew/fuel/hull combat, convoy schedules, or docking queues. Treaty/war/sanction transitions, polity-level diplomacy, specialized cargo custody/spoilage, and bounded campaign-history archival remain future milestones.


## 17. Campaign financial settlement (introduced in 1.3.5; extended in 1.3.6)

Financial records live at `sector.simulation.economy.settlement`; they are GM-private and do not alter the legacy faction `factionCredits` field (SWN FacCreds). Account records include stable account ID, owner type/ID, display name, currency (`Cr`), opening balance, current balance, an overdraft warning threshold (`creditLimit` in the persisted first schema), source/provenance, and creation/last-transaction turns. Account classes currently include factions, corporations, market clearing, and service accounts for the Interstellar Logistics Guild, Customs Authority, and Interstellar Infrastructure services.

Opening balances are initialized once. Existing `treasuryCredits` is used when present; otherwise faction capital is estimated from the Forge wealth rating and asset count, corporation capital from its valuation label, and market clearing funds from a fixed first-pass baseline. These are campaign abstractions, not a conversion of FacCreds or canonical SWN economic rules. Existing accounts are not reset when the initializer is called again.

A shipment leg settles its freight, toll, tariff, and configured route operating expense on dispatch. The payer is the shipment's owning faction / origin controller, with a market-clearing account as a fallback. A named route corporation or faction receives freight/toll; otherwise the Interstellar Logistics Guild receives it. The tariff is paid to the destination system controller or Customs Authority when independent. Self-payments are redirected to a service recipient to keep each charge a genuine transfer. Each transaction records both account IDs, amount, currency, balance-before/after values, turn, shipment ID, leg index, type, memo, and balanced marker. Each leg stores transaction IDs and a settlement idempotency marker.

The persisted `creditLimit` value is an **overdraft warning threshold**, despite the legacy field name. It flags a transaction when the payer's balance falls below the negative threshold. It does not reject the charge, prevent a shipment, or cap borrowing. Negative balances are valid and preserved; GM account edits can adjust balance and threshold. In 1.3.6, final delivery also triggers a buyer-to-seller commodity purchase transfer using the sale unit price fixed on the shipment at dispatch. Only newly delivered and unpaid lots are charged; transit losses and cargo that remains in transit are not. Partial deliveries can settle in multiple tranches, and `commodityPaidQuantity` / transaction IDs make repeated callbacks idempotent. The shipment seller resolves to an explicitly associated seller corporation, then the origin system controller, then the origin market clearing account. Pre-1.3.6 shipments without a recorded sale price remain unpriced; the engine does not invent retroactive transactions.

## 18. Automatic bilateral diplomacy (implemented in 1.3.5)

`sector.simulation.diplomacy` stores the engine version, last-processed turn, and a bounded history of automatic relationship changes. The authoritative bilateral relationships remain in top-level `sector.diplomacy[]`, with the existing faction posture vocabulary kept separate from polity relationships.

After shipment arrival/dispatch processing, each faction pair receives signals from delivered cargo where the origin owner/controller and destination controller match the pair, relevant shipment incidents, and faction-news attack events. Larger verified trade volumes modestly increase trust and reduce tension; incidents and attacks reduce trust and increase tension. Quiet periods can slowly reduce tension outside open conflict. Values remain bounded (`trust`: -10 to 10; `tension`: 0 to 10). Existing posture labels are assigned by thresholds with limited hysteresis; a quiet turn does not automatically erase open conflict.

The engine respects relationship-wide locks (`locked`, `automatic:false`, `manualOverride`, `isManual`) and field-level `fieldOverrides`/legacy `manualOverrides`. A lock on one field protects that field; a full automatic/manual lock protects every dimension. Each change records before/after values, signals, turn, actors, and a Chronicle event. This is intentionally a first feedback loop, not a full treaty negotiation, diplomatic bargaining, war declaration, polity evolution, or diplomatic AI.

## 19. Strategic market intelligence (implemented in 1.3.5)

`sector.simulation.strategy` stores per-faction and per-corporation turn assessments plus the processed-turn clock. It evaluates each market's stock coverage against its target stock. Controlled markets contribute to faction assessments; markets linked through `corporationMarketLinks` or corporate market IDs contribute to corporate outlooks. Reports identify critical shortages, other below-target stock, surpluses, priority/directive, and a human-readable explanation.

The engine writes automatic market import priorities (`emergency`, `high`, or `normal`) from current stock coverage. The logistics planner uses those priorities to order competing shipment candidates. Since the assessment runs after the current turn's dispatch phase, it affects the next turn's planning pass. GM-locked market policy fields take precedence. Notable shortage and corporate opportunity/disruption signals enter the Chronicle.

This is **intelligence plus a bounded logistics input**, not full strategic faction AI. Factions do not yet autonomously purchase/attack/expand/defend based on the report, and corporations do not automatically negotiate contracts, invest, build production, acquire assets, or change strategy. Legacy `CampaignTools` faction-turn rules remain the action engine until a separate strategic-action model is implemented and tested.

## 20. New 1.3.5 validation requirements

The dedicated 1.3.5 tests and full audit additionally require:
- Every posted settlement transfer conserves the combined balances of payer and payee and preserves negative balances where applicable.
- Freight/toll/tariff recipients follow route operator and destination-controller rules; each route leg settles once only.
- Overdraft warning flags are correct and do not silently block transfers.
- Settlement accounts and ledgers remain valid after save/load, with no duplicate account or transaction IDs.
- Automatic diplomacy changes only unlocked fields and respects full relationship locks, field locks, posture bounds, and one-turn idempotency.
- A saved 1.3.4 campaign resumes settlement/diplomacy/strategy clocks from the saved economy turn instead of replaying historical turns.
- Strategic reports cover existing factions/corporations, and market-priority outputs respect GM overrides and influence subsequent logistics planning.
- The complete simulation envelope remains excluded from player-safe exports.

## 21. Delivered commodity purchase settlement (implemented in 1.3.6)

The settlement record remains at `sector.simulation.economy.settlement`; the schema advances additively to version 2. Existing account balances, transaction history, and previously recorded route-leg settlement IDs are preserved. The infrastructure-services account (`INTERSTELLAR-INFRASTRUCTURE`) receives route operating expenses. This is distinct from freight and toll revenue: the route operator pays the operating expense, while freight/toll are paid by the shipment payer to the operator.

Every newly dispatched shipment stores a dispatch-time `saleUnitPriceCr`, its source ask and destination price references, and any associated `contractId`. The price is either the active contract's fixed negotiated price or the midpoint of the source/destination market prices at dispatch. The destination market-clearing account pays the origin seller when cargo reaches final delivery. Seller resolution prefers a named seller corporation on the shipment/origin market, then the controlling faction of the origin system, then the origin market-clearing account. Only the newly delivered, unpaid quantity is charged; losses and goods still in transit are not paid. `commodityPaidQuantity`, `commodityPaidCr`, and transaction IDs on the shipment provide persistent idempotency markers. A legacy shipment lacking a sale price is recorded as unpriced and is not assigned an invented historical sale transaction.

Settlement transfer records additionally retain the commodity ID, lot quantity, unit price, origin and destination market IDs, and shipment reference. Validation reconciles delivered quantity/value to commodity-purchase transactions and confirms balanced account arithmetic. Campaign Cr remain a referee abstraction separate from SWN FacCreds. The overdraft warning is not a hard spending limit.

## 22. Commodity freight and route service costs (implemented in 1.3.6)

Each catalogue item has a positive abstract `freightUnitsPerLot` and a `storageClass`. Category defaults vary across agricultural/food, medical, industrial, technology, energy, bulk/mineral, cultural, luxury, restricted, salvage, biological, and general goods. These are relative route-capacity coefficients, not physical dimensions or mass units. A sector-level GM override uses `fieldOverrides.freightUnitsPerLot` or `fieldOverrides.storageClass`; migration preserves these explicit overrides and supplies category defaults for old 1.3.5 entries without silently overwriting manual values.

Route `capacityPerTurn` is now measured in cargo units. A shipment leg consumes `quantityLots × freightUnitsPerLot` capacity. Weighted pathfinding uses the same cargo coefficient when comparing freight/toll cost so that heavy/bulky goods can prefer a different corridor than compact goods. Capacity is rechecked when the shipment is committed; pathfinding does not reserve future capacity.

Route profiles include `operatingCostPerUnit`, measured per abstract cargo unit. On dispatch, the route operator pays `operatingCostPerUnit × cargoUnits` to the infrastructure-services account. This transfer is recorded separately from the shipper's freight/toll/tariff charges and shown on shipment/route UI. The setting is an abstract route-service expense; it does not model vessel fuel, crews, wear, capital depreciation, or route-company profitability in detail.

The `storageClass` is metadata for future specialized logistics. In 1.3.6 it does not yet enforce temperature, hazardous-cargo restrictions, secure custody, fragility, decay, shelf life, or differentiated destination storage capacity.

## 23. Recurring supply contracts (introduced in 1.3.6; extended by corporate autonomy in 1.3.7)

Persistent GM-authored contracts live under `sector.simulation.economy.contracts`:

```js
{
  schemaVersion: 1,
  engineVersion: "1.3.6", // original contract-engine schema lineage
  records: [{
    id: "TC-00001",
    originMarketId: "market-a",
    destinationMarketId: "market-b",
    commodityId: "machine-parts",
    quantityPerTurn: 10,
    unitPriceCr: 0, // zero = dispatch-time dynamic midpoint
    startTurn: 4,
    endTurn: 0, // zero = no scheduled end
    priority: "standard",
    status: "active",
    shippedThisTurn: 0,
    deliveredThisTurn: 0,
    lostThisTurn: 0,
    history: []
  }],
  ledger: [],
  clock: { lastPreparedTurn: 3 },
  nextSequence: 2
}
```

A contract defines a recurring per-turn shipment target, not a guarantee of delivery or a reservation of future inventory. It must connect markets in different systems and its commodity must exist in both market accounts when created. Status may be active, paused, expired, cancelled, or completed; the GM can edit/pause/resume it. An active contract cannot overlap another active contract for the same origin market, destination market, commodity, and turn range; this prevents the planner from silently honoring only one of several competing terms. Historical records referencing removed markets are retained as warnings rather than silently discarded.

At dispatch, the planner prioritizes eligible contract quantity subject to real source surplus and destination demand. Contract price is fixed when `unitPriceCr` is positive; zero stores the dispatch-time midpoint price on the shipment. Normal spot planning may still serve remaining surplus/demand after contracted volume is planned. A contract never creates goods, bypasses ordinary trade rights/embargoes, route availability/direction/capacity, transit incidents, destination storage, or settlement. If a contracted shipment is delayed, partially delivered, or lost, the shipment/contract ledgers record the actual outcome. Contract history retains the latest 24 prepared turns per contract. Since 1.3.9, the global Chronicle and economy, market, logistics, settlement, contract, and transport hot ledgers use configurable retention limits. In 1.3.10, records moved out of these hot arrays are retained as complete deep-cloned GM archive records, and terminal shipment archives preserve full route-leg detail. Active shipments remain in the full shipment collection.

`SectorTradeContracts` provides `initialize`, `create`, `getContracts`, `getLedger`, `prepareTurn`, `getMatchingContract`, `recordDispatch`, `recordDelivery`, `recordLoss`, `getSummary`, and `validate`. Rendering a campaign panel does not prepare a contract turn or dispatch a shipment.

## 24. 1.3.6 commerce validation requirements

The dedicated `commerce.cjs` suite and browser E2E additionally require:
- Category defaults provide differentiated positive freight units; legacy entries receive defaults while explicit GM freight/handling overrides survive migration and save/load.
- Path cost and route capacity use the same cargo-unit multiplier; committed legs cannot exceed directional cargo capacity.
- Commodity purchase transactions pay only delivered/unpaid lots, reconcile unit price and Cr totals, preserve total account value, and cannot be posted twice for the same delivered quantity.
- Partial delivery and transit loss do not charge for cargo that did not arrive.
- Route operating expense is a separately balanced transfer from the route operator to the infrastructure-services account; shipper freight/toll/tariff charges remain separate.
- Active recurring contracts dispatch only within their dates and shipment target; paused/expired contracts do not dispatch; duplicate overlapping active lane commitments are rejected.
- Contract volume does not create goods or suppress remaining spot trade; contract dispatch/delivery/loss ledger entries and turn history remain coherent across save/load.
- Contract, commodity freight, and financial simulation data remain excluded from player-safe exports.
- Browser panels display route cargo capacity, operating cost, goods paid, freight profiles, contract rows, and support creation without advancing the campaign turn.



## 25. Persistent transport infrastructure (implemented in 1.3.7)

Transport infrastructure is stored separately at `sector.simulation.transport`; it is GM-private and is not projected into player-safe exports. The transport engine has its own schema version so the application can extend ports/fleets without changing the legacy sector root schema.

```js
{
  schemaVersion: 1,
  engineVersion: "1.3.7",
  ports: [{
    id: "PORT-SYS-A", systemId: "SYS-A", name: "Aster Spaceport",
    level: 2, handlingCapacityPerTurn: 192, warehouseCapacity: 480,
    condition: 100, status: "operational", ownerType: "faction", ownerId: "FAC-1",
    maintenanceCrPerTurn: 80, source: "derived-initial"
  }],
  fleets: [{
    id: "FLEET-0001", name: "Meridian Merchant Flotilla",
    ownerType: "corporation", ownerId: "CORP-1", homeSystemId: "SYS-A",
    capacityPerTurn: 20, speed: 1.15, reliability: 88, condition: 100,
    operatingCostCrPerTurn: 240, maintenanceCrPerTurn: 0,
    variableCostPerCargoUnit: 0.04,
    assignments: [{routeId: "ROUTE-1", allocationPercent: 100}],
    status: "operational", readyOnTurn: 3
  }],
  ledger: [],
  clock: { lastProcessedTurn: 2 },
  nextFleetSequence: 2,
  nextLedgerSequence: 1
}
```

Newly initialized economies create a port for each market or trade-route endpoint. Initial handling is at least twice the largest adjacent legacy route capacity (and at least the level-based baseline), so existing abstract corridors remain viable without a fleet. Route effective capacity is the legacy abstract capacity plus assigned operational fleet capacity, capped by the lower endpoint port's condition-adjusted handling capacity. A closed or failed endpoint port blocks movement. Fleet capacity is weighted by route allocation and condition; speed influences transit turns; reliability influences route incident risk; variable costs contribute to route operating expense. A fleet can allocate no more than 100% of its capacity across all assigned routes. Newly purchased corporate fleets become available on the following turn.

Fleet and port operating/maintenance charges settle through campaign-credit accounts and use per-owner/per-turn external keys to prevent duplicate transfers. Three consecutive fleet maintenance defaults mark a vessel financially stressed and reduce its condition; a later paid turn can restore operational status. These are campaign abstractions rather than a ship simulator. There are no physical ship locations, crew/ fuel/ hull/ weapon models, convoy schedules, docking queues, or per-cargo manifests. Warehouse capacity is persisted for GM use and future storage rules; current route modifiers use port handling capacity, and market inventory capacity remains the destination storage authority.

`SectorTransport` exposes `initialize`, `getPorts`, `getFleets`, `createFleet`, `updateFleet`, `assignFleetToRoute`, `removeFleetAssignment`, `retireFleet`, `getRouteModifiers`, `advanceTurn`, `getSummary`, and `validate`. Existing abstract routes remain functional without assigned fleets. Fleet and port edits are canonical GM values; invalid fleet ownership/status/system updates are rejected without partially mutating the record.

## 26. Strategic actor decision model (implemented in 1.3.7)

Strategic configuration is stored in `sector.simulation.settings.strategicAI`:

- `enabled`: master strategic automation switch.
- `factionAutonomy`: allows/disables autonomous faction action choice.
- `corporateAutonomy`: allows/disables autonomous corporation actions.
- `decisionNoise`: bounded seeded uncertainty, clamped to 0–0.5; new sectors default to 0.16.

Faction decisions are constrained by the exact legal action candidates produced by the existing faction-turn engine. The scorer considers faction goal profile, legacy FacCred/resource pressure, assets/readiness and repair condition, upkeep/maintenance pressure, controlled-market shortage/surplus signals, strategic market/route importance, attack target value, rival relationship posture, and available expansion/income/buy targets. It returns the chosen action and target references with score, base score, confidence, risk, reason, up to two alternatives, and an imperfection explanation. A bounded seeded chance can select a close second-best option; it cannot invent an action or bypass the old action executor. Existing faction asset purchase, repair, income, expansion, attack, upkeep and turn-history rules remain responsible for performing the selected action.

Corporate autonomy uses only linked markets and the real route graph. It measures source surplus and destination shortage, rejects unreachable/blocked/embargoed paths, compares the path cost to an indicative purchase price, and negotiates limited five-turn supply contracts at a modest price premium when the score and contract limits permit. It may pause a corporation-owned agreement after repeated severe under-delivery and transit loss, or purchase/assign a merchant flotilla when an owned contract's shipment repeatedly waits for capacity and the corporation has sufficient Cr capital. Otherwise it defers or holds capital. Corporate Cr balances remain separate from SWN faction FacCred values.

Decision records and corporate market outlook fields are GM-private. Player-safe sector projection omits the simulation envelope and corporation-only strategy metadata. Global AI switches and faction/corporation-specific manual locks disable autonomous choices; manual GM data and overrides are not discarded. The AI is intentionally bounded rather than omniscient: its coefficients are first-pass, it has incomplete information by design, and a close alternative can occasionally win through seeded uncertainty. It does not yet model corporate competition, mergers, lobbying, detailed espionage, boardroom members, full investment portfolios, or a long-horizon multi-turn faction master plan.

## 27. 1.3.7 validation requirements

The dedicated `strategic-transport.cjs` suite, full baseline suites, and browser E2E require:

- A faction facing a serious supply shortage protects a damaged/important base when that action outranks irrelevant alternatives; alliances and GM/manual autonomy locks suppress prohibited actions.
- Replaying the same keyed decision inputs produces the same action, while bounded uncertainty can occasionally select a close alternative without selecting an illegal action.
- Decision reports include a reason, confidence, risk, alternatives, and inspectable targets; the faction-turn executor still owns action effects and history.
- Corporate AI identifies a reachable linked-market surplus/shortage pair, negotiates a priced future contract, conserves capital when the opportunity is poor, and invests in fleet capacity when its owned shipments repeatedly wait for lane capacity.
- Ports preserve the previous abstract route capacity before any fleet is added; assigned fleets affect capacity, transit, reliability/risk, and costs; closed ports block the lane; route allocations cannot exceed 100%.
- Fleet purchases/maintenance and port charges use balanced, idempotent Cr transfers. Invalid ownership edits do not partially mutate fleet records.
- GM save/load retains strategy settings, reports, ports, fleets, assignments, and ledgers; player exports omit both simulation state and corporate-private AI metadata.
- Campaign turns, imports, old 1.2 maintenance regressions, commerce/contracts, logistics, browser E2E, and the real export worker continue to pass.


## 28. Formal political state (implemented in 1.3.8)

Formal political state belongs to `sector.simulation.politics`; it is not stored in the faction bilateral diplomacy collection. `simulation/political-engine.js` exposes `SectorPolitics`. The state includes `schemaVersion`, `engineVersion`, `clock.lastProcessedTurn`, `treaties[]`, `sanctions[]`, `wars[]`, bounded policy `history[]`, and ID sequence counters.

- **Polity relations:** each `sector.polities[].relations[]` entry is directed and contains `polityId`, `type`, `source`, `updatedTurn` and bounded `history[]`. Allowed values are `rivalry`, `cold peace`, `mutual aid`, `trade pact` and `proxy conflict`. No reciprocal relation is inferred.
- **Treaties:** `id`, `name`, `type`, two `parties[]` (each `{type:'faction'|'polity', id}`), `status`, proposal/response/effective/expiry turns, `terms`, `proposedBy`, history, notes and Chronicle event references. Status transitions include `proposed`, `active`, `rejected`, `expired`, `terminated` and `breached`. Acceptance takes effect on the next campaign turn. Terms control border access, tariff, transit rights, commodity restrictions and optional mutual-defence metadata.
- **Sanctions:** issuer and target party records, sanction `kind`, `status`, effective/expiry turns, direction (`outbound` or `both`), commodity IDs, tariff, notes and history. Kinds include trade embargo, tariff, transit ban, inspection regime and financial restriction. The financial restriction is a route-risk signal only; it does not freeze settlement accounts.
- **Wars:** two political parties, status, effective declaration turn, blockade-system IDs, humanitarian commodity exceptions, ceasefire timing, peace effective turn, recorded terms/notes and history. War declarations and ceasefires are scheduled for their explicit effective turn. Peace remains pending until its scheduled turn so restrictions do not end early.

`SectorPolitics.getTradeAccess(sector, fromSystemId, toSystemId, commodityId)` evaluates policy at each directed system border. Formal restrictive instruments and explicit GM overrides are not interchangeable. Automatically derived faction `Open conflict` posture may yield to a formal ceasefire/humanitarian exception, but explicitly GM-authored embargoes, denied transit rights, matching commodity embargoes and active blockades remain restrictive.

Polity-to-polity relations remain referee-directed: the engine does not autonomously bargain, arbitrate treaty terms, impose polity sanctions, declare polity wars, or evolve polity relations. 1.3.10 adds a separate, bounded faction-level political agent. When `simulation.settings.strategicAI.factionPoliticalAutonomy` is enabled, faction actors may propose limited trade-pact, transit-agreement or non-aggression treaties, respond to offers made on earlier turns, seek ceasefire under severe pressure, and propose peace after a ceasefire has lasted a full turn. The proposing faction cannot accept its own offer, same-turn responses are disallowed, and global/faction autonomy switches plus manual-control and GM relation locks remain authoritative. This is not unrestricted bargaining or autonomous polity diplomacy. Faction diplomacy remains a separate six-posture vocabulary with trust/tension.

## 29. Network market competition (implemented in 1.3.8; extended in 1.3.10)

During local price evaluation the economy builds a bounded network context from operational logistics paths, source surplus, destination demand, landed price, freight/toll/tariff, route risk, lead time and in-transit cargo. The best reachable supplier can contribute an import discount (bounded to 15 index points); viable export opportunities can contribute an export premium (bounded to 8 index points). Expected inbound volume is weighted by delivery horizon and risk and is recorded for price explanation, but is never added to on-hand stock before physical arrival. Only a bounded candidate set is considered per market/commodity to constrain per-turn work.

The per-price `networkCompetition` record and market ledger explain the applied discount/premium, best supplier market, reachable demand and expected inbound. The mechanism is deliberately a first-pass pricing influence; it is not a complete central-market forecast, macroeconomic simulation, arbitrage agent, or guarantee of delivery.

## 30. 1.3.8 validation contract

The 1.3.8 release added focused tests for directed polity relationships, treaty transitions, sanctions, war/ceasefire/peace timing, humanitarian passage, turn rollback/retry, bounded network competition, landed-cost supplier ranking, forecast-vs-inventory separation, and an integrated corridor-crisis scenario. The 1.3.10 feature suite adds faction political AI, competition using delivery reliability, archive byte-budget enforcement and settlement-safe shipment pruning, and per-campaign recovery isolation using a storage test double. The browser suite verifies application/engine version identity, no uncaught JavaScript errors, UI rendering, read-only campaign-panel rendering on a full imported sector, and GM/player export round trips. The separate Node worker-thread suite exercises the real export-worker source. Offline-inline Chromium cannot exercise the browser Worker queue or a real IndexedDB transaction; deployed HTTPS Worker and IndexedDB behavior remain unverified in this environment.


## 31. Faction political autonomy and corporate supplier reliability (implemented in 1.3.10)

The strategic settings record adds `factionPoliticalAutonomy` (default `true`) as a distinct switch from general `factionAutonomy` and `corporateAutonomy`. Faction political decisions execute through the same formal `SectorPolitics` records used by the GM rather than writing a parallel informal event. Pending proposals are only evaluated by the receiving party on a later faction turn. The bounded policy can propose trade pacts, transit agreements and non-aggression agreements, accept/reject qualifying proposals, seek ceasefire under severe strategic pressure, and make a peace proposal after a ceasefire remains active for a complete turn. It does not autonomously create sanctions or declare a war, and it does not change polity-to-polity relations. Explicit GM locks and per-faction manual strategic control take precedence.

Corporate opportunity quotes now inspect active competing supply contracts for the same destination and commodity. Historical delivered quantity versus expected quantity provides a bounded reliability estimate. A competitor's effective delivered-unit benchmark is nominal contract price divided by reliability (with a neutral value when no delivery history exists and a floor to avoid extreme division). The corporation's decision report includes this comparison; the mechanism is intentionally narrow and does not create a full auction, financial statement, or corporate strategy model.


### 1.3.10.1 default retention policy

The maintenance defaults tighten hot histories so compaction starts early: Chronicle 150 events; sector economy 300 ledger rows; each market ledger 4 rows; logistics 500 rows; shipment detail 500 rows; settlement 300 transactions; contract 300 rows; transport 300 rows; diplomacy 200 events; politics 250 events; per-record history 25; turn journal 20; and faction-turn history 20 entries. The campaign-wide detailed archive budget defaults to 524,288 bytes (512 KiB). Per-campaign settings can override the archive budget between 65,536 bytes and 10,485,760 bytes. This is a cap on detailed archive bodies, not on live inventory, active cargo or total sector JSON.

### 1.3.10.2 live-history and runtime-cache policy

The live economy history budget defaults to 1,048,576 bytes (1 MiB) and can be configured from 131,072 bytes (128 KiB) to 16,777,216 bytes (16 MiB) using `liveEconomyHistoryBudgetBytes`. It covers the sector economy ledger, each market's economy and logistics ledgers, the logistics ledger, settlement ledger, contracts ledger, and transport ledger. Compaction moves oldest rows into the corresponding archives and always preserves the newest row in each ledger. The archive-body budget is separate and continues to default to 512 KiB. Neither budget sets a hard cap for total GM JSON.

The logistics route cache is runtime-only and scoped to a sector instance and turn. It reuses commodity/base-price graphs and origin-specific shortest-path trees; political, transport and app-persisted edits invalidate it. Scripted direct mutation must call `SectorLogistics.invalidatePathCache(sector)`. Logistics and settlement sequence counters are reconciled once on first use/backing-history changes and incremented at append time thereafter. These caches are never serialized.

The formal political engine gives unanswered ceasefire and peace proposals three response turns. They become `expired` on the next political turn after their expiry, with both a war-history entry and Chronicle event. They no longer block replacement proposals. This window is independent of rejected-treaty cooldown rules.


### 1.3.11 effective political turn state

Formal diplomacy and political transitions are resolved before economic market competition and logistics dispatch during a coordinated economy turn. A ceasefire that expires at turn N is no longer available to newly planned trade on turn N; a peace settlement effective on turn N removes the old ceasefire risk/tariff modifiers before that turn's route planning. Changes to trade access invalidate the runtime-only route graph and shortest-path cache. This changes turn sequencing, not the persisted sector schema.
