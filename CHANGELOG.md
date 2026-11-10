# Changelog

## Sector Forge 1.2 — Maintenance, consistency, and GM control — 10 November 2026

- Made generated trade-route recalculation deterministic. A stable minimum-spanning forest and stable secondary-edge selection replace per-refresh random route creation. Existing generated routes are reclassified when system relocation changes their distance.
- Preserved GM-authored trade routes and their custom fields during topology recalculation. Manual routes remain in the sector when overextended and receive an explicit topology warning instead of being silently deleted. Route edits are marked with manual provenance.
- Removed random market-price drift from ordinary refreshes. Market adjustments now derive from current trade-route access, corporate presence, faction control, and conflict; repeating the same recalculation produces the same price. Markets outside the directly changed route neighborhood are not repriced merely because the UI redraws. Direct GM price edits become the new reference price.
- Unified operational trade-route counting between market linking and market updates. Campaign record linking no longer overwrites conflict-aware market stability, and it safely handles stale markets whose system has no remaining planet.
- Fixed World Directory saves to process only the edited world, preserve imported SWN-authored descriptions, and synchronize the linked market's system, planet, Tech Level, and population. The dynamic table now passes the edited row record to its save callback.
- Fixed survey rerolls so imported and GM-authored orbital objects survive. Newly generated survey bodies carry explicit generated provenance; legacy hand-created survey objects with stable IDs are retained.
- Fixed route recalculation so it no longer regenerates or replaces political blocs.
- Added direct diplomatic relationship editing: referees can choose the exact posture and set trust/tension directly. The existing quick **Change posture** action remains available. Manual posture changes also synchronize faction rival lists; an Alliance prevents the faction simulator from selecting the allied faction as an attack target. Saving a relationship recalculates market conditions.
- Added a persistent Campaign Turn Log. Each faction turn archives its event snapshot; referees can add or revise GM notes on each archived turn. The referee-only history remains in GM sector archives and is omitted from player-safe exports.
- Added a dedicated maintenance regression suite covering deterministic route generation, manual route preservation, relocation effects, no-op market idempotence, GM price overrides, survey rerolls, world/market synchronization, imported-description preservation, direct diplomacy editing, alliance-safe faction turns, persistent turn archives, and political-bloc preservation.
- Updated the app and README release identity to 1.2.

## Editor controls and responsiveness — 7 November 2026

- Fixed shared editor value handling so strings, numbers and booleans use the correct input property. Individual **Revert** and **Revert All** restore the exact values captured when the editor opened; cancel no longer triggers table-save callbacks or export work.
- Added field-level randomisers and meaningful templates for corporations, religions, political groups and aliens. Added campaign-aware rerollers for factions, faction assets, polities, market goods and common campaign-story fields. Randomise All now uses the live draft and preserves dependencies such as faction maximum HP before current HP.
- Added browser regressions for Randomise/Revert and Randomise All/Revert All across factions, corporations, religions, political groups, aliens, faction assets, polities, market goods, story records and boolean controls.
- Moved GM/player JSON creation, player redaction, pretty-printing and share-link compression into a same-origin Web Worker. Export links are disabled and stale share URLs cleared while a fresh snapshot is being prepared. The exact existing player privacy rules are mirrored by the worker and kept as a synchronous fallback for offline or restricted contexts.
- Coalesced rapid export requests to the latest sector snapshot, guarded worker errors with a synchronous retry, and retained previous object-URL cleanup.
- Replaced repeated region/system lookup scans in map rendering with indexed lookups and removed duplicate campaign influence recalculation.
- Measured the Acheron Rho import (36 systems, 293 source records): map redraw median 2.4 ms / max 7.2 ms; campaign panel rebuild median 0.8 ms / max 0.8 ms in the final inline-browser run. A separate Node worker-thread run measured 5.1 ms main-thread handoff and 547.8 ms worker completion for the export payload.
- Browser offline-inline regression suite: all 19 grouped areas pass with zero uncaught JavaScript errors. `node tests/export-worker.cjs` confirms worker-generated player JSON exactly matches `App.censorSector` on the Acheron Rho fixture.

## Editor, faction and black-hole regression fixes — 7 November 2026

- Fixed imported planet edits that could erase untouched SWN values when the source vocabulary did not match Forge dropdown choices. Unknown existing values are now retained as explicit options, and saving uses a complete draft so unchanged data and source metadata survive.
- Removed live-object mutation when opening the dynamic editor. Imported planet descriptions are not replaced by generated descriptions during unrelated edits.
- Added **Add custom faction** to the campaign Factions panel. Custom Forge factions can be created with editable details and a selected home system; base-of-influence placement, diplomacy links, influence and faction-turn behavior are initialized and retained. Existing generated factions remain editable.
- Kept native SWN source factions as preserved reference data rather than silently converting them to Forge's distinct campaign faction model.
- Made black holes explicit system primaries in native SWN preserve-as-is imports. They receive a dedicated black-hole survey marker, map glyph, inspector label and accessibility label instead of appearing as ordinary stars or having no primary record.
- Added Chromium regressions for the one-field imported-planet edit, generated/custom faction editing and Acheron Rho black-hole representation.

## Import hierarchy and player-export privacy hotfix — 1 November 2026

- Replaced JSON group-order-dependent child placement with parent-graph resolution. Imported children now follow parent IDs through intermediate entities (for example, asteroid base → asteroid belt → system), even when the export lists the child group first.
- Added strict coordinate-presence checks before numeric conversion. `null`, `undefined`, and blank coordinates can no longer be coerced into map hex `(0,0)` as a fallback.
- Unresolved imported survey entities remain in the preserved source records and now generate an import warning instead of being silently attached to an unrelated system.
- Fixed player-safe export to recursively filter `system.importedEntities` and `planet.importedEntities`, using hidden entity IDs and the complete hidden-ancestor chain. Hidden source records, raw attributes, and descendants are excluded from the serialized player archive; visible imported details remain available.
- Expanded regression coverage with the five previously misplaced Acheron Rho asteroid bases, child-before-parent JSON group ordering, missing-coordinate/orphan cases, and serialized-player-JSON sentinel scans for hidden direct children and multi-level descendants.
- Added a full Acheron Rho browser import regression: 293 source records, 36 systems/black holes, 46 planets, 210 non-planet survey objects, and all five corrected asteroid-base system assignments.

## Sector Forge — 10 × 12 grid and SWN import foundation

- Expanded the default map from 8 × 10 to 10 × 12 (120 editable hexes), with shared dimension validation used by map rendering, system generation, and editor operations.
- Added a Sectors Without Number import adapter for native JSON exports and entity CSV exports.
- Normalized one-based upstream entity coordinates separately from zero-based route/layer hex keys.
- Added import modes: preserve source data as-is, or explicitly run Sector Forge enrichment to fill supported gaps.
- Preserved source records and the original export payload in the GM sector archive; added a Source Data tab for reviewing imported records, routes, layers, and faction summaries.
- Drew supported native navigation route paths on the map and mapped supported native layer regions into Forge regions. Source faction records remain reference data instead of being forced into Forge's different faction-turn model.
- Added player-safe filtering for imported hidden regions and kept raw source payloads out of player-safe archives.
- Added regression fixtures for all three supplied CSV exports plus native JSON-shaped route/layer/faction coverage.

# Sector Forge 1.0 — Release notes

## GitHub-ready branding and favicon assets

- Added a custom Sector Forge favicon in SVG format, with 16 px and 32 px browser-tab PNGs, a multi-resolution ICO fallback, high-resolution PNG icons, and an Apple touch icon.
- Linked favicon assets from `index.html` using relative paths so they resolve on GitHub Pages repository/project URLs as well as at a site root.
- Updated the README project tree to list the UI helper scripts explicitly and document the favicon assets.


## Advanced generation density and full hex-system editing

- Added a collapsed-by-default **Advanced options** panel to the generation page. The default one-click flow continues to use the previous generation distribution.
- Added independent System density and World & orbital content density presets: Default, Empty, Scarce, Normal, and Crowded. System density presets control the occupied-hex count; content density presets control planets, points of interest, and non-star orbital installations.
- Verified that an Empty system preset creates a valid zero-system sector and that Empty world/content density leaves stellar survey bodies while generating no planets, points of interest, or additional orbital installations.
- Added **Create system here** when Edit mode is enabled and an empty hex is selected. New systems receive unique IDs and validated grid coordinates.
- Expanded system editing to add, edit, and delete planets, arbitrary orbital survey objects (including custom station/mine/ruin types), and points of interest.
- Newly added worlds are assigned stable IDs, linked into the system survey, given a market, and included in the world directory. Relevant route, faction-influence, and campaign-link data are refreshed after map edits.
- Hardened modal stack handling so a stale or detached modal cannot clear the live modal stack. Corrected the survey reroll browser test to target the actual reroll control instead of the new Add object control.
- Added generator and Chromium end-to-end regression checks for the density presets, zero-content sectors, empty-hex creation, custom survey objects, POIs, and world/market/survey linkage.


## Hex map controls and faction domination display

- Added a dedicated **Edit mode: ON/OFF** toggle. Editing starts off, and movement/region-edit controls are fully hidden until the user explicitly enables editing.
- Turning Edit mode off cancels a pending system move and clears the active region editor so hidden editing state cannot continue changing the map.
- Added an independent **Faction domination: ON/OFF** display toggle. When enabled, controlled system hexes are tinted by their controlling faction and the legend shows matching faction color swatches; contested systems are shown in amber.
- Turning faction domination off removes the faction tint and control rings without removing system markers, trade/scout routes, or the normal hex grid.
- Extended browser end-to-end coverage for safe default editing state, edit-control visibility, domination on/off rendering, route retention, and re-enabling both controls.


## Final System Survey and inspector fix

- Rebuilt the System Survey listing with a constrained, fixed-layout two-column table. Long orbital descriptors and generated names now wrap inside their cells instead of forcing letters into a compressed or overlapping layout.
- Kept a consistent gutter, line-height, and type/name column balance at desktop, tablet, compact, and mobile widths.
- Fixed malformed point-of-interest markup: Occupants and Situation rows now live inside a valid table body rather than being appended directly under a paragraph.
- Made the System Survey reroll control keyboard-activatable and verified that rerolling preserves linked world rows and the table layout.
- Added browser regressions that render each system's survey at four widths, force extreme unbroken identifiers, validate the point-of-interest table structure, and run the real reroll action.
- Stabilized a randomized map test by selecting a populated region hex distinct from hex `00,00`, so the test cannot accidentally toggle the same hex it just created.

## Hex map stability hotfix

- Removed all system drag gestures, background panning, wheel zoom, and zoom controls. The map viewport is fixed at `0 0 530 745` on every redraw, so pointer movement cannot drift or crop the sector.
- System markers and hexes remain clickable/selectable. Region editing still works by selecting a region and clicking hexes.
- System relocation is an explicit action: select a system, choose **Move selected system**, then click an outlined empty hex. Occupied destinations are rejected; route endpoints, faction influence, markets, and linked campaign records are refreshed after a successful move.
- Removed the inner map scrolling trap so the browser page scrolls normally over the map. Native touch gestures remain enabled for the SVG and its children.

## Living campaign graph

- Added reciprocal navigation between markets, system records, world records, and corporations.
- Added explicit corporate-to-market contract links, visible in both the corporation directory and the Trade & Routes workspace.
- Added faction asset move/readiness/repair controls, diplomacy posture editing, system influence scores, and referee territorial overrides.
- Connected faction turns and key manual changes to territory recalculation and market simulation. Local prices and supply trends respond to route access, corporate presence, territory control, and conflict pressure.
- Improved data checks for diplomacy, influence ownership, route endpoints, market/world links, and corporate-market links.

## Market layout repair

- Confined each market card and its goods table to its own grid area.
- Wide goods tables scroll inside their own wrapper instead of expanding over adjacent columns.
- Added regression checks with expanded market cards at 820px, 1024px, and 1440px browser widths.

## Final verification

- Generator stress audit: 10,000 core generations, 3,000 expanded-profile generations, and 720 faction turns across 60 campaign sectors; zero crashes or broken graph references.
- Eight fresh randomized Chromium browser end-to-end runs passed. They covered 212 generated systems, 848 System Survey render checks at 1440px, 1024px, 820px, and 390px, long-token wrapping, survey rerolls, point-of-interest markup, map stability, touch scrolling, Markets containment, links, faction controls, and export privacy.
- All eight browser runs reported zero uncaught JavaScript errors.
- All JavaScript files passed Node.js syntax checking. Detailed results are in `tests/final-validation-report.json`.
- Browser tests used Chromium's DevTools Protocol in offline-inline mode because the test environment blocks localhost navigation; the mode embeds the app's HTML/CSS/JS and local source data into the test page.

## Rules scope

This remains an original campaign-generation and simulation aid. Market-price modeling, the generic faction asset catalog, and supplement-inspired toolkits are adaptations, not verbatim implementations of every official supplement table or special rule.
