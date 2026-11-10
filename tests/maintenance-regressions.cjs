#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const context = vm.createContext({
  console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp,
  Promise, Blob, URL, URLSearchParams,
  document: { getElementById() { return { textContent:'', innerHTML:'' }; } },
  window: {},
  TextLoad: {
    load(url, callback) {
      try { callback(fs.readFileSync(path.join(root, url), 'utf8').split(/[\n\r]+/)); }
      catch (_) { callback([]); }
    },
    onAllLoad(callback) { callback(); }
  }
});

const modules = [
  'generators/genutil.js', 'generators/namegen.js', 'generators/swnnamegen.js',
  'generators/buzzword_generator.js', 'generators/world-terrain-generator.js',
  'generators/star-system-generator.js', 'generators/world-generator.js',
  'generators/corporation-generator.js', 'generators/religion-generator.js',
  'generators/political-group-generator.js', 'generators/alien-generator.js',
  'generators/campaign-tools.js', 'app.js'
];
for (const file of modules) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
}
const run = expression => vm.runInContext(expression, context);
const CT = run('CampaignTools');
const App = run('App');

// 1. Route generation is stable and contains no random draws.
const topology = {
  systems: [
    {id:'SYS-A', name:'A', x:0, y:0, planets:[]},
    {id:'SYS-B', name:'B', x:1, y:0, planets:[]},
    {id:'SYS-C', name:'C', x:6, y:0, planets:[]}
  ],
  tradeRoutes: []
};
const savedRandom = context.Math.random;
context.Math.random = () => { throw new Error('Route recalculation must not consume randomness'); };
const firstRoutes = CT.generateTradeRoutes(topology);
topology.tradeRoutes = firstRoutes;
const secondRoutes = CT.generateTradeRoutes(topology);
context.Math.random = savedRandom;
assert.deepEqual(JSON.parse(JSON.stringify(firstRoutes)), JSON.parse(JSON.stringify(secondRoutes)), 'Repeated route recalculation should be byte-for-byte stable.');
assert.ok(firstRoutes.every(route => route.source === 'generated'), 'Newly calculated routes should carry generated provenance.');

// Explicit generated provenance must prevent a changed distance from making an
// ordinary generated edge look like a GM-authored override.
const movingTopology = {systems:[{id:'MOVE-A',x:0,y:0},{id:'MOVE-B',x:1,y:0}],tradeRoutes:[]};
movingTopology.tradeRoutes = CT.generateTradeRoutes(movingTopology);
assert.equal(movingTopology.tradeRoutes[0].kind, 'trade');
movingTopology.systems[1].x = 3;
const movedGeneratedRoute = CT.generateTradeRoutes(movingTopology).find(route => route.fromSystemId === 'MOVE-A' && route.toSystemId === 'MOVE-B');
assert.ok(movedGeneratedRoute, 'Generated route should remain in range after a valid relocation.');
assert.equal(movedGeneratedRoute.source, 'generated');
assert.equal(movedGeneratedRoute.kind, 'scout', 'Generated route type should update when the new distance changes its generated classification.');
assert.equal(movedGeneratedRoute.status, 'Surveyed', 'Generated route status should update when the new distance changes its generated classification.');

// A manually edited route retains its GM metadata even when system relocation
// makes it exceed the normal three-hex connection range.
const manualRoute = {
  id:'ROUTE-GM-01', fromSystemId:'SYS-A', toSystemId:'SYS-C', distance:6,
  kind:'trade', status:'MANUALLY-CLOSED', note:'KEEP THIS GM NOTE',
  source:'manual', manualOverride:true, capacity:77
};
topology.tradeRoutes = [manualRoute];
const withManual = CT.generateTradeRoutes(topology);
const retainedManual = withManual.find(route => route.id === 'ROUTE-GM-01');
assert.ok(retainedManual, 'A manual route outside normal range must not be deleted.');
assert.equal(retainedManual.status, 'MANUALLY-CLOSED');
assert.equal(retainedManual.note, 'KEEP THIS GM NOTE');
assert.equal(retainedManual.capacity, 77);
assert.equal(retainedManual.topologyStatus, 'Overextended');
assert.equal(CT.isTradeRouteOperational(retainedManual), false, 'Overextended/closed manual routes must not count as active trade access.');

// 2. Market updates are idempotent, react to real connectivity changes, and
// do not rewrite unrelated markets. The calculation remains deterministic.
function market(id, systemId) {
  return {id, systemId, planetId:'P-M-' + systemId, friction:0, goods:[{name:'Metals and alloys', basePrice:800, priceIndex:100, localPrice:800}]};
}
const economicSector = {
  factionTurn:0, factions:[], corporations:[], corporationMarketLinks:[], diplomacy:[], tradeRoutes:[],
  systems: topology.systems.map(system => Object.assign({}, system, {planets:[{id:'P-M-' + system.id, name:'World ' + system.id, techLevel:'TL3', population:'outpost'}], factionInfluence:[]})),
  markets:[market('M-A','SYS-A'), market('M-B','SYS-B'), market('M-C','SYS-C')]
};
CT.updateMarkets(economicSector, 0);
const isolatedSnapshot = economicSector.markets.map(m => m.goods[0].priceIndex);
CT.updateMarkets(economicSector, 0);
assert.deepEqual(economicSector.markets.map(m => m.goods[0].priceIndex), isolatedSnapshot, 'A no-op market update must not change prices.');

// Adding a real trade connection only affects the two endpoint markets.
economicSector.tradeRoutes = [{id:'ROUTE-A-B', fromSystemId:'SYS-A', toSystemId:'SYS-B', distance:1, kind:'trade', status:'Established', source:'generated'}];
CT.updateMarkets(economicSector, 0);
const connectedSnapshot = economicSector.markets.map(m => m.goods[0].priceIndex);
assert.ok(connectedSnapshot[0] < isolatedSnapshot[0] && connectedSnapshot[1] < isolatedSnapshot[1], 'New trade access should deterministically lower endpoint market price pressure.');
assert.equal(connectedSnapshot[2], isolatedSnapshot[2], 'An unrelated market must not react to a local route change.');
CT.updateMarkets(economicSector, 0);
assert.deepEqual(economicSector.markets.map(m => m.goods[0].priceIndex), connectedSnapshot, 'Repeated recalculation must not accumulate market drift.');

// Moving C next to B creates a new direct path; C's market responds while A
// remains unaffected by that particular connection change.
economicSector.systems.find(system => system.id === 'SYS-C').x = 2;
economicSector.tradeRoutes = CT.generateTradeRoutes(economicSector);
CT.updateMarkets(economicSector, 0);
const afterRelocation = economicSector.markets.map(m => m.goods[0].priceIndex);
assert.ok(afterRelocation[2] < connectedSnapshot[2], 'A market gaining a viable trade route should react to the new connection.');
assert.equal(afterRelocation[0], connectedSnapshot[0], 'A market outside the changed route neighborhood should remain stable.');

// Explicit GM price edits become the new reference value and survive subsequent
// structural recalculations instead of being reset to the old generated value.
const editedGood = economicSector.markets[0].goods[0];
const manuallySet = 173;
editedGood.priceIndex = manuallySet;
CT.updateMarkets(economicSector, 0);
assert.equal(editedGood.priceIndex, manuallySet, 'A manual price edit must survive a recalculation with unchanged structural conditions.');

// 2b. A direct Alliance is authoritative for faction hostility, and a turn
// archive preserves both generated events and referee-authored notes.
const allianceSector = {
  factionTurn:0,
  systems:[{id:'SYS-ALLY',name:'Allied System',x:0,y:0,planets:[]}],
  factions:[
    {id:'ALLY-A',name:'Alliance A',goal:'Protect trade',force:0,cunning:0,wealth:0,factionCredits:0,homeworldSystemId:'SYS-ALLY',assets:[{id:'ALLY-A-ASSET',name:'A militia',attackStat:'force',defenseStat:'force',attackDamage:'0',counterattackDamage:'0',hp:10,maxHp:10,active:true,locationSystemId:'SYS-ALLY'}]},
    {id:'ALLY-B',name:'Alliance B',goal:'Protect trade',force:0,cunning:0,wealth:0,factionCredits:0,homeworldSystemId:'SYS-ALLY',assets:[{id:'ALLY-B-ASSET',name:'B militia',attackStat:'force',defenseStat:'force',attackDamage:'0',counterattackDamage:'0',hp:10,maxHp:10,active:true,locationSystemId:'SYS-ALLY'}]}
  ],
  diplomacy:[{id:'DIP-ALLY',factionAId:'ALLY-A',factionBId:'ALLY-B',state:'Alliance',trust:6,tension:0}],
  tradeRoutes:[],markets:[],corporations:[],corporationMarketLinks:[]
};
assert.equal(CT.canFactionAttack(allianceSector,'ALLY-A','ALLY-B'), false, 'An Alliance should prohibit faction asset attacks in either direction.');
assert.equal(CT.canFactionAttack(allianceSector,'ALLY-B','ALLY-A'), false, 'Alliance protection should be bilateral.');
allianceSector.factions[0].rivals = ['ALLY-B'];
allianceSector.factions[1].rivals = ['ALLY-A'];
CT.syncDiplomacyRivals(allianceSector, allianceSector.diplomacy[0]);
assert.deepEqual(JSON.parse(JSON.stringify(allianceSector.factions.map(f => f.rivals))), [[],[]], 'Direct Alliance editing should clear stale rivalry links.');
allianceSector.diplomacy[0].state = 'Rivalry';
CT.syncDiplomacyRivals(allianceSector, allianceSector.diplomacy[0]);
assert.deepEqual(JSON.parse(JSON.stringify(allianceSector.factions.map(f => f.rivals))), [['ALLY-B'],['ALLY-A']], 'Direct Rivalry editing should synchronize faction rival lists.');
allianceSector.diplomacy[0].state = 'Alliance';
CT.syncDiplomacyRivals(allianceSector, allianceSector.diplomacy[0]);
const savedTurnRandom = context.Math.random;
context.Math.random = () => 0;
CT.advanceFactionTurn(allianceSector);
context.Math.random = savedTurnRandom;
assert.ok(!(allianceSector.factionNews || []).some(entry => entry.action === 'Attack'), 'Faction turn simulation selected an attack against an ally.');
assert.equal(allianceSector.factionTurnHistory.length, 1, 'Advancing a faction turn should create a persistent archive record.');
assert.equal(allianceSector.factionTurnHistory[0].turn, 1);
const archivedTurn = CT.recordFactionTurn(allianceSector, 1, allianceSector.factionNews);
archivedTurn.gmNotes = 'Keep the signed corridor agreement in force.';
CT.recordFactionTurn(allianceSector, 1, [{turn:1,action:'Updated event',event:'A refreshed snapshot'}]);
assert.equal(allianceSector.factionTurnHistory.length, 1, 'Re-archiving the same turn should update, not duplicate, its record.');
assert.equal(allianceSector.factionTurnHistory[0].gmNotes, 'Keep the signed corridor agreement in force.', 'Re-archiving should preserve referee notes.');
assert.equal(allianceSector.factionTurnHistory[0].events[0].action, 'Updated event', 'The archive should retain the latest event snapshot for that turn.');

// 3. Link synchronization must not overwrite the conflict-aware market stability.
economicSector.markets[0].stability = 'Disrupted';
CT.linkCampaignRecords(economicSector);
assert.equal(economicSector.markets[0].stability, 'Disrupted', 'Record linking must not overwrite economic stability.');

// A stale market may reference a system with no surviving planet. Linking must
// not throw or dereference a missing planet record.
const orphanMarketSector = {systems:[{id:'SYS-EMPTY',name:'Empty System',planets:[]}],markets:[{id:'MARKET-ORPHAN',systemId:'SYS-EMPTY',planetId:'REMOVED-WORLD',goods:[]}],corporations:[],factions:[],tradeRoutes:[]};
assert.doesNotThrow(() => CT.linkCampaignRecords(orphanMarketSector), 'Linking a market in a planetless system should remain safe.');
assert.equal(orphanMarketSector.markets[0].systemId, 'SYS-EMPTY');

// 4. Survey rerolls preserve imported and GM-authored objects, while replacing
// previously generated orbital extras.
const surveySystem = {
  id:'SYS-SURVEY', name:'Survey Test', planets:[{id:'SYS-SURVEY-W01', name:'Test World', techLevel:'TL3', population:'outpost'}],
  bodies:[
    {id:'CUSTOM-MINE', name:'Morrow Mine', type:'Mining platform', bodyClass:'N', isGeneratedWorld:false, source:'manual', manualOverride:true, description:'GM-authored'},
    {id:'IMPORTED-BASE', name:'Old Research Base', type:'Research base', bodyClass:'N', importedFromSWN:true, sourceEntityType:'researchBase'},
    {name:'Old Generated Wreck', type:'orbital wreckage', bodyClass:'N', isGeneratedWorld:false, source:'generated'}
  ]
};
const rerolledBodies = App.rerollSystemSurvey(surveySystem, {generationSettings:{worldDensity:'default'}});
assert.ok(rerolledBodies.some(body => body.id === 'CUSTOM-MINE' && body.description === 'GM-authored'), 'Reroll deleted a GM-authored survey object.');
assert.ok(rerolledBodies.some(body => body.id === 'IMPORTED-BASE'), 'Reroll deleted an imported SWN survey object.');
assert.ok(!rerolledBodies.some(body => body.name === 'Old Generated Wreck'), 'Reroll should replace generated orbital extras.');
assert.ok(rerolledBodies.some(body => body.bodyClass === 'S' || body.bodyClass === 'B'), 'Reroll should still generate a primary star or black hole.');
assert.ok(rerolledBodies.some(body => body.planetId === 'SYS-SURVEY-W01'), 'Reroll should keep linked world survey entries.');

// 5. World Directory edits update only their target world and linked market;
// imported source descriptions are left intact.
const described = [];
const originalDescribe = context.WorldGenerator.describePlanet;
context.WorldGenerator.describePlanet = planet => { described.push(planet.id); return 'Regenerated description for ' + planet.name; };
const editedWorld = {id:'WORLD-1', name:'Directory World', techLevel:'TL5', population:'several million inhabitants'};
const worldSystem = {id:'SYS-WORLD', name:'World System', x:3, y:3, planets:[editedWorld], bodies:[]};
const worldSector = {
  factionTurn:0, systems:[worldSystem], factions:[], corporations:[], corporationMarketLinks:[], diplomacy:[], tradeRoutes:[],
  markets:[{id:'MARKET-WORLD', systemId:'SYS-WORLD', planetId:'WORLD-1', techLevel:'TL2', population:'outpost', friction:0, goods:[{name:'Machine parts', basePrice:1100, priceIndex:100, localPrice:1100}]}]
};
const update = App.applyWorldDirectoryEdit(worldSector, {system:worldSystem, planet:editedWorld});
assert.ok(update && update.planet === editedWorld);
assert.deepEqual(described, ['WORLD-1'], 'Only the edited world description should be regenerated.');
assert.equal(worldSector.markets[0].techLevel, 'TL5', 'Linked market tech level did not synchronize with edited world.');
assert.equal(worldSector.markets[0].population, 'several million inhabitants', 'Linked market population did not synchronize with edited world.');

const importedWorld = {id:'WORLD-IMPORTED', name:'Imported Meridian', techLevel:'TL4', population:'outpost', sourceEntityType:'planet', description:'Original SWN description'};
worldSystem.planets.push(importedWorld);
worldSector.markets.push({id:'MARKET-IMPORTED', systemId:'SYS-WORLD', planetId:'WORLD-IMPORTED', techLevel:'TL2', population:'outpost', friction:0, goods:[]});
App.applyWorldDirectoryEdit(worldSector, {system:worldSystem, planet:importedWorld});
assert.equal(importedWorld.description, 'Original SWN description', 'World Directory edit overwrote an imported description.');
assert.equal(worldSector.markets.find(item => item.id === 'MARKET-IMPORTED').techLevel, 'TL4', 'Imported world linked market did not synchronize.');
context.WorldGenerator.describePlanet = originalDescribe;

// 6. Existing route recalculation must not regenerate political blocs.
const stablePolities = [{id:'POLITY-GM', name:'GM-authored polity', memberSystemIds:['SYS-A']}];
const politySector = {systems:[{id:'SYS-A',x:0,y:0},{id:'SYS-B',x:1,y:0}], tradeRoutes:[], polities:stablePolities};
politySector.tradeRoutes = CT.generateTradeRoutes(politySector);
assert.equal(politySector.polities, stablePolities, 'Route recalculation should not create or replace political blocs.');

console.log('PASS: 1.2 maintenance regressions — deterministic routes, preserved manual routes, causal/idempotent market updates, route status consistency, safe survey rerolls, world/market synchronization, imported description protection, alliance-safe diplomacy, persistent faction turn history, and polity preservation.');
