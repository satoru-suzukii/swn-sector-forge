#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {Worker} = require('node:worker_threads');
const {performance} = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');

// Build a real normalized Sector Forge sector from the supplied SWN export.
const importContext = vm.createContext({console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp});
for (const file of ['swn-entity-enrichment.js', 'swn-import.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), importContext, {filename:file});
}
const source = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/acheron-rho-native-2026-10-30.json'), 'utf8'));
const sector = importContext.SwnImport.fromJSON(source, 'Acheron Rho worker test.json', 'preserve');
sector.gmNotes = 'WORKER_GM_NOTE_SENTINEL';
for (const key of ['tradeRoutes','polities','markets','regions','corporations','aliens','religions','politicalGroups']) if (!Array.isArray(sector[key])) sector[key] = [];

// Load the app's actual privacy method as the reference implementation.
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const privacyStart = appSource.indexOf('App.getHiddenSwnEntityIds = function');
const privacyEnd = appSource.indexOf('App.displayCorporationDirectory = function', privacyStart);
assert.ok(privacyStart >= 0 && privacyEnd > privacyStart, 'Could not locate the live app privacy implementation.');
const referenceContext = vm.createContext({
  App:{}, Set, JSON, Array, String, Boolean, Object,
  WorldGenerator:{describePlanet(planet) {
    const population=String(planet.population||'unknown population').toLowerCase();
    const tech=String(planet.techLevel||'?');
    const atmosphere=planet.atmosphere?String(planet.atmosphere).toLowerCase():'unrecorded atmosphere';
    const temperature=planet.temperature?String(planet.temperature).toLowerCase():'unrecorded climate';
    const biosphere=planet.biosphere?String(planet.biosphere).toLowerCase():'unknown biosphere';
    let description=(planet.name||'This world')+' is a '+population+' world at tech level '+tech+'. Its '+atmosphere+' atmosphere, '+temperature+' climate, and '+biosphere+' shape daily life.';
    if(planet.populationEstimate) description+=' The local population is estimated at '+String(planet.populationEstimate).replace(/\.$/,'')+'.';
    return description;
  }}
});
vm.runInContext(appSource.slice(privacyStart, privacyEnd), referenceContext, {filename:'app-privacy-reference.js'});
const expectedPlayer = referenceContext.App.censorSector(sector);

// Run the exact browser worker source on a separate Node worker thread. This
// exercises real off-thread structured-clone and payload processing, not a stub.
const workerBootstrap = `
  const {parentPort} = require('node:worker_threads');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = ${JSON.stringify(root)};
  global.self = {postMessage: value => parentPort.postMessage(value)};
  global.importScripts = file => require('node:vm').runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), {filename:file});
  require('node:vm').runInThisContext(fs.readFileSync(path.join(root, 'export-worker.js'), 'utf8'), {filename:'export-worker.js'});
  parentPort.on('message', data => global.self.onmessage({data}));
`;

(async function main() {
  const worker = new Worker(workerBootstrap, {eval:true});
  try {
    const start = performance.now();
    const resultPromise = new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    worker.postMessage({seq:42, sector, sectorName:sector.name});
    const dispatched = performance.now();
    const result = await resultPromise;
    const completed = performance.now();
    assert.equal(result.seq, 42);
    assert.ok(result.gmBlob instanceof Blob && result.playerBlob instanceof Blob, 'Worker should return ready-to-download JSON blobs.');
    const gm = JSON.parse(await result.gmBlob.text());
    const player = JSON.parse(await result.playerBlob.text());
    assert.equal(gm.gmNotes, 'WORKER_GM_NOTE_SENTINEL');
    assert.equal(gm.swnImport.records.length, 293, 'GM archive should retain all native source records.');
    assert.equal(player.swnImport, undefined, 'Player export should omit the referee source archive.');
    assert.equal(player.gmNotes, undefined, 'Player export should omit GM notes.');
    assert.equal(JSON.stringify(player), JSON.stringify(expectedPlayer), 'Worker player export must exactly match App.censorSector privacy behavior.');

    const lzContext = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(root, 'lzstring.min.js'), 'utf8'), lzContext);
    assert.equal(lzContext.LZString.decompressFromEncodedURIComponent(result.gmCompressed), JSON.stringify(gm));
    assert.equal(lzContext.LZString.decompressFromEncodedURIComponent(result.playerCompressed), JSON.stringify(player));
    assert.equal(gm.systems.length, 36);
    assert.equal(gm.systems.reduce((n, system) => n + (system.planets || []).length, 0), 46);
    console.log('PASS: real worker-thread export matches App.censorSector exactly for Acheron Rho; GM archive, player privacy, JSON blobs, and compressed links verified.');
    console.log('Worker timing: dispatch '+(dispatched-start).toFixed(1)+' ms; completion '+(completed-start).toFixed(1)+' ms; payload '+gm.swnImport.records.length+' source records / '+gm.systems.length+' systems.');
  } finally {
    await worker.terminate();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
