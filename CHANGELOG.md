## Sector Forge 1.4.1 — Runtime hygiene and documentation follow-up — 21 November 2026

- Fixed `GenUtil.generatePattern()` leaking its `name` iterator into the global scope. The iterator is now function-local; replacement order and generator behavior remain unchanged.
- Fixed `TextLoad.massLoad()` so each asynchronous request retains its own data key. Completing requests out of order can no longer assign multiple results to the final key.
- Fixed `TextLoad.onAllLoad()` completion bookkeeping so callback batches are detached and reset before invocation. A callback can safely start another load cycle and register its own completion callback without the prior cycle erasing the new request state.
- Added `tests/runtime-hygiene.cjs` for global isolation, out-of-order text loads, per-key assignment, and reentrant completion cycles; wired it into the full release runner.
- Promoted `App.VERSION`, the visible application label, generated-sector provenance, browser E2E identity checks, and the campaign benchmark to **1.4.1**.
- Restored and expanded user-facing README guidance for local hosting, GitHub Pages, Sectors Without Number importer limitations, GM/player export differences, player-export review, and the unofficial fan-project scope.
- No generator distributions, generator data tables, campaign simulation rules, saved-sector schema, or persisted data formats were changed.

### 1.4.1 verification

The syntax sweep and all 20 non-browser release suites passed (58/58 source files). The full Chromium suite started and passed major workflows but did not reach its final summary within the available execution window; it is explicitly not counted as a pass. Detailed measurements and the browser verification boundary are recorded in `RELEASE_VERIFICATION_1.4.1.md`.

---

## Sector Forge 1.4 — Final polish, integrity and release hardening — 21 November 2026

- Promoted the application identity to **1.4** in `App.VERSION` and the visible UI. Newly generated sectors now receive `sourceApplicationVersion: "1.4"` through the existing migration path. The root saved-sector schema remains version 3; simulation envelope and individual engine versions remain independently identified. No saved-sector schema migration is introduced.
- Fixed local-recovery integrity validation across application-version boundaries. The previous check matched only the `1.3.9+` series and therefore missed 1.4 snapshots. Validation now compares numeric version components, requires checksums for 1.3.9 and later (including 1.4 and future major versions), verifies supplied checksums, and continues to accept supported pre-1.3.9 checksumless legacy snapshots. Malformed version labels are not partially parsed.
- Reworked Expanded World population E2E coverage to exercise deterministic valid Remnant and counted-population outcomes, verify all dependent metadata, and verify Revert restores the original data. The test reacquires editor controls after a Revert rebuild instead of reusing stale DOM elements.
- Added per-command deadlines to Chromium DevTools operations and reliable browser process-group termination/profile cleanup to the E2E harness. The maintained release runner executes each suite in an isolated process with a deadline, and kills the whole process group on timeout.
- Corrected an unscoped loop variable in `generators/swnnamegen.js` so name-table iteration no longer leaks a global variable.
- Consolidated three overlapping campaign performance scripts into `tests/performance.cjs`. Renamed version-suffixed regression scripts to stable, version-neutral names while retaining their unique test coverage and fixtures.
- Removed generated validation reports/logs, superseded release-verification snapshots, duplicate performance scripts, and an unused surname file that was byte-identical to the active surname table. Kept source data, native/CSV test fixtures, all unique regression cases, architecture/model documentation, feature-parity/source audits, license, and third-party notices. Added `.gitignore` rules for local editor noise and generated test output.
- Replaced the outdated README with current project usage, data-compatibility notes, layout, and testing instructions. Added the current release verification record. Historical development milestones remain in `CHANGELOG.md`.

### 1.4 verification

The consolidated release runner passed **20/20 suites**, with **57/57 JavaScript/CommonJS files** passing syntax validation. This includes SWN import validation (553 CSV records plus native JSON fixtures), a real Node worker-thread export check, all maintained simulation/economy/logistics/political regressions, bounded generation/economy stress tests, and the full multi-turn campaign performance benchmark. The Chromium E2E suite completed with zero uncaught browser JavaScript errors, covering responsive layout, directory/editor workflows, Remnant and counted population rerolls, a 293-record imported sector, GM/player export round-trips, privacy, and accessibility of 179 visible controls. The four-turn browser campaign test completed with bounded market/history/Chronicle DOM.

Native IndexedDB transaction integration and browser-native Worker construction were explicitly skipped in the managed opaque-origin Chromium environment; the real export-worker source was independently exercised by the passing Node worker-thread suite. See `RELEASE_VERIFICATION_1.4.md` for exact measurements and environment boundaries.

---

## Sector Forge 1.3.12.4 — World Tech Level and Corporation action-column layout — 21 November 2026

- Widened the World Directory Tech Level column from 60 px to 100 px so longer technology labels remain inside their own cell instead of colliding with adjacent Tag text.
- Increased the World Directory minimum table width to 1,475 px to match the explicit sum of its reserved columns; the two Tag columns and Terrain column retain their readable widths and horizontal scrolling.
- Added a fixed 1,000 px Corporation Directory layout with reserved widths for Corporation, Sector interests, Direct market links, Ownership, Strategy, Valuation, and Edit columns.
- Reserved an 80 px Corporation Edit cell and forced its label to remain on one line, even when long organization names, interests, and strategies are present.
- Added a Chromium responsive regression for Tech Level, both Tag columns, and Corporation Edit at 320, 390, 768, 1,024, and 1,440 CSS-pixel widths. Long Tech Level and tag values are checked against their cell content boxes; corporate Edit is checked for width and no-wrap behavior.
- No simulation rules, generation distributions, campaign data, or saved-sector schema changes.

## Verification boundaries for 1.3.12.4

The focused Chromium responsive-directory suite passed at 320, 390, 768, 1,024, and 1,440 px. Seventeen inherited Node regression suites passed, and all JavaScript/CommonJS files passed `node --check`. The comprehensive browser suite was attempted but did not complete within the execution limit; it passed the new 320 px directory regression and the earlier generation, import/export, campaign, and editor checks before the harness timed out late in its run. This patch changes CSS and browser regression coverage only. No campaign engine or full-sector performance benchmark was rerun.

---

## Sector Forge 1.3.12.3 — World and Alien directory layout repair — 21 November 2026

- Fixed narrow-screen World Directory columns that allowed tags and terrain values to wrap at arbitrary character boundaries.
- Assigned explicit column widths and a scrollable 1,425 px directory layout for worlds.
- Assigned explicit column widths and a scrollable 820 px layout for the Alien Catalog.
- Kept Edit actions on one line with reserved action-column width.
- Replaced `overflow-wrap: anywhere` in these two directories with normal word wrapping and safe long-word fallback.
- Added a 320 px Chromium regression covering tags, terrain, and both World/Alien Edit cells.
- No simulation rules, generation distributions, or saved-sector schema changes.

---

## Sector Forge 1.3.12.2 — Campaign activity and market workspace performance — 21 November 2026

- Replaced eager construction of every market's commodity table and action controls with a searchable, paginated market directory (12 markets per page) and lazy detail rendering. Only the opened market builds its commodity table; closing it releases that detail DOM.
- Added market search across world/system names, factions, tags, and commodity names/categories/notes. Cross-panel market navigation now locates the target through the search directory.
- Changed the campaign turn archive to searchable, six-turn pages. Each turn's event list is collapsed by default and expanded only on demand; referee notes remain editable.
- Changed the Chronicle to 20-event initial pages with Load Older, kept existing category/search filters, and moved long event metadata into collapsed detail sections.
- Added generic search and 15-row pagination to large campaign/source data tables (more than 20 rows), including routes, shipments, finance, influence, transport, and imported source records. The table search indexes all records while only the current page is in the DOM.
- Replaced raw JSON rendering of structured Chronicle effects with bounded, human-readable key/value summaries, including valid JSON strings. Added strict wrapping and bounded display text for long identifiers, nested values, and narrative strings.
- Added repeated-turn DOM stress coverage and a 150-record table search/pagination regression. Four repeated campaign turns keep the live page at 12 market cards, at most one market detail table, six or fewer turn cards, and 20 or fewer Chronicle cards.
- Preserved simulation logic, generation distributions, archive storage policy, and sector schema. This patch changes presentation, DOM workload, and archive browsing only.

## Sector Forge 1.3.12.1 — Imported directory creation visibility — 21 November 2026

- Fixed the imported-JSON regression that hid the Corporation, Religion, Political Group, and Alien Catalog **Add** buttons. The controls were incorrectly marked `gm-only-control`; imported/player-safe sector JSON uses the page's no-edit presentation, so those four Add actions disappeared even though the handlers could create records in empty collections.
- Removed the inappropriate GM-only visibility restriction from the four directory Add buttons, matching the existing Add Faction action. Adding a new record is available even when the imported JSON omitted the corresponding collection or contains an empty array. Inline editing of existing records remains disabled in player-safe/no-edit mode.
- Clarified each directory's empty-import behavior in its panel description.
- Added a browser regression that loads a no-baseline imported/player-safe sector (`gmMode:false`, all four collections absent), verifies all four Add controls remain visible, creates and renders one record in each, and confirms that ordinary inline editing remains disabled.
- Updated the application patch identity to 1.3.12.1. No generation distributions, simulation engines, or saved-sector schema were changed.

## Verification boundaries for 1.3.12.1

The full inline Chromium E2E suite passed with the new imported-empty-directory regression and zero uncaught browser JavaScript errors. The existing 17 focused/inherited Node regression programs and full syntax sweep are rerun for this patch. This update changes only editor-button visibility and explanatory UI text; the 1.3.12 simulation/performance benchmark is retained as a baseline rather than rerun as a new performance claim. Native browser IndexedDB transactions and browser-native Worker construction remain subject to the same previously documented managed-environment limitations.

## Sector Forge 1.3.12 — Player-side directory creation and editor randomizer repair — 21 November 2026

- Added GM-facing **Add** workflows to the Corporation, Religion, Political Group, and Alien Catalog directories. Each workflow opens a draft editor, supports per-field randomization and Randomize All where generators exist, validates/normalizes the new record, saves it into the live sector, refreshes the relevant directory, and persists the sector.
- New corporations receive a stable custom ID and empty linked-market list. When the campaign settlement layer is already initialized, the new corporation also receives its settlement financial account.
- Fixed the custom-faction creation editor: it now receives the campaign generator template and actual field generators instead of only dropdown-option metadata, so Randomize All and per-field randomizers operate during creation.
- Audited the other editor Randomize All controls. Manual Survey Object and Point of Interest editors now use their real generator templates; fields without safe generators no longer receive a misleading Randomize All control. Added missing manual-entry choices for Mining platform and Ancient ruins.
- Corrected Expanded world population rerolls so the visible population estimate, hidden numeric population, population class, tech level, and gravity stay synchronized. Core rerolls clear Expanded-only metadata. Hidden derived values are staged in the edit draft and committed only on Save; Cancel leaves the sector unchanged. Individual Revert restores dependent values as well as the selected field, and Randomize All respects dependency order.
- Added UI regressions that open each relevant creation dialog, exercise Randomize All, verify generated values change, save the record, and confirm the record exists in the live sector. Added corporation account/ID checks, GM save/compression round-trip checks for all five custom record types, Survey Object and POI randomizer checks, and Expanded population reroll/Revert/save checks.
- Updated application and affected simulation-engine patch identities to 1.3.12. No saved-sector schema migration is introduced.

## Verification boundaries for 1.3.12

The 42-check inline Chromium E2E run passed with zero uncaught browser errors. Seventeen focused/inherited Node regression programs passed; all 36 JavaScript and 22 CommonJS files passed `node --check`. The bounded randomized audit passed (100 Core sector runs, 50 Expanded runs, 1,000 alien catalogs, plus faction and economy simulation checks). The full campaign benchmark passed for 36 systems / 79 markets across 14 committed turns: 1,348 shipments, 500 deliveries, 4,324 shipment legs, 1,742.97 ms median turn and 2,294.55 ms p95/max on this test host.

The default full-duration randomized audit exceeded the execution time limit; the documented bounded configuration completed successfully. Native IndexedDB transaction integration and browser-native Worker construction could not be exercised in the managed opaque-origin Chromium environment. The inline E2E did exercise application recovery logic and Worker-compatible queue behavior, and `tests/export-worker.cjs` separately passed against a real Node worker thread. These are verification boundaries, not claimed passes.

## Sector Forge 1.3.11.1 — Generation output clarity and catalog-preservation checks — 21 November 2026

- Clarified the two world-generation profiles without changing the Revised Edition Core default or its rules. The World Directory now labels the third tag candidate and population estimate as **Not generated (Core)** instead of displaying unexplained empty cells; Expanded worlds show a distinct missing-data warning if either required field is absent.
- Added a World Directory profile status that explains which procedure generated the loaded sector and warns that changing the profile does not reroll existing worlds.
- The selected Core/Expanded profile is now remembered in browser local storage when available. Storage denial or private/file browsing contexts fall back safely to the Core default without interrupting startup.
- Added a live Alien Catalog count and clarified the existing 3–8 random-count rule. No generation distribution was changed: a newly generated sector may validly roll three entries or six entries; saved/imported arrays are rendered and exported in full.
- Added browser checks for Core and Expanded column values, the 3–8 catalog range, and a six-entry alien catalog through table rendering, GM serialization and player-safe serialization. Added 500 Core/Expanded samples and 2,000 alien-generation samples in a dedicated Node regression suite.
- Re-audited the 1.3.11 source delta. The world and alien generator sources are unchanged from 1.3.10.2; no world/alien truncation or removal path was found. Updated application/affected-engine patch identities to 1.3.11.1. No saved-sector schema migration is introduced.

## Sector Forge 1.3.11 — Political turn ordering, route coherence and release hardening — 21 November 2026

- Corrected the integrated economy turn order. Pending diplomacy and formal political transitions are now applied before the market competition/pricing pass and before logistics dispatch, making war, ceasefire expiry and peace effective on their configured turn.
- Added explicit political route-cache invalidation when a pending peace settlement becomes effective, a ceasefire expires into renewed war, or a formal faction war changes the authoritative relationship to open conflict.
- Added `tests/political-turn-order.cjs`, which warms the route cache before both transitions and verifies dispatch blocking after ceasefire expiry plus removal of ceasefire risk/tariff after peace.
- Hardened local recovery record validation for malformed sector/system arrays, invalid checksums and missing checksums in current-format snapshots; checksumless legacy records remain accepted.
- Consolidated export Worker message/error handlers so the real Worker and test adapter use identical completion/fallback logic. Incomplete or mismatched-sequence responses use the synchronous encoder; stale waiters are resolved and queue dispatch continues.
- Extended Chromium E2E coverage for recovery-record integrity, malformed-file campaign preservation, Worker queue coalescing, stale completion, and mismatched-sequence fallback.
- Added a full campaign turn performance benchmark using the actual staged campaign coordinator and generated 36+ system / 70+ market sectors. A 37-system / 78-market, 14-turn run completed with a 1,603 ms median, 2,040 ms p95/max on Node v22.16.0 / Linux x86-64; it recorded 1,316 shipments, 500 deliveries and 3,851 shipment legs.
- Updated the app and affected simulation engine identities to 1.3.11. The top-level saved sector schema remains compatible; no schema migration was introduced.

## Verification boundaries for 1.3.11

Fourteen focused/inherited Node programs pass, all JavaScript/CommonJS sources pass syntax validation, the bounded random/economy audit passes, and the 33-check inline Chromium E2E run reports zero uncaught browser errors. The E2E run directly validates Worker queue behavior via a Worker-compatible adapter, while `tests/export-worker.cjs` separately runs the real worker source in a Node worker thread. Native IndexedDB transactions and the browser's real Worker constructor on a deployed HTTPS origin could not be verified in this managed environment: opaque-origin Chromium denies IndexedDB, and the managed-browser policy blocks the localhost origin. These are explicitly recorded as remaining environment-specific verification boundaries, not reported as passed.

# Changelog

## Sector Forge 1.3.10.2 — Turn-cache, live-history and recovery corrections — 20 November 2026

- Cached route graphs by commodity/base price and shortest-path trees by origin for the current sector turn. The cache is explicitly invalidated when political access, treaties, sanctions, war state, diplomacy, fleets, ports, or related transport operations change; it is also reset on turn changes and after persisted campaign edits.
- Replaced repeated logistics shipment-archive and settlement transaction-ledger sequence scans with WeakMap-backed runtime reconciliation. A full scan occurs when persisted array/archive structure changes; normal appends advance and synchronize the counters incrementally.
- Added a separate 1 MiB default byte budget for live economy/market/logistics/settlement/contract/transport histories (configurable 128 KiB–16 MiB). Oldest rows move into their existing archives while each ledger retains its newest row. Maintenance idempotency keys for ports/fleets age out after eight settled turns; a clock-based guard still blocks a late replay.
- Limited recovery fingerprint fallback to old snapshots that have no campaign ID, in both lookup and deletion. Two campaigns with identical sector maps now remain isolated.
- CSV parsing now reports unmatched quotes, drops the incomplete final row and surfaces diagnostics in import metadata; a file containing no usable data fails with the warning attached. File read/parse failures and aborts restore the generator UI and leave the previously loaded campaign intact.
- Ceasefire and peace proposals expire after three response turns, create a history/Chronicle event, and no longer block a new proposal. Skipped political-turn results consistently report `expiredProposals: 0`.
- Added regression coverage for path-cache reuse/invalidation, live-ledger byte compaction, proposal expiry/re-proposal, identical-map campaign recovery isolation, and truncated CSV handling. Updated app/engine identity to 1.3.10.2.

## Verification boundaries for 1.3.10.2

The focused Node suites and browser-independent syntax checks are run against the patched tree; the final report records exact outcomes. The synthetic history diagnostic does not substitute for replaying the user's actual save or for a shipment-heavy performance benchmark. The general random-generation audit remains unverified if it exceeds the execution window. Browser-native IndexedDB and a full interactive browser E2E run are reported separately from Node regression coverage.

## Sector Forge 1.3.10 — Strategic diplomacy, lossless archives, and campaign-scoped recovery — 19 November 2026

- Connected the faction strategic-action path to the formal political engine. With the new `factionPoliticalAutonomy` setting enabled, factions can create limited trade-pact, transit-agreement, and non-aggression proposals; respond to proposals from earlier turns; seek ceasefire under serious pressure; and propose peace after a ceasefire has remained in effect for a full turn. A proposal cannot be accepted by its proposing party, and counterpart responses are delayed until a later turn so the proposing actor cannot immediately self-ratify.
- Preserved GM authority: political autonomy can be disabled independently of ordinary faction autonomy, per-faction manual strategic control still blocks autonomous action, and GM-locked relationships remain untouched. Polity-to-polity relations remain a separate, referee-directed political model; this is bounded faction-level agency, not general negotiation or bargaining AI.
- Improved corporate contract competition. A corporation now compares a candidate offer against competing active supply contracts using expected delivered-unit cost, adjusting nominal price by observed delivery reliability. Missing delivery history is treated neutrally; unreliable low-price supply is no longer assumed to be fully dependable. Existing manually authored contract controls remain authoritative.
- Changed new retention archives to preserve the complete deep-cloned source record in `archive.records`, alongside aggregate summaries and reconciliation indexes. This applies to Chronicle events, faction-turn records, economy/logistics/settlement ledgers and related compacted record histories. Completed shipment archives now retain the complete terminal shipment, including route legs, incidents, costs and settlement references. Hot arrays remain bounded; detailed GM archives and idempotency indexes are durable and can grow over time.
- Archive preservation is forward-looking. Detailed rows already compacted by 1.3.9 into summary-only archives cannot be reconstructed. The README and data-model notes call this out explicitly.
- Replaced the single recovery-snapshot slot with per-campaign IndexedDB records keyed by a stable campaign recovery identity, plus a `latest` pointer for convenience. Saving, retrieving, updating and deleting one campaign's snapshot no longer overwrites or removes another campaign's record. A storage test double exercises isolation and pointer promotion; live IndexedDB transactions remain unverified in the managed browser environment.
- Added regression coverage for actual `CampaignTools.advanceFactionTurn()` integration, faction treaty proposal/response timing, ceasefire-to-peace timing, GM locks, delivery-reliability pricing, lossless archive bodies and campaign recovery isolation. Added null-safe recovery identity generation for sparse imported systems.
- Updated the strategic settings status to show faction, political and corporate autonomy independently; updated application identity, release documentation and browser E2E version assertions.
- Restored the local-recovery preference reader and edit-debounce scheduler after browser E2E exposed missing helpers; loading a sector remains snapshot-neutral, while persisted edits can schedule an automatic campaign-scoped snapshot when the GM enables recovery.

### 1.3.10 verification boundaries

The 1.3.10 feature-completion suite and inherited focused Node regression suites are run against the packaged source. The browser E2E harness can run in offline-inline mode, but its IndexedDB and browser Worker checks are skipped there; managed-browser policy also blocks local-origin navigation, so the storage test double is not a substitute for a real IndexedDB transaction round-trip. The large general-purpose audit exceeded the available execution window in prior attempts and is not treated as passed. Deployed HTTPS Worker contention and extended campaign calibration remain unverified. The campaign-turn coordinator remains an in-memory staged commit/rollback mechanism, not a durable phase-resume journal after process termination.

## Sector Forge 1.3.9 — Retention, recovery, and release hardening — 14 November 2026

- Added configurable bounded hot-history retention for the Chronicle, economy/market/logistics/settlement/contract/transport ledgers, faction-turn history, and completed shipment records. Older entries move to compact GM-side archives with aggregate counts, totals, preserved exact financial idempotency keys, stable sequence counters, and archived GM notes. Active shipments are never compacted; archived shipment summaries preserve payment reconciliation and shipment IDs while dropping detailed route-leg arrays.
- Expanded the campaign-turn pre-commit gate to validate the root sector, coordinator journal, economy, logistics, settlement, diplomacy, politics, strategy, contracts, and transport before the staged sector can replace the live save. Setting lower retention limits now compacts immediately.
- Added an opt-in browser-local recovery snapshot in IndexedDB, with manual save/restore/delete controls, debounced automatic snapshots after saves, a checksum integrity check, accessible status updates, and a clear privacy notice. Snapshots are GM-only, one-per-browser profile, and are not uploaded.
- Hardened shipment ID continuation across compaction and save/load, archived shipment payment validation, safe archive dictionary keys, and retention summaries. Removed a duplicate diplomacy validation pass from the turn commit gate.
- Added the final-hardening regression suite: archive/retention bounds, retained referee-note details within the archive budget, archived shipment payment reconciliation, external-key idempotency, stable contract/shipment IDs, atomic rollback on malformed transport/contracts, and an 80-turn campaign smoke.
- Added accessibility/status semantics and release checks for the new recovery and retention UI. Existing map, imports, exports, player privacy, deterministic simulation and campaign turn workflows remain covered by the inherited tests.

### 1.3.9 post-release defect corrections — 15 November 2026

- Faction rerolls now preserve the committed campaign turn on sectors without the local economy, keeping the legacy clock, simulation clock, coordinator journal and next turn aligned.
- Player-safe exports now remove market controller IDs/names, omit explicitly referee-only trade routes, and recursively strip GM/private route metadata in both the app fallback and export worker. The GM export remains unchanged.
- Turn-journal compaction now uses `simulation.settings.historyRetention.turnJournal`; the default remains 50, while a configured larger retention value is honored and older records are archived by the normal compactor.
- Player-export censoring treats missing optional corporations, aliens, religions and political-group arrays as empty arrays. Contract auto-sequencing now reconciles its next ID against existing `TC-` records, including manually supplied numeric IDs.
- Loading or restoring a sector refreshes its download/share exports without scheduling an automatic recovery snapshot. Subsequent edits and explicit recovery actions retain their existing snapshot behavior.
- Fixed the logistics arrival clock field path and downgraded duplicate system coordinates from a turn-blocking validation error to a review warning.
- The retained `externalKeys`, `shipmentTransactions` and shipment-summary dictionaries remain durable lookup/audit indexes. They are intentionally not truncated by hot-array retention, because pruning them without a separate expiry/tombstone design could weaken settlement idempotency or shipment reconciliation.
- Added `tests/defect-regressions.cjs` and expanded the worker-export privacy test with market-control and nested route-metadata sentinels.

### 1.3.9 verification boundaries

IndexedDB transaction behavior could not be exercised in the offline `about:blank` Chromium harness because opaque origins deny IndexedDB access; the hosted localhost browser attempt is blocked by the managed browser policy. The recovery implementation therefore has code-level review and UI smoke coverage, but not a live browser IndexedDB end-to-end pass in this environment. The browser Worker queue stress is likewise skipped in inline mode; the separate Node worker-thread export suite passes. Retention archives preserve audit summaries and transaction reconciliation, not every old shipment leg or every old Chronicle event body. The browser-local recovery snapshot is not encrypted and is not a substitute for a separate GM export backup. Calibration and extended user campaign playtesting remain qualitative follow-up work.

## Sector Forge 1.3.8 — Integrated politics, causal markets, and atomic campaign turns — 14 November 2026

- Added `simulation/political-engine.js` as a distinct formal politics layer. Polity-to-polity relationships retain their own directed vocabulary and never collapse into faction diplomacy. Referees can create treaty proposals, accept/reject them, renew, terminate or record breaches; impose/lift commodity-scoped or directional sanctions; and record wars, humanitarian exceptions, ceasefires and peace settlements with explicit effective-turn semantics. These instruments affect trade access at the route border. The former “asset freeze” label is now “financial restriction”: it adds border risk and does not claim to freeze settlement balances.
- Integrated political effects into logistics pathfinding and market competition. Explicit ceasefire/humanitarian passage can override an automatically-derived faction “Open conflict” embargo, while an explicitly GM-authored embargo, denied transit right, commodity ban or active blockade remains restrictive.
- Added bounded network competition to local pricing. Reachable suppliers are compared by landed costs, route risk and lead time; expected inbound shipment quantities are weighted rather than treated as inventory. Competition effects are bounded and recorded in price and market ledger explanations.
- Added `SectorSimulation.advanceCampaignTurn()`. The legacy faction executor remains responsible for faction asset actions, upkeep, combat and history, but now runs on a staged JSON checkpoint with derived-state refresh, economic/logistics/settlement/diplomacy/politics/strategy phases, validation and a single commit. A failure preserves the original live sector for deterministic retry. At introduction, the turn journal kept the latest 50 committed turns; 1.3.9 later made this limit configurable (see the post-release corrections above). This is an in-memory atomic commit/rollback boundary, not a durable browser-crash recovery journal.
- Removed campaign reconciliation from `App.renderCampaignPanels()`. Load-time migration/reconciliation remains explicit; repeated panel rendering is verified read-only against a full imported sector snapshot.
- Expanded `SectorSimulation.recordEvent()` metadata and the GM Chronicle panel with category filtering, search, actors, affected records, system locations, causes, effects and private referee notes. Shipment history links dispatch, physical arrival, payment settlement and contract delivery in causal order.
- Added a deterministic integrated crisis scenario: a war closes a corridor, shipping is blocked, shortages and bounded price pressure appear, faction/corporate reports respond, a ceasefire restores risk-adjusted passage, delivery settles and Chronicle links the consequences.
- Added three dedicated regression suites: `politics-turn-coordinator.cjs`, `market-competition.cjs`, and `integrated-scenario.cjs`. Updated audit loading, browser version checks, settlement version checks, README and simulation architecture/data-model contracts.

### 1.3.8 scope boundary

The political system is referee-directed, not an autonomous diplomatic AI: treaties are proposed/ratified by the GM, and the engine does not conduct bargaining, arbitration, treaty enforcement campaigns, or autonomous polity diplomacy. “Financial restriction” changes border risk only; it does not freeze accounts or seize property. Network competition is a bounded pricing modifier, not a full forecast or macroeconomic model. Campaign turns are transactional in memory and roll back on handled phase/validation failures; the 50-entry journal is not a durable process-crash recovery mechanism. Chronicle and simulation ledgers remain lossless/unbounded. Transport remains abstract, specialized warehousing/spoilage and piracy/seizure are not modelled, and first-pass coefficients need campaign calibration. A reduced bounded audit (100 core generations, 50 expanded generations, and one faction/economy sector-turn each) passed without invariant failures; a larger multi-turn profile exceeded the two-minute execution window in this release environment. Focused tests and browser E2E passed. These remaining hardening, performance, accessibility, long-run retention, and deployed-browser Worker checks are 1.3.9 work.

## Sector Forge 1.3.7 — Strategic actors and transport infrastructure — 13 November 2026

- Replaced equal-weight/random faction action selection with a condition-driven decision scorer. Legal actions are ranked using faction goals, resources/FacCred pressure, asset damage/readiness/upkeep, controlled-market shortages and surpluses, route/system importance, threat targets, and diplomatic posture. Chosen decisions carry a target, rationale, confidence, risk, alternatives, and bounded seeded uncertainty; execution remains with the existing faction-turn rules.
- Added configurable global strategic autonomy (`enabled`, `factionAutonomy`, `corporateAutonomy`, `decisionNoise`) plus faction/corporation manual-control locks. GM-authored relationship locks, canonical fields, and existing asset/turn mechanics remain authoritative.
- Expanded corporate intelligence into independent commercial choices. Corporations analyze linked market surplus/shortage and real reachable paths, can negotiate limited priced recurring supply contracts, pause repeatedly unviable owned contracts, invest in merchant fleet capacity for recurring capacity bottlenecks, or conserve capital when opportunity/risk does not justify spending.
- Added `simulation/transport-engine.js` with persistent spaceports and fleet records. Port condition/handling capacity constrains routes; assigned fleets add cargo capacity, influence transit duration and reliability/risk, and contribute variable route expense. Existing abstract route capacity remains functional without fleets for old-sector compatibility.
- Added recurring port/fleet operating and maintenance transfers through campaign-credit settlement, with per-turn idempotency keys, fleet condition/default behavior, route-allocation limits, ownership/status validation, and GM-editable transport tables.
- Extended the Factions and Trade & Routes UI with strategic autonomy controls, decision reports, spaceport configuration, fleet commissioning/editing/assignment/retirement, and transport status. Player-safe exports remove corporation-only strategy metadata in both synchronous and worker export paths.
- Added `tests/strategic-transport.cjs`; updated the audit loader and Chromium E2E to verify strategy/transport UI, fleet lifecycle, AI metadata privacy, and the 1.3.7 source identity. Existing 1.2 maintenance, import, economy, logistics, 1.3.5 settlement/diplomacy, 1.3.6 commerce, and export-worker suites remain part of the required release run.

### 1.3.7 scope boundary

Faction decisions are explainable and condition-driven but deliberately imperfect, not omniscient. The scorer chooses only from legal actions already supported by the existing faction-turn engine; it does not replace that executor or reproduce every SWN faction asset rule. Corporate choices are limited to linked-market opportunity selection, recurring supply agreements, pausing persistently poor agreements, and fleet expansion/holding capital. Transport is a port/fleet capacity and economics abstraction, not a physical vessel simulation. Specialized cargo storage/spoilage, crew/fuel/hull combat, convoy scheduling, automatic route construction, corporate competition/mergers, formal treaty/war negotiation, polity-level diplomacy, and bounded Chronicle/ledger archives remain future work. 1.3.8 is reserved for the remaining diplomatic and sector-wide feature-completion work; 1.3.9 remains reserved for inspection, regression, bug fixing, performance, and quality-of-life hardening.

## Sector Forge 1.3.6 — Commodity settlement, cargo economics, and recurring supply contracts — 13 November 2026

- Extended `simulation/settlement-engine.js` so final-market deliveries now settle the commodity purchase value from the destination market-clearing account to the origin seller (seller corporation, controlling faction, or origin market fallback). The dispatch-time sale price is stored on the shipment; only physically delivered lots are paid, and partial deliveries pay only the delivered quantity. Legacy shipments without a recorded sale price remain explicitly unpriced rather than being assigned invented historical transactions.
- Added persistent commodity freight profiles to the economy catalogue. Category defaults now assign differentiated `freightUnitsPerLot` and a handling class. Route planning weights cargo by freight units, and live directional route capacity is consumed in cargo units rather than equal-weight lots. GM-edited freight units and handling classes are protected through migration by field-level override metadata.
- Added per-leg route operating expense. The route operator pays the infrastructure-services account for the configured operating cost per cargo unit; the cost is visible in route and shipment views and is recorded separately from shipper freight/toll/tariff charges.
- Added `simulation/trade-contract-engine.js` with persistent, GM-authored recurring supply contracts. Contracts define source/destination markets, commodity, per-turn lot target, optional fixed negotiated unit price (zero uses the shipment's dynamic midpoint price), effective turn range, and priority. Dispatch, delivery, loss, shortfall history, and contract ledger events are recorded.
- Contract planning honors ordinary stock availability, destination demand, route capacity, border access, storage constraints, and transit risk. Contracts do not create stock or guarantee delivery. Contracted volume is prioritized and any remaining market need can still be served by spot trade. Overlapping active contracts for the same market pair and commodity are rejected to avoid ambiguous double commitments.
- Expanded Trade & Routes UI with recurring-contract management and commodity freight-profile editing; shipment records now show cargo units, goods paid, route operating cost, and contract association. Route endpoint edits now persist both endpoints and recalculate route distance.
- Preserved 1.3.5 finance, diplomacy, strategic assessments, market inventories, shipments, and GM field overrides. Settlement schema is migrated additively; existing balances and old unpriced shipments are not retroactively changed. Contracts and their ledgers remain GM-private through the existing player-safe export projection.
- Added `simulation/trade-contract-engine.js` to the audit module list and a dedicated `tests/commerce.cjs` suite covering commodity freight weights, capacity enforcement, GM profile overrides, fixed-price recurring contracts, contract/spot separation, delivered-only payment, payment idempotency, route operating expenses, contract history, expiration/pause, validation, and save round-trips. Browser E2E now checks the 1.3.6 panels, contract creation, version provenance, and player privacy.
- Added `tests/sector-forge-1.3.6-validation-report.json` with focused tests, browser checks, stress-audit outcomes, package integrity, and explicit environmental limitations.

### 1.3.6 scope boundary

1.3.6 completes a deeper commercial-transfer layer, not a full transport or market simulation. Freight units and handling classes affect abstract cargo capacity only; there is no specialized storage, refrigeration, spoilage, hazardous-cargo enforcement, port handling, vessels/fleets, convoy scheduling, or fleet maintenance model. Route operating expenses are campaign-credit transfers to an infrastructure service account, not a detailed operator profit-and-loss model. Contracts are GM-authored recurring shipment targets, not guaranteed deliveries or automatic corporate decisions; they do not create goods, reserve inventory months ahead, or bypass policy/capacity/storage/risk. Overdraft thresholds remain warnings, not hard borrowing limits. Automatic corporate investment/contract creation, full strategic faction actions, treaty/war negotiation, polity diplomacy evolution, and bounded Chronicle/ledger archival remain future milestones.

## Sector Forge 1.3.5 — Financial settlement, automatic diplomacy, and strategic intelligence — 12 November 2026

- Added `simulation/settlement-engine.js`. A dedicated GM-private settlement record under `sector.simulation.economy.settlement` tracks Cr accounts for factions, corporations, market clearing, the Interstellar Logistics Guild, and the Customs Authority. Legacy SWN `factionCredits` / FacCreds are not converted or modified.
- Added explicit estimated opening-capital rules for faction, corporate, and market accounts. These values are referee-facing campaign baselines, not published SWN conversions or claims about canonical world wealth. Existing `treasuryCredits` values are used when present.
- Connected each dispatched shipment leg to settlement. Freight and toll are paid to the route operator where defined; tariffs are paid to the destination controller or customs service. Transfers update both account balances and write persistent transaction IDs, before/after balances, payer/payee references, amount, type, shipment, route-leg, turn, and memo. Duplicate leg settlement is guarded by a persistent settlement ID.
- Corrected negative-balance arithmetic in the settlement rounding helper. Overdrafts now remain negative and transactions explicitly flag when an account crosses its configured warning threshold. This threshold is diagnostic only: it is not a hard credit cap and does not block shipment dispatch.
- Added `simulation/diplomacy-engine.js`. After logistics resolve, bilateral faction diplomacy processes delivered cross-border trade, shipment incidents, and hostile faction attack events. These signals adjust trust and tension within bounds and can move unlocked relationships through the existing faction posture vocabulary using threshold/hysteresis rules. GM field locks, manual flags, `automatic:false`, and full relationship locks suppress automatic changes. Polity-to-polity vocabulary remains separate.
- Added `simulation/strategic-engine.js`. Each economic turn assesses controlled-market shortages/surpluses for factions and linked-market supply pressure/opportunities for corporations. Market import priorities (`emergency`, `high`, `normal`) are derived from stock coverage and influence the following logistics planning pass. Existing GM-locked policies take precedence. The reports are bounded intelligence and logistics-priority inputs, not full autonomous faction/corporate action selection.
- Added Factions / Strategic intelligence and Trade & Routes / Commercial finances panels. Financial accounts can be edited by the GM; labels distinguish overdraft warnings from hard limits. Diplomatic and strategic systems remain GM-private with the rest of the simulation envelope.
- Added turn-clock resumption for older 1.3.4 campaign saves that did not yet contain settlement, automatic-diplomacy, or strategic state. New engines establish their baseline from the saved economy clock rather than replaying historical turns.
- Strengthened release regressions for transaction arithmetic, corporate route revenue, overdraft flags, settlement idempotency, trust/tension/posture GM locks, `automatic:false` locks, manual market-priority locks, 1.3.4 turn-clock continuation, strategic report creation, save round-trips, and player export privacy.
- Extended the multi-sector stress audit to execute and validate financial settlement, automatic diplomacy, and strategic assessment during economy turns.
- Added `tests/sector-forge-1.3.5-validation-report.json`, recording focused-suite results, browser coverage, the completed full stress-audit metrics, and environment/test-scope limitations.

### 1.3.5 scope boundary

1.3.5 is the first financial/diplomatic/strategic feedback slice, not completion of the Living Sector. Only freight, toll, and tariff charges settle as Cr transfers; the commodity sales price is not transferred between buyer and seller. Opening account balances are estimated. Overdraft warning thresholds do not enforce borrowing limits. Diplomacy reacts to a limited set of signals rather than a complete treaty/war decision model. Faction reports and import priorities do not yet replace the existing faction-turn decision rules with a strategic AI, and corporations do not automatically create contracts, invest, hire shipping, produce goods, or change ownership. Fleet assets, cargo classes, port infrastructure, convoy scheduling, route operating costs, tariff negotiation, polity-relationship evolution, compact-share controls, and bounded ledger/Chronicle archival remain future work.

## Sector Forge 1.3.4 — Interstellar logistics and diplomatic trade access — 12 November 2026

- Added `simulation/logistics-engine.js` as the next Living Sector milestone, extending 1.3.3 local inventories into persistent cross-market shipments under `sector.simulation.economy.logistics`.
- Added weighted multi-hop pathfinding over the shared operational trade-route rules. Route settings support per-turn cargo capacity, transit duration, freight cost, toll, risk, and direction (`both`, `forward`, or `reverse`). Missing route settings receive clearly labelled provisional defaults and are not silently written onto canonical route records.
- Added automatic export planning: unlocked market stock above 115% of target can supply compatible market shortages below 70% of target, with pending inbound shipments reducing duplicate demand. Origin inventories are debited when dispatch is committed; cargo is credited only on final arrival.
- Added persistent shipment itineraries and leg progress. Every leg consumes capacity for its direction and campaign turn; multi-hop shipments wait at intermediate systems and resume on later turns. Capacity-full routes queue shipments; route/policy changes can trigger re-planning; missing paths leave shipments delayed rather than teleporting cargo.
- Added deterministic per-shipment/per-route transit incidents. Route risk can produce a one-turn delay or a recorded 5–20% cargo loss. Cargo, freight, toll, tariff, arrival, departure, and loss records are retained in the logistics ledger; relevant events enter the GM Chronicle.
- Added basic diplomatic trade enforcement at each controlled border: posture defaults, explicit access policy, transit-rights revocation, tariff percentages, and commodity embargoes. GM-authored policy can override automatic posture defaults; commodity embargoes and denied transit rights remain restrictions.
- Added a delivered-freight pressure component to local price targeting. It decays over subsequent economy turns and respects field-level GM locks.
- Expanded the Trade & Routes workspace with editable route logistics parameters, directional controls, diplomatic trade-policy fields, logistics status, shipment progress, ETA, and recorded costs.
- Preserved existing local economy accounts, market projections, 1.2 maintenance behavior, SWN import/export, GM JSON saves, player-safe export projection, faction turns, and prior campaign UI. Simulation records remain GM-private because `App.censorSector()` does not export the `simulation` envelope.
- Added `tests/logistics-engine.cjs`, including weighted-path selection, one-way corridors, route eligibility, cargo capacity, sequential multi-hop movement, blocked-route recovery, one-arrival idempotency, shipment cargo conservation, diplomacy/embargo overrides, deterministic incidents, GM-stock locks, Chronicle/ledger records, and JSON round-trip checks.
- Added `tests/sector-forge-1.3.4-validation-report.json` with the final suite results, stress counts, browser E2E coverage, environment limitation, and explicit implementation boundaries.

### 1.3.4 scope boundary

1.3.4 implements the first real inter-market logistics slice, not a complete trade or faction economy. All current catalogue lots use one freight unit; there are no ship/fleet assets, cargo classes, convoy scheduling, port handling, trade contracts, currency transfers, actual tariff revenue, route operating costs, spoilage, piracy/seizure choices, or automatic diplomacy evolution. Prices receive a simplified delivered-cost pressure; freight/toll/tariff amounts are recorded but not settled against faction or corporate accounts. Automatic faction strategy and corporate reactions remain future milestones. Shipment and Chronicle retention are currently unbounded; explicit archive/retention controls remain future work.

## Sector Forge 1.3.3 — First living-economy implementation — 11 November 2026

- Added `simulation/economy-engine.js` as the first active economic simulation module. It creates market-scoped accounts under `sector.simulation.economy`, keeping the established top-level market and good records intact as the compatibility/UI layer.
- Added explicit local production and consumption schedules using categorical population bands, Tech Level, market profile, and a deliberately limited set of exact SWN world-tag mappings. The current coefficients are first-pass campaign abstractions, not a claim of economic realism or a transcription of *Suns of Gold*.
- Added explicit opening-stock initialization. New sectors initialize their local market accounts at creation; legacy and imported sectors remain uninitialized until the GM chooses **Initialize local economy**. Existing legacy `supply` labels and prices are not converted into invented stock quantities.
- Added per-market commodity inventory, target stock, reserved quantities, storage capacity, unmet demand, overflow handling, per-turn ledgers, and gradual bounded scarcity-price response. Each local ledger line balances opening stock, production, consumption, overflow, and closing stock.
- Connected the local economy to the existing **Advance campaign turn** control. A campaign turn runs the local market balance once, records compact Chronicle events, and cannot silently re-run the same economic turn. Rendering and route/market refreshes do not advance the economy.
- Added market stock/output/demand GM editing controls and field-level override handling. World population, Tech Level, tags, and market profile refresh unlocked schedules without resetting current stock; removed market goods are retained in the market state's retired-commodity history.
- New worlds added after economy initialization receive a new account without resetting existing markets. Regenerating factions preserves the campaign/economy turn clock.
- Preserved the legacy market display/export structure. Local stock, production, consumption, and price state are stored in the GM simulation envelope and remain excluded from player-safe exports.
- Added dedicated economy tests and a multi-sector, multi-turn economy stress audit. Expanded browser E2E checks cover new-market initialization, economy/campaign-turn integration, and faction-reroll clock continuity.
- Added `tests/sector-forge-1.3.3-validation-report.json` with the validation results, measured stress counts, and the explicitly unexercised browser Worker stress path.

### 1.3.3 scope boundary

This is the first local-economy vertical slice, not completion of the Living Sector goal. Goods do not yet move between markets. Weighted multi-hop shipping, route capacity/transit/freight/risk, trade contracts, inter-market price competition, tariffs/embargoes, automatic diplomacy, strategic faction AI, corporate economic behaviour, and bounded archival/share-link retention remain future work. The initial population/profile/tag coefficients are intentionally exposed in code for later calibration through test sectors and playtesting.

## Sector Forge 1.3.2 — Foundation integration and consistency fixes — 11 November 2026

- Removed the duplicated trade-route operational rule. `CampaignTools.isTradeRouteOperational` and `SectorSimulation.isTradeRouteOperational` now reference the same `TradeRouteRules.isOperational` function; tests assert strict function identity and shared behavior.
- Corrected application-version provenance. Freshly generated sectors are migrated at creation with `sourceApplicationVersion: "1.3.2"`; unversioned native legacy saves are identified as 1.2, while imported SWN sectors remain `unknown` unless they carry source-version metadata. Existing 1.3.1 saves already stamped 1.2 are left unchanged because the old build used the same marker for new sectors and loaded 1.2 saves, so retroactively relabelling them would misclassify genuine legacy sectors.
- Replaced the persisted sector-wide mutable RNG state with an immutable root seed and ephemeral xorshift streams keyed by turn, phase, and scope (including faction ID). The legacy faction-turn procedure now uses isolated keyed streams and refuses to fall back to global `Math.random` when advancing an unmigrated sector.
- Added explicit `refreshDerivedState()`: pure graph calculation stays read-only, while the app commits `simulation.derived.lastFingerprint` after sector load and relevant map/route/turn changes.
- Standardized field locks on `fieldOverrides`. Legacy 1.3.1 `manualOverrides` entries migrate into the canonical map when helpers touch a record; new writes use only `fieldOverrides`.
- Wired provenance/override helpers into practical app flows: survey rerolls preserve records by provenance, imported or GM-locked world descriptions are protected, and edited campaign fields receive field-level manual locks.
- Connected the existing faction-turn button to the new Chronicle with a compact event linking to the legacy faction-turn archive. The detailed legacy archive and GM notes remain intact.
- Expanded structural validation for polity IDs, member-system references, and polity-to-polity references.
- Expanded `SIMULATION_DATA_MODEL.md` with the separate polity relation model and a save/share-size policy for future ledgers and Chronicle growth. Full GM JSON stays lossless; share URLs are bounded snapshots and must never silently truncate archival data.
- Added regression tests for route-rule identity, keyed stream isolation and replay, global-random independence, source-version labeling, derived fingerprint commits, field-override normalization, and polity references.
- Updated the development UI to **SECTOR FORGE 1.3.2 DEV**. This remains a development foundation; the living economy and automatic political simulation are not yet implemented.

## Sector Forge 1.3.1 — Living Sector Simulation foundation (superseded by 1.3.2)

### Foundation milestone

- Created a separate 1.3 development workspace from the verified 1.2 release archive; the 1.2 ZIP remains untouched as the rollback baseline.
- Added an independent `sector.simulation` schema envelope while retaining the legacy root `schemaVersion: 3`.
- Added an idempotent, additive migration that runs after existing preserve/enrich handling and does not generate campaign content or rewrite legacy faction history.
- Added the initial sector-persisted deterministic random foundation (`xorshift32-v1`); 1.3.2 replaces its global mutable stream with keyed streams.
- Added provenance resolution for generated, imported, simulated, manual, and legacy records, plus field-level manual override helpers.
- Added pure route-graph derivation for operational trade-route adjacency, connected components, and multi-hop market reachability. It reports hops only; no shipment or capacity model is implemented yet.
- Added read-only structural validation for IDs and important route, market, world, faction, and diplomacy references.
- Added a persistent, sequenced simulation Chronicle event API. Legacy `factionNews` and `factionTurnHistory` remain intact and are not yet replaced. The existing faction-turn and faction-reroll controls synchronize the transition clock.
- Kept the new `simulation` envelope out of player-safe exports by continuing to use the explicit `App.censorSector()` projection.
- Added `tests/simulation-foundation.cjs`, `SIMULATION_ARCHITECTURE.md`, and `SIMULATION_DATA_MODEL.md`. The data-model contract defines canonical versus simulated ownership, commodity units, market stock-flow accounting, route logistics, multi-hop shipments, price formation, diplomatic trade policy, strategic faction inputs, and the proposed turn sequence; those future domain behaviours are documented, not yet implemented.
- Updated the initial development UI identity to **SECTOR FORGE 1.3 DEV**. This is not a finished 1.3 release.

### Not part of this milestone

Commodity production/consumption, inventories, shipping execution, weighted multi-hop logistics, route capacity, dynamic supply-and-demand pricing, diplomatic evolution, and strategic faction AI are still unimplemented. They will be introduced in separate tested stages.

---

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

