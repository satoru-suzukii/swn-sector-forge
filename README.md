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
- [License and attribution](#license-and-attribution)
- [Feedback](#feedback)

## Highlights

- **Runs in a browser.** No account, application server, framework, package install, or build step is required to use the app.
- **Generate an 8 × 10 sector.** The standard system-density setting generates 21–30 occupied hexes by default, with optional presets for emptier or busier regions.
- **Edit the map and systems.** Create a system in an empty hex, move systems through explicit controls, and add or edit planets, orbital objects, and points of interest.
- **Connect your campaign data.** Worlds, system surveys, markets, corporate relationships, routes, and faction influence use linked records.
- **Simulate faction activity.** Advance faction turns to resolve events such as income, upkeep, asset operations, repairs, attacks, purchases, and expansion.
- **Build usable campaign material.** Generate adventure seeds, political groups, religions, aliens, threats, NPC concepts, and other frontier-focused prompts.
- **Export and resume.** Save a sector as JSON or create a compressed URL that opens the sector again.
- **Includes automated checks.** Generator audits and Chromium-based end-to-end tests are included in `tests/`.
- **Branded favicon.** Includes an SVG master icon plus PNG, ICO, and Apple touch icon fallbacks, all linked with relative paths for GitHub Pages project sites.

## Features

### Sector and world generation

- Generates star systems across an 80-hex sector map.
- Offers **Revised Edition core** and **Expanded World Generation** profiles.
- Creates world records with tags, terrain, descriptions, population-related details, and linked system survey entries.
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

- Displays the sector as a crisp SVG hex map with 80 selectable hexes.
- Starts with **Edit mode OFF**, keeping editing controls hidden until they are deliberately enabled.
- Lets you select a system, choose **Move selected system**, and then choose an empty destination hex.
- Allows a system to be created in an empty hex while edit mode is enabled.
- Supports editing system names, planets, orbital survey objects, and points of interest.
- Provides an independent **Faction domination** display toggle for faction-colored systems, control rings, and contested-system highlighting.
- Recalculates related route, influence, market, and campaign references after supported edits.

The map intentionally uses a fixed viewport rather than drag-to-pan or wheel zoom. Select-and-act controls are used for moving systems to avoid accidental map movement and to keep page scrolling predictable on touch devices.

### Campaign workspaces

| Workspace | What it helps you do |
| --- | --- |
| **Sector Map** | Browse, select, and edit the sector's star systems. |
| **Worlds** | Review the generated world directory and world records. |
| **Corporations** | Create and manage corporate actors and their campaign relationships. |
| **Political Groups** | Develop movements, coalitions, and other political organizations. |
| **Religions** | Generate faiths and ideological forces that shape worlds. |
| **Aliens** | Create non-human life, societies, and first-contact complications. |
| **Factions** | Track faction goals, assets, upkeep, readiness, diplomacy, and turn-by-turn activity. |
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

1. **Generate a sector** using the default or expanded world-generation profile.
2. **Adjust the density** if you want an unusually quiet, sparse, normal, or crowded region.
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
- **Player JSON / player link:** removes selected secret fields and rebuilds some descriptions to hide tag names.

**Review player-safe exports before sharing them.** The player export is a practical filtering tool, not a formal security boundary; do not rely on it to protect information that must remain secret. Keep the GM export private, and share only the player version you have checked.

To resume a sector later, load its exported JSON file or open its share URL. Keep a separate backup if the sector matters to an ongoing campaign.

## Project structure

```text
.
├── index.html                         # App entry point and workspace markup
├── planet.css                         # Application styling and responsive layout
├── app.js                             # Sector state, UI logic, and campaign integration
├── hexmap.js                          # SVG hex map and map editing behavior
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
├── tests/
│   ├── run-audit.cjs                  # Generator and data-integrity audit
│   ├── e2e.cjs                        # Chromium browser end-to-end suite
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

The default audit exercises core and expanded generation, data relationships, routes, markets, faction turns, and campaign-tool output. To increase the workload, use environment variables such as:

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

The JSON reports document validation runs performed during development. The current packaged files are covered by [`tests/release-validation-report.json`](tests/release-validation-report.json), including favicon/file-reference checks, a high-volume generator/faction audit, syntax checks, and repeated Chromium end-to-end runs. Run the commands above against the commit you intend to publish if you need to refresh the result for a later revision.

## Scope and limitations

Sector Forge is a **campaign-generation and referee-support tool**, not an official rules engine or a complete digital edition of *Stars Without Number*.

- The **Revised Edition core** profile implements the core generation concepts used by the app, but this project does not claim exhaustive, line-by-line parity with the entire core book or every supplement.
- **Expanded World Generation** adds optional population estimates and related generation behavior; it is a profile for generating campaign material, not a guarantee of exact outcomes for every table or edge case in the rules.
- Market prices and trade behavior are original campaign estimates, not a direct transcription of *Suns of Gold* procedures.
- Faction simulation uses a streamlined generic asset catalog and does not implement every official asset, ability, or edge case.
- Frontier toolkits create original prompts inspired by common campaign themes. Character outputs are concept dossiers, not full, rules-legal character sheets.
- Generated results are prompts for play. Referees should review, adjust, and adjudicate them for their campaign.

## License and attribution

**No `LICENSE` file is currently included with this project.** Before inviting reuse or contributions, choose and add a license that reflects how you want the original Sector Forge code and original material to be used. Until a license is provided, visitors should not assume the repository grants permission to reuse, modify, or redistribute its contents.

*Stars Without Number* is a role-playing game published by Sine Nomine Publishing. Sector Forge is an unofficial fan-made project and does not claim ownership of the game, its setting, or any third-party material. This README is not a statement that the project is endorsed by the game's publisher. See the [official product page](https://sine-nomine-publishing.myshopify.com/products/stars-without-number-revised).

## Feedback

Found a bug, a broken link, or a generation result that looks wrong? Open an issue in this repository and include steps to reproduce the problem. For data-related problems, include a small example sector JSON file after removing private campaign notes or other sensitive information.
