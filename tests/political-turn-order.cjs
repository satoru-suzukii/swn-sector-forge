#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console,Date,Math,Map,Set,Object,Array,String,Number,JSON,RegExp,Error,TypeError,RangeError,parseInt,parseFloat});
context.CampaignTools = {
  TRADE_GOODS:[
    {name:'Food',category:'Food',basePrice:100},
    {name:'Medical compounds',category:'Medical',basePrice:500}
  ],
  getDiplomaticRelation(sector,a,b){return (sector.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;}
};
[
  'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
  'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
  'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js',
  'simulation/strategic-engine.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const get=name=>vm.runInContext(name,context);
const Sim=get('SectorSimulation'), Economy=get('SectorEconomy'), Logistics=get('SectorLogistics');
const Politics=get('SectorPolitics');

function makeSector(name) {
  const sector={
    name, schemaVersion:3, gmMode:true, factionTurn:0, grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Aster',x:0,y:0,controllingFactionId:'F1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'3',tag1:'Oceanic World'}]},
      {id:'B',name:'Boreal',x:1,y:0,controllingFactionId:'F2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Heavy Industry'}]}
    ],
    markets:[
      {id:'MA',systemId:'A',planetId:'WA',planetName:'Aster Prime',systemName:'Aster',population:'several million inhabitants',techLevel:'3',profile:'Agrarian exporter',traits:['Oceanic World'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]},
      {id:'MB',systemId:'B',planetId:'WB',planetName:'Boreal Prime',systemName:'Boreal',population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Heavy Industry'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]}
    ],
    factions:[{id:'F1',name:'Aster League',factionCredits:1000,assets:[]},{id:'F2',name:'Boreal Compact',factionCredits:1000,assets:[]}],
    polities:[],
    diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:1}],
    tradeRoutes:[{id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0}]
  };
  Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.10.2'});
  Politics.initialize(sector);
  Economy.initializeSector(sector);
  for (const state of sector.simulation.economy.marketStates) {
    state.production.forEach(line=>line.quantityPerTurn=0);
    state.consumption.forEach(line=>line.quantityPerTurn=0);
    state.inventory.forEach(stock=>{stock.onHand=stock.targetStock;stock.reserved=0;});
  }
  return sector;
}
function setFoodTradeNeed(sector) {
  const origin=Economy.getMarketState(sector,'MA');
  const destination=Economy.getMarketState(sector,'MB');
  const a=origin.inventory.find(item=>item.commodityId==='food');
  const b=destination.inventory.find(item=>item.commodityId==='food');
  assert.ok(a&&b,'food stock accounts must exist in both markets');
  a.onHand=100; a.targetStock=10; a.storageCapacity=500;
  b.onHand=0; b.targetStock=100; b.storageCapacity=500;
}
function advance(sector,turn) {
  sector.factionTurn=turn;
  Sim.syncLegacyTurn(sector);
  const result=Economy.advanceTurn(sector,turn);
  assert.equal(result.ok,true);
  return result;
}

// Ceasefire expires before turn-three competition and dispatch. Warm the
// exact same-turn path cache first to prove that political transitions evict it.
const expired=makeSector('Ceasefire cache invalidation integration');
const expiringWar=Politics.declareWar(expired,{type:'faction',id:'F1'},{type:'faction',id:'F2'});
advance(expired,1);
Politics.declareCeasefire(expired,expiringWar.id,{untilTurn:2});
advance(expired,2);
setFoodTradeNeed(expired);
expired.factionTurn=3; Sim.syncLegacyTurn(expired);
const staleCeasefirePath=Logistics.getPath(expired,'A','B','food');
assert.equal(staleCeasefirePath.reachable,true,'the ceasefire corridor should be reachable immediately before expiry processing');
assert.ok(staleCeasefirePath.riskPercent>0,'the pre-expiry path should contain ceasefire risk');
assert.ok(Logistics.getPathCacheStats(expired).graphs>0,'the regression must begin with a warmed path graph');
const expiryTurn=Economy.advanceTurn(expired,3);
assert.equal(expiringWar.status,'active','the expired ceasefire must become active war at the start of turn three');
assert.equal(expiryTurn.politics.tradeAccessChanged,true,'the political coordinator must report an access-changing transition');
assert.equal(Logistics.getPath(expired,'A','B','food').reachable,false,'the warmed ceasefire graph must not survive ceasefire expiry');
assert.equal(expiryTurn.logistics.dispatch.dispatched,0,'no new shipment may be dispatched through the resumed-war border');
assert.equal(Logistics.validate(expired).ok,true,'logistics state remains valid after the political transition');

// Peace becomes effective before pricing and dispatch. A path cached under
// ceasefire restrictions must be recalculated with the peace terms in force.
const peace=makeSector('Peace settlement cache invalidation integration');
const peaceWar=Politics.declareWar(peace,{type:'faction',id:'F1'},{type:'faction',id:'F2'});
advance(peace,1);
Politics.declareCeasefire(peace,peaceWar.id,{untilTurn:6});
advance(peace,2);
Politics.makePeace(peace,peaceWar.id,{settlement:'Border accord'});
setFoodTradeNeed(peace);
peace.factionTurn=3; Sim.syncLegacyTurn(peace);
const ceasefirePath=Logistics.getPath(peace,'A','B','food');
assert.equal(ceasefirePath.reachable,true);
assert.ok(ceasefirePath.riskPercent>0,'ceasefire path risk should be present before peace effective turn');
assert.ok(ceasefirePath.tariffCostPerUnit>0,'ceasefire path tariff should be present before peace effective turn');
const peaceTurn=Economy.advanceTurn(peace,3);
assert.equal(peaceWar.status,'peace','the peace settlement must become effective at the start of its target turn');
assert.equal(peaceTurn.politics.tradeAccessChanged,true);
const peacefulPath=Logistics.getPath(peace,'A','B','food');
assert.equal(peacefulPath.reachable,true,'peace must preserve route reachability');
assert.ok(peacefulPath.riskPercent<ceasefirePath.riskPercent,'the old ceasefire risk must not remain cached after peace');
assert.ok(peacefulPath.tariffCostPerUnit<ceasefirePath.tariffCostPerUnit,'the old ceasefire tariff must not remain cached after peace');
assert.equal(Logistics.validate(peace).ok,true);

console.log('PASS 1.3.11 political/logistics turn-order integration: ceasefire expiry blocks dispatch on the effective turn; peace settlement clears warmed ceasefire risk/tariff paths; both transitions invalidate runtime route caches.');
