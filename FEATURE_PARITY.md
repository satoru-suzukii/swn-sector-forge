# Sectors Without Number compatibility matrix

This matrix describes the current state of the Sector Forge import overhaul. It is deliberately explicit about the difference between preserving source data and fully integrating a feature into Sector Forge's editable model.

## Implemented in this package

| Area | Current behavior | Coverage |
| --- | --- | --- |
| Sector grid | Default sector is 10 × 12 (120 hexes); dimensions and coordinate checks use shared `SectorGrid` helpers. Existing Forge saves without grid metadata fall back to the new default. | Implemented and covered by browser tests. |
| Sector generation | Existing Forge generator and campaign tools now use the 10 × 12 dimensions, including edge-hex editing. | Existing generator audit and end-to-end tests pass. |
| Population-aware gravity | Several-million, hundreds-of-millions, and billions-population worlds always receive standard gravity. Rare low/high/nil/zero outcomes are restricted to failed colonies, outposts, and sub-million worlds; gravity rerolls respond to the current population selection. | Deterministic thresholds and 20,000 sampled core-world rolls pass; at least 95% standard gravity required (observed about 98%). |
| Native SWN JSON import | Recognizes grouped entity JSON; maps systems/black holes and planets; normalizes coordinates; exposes imported facility occupation, situation, descriptions, tags, and readable parent links in System Survey. Black-hole systems retain a structural black-hole primary marker even in preserve-as-is mode. | Tested with the supplied Acheron Rho native JSON export (293 source records): all 36 systems, 46 planets and 210 non-planet survey objects map; all three black-hole systems retain a black-hole primary and all five known asteroid-base parents resolve correctly. |
| SWN entity CSV import | Parses the supplied entity CSV layout and maps systems, black holes and planets. Physical non-planet records (moons, stations, bases, belts, mines and ruins) are also added to the system survey; all source rows stay preserved and are attached to a world/system when a parent can be inferred. | All three supplied CSV exports pass: 553 rows, including 74 system records and 92 planets. |
| Preserve-as-is mode | Skips Forge's campaign enrichment path and leaves missing campaign details blank. | Covered by browser end-to-end tests. |
| Imported planet editing | Existing values not present in Forge's dropdown vocabulary are shown as preserved options; saving one field retains all other imported values and source metadata. Opening the editor no longer mutates the live object. | Chromium regression changes only `techLevel` on an SWN-style world and verifies atmosphere, temperature, biosphere, gravity, population, description and source attributes remain unchanged. |
| Black-hole systems | Imported black-hole entities have a distinct `systemType`, structural `B` primary body, dedicated map symbol, inspector label and accessible map name; no ordinary primary star is inserted. | Synthetic browser regression and the three black-hole systems in the Acheron Rho fixture pass. |
| Enrichment mode | Explicit opt-in fills blank occupation/situation fields for supported SWN facility types and missing gravity on imported worlds; existing imported values are never replaced, raw source data is unchanged, and generated fields are marked. Moons remain blank because SWN provides no moon occupation/situation generator. | Unit and browser tests cover preserve/enrich behavior, including the real Acheron Rho fixture. |
| Original source data | Retains original JSON payload and normalized entity records in the GM archive, with a Source Data workspace. | Covered by import checks. The player-safe archive deliberately excludes the raw source payload. |
| Navigation routes | Normalizes source route hex paths and draws supported visible paths as polylines on the sector map. | Covered with a synthetic native JSON fixture. These paths remain separate from Forge's trade/scout route records. |
| Layer regions | Converts supported layer/region hex membership into Forge regions for map display and retains layer/region source identifiers. | Covered with a synthetic native JSON fixture. Forge currently supports only a flat region model, not the complete layered/overlapping upstream layer UI. |
| Factions | Lists native SWN faction records in the Source Data workspace while preserving their original payload. Separately, the Forge campaign Factions panel supports creating custom Forge factions, editing faction fields/home systems, setting a base of influence, and maintaining diplomacy links. | Browser tests cover generated-faction editing, custom faction creation and subsequent editing, home/base linkage, diplomacy records, assets, influence and faction turns. Native SWN source factions are intentionally not auto-converted into the different Forge campaign model. |
| Player-safe export | Excludes the raw SWN archive, retains visible imported survey entities, and filters source-hidden regions, systems, planets, child entities, and every descendant of a hidden source entity. | Browser regression checks verify that a public research station survives while a hidden station, hidden moon, and moon base beneath a hidden planet are excluded. |

## Partial or not yet at feature parity

- **All entity-specific editing.** Systems and planets map into Forge-native objects. Other upstream entities remain editable as System Survey records with basic fields, but they do not yet all have rich entity-specific forms.
- **Full navigation editing.** Imported path geometry is visible on the map, but editing, deletion, visibility controls and round-trip conversion back to SWN route objects are not yet implemented in a dedicated route workspace.
- **Full layer editing.** Layer regions are flattened into Forge's single-level region model. Upstream layers can overlap and carry their own visibility behavior; Forge does not yet reproduce the entire layer editor or all overlapping memberships visually. The original layer structure is retained in the GM archive.
- **SWN factions as active factions.** Source faction information is preserved and listed, but it is not automatically converted to Forge faction objects/assets. The two campaign models have different assumptions, so an automatic conversion could change asset semantics or create invalid turns.
- **CSV relationship fidelity.** CSV has weaker identity/relationship information than JSON. Parent links inferred from names and coordinates are best-effort; ambiguous or unsupported rows remain in source data. Use native JSON where possible.
- **Full native SWN round-trip.** The supplied live export is now a regression fixture, but Forge still does not export back into SWN's native JSON format. CSV matching remains best-effort because it lacks stable entity IDs and typed parent links.
- **Complete upstream feature parity.** This package does not claim that every generation table, editing interaction, visibility rule, or entity-specific field in Sectors Without Number has been recreated in Sector Forge. The feature set should continue to be audited and implemented deliberately.

See [`SOURCE_AUDIT.md`](SOURCE_AUDIT.md) for the direct upstream-source findings, confirmed JSON export contract, changes made in the latest audit pass, and remaining proof gaps.

## Reproducible checks

From the repository root:

```bash
node tests/import-validation.cjs
node tests/run-audit.cjs
E2E_INLINE=1 node tests/e2e.cjs
```

The browser suite requires Node.js 22+ and a Chrome/Chromium executable; set `CHROME_BIN` if necessary.
