# Sector Forge — editor controls and responsiveness report

**Date:** 7 November 2026  
**Base:** `sector-forge-fixed-2026-11-07-roundtrip-verified.zip`  
**Working build:** updated source in this archive  
**Scope:** Randomise/Revert behavior across data editors, cancellation/save semantics, and UI responsiveness under larger imported sectors.

## Findings and changes

| Area | Confirmed issue | Change | Validation |
|---|---|---|---|
| Shared editor controls | Boolean controls were read/written through the text value path, so checkbox randomisation/revert could be incorrect. | Centralised typed read/write for text, number and checkbox values. Each field snapshots its original value; field Revert and Revert All restore the opening state. | Browser regression exercises boolean randomise, individual revert, all revert and confirms the source object was not mutated on cancel. |
| Factions and campaign editors | Some editors used generic templates without field generators. | Added campaign-aware generators for factions, faction assets, polities, market goods, and common story/record fields. Randomize All uses the live draft and handles dependent hit-point fields in a safe order. | Browser tests cover faction, asset, polity, market-good and campaign-story field controls. |
| Corporations | The corporation directory opened with an empty generator template. | Added `CorporationGenerator.template` and field generators for name, markets, ownership, strategy and valuation. | Browser test checks all five field randomisers, individual Revert, Randomize All and Revert All. |
| Other directories | Religion, political-group and alien editors did not all have complete field-level randomisers. | Added domain-specific templates and rerollers for supported fields. | Browser tests check religion (3 fields), political group (2 fields) and alien (9 fields), including all-field restoration. |
| Table cancellation | Closing a table editor without saving could still invoke its change callback and trigger unnecessary redraw/export work. | Table callbacks now run only after a confirmed save. | Browser tests cancel and save editor workflows without uncaught JS errors. |
| Export latency | Main thread prepared pretty and compact GM/player JSON, applied privacy redaction, and compressed both share links. This is a substantial synchronous workload on large imports. | Added a same-origin Web Worker that performs player redaction, JSON serialisation, Blob creation and share-link compression off the UI thread. Rapid saves coalesce to the latest request. Worker failure or a restricted context uses the synchronous compatibility path. Stale download links and share URLs are cleared while updated exports are pending. | `tests/export-worker.cjs` executes the exact worker script on a separate Node worker thread against Acheron Rho and compares the player export byte-for-byte (JSON string) with the app's `App.censorSector` implementation. |
| Map and campaign refresh | Some render-time lookups repeatedly scanned arrays, and campaign influence was recalculated twice in one render path. | Indexed region/system lookups and removed the duplicate influence recalculation. | Timed in Chromium using the Acheron Rho native fixture. |

## Validation results

| Command / test | Result |
|---|---|
| `node tests/import-validation.cjs` | **PASS** — 553 CSV records across the supplied CSV fixtures plus native JSON, import hierarchy, enrichment and parent-link validations. |
| `node tests/run-audit.cjs` | **PASS** — 2,000 core generations, 500 expanded-profile generations, 15 faction sectors × 12 turns; zero generation crashes, invalid links, malformed assets, or audit failures. |
| `node tests/export-worker.cjs` | **PASS** — real Node worker thread; GM export retains all 293 Acheron Rho source records; player output exactly matches `App.censorSector`; JSON Blobs and both compressed links verified. Latest extracted-archive run: 4.4 ms from dispatch to `postMessage` return, 347.7 ms total worker completion on this environment. |
| `E2E_INLINE=1 node tests/e2e.cjs` | **PASS** — all 19 grouped Chromium check areas; zero uncaught JavaScript errors. Added regression coverage for all listed editor types and typed revert behavior. |
| Syntax checks | **PASS** — changed application and test scripts pass `node --check`; full project scan is recorded in the packaged release report. |

### Observed render timings

On the Acheron Rho import (36 systems, 293 native source records) in the final Chromium inline run:

- Map redraw: median **3.3 ms**, maximum **8.1 ms**.
- Campaign panel rebuild: median **0.5 ms**, maximum **0.6 ms**.
- Export on the inline/offline path: about **243 ms** to schedule and about **941 ms** for the four-save batch, because the worker is unavailable in this context and the compatibility fallback intentionally runs on the page thread.

The separate Node worker-thread test is the evidence that the export task can be moved away from the page thread: the `postMessage` handoff returned in about **4.4 ms**, with the export completing on the worker thread about **348 ms** after the test began. These Node timings are not a substitute for a browser benchmark on the production HTTPS origin.

## Test-environment limitation and deployment note

A normal Chromium navigation test to both `127.0.0.1` and `localhost` was blocked by this environment's browser policy before the page loaded (`... is blocked — Your organization doesn't allow you to view this site`). Therefore the browser suite ran in the supported offline-inline mode, which verifies the synchronous fallback and the full app UI, but cannot instantiate the same-origin browser Web Worker. The worker's actual source was instead run on a separate Node worker thread and its output/privacy behavior verified against the app implementation.

When deployed on the normal same-origin HTTP(S) site, the app attempts to load `export-worker.js`. Local `file://` previews and browsers that disallow workers use the synchronous fallback and can still pause during large exports. A final smoke test on the deployed HTTPS origin should confirm the browser's worker loads successfully and that the download/share URLs update after a save.

## Remaining limits

- These tests do not prove the absence of every possible bug or guarantee equal performance across every browser, device and sector size.
- The exact browser Web Worker startup and completion path was not directly exercised in Chromium in this environment, for the policy reason above.
- The synchronous compatibility fallback remains intentionally functional, but it does not provide the same responsiveness benefit as the hosted worker path.

## Final verification addendum — 7 November 2026

A later release pass expanded verification beyond this report's original test scope. The complete Chromium E2E suite passed both with the synchronous fallback and with a browser Worker enabled (19 grouped areas; zero uncaught browser errors). The worker-enabled run also passed a 25-save burst/coalescing check and the full GM/player export round-trip. The E2E round-trip setup was corrected to await asynchronous export completion before reading the download links.

The campaign audit now accepts `SWN_FACTION_TURNS`. A 15-sector × 100-turn run passed 1,500 faction turns and produced 9,930 events, with zero turn crashes, invalid faction assets, invalid credits, or broken campaign references. See `FINAL_RELEASE_VERIFICATION_2026-11-07.md` for exact metrics and the remaining managed-Chromium-policy limitation: the normal same-origin Worker URL still requires a smoke test on the deployed HTTPS origin.
