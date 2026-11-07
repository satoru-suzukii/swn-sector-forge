# Sector Forge Save / Export / Import Round-trip Verification

Date: 2026-11-07
Build: `sector-forge-fixed-2026-11-07.zip` plus this verification-only test addition.

## Scope

This verification specifically tests Sector Forge's own save formats, not only Sectors Without Number imports. It uses the Acheron Rho native SWN JSON fixture, imports it into Sector Forge, makes edits and adds custom campaign content, exports Sector Forge JSON, reloads that archive through the app's sector loader, and exports it again.

## GM archive round-trip: PASS

The test deliberately changed an imported planet's name, Tech Level, atmosphere and description, added a custom campaign note, added a point of interest, added an orbital survey object, added a custom faction, and added a GM note.

The GM JSON export retained all those changes and the original 293-record SWN source archive. Reloading the exported GM JSON into Sector Forge and exporting it again retained the edited world, custom note, point of interest, orbital object, faction, GM note and all 293 source records.

## Compressed GM URL round-trip: PASS

`App.compressSector` followed by `App.decompressSector` retained the edited planet, custom point of interest, custom faction and all 293 source records.

## Player-safe archive: PASS, with intentional omissions

The player export retained the edited public planet name, Tech Level and atmosphere. It excluded the original SWN source archive and GM notes, and the privacy regression found no hidden sentinel data.

Important: the current Player export is a censored sharing format, **not a full-fidelity backup**. It intentionally omits all point-of-interest records, all non-imported custom orbital survey objects, and campaign factions. A user who wants to back up or continue editing a complete Sector Forge campaign must use the **GM JSON export** (or the compressed GM URL), not the Player JSON export. These omissions are current product behavior and are not a failure of the GM archive round-trip.

## Other verification run against this build

- CSV/native SWN import validation: 553 CSV records plus native JSON fixtures passed.
- Acheron Rho import: 293 source records, 36 systems, 46 planets, 210 survey objects; all five previously problematic asteroid-base parent links resolved.
- Generator/faction audit: 2,000 core generations, 500 expanded generations, 15 faction sectors × 12 turns; no reported integrity failures.
- Chromium offline browser suite: all 19 grouped checks passed, including the new round-trip regression; zero uncaught browser JavaScript errors.

## Limitations

This verifies the archive data paths and app-level reload/re-export behavior in Chromium. It does not prove compatibility with every third-party tool or every browser/device. It also does not treat the Player export as a complete editable backup; use the GM archive for that purpose.
