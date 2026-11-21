'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({console,Date,Math,Map,Set,Object,Array,String,Number,Boolean,JSON,RegExp,Error,TypeError,RangeError,parseInt,parseFloat});
context.CampaignTools={
  TRADE_GOODS:[{name:'Medical compounds',category:'Medical',basePrice:500}],
  getDiplomaticRelation(s,a,b){return (s.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;},
  advanceFactionTurn(s){s.factionTurn=Number(s.factionTurn||0)+1;return [];},
  recordFactionTurn(){},recalculateInfluence(){},linkCampaignRecords(){},updateMarkets(){}
};
[
 'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
 'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
 'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js','simulation/strategic-engine.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const get=n=>vm.runInContext(n,context),Sim=get('SectorSimulation'),Economy=get('SectorEconomy'),Logistics=get('SectorLogistics'),Politics=get('SectorPolitics'),Strategy=get('SectorStrategic'),Settlement=get('SectorSettlement');
const sector={name:'Grey Corridor Crisis',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:8,rows:8},
 systems:[
  {id:'A',name:'Aster',x:0,y:0,controllingFactionId:'F1',polityId:'P1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'4',tag1:'Industrial World'}]},
  {id:'B',name:'Boreal',x:1,y:0,controllingFactionId:'F2',polityId:'P2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Industrial World'}]}
 ],
 markets:[
  {id:'MA',systemId:'A',planetId:'WA',planetName:'Aster Prime',systemName:'Aster',population:'several million inhabitants',techLevel:'4',profile:'Industrial exporter',traits:['Industrial World'],goods:[{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100,basePriceIndex:100}]},
  {id:'MB',systemId:'B',planetId:'WB',planetName:'Boreal Prime',systemName:'Boreal',population:'several million inhabitants',techLevel:'4',profile:'Frontier market',traits:['Industrial World'],goods:[{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100,basePriceIndex:100}]}
 ],
 factions:[
  {id:'F1',name:'Aster League',wealth:5,force:5,factionCredits:20,goal:'Protect the trade corridor',assets:[]},
  {id:'F2',name:'Boreal Authority',wealth:4,force:5,factionCredits:20,goal:'Secure supply and trade',assets:[]}
 ],
 polities:[{id:'P1',name:'Aster Compact',relations:[]},{id:'P2',name:'Boreal Union',relations:[]}],
 corporations:[{id:'CORP-1',name:'Greyline Commerce',valuation:'growing',capital:50000}],
 corporationMarketLinks:[{id:'L1',corporationId:'CORP-1',marketId:'MA'},{id:'L2',corporationId:'CORP-1',marketId:'MB'}],
 diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:0}],
 tradeRoutes:[{id:'R-AB',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:120,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0}]
};
Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.7'});Politics.initialize(sector);Economy.initializeSector(sector);Settlement.initialize(sector);Logistics.initialize(sector);
const marketState=id=>Economy.getMarketState(sector,id),food=id=>marketState(id).inventory.find(x=>x.commodityId==='medical-compounds'),rate=(id,group)=>marketState(id)[group].find(x=>x.commodityId==='medical-compounds');
food('MA').onHand=220;food('MA').targetStock=100;food('MA').storageCapacity=300;food('MA').reserved=0;
food('MB').onHand=0;food('MB').targetStock=100;food('MB').storageCapacity=300;food('MB').reserved=0;
if(rate('MA','production'))rate('MA','production').quantityPerTurn=0;rate('MA','consumption').quantityPerTurn=0;
if(rate('MB','production'))rate('MB','production').quantityPerTurn=0;rate('MB','consumption').quantityPerTurn=15;
const priceB=()=>marketState('MB').prices.find(x=>x.commodityId==='medical-compounds');
const war=Politics.declareWar(sector,{type:'faction',id:'F1'},{type:'faction',id:'F2'},{notes:'Control of the Grey Corridor'});
assert.equal(Logistics.getPath(sector,'A','B','medical-compounds').reachable,true,'A declared war is future-dated until the next campaign turn.');
const turn1=Sim.advanceCampaignTurn(sector);
assert.equal(turn1.ok,true);assert.equal(turn1.turn,1);
assert.equal(Logistics.getPath(sector,'A','B','medical-compounds').reachable,false,'The war closes the corridor when its recorded turn becomes effective.');
assert.equal(Logistics.getShipments(sector).filter(x=>x.destinationMarketId==='MB'&&x.commodityId==='medical-compounds').length,0,'No blocked shipment should be dispatched.');
assert.ok(marketState('MB').ledger.find(x=>x.turn===1).lines[0].unmetDemand>0,'The isolated destination records unmet demand.');
assert.ok(priceB().currentPriceIndex>100,'Local shortage pressure moves the price upward.');
const factionReport=Strategy.getFactionReports(sector).find(x=>x.factionId==='F2');
const corpReport=Strategy.getCorporateReports(sector).find(x=>x.corporationId==='CORP-1');
assert.ok(factionReport&&factionReport.criticalShortages>0,'The destination faction receives a critical supply assessment.');
assert.ok(corpReport&&corpReport.outlook!=='Stable','The linked commercial actor observes a disruption.');
assert.equal(sector.diplomacy[0].state,'Open conflict','The faction diplomatic record reflects the declared war.');
Politics.declareCeasefire(sector,war.id,{untilTurn:5});
const turn2=Sim.advanceCampaignTurn(sector);
assert.equal(turn2.turn,2);
assert.equal(Logistics.getPath(sector,'A','B','medical-compounds').reachable,true,'A ceasefire restores controlled, riskier route access.');
sector.diplomacy[0].tradeAccess='embargoed'; Logistics.invalidatePathCache(sector); // Mirrors App.persistSector() after a direct GM field edit.
assert.equal(Logistics.getPath(sector,'A','B','medical-compounds').reachable,false,'An explicit GM-authored faction embargo must remain authoritative during a formal ceasefire.');
delete sector.diplomacy[0].tradeAccess; Logistics.invalidatePathCache(sector); // Manual in-memory edits must invalidate before another path query.
assert.equal(Logistics.getPath(sector,'A','B','medical-compounds').reachable,true,'Removing the explicit GM embargo restores the formal ceasefire route.');
assert.ok(Logistics.getShipments(sector).some(x=>x.destinationMarketId==='MB'&&x.commodityId==='medical-compounds'),'The reopened corridor permits a replacement supply dispatch.');
const turn3=Sim.advanceCampaignTurn(sector);
assert.equal(turn3.turn,3);
const delivered=Logistics.getShipments(sector).find(x=>x.destinationMarketId==='MB'&&x.commodityId==='medical-compounds'&&x.status==='delivered');
assert.ok(delivered,'The restored corridor carries the shipment to the destination.');
const chronicle=sector.simulation.chronicle.events;
const shipmentEvents=chronicle.filter(e=>String(e.shipmentId||'')===String(delivered.id));
const eventOf=type=>shipmentEvents.find(e=>e.type===type);
const dispatch=eventOf('shipment-dispatched'),arrival=eventOf('shipment-arrival'),payment=eventOf('commodity-purchase-settled'),complete=eventOf('shipment-delivered');
assert.ok(dispatch&&arrival&&payment&&complete,'The causal Chronicle records all major shipment stages.');
assert.ok(arrival.causes.includes(dispatch.id));assert.ok(payment.causes.includes(arrival.id));assert.ok(complete.causes.includes(payment.id));
assert.ok(chronicle.some(e=>e.type==='war-declared')&&chronicle.some(e=>e.type==='ceasefire-declared'));
assert.ok(Sim.validateTurnCoordinator(sector).ok);assert.ok(Politics.validate(sector).ok);assert.ok(Economy.validate(sector).ok);assert.ok(Logistics.validate(sector).ok);assert.ok(Settlement.validate(sector).ok);assert.ok(Strategy.validate(sector).ok);
console.log('PASS: 1.3.8 integrated crisis scenario — war closes a corridor, supply shortages and price pressure emerge, faction/corporate intelligence reacts, ceasefire restores risk-adjusted shipping, delivered trade settles, and Chronicle preserves the causal chain.');
