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
