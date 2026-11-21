# Sector Forge 1.4 — Release verification

**Release date:** 21 November 2026  
**Application identity:** `1.4`  
**Test environment:** Node.js v22.16.0, Chromium on Linux x86-64  
**Result:** All 20 maintained release suites passed; 57/57 JavaScript/CommonJS files passed syntax validation.

## Release outcome

The application identity is now `1.4` in `App.VERSION` and the visible header. Freshly generated sectors receive `sourceApplicationVersion: "1.4"` using the existing migration path. The root sector schema remains version 3. The simulation envelope and individual simulation engines keep their own schema/version identifiers; they have deliberately not been relabeled as application version 1.4. No saved-sector schema migration was introduced.

## Fixes included

### Local recovery integrity

The previous checksum policy recognized only version strings in the `1.3.9+` series. It therefore failed to require an integrity checksum on snapshots stamped by the new `1.4` application. The validator now parses numeric version components and compares them against the `1.3.9` threshold. It requires a checksum for 1.3.9 and later (including old four-component versions such as 1.3.12.4, 1.4, and future major versions), validates the checksum when supplied, and continues to accept checksumless pre-1.3.9 legacy snapshots. Malformed labels are not partially parsed.

The browser regression checks valid checksums, tampering, malformed records, missing checksums at the threshold and current versions, four-component and multi-digit patch versions, future major versions, malformed version strings, and legacy compatibility.

### Expanded World population editor

The deterministic browser regression now verifies both valid result classes: a failed colony yielding a Remnant with an unknown exact population (`populationNumber: null`), and a counted population with a numeric population. It checks dependent metadata and verifies that Revert restores the original population, estimate, population class, and related values. The test obtains fresh controls after Revert rebuilds the editor rather than reusing detached DOM nodes.

### Test-runner reliability

- Every maintained suite runs in an isolated Node process with a deadline. A timed-out child process group is terminated before the runner proceeds.
- Chromium DevTools commands have individual deadlines that produce actionable diagnostics. Browser cleanup terminates the spawned Chromium process group, closes the test server, and removes the temporary profile.
- The release runner provides one command for syntax checks, focused regressions, bounded randomized audits, the campaign performance benchmark, and Chromium E2E.

### Small code cleanup

- Fixed the name generator's loop variable so it is block-scoped and does not leak into the global scope.
- Updated stale architecture documentation and documentation links after version-neutral test/document names were introduced.

## Automated test results

### Consolidated runner

Command: `node tests/run-suite.cjs`

| Check | Result |
|---|---:|
| Maintained suites | **20 / 20 passed** |
| JavaScript/CommonJS syntax | **57 / 57 passed** |
| Failed suites | **0** |
| Timed-out suites | **0** |

The 20 suites cover SWN CSV/native JSON import validation, a real Node worker-thread export, maintenance regressions, simulation migration/foundation, economy, logistics, living-sector integration, commerce, strategic transport, political coordination, market competition, integrated campaign behaviour, hardening, defect regressions, feature completion/recovery, political turn ordering, generation regressions, randomized generation/economy audit, campaign performance, and Chromium E2E.

### Bounded generation and economy stress

| Workload or invariant | Result |
|---|---:|
| Core generation runs | 100; 0 crashes |
| Expanded generation runs | 50; 0 crashes |
| Alien catalog samples | 1,000; 0 invalid records |
| Faction simulation | 2 sectors × 6 turns; 0 crashes |
| Economy simulation | 2 sectors × 6 turns; 142 markets, 1,136 commodity accounts, 852 ledger entries |
| Cargo conservation / logistics validation failures | 0 / 0 |
| Financial balance / validation failures | 0 / 0 |
| Diplomacy / strategy / contract validation failures | 0 / 0 / 0 |
| Invalid inventories / unbalanced ledger lines / out-of-range prices | 0 / 0 / 0 |

The 12 economy-turn timing samples ranged from **366.98 ms** to **1,133.64 ms**, with a **680.12 ms median** on this host. Structural checks found no duplicate coordinates, missing IDs, missing world bodies/terrain/descriptions, invalid population values, dangling routes, or broken cross-directory references in the bounded samples.

### Full campaign performance benchmark

The full benchmark committed 14 turns on a generated sector containing 38 systems and 86 markets.

| Measurement | Result |
|---|---:|
| Median turn | 2,001.29 ms |
| p95 / slowest turn | 2,341.11 ms |
| Test ceiling | 10,000 ms |
| Shipments dispatched | 1,162 |
| Delivered shipments | 500 |
| Shipment legs | 3,083 |
| Serialized sector size | 7,138,890 bytes |

All 14 turns completed below the benchmark's 10-second per-turn ceiling.

### Chromium E2E

The complete inline Chromium E2E suite passed with **zero uncaught browser JavaScript errors**. It exercised responsive directory layouts at 320, 390, 768, 1,024 and 1,440 CSS-pixel widths; generation and map editing; all-field randomization and Revert; imported-sector directory creation; SWN CSV and JSON import; a 293-record Acheron Rho import (36 systems, 46 planets and 210 survey objects); GM/player export privacy; GM JSON and compressed-link round-trips; recovery integrity; and accessibility names for 179 visible controls.

A four-turn campaign UI test retained bounded market, faction-history and Chronicle DOM. Its slowest measured render-and-turn cycle in the final run was **519.2 ms**. No browser command timed out, and the suite completed normally.

**Environment-specific skips (not counted as passes):**

1. Native IndexedDB transaction integration was skipped because the managed `about:blank`/opaque-origin Chromium context denies access to IndexedDB. The UI and recovery validation logic were tested; the true browser transaction needs a normal same-origin browser context.
2. Browser-native Worker construction was skipped because the inline `about:blank` origin cannot construct the app's same-origin Worker. The common Worker queue/handlers were exercised with the test adapter, and the actual `export-worker.js` was independently exercised by the passing Node worker-thread suite.

To exercise those browser-native APIs on a normal same-origin deployment, serve the folder over HTTP/HTTPS and run `E2E_INLINE=0 node tests/e2e.cjs`.

## Cleanup and file-safety record

The original 1.3.12.4 archive was kept unchanged. Cleanup was performed in a separate working copy and preserved all application runtime source, generator/simulation modules, imported data tables still referenced by the application, test fixtures, unique regression coverage, project licensing/attribution, and durable architecture/source-audit documentation.

Removed from the release tree:

- 34 generated validation, stress, E2E, and Node-test JSON/log outputs. These are machine-generated snapshots, not application inputs or test fixtures.
- 13 dated `FINAL_RELEASE_VERIFICATION` snapshots and 3 other one-off dated verification/fix reports. The current consolidated 1.4 results are recorded here instead; historical development milestones remain in `CHANGELOG.md`.
- Two superseded, substantially overlapping performance test copies. The latest benchmark logic is retained as `tests/performance.cjs`.
- One unused surname table that was byte-for-byte identical to the active `swnLastNames.txt` data.

Renamed without dropping coverage:

- 12 version-suffixed regression scripts now use stable names such as `tests/living-sector.cjs`, `tests/commerce.cjs`, `tests/hardening.cjs`, and `tests/generation-regressions.cjs`. Their unique assertions are retained.
- The architecture and data-model documents now have stable names: `SIMULATION_ARCHITECTURE.md` and `SIMULATION_DATA_MODEL.md`.

Added `tests/run-suite.cjs` and `.gitignore`. The suite runner and E2E harness are included in the release. All remaining 57 JavaScript/CommonJS files passed syntax checks, all 20 test suites passed, local Markdown links were checked, and the maintained import fixtures were exercised.

**No application source module, live generator data table, native/CSV test fixture, unique regression suite, license, or third-party notice was removed as junk.**

## Known verification boundary

The final managed-environment release run verifies the application logic and UI flows but cannot certify browser-native IndexedDB and Worker construction on a deployed same-origin HTTPS origin. Those two specific checks are explicitly identified above so the release record does not imply coverage that the environment could not provide.
