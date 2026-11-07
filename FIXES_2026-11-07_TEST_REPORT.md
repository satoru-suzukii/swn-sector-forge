# Sector Forge — fixes and validation report

**Baseline:** uploaded `swn-sector-forge-main (1).zip` snapshot  
**Validation date:** 7 November 2026  
**Runtime:** Node.js 22.16.0; Chromium 144.0.7559.96  
**Result:** documented validation profile passed; three consecutive Chromium end-to-end runs passed.

## Findings and changes

| Issue or area | Finding in the uploaded snapshot | Change in this revision | Validation |
|---|---|---|---|
| Imported planet edits clearing other fields | Confirmed. SWN values outside Forge dropdown lists could leave selects with no matching option; saving wrote blanks over untouched values. | Unknown existing dropdown values are represented as preserved options; editor saves from a complete draft and no longer mutates the live record merely by opening it. Imported descriptions are not regenerated on unrelated edits. | Chromium regression changes `techLevel` only and verifies atmosphere, temperature, biosphere, gravity, population, description and source attributes remain intact. |
| Custom campaign factions | Confirmed. Factions panel exposed regeneration but no create-custom-faction action. | Added **Add custom faction**, including editable fields, home-system selection, base-of-influence placement and diplomacy linkage. Existing generated faction editing is retained and exercised. | Chromium creates a custom faction, checks home/base and diplomacy links, then edits it; generated faction editing and faction-turn operations also pass. |
| Black-hole systems | Review found that black-hole systems could be rendered as an ordinary system without a structural black-hole primary in preserve-as-is imports. | Black-hole source entities now carry a distinct `systemType` and structural `B` primary, with a dedicated map glyph, inspector label and accessible label. They are not counted as extra survey objects. | Synthetic browser regression plus all three black holes in the Acheron Rho fixture. |
| Imported parent relationships | Prior regression fix was present in the baseline. | Kept the order-independent parent-graph resolver and strict missing-coordinate handling. | All five known Acheron Rho asteroid-base assignments resolve to their expected systems; missing coordinates do not fall back to hex `0,0`. |
| Player-export privacy | Prior recursive filtering fix was present in the baseline. | Kept recursive filtering of hidden imported entities and descendants, including nested source attributes, while preserving public imported details. | Serialized-JSON sentinel checks and browser-level player-safe export regression pass. |
| Gravity profiles | Population-aware distribution was present in the baseline. | Kept the population-dependent gravity distribution and included it in the current audit. | 20,000 sampled rolls: 19,585 standard (97.925%); no invalid results. |

## Tests run

| Check | Result |
|---|---|
| `node tests/import-validation.cjs` | **PASS** — 553 rows across the three CSV fixtures; native JSON import checks; Acheron Rho hierarchy; missing-coordinate handling; enrichment does not overwrite source values. |
| `node tests/run-audit.cjs` | **PASS** — 2,000 core generations, 500 expanded-profile generations, 15 campaign sectors × 12 faction turns; zero reported crashes, invalid links, bad asset records, or audit failures. The campaign simulation generated 1,205 events. |
| `E2E_INLINE=1 node tests/e2e.cjs` | **PASS × 3 consecutive runs** — all 19 grouped check areas; each run had zero uncaught browser JavaScript errors. Generated baseline sectors contained 30, 29 and 25 systems respectively. |
| JavaScript syntax | **PASS** — 28 `.js` and `.cjs` files passed `node --check`. |
| HTML local asset references | **PASS** — all 31 local `src`/`href` references in `index.html` resolve. |
| Chromium viewport/layout suite | **PASS** — System Survey and layout checks cover 1440, 1024, 820 and 390 px widths, long-token wrapping, map behavior, Markets layout and page scrolling. |
| Acheron Rho native JSON browser import | **PASS** — 293 source records, 36 systems, 46 planets, 210 non-planet survey objects, three structural black-hole primaries, 42 research-base records with retained occupation/situation/parent details, and five checked asteroid-base parent assignments. |

## Limits and follow-up work

- An optional heavier-than-default stress profile (10,000 core generations, 3,000 expanded-profile generations and 60 faction sectors) exceeded the execution limit and produced no completed report. It is **not** counted as a pass. The documented default audit completed successfully.
- Browser tests were run in the repository's offline-inline Chromium mode (`E2E_INLINE=1`). A normal localhost-navigation run did not initialize reliably in this environment; it is not counted as a pass.
- Native SWN source factions are still preserved and listed as reference records; they are not automatically converted into Forge's separate campaign faction model.
- Native SWN JSON round-trip export is not implemented. CSV parent matching remains best-effort where source identity/relationship data is missing or ambiguous.
- Some imported non-planet entity types still use the general System Survey editor instead of dedicated type-specific forms. Navigation path editing and the full upstream overlapping-layer editor also remain outside current parity.
- Automated tests cover the supplied fixtures and application workflows, not every possible third-party SWN export, every browser engine, or a full referee-led campaign. Manual playtesting is still useful before a public release.

## Reproduction commands

Run from the project root:

```bash
node tests/import-validation.cjs
node tests/run-audit.cjs
E2E_INLINE=1 node tests/e2e.cjs
```
