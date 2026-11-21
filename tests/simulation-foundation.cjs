#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp});
vm.runInContext(fs.readFileSync(path.join(root, 'simulation/trade-route-rules.js'), 'utf8'), context, {filename:'simulation/trade-route-rules.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'simulation/sector-simulation.js'), 'utf8'), context, {filename:'simulation/sector-simulation.js'});
const Sim = vm.runInContext('SectorSimulation', context);

// A realistic 1.2-shaped payload with campaign arrays, GM notes, imports,
// unknown custom fields, and pre-existing faction history.
const sector = {
  name:'Acheron Rho', schemaVersion:3, gmMode:true, factionTurn:7,
  customSectorField:{preserveMe:true},
  systems:[
    {id:'SYS-A', name:'A', x:0, y:0, planets:[{id:'WORLD-A', name:'A-1'}]},
    {id:'SYS-B', name:'B', x:1, y:0, planets:[{id:'WORLD-B', name:'B-1'}]},
    {id:'SYS-C', name:'C', x:2, y:0, planets:[{id:'WORLD-C', name:'C-1'}]},
    {id:'SYS-D', name:'D', x:3, y:0, planets:[{id:'WORLD-D', name:'D-1'}]}
  ],
  tradeRoutes:[
    {id:'ROUTE-AB', fromSystemId:'SYS-A', toSystemId:'SYS-B', kind:'trade', status:'Established', distance:1, source:'generated'},
    {id:'ROUTE-BC', fromSystemId:'SYS-B', toSystemId:'SYS-C', kind:'trade', status:'Established', distance:1, source:'manual', manualOverride:true, note:'GM corridor'},
    {id:'ROUTE-CD', fromSystemId:'SYS-C', toSystemId:'SYS-D', kind:'trade', status:'Blocked', distance:1, source:'manual', manualOverride:true}
  ],
  markets:[
    {id:'MARKET-A', systemId:'SYS-A', planetId:'WORLD-A', goods:[{name:'Machine parts', priceIndex:110, custom:'keep'}]},
    {id:'MARKET-C', systemId:'SYS-C', planetId:'WORLD-C', goods:[]},
    {id:'MARKET-D', systemId:'SYS-D', planetId:'WORLD-D', goods:[]}
  ],
  factions:[{id:'FACTION-1', name:'The Meridian League'}],
  diplomacy:[], corporationMarketLinks:[],
  factionNews:[{turn:7, event:'legacy latest news'}],
  factionTurnHistory:[{id:'FACTION-TURN-0007', turn:7, events:[{event:'legacy event'}], gmNotes:'Preserve the referee note.'}]
};
const legacySnapshot = JSON.stringify(sector);

// Migration is additive, idempotent, and must not mutate existing campaign data.
Sim.migrateSector(sector, {sourceApplicationVersion:'1.2'});
assert.equal(sector.schemaVersion, 3, 'Legacy root schema remains compatible with 1.2 readers.');
assert.equal(sector.simulation.schemaVersion, 1);
assert.equal(sector.simulation.clock.turn, 7);
assert.equal(sector.simulation.random.algorithm, 'xorshift32-keyed-v1');
assert.equal(sector.customSectorField.preserveMe, true);
assert.equal(sector.tradeRoutes[1].note, 'GM corridor');
assert.equal(sector.markets[0].goods[0].custom, 'keep');
assert.equal(sector.factionTurnHistory[0].gmNotes, 'Preserve the referee note.');
assert.equal(sector.factionNews[0].event, 'legacy latest news');
const firstMigrated = JSON.stringify(sector);
Sim.migrateSector(sector, {sourceApplicationVersion:'1.2'});
assert.equal(JSON.stringify(sector), firstMigrated, 'Running migration twice must make no further changes.');
assert.ok(JSON.stringify(sector).includes('customSectorField'));
assert.notEqual(legacySnapshot, JSON.stringify(sector), 'Migration adds the new simulation envelope.');

// Preserve-mode import migration must not generate missing content or alter
// the explicit import mode / source records.
const preserveImport = {
  name:'Imported Preserve', gmMode:true, schemaVersion:3,
  importMetadata:{mode:'preserve', source:'SWN'},
  swnImport:{records:[{id:'SWN-RAW-1', type:'system', raw:{kept:true}}]},
  systems:[{id:'IMPORTED-SYS-1', x:0, y:0, planets:[], bodies:[]}],
  tradeRoutes:[], markets:[], factions:[], diplomacy:[], customImportSentinel:'intact'
};
Sim.migrateSector(preserveImport, {sourceApplicationVersion:'1.2'});
assert.equal(preserveImport.importMetadata.mode, 'preserve');
assert.equal(preserveImport.swnImport.records[0].raw.kept, true);
assert.equal(preserveImport.customImportSentinel, 'intact');
assert.equal(preserveImport.markets.length, 0, 'Migration must not generate markets for preserve-mode imports.');
assert.equal(preserveImport.factions.length, 0, 'Migration must not generate factions for preserve-mode imports.');

// A sector stores an immutable root seed. Each campaign phase/scope gets an
// independent reproducible stream; extra draws in one stream cannot shift another.
const seededA = {name:'Seed Test', systems:[{id:'A',x:0,y:0,planets:[]},{id:'B',x:2,y:3,planets:[]}], factions:[]};
const seededB = JSON.parse(JSON.stringify(seededA));
seededA.grid = {columns:10, rows:12};
seededB.grid = {rows:12, columns:10};
Sim.migrateSector(seededA);
Sim.migrateSector(seededB);
assert.equal(seededA.simulation.random.algorithm, 'xorshift32-keyed-v1');
const makeStream = (sector, turn, phase, scope) => Sim.createRandomStream(sector, {turn, phase, scope});
const drawsA = makeStream(seededA, 4, 'faction.action', 'FACTION-A');
const drawsB = makeStream(seededB, 4, 'faction.action', 'FACTION-A');
const valuesA = Array.from({length:100}, () => Sim.nextRandom(drawsA));
const valuesB = Array.from({length:100}, () => Sim.nextRandom(drawsB));
assert.deepEqual(valuesA, valuesB, 'Identical root seed/turn/phase/scope must produce identical keyed streams.');
assert.ok(valuesA.every(value => value >= 0 && value < 1));
assert.equal(drawsA.draws, 100);
const isolated = makeStream(seededA, 4, 'faction.action', 'FACTION-A');
const control = makeStream(seededA, 4, 'faction.action', 'FACTION-A');
const unrelated = makeStream(seededA, 4, 'faction.combat', 'FACTION-A');
for (let i=0; i<25; i++) Sim.nextRandom(unrelated);
assert.equal(Sim.nextRandom(isolated), Sim.nextRandom(control), 'An unrelated phase draw must not advance another stream.');
assert.notDeepEqual(
  Array.from({length:8}, (_, i) => Sim.nextRandom(makeStream(seededA, i + 1, 'phase', 'scope'))),
  Array.from({length:8}, (_, i) => Sim.nextRandom(makeStream(seededA, i + 2, 'phase', 'scope'))),
  'Different turn keys should derive different streams.'
);
assert.throws(() => Sim.randomInteger({}, 4, 4), /keyed simulation random stream/i);
assert.equal(Sim.randomInteger(makeStream(seededA, 1, 'fixed', 'test'), 4, 4), 4);
assert.throws(() => Sim.randomInteger(makeStream(seededA, 1, 'fixed', 'test'), 5, 4), /Invalid/);

// Existing 1.3.1 global-stream fields are retained only as diagnostics and are
// never consumed by the keyed stream implementation.
const oldFoundation = {systems:[], factions:[], simulation:{schemaVersion:1, engineVersion:'1.3.0-dev', migration:{sourceApplicationVersion:'1.2'}, random:{algorithm:'xorshift32-v1',seed:123,state:456,draws:9}}};
Sim.migrateSector(oldFoundation);
assert.equal(oldFoundation.simulation.migration.sourceApplicationVersion, '1.2', 'Existing source labels are preserved; the old engine marker cannot distinguish a genuine 1.2 save from a mislabeled 1.3.1-created save.');
assert.equal(oldFoundation.simulation.random.legacyState, 456);
assert.equal(oldFoundation.simulation.random.legacyDraws, 9);
assert.equal(Object.prototype.hasOwnProperty.call(oldFoundation.simulation.random, 'state'), false);
const genuineLegacy = {systems:[], factions:[]};
Sim.migrateSector(genuineLegacy, {sourceApplicationVersion:'1.2'});
assert.equal(genuineLegacy.simulation.migration.sourceApplicationVersion, '1.2', 'Genuine 1.2 sectors retain their correct provenance.');

// Provenance and individual manual field locks.
const generated = {id:'GEN-1', source:'generated', temperature:20};
const imported = {id:'IMP-1', importedFromSWN:true};
const manual = {id:'MAN-1', source:'manual'};
const simulated = {id:'SIM-1', source:'simulated'};
assert.equal(Sim.getProvenance(generated), 'generated');
assert.equal(Sim.getProvenance(imported), 'imported');
assert.equal(Sim.getProvenance(manual), 'manual');
assert.equal(Sim.getProvenance(simulated), 'simulated');
assert.equal(Sim.isFieldOverridden(generated, 'temperature'), false);
assert.equal(Object.prototype.hasOwnProperty.call(generated, 'fieldOverrides'), false, 'A read-only ownership check must not add an empty override map.');
Sim.setFieldOverride(generated, 'temperature', 27);
assert.equal(generated.temperature, 27);
assert.equal(Sim.isFieldOverridden(generated, 'temperature'), true);
assert.equal(generated.fieldOverrides.temperature, true);
assert.equal(Object.prototype.hasOwnProperty.call(generated, 'manualOverrides'), false, 'New overrides must write one canonical map.');
Sim.clearFieldOverride(generated, 'temperature');
assert.equal(Sim.isFieldOverridden(generated, 'temperature'), false);
const legacyOverrides = {manualOverrides:{description:true, priceIndex:true}, fieldOverrides:{priceIndex:false}};
assert.equal(Sim.isFieldOverridden(legacyOverrides, 'description'), true, 'Legacy manualOverrides must migrate into fieldOverrides.');
assert.equal(legacyOverrides.fieldOverrides.description, true);
assert.equal(Object.prototype.hasOwnProperty.call(legacyOverrides, 'manualOverrides'), false);
assert.equal(Sim.isFieldOverridden(legacyOverrides, 'priceIndex'), false, 'Explicit canonical false values must take precedence.');

// Pure multi-hop reachability: A -> B -> C, with C -> D blocked.
const graphInput = JSON.parse(JSON.stringify(sector));
const graphSnapshot = JSON.stringify(graphInput);
const derived = Sim.calculateDerivedState(graphInput);
assert.equal(JSON.stringify(graphInput), graphSnapshot, 'Derived-state calculation must not mutate canonical sector records.');
assert.equal(derived.topology.components.length, 2, 'Blocked CD route must leave D in a separate component.');
assert.deepEqual(JSON.parse(JSON.stringify(derived.marketAccess['MARKET-A'].reachableMarkets)), [{marketId:'MARKET-C', hops:2}]);
assert.equal(derived.marketAccess['MARKET-A'].directOperationalTradeRoutes, 1);
assert.equal(derived.marketAccess['MARKET-D'].reachableMarkets.length, 0);
const derivedAgain = Sim.calculateDerivedState(graphInput);
assert.deepEqual(JSON.parse(JSON.stringify(derivedAgain)), JSON.parse(JSON.stringify(derived)), 'Derived graph must be repeatable.');
assert.match(derived.fingerprint, /^fnv1a-[0-9a-f]{8}$/);
assert.equal(graphInput.simulation.derived.lastFingerprint, '', 'Pure calculation must not write the cache.');
const cachedDerived = Sim.refreshDerivedState(graphInput);
assert.equal(graphInput.simulation.derived.lastFingerprint, cachedDerived.fingerprint, 'Explicit refresh must commit the calculated fingerprint.');
const cachedSnapshot = JSON.stringify(graphInput);
assert.equal(Sim.refreshDerivedState(graphInput).fingerprint, cachedDerived.fingerprint);
assert.equal(JSON.stringify(graphInput), cachedSnapshot, 'Refreshing unchanged derived state must be idempotent.');
graphInput.tradeRoutes[0].distance = 2;
assert.notEqual(Sim.calculateDerivedState(graphInput).fingerprint, derived.fingerprint, 'A changed route distance must invalidate the derived-state fingerprint.');

// Chronicle events receive stable IDs and retain existing legacy faction logs.
const record = Sim.recordEvent(sector, {
  category:'economic', type:'shortage', summary:'Medical compounds fell below target stock.',
  marketId:'MARKET-A', effects:[{field:'inventory', delta:-10}]
});
assert.equal(record.id, 'SIM-EVENT-0000001');
assert.equal(record.turn, 7);
assert.equal(sector.factionTurnHistory[0].gmNotes, 'Preserve the referee note.');
const secondRecord = Sim.recordEvent(sector, {id:'FORGED-ID', sequence:900, turn:999, category:'political', summary:'A new agreement was signed.'});
assert.equal(secondRecord.id, 'SIM-EVENT-0000002');
assert.equal(secondRecord.sequence, 2);
assert.equal(secondRecord.turn, 7, 'Event timeline identity must be owned by the simulation engine.');
sector.factionTurn = 8;
Sim.syncLegacyTurn(sector);
assert.equal(sector.simulation.clock.turn, 8);
assert.equal(sector.simulation.clock.lastAdvancedAtTurn, 8);

// A malformed sector reports actionable issues without changing its records.
const malformed = {
  systems:[{id:'DUP',x:0,y:0,planets:[]},{id:'DUP',x:0,y:0,planets:[]}],
  factions:[{id:'F1'}], markets:[{id:'M1',systemId:'MISSING'}],
  tradeRoutes:[{id:'R1',fromSystemId:'DUP',toSystemId:'GONE'}],
  diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2'}],
  polities:[{id:'P1',memberSystemIds:['MISSING-SYS'],relations:[{polityId:'P2'}]}]
};
const malformedSnapshot = JSON.stringify(malformed);
const validation = Sim.validateSector(malformed);
assert.equal(validation.ok, false);
assert.ok(validation.errors.some(message => message.includes('Duplicate system ID')));
assert.ok(validation.errors.some(message => message.includes('missing origin') || message.includes('missing destination')));
assert.ok(validation.errors.some(message => message.includes('references a missing faction')));
assert.ok(validation.warnings.some(message => message.includes('missing member system')));
assert.ok(validation.warnings.some(message => message.includes('missing polity')));
assert.equal(JSON.stringify(malformed), malformedSnapshot, 'Validation must be read-only.');

assert.throws(() => Sim.migrateSector({simulation:{schemaVersion:999}}), /newer simulation schema/);
console.log('PASS: 1.3.2 simulation foundation — idempotent migration, keyed phase/scope RNG, canonical field overrides, shared route eligibility, pure/committed derived fingerprints, polity validation, Chronicle event IDs, and read-only validation.');
