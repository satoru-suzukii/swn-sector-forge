# Source audit: Sectors Without Number → Sector Forge

This audit was performed against the supplied `sectors-without-number-master` source archive (snapshot dated 2026-09-22) and the supplied Sector Forge project. The upstream application source was inspected directly. No upstream application UI or generator code was copied wholesale; a separate enrichment module adapts a limited set of English occupation/situation entries under the upstream MIT license, with attribution in `THIRD_PARTY_NOTICES.md`.

## Confirmed upstream export contract

- `src/components/export-modal/export-modal.js` builds native JSON by spreading `translateEntities(entities, customTags, intl)` and then adding `routes`, `layers`, and translated `factions`.
- `src/utils/entity.js` shows that entity collections are grouped by entity type and keyed by entity ID. Entity relationships are represented by `parent` plus `parentEntity`; entity `attributes` are translated for export.
- `src/utils/common.js` defines `coordinateKey(x, y)` as zero-based map keys derived from one-based entity coordinates. `coordinatesFromKey` reverses that transformation. This confirms that entity `x`/`y` and route/layer hex keys use different coordinate conventions.
- `src/constants/entities.js` identifies the entity families and the parent/child structure. Sector Forge can map systems/black holes and planets into its native map/world model, but should retain the other upstream entity types as source records unless a safe native representation exists.
- Both supplied projects declare MIT licenses. The upstream UI and generation algorithms have not been wholesale copied. The optional detail-enrichment table is a limited adaptation of English occupation/situation entries, separately implemented and attributed in `THIRD_PARTY_NOTICES.md`.

## Changes made in this pass

- Imported native SWN `isHidden` flags onto mapped system and planet objects as `sourceIsHidden` so the visibility intent survives the adapter.
- Updated player-safe export to retain visible imported survey entities while excluding hidden systems, planets, facilities, and all descendants of hidden source entities. The GM archive and original source payload remain unchanged.
- Added browser regression coverage for hidden systems, worlds, and nested child entities, verifying public facilities survive player export while hidden facilities and descendants do not.
- Added the supplied Acheron Rho native JSON export as a regression fixture: 293 records, 36 systems/black holes, 46 planets, and 210 non-planet survey entities. All 173 supported facility entities have occupation, situation, and readable parent details; all 42 research bases are individually checked. The other 37 moons are preserved but remain blank because the source export contains no moon occupation/situation data.
- Exposed imported occupation/situation/description/parent details in System Survey, made imported survey objects editable, and prevented body synchronization or survey rerolls from dropping imported custom entities.
- Added opt-in enrichment for missing SWN facility occupation/situation fields using adapted upstream English entries; the source payload remains unchanged and generated fields are marked. Moons intentionally remain unfilled because the upstream model defines no occupation/situation attributes for them.
- Reworked gravity generation to be population-aware: several-million, hundreds-of-millions, and billions populations always receive standard gravity. Unusual low/high/nil/zero outcomes are rare and restricted to failed colonies, outposts, and sub-million populations. A 20,000-roll distribution regression test verifies at least 95% standard gravity overall and no unusual gravity for high-population classes.

## Verified locally

Commands run from the Sector Forge project root:

```bash
node tests/import-validation.cjs
node tests/run-audit.cjs
E2E_INLINE=1 node tests/e2e.cjs
```

Results:

- All 3 supplied CSV fixtures passed: 553 total entity rows.
- Generator, migration, density, and faction-simulation stress audit passed.
- Chromium end-to-end suite passed all 11 checks with zero uncaught browser JavaScript errors.
- Native JSON tests cover the upstream grouped export shape, one-based entity coordinates, zero-based route/layer keys, parent links, and `isHidden` handling. The actual Acheron Rho export adds 293 source records, 36 systems/black holes, 46 planets, and 210 additional survey entities. Of those, all 173 supported facility entities have occupation/situation and readable parent data (including all 42 research bases); 37 moon records intentionally have no such attributes in the source.

## Still not proven / not yet feature parity

- The Acheron Rho JSON is a real export supplied by the project owner. It does not establish compatibility with every historical/future upstream version.
- CSV does not carry stable entity IDs and full typed parent links, so name/coordinate matching remains best-effort.
- Some upstream entities are preserved and editable as generic System Survey objects, but do not yet have rich entity-specific editing forms.
- Upstream navigation routes are displayed, not yet fully editable or round-trippable through a route workspace.
- Upstream layers can overlap and have their own visibility; Forge still flattens visible memberships into its simpler region model while retaining the raw layer data in the GM archive.
- Upstream factions are preserved and summarized, but are not automatically converted into active Forge factions/assets because their mechanics differ.

These are deliberate boundaries, not claims of parity. The safe next implementation stages are entity-specific editing, route editing, layer editing, and a reviewed faction conversion—each with fixtures and regression tests.


## Follow-up hotfix — 1 November 2026

The full regression report identified two defects in the previous package. Both are fixed in the current source:

- **Parent graph ordering:** the JSON importer now resolves parent chains independently of entity-group order. Asteroid bases whose parent belt is defined later in the JSON now resolve to the belt's system. Missing/blank coordinates are rejected before number conversion, so they cannot become `(0,0)`. Unresolved survey entities remain in source records and produce warnings.
- **Player archive privacy:** the player-safe serializer now filters parent-level imported entity records on systems and planets as well as survey bodies. It builds a transitive hidden-ancestor set using the source record table and nested imported records, so hidden children and descendants are removed recursively. Public imported parent-level details remain in the player export.

Regression verification on 1 November 2026:

- The five previously misplaced Acheron Rho asteroid bases resolve to Amedere Orbere (Tarma 1 and Bremerhaven), Meneus (Schiaparelli 5), Pamita Cha (Tomari 3), and Phalest (Crewe 6).
- A child-before-parent fixture passes, while an orphan with null coordinates is not attached to a system at `(0,0)` and is reported as unresolved.
- A Chromium regression scans the serialized player archive for sentinel values in hidden facility attributes, hidden planet/moon details, and a moon base beneath a hidden moon. No hidden sentinel or hidden entity name remains; a visible station and its public details remain.
- The full Acheron Rho JSON imports in Chromium with 293 records, 36 systems/black holes, 46 planets, and 210 non-planet survey objects. All 42 research bases retain occupation, situation, and parent details.
- `node tests/import-validation.cjs`, `node tests/run-audit.cjs`, and `E2E_INLINE=1 node tests/e2e.cjs` pass. Chromium reports zero uncaught JavaScript errors.

The known limitations below remain: CSV relationship inference is best-effort; some entity editors are generic rather than type-specific; routes/layers/factions are not fully feature-parity editable; and native SWN JSON export is not yet implemented.
