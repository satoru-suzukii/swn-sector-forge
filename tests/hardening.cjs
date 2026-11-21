#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console,Date,Math,Map,Set,Object,Array,String,Number,JSON,RegExp,Error,TypeError,RangeError,parseInt,parseFloat});
context.CampaignTools = {
  TRADE_GOODS:[{name:'Food',category:'Food',basePrice:100},{name:'Medical compounds',category:'Medical',basePrice:500}],
  getDiplomaticRelation(sector,a,b){return (sector.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;},
  advanceFactionTurn(sector){sector.factionTurn=Number(sector.factionTurn||0)+1;sector.factionTurnHistory=Array.isArray(sector.factionTurnHistory)?sector.factionTurnHistory:[];sector.factionTurnHistory.push({id:'FACTION-TURN-'+String(sector.factionTurn).padStart(4,'0'),turn:sector.factionTurn,events:[{factionId:'F1',action:'hold',result:'Success'}],gmNotes:''});return [{factionId:'F1',action:'hold',result:'Success'}];}
};
[
  'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
  'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
  'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js',
  'simulation/strategic-engine.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const get=name=>vm.runInContext(name,context);
const Sim=get('SectorSimulation'), Economy=get('SectorEconomy'), Settlement=get('SectorSettlement');
const Logistics=get('SectorLogistics'), Politics=get('SectorPolitics'), Contracts=get('SectorTradeContracts'), Transport=get('SectorTransport');
function createSector(){
  const sector={name:'1.3.9 final hardening test',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Aster',x:0,y:0,controllingFactionId:'F1',polityId:'P1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'3',tag1:'Oceanic World'}]},
      {id:'B',name:'Boreal',x:1,y:0,controllingFactionId:'F2',polityId:'P2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Heavy Industry'}]}
    ],
    markets:[
      {id:'MA',systemId:'A',planetId:'WA',planetName:'Aster Prime',systemName:'Aster',population:'several million inhabitants',techLevel:'3',profile:'Agrarian exporter',traits:['Oceanic World'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]},
      {id:'MB',systemId:'B',planetId:'WB',planetName:'Boreal Prime',systemName:'Boreal',population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Heavy Industry'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]}
    ],
    factions:[{id:'F1',name:'Aster League',factionCredits:100,assets:[]},{id:'F2',name:'Boreal Compact',factionCredits:100,assets:[]}],
    polities:[{id:'P1',name:'Aster Commonwealth',capitalSystemId:'A',memberSystemIds:['A'],relations:[]},{id:'P2',name:'Boreal Union',capitalSystemId:'B',memberSystemIds:['B'],relations:[]}],
    diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:1}],
    tradeRoutes:[{id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0}]
  };
  Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.8'});
  Politics.initialize(sector); Economy.initializeSector(sector); Settlement.initialize(sector); Logistics.initialize(sector); Contracts.initialize(sector); Transport.initialize(sector);
  return sector;
}

assert.equal(Sim.getSchemaInfo().engineVersion,'1.3.12');
const sector=createSector();
const limits=Sim.setHistoryRetentionPolicy(sector,{chronicleEvents:10,economyLedgerEntries:5,marketLedgerEntries:5,logisticsLedgerEntries:5,settlementLedgerEntries:10,contractLedgerEntries:10,transportLedgerEntries:10,diplomacyEvents:3,politicsEvents:3,perRecordHistory:3,turnJournal:2,factionTurnHistoryEntries:10});
assert.equal(limits.chronicleEvents,10);
assert.equal(limits.settlementLedgerEntries,10,'Retention limits have a safe minimum to avoid accidentally erasing useful recent history.');
for(let i=0;i<15;i++)Sim.recordEvent(sector,{category:i%2?'economic':'politics',type:'retention-fixture-'+(i%3),turn:i,summary:'Retention event '+i});
assert.equal(sector.simulation.chronicle.events.length,10,'Chronicle hot history should respect configured limit immediately.');
assert.equal(sector.simulation.chronicle.archive.archivedCount,5,'Older events should be represented in the aggregate archive.');
assert.equal(sector.simulation.chronicle.archive.byCategory.$economic+sector.simulation.chronicle.archive.byCategory.$politics,5);
sector.factionTurnHistory=Array.from({length:15},(_,i)=>({id:'FACTION-TURN-'+String(i+1).padStart(4,'0'),turn:i+1,events:[{action:'trade'}],gmNotes:i===0?'Archived referee note must survive compaction.':''}));
Sim.compactHistory(sector);
assert.equal(sector.factionTurnHistory.length,10,'Legacy faction turn history should obey its retention window.');
assert.equal(sector.factionTurnHistoryArchive.archivedCount,5);
assert.equal(sector.factionTurnHistoryArchive.notesByTurn.$1.notes,'Archived referee note must survive compaction.','GM-authored turn notes must remain lossless in the archive.');

// Financial compaction must preserve shipment audit references and external-key idempotency.
const market=Settlement.getAccounts(sector).find(a=>a.ownerType==='market'&&a.ownerId==='MA');
const faction=Settlement.getAccounts(sector).find(a=>a.ownerType==='faction'&&a.ownerId==='F1');
const payment=Settlement.transferCredits(sector,{ownerType:'market',ownerId:'MA'},{ownerType:'faction',ownerId:'F1'},20,{turn:0,type:'commodity-purchase',shipmentId:'SHIP-HISTORY-1',quantityLots:2,unitPriceCr:10,externalKey:'shipment-payment:history-1'});
assert.equal(payment.ok,true);
sector.simulation.economy.logistics.shipments.push({id:'SHIP-HISTORY-1',status:'delivered',deliveredQuantity:2,commodityPaidQuantity:2,commodityPaidCr:20,commoditySettlementIds:[payment.id]});
for(let i=0;i<12;i++)Settlement.transferCredits(sector,{ownerType:'market',ownerId:'MA'},{ownerType:'faction',ownerId:'F2'},i+1,{turn:i,type:'audit-fixture',externalKey:'fixture-key-'+i});
const balanceBefore=market.balance;
const compaction=Sim.compactHistory(sector);
assert.equal(sector.simulation.economy.settlement.ledger.length,10,'Financial hot ledger should be bounded.');
assert.ok(sector.simulation.economy.settlement.archive.archivedCount>=3,'Old financial lines should be summarized.');
assert.equal(Settlement.validate(sector).ok,true,'Archived commodity payment references must continue to validate.');
const duplicate=Settlement.transferCredits(sector,{ownerType:'market',ownerId:'MA'},{ownerType:'faction',ownerId:'F1'},20,{turn:99,type:'commodity-purchase',shipmentId:'SHIP-HISTORY-1',quantityLots:2,unitPriceCr:10,externalKey:'shipment-payment:history-1'});
assert.equal(duplicate.ok,true);
assert.equal(duplicate.skipped,true,'Archived external keys must remain idempotent.');
assert.equal(market.balance,balanceBefore,'An archived duplicate external key must not move credits twice.');
assert.ok(compaction.compacted>0);

// Contract ledger sequence numbers must not collide after compaction and save/reload.
const contracts=sector.simulation.economy.contracts;
contracts.ledger=Array.from({length:12},(_,i)=>({id:'CONTRACT-LEDGER-'+String(i+10).padStart(7,'0'),turn:1,type:'fixture'}));
contracts.nextLedgerSequence=22;
Sim.compactHistory(sector);
assert.equal(contracts.ledger.length,10);
assert.equal(contracts.nextLedgerSequence,22);
const roundTrip=JSON.parse(JSON.stringify(sector));
const reloaded=Contracts.initialize(roundTrip);
assert.equal(reloaded.ledger,10);
assert.equal(roundTrip.simulation.economy.contracts.nextLedgerSequence,22);

// Completed shipment bodies are compacted independently from active cargo. Archived
// summaries retain payment references, totals, stable IDs and settlement validation,
// while bulky per-leg arrays are removed.
const shipmentSector=createSector();
const shipmentPayment=Settlement.transferCredits(shipmentSector,{ownerType:'market',ownerId:'MA'},{ownerType:'faction',ownerId:'F1'},20,{turn:1,type:'commodity-purchase',shipmentId:'SHIP-0000001',quantityLots:2,unitPriceCr:10,externalKey:'shipment-payment:archive-fixture'});
assert.equal(shipmentPayment.ok,true);
shipmentSector.simulation.clock.turn=5;
shipmentSector.simulation.economy.logistics.shipments=Array.from({length:12},(_,i)=>({
  id:'SHIP-'+String(i+1).padStart(7,'0'),status:'delivered',createdTurn:0,deliveredTurn:1,
  commodityId:'food',originMarketId:'MA',destinationMarketId:'MB',originSystemId:'A',destinationSystemId:'B',
  quantity:2,remainingQuantity:0,deliveredQuantity:2,commodityPaidQuantity:i===0?2:0,commodityPaidCr:i===0?20:0,
  commoditySettlementIds:i===0?[shipmentPayment.id]:[],saleUnitPriceCr:10,legs:[{routeId:'R1',departedTurn:0,arrivalTurn:1,cargoUnits:2,status:'arrived'}]
}));
const shipLimits=Sim.setHistoryRetentionPolicy(shipmentSector,{shipmentRecords:10});
assert.equal(shipLimits.shipmentRecords,10);
assert.equal(shipmentSector.simulation.economy.logistics.shipments.length,10,'Changing retention policy must compact old completed shipment bodies immediately.');
assert.equal(shipmentSector.simulation.economy.logistics.shipmentArchive.archivedCount,2);
assert.ok(Array.isArray(shipmentSector.simulation.economy.logistics.shipmentArchive.shipments['$SHIP-0000001'].legs),'1.3.10 shipment archives must preserve full route-leg detail.');
assert.equal(Logistics.validate(shipmentSector).ok,true,'Active and archived shipment IDs and quantities must validate.');
assert.equal(Settlement.validate(shipmentSector).ok,true,'Archived shipment summaries must preserve financial payment reconciliation.');
assert.equal(Logistics.getSummary(shipmentSector).total,12);
assert.equal(Logistics.getSummary(shipmentSector).archived,2);
assert.ok(shipmentSector.simulation.economy.logistics.nextShipmentSequence>12,'Compaction must never permit shipment ID reuse.');
const shipmentReload=JSON.parse(JSON.stringify(shipmentSector));
Logistics.initialize(shipmentReload);
assert.equal(Logistics.validate(shipmentReload).ok,true,'Archived shipment data and sequence must survive save/load.');
assert.ok(shipmentReload.simulation.economy.logistics.nextShipmentSequence>12);

// Replaying the same 16 campaign turns from identical save checkpoints must yield
// byte-equivalent canonical state, including Chronicle IDs and compacted history.
const replayA=createSector(), replayB=createSector();
for(let turn=0;turn<16;turn++) {
  const resultA=Sim.advanceCampaignTurn(replayA), resultB=Sim.advanceCampaignTurn(replayB);
  assert.equal(resultA.turn,resultB.turn);
  assert.deepEqual(JSON.parse(JSON.stringify(replayA)),JSON.parse(JSON.stringify(replayB)),'Identical seeded campaign turns must replay deterministically.');
}
assert.equal(replayA.simulation.turnCoordinator.lastCommittedTurn,16);
assert.equal(Sim.validateTurnCoordinator(replayA).ok,true);

// An older 1.3.8 save receives default 1.3.9 retention/archive scaffolding without
// changing the legacy root schema or losing existing campaign objects.
const upgraded138=createSector();
upgraded138.simulation.engineVersion='1.3.8';
upgraded138.simulation.economy.logistics.engineVersion='1.3.8';
upgraded138.simulation.economy.logistics.shipments.push({id:'SHIP-LEGACY-UPGRADE',status:'in-transit',createdTurn:0,commodityId:'food',quantity:1,remainingQuantity:1,deliveredQuantity:0,legs:[]});
Sim.migrateSector(upgraded138,{sourceApplicationVersion:'1.3.8'});
Logistics.initialize(upgraded138);
assert.equal(upgraded138.schemaVersion,3,'The legacy root sector schema must remain 3.');
assert.equal(upgraded138.simulation.engineVersion,'1.3.12');
assert.equal(upgraded138.simulation.economy.logistics.shipments.some(x=>x.id==='SHIP-LEGACY-UPGRADE'),true,'A 1.3.8 active shipment must survive migration.');
assert.equal(Logistics.getSummary(upgraded138).archived,0);

// Coordinator's pre-commit gate includes contract, transport and root validation.
const malformed=createSector();
malformed.simulation.transport.ports.push({id:'BAD-PORT',systemId:'A',level:9,handlingCapacityPerTurn:10,condition:100,ownerType:'independent'});
const snapshot=JSON.stringify(malformed);
assert.throws(()=>Sim.advanceCampaignTurn(malformed),/transport validation failed/i);
assert.equal(JSON.stringify(malformed),snapshot,'A transport validation failure must preserve the live campaign exactly.');
const malformedContract=createSector();
malformedContract.simulation.economy.contracts.records.push({id:'BAD-CONTRACT',originMarketId:'MA',destinationMarketId:'MB',commodityId:'food',quantityPerTurn:0,status:'impossible',priority:'standard',startTurn:1,endTurn:0});
const contractSnapshot=JSON.stringify(malformedContract);
assert.throws(()=>Sim.advanceCampaignTurn(malformedContract),/contracts validation failed/i);
assert.equal(JSON.stringify(malformedContract),contractSnapshot,'A contract validation failure must preserve the live campaign exactly.');

const valid=createSector();
const turn=Sim.advanceCampaignTurn(valid);
assert.equal(turn.ok,true);
assert.ok(turn.validation.some(v=>v.engine==='contracts'&&v.ok));
assert.ok(turn.validation.some(v=>v.engine==='transport'&&v.ok));
assert.ok(turn.validation.some(v=>v.engine==='sector'&&v.ok));
assert.ok(turn.validation.some(v=>v.engine==='turn-coordinator'&&v.ok));
assert.equal(Sim.validateTurnCoordinator(valid).ok,true);

// Bounded histories must be stable across repeat compaction and JSON round-trip.
const compactedOnce=JSON.stringify(valid.simulation.chronicle.archive||{});
Sim.compactHistory(valid);
assert.equal(JSON.stringify(valid.simulation.chronicle.archive||{}),compactedOnce,'Repeated compaction with no new rows must be idempotent.');
const serialized=JSON.parse(JSON.stringify(valid));
assert.equal(Sim.getRetentionSummary(serialized).policy.chronicleEvents,150,'Default retention policy must migrate without requiring explicit settings.');

// Long-run campaign smoke: clocks, recent history windows and archived GM notes remain coherent.
const longRun=createSector();
Sim.setHistoryRetentionPolicy(longRun,{chronicleEvents:10,factionTurnHistoryEntries:10,turnJournal:10,diplomacyEvents:10,politicsEvents:10});
for(let i=0;i<80;i++){const result=Sim.advanceCampaignTurn(longRun);assert.equal(result.ok,true,'Long-run campaign turn '+(i+1)+' should commit.');}
assert.equal(longRun.factionTurn,80);
assert.equal(longRun.simulation.clock.turn,80);
assert.ok(longRun.simulation.chronicle.events.length<=10);
assert.ok(longRun.factionTurnHistory.length<=10);
assert.ok(longRun.simulation.turnCoordinator.journal.length<=10);
assert.ok(longRun.factionTurnHistoryArchive.archivedCount>=70);
assert.equal(Sim.validateTurnCoordinator(longRun).ok,true);
assert.equal(Sim.validateSector(longRun).ok,true);
console.log('PASS: inherited 1.3.9 hardening regressions on 1.3.10 — bounded hot histories, budgeted detail archives, shipment route-leg preservation, payment reconciliation, archived GM notes and idempotency, stable IDs, turn validation, deterministic replay, legacy-save upgrade, and 80-turn campaign smoke.');
