# Sector Forge — Stars Without Number Sector Generator

**Sector Forge 1.0** is a browser-based sector generator and campaign workbench for **Stars Without Number: Revised Edition**. Create a region of space, populate it with systems and worlds, edit the map, build factions and corporations, model trade and influence, and generate adventure material for your table.

Sector Forge is designed for referees who want a sector that is more than a map: its worlds, markets, political groups, factions, routes, and campaign hooks are connected so that the setting can develop as play progresses.

> **Unofficial fan project:** Sector Forge is a fan-made tool for use with *Stars Without Number*. It is not affiliated with, sponsored by, or endorsed by Sine Nomine Publishing. *Stars Without Number* and its related marks belong to their respective rights holder. See the [official Stars Without Number page](https://sine-nomine-publishing.myshopify.com/products/stars-without-number-revised) for the game itself.

## Contents

- [Highlights](#highlights)
- [Features](#features)
- [Getting started](#getting-started)
- [Using Sector Forge](#using-sector-forge)
- [Saving, sharing, and player-safe exports](#saving-sharing-and-player-safe-exports)
- [Project structure](#project-structure)
- [Running the tests](#running-the-tests)
- [Scope and limitations](#scope-and-limitations)
- [SWN import compatibility status](#swn-import-compatibility-status)
- [License and attribution](#license-and-attribution)
- [Feedback](#feedback)

## Highlights

- **Runs in a browser.** No account, application server, framework, package install, or build step is required to use the app.
- **Import Sectors Without Number exports.** Load native JSON exports or entity CSV files; choose whether to preserve missing details as blank or let Sector Forge fill supported missing facility occupation/situation fields. Imported survey objects show their occupation, situation, descriptions, and parent; empty source records are identified rather than silently fabricated. Original source records are retained in the GM archive, supported route paths are drawn on the map, and supported layer regions are converted.
- **Generate a 10 × 12 sector.** The standard system-density setting generates 21–30 occupied hexes by default, with optional presets for emptier or busier regions.
- **Edit the map and systems.** Create a system in an empty hex, move systems through explicit controls, and add or edit planets, orbital objects, and points of interest. Existing imported planet values outside Forge's dropdown vocabulary are preserved when another field is edited.
- **Connect your campaign data.** Worlds, system surveys, markets, corporate relationships, routes, and faction influence use linked records.
- **Manage and simulate factions.** Create and edit custom Forge campaign factions, assign their home system and base of influence, manage diplomacy, and advance faction turns to resolve income, upkeep, asset operations, repairs, attacks, purchases, and expansion.
- **Build usable campaign material.** Generate adventure seeds, political groups, religions, aliens, threats, NPC concepts, and other frontier-focused prompts.
- **Export and resume.** Save a sector as JSON or create a compressed URL that opens the sector again.
- **Includes automated checks.** Generator audits and Chromium-based end-to-end tests are included in `tests/`.
- **Branded favicon.** Includes an SVG master icon plus PNG, ICO, and Apple touch icon fallbacks, all linked with relative paths for GitHub Pages project sites.

## Features

### Sector and world generation

- Generates star systems across a 120-hex sector map.
- Offers **Revised Edition core** and **Expanded World Generation** profiles.
- Creates world records with tags, terrain, descriptions, population-related details, and linked system survey entries. Generated gravity is population-aware: standard gravity is the norm, while unusual gravity is reserved for sparsely populated worlds.
- Generates stellar survey objects, planets, points of interest, and additional orbital installations.
- Supports system-density and world/orbital-content-density controls independently.
- Keeps advanced options collapsed by default, so the standard one-click generation flow retains its default behavior.

### Advanced density controls

Open **Advanced generation options** to choose how busy the sector and its systems should be.

| System density | Approximate occupied systems |
| --- | ---: |
| Default | 21–30 |
| Empty | 0 |
| Scarce | 8–14 |
| Normal | 31–40 |
| Crowded | 45–65 |

The separate **World & orbital content** setting controls how many planets, surface sites, and non-world survey objects are generated inside systems. Its presets are **Default**, **Empty**, **Scarce**, **Normal**, and **Crowded**. The exact content varies with generation; the settings change the overall density rather than promising an identical count on every run.

### Interactive sector map

- Displays the sector as a crisp SVG hex map with 120 selectable hexes.
- Starts with **Edit mode OFF**, keeping editing controls hidden until they are deliberately enabled.
- Lets you select a system, choose **Move selected system**, and then choose an empty destination hex.
- Allows a system to be created in an empty hex while edit mode is enabled.
- Supports editing system names, planets, orbital survey objects, and points of interest. Imported SWN dropdown values that Forge does not recognize are retained rather than cleared on save.
- Displays imported black-hole systems with a distinct black-hole primary, map marker, inspector label, and accessible name.
- Provides an independent **Faction domination** display toggle for faction-colored systems, control rings, and contested-system highlighting.
- Recalculates related route, influence, market, and campaign references after supported edits.

The map intentionally uses a fixed viewport rather than drag-to-pan or wheel zoom. Select-and-act controls are used for moving systems to avoid accidental map movement and to keep page scrolling predictable on touch devices.

#### Importing a Sectors Without Number sector

From the launch screen, choose an import mode and select the source JSON export or an entity CSV export from **Sectors Without Number**.

- **Import as-is · leave missing details blank** is the default. It does not generate missing facility occupations, situations, or imported-world gravity. Existing source records remain available in the **Source Data** workspace and in the GM JSON archive.
- **Import and generate missing details** explicitly opts into filling blank occupation/situation fields for supported SWN facility types (research bases, moon bases, stations, mines, asteroid bases/belts, and orbital ruins). It also generates gravity for imported worlds that do not have a gravity value. Existing imported fields are never overwritten. Generated details are marked as Forge-filled, and the raw source JSON remains unchanged. Some SWN entities, such as moons, intentionally have no occupation/situation table and remain without invented details.
- **Native JSON is preferred.** The importer normalizes SWN's one-based entity x/y coordinates to Forge's zero-based grid coordinates. Route and layer hex keys are already zero-based and are handled separately. Physical source entities such as moons, bases, stations and ruins are also listed in the system survey when supported.
- **CSV is a best-effort fallback.** CSV entity exports do not provide the same stable ID and relationship data as JSON, so parent links may need to be inferred from names and locations. If a parent cannot be resolved confidently, the original record is preserved in Source Data instead of being discarded.
- **Source-specific data is retained.** Supported navigation route paths are drawn over the map, supported layer regions are mapped into Forge's region model, and source factions are listed for reference. The complete source JSON payload remains in the GM archive. Source faction data is not silently converted into Forge's different faction-turn model.

See [SWN import compatibility status](FEATURE_PARITY.md) for the specific coverage and limitations. The native JSON path is regression-tested against the supplied Acheron Rho export from October 30, 2026, as well as synthetic edge cases.

## Campaign workspaces

| Workspace | What it helps you do |
| --- | --- |
| **Sector Map** | Browse, select, and edit the sector's star systems. |
| **Worlds** | Review the generated world directory and world records. |
| **Corporations** | Create and manage corporate actors and their campaign relationships. |
| **Political Groups** | Develop movements, coalitions, and other political organizations. |
| **Religions** | Generate faiths and ideological forces that shape worlds. |
| **Aliens** | Create non-human life, societies, and first-contact complications. |
| **Factions** | Create/edit custom Forge factions and track goals, assets, upkeep, readiness, diplomacy, and turn-by-turn activity. Native SWN source factions remain separately preserved reference records. |
| **Trade & Routes** | Explore trade and scout links, political blocs, territorial influence, and local commodity markets. |
| **Adventure Lab** | Turn world tags into adventure seeds with patrons, opposition, complications, stakes, and rewards. |
| **Frontier Lab** | Generate original prompts for espionage, trade, military operations, navies, cyberpunk, weird phenomena, outposts, ruins, relics, and related themes. |
| **Threats & People** | Generate game-useful threat scaffolds and NPC or patron concepts. |
| **Export & Share** | Download sector JSON or create a compressed share URL. |

### Markets, routes, and factions

Sector Forge links markets to worlds and systems and links corporate contracts to the relevant market records. Route access, corporate presence, territorial control, conflict pressure, and campaign state influence the generated local market picture.

Faction turns use a **streamlined, original simulation model**. They can advance faction income and upkeep, operate or repair assets, purchase assets, attack, expand influence, and produce campaign events. The simulator is intended to give referees evolving pressures and story opportunities—not to reproduce every official faction rule, asset, or special ability in full.

## Getting started

### Option 1: Run locally

1. Download or clone this repository.
2. Open a terminal in the folder containing `index.html`.
3. Start a simple local web server:

   **Python 3 (macOS, Linux, or Windows with `python`):**

   ```bash
   python -m http.server 8000
   ```

   On some systems, use `python3` instead:

   ```bash
   python3 -m http.server 8000
   ```

4. Open [http://localhost:8000](http://localhost:8000) in your browser.

Serve the folder over HTTP rather than opening `index.html` directly as a `file://` URL. Sector Forge loads local text data files, and browsers may block those requests when the HTML file is opened directly.

### Option 2: Publish with GitHub Pages

Sector Forge is a static web app, so it can be hosted using GitHub Pages without a backend.

1. Put `index.html`, `planet.css`, the JavaScript files, the `generators/` folder, and `README.md` in the repository root.
2. Push the files to your GitHub repository.
3. Open **Settings → Pages** in the repository.
4. Choose **Deploy from a branch**, select the branch you publish from (commonly `main`), and select the repository root (`/`) as the folder.
5. Save the settings and open the Pages URL GitHub provides.

Keep the relative file structure intact when uploading. The HTML references scripts, stylesheets, and generator data using relative paths.

## Using Sector Forge

A typical workflow looks like this:

1. **Generate a sector** using the default or expanded world-generation profile, or import a Sectors Without Number export using the import workflow above.
2. **Adjust the density** if you are generating a new sector and want an unusually quiet, sparse, normal, or crowded region.
3. **Explore the map** and open systems to inspect their surveys and linked worlds.
4. **Enable Edit mode** only when you're ready to create or modify map content.
5. **Build campaign actors** such as factions, corporations, faiths, and political groups.
6. **Review trade and influence**, then advance faction turns to introduce movement and consequences.
7. **Generate adventure material** based on the places and forces in your sector.
8. **Export a JSON backup** before a session or major round of edits.

You can use the campaign tools selectively. Sector Forge is intended to be a flexible workbench, not a mandatory sequence of steps.

## Saving, sharing, and player-safe exports

Sector Forge does not send your sector to a Sector Forge server. The active sector is held by the browser application, and a generated share URL encodes the sector data into the URL. URLs can become long for heavily developed sectors; use JSON export as your reliable backup and transfer format.

The **Export & Share** screen provides two export paths:

- **GM JSON / GM link:** includes referee-facing information and hidden details.
- **Player JSON / player link:** removes selected secret fields, rebuilds some descriptions to hide tag names, retains visible imported SWN survey entities, and excludes hidden entities plus their descendants.

**Review player-safe exports before sharing them.** Imported SWN `isHidden` flags are applied to systems, planets, facilities, and nested descendants, but the player export is still a practical filtering tool rather than a formal security boundary. Keep the GM export private, and share only the player version you have checked.

To resume a sector later, load its exported JSON file or open its share URL. Keep a separate backup if the sector matters to an ongoing campaign.

## Project structure

```text
.
├── index.html                         # App entry point and workspace markup
├── planet.css                         # Application styling and responsive layout
├── app.js                             # Sector state, UI logic, and campaign integration
├── hexmap.js                          # SVG hex map and map editing behavior
├── sector-grid.js                     # Shared grid dimensions, coordinate checks and viewport sizing
├── swn-import.js                      # Sectors Without Number JSON/CSV import adapter
├── url-param.js                       # URL parameter support
├── lzstring.min.js                    # URL-safe compression for sector links
├── dynmodal.js                        # Modal dialog behavior
├── dynedit.js                         # Editing helpers
├── dyntable.js                        # Table helpers
├── dyntab.js                          # Tab navigation helpers
├── dynspoiler.js                      # Spoiler/collapse helpers
├── textload.js                        # Local text-data loading
├── favicon.svg                        # Scalable Sector Forge icon
├── favicon-16x16.png                  # Small browser-tab icon
├── favicon-32x32.png                  # Standard PNG favicon
├── favicon.ico                        # Legacy browser favicon fallback
├── favicon-192x192.png                # High-resolution icon
├── favicon-512x512.png                # High-resolution icon master
├── apple-touch-icon.png               # iOS home-screen icon
├── generators/
│   ├── world-generator.js             # World generation
│   ├── star-system-generator.js       # Star system generation
│   ├── world-terrain-generator.js     # Terrain generation
│   ├── campaign-tools.js              # Campaign toolkits and prompts
│   └── data/                          # Text tables and naming data
├── FEATURE_PARITY.md                  # SWN importer coverage and known gaps
├── export-worker.js                  # Off-thread JSON export, redaction, and link compression
├── tests/
│   ├── run-audit.cjs                  # Generator and data-integrity audit
│   ├── e2e.cjs                        # Chromium browser end-to-end suite
│   ├── export-worker.cjs              # Worker-thread export/privacy regression
│   ├── import-validation.cjs          # CSV/native JSON import checks
│   ├── fixtures/                      # The three supplied SWN CSV regression exports
│   ├── *-validation-report.json        # Recorded validation reports
│   └── release-validation-report.json  # This packaged 1.0 release check
├── CHANGELOG.md                       # Development history
└── README.md                          # This file
```



The favicon files live beside `index.html`. They are linked with relative paths (for example, `./favicon.svg`) so they continue to resolve when GitHub Pages serves the repository under a project path such as `/repository-name/`. The SVG is the primary icon; PNG, ICO, and Apple touch icon files provide compatibility fallbacks.

## Running the tests

The app itself requires no package installation. The automated checks use Node.js; the browser suite also requires Chrome or Chromium.

### Generator and campaign audit

From the repository root, run:

```bash
node tests/run-audit.cjs
```

The default audit exercises core and expanded generation, black-hole primary consistency, data relationships, routes, markets, faction turns, and campaign-tool output. Run `node tests/import-validation.cjs` to validate all three supplied CSV exports and the native JSON fixture. Run `node tests/export-worker.cjs` to execute the export worker on a separate Node worker thread and verify that its player-safe JSON matches the app's privacy filter exactly. To increase the workload, use environment variables such as:

```bash
SWN_CORE_RUNS=10000 SWN_EXPANDED_RUNS=3000 SWN_FACTION_SECTORS=60 node tests/run-audit.cjs
```

### Browser end-to-end tests

The end-to-end suite uses Chrome DevTools Protocol and Node's built-in `WebSocket`. It requires **Node.js 22 or newer** and a Chrome/Chromium executable.

```bash
node tests/e2e.cjs
```

If Chrome/Chromium is not on your `PATH`, set `CHROME_BIN` to the executable path. For example, in a POSIX shell:

```bash
CHROME_BIN=/path/to/chromium node tests/e2e.cjs
```

An offline-inline mode is also available for environments where the test browser cannot navigate to a localhost server:

```bash
E2E_INLINE=1 node tests/e2e.cjs
```

The export worker is loaded dynamically from `export-worker.js` when Sector Forge is served from a same-origin HTTP(S) site. Browsers that disallow workers (for example, some local `file://` previews) use the synchronous compatibility fallback. The JSON reports document validation runs performed during development. [`tests/release-validation-report.json`](tests/release-validation-report.json) records the checks run for this updated snapshot, including grid and import coverage, a generator/faction audit, JavaScript syntax checks, local-reference checks, and the Chromium end-to-end suite. Run the commands above against the commit you intend to publish if you need to refresh the result for a later revision. The earlier 7 November import/faction/black-hole fixes are summarized in [`FIXES_2026-11-07_TEST_REPORT.md`](FIXES_2026-11-07_TEST_REPORT.md). The follow-up editor-control and export-performance work is documented in [`EDITOR_PERFORMANCE_FIX_REPORT_2026-11-07.md`](EDITOR_PERFORMANCE_FIX_REPORT_2026-11-07.md).

## Scope and limitations

Sector Forge is a **campaign-generation and referee-support tool**, not an official rules engine or a complete digital edition of *Stars Without Number*.

- The **Revised Edition core** profile implements the core generation concepts used by the app, but this project does not claim exhaustive, line-by-line parity with the entire core book or every supplement.
- **Expanded World Generation** adds optional population estimates and related generation behavior; it is a profile for generating campaign material, not a guarantee of exact outcomes for every table or edge case in the rules.
- Market prices and trade behavior are original campaign estimates, not a direct transcription of *Suns of Gold* procedures.
- Faction simulation uses a streamlined generic asset catalog and does not implement every official asset, ability, or edge case.
- Frontier toolkits create original prompts inspired by common campaign themes. Character outputs are concept dossiers, not full, rules-legal character sheets.
- Generated results are prompts for play. Referees should review, adjust, and adjudicate them for their campaign.

## SWN import compatibility status

Sector Forge is being expanded to work with Sectors Without Number exports, but the current importer is **not yet complete feature parity** with the upstream application. The implementation and known gaps are tracked in [FEATURE_PARITY.md](FEATURE_PARITY.md).

At this stage, Sector Forge supports a 10 × 12 default grid, native JSON and entity CSV import, normalized coordinate mapping, system/world conversion, preservation of original source records, explicit preserve/enrich modes, drawing of supported native navigation routes, conversion of supported layer regions, and a source-data view of exported faction records. Imported black-hole systems retain their distinct primary type, and imported planet edits preserve unrecognized source values. Forge campaign factions can be created and edited separately from the source SWN faction records. Some upstream entity types remain source records instead of becoming fully editable Forge objects. Navigation routes remain separate from Forge trade routes, and imported SWN factions remain reference data instead of being silently run through Forge's different faction simulator.

## License and attribution

The optional import-enrichment feature adapts English facility occupation/situation entries from [Sectors Without Number](https://github.com/mpigsley/sectors-without-number) by Mitchel Pigsley, used under its MIT license. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The upstream source data is used only to fill blank values in the explicit enrichment mode; imported values are preserved.

Sector Forge is distributed under the MIT License; see [`LICENSE`](LICENSE).

Thanks to [Hamhambone's SWN Sector Generator](https://hamhambone.github.io/swn/) for inspiration and reference during development. Sector Forge is a separate implementation and is not affiliated with or endorsed by Hamhambone.

*Stars Without Number* is a role-playing game published by Sine Nomine Publishing. Sector Forge is an unofficial fan-made project and does not claim ownership of the game, its setting, or any third-party material. This README is not a statement that the project is endorsed by the game's publisher. See the [official product page](https://sine-nomine-publishing.myshopify.com/products/stars-without-number-revised).

## Feedback

Found a bug, a broken link, or a generation result that looks wrong? Open an issue in this repository and include steps to reproduce the problem. For data-related problems, include a small example sector JSON file after removing private campaign notes or other sensitive information.

### Choosing the right Sector Forge export

Use **GM JSON** as the complete editable backup and for continuing a Sector Forge campaign. It retains campaign factions, GM notes, custom points of interest, custom orbital survey objects, and attached original SWN source data. The compressed GM URL uses the same complete sector data.

Use **Player JSON** only as a censored sharing copy. It intentionally omits GM-only source data and notes, point-of-interest records, custom non-imported orbital survey objects, and campaign faction data. It is not a full-fidelity backup and should not be used when you need to preserve every editable campaign detail.
