# Sector Forge — Final release verification

**Verification date:** 7 November 2026  
**Build:** editor/performance update, with final test-harness corrections  
**Scope:** editor actions, imports, generator integrity, campaign simulation over long runs, export/round-trip behavior, worker execution, UI responsiveness, and package integrity.

## Result

The build passed the release regression suite in both the synchronous compatibility path and a Chromium browser Worker path. No application JavaScript exceptions were recorded in either full browser run. The latest ZIP also contains two test-harness improvements: the round-trip test now waits for asynchronous export completion, and the campaign audit accepts a configurable number of faction turns.

This supports using the build as a beta release candidate. It is not a guarantee that no defect exists, and the exact same-origin Worker script URL could not be loaded in Chromium in this environment because a managed browser policy blocks every navigation URL.

## Browser regression results

The full E2E suite passed in Chromium with **19 grouped check areas** in both configurations:

- **Synchronous fallback:** full suite passed; 0 uncaught browser errors. The test covered sector generation and the 120-hex SVG, SWN CSV/native JSON imports, editor workflows, mobile and desktop layouts, faction operations, imported-planet preservation, black-hole rendering, map editing, player privacy, GM/player exports, and save round-trips.
- **Worker-enabled browser run:** full suite passed with `App._exportWorker` enabled; 0 uncaught browser errors. This run also passed the GM export/re-import/re-export round-trip and player-safe export checks.
- **Worker burst/coalescing:** 25 rapid saves were issued. The exported GM snapshot contained the final `QUEUE_25` marker; stale download links were disabled while the new export was pending; after completion the queue was empty, the worker was idle, and the download link was ready.

### Large-sector responsiveness sample

The responsiveness smoke test used the Acheron Rho native import: 36 systems, 46 planets, and 293 source records.

| Metric | Worker-enabled browser run | Synchronous fallback run |
|---|---:|---:|
| Map redraw median / max | 2.1 / 3.3 ms | 3.2 / 6.5 ms |
| Campaign panel rebuild median / max | 0.6 / 0.6 ms | 0.7 / 1.4 ms |
| Export scheduling sample | 6.2 ms | 202.1 ms |
| Four-save export batch completion | 568.7 ms | 799.2 ms |

These are measurements from this test environment, not promises for every browser or device. The important result is that the worker-enabled run kept the main-thread export scheduling work in the single-digit-millisecond range, while the fallback path remains functional but can pause the page during large exports.

## Long-run faction simulation

The campaign audit was expanded and run with:

`SWN_FACTION_SECTORS=15 SWN_FACTION_TURNS=100 node tests/run-audit.cjs`

Results:

- 15 generated sectors × 100 turns = **1,500 faction turns**.
- **9,930 faction-turn events** generated.
- 0 faction-turn crashes.
- 0 invalid faction assets/IDs/HP values.
- 0 negative or invalid faction-credit balances.
- 0 broken diplomacy, influence, corporate-market, market-route, or market-world references.

The same run also passed 2,000 core generation runs and 500 expanded-profile runs, with zero crashes or audit failures.

## Import, data preservation, and export

`node tests/import-validation.cjs` passed:

- 553 CSV records across the supplied sector fixtures, plus the native SWN JSON fixture.
- Native 1-based entity-coordinate normalization and hierarchy/parent resolution.
- Route/layer mapping and source-faction retention.
- All five previously misplaced Acheron Rho asteroid-base parent links.
- Enrichment only fills supported missing values and leaves original source records unchanged.

The browser round-trip tests confirmed that Sector Forge GM JSON preserves edited world fields, descriptions, campaign notes, POIs, custom orbital objects, campaign factions, GM notes, and all 293 SWN source records through export/import/re-export and compressed URL round-trips. Player export preserved public world fields while omitting GM-only data according to the existing privacy policy.

`node tests/export-worker.cjs` executed the **exact `export-worker.js` source** on a separate Node worker thread. It verified GM source-record retention, compared player output byte-for-byte with the app's `App.censorSector` result, checked JSON Blobs, and decompressed both share links back to their JSON payloads.

## Package and syntax checks

- All `.js` and `.cjs` files pass `node --check`.
- All 34 local references found in `index.html` resolve; none are missing.
- ZIP integrity check reports no compressed-data errors.

## Browser-policy limitation (important)

A standard Chromium navigation to the local HTTP test server was blocked before the app loaded. Inspection of the managed Chromium policy showed `URLBlocklist: ["*"]`; attempts using loopback, the container's private IP, and a local test hostname were all blocked. This is an environment restriction, not an application error, and I did not override the managed policy.

To validate browser-thread behavior without bypassing that restriction, the Worker-enabled E2E run loaded the app in Chromium's inline test mode and instantiated a dedicated browser Worker from the actual `export-worker.js` source, with the existing LZ-string dependency inlined because a Blob Worker cannot resolve the script's relative `importScripts()` path. This exercised the real worker message handling, structured-clone payload, Blob creation, compression, app queue, save completion, and download links in Chromium.

Separately, the Node worker-thread test ran the exact unmodified `export-worker.js` file and its real `importScripts('lzstring.min.js')` dependency. Together, these tests validate the worker logic and browser integration, but **they do not replace a final smoke test on the deployed HTTPS origin**. The production origin is the only place this environment could not directly verify the normal same-origin `new Worker(new URL('export-worker.js', document.baseURI))` loading route.

## Final recommendation

Use this archive as the next beta release candidate. After deploying it, confirm that the browser's Network/Console panels show `export-worker.js` and `lzstring.min.js` loading successfully from the same origin, then make one edit, wait for the export links to refresh, download both GM and Player JSON, and advance several faction turns. The synchronous fallback remains available if Workers are unavailable, though large exports will be slower.
