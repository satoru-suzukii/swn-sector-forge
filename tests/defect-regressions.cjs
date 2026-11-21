#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Shared simulation context. This intentionally has no local-economy engine,
// so the faction-turn regression is exercised through the no-economy path.
const engineContext = vm.createContext({
  console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp,
  CampaignTools: {
    generateFactions() { return [{id:'FACTION-NEW',name:'New Roster'}]; },
    advanceFactionTurn(sector) {
      sector.factionTurn = Number(sector.factionTurn || 0) + 1;
      sector.factionTurnHistory = Array.isArray(sector.factionTurnHistory) ? sector.factionTurnHistory : [];
      sector.factionTurnHistory.push({id:'FACTION-TURN-' + String(sector.factionTurn).padStart(4,'0'),turn:sector.factionTurn,events:[],gmNotes:''});
      return [];
    }
  }
});
vm.runInContext(read('simulation/trade-route-rules.js'), engineContext, {filename:'simulation/trade-route-rules.js'});
vm.runInContext(read('simulation/sector-simulation.js'), engineContext, {filename:'simulation/sector-simulation.js'});
vm.runInContext(read('simulation/trade-contract-engine.js'), engineContext, {filename:'simulation/trade-contract-engine.js'});
vm.runInContext(read('simulation/logistics-engine.js'), engineContext, {filename:'simulation/logistics-engine.js'});
const Sim = vm.runInContext('SectorSimulation', engineContext);
const Contracts = vm.runInContext('SectorTradeContracts', engineContext);
const Logistics = vm.runInContext('SectorLogistics', engineContext);

// 1. Rerolling factions must not rewind the legacy turn or desynchronize the
// coordinator journal on sectors that do not use the local economy.
const appSource = read('app.js');
const rerollStart = appSource.indexOf('App.rerollFactions = function');
const rerollEnd = appSource.indexOf('\n};', rerollStart) + 3;
assert.ok(rerollStart >= 0 && rerollEnd > rerollStart, 'Could not locate App.rerollFactions.');
engineContext.App = {};
vm.runInContext(appSource.slice(rerollStart, rerollEnd), engineContext, {filename:'app-reroll-factions.js'});
const noEconomy = {
  name:'No Economy Reroll Regression', schemaVersion:3, gmMode:true, factionTurn:0,
  grid:{columns:10,rows:12}, systems:[
    {id:'SYS-A',name:'Aster',x:0,y:0,planets:[]},
    {id:'SYS-B',name:'Boreal',x:0,y:0,planets:[]}
  ], factions:[{id:'FACTION-OLD',name:'Old Roster'}], markets:[], tradeRoutes:[], factionNews:[]
};
Sim.migrateSector(noEconomy, {sourceApplicationVersion:'1.3.9'});
for (let turn=0; turn<3; turn++) assert.equal(Sim.advanceCampaignTurn(noEconomy).ok, true);
assert.equal(noEconomy.factionTurn, 3);
const turnIdBeforeReroll = noEconomy.simulation.turnCoordinator.lastCommittedTurnId;
vm.runInContext('App.rerollFactions', engineContext)(noEconomy);
assert.equal(noEconomy.factionTurn, 3, 'Faction reroll must preserve the existing campaign turn.');
assert.equal(noEconomy.simulation.clock.turn, 3, 'Simulation clock must remain aligned after faction reroll.');
assert.equal(noEconomy.simulation.turnCoordinator.lastCommittedTurn, 3);
assert.equal(noEconomy.simulation.turnCoordinator.lastCommittedTurnId, turnIdBeforeReroll);
assert.deepEqual(Array.from(noEconomy.factions, faction => faction.id), ['FACTION-NEW']);
assert.deepEqual(JSON.parse(JSON.stringify(noEconomy.factionNews)), []);
assert.equal(Sim.validateTurnCoordinator(noEconomy).ok, true);
assert.equal(Sim.advanceCampaignTurn(noEconomy).ok, true, 'The next turn after reroll must commit successfully.');
assert.equal(noEconomy.factionTurn, 4);

// 3. The turn journal now follows the configured retention policy rather than
// silently truncating to a hard-coded 50 entries.
Sim.setHistoryRetentionPolicy(noEconomy, {turnJournal:100});
for (let turn=4; turn<60; turn++) assert.equal(Sim.advanceCampaignTurn(noEconomy).ok, true, 'Turn ' + (turn + 1) + ' should commit.');
assert.equal(noEconomy.simulation.turnCoordinator.journal.length, 60, 'A 100-entry retention setting must retain all 60 committed turns.');
assert.equal(noEconomy.simulation.turnCoordinator.journalArchive && noEconomy.simulation.turnCoordinator.journalArchive.archivedCount || 0, 0, 'No journal entries should be archived below the configured limit.');
assert.equal(Sim.validateTurnCoordinator(noEconomy).ok, true);

// Duplicate coordinates are review warnings, not transaction-blocking errors.
const coordinateValidation = Sim.validateSector(noEconomy);
assert.equal(coordinateValidation.ok, true, 'Duplicate coordinates must not fail structural validation.');
assert.ok(coordinateValidation.warnings.some(message => message.includes('Duplicate system coordinate')));
assert.equal(Sim.advanceCampaignTurn(noEconomy).ok, true, 'A duplicate coordinate warning must not block turn advancement.');

// 4. App.censorSector must tolerate optional campaign arrays being absent.
const privacyStart = appSource.indexOf('App.getHiddenSwnEntityIds = function');
const privacyEnd = appSource.indexOf('App.displayCorporationDirectory = function', privacyStart);
assert.ok(privacyStart >= 0 && privacyEnd > privacyStart, 'Could not locate App player-export privacy implementation.');
const privacyContext = vm.createContext({
  App:{}, Set, JSON, Array, String, Boolean, Object, Number,
  SectorGrid:{DEFAULT_COLUMNS:10,DEFAULT_ROWS:12},
  WorldGenerator:{describePlanet(){ return 'A player-safe world summary.'; }}
});
vm.runInContext(appSource.slice(privacyStart, privacyEnd), privacyContext, {filename:'app-privacy-regression.js'});
const PrivacyApp = privacyContext.App;
const sparseExport = {name:'Sparse export',systems:[],tradeRoutes:[],markets:[]};
assert.deepEqual(JSON.parse(JSON.stringify(PrivacyApp.censorSector(sparseExport).corporations)), []);
assert.deepEqual(JSON.parse(JSON.stringify(PrivacyApp.censorSector(sparseExport).aliens)), []);
assert.deepEqual(JSON.parse(JSON.stringify(PrivacyApp.censorSector(sparseExport).religions)), []);
assert.deepEqual(JSON.parse(JSON.stringify(PrivacyApp.censorSector(sparseExport).politicalGroups)), []);
assert.deepEqual(JSON.parse(JSON.stringify(PrivacyApp.censorObjects(undefined, []))), []);

// 5. A custom ID in the automatic TC- sequence must advance the next sequence.
const contractSector = {
  markets:[
    {id:'MARKET-A',systemId:'SYS-A',planetName:'Aster'},
    {id:'MARKET-B',systemId:'SYS-B',planetName:'Boreal'}
  ],
  simulation:{economy:{initialized:true,clock:{lastAdvancedTurn:0},marketStates:[
    {marketId:'MARKET-A',inventory:[{commodityId:'food'}]},
    {marketId:'MARKET-B',inventory:[{commodityId:'food'}]}
  ],contracts:{records:[],ledger:[],clock:{}}}}
};
Contracts.initialize(contractSector);
const customContract = Contracts.create(contractSector, {
  id:'TC-00001',name:'Custom sequence contract',originMarketId:'MARKET-A',destinationMarketId:'MARKET-B',
  commodityId:'food',quantityPerTurn:1,startTurn:1,status:'paused'
}, 0);
assert.equal(customContract.ok, true);
const automaticContract = Contracts.create(contractSector, {
  name:'Automatic sequence contract',originMarketId:'MARKET-A',destinationMarketId:'MARKET-B',
  commodityId:'food',quantityPerTurn:1,startTurn:1,status:'active'
}, 0);
assert.equal(automaticContract.ok, true, automaticContract.reason);
assert.equal(automaticContract.contract.id, 'TC-00002', 'The automatic contract ID must advance past existing custom TC IDs.');

// 6. Sector loading must update export links without queuing an automatic
// recovery snapshot. Actual edits retain the normal snapshot behavior.
const persistStart = appSource.indexOf('App.persistSector = function');
const persistEnd = appSource.indexOf('\n};', persistStart) + 3;
assert.ok(persistStart >= 0 && persistEnd > persistStart, 'Could not locate App.persistSector.');
let snapshotCalls = 0, exportCalls = 0;
const persistContext = vm.createContext({App:{
  scheduleLocalRecoverySnapshot(){ snapshotCalls++; },
  createDownloadLink(){ exportCalls++; return Promise.resolve(true); }
}});
vm.runInContext(appSource.slice(persistStart, persistEnd), persistContext, {filename:'app-persist-sector.js'});
(async function verifyPersistenceBoundary() {
  const loadedSector = {name:'Loaded shared sector'};
  await persistContext.App.persistSector(loadedSector, {skipRecoverySnapshot:true});
  assert.equal(snapshotCalls, 0, 'Loading a sector must not overwrite the automatic recovery snapshot.');
  assert.equal(exportCalls, 1, 'Loading a sector must still refresh its export links.');
  await persistContext.App.persistSector(loadedSector);
  assert.equal(snapshotCalls, 1, 'Normal persistence after an edit must still schedule automatic recovery.');
  assert.equal(exportCalls, 2);
  assert.ok(/App\.persistSector\(sector, \{skipRecoverySnapshot:true\}\)/.test(appSource), 'displaySector must use the no-snapshot load path.');

  // 7a. Arrival processing updates the canonical nested clock and does not
  // create the stray top-level logistics.capacityUsageTurn property.
  const logisticsSector = {tradeRoutes:[],systems:[],markets:[],simulation:{economy:{initialized:true,clock:{lastAdvancedTurn:0},logistics:{
    shipments:[],ledger:[],capacityUsage:{},clock:{arrivalsProcessedTurn:0,dispatchProcessedTurn:0,capacityUsageTurn:0}
  }}}};
  const arrivals = Logistics.processArrivals(logisticsSector, 1);
  assert.equal(arrivals.ok, true);
  assert.equal(logisticsSector.simulation.economy.logistics.clock.capacityUsageTurn, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(logisticsSector.simulation.economy.logistics, 'capacityUsageTurn'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(logisticsSector.simulation.economy.logistics.capacityUsage)), {});

  console.log('PASS: focused regressions — faction reroll clock continuity, configurable turn-journal retention, player-export privacy, sparse-array censoring, contract ID sequencing, load-safe local recovery, logistics clock path, and non-blocking duplicate-coordinate warnings.');
})().catch(error => { console.error(error); process.exitCode = 1; });
