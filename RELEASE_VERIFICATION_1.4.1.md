# Sector Forge 1.4.1 — Release verification

**Release date:** 21 November 2026  
**Application identity:** `1.4.1`  
**Test environment:** Node.js v22.16.0, Chromium on Linux x86-64  
**Result:** All 20 non-browser release suites passed; 58/58 JavaScript/CommonJS files passed syntax validation. The full Chromium E2E suite was started and passed multiple major workflow checks, but did not complete within the available execution window. It is not counted as a pass.

## Release outcome

`App.VERSION`, the visible application header, fresh-sector source provenance, the browser identity regression, and the campaign benchmark now identify the application as `1.4.1`. The root saved-sector schema remains version 3. The simulation envelope and individual engines retain their independent schema/version identifiers.

This is a maintenance release. It does not change generator distributions, generator data tables, simulation rules, campaign data contracts, or the saved-sector schema. No migration is introduced.

## Fixes included

### Generator global-variable isolation

`GenUtil.generatePattern()` previously used `for (name in data)` without declaring `name`. In a browser script this wrote to the global scope and could overwrite `window.name`. The iterator is now function-local (`var name`), preserving the previous property iteration and replacement behavior without changing generated output logic.

### Asynchronous text-loader key isolation

`TextLoad.massLoad()` previously used an undeclared, shared `key` iterator. Since the file callbacks run asynchronously, multiple responses could write to the last iterated property. The loop now uses a block-scoped iterator so each callback retains the correct key. Regression coverage completes requests in reverse order and verifies that each response updates only its own entry.

### Reentrant load-completion callbacks

`TextLoad.onLoadEnd()` previously iterated the shared callback list and reset the request counter/list after invoking the callbacks. A completion callback that started another load and registered another `onAllLoad` callback could have the new request state erased by the earlier completion cycle. The completed callback batch is now detached and the counter reset before callbacks run. The test starts a new load cycle from inside a completion callback, checks that the follow-up callback remains queued, and verifies failed requests also release the completion queue.

### Documentation and release identity

- Expanded README usage guidance, including local hosting and GitHub Pages deployment.
- Documented native JSON preference, CSV limitations, enrichment modes, and the current importer parity boundary.
- Restored the distinction between complete GM backups and filtered player exports, including a clear instruction to inspect player-safe copies before sharing.
- Added the unofficial fan-project disclaimer and current scope limitations.
- Added `tests/runtime-hygiene.cjs` to the consolidated release runner.

## Automated test results

### Syntax and maintained non-browser suites

Command: `node tests/run-suite.cjs`

The runner began the 21-suite release sequence. The syntax sweep and all 20 non-browser suites completed successfully before the Chromium E2E stage.

| Check | Result |
|---|---:|
| JavaScript/CommonJS syntax | **58 / 58 passed** |
| Non-browser maintained suites | **20 / 20 passed** |
| Runtime hygiene regressions | **Passed** |
| Failed non-browser suites | **0** |
| Timed-out non-browser suites | **0** |

The 20 non-browser suites cover SWN CSV/native JSON imports, Node worker-thread export and player privacy, maintenance regressions, simulation migration, economy, logistics, living-sector integration, commerce, strategic transport, political coordination, market competition, integrated campaign behavior, campaign hardening, runtime hygiene, historical defect regressions, feature completion/recovery, political/logistics turn order, generation output regressions, randomized generation/economy stress, and the full campaign performance benchmark.

### Runtime-hygiene regression detail

`node tests/runtime-hygiene.cjs` passed. It verified:

- Generator pattern substitution does not overwrite an existing global `name` value.
- Two `TextLoad.massLoad()` requests completed out of order update their own keys.
- An unfinished request leaves its property unchanged.
- An `onAllLoad` callback can start a follow-up load and register a second completion callback without the first cycle clearing it.
- Failed requests return an empty array to their callback and still release the completion queue.
- The loader does not overwrite pre-existing global `key` or `callback` sentinel values.

### Import and generator/economy stress

The SWN import suite passed **553 CSV records** across its fixtures plus the native JSON fixture. Native coordinate normalization, nested parent resolution, route/layer conversion, source-faction retention, opt-in enrichment, and truncated CSV handling passed.

The bounded randomized audit passed with:

| Workload / invariant | Result |
|---|---:|
| Core sector generation | 100 runs; 0 crashes |
| Expanded generation | 50 runs; 0 crashes |
| Alien catalog | 1,000 samples; 0 invalid records |
| Faction simulation | 2 sectors × 6 turns; 0 crashes |
| Economy simulation | 2 sectors × 6 turns; 150 markets, 1,200 commodity accounts, 900 ledger entries |
| Generation/reference/structural failures | 0 |
| Cargo conservation / logistics validation failures | 0 / 0 |
| Financial / diplomacy / political / strategy / contract validation failures | 0 |
| Invalid inventories / unbalanced ledger lines / out-of-range prices | 0 / 0 / 0 |

The generation-output regression also passed 500 Core worlds, 500 Expanded worlds, and 2,000 alien catalog samples.

### Full campaign performance benchmark

The benchmark committed **14 turns** on a generated sector with **37 systems and 75 markets**.

| Measurement | Result |
|---|---:|
| Median turn | 1,967.66 ms |
| p95 / slowest turn | 2,281.42 ms |
| Test ceiling | 10,000 ms |
| Shipments | 1,135 |
| Delivered shipments | 500 |
| Shipment legs | 2,568 |
| Serialized sector size | 6,550,733 bytes |

All 14 turns completed below the 10-second per-turn ceiling.

### Chromium E2E — incomplete run

The full Chromium E2E test was started in inline/offline mode. The following checkpoints completed successfully before the execution window ended:

- 1.4.1 visible application identity and fresh-sector source version.
- Responsive World, Alien, and Corporation directories at narrow and wide viewports.
- Core/Expanded world-column semantics and alien catalog rendering/round-trip.
- Campaign initialization, political UI, recovery-integrity validation, and campaign-turn rendering.
- Market/Chronicle/history DOM bounds, directory creation/randomization, and imported-world edit preservation.
- The initial player-safe export check confirmed that the generated player copy omitted the simulation envelope.

The test did not reach its final summary. Therefore the entire Chromium suite is **not certified as passed** in this release run. No failing assertion was reported before the run was stopped; the remaining browser checks still need a complete run on a machine where the E2E suite can finish.

The inline/opaque-origin mode cannot establish browser-native IndexedDB transactions or same-origin Worker construction. The real `export-worker.js` was independently exercised on a real Node worker thread and passed. To verify browser-native APIs, serve the project over HTTP/HTTPS and run:

```bash
E2E_INLINE=0 node tests/e2e.cjs
```

## Compatibility and file-safety

- `App.VERSION` and newly generated sector provenance use `1.4.1`.
- Root sector schema remains version 3; no migration was introduced.
- Generator algorithms, generation distributions, source data tables, simulation engines, and persisted data formats are unchanged apart from version stamping.
- The 1.4 archive remains the historical reference; this release is built as a separate 1.4.1 working copy.
