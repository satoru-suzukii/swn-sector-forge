#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp});
vm.runInContext(fs.readFileSync(path.join(root, 'swn-entity-enrichment.js'), 'utf8'), context, {filename:'swn-entity-enrichment.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'swn-import.js'), 'utf8'), context, {filename:'swn-import.js'});
const SwnImport = context.SwnImport;
const fixtures = [
  path.join(root, 'tests', 'fixtures', 'lorre-dundrea-nu.csv'),
  path.join(root, 'tests', 'fixtures', 'psavrosth-eta.csv'),
  path.join(root, 'tests', 'fixtures', 'acheron-rho.csv')
];
let totalRows = 0;
for (const filename of fixtures) {
  const csv = fs.readFileSync(filename, 'utf8');
  const sector = SwnImport.fromCSV(csv, path.basename(filename), 'preserve');
  const rows = SwnImport.parseCSV(csv);
  const expectedPlanets = rows.filter(row => row['Entity Type'] === 'Planet').length;
  assert.equal(sector.swnImport.records.length, rows.length, path.basename(filename) + ': every source row should survive');
  assert.equal(sector.swnImport.sourceData.length, rows.length, path.basename(filename) + ': raw CSV rows should be retained');
  assert.ok(sector.systems.length > 0, path.basename(filename) + ': expected mapped systems');
  assert.equal(sector.grid.columns, 10, path.basename(filename) + ': expected 10 columns');
  assert.equal(sector.grid.rows, 12, path.basename(filename) + ': expected 12 rows');
  assert.equal(sector.systems.reduce((n, sys) => n + sys.planets.length, 0), expectedPlanets, path.basename(filename) + ': expected every planet to map to its system');
  const expectedSurveyObjects = rows.length - sector.systems.length - expectedPlanets;
  const mappedSurveyObjects = sector.systems.reduce((n, sys) => n + (sys.bodies || []).filter(body => body.importedFromSWN).length, 0);
  assert.equal(mappedSurveyObjects, expectedSurveyObjects, path.basename(filename) + ': expected all physical non-planet SWN entities to appear in the system survey');
  assert.ok(sector.systems.every(sys => sys.x >= 0 && sys.x < 10 && sys.y >= 0 && sys.y < 12), path.basename(filename) + ': systems must stay in sector bounds');
  assert.equal(sector.importMetadata.mode, 'preserve');
  assert.equal(sector.importMetadata.warnings.length, 0, path.basename(filename) + ': sample fixture should import without warnings');
  totalRows += rows.length;
  console.log('PASS CSV:', path.basename(filename), rows.length, 'records,', sector.systems.length, 'systems,', expectedPlanets, 'worlds,', mappedSurveyObjects, 'additional survey objects');
}
const native = {
  sector: {sec1:{id:'sec1',type:'sector',name:'Native JSON Test',attributes:{}}},
  system: {sys1:{id:'sys1',type:'system',name:'Helios',x:10,y:12,parent:'sec1',parentEntity:'sector',attributes:{occupation:'',situation:''}}},
  planet: {pl1:{id:'pl1',type:'planet',name:'Meridian',parent:'sys1',parentEntity:'system',attributes:{description:'Keep this',tags:[{name:'Pretech Archive'}],population:'Several million',techLevel:'TL4'}}},
  researchBase: {base1:{id:'base1',type:'researchBase',name:'Quiet Observatory',parent:'pl1',parentEntity:'planet',attributes:{occupation:'Researchers',situation:'Power failure'}}},
  routes: {route1:{id:'route1',name:'Old jump corridor',route:['0000','0303','0911'],color:'#ffaa44',width:'thick',type:'dashed'}}, layers: {layer1:{id:'layer1',name:'GM Notes',isHidden:false,regions:{reg1:{name:'Amber Reach',color:'#ffaa44'},reg2:{name:'Secret Zone',color:'#ff2244',isHidden:true}},hexes:{'0000':{regions:['reg1','reg2']},'0303':{regions:['reg1']}}}}, factions: {faction1:{id:'faction1',name:'Quiet Bloc',force:4,cunning:6,wealth:3,goal:{name:'Keep the peace'},assets:{a1:{type:'Base of Influence'}}}}
};
assert.ok(SwnImport.isNativeExport(native), 'native JSON export should be recognized');
const jsonSector = SwnImport.fromJSON(native, 'Native JSON Test.json', 'preserve');
assert.equal(jsonSector.grid.columns, 10);
assert.equal(jsonSector.grid.rows, 12);
assert.equal(jsonSector.systems.length, 1);
assert.equal(jsonSector.systems[0].x, 9, 'native SWN one-based x must be normalized to zero-based Forge x');
assert.equal(jsonSector.systems[0].y, 11, 'native SWN one-based y must be normalized to zero-based Forge y');
assert.equal(jsonSector.systems[0].planets.length, 1);
assert.equal(jsonSector.systems[0].planets[0].tag1, 'Pretech Archive');
assert.equal(jsonSector.systems[0].bodies.filter(body => body.importedFromSWN).length, 1, 'supported physical child entity should appear in the system survey');
assert.equal(jsonSector.swnImport.records.length, 4, 'native entity records should all be catalogued');
assert.deepEqual(jsonSector.swnImport.sourceData.routes, native.routes, 'non-entity route payload should be preserved');
assert.deepEqual(jsonSector.swnImport.sourceData.layers, native.layers, 'layer payload should be preserved');
assert.deepEqual(jsonSector.swnImport.sourceData.factions, native.factions, 'faction payload should be preserved');
assert.equal(jsonSector.swnImport.navigationRoutes.length, 1, 'native navigation routes should be normalized');
assert.equal(JSON.stringify(jsonSector.swnImport.navigationRoutes[0].hexes[2]), JSON.stringify({x:9,y:11}), 'native route hex keys should use zero-based map coordinates');
assert.equal(jsonSector.regions.length, 2, 'supported layer regions should be converted into Forge map regions');
assert.equal(jsonSector.regions.find(region => region.name.includes('Secret Zone')).sourceHidden, true, 'hidden source regions should retain their hidden flag for player-safe filtering');
assert.equal(JSON.stringify(jsonSector.regions[0].hexes), JSON.stringify([{x:0,y:0},{x:3,y:3}]), 'layer hex memberships should be mapped');
assert.equal(jsonSector.swnImport.factions[0].name, 'Quiet Bloc', 'source faction should be summarized for the source data view');
assert.equal(jsonSector.importMetadata.mode, 'preserve');
console.log('PASS JSON: native 1-based coordinates normalized, hierarchy translated, routes and layer regions mapped, source factions retained');

// Use the actual Acheron Rho export supplied by the project owner as a permanent
// compatibility fixture, not merely a hand-built object shaped like the export.
const acheronFile = path.join(root, 'tests', 'fixtures', 'acheron-rho-native-2026-10-30.json');
const acheronData = JSON.parse(fs.readFileSync(acheronFile, 'utf8'));
const acheron = SwnImport.fromJSON(acheronData, path.basename(acheronFile), 'preserve');
const allSurveyBodies = acheron.systems.flatMap(system => system.bodies || []).filter(body => body.importedFromSWN);
const researchSource = acheron.swnImport.records.filter(record => record.type === 'researchBase');
const researchBodies = allSurveyBodies.filter(body => body.sourceEntityType === 'researchBase');
assert.equal(acheron.swnImport.records.length, 293, 'Acheron Rho actual export should preserve 293 source records');
assert.equal(acheron.systems.length, 36, 'Acheron Rho actual export should map 36 top-level systems/black holes');
assert.equal(acheron.systems.reduce((n, system) => n + system.planets.length, 0), 46, 'Acheron Rho actual export should map 46 planets');
assert.equal(allSurveyBodies.length, 210, 'Acheron Rho actual export should map 210 additional survey entities');
assert.equal(researchSource.length, 42, 'Acheron Rho actual export should contain 42 research bases');
assert.equal(researchBodies.length, 42, 'Every Acheron Rho research base should be represented in the survey');
const facilityTypes = new Set(['asteroidBase','asteroidBelt','deepSpaceStation','gasGiantMine','moonBase','orbitalRuin','refuelingStation','researchBase','spaceStation']);
const facilities = allSurveyBodies.filter(body => facilityTypes.has(body.sourceEntityType));
assert.equal(facilities.length, 173, 'All 173 supported facility entities should be mapped from the actual Acheron Rho file');
assert.ok(facilities.every(body => body.occupation && body.situation && body.sourceParentName), 'Every supported facility should expose occupation, situation, and parent details');
assert.ok(researchBodies.every(body => body.occupation && body.situation), 'Research base occupation and situation must be surfaced on imported survey bodies');
for (const source of researchSource) {
  const body = researchBodies.find(candidate => candidate.sourceEntityId === source.id);
  assert.ok(body, 'Research base missing from system survey: ' + source.name);
  assert.equal(body.occupation, source.attributes.occupation, 'Research base occupation should match source: ' + source.name);
  assert.equal(body.situation, source.attributes.situation, 'Research base situation should match source: ' + source.name);
  assert.ok(body.sourceParentName, 'Imported station should have a readable parent name: ' + source.name);
}
const importedMoons = allSurveyBodies.filter(body => body.sourceEntityType === 'moon');
assert.equal(importedMoons.length, 37, 'All 37 imported moons should remain visible as survey objects');
assert.ok(importedMoons.every(body => !body.occupation && !body.situation), 'As-is import must not invent moon attributes absent from the source export');
assert.equal(acheron.importMetadata.warnings.length, 0, 'Acheron Rho actual export should import without warnings');
// Regression: these five bases were previously attached to Almu Gerbia because
// their parent asteroid belts occur later in the SWN JSON group order.
const expectedAsteroidBaseSystems = {
  'Tarma 1':'Amedere Orbere',
  'Bremerhaven':'Amedere Orbere',
  'Schiaparelli 5':'Meneus',
  'Tomari 3':'Pamita Cha',
  'Crewe 6':'Phalest'
};
for (const [baseName, expectedSystem] of Object.entries(expectedAsteroidBaseSystems)) {
  const mapped = acheron.systems.flatMap(system => (system.bodies || []).map(body => ({body, system:system.name})))
    .find(entry => entry.body.name === baseName);
  assert.ok(mapped, 'Acheron Rho asteroid base should be mapped: ' + baseName);
  assert.equal(mapped.system, expectedSystem, 'Asteroid base must follow its belt parent to the correct system: ' + baseName);
}
console.log('PASS Acheron Rho parent-graph regression: all five previously misplaced asteroid bases now resolve to their actual parent systems.');

// Regression: entity groups may be ordered child-before-parent and child objects
// may have no coordinates. Missing coordinates must not be coerced to (0,0).
const reordered = {
  sector:{sec:{id:'sec',name:'Order-independent test'}},
  asteroidBase:{base:{id:'base',name:'Parented Base',parent:'belt',parentEntity:'asteroidBelt',attributes:{occupation:'Miners',situation:'Stable'}}},
  researchBase:{orphan:{id:'orphan',name:'Unlinked Base',parent:'missing-parent',parentEntity:'system',attributes:{occupation:'Unknown',situation:'Unknown'}}},
  asteroidBelt:{belt:{id:'belt',name:'Parent Belt',parent:'sys',parentEntity:'system',attributes:{}}},
  system:{sys:{id:'sys',name:'Origin System',x:1,y:1,parent:'sec',parentEntity:'sector',attributes:{}}}
};
const reorderedSector = SwnImport.fromJSON(reordered, 'Reordered entities.json', 'preserve');
const parentedBase = reorderedSector.systems[0].bodies.find(body => body.sourceEntityId === 'base');
assert.ok(parentedBase, 'Child entity must resolve through a parent record defined later in the JSON.');
assert.equal(reorderedSector.systems[0].name, 'Origin System');
assert.ok(!reorderedSector.systems[0].bodies.some(body => body.sourceEntityId === 'orphan'), 'An entity with no resolvable parent and no coordinates must not be attached to (0,0).');
assert.ok(reorderedSector.importMetadata.warnings.some(warning => warning.includes('Unlinked Base')), 'Unresolved survey entities should be reported as import warnings.');
console.log('PASS parent graph: out-of-order nested entities resolve; missing coordinates do not fall back to hex 0,0.');

// Enrichment fills only absent facility fields and does not mutate the preserved raw source payload.
const incomplete = {
  sector:{s:{id:'s',name:'Test Sector'}},
  system:{sys:{id:'sys',name:'Test',x:1,y:1,parent:'s',parentEntity:'sector',attributes:{}}},
  researchBase:{r:{id:'r',name:'Test Research Base',parent:'sys',parentEntity:'system',attributes:{situation:'Original situation'}}},
  moon:{m:{id:'m',name:'Unadorned Moon',parent:'sys',parentEntity:'system',attributes:{}}}
};
const enriched = SwnImport.fromJSON(incomplete, 'Enriched Fixture.json', 'enrich');
const enrichedBase = enriched.systems[0].bodies.find(body => body.sourceEntityId === 'r');
const enrichedMoon = enriched.systems[0].bodies.find(body => body.sourceEntityId === 'm');
assert.ok(enrichedBase.occupation, 'Enrichment should fill the missing research-base occupation');
assert.equal(enrichedBase.situation, 'Original situation', 'Enrichment must not overwrite imported situation');
assert.deepEqual(enrichedBase.generatedFields, ['occupation'], 'Enrichment should mark only the generated field');
assert.equal(enriched.swnImport.sourceData.researchBase.r.attributes.occupation, undefined, 'Raw source payload must remain unchanged');
assert.ok(!enrichedMoon.occupation && !enrichedMoon.situation, 'SWN moon entities have no occupation/situation generator and should stay blank');
const preserveIncomplete = SwnImport.fromJSON(incomplete, 'Preserve Fixture.json', 'preserve');
assert.ok(!preserveIncomplete.systems[0].bodies.find(body => body.sourceEntityId === 'r').occupation, 'Preserve mode must leave missing source details blank');
console.log('PASS enrichment: fills only missing supported station details, marks Forge-generated fields, and leaves raw import unchanged');
console.log('PASS import validation total:', totalRows, 'CSV records plus native JSON fixtures');
