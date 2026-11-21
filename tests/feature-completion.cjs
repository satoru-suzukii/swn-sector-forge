#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const context = vm.createContext({
  console, Date, Math, Map, Set, Object, Array, String, Number, Boolean, JSON,
  RegExp, Error, TypeError, RangeError, parseInt, parseFloat, Uint8Array
});
context.CampaignTools = {
  TRADE_GOODS:[{name:'Fresh produce',category:'Agricultural',basePrice:120},{name:'Medical compounds',category:'Medical',basePrice:500}],
  getDiplomaticRelation(sector,a,b) {
    return (sector.diplomacy || []).find(r =>
      (String(r.factionAId)===String(a)&&String(r.factionBId)===String(b)) ||
      (String(r.factionAId)===String(b)&&String(r.factionBId)===String(a))) || null;
  }
};
const moduleFiles = [
  'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
  'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
  'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js','simulation/strategic-engine.js'
];
moduleFiles.forEach(file => vm.runInContext(read(file), context, {filename:file}));
const get = name => vm.runInContext(name, context);
const Sim = get('SectorSimulation'), Economy = get('SectorEconomy'), Settlement = get('SectorSettlement');
const Logistics = get('SectorLogistics'), Politics = get('SectorPolitics'), Contracts = get('SectorTradeContracts');
const Strategy = get('SectorStrategic'), Transport = get('SectorTransport');

function makeSector(name='1.3.10 feature completion') {
  const sector = {
    name, schemaVersion:3, gmMode:true, factionTurn:0, seed:1310, grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Aster',x:0,y:0,controllingFactionId:'F1',polityId:'P1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'4',tag1:'Industrial World'}]},
      {id:'B',name:'Boreal',x:1,y:0,controllingFactionId:'F2',polityId:'P2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Trade Hub'}]},
      {id:'C',name:'Cinder',x:2,y:0,controllingFactionId:'F3',polityId:'P3',planets:[{id:'WC',name:'Cinder Prime',population:'several million inhabitants',techLevel:'4',tag1:'Agricultural World'}]}
    ],
    markets:['A','B','C'].map((id,i)=>({
      id:'M'+id,systemId:id,planetId:'W'+id,systemName:['Aster','Boreal','Cinder'][i],planetName:['Aster Prime','Boreal Prime','Cinder Prime'][i],
      population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Industrial World'],
      goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100,basePriceIndex:100}]
    })),
    factions:[
      {id:'F1',name:'Aster League',goal:'Secure trade and supply agreements',wealth:4,cunning:3,force:3,factionCredits:30,assets:[]},
      {id:'F2',name:'Boreal Compact',goal:'Protect trade corridors',wealth:4,cunning:3,force:3,factionCredits:30,assets:[]},
      {id:'F3',name:'Cinder Combine',goal:'Expand commercial influence',wealth:4,cunning:3,force:3,factionCredits:30,assets:[]}
    ],
    polities:[{id:'P1',name:'Aster Polity',relations:[]},{id:'P2',name:'Boreal Polity',relations:[]},{id:'P3',name:'Cinder Polity',relations:[]}],
    corporations:[{id:'CORP-1',name:'Aster Trade'},{id:'CORP-2',name:'Cinder Trade'}],
    corporationMarketLinks:[
      {id:'L1',corporationId:'CORP-1',marketId:'MA'},{id:'L2',corporationId:'CORP-1',marketId:'MB'},
      {id:'L3',corporationId:'CORP-2',marketId:'MC'},{id:'L4',corporationId:'CORP-2',marketId:'MB'}
    ],
    diplomacy:[
      {id:'D1',factionAId:'F1',factionBId:'F2',state:'Strained',trust:0,tension:8},
      {id:'D2',factionAId:'F2',factionBId:'F3',state:'Neutral',trust:0,tension:1}
    ],
    tradeRoutes:[
      {id:'R-AB',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0},
      {id:'R-CB',fromSystemId:'C',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0},
      {id:'R-AC',fromSystemId:'A',toSystemId:'C',distance:2,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:2,freightCostPerUnit:2,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0}
    ]
  };
  Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.9'});
  Politics.initialize(sector);
  Economy.initializeSector(sector);
  Settlement.initialize(sector);
  Logistics.initialize(sector);
  Contracts.initialize(sector);
  Transport.initialize(sector);
  return sector;
}

// Default hot-history windows are deliberately conservative, and the market
// ledger's four-row default must survive migration and settings round-trips.
const defaultRetentionSector=makeSector('Default retention fixture');
assert.equal(Sim.getHistoryRetentionPolicy(defaultRetentionSector).marketLedgerEntries,4);
assert.equal(Sim.getHistoryRetentionPolicy(JSON.parse(JSON.stringify(defaultRetentionSector))).marketLedgerEntries,4);
assert.equal(Sim.getHistoryRetentionPolicy(defaultRetentionSector).chronicleEvents,150);

// Path graphs and shortest-path trees are reused for identical lookups, then
// invalidated when a political mutation changes route access during a turn.
const pathCacheSector=makeSector('Path cache fixture');
Logistics.getPath(pathCacheSector,'A','B','fresh-produce');
Logistics.getPath(pathCacheSector,'A','B','fresh-produce');
let pathCacheStats=Logistics.getPathCacheStats(pathCacheSector);
assert.equal(pathCacheStats.graphs,1,'Repeated path lookups should build one commodity graph.');
assert.equal(pathCacheStats.searches,1,'Repeated path lookups from the same origin should reuse one shortest-path tree.');
Politics.declareWar(pathCacheSector,{type:'faction',id:'F1'},{type:'faction',id:'F2'});
pathCacheStats=Logistics.getPathCacheStats(pathCacheSector);
assert.equal(pathCacheStats.graphs,0,'Declaring war must invalidate cached trade graphs immediately.');
assert.equal(pathCacheStats.searches,0,'Declaring war must invalidate cached shortest-path trees immediately.');

// Live market and subsystem ledgers have a separate byte budget from archive
// detail. Trimming must keep one newest row in every affected ledger.
const liveBudgetSector=makeSector('Live history budget fixture');
const liveStates=['MA','MB','MC'].map(id=>Economy.getMarketState(liveBudgetSector,id));
for (let stateIndex=0;stateIndex<liveStates.length;stateIndex++) {
  const state=liveStates[stateIndex];
  state.ledger=[]; state.logisticsLedger=[];
  for(let row=0;row<6;row++) {
    const record={id:'LIVE-'+state.marketId+'-'+row,turn:row+1,marketId:state.marketId,payload:'M'.repeat(11000)};
    state.ledger.push(record);
    state.logisticsLedger.push({id:'LIVE-LOG-'+state.marketId+'-'+row,turn:row+1,marketId:state.marketId,payload:'L'.repeat(11000)});
  }
}
Sim.setHistoryRetentionPolicy(liveBudgetSector,{liveEconomyHistoryBudgetBytes:128*1024});
const liveBudgetSummary=Sim.getRetentionSummary(liveBudgetSector);
assert.ok(liveBudgetSummary.liveEconomyHistory.bytes<=liveBudgetSummary.liveEconomyHistory.budgetBytes,
  'Live economy history must fit within its separate byte budget.');
for(const state of liveStates) {
  assert.ok(state.ledger.length>=1,'Every market ledger must retain at least its newest row.');
  assert.ok(state.logisticsLedger.length>=1,'Every market logistics ledger must retain at least its newest row.');
  assert.equal(state.ledger[state.ledger.length-1].id,'LIVE-'+state.marketId+'-5');
  assert.equal(state.logisticsLedger[state.logisticsLedger.length-1].id,'LIVE-LOG-'+state.marketId+'-5');
}
assert.ok(liveBudgetSummary.liveEconomyHistory.retainedRecords<36,
  'Old live entries should be archived rather than left to grow unbounded.');


// Detailed records survive compaction, including payload fields rather than
// only aggregate summaries. This applies to newly compacted 1.3.10 records.
const archiveSector = makeSector('Lossless archive fixture');
Sim.setHistoryRetentionPolicy(archiveSector, {
  chronicleEvents:10, factionTurnHistoryEntries:10, economyLedgerEntries:10,
  settlementLedgerEntries:10, shipmentRecords:10, turnJournal:10
});
for (let i=0;i<15;i++) Sim.recordEvent(archiveSector,{
  id:'CHRONICLE-'+i,turn:i,category:'economic',type:'archive-fixture',summary:'Archive event '+i,
  actorIds:['F1'],affectedEntityIds:['MA','MB'],causes:['CAUSE-'+i],effects:[{kind:'inventoryDelta',value:i}],effectDetails:{priceDelta:i*2},gmOnlyContext:{detail:'GM detail '+i}
});
const chronicleArchive=archiveSector.simulation.chronicle.archive;
assert.equal(chronicleArchive.archivedCount,5);
assert.equal(chronicleArchive.schemaVersion,2);
assert.equal(chronicleArchive.records.length,5);
assert.equal(chronicleArchive.records[0].effects[0].value,0);
assert.equal(chronicleArchive.records[0].gmOnlyContext.detail,'GM detail 0');
assert.deepEqual(Array.from(chronicleArchive.records[0].causes),['CAUSE-0']);

archiveSector.factionTurnHistory=Array.from({length:15},(_,i)=>({
  id:'FT-'+(i+1),turn:i+1,gmNotes:i===0?'Preserved GM note':'',events:[{action:'trade',details:{credits:i+1},result:'settled'}],
  politicalContext:{treaties:['T-'+i]},factionSnapshots:[{id:'F1',credits:100-i}]
}));
archiveSector.simulation.economy.ledger=Array.from({length:15},(_,i)=>({id:'ECO-'+i,turn:i,type:'production',marketId:'MA',commodityId:'fresh-produce',quantity:10+i,explanation:{input:{labor:3},output:{stock:10+i}}}));
Sim.compactHistory(archiveSector);
assert.equal(archiveSector.factionTurnHistoryArchive.records.length,5);
assert.equal(archiveSector.factionTurnHistoryArchive.records[0].politicalContext.treaties[0],'T-0');
assert.equal(archiveSector.factionTurnHistoryArchive.records[0].events[0].details.credits,1);
assert.equal(archiveSector.simulation.economy.ledgerArchive.records[0].explanation.input.labor,3);
assert.equal(Sim.getRetentionSummary(archiveSector).archivePolicy,'bounded-gm-detail-v3');
assert.equal(Sim.getRetentionSummary(archiveSector).chronicle.detailedArchived,5);


// The global detailed-history budget bounds old payloads across all archive families.
const archiveCapSector=makeSector('Archive budget fixture');
Sim.setHistoryRetentionPolicy(archiveCapSector,{chronicleEvents:10,archiveDetailBudgetBytes:64*1024});
for(let i=0;i<100;i++) Sim.recordEvent(archiveCapSector,{turn:i,category:'campaign',type:'large-detail',summary:'Large detail '+i,gmOnlyContext:{payload:'X'.repeat(6500),sequence:i}});
Sim.compactHistory(archiveCapSector);
const archiveCapSummary=Sim.getRetentionSummary(archiveCapSector);
assert.ok(archiveCapSummary.archiveDetail.bytes<=archiveCapSummary.archiveDetail.budgetBytes,'Detailed archives must stay within the configured global byte budget.');
assert.ok(archiveCapSummary.chronicle.pruned>0,'Oversized Chronicle detail should be pruned once the shared budget is reached.');
assert.equal(archiveCapSector.simulation.chronicle.archive.archivedCount,90,'Pruning detailed payloads must not erase aggregate archived-event counts.');

// Financial history is archived as full ledger rows, retaining counterparties,
// external keys and shipment settlement fields for audit/reconciliation.
const marketAccount=Settlement.getAccounts(archiveSector).find(x=>x.ownerType==='market'&&x.ownerId==='MA');
assert.ok(marketAccount);
for(let i=0;i<15;i++) {
  const payment=Settlement.transferCredits(archiveSector,{ownerType:'market',ownerId:'MA'},{ownerType:'faction',ownerId:'F1'},i+1,{
    turn:i,type:'audit-fixture',externalKey:'archive-transfer-'+i,memo:'Full financial record '+i,reference:{invoice:'INV-'+i,source:'fixture'}
  });
  assert.equal(payment.ok,true);
}
Sim.setHistoryRetentionPolicy(archiveSector,{settlementLedgerEntries:10});
const settlementArchive=archiveSector.simulation.economy.settlement.archive;
assert.ok(settlementArchive.records.length>=5);
assert.equal(settlementArchive.records[0].externalKey,'archive-transfer-0');
assert.equal(settlementArchive.records[0].fromAccountId,'market:MA');
assert.equal(settlementArchive.records[0].memo,'Full financial record 0');

// Full shipment detail (legs, incidents, and cost context) remains in the archive.
const shipmentSector=makeSector('Lossless shipment fixture');
shipmentSector.simulation.clock.turn=5;
shipmentSector.simulation.economy.logistics.shipments=Array.from({length:12},(_,i)=>({
  id:'SHIP-'+String(i+1).padStart(7,'0'),status:'delivered',createdTurn:0,deliveredTurn:1,commodityId:'fresh-produce',
  originMarketId:'MA',destinationMarketId:'MB',originSystemId:'A',destinationSystemId:'B',quantity:3,remainingQuantity:0,
  deliveredQuantity:3,commodityPaidQuantity:2,commodityPaidCr:40,commoditySettlementIds:['SETTLE-'+i],saleUnitPriceCr:20,
  legs:[{routeId:'R-AB',departedTurn:0,arrivalTurn:1,cargoUnits:3,status:'arrived',operatingCost:4}],
  incidents:[{id:'INC-'+i,type:'delay',severity:1,description:'Retained incident detail'}],costBreakdown:{freight:3,tolls:2,operating:4},lastChronicleEventId:'EV-'+i
}));
Sim.setHistoryRetentionPolicy(shipmentSector,{shipmentRecords:10});
const archivedShipment=shipmentSector.simulation.economy.logistics.shipmentArchive.shipments['$SHIP-0000001'];
assert.ok(archivedShipment);
assert.equal(archivedShipment.legs[0].routeId,'R-AB');
assert.equal(archivedShipment.incidents[0].description,'Retained incident detail');
assert.equal(archivedShipment.costBreakdown.operating,4);
assert.equal(archivedShipment.commoditySettlementIds[0],'SETTLE-0');
assert.equal(Logistics.validate(shipmentSector).ok,true);

// 2. Campaign identity must be stable and null-safe across sparse imports.
const sparse={name:'Sparse',systems:[null,{id:'SYS-X',x:4,y:null}],factions:[],grid:{columns:10,rows:12}};
Sim.migrateSector(sparse,{sourceApplicationVersion:'1.3.9'});
const sparseId=Sim.ensureRecoveryIdentity(sparse);
assert.match(sparseId,/^SF-CAMPAIGN-[a-z0-9-]+$/);
assert.equal(Sim.ensureRecoveryIdentity(sparse),sparseId,'A campaign ID must remain stable after ordinary edits.');
const sharedForkA=makeSector('Same shared campaign copy');
const sharedForkB=makeSector('Same shared campaign copy');
const sharedForkIdA=Sim.ensureRecoveryIdentity(sharedForkA),sharedForkIdB=Sim.ensureRecoveryIdentity(sharedForkB);
assert.notEqual(sharedForkIdA,sharedForkIdB,'Two imports of the same shared snapshot without an embedded GM recovery ID must receive independent campaign identities.');
assert.equal(Sim.ensureRecoveryIdentity(sharedForkA),sharedForkIdA,'The newly assigned fork identity must remain stable after the first assignment.');

// 3. The strategic actor now uses the formal political engine: it proposes a
// bounded agreement, waits until a later turn for a response, and respects GM locks.
const politicalSector=makeSector('Autonomous diplomacy fixture');
Strategy.setSettings(politicalSector,{decisionNoise:0});
politicalSector.factionTurn=1; politicalSector.simulation.clock.turn=1;
const proposed=Strategy.resolveFactionDiplomacy(politicalSector,politicalSector.factions[0],1,{});
assert.equal(proposed.ok,true,proposed.reason);
assert.equal(proposed.action,'propose-non-aggression');
const treaty=Politics.getTreaties(politicalSector).find(x=>x.id===proposed.treatyId);
assert.equal(treaty.status,'proposed');
assert.equal(treaty.proposedBy.id,'F1');
assert.throws(()=>Politics.respondToTreaty(politicalSector,treaty.id,'accept',{type:'faction',id:'F1'}),/cannot respond to its own/i);
politicalSector.factionTurn=1; politicalSector.simulation.clock.turn=1;
const sameTurnResponse=Strategy.resolveFactionDiplomacy(politicalSector,politicalSector.factions[1],1,{});
assert.equal(sameTurnResponse.skipped,true,'A faction must not accept a treaty proposal created earlier in the same faction turn.');
politicalSector.factionTurn=2; politicalSector.simulation.clock.turn=2;
const response=Strategy.resolveFactionDiplomacy(politicalSector,politicalSector.factions[1],2,{});
assert.equal(response.ok,true,response.reason);
assert.equal(response.action,'accept-treaty-proposal');
assert.equal(treaty.status,'active');
assert.equal(treaty.respondedBy.id,'F2');
assert.equal(treaty.startTurn,3,'Newly accepted treaty terms take effect on the following campaign turn.');

const rejectedSector=makeSector('Rejected treaty cooldown fixture');
Strategy.setSettings(rejectedSector,{decisionNoise:0});
rejectedSector.factionTurn=1; rejectedSector.simulation.clock.turn=1;
const rejectedDraft=Strategy.resolveFactionDiplomacy(rejectedSector,rejectedSector.factions[0],1,{});
const rejectedTreaty=Politics.getTreaties(rejectedSector).find(x=>x.id===rejectedDraft.treatyId);
rejectedSector.factionTurn=2; rejectedSector.simulation.clock.turn=2;
Politics.respondToTreaty(rejectedSector,rejectedTreaty.id,'reject',{type:'faction',id:'F2'});
assert.equal(rejectedTreaty.reproposalCooldownUntilTurn,7);
rejectedSector.factionTurn=3; rejectedSector.simulation.clock.turn=3;
Strategy.resolveFactionDiplomacy(rejectedSector,rejectedSector.factions[1],3,{});
assert.equal(Politics.getTreaties(rejectedSector).filter(x=>x.parties.some(p=>p.id==='F1')&&x.parties.some(p=>p.id==='F2')).length,1,'A rejected treaty must not be duplicated during its cooldown.');
assert.ok(politicalSector.simulation.chronicle.events.some(x=>x.type==='treaty-proposed'));
assert.ok(politicalSector.simulation.chronicle.events.some(x=>x.type==='treaty-active'));

const lockedSector=makeSector('GM diplomatic lock fixture');
Strategy.setSettings(lockedSector,{decisionNoise:0});
lockedSector.factionTurn=1; lockedSector.simulation.clock.turn=1;
const lockedProposal=Strategy.resolveFactionDiplomacy(lockedSector,lockedSector.factions[0],1,{});
assert.equal(lockedProposal.ok,true);
lockedSector.diplomacy[0].locked=true;
lockedSector.factionTurn=2; lockedSector.simulation.clock.turn=2;
const lockedResponse=Strategy.resolveFactionDiplomacy(lockedSector,lockedSector.factions[1],2,{});
assert.equal(lockedResponse.skipped,true,'A GM-locked bilateral relationship must remain under referee control.');
assert.equal(Politics.getTreaties(lockedSector).find(x=>x.id===lockedProposal.treatyId).status,'proposed');

// The formal political behavior is reached through the real legacy faction
// turn executor, not only by calling the strategic API directly.
vm.runInContext(read('generators/campaign-tools.js'),context,{filename:'generators/campaign-tools.js'});
const realCampaignTools=get('CampaignTools');
const executedCampaign=makeSector('Faction turn political execution fixture');
executedCampaign.factions.forEach(f=>{f.force=0;f.cunning=0;f.wealth=0;f.factionCredits=0;f.assets=[];f.goal='Seek a diplomatic agreement';});
Strategy.setSettings(executedCampaign,{decisionNoise:0});
const factionEvents=realCampaignTools.advanceFactionTurn(executedCampaign);
assert.equal(executedCampaign.factionTurn,1);
assert.ok(Politics.getTreaties(executedCampaign).some(t=>t.status==='proposed'), 'A diplomacy action selected by the campaign faction executor must create a formal political proposal.');
assert.ok(factionEvents.some(e=>e.action==='Diplomacy'&&String(e.result).indexOf('propose-')>=0));
assert.ok(executedCampaign.simulation.chronicle.events.some(e=>e.type==='treaty-proposed'));

// 4. Faction actors can seek a ceasefire under pressure and pursue peace after
// a full ceasefire turn has elapsed.
const warSector=makeSector('Autonomous war exit fixture');
Strategy.setSettings(warSector,{decisionNoise:0});
warSector.factions[0].force=1; warSector.factions[0].cunning=1; warSector.factions[0].wealth=1;
warSector.factions[1].force=12; warSector.factions[1].cunning=8; warSector.factions[1].wealth=8;
warSector.factionTurn=1; warSector.simulation.clock.turn=1;
const war=Politics.declareWar(warSector,{type:'faction',id:'F1'},{type:'faction',id:'F2'},{notes:'Pressure test'});
const ceasefire=Strategy.resolveFactionDiplomacy(warSector,warSector.factions[0],1,{});
assert.equal(ceasefire.action,'seek-ceasefire');
assert.equal(war.status,'active','A unilateral AI proposal must not stop an active war.');
assert.equal(war.ceasefireProposal.status,'proposed');
assert.throws(()=>Politics.respondToCeasefire(warSector,war.id,'accept',{type:'faction',id:'F1'}),/only the other war participant/i);
warSector.factionTurn=2; warSector.simulation.clock.turn=2;
Politics.respondToCeasefire(warSector,war.id,'accept',{type:'faction',id:'F2'});
assert.equal(war.status,'ceasefire','A ceasefire becomes effective only after the opposing party accepts.');
assert.equal(war.ceasefireStartTurn,3);
warSector.factionTurn=4; warSector.simulation.clock.turn=4;
const peace=Strategy.resolveFactionDiplomacy(warSector,warSector.factions[0],4,{});
assert.equal(peace.action,'seek-peace-settlement');
assert.equal(war.status,'ceasefire','A unilateral peace proposal must not end the ceasefire.');
assert.equal(war.peaceProposal.status,'proposed');
assert.throws(()=>Politics.respondToPeace(warSector,war.id,'accept',{type:'faction',id:'F1'}),/only the other war participant/i);
warSector.factionTurn=5; warSector.simulation.clock.turn=5;
Politics.respondToPeace(warSector,war.id,'accept',{type:'faction',id:'F2'});
assert.equal(war.status,'peace-pending');
assert.equal(war.peaceEffectiveTurn,6,'Peace becomes effective on the turn after the opposing party accepts.');

// 5. Corporate intelligence recognizes a rival's substantially lower delivered
// price and refuses to create a plainly uncompetitive competing agreement.
const corporateSector=makeSector('Corporate competition fixture');
const source=Economy.getMarketState(corporateSector,'MA').inventory.find(x=>x.commodityId==='fresh-produce');
const destination=Economy.getMarketState(corporateSector,'MB').inventory.find(x=>x.commodityId==='fresh-produce');
const rivalSource=Economy.getMarketState(corporateSector,'MC').inventory.find(x=>x.commodityId==='fresh-produce');
Object.assign(source,{onHand:240,targetStock:10,storageCapacity:1000,reserved:0});
Object.assign(destination,{onHand:0,targetStock:80,storageCapacity:1000,reserved:0});
Object.assign(rivalSource,{onHand:240,targetStock:10,storageCapacity:1000,reserved:0});
const rival=Contracts.create(corporateSector,{
  name:'Rival low-price food agreement',originMarketId:'MC',destinationMarketId:'MB',commodityId:'fresh-produce',
  quantityPerTurn:12,unitPriceCr:80,startTurn:1,endTurn:6,priority:'high',status:'active',ownerCorporationId:'CORP-2'
},0);
assert.equal(rival.ok,true,rival.reason);
const corporateResult=Strategy.advanceTurn(corporateSector,1);
assert.equal(corporateResult.ok,true);
const corpOne=corporateResult.corporateReports.find(x=>x.corporationId==='CORP-1');
assert.ok(corpOne.competition.contested>0,'Corporate reports must identify opportunities already served by a rival corporation.');
assert.equal(corpOne.competition.bestCompetitorPrice,80);
assert.ok(corpOne.competition.priceDisadvantaged>0,'The report should surface a quote materially above the competing agreement.');
assert.equal(Contracts.getContracts(corporateSector).some(x=>x.ownerCorporationId==='CORP-1'&&x.originMarketId==='MA'&&x.destinationMarketId==='MB'&&x.commodityId==='fresh-produce'),false,'The corporation must not sign a quote more than 18% above its best competing supply price.');

const reliabilitySector=makeSector('Delivery reliability competition fixture');
Object.assign(Economy.getMarketState(reliabilitySector,'MA').inventory.find(x=>x.commodityId==='fresh-produce'),{onHand:240,targetStock:10,storageCapacity:1000,reserved:0});
Object.assign(Economy.getMarketState(reliabilitySector,'MB').inventory.find(x=>x.commodityId==='fresh-produce'),{onHand:0,targetStock:80,storageCapacity:1000,reserved:0});
Object.assign(Economy.getMarketState(reliabilitySector,'MC').inventory.find(x=>x.commodityId==='fresh-produce'),{onHand:240,targetStock:10,storageCapacity:1000,reserved:0});
const unreliableRival=Contracts.create(reliabilitySector,{name:'Unreliable low-price rival',originMarketId:'MC',destinationMarketId:'MB',commodityId:'fresh-produce',quantityPerTurn:12,unitPriceCr:80,startTurn:1,endTurn:6,priority:'high',status:'active',ownerCorporationId:'CORP-2'},0);
assert.equal(unreliableRival.ok,true);
unreliableRival.contract.history=[1,2,3,4].map(turn=>({turn,quantity:12,delivered:4,lost:3}));
const reliabilityResult=Strategy.advanceTurn(reliabilitySector,1);
const reliabilityReport=reliabilityResult.corporateReports.find(x=>x.corporationId==='CORP-1');
assert.ok(reliabilityReport.competition.bestCompetitorPrice>80,'A poor delivery record should make a low nominal quote less competitive on an expected-delivered-unit basis.');
assert.ok(Contracts.getContracts(reliabilitySector).some(x=>x.ownerCorporationId==='CORP-1'&&x.originMarketId==='MA'&&x.destinationMarketId==='MB'&&x.commodityId==='fresh-produce'),'A more reliable offer may win despite a higher nominal quote.');

// Pending ceasefire and peace proposals expire after three full response
// turns, allowing a fresh proposal even when the other participant never acts.
const proposalExpirySector=makeSector('Proposal expiry fixture');
proposalExpirySector.factionTurn=1;
proposalExpirySector.simulation.clock.turn=1;
const expiryWar=Politics.declareWar(proposalExpirySector,{type:'faction',id:'F1'},{type:'faction',id:'F2'});
const firstCeasefire=Politics.proposeCeasefire(proposalExpirySector,expiryWar.id,{type:'faction',id:'F1'});
Politics.advanceTurn(proposalExpirySector,1);
assert.equal(firstCeasefire.proposal.expiresTurn,4);
let expiryTurnResult;
for(let turn=2;turn<=5;turn++) {
  proposalExpirySector.factionTurn=turn;
  proposalExpirySector.simulation.clock.turn=turn;
  expiryTurnResult=Politics.advanceTurn(proposalExpirySector,turn);
}
assert.equal(expiryWar.ceasefireProposal.status,'expired','An unanswered ceasefire proposal must expire.');
assert.equal(expiryTurnResult.expiredProposals,1,'The turn result must report the expired proposal.');
assert.throws(()=>Politics.respondToCeasefire(proposalExpirySector,expiryWar.id,'accept',{type:'faction',id:'F2'}),
  /No pending ceasefire proposal/,'An expired ceasefire proposal must no longer accept a response.');
const replacementCeasefire=Politics.proposeCeasefire(proposalExpirySector,expiryWar.id,{type:'faction',id:'F1'});
assert.equal(replacementCeasefire.ok,true,'An expired proposal must not block a replacement proposal.');

const peaceExpirySector=makeSector('Peace proposal expiry fixture');
peaceExpirySector.factionTurn=1; peaceExpirySector.simulation.clock.turn=1;
const peaceWar=Politics.declareWar(peaceExpirySector,{type:'faction',id:'F1'},{type:'faction',id:'F2'});
Politics.declareCeasefire(peaceExpirySector,peaceWar.id,{untilTurn:20});
Politics.advanceTurn(peaceExpirySector,1);
for(let turn=2;turn<=3;turn++) {
  peaceExpirySector.factionTurn=turn; peaceExpirySector.simulation.clock.turn=turn;
  Politics.advanceTurn(peaceExpirySector,turn);
}
const firstPeace=Politics.proposePeace(peaceExpirySector,peaceWar.id,{type:'faction',id:'F1'});
assert.equal(firstPeace.proposal.expiresTurn,6);
for(let turn=4;turn<=7;turn++) {
  peaceExpirySector.factionTurn=turn; peaceExpirySector.simulation.clock.turn=turn;
  expiryTurnResult=Politics.advanceTurn(peaceExpirySector,turn);
}
assert.equal(peaceWar.peaceProposal.status,'expired','An unanswered peace proposal must expire.');
assert.equal(expiryTurnResult.expiredProposals,1);
assert.throws(()=>Politics.respondToPeace(peaceExpirySector,peaceWar.id,'accept',{type:'faction',id:'F2'}),
  /No pending peace proposal/,'An expired peace proposal must no longer accept a response.');
assert.equal(Politics.proposePeace(peaceExpirySector,peaceWar.id,{type:'faction',id:'F1'}).ok,true,
  'An expired peace proposal must not block a replacement proposal.');

// 6. Recovery snapshots are stored per campaign; the latest pointer is merely
// a convenience index and deleting one campaign preserves the others.
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
class FakeDatabase {
  constructor() { this.data = new Map(); this.objectStoreNames = {contains:()=>true}; this.closed=false; }
  transaction() {
    if(this.closed){const error=new Error('Database connection is closed');error.name='InvalidStateError';throw error;}
    const db=this; let pending=0,started=false,completed=false;
    const tx={error:null};
    function maybeComplete() { if(started&&pending===0&&!completed){completed=true;setTimeout(()=>tx.oncomplete&&tx.oncomplete({target:tx}),0);} }
    const store={
      get(key) { const request={}; pending++; setTimeout(()=>{request.result=clone(db.data.get(key));if(request.onsuccess)request.onsuccess({target:request});pending--;maybeComplete();},0);return request; },
      put(record) { const request={}; pending++; setTimeout(()=>{db.data.set(record.id,clone(record));request.result=record.id;if(request.onsuccess)request.onsuccess({target:request});pending--;maybeComplete();},0);return request; },
      delete(key) { const request={}; pending++; setTimeout(()=>{db.data.delete(key);if(request.onsuccess)request.onsuccess({target:request});pending--;maybeComplete();},0);return request; },
      getAll() { const request={}; pending++; setTimeout(()=>{request.result=Array.from(db.data.values()).map(clone);if(request.onsuccess)request.onsuccess({target:request});pending--;maybeComplete();},0);return request; }
    };
    tx.objectStore=()=>store;
    setTimeout(()=>{started=true;maybeComplete();},0);
    return tx;
  }
  close() { this.closed=true; }
}
let fakeDb=new FakeDatabase(), recoveryOpenCount=0;
const fakeElements=new Map();
const documentStub={getElementById(id){if(!fakeElements.has(id))fakeElements.set(id,{disabled:false,textContent:'',dataset:{},classList:{add(){},remove(){}},addEventListener(){}});return fakeElements.get(id);}};
const recoveryContext=vm.createContext({
  App:{VERSION:'1.3.10.2',currentSector:null}, Date, Math, JSON, String, Number, Object, Array, Promise, Blob,
  document:documentStub, window:{indexedDB:{open(){recoveryOpenCount++;if(fakeDb.closed)fakeDb=new FakeDatabase();const request={result:fakeDb};setTimeout(()=>{if(request.onsuccess)request.onsuccess({target:request});},0);return request;}}},
  SectorSimulation:{ensureRecoveryIdentity(sector){sector.simulation=sector.simulation||{};sector.simulation.recovery=sector.simulation.recovery||{};return sector.simulation.recovery.campaignId||(sector.simulation.recovery.campaignId='SF-CAMPAIGN-'+sector.name.replace(/[^A-Za-z0-9_-]/g,''));}}
});
const appSource=read('app.js');
const recoveryStart=appSource.indexOf("App.RECOVERY_DB_NAME =");
const recoveryEnd=appSource.indexOf("App.persistSector = function",recoveryStart);
assert.ok(recoveryStart>=0&&recoveryEnd>recoveryStart,'Could not isolate campaign recovery implementation.');
vm.runInContext(appSource.slice(recoveryStart,recoveryEnd),recoveryContext,{filename:'app-recovery-1.3.10.js'});
const RecoveryApp=recoveryContext.App;
(async function verifyRecoveryIsolation(){
  const alpha={name:'Campaign Alpha',gmMode:true,systems:[{id:'A'}],simulation:{recovery:{campaignId:'SF-CAMPAIGN-ALPHA'}}};
  const beta={name:'Campaign Beta',gmMode:true,systems:[{id:'B'}],simulation:{recovery:{campaignId:'SF-CAMPAIGN-BETA'}}};
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(alpha,'test-alpha')).ok,true);
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(beta,'test-beta')).ok,true);
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-ALPHA')).sector.name,'Campaign Alpha');
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-BETA')).sector.name,'Campaign Beta');
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot()).sector.name,'Campaign Beta','The latest pointer should resolve to the newest independent campaign snapshot.');
  alpha.revision=2;
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(alpha,'updated-alpha')).ok,true);
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-ALPHA')).sector.revision,2);
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot()).sector.name,'Campaign Alpha');
  await RecoveryApp.clearLocalRecoverySnapshot(alpha);
  assert.equal(await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-ALPHA'),null,'Clearing Alpha must remove only Alpha.');
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-BETA')).sector.name,'Campaign Beta','Clearing Alpha must not delete Beta.');
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot()).sector.name,'Campaign Beta','The latest pointer must promote the surviving campaign.');
  await RecoveryApp.clearLocalRecoverySnapshot(beta);
  assert.equal(await RecoveryApp.getLocalRecoverySnapshot('SF-CAMPAIGN-BETA'),null);
  assert.equal(await RecoveryApp.getLocalRecoverySnapshot(),null);
  // Two distinct campaigns can share an identical map fingerprint. Keyed
  // snapshots must never be returned or deleted through legacy matching.
  function twinCampaign(id) {
    return {name:'Twin Map Campaign',gmMode:true,grid:{columns:6,rows:7},
      systems:[{id:'TWIN-SYS',name:'Twin System',x:2,y:3}],
      simulation:{recovery:{campaignId:id}}};
  }
  const twinX=twinCampaign('TWIN-CAMPAIGN-X'), twinY=twinCampaign('TWIN-CAMPAIGN-Y'), twinZ=twinCampaign('TWIN-CAMPAIGN-Z');
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(twinX,'twin-x')).ok,true);
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(twinY,'twin-y')).ok,true);
  assert.equal(await RecoveryApp.getLocalRecoverySnapshot(twinZ),null,
    'A campaign without its own snapshot must not be offered another campaign’s same-map snapshot.');
  await RecoveryApp.clearLocalRecoverySnapshot(twinY);
  assert.equal((await RecoveryApp.getLocalRecoverySnapshot(twinX)).sector.simulation.recovery.campaignId,'TWIN-CAMPAIGN-X',
    'Deleting a same-map campaign must leave the requested campaign’s snapshot intact.');
  assert.equal(await RecoveryApp.getLocalRecoverySnapshot(twinY),null,
    'Deleting the requested same-map campaign must remove its own snapshot.');
  // Match old 1.3.9-style records by stable map fingerprint even when IDs differ.
  const legacySector={name:'Legacy Campaign',gmMode:true,grid:{columns:6,rows:7},systems:[{id:'LEG-SYS',name:'Legacy System',x:2,y:3}]};
  const legacySaved={name:'Legacy Campaign',grid:{columns:6,rows:7},systems:[{id:'LEG-SYS',name:'Legacy System',x:2,y:3}]};
  fakeDb.data.set('legacy:old-campaign',{id:'legacy:old-campaign',sequence:77,savedAt:new Date().toISOString(),sectorName:'Legacy Campaign',sector:legacySaved});
  const matchedLegacy=await RecoveryApp.getLocalRecoverySnapshot(legacySector);
  assert.equal(matchedLegacy.id,'legacy:old-campaign','Pre-identity snapshots should be discoverable using the map fingerprint.');
  await RecoveryApp.clearLocalRecoverySnapshot(legacySector);
  assert.equal(fakeDb.data.has('legacy:old-campaign'),false,'Clearing a legacy snapshot should remove the fingerprint-matched record.');
  // A connection closed by the browser must be discarded and reopened without a page reload.
  const oldOpenCount=recoveryOpenCount;
  RecoveryApp._recoveryDbInstance.close();
  await RecoveryApp.openRecoveryDatabase();
  assert.ok(recoveryOpenCount>oldOpenCount,'A closed cached connection should trigger a new IndexedDB open.');
  assert.equal((await RecoveryApp.saveLocalRecoverySnapshot(alpha,'after-reopen')).ok,true,'Recovery should be usable after its connection is reopened.');
  console.log('PASS: 1.3.10.2 maintenance — bounded archives, bilateral ceasefire/peace proposals, treaty cooldowns, legacy recovery matching and IndexedDB reconnect.');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
