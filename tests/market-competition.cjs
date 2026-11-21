'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({console,Math,JSON,Number,String,Boolean,Array,Object,Map,Set,Date,RegExp,Error,TypeError,RangeError,parseInt,parseFloat});
context.CampaignTools={
  TRADE_GOODS:[{name:'Food',category:'Food',basePrice:100}],
  getDiplomaticRelation(s,a,b){return (s.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;},
  recordFactionTurn(){},recalculateInfluence(){},linkCampaignRecords(){},updateMarkets(){}
};
[
 'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
 'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
 'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const get=name=>vm.runInContext(name,context),Sim=get('SectorSimulation'),Economy=get('SectorEconomy'),Logistics=get('SectorLogistics'),Politics=get('SectorPolitics');
const sector={name:'Network Competition Test',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:10,rows:12},
 systems:[
  {id:'A',name:'Aster',x:0,y:0,polityId:'P1',controllingFactionId:'F1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'3',tag1:'Oceanic World'}]},
  {id:'B',name:'Boreal',x:1,y:0,polityId:'P2',controllingFactionId:'F2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Heavy Industry'}]},
  {id:'C',name:'Cygnus',x:0,y:1,polityId:'P3',controllingFactionId:'F3',planets:[{id:'WC',name:'Cygnus Prime',population:'several million inhabitants',techLevel:'4',tag1:'Industrial Exchange'}]}
 ],
 markets:[
  {id:'MA',systemId:'A',planetId:'WA',planetName:'Aster Prime',population:'several million inhabitants',techLevel:'3',profile:'Agrarian exporter',traits:['Oceanic World'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:50,basePriceIndex:100}]},
  {id:'MB',systemId:'B',planetId:'WB',planetName:'Boreal Prime',population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Heavy Industry'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:150,basePriceIndex:100}]},
  {id:'MC',systemId:'C',planetId:'WC',planetName:'Cygnus Prime',population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Heavy Industry'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100,basePriceIndex:100}]}
 ],
 factions:[{id:'F1',name:'Aster League',assets:[],wealth:4},{id:'F2',name:'Boreal Compact',assets:[],wealth:4},{id:'F3',name:'Cygnus Authority',assets:[],wealth:4}],
 polities:[{id:'P1',name:'Aster Polity',relations:[]},{id:'P2',name:'Boreal Polity',relations:[]},{id:'P3',name:'Cygnus Polity',relations:[]}],
 diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:0}],
 tradeRoutes:[
  {id:'R-AB',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,riskPercent:0},
  {id:'R-AC',fromSystemId:'A',toSystemId:'C',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,riskPercent:0}
 ]
};
Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.7'});Politics.initialize(sector);Economy.initializeSector(sector);
const state=id=>Economy.getMarketState(sector,id),line=(id)=>state(id).inventory.find(x=>x.commodityId==='food'),price=id=>state(id).prices.find(x=>x.commodityId==='food');
[['MA',240,10,50],['MB',0,100,150],['MC',0,60,100]].forEach(([id,onHand,target,index])=>{const stock=line(id);stock.onHand=onHand;stock.reserved=0;stock.targetStock=target;const production=state(id).production.find(x=>x.commodityId==='food');if(production)production.quantityPerTurn=0;const consumption=state(id).consumption.find(x=>x.commodityId==='food');if(consumption)consumption.quantityPerTurn=0;price(id).currentPriceIndex=index;price(id).referencePriceIndex=100;});
// A shipment already in transit is a probability/time-weighted future supply signal,
// not stock on hand and not an immediate delivery.
Logistics.getShipments(sector).push({id:'SHIP-FORECAST',commodityId:'food',originMarketId:'MA',destinationMarketId:'MC',originSystemId:'A',destinationSystemId:'C',currentSystemId:'A',routeIds:['R-AC'],currentLegIndex:0,legs:[{routeId:'R-AC',fromSystemId:'A',toSystemId:'C',departedTurn:0,arrivalTurn:3,status:'in-transit',cargoUnits:50,operatingCost:0}],status:'in-transit',quantity:50,remainingQuantity:50,deliveredQuantity:0,estimatedArrivalTurn:3,riskPercent:20,saleUnitPriceCr:100,createdTurn:0});
assert.equal(Logistics.getPath(sector,'A','B','food').reachable,true);
const result=Economy.advanceTurn(sector,1);
assert.equal(result.ok,true);
const competition=price('MB').networkCompetition;
assert.ok(competition.importDiscount>0,'A reachable lower-landed-cost supplier should reduce the destination market price target.');
assert.equal(competition.bestSupplierMarketId,'MA');
assert.ok(competition.expectedInbound>20,'The forecast must include probability/time-weighted arrivals at competitor markets.');
const marketLedger=state('MB').ledger.find(x=>x.turn===1);
const foodLine=marketLedger.lines.find(x=>x.commodityId==='food');
assert.equal(foodLine.competitorMarketId,'MA');
assert.ok(foodLine.competitionDiscount>0);
assert.ok(foodLine.expectedInboundFromNetwork>20);
// A future-dated blockade is inactive now, then suppresses the supplier signal
// once its war declaration becomes effective on the next turn.
const war=Politics.declareWar(sector,{type:'faction',id:'F1'},{type:'faction',id:'F2'},{blockadeSystemIds:['B']});
assert.equal(Logistics.getPath(sector,'A','B','food').reachable,true,'A future-dated blockade must not block the current committed turn.');
sector.factionTurn=2;Sim.syncLegacyTurn(sector);
assert.equal(Logistics.getPath(sector,'A','B','food').reachable,false,'The effective blockade must remove the route from trade pathfinding.');
assert.ok(war.blockadeSystemIds.includes('B'));
assert.equal(Politics.validate(sector).ok,true);
console.log('PASS: 1.3.8 network competition — reachable landed-cost supplier pricing, bounded market competition, risk/ETA-weighted inbound forecasts, market ledger explanations, and future-dated political blockade affecting logistics pathfinding.');
