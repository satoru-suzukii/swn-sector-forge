#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp,
  Error, TypeError, RangeError, parseInt, parseFloat
});
context.CampaignTools = {
  TRADE_GOODS:[
    {name:'Fresh produce',category:'Agricultural',basePrice:120},
    {name:'Medical compounds',category:'Medical',basePrice:1600},
    {name:'Industrial machine parts',category:'Industrial',basePrice:1100},
    {name:'Bulk water',category:'Bulk',basePrice:80}
  ],
  getDiplomaticRelation(sector,a,b) {
    return (sector.diplomacy || []).find(r =>
      (r.factionAId === a && r.factionBId === b) || (r.factionAId === b && r.factionBId === a)
    ) || null;
  }
};
const modules = [
  'simulation/trade-route-rules.js',
  'simulation/sector-simulation.js',
  'simulation/economy-engine.js',
  'simulation/settlement-engine.js',
  'simulation/trade-contract-engine.js',
  'simulation/transport-engine.js',
  'simulation/logistics-engine.js',
  'simulation/diplomacy-engine.js',
  'simulation/strategic-engine.js'
];
for (const file of modules) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), context, {filename:file});
}
const get = name => vm.runInContext(name, context);
const Sim = get('SectorSimulation');
const Economy = get('SectorEconomy');
const Settlement = get('SectorSettlement');
const Contracts = get('SectorTradeContracts');
const Transport = get('SectorTransport');
const Logistics = get('SectorLogistics');
const Strategic = get('SectorStrategic');

function makeSector(options={}) {
  const routeCapacity = options.routeCapacity == null ? 100 : options.routeCapacity;
  const sector = {
    name:'1.3.7 Strategic and Transport Test', schemaVersion:3, gmMode:true, factionTurn:0,
    seed:options.seed || 137, grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Origin',x:0,y:0,controllingFactionId:'F1',planets:[{id:'WA',name:'Origin World',population:'hundreds of millions of inhabitants',techLevel:'3',tag1:'Oceanic World',tag2:'Trade Hub'}]},
      {id:'B',name:'Relay',x:1,y:0,controllingFactionId:'F1',planets:[]},
      {id:'C',name:'Destination',x:2,y:0,controllingFactionId:'F2',planets:[{id:'WC',name:'Destination World',population:'several million inhabitants',techLevel:'5',tag1:'Heavy Industry',tag2:'Major Spaceyard'}]}
    ],
    markets:[
      {id:'MA',systemId:'A',planetId:'WA',systemName:'Origin',planetName:'Origin World',techLevel:'3',population:'hundreds of millions of inhabitants',profile:'Agrarian exporter',traits:['Oceanic World','Trade Hub'],goods:[
        {name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100},
        {name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100},
        {name:'Industrial machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100},
        {name:'Bulk water',category:'Bulk',basePrice:80,priceIndex:100,basePriceIndex:100}
      ]},
      {id:'MC',systemId:'C',planetId:'WC',systemName:'Destination',planetName:'Destination World',techLevel:'5',population:'several million inhabitants',profile:'Industrial exchange',traits:['Heavy Industry','Major Spaceyard'],goods:[
        {name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100},
        {name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100},
        {name:'Industrial machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100},
        {name:'Bulk water',category:'Bulk',basePrice:80,priceIndex:100,basePriceIndex:100}
      ]}
    ],
    factions:[
      {id:'F1',name:'Origin League',goal:'Protect our trade corridors',wealth:4,cunning:3,force:4,assets:[],factionCredits:20},
      {id:'F2',name:'Destination Authority',goal:'Defend our borders',wealth:3,cunning:3,force:3,assets:[],factionCredits:20}
    ],
    corporations:[{id:'CORP-1',name:'Farline Freight',valuation:'growing',treasuryCredits:100000}],
    corporationMarketLinks:[{id:'LINK-1',corporationId:'CORP-1',marketId:'MA'},{id:'LINK-2',corporationId:'CORP-1',marketId:'MC'}],
    diplomacy:[{id:'DIP-1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:2}],
    tradeRoutes:[
      {id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:routeCapacity,transitTurns:4,freightCostPerUnit:2,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:1},
      {id:'R2',fromSystemId:'B',toSystemId:'C',distance:1,kind:'trade',status:'Established',capacityPerTurn:routeCapacity,transitTurns:2,freightCostPerUnit:2,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:1}
    ]
  };
  Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.6'});
  Economy.initializeSector(sector);
  Settlement.initialize(sector);
  Contracts.initialize(sector);
  Logistics.initialize(sector);
  const source=Economy.getMarketState(sector,'MA');
  const destination=Economy.getMarketState(sector,'MC');
  for (const id of ['fresh-produce','medical-compounds','industrial-machine-parts','bulk-water']) {
    const a=source.inventory.find(x=>x.commodityId===id);
    const b=destination.inventory.find(x=>x.commodityId===id);
    Object.assign(a,{targetStock:10,storageCapacity:1000,onHand:0});
    Object.assign(b,{targetStock:100,storageCapacity:1000,onHand:0});
  }
  Object.assign(source.inventory.find(x=>x.commodityId==='fresh-produce'),{onHand:240,targetStock:10});
  Object.assign(destination.inventory.find(x=>x.commodityId==='fresh-produce'),{onHand:0,targetStock:80});
  if (options.corporateAutonomy === false) Strategic.setSettings(sector,{corporateAutonomy:false});
  return sector;
}

// A damaged asset defending a critical supply system should outrank generic diplomacy.
const factionSector=makeSector();
Strategic.setSettings(factionSector,{decisionNoise:0});
const originState=Economy.getMarketState(factionSector,'MA');
const criticalStock=originState.inventory.find(x=>x.commodityId==='fresh-produce');
criticalStock.onHand=0; criticalStock.targetStock=100;
const faction=factionSector.factions[0];
faction.assets=[{id:'ASSET-1',name:'Corridor Defence Base',locationSystemId:'A',hp:1,maxHp:10,isBase:true,income:2,active:true}];
const decisionContext={
  damaged:faction.assets.slice(), attacks:[],
  buyable:[], expandableSystems:[], incomeAssets:[]
};
const repairDecision=Strategic.chooseFactionAction(factionSector,faction,1,decisionContext,Sim.createRandomStream(factionSector,{turn:1,phase:'strategic-ai',scope:'faction:F1'}));
assert.equal(repairDecision.action,'repair','AI should prioritize a damaged base protecting a critically undersupplied system.');
assert.equal(repairDecision.targets.repairAssetId,'ASSET-1');
assert.match(repairDecision.reason,/damage|income|base|system/i);
assert.ok(repairDecision.confidence>=0&&repairDecision.confidence<=1);
assert.ok(repairDecision.risk>=0&&repairDecision.risk<=1);
assert.ok(repairDecision.alternatives.length>0,'Decision records should retain credible alternatives.');

// Target selection and noise are deterministic for the same sector/turn/scope stream.
Strategic.setSettings(factionSector,{decisionNoise:0.25});
const streamA=Sim.createRandomStream(factionSector,{turn:7,phase:'strategic-ai',scope:'faction:F1'});
const streamB=Sim.createRandomStream(factionSector,{turn:7,phase:'strategic-ai',scope:'faction:F1'});
const deterministicA=Strategic.chooseFactionAction(factionSector,faction,7,decisionContext,streamA);
const deterministicB=Strategic.chooseFactionAction(factionSector,faction,7,decisionContext,streamB);
assert.equal(deterministicA.action,deterministicB.action);
assert.equal(deterministicA.score,deterministicB.score);
assert.deepEqual(JSON.parse(JSON.stringify(deterministicA.targets)),JSON.parse(JSON.stringify(deterministicB.targets)));

// The bounded imperfection can choose a close second-best option, but never an unavailable action.
const uncertainSector=makeSector({seed:77137});
Strategic.setSettings(uncertainSector,{decisionNoise:0.5});
const uncertainFaction=uncertainSector.factions[0];
const closeContext={damaged:[{id:'SCRATCHED',name:'Minor patrol asset',locationSystemId:'B',hp:9,maxHp:10,income:0,active:true}],attacks:[],buyable:[],expandableSystems:[],incomeAssets:[]};
let sawNearMiss=false;
for(let turn=1;turn<=160;turn++){
  const result=Strategic.chooseFactionAction(uncertainSector,uncertainFaction,turn,closeContext,Sim.createRandomStream(uncertainSector,{turn,phase:'strategic-ai',scope:'faction:F1'}));
  assert.ok(['repair','diplomacy'].includes(result.action),'AI must never select an unavailable action.');
  if(result.imperfection.indexOf('close alternative')>=0)sawNearMiss=true;
}
assert.ok(sawNearMiss,'Bounded uncertainty should occasionally select a close alternative rather than behave as a perfect optimiser.');

// GM autonomy controls override the actor; alliances are not casually attacked.
const allianceSector=makeSector();
Strategic.setSettings(allianceSector,{decisionNoise:0});
allianceSector.diplomacy[0].state='Alliance';
const allianceAttack=Strategic.chooseFactionAction(allianceSector,allianceSector.factions[0],1,{attacks:[{asset:{id:'OWN'},defender:{id:'F2'},target:{id:'TARGET',income:10}}],damaged:[],buyable:[],expandableSystems:[],incomeAssets:[]},Sim.createRandomStream(allianceSector,{turn:1,phase:'strategic-ai',scope:'alliance-check'}));
assert.notEqual(allianceAttack.action,'attack','Alliance relationship should strongly suppress an attack even if a candidate is supplied.');
Strategic.setSettings(allianceSector,{factionAutonomy:false});
assert.equal(Strategic.chooseFactionAction(allianceSector,allianceSector.factions[0],2,decisionContext,Sim.createRandomStream(allianceSector,{turn:2,phase:'strategic-ai',scope:'manual-check'})),null,'GM can turn off faction autonomy.');
allianceSector.factions[0].manualStrategicControl=true;
Strategic.setSettings(allianceSector,{factionAutonomy:true});
assert.equal(Strategic.chooseFactionAction(allianceSector,allianceSector.factions[0],2,decisionContext,Sim.createRandomStream(allianceSector,{turn:2,phase:'strategic-ai',scope:'manual-lock'})),null,'Faction-level manual control overrides global autonomy.');

// Corporate intelligence identifies a real surplus-to-shortage opportunity and creates a priced agreement.
const corporateSector=makeSector();
const corporateReport=Strategic.advanceTurn(corporateSector,1);
assert.equal(corporateReport.ok,true);
const negotiated=Contracts.getContracts(corporateSector).find(c=>c.source==='corporate-ai'&&c.ownerCorporationId==='CORP-1');
assert.ok(negotiated,'An autonomous corporation should negotiate when linked markets have reachable surplus and unmet demand.');
assert.equal(negotiated.status,'active');
assert.equal(negotiated.startTurn,2,'A newly negotiated agreement should not dispatch retroactively in the turn it was created.');
assert.ok(negotiated.unitPriceCr>0);
assert.ok(negotiated.quantityPerTurn>0);
assert.equal(corporateReport.corporateReports[0].decision.action,'negotiate-supply-contract');
assert.ok(Strategic.getDecisionHistory(corporateSector).some(d=>d.kind==='corporation'&&d.decision==='negotiate-supply-contract'));
assert.equal(Strategic.validate(corporateSector).ok,true);
assert.equal(Contracts.validate(corporateSector).ok,true);

// Repeated contract failure can trigger a pause; capital-heavy capacity delay can trigger fleet investment.
const fleetSector=makeSector();
const fleetContract=Contracts.create(fleetSector,{name:'Farline grain agreement',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:10,unitPriceCr:135,startTurn:1,endTurn:6,priority:'high',status:'active'},0);
assert.equal(fleetContract.ok,true);
fleetContract.contract.ownerCorporationId='CORP-1';
fleetContract.contract.source='corporate-ai';
Economy.getMarketState(fleetSector,'MA').inventory.forEach(x=>{if(x.commodityId!=='fresh-produce'){x.onHand=0;x.targetStock=100;}});
fleetSector.simulation.economy.logistics.shipments.push({id:'SHIP-WAITING',contractId:fleetContract.contract.id,status:'awaiting-capacity',routeIds:['R1'],currentLegIndex:0,currentSystemId:'A',originSystemId:'A',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantity:10,remainingQuantity:10,legs:[]});
const fleetDecision=Strategic.advanceTurn(fleetSector,1).corporateReports[0].decision;
assert.equal(fleetDecision.action,'expand-transport-fleet','A well-capitalized company should invest in capacity when its contracted cargo repeatedly waits for space.');
const purchasedFleet=Transport.getFleets(fleetSector).find(f=>f.source==='corporate-ai');
assert.ok(purchasedFleet);
assert.equal(purchasedFleet.readyOnTurn,2,'New corporate capacity is commissioned for the following turn.');
assert.ok(purchasedFleet.assignments.some(a=>a.routeId==='R1'));
const corpAccount=Settlement.getAccounts(fleetSector).find(a=>a.ownerType==='corporation'&&a.ownerId==='CORP-1');
assert.ok(corpAccount.balance<100000,'Fleet purchase must debit the corporation account.');
assert.ok(Settlement.getLedger(fleetSector).some(tx=>tx.type==='fleet-purchase'));

// Ports preserve legacy abstract route capacity; fleets add throughput, speed, reliability and costs.
const transportSector=makeSector({corporateAutonomy:false});
const route=transportSector.tradeRoutes[0];
const fromPort=Transport.getPorts(transportSector).find(p=>p.systemId==='A');
const relayPort=Transport.getPorts(transportSector).find(p=>p.systemId==='B');
assert.ok(fromPort&&relayPort,'Every market/route endpoint receives a persistent spaceport.');
assert.ok(fromPort.handlingCapacityPerTurn>=route.capacityPerTurn);
const legacyProfile=Logistics.getRouteProfile(route,transportSector);
assert.equal(legacyProfile.capacityPerTurn,100,'A no-fleet route must retain its abstract baseline capacity.');
fromPort.handlingCapacityPerTurn=400; relayPort.handlingCapacityPerTurn=400;
fromPort.maintenanceCrPerTurn=0; relayPort.maintenanceCrPerTurn=0;
const beforeTotals=Settlement.getAccounts(transportSector).reduce((n,a)=>n+Number(a.balance||0),0);
const purchase=Transport.createFleet(transportSector,{name:'Farline Test Flotilla',type:'Merchant flotilla',ownerType:'corporation',ownerId:'CORP-1',homeSystemId:'A',capacityPerTurn:60,speed:2,reliability:30,condition:100,operatingCostCrPerTurn:350,maintenanceCrPerTurn:100,variableCostPerCargoUnit:0.08,purchaseCostCr:5000},0,{source:'manual'});
assert.equal(purchase.ok,true,purchase.reason);
assert.equal(Transport.assignFleetToRoute(transportSector,purchase.fleet.id,'R1',100).ok,true);
assert.equal(Transport.assignFleetToRoute(transportSector,purchase.fleet.id,'R2',20).ok,false,'Fleet route allocations cannot exceed 100% of capacity.');
const priorOwner={type:purchase.fleet.ownerType,id:purchase.fleet.ownerId};
const invalidOwnerUpdate=Transport.updateFleet(transportSector,purchase.fleet.id,{ownerType:'faction',ownerId:'FACTION-NOT-REAL'});
assert.equal(invalidOwnerUpdate.ok,false,'Fleet editing must reject nonexistent faction owners.');
assert.equal(purchase.fleet.ownerType,priorOwner.type);assert.equal(purchase.fleet.ownerId,priorOwner.id,'Invalid fleet edits must not partially mutate ownership.');
assert.equal(Transport.updateFleet(transportSector,purchase.fleet.id,{ownerType:'service',ownerId:'INTERSTELLAR-GUILD'}).ok,true,'A service operator can own a fleet.');
assert.equal(Transport.updateFleet(transportSector,purchase.fleet.id,{ownerType:'corporation',ownerId:'CORP-1'}).ok,true,'A fleet can be reassigned to a corporation.');
const modifiedProfile=Logistics.getRouteProfile(route,transportSector);
assert.equal(modifiedProfile.capacityPerTurn,160,'Fleet cargo capacity should add to abstract route capacity when ports can handle it.');
assert.equal(modifiedProfile.transitTurns,2,'Fleet speed should shorten travel time.');
assert.ok(modifiedProfile.riskPercent>route.riskPercent,'Lower fleet reliability should raise route incident risk.');
assert.ok(modifiedProfile.operatingCostPerUnit>route.operatingCostPerUnit);
fromPort.status='closed';
assert.equal(Logistics.getRouteProfile(route,transportSector).capacityPerTurn,0,'A closed port should disable cargo movement across its attached route.');
fromPort.status='operational';

// Operating charges are recurring, idempotent, and balanced across accounts.
const recurring=Transport.advanceTurn(transportSector,1);
assert.equal(recurring.ok,true);
assert.ok(recurring.charged>=1);
const fleetCharge=Settlement.getLedger(transportSector).find(tx=>tx.type==='transport-maintenance'&&tx.memo.includes('Farline Test Flotilla'));
assert.ok(fleetCharge,'Fleet operating and maintenance costs must settle through the financial ledger.');
const ledgerCount=Settlement.getLedger(transportSector).length;
assert.equal(Transport.advanceTurn(transportSector,1).skipped,true);
assert.equal(Settlement.getLedger(transportSector).length,ledgerCount,'Repeated transport turn calls cannot double-charge recurring costs.');
const afterTotals=Settlement.getAccounts(transportSector).reduce((n,a)=>n+Number(a.balance||0),0);
assert.ok(Math.abs(afterTotals-beforeTotals)<0.011,'Fleet purchase and recurring costs must conserve total account balances.');
assert.equal(Transport.validate(transportSector).ok,true,JSON.stringify(Transport.validate(transportSector).errors));
assert.equal(Settlement.validate(transportSector).ok,true,JSON.stringify(Settlement.validate(transportSector).errors));

// GM save/load must preserve transport, AI configuration, and decision history.
const saved=JSON.parse(JSON.stringify(transportSector));
Sim.migrateSector(saved,{sourceApplicationVersion:'1.3.7'});
assert.equal(Transport.validate(saved).ok,true,JSON.stringify(Transport.validate(saved).errors));
const transportLedgerCount=transportSector.simulation.transport.ledger.length;
assert.equal(SavedSettings(saved),true);
function SavedSettings(value){return value.simulation.settings.strategicAI.corporateAutonomy===false&&value.simulation.transport.fleets.length===1&&value.simulation.transport.ledger.length===transportLedgerCount;}

console.log('PASS: 1.3.7 strategic actors and transport — condition-driven faction decisions, goal/threat/diplomacy scoring, deterministic bounded imperfection, GM autonomy locks, corporate market opportunity selection, automatic supply contracts, fleet investment, persistent ports/fleets, capacity/speed/reliability/operating-cost integration, recurring settlement idempotency, and GM save round-trip.');
