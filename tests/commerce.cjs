const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console, Math, JSON, Number, String, Boolean, Array, Object, Map, Set, Date, RegExp, Error, TypeError, RangeError, parseInt, parseFloat});
context.CampaignTools = {
  TRADE_GOODS:[
    {name:'Fresh produce',category:'Agricultural',basePrice:120},
    {name:'Medical compounds',category:'Medical',basePrice:1600},
    {name:'Industrial machine parts',category:'Industrial',basePrice:1100},
    {name:'Bulk water',category:'Bulk',basePrice:80}
  ],
  getDiplomaticRelation(sector,a,b){return (sector.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;},
  recordFactionTurn(){}, recalculateInfluence(){}, linkCampaignRecords(){}, updateMarkets(){}
};
for (const file of ['simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js','simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/strategic-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
}
const Sim=vm.runInContext('SectorSimulation',context), Economy=vm.runInContext('SectorEconomy',context), Settlement=vm.runInContext('SectorSettlement',context), Contracts=vm.runInContext('SectorTradeContracts',context), Logistics=vm.runInContext('SectorLogistics',context);
function makeSector(options={}) {
  const capacity = options.capacity == null ? 100 : options.capacity;
  const s={name:'1.3.6 Commerce Test Sector',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Origin',x:0,y:0,controllingFactionId:'F1',planets:[{id:'WA',name:'Origin World',population:'hundreds of millions of inhabitants',techLevel:'3',tag1:'Oceanic World',tag2:'Trade Hub'}]},
      {id:'B',name:'Relay',x:1,y:0,controllingFactionId:'F1',planets:[]},
      {id:'C',name:'Destination',x:2,y:0,controllingFactionId:'F2',planets:[{id:'WC',name:'Destination World',population:'several million inhabitants',techLevel:'5',tag1:'Heavy Industry',tag2:'Major Spaceyard'}]}
    ],
    markets:[
      {id:'MA',systemId:'A',planetId:'WA',systemName:'Origin',planetName:'Origin World',techLevel:'3',population:'hundreds of millions of inhabitants',profile:'Agrarian exporter',traits:['Oceanic World','Trade Hub'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'surplus'},{name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100,supply:'available'},{name:'Industrial machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100,supply:'available'},{name:'Bulk water',category:'Bulk',basePrice:80,priceIndex:100,basePriceIndex:100,supply:'available'}]},
      {id:'MC',systemId:'C',planetId:'WC',systemName:'Destination',planetName:'Destination World',techLevel:'5',population:'several million inhabitants',profile:'Industrial exchange',traits:['Heavy Industry','Major Spaceyard'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'shortage'},{name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100,supply:'shortage'},{name:'Industrial machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100,supply:'shortage'},{name:'Bulk water',category:'Bulk',basePrice:80,priceIndex:100,basePriceIndex:100,supply:'shortage'}]}
    ],
    factions:[{id:'F1',name:'Origin League',wealth:4,assets:[],factionCredits:5},{id:'F2',name:'Destination Authority',wealth:3,assets:[],factionCredits:4}],
    corporations:[{id:'CORP-1',name:'Farline Freight',valuation:'growing'}],
    corporationMarketLinks:[{id:'L1',corporationId:'CORP-1',marketId:'MA'},{id:'L2',corporationId:'CORP-1',marketId:'MC'}],
    diplomacy:[{id:'DIP-1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:2}],
    tradeRoutes:[
      {id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:capacity,transitTurns:1,freightCostPerUnit:2,tollPerUnit:1,operatingCostPerUnit:0.5,riskPercent:0,operatorCorporationId:'CORP-1'},
      {id:'R2',fromSystemId:'B',toSystemId:'C',distance:1,kind:'trade',status:'Established',capacityPerTurn:capacity,transitTurns:1,freightCostPerUnit:2,tollPerUnit:0,operatingCostPerUnit:0.25,riskPercent:0}
    ]
  };
  Sim.migrateSector(s,{sourceApplicationVersion:'1.3.5'}); s.simulation.settings.strategicAI = Object.assign({}, s.simulation.settings.strategicAI, {corporateAutonomy:false}); Economy.initializeSector(s);
  const origin=Economy.getMarketState(s,'MA'), destination=Economy.getMarketState(s,'MC');
  const setStock=(state,id,values)=>Object.assign(state.inventory.find(x=>x.commodityId===id),values);
  setStock(origin,'fresh-produce',{targetStock:10,storageCapacity:1000,onHand:240});
  setStock(destination,'fresh-produce',{targetStock:80,storageCapacity:1000,onHand:0});
  setStock(origin,'medical-compounds',{targetStock:10,storageCapacity:1000,onHand:240});
  setStock(destination,'medical-compounds',{targetStock:80,storageCapacity:1000,onHand:0});
  setStock(origin,'industrial-machine-parts',{targetStock:10,storageCapacity:1000,onHand:240});
  setStock(destination,'industrial-machine-parts',{targetStock:80,storageCapacity:1000,onHand:0});
  setStock(origin,'bulk-water',{targetStock:10,storageCapacity:1000,onHand:240});
  setStock(destination,'bulk-water',{targetStock:80,storageCapacity:1000,onHand:0});
  Settlement.initialize(s); Contracts.initialize(s);
  return s;
}

// Commodity profiles provide materially different cargo footprints.
const sector=makeSector();
const catalogue=Economy.getCommodityCatalogue(sector);
const weight=id=>catalogue.find(c=>c.id===id).freightUnitsPerLot;
assert.equal(weight('fresh-produce'),1.4);
assert.equal(weight('medical-compounds'),0.65);
assert.equal(weight('industrial-machine-parts'),2.0);
assert.equal(weight('bulk-water'),3.2);
assert.ok(new Set(['fresh-produce','medical-compounds','industrial-machine-parts','bulk-water'].map(weight)).size===4);

// A contract sets price/quantity/priority; any remaining need is still eligible for spot purchases.
const created=Contracts.create(sector,{name:'Colony food line',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:12,unitPriceCr:175,startTurn:1,endTurn:3,priority:'critical',status:'active'},0);
assert.equal(created.ok,true,created.reason);
const overlapping=Contracts.create(sector,{name:'Conflicting duplicate',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:3,startTurn:2,endTurn:5,priority:'low',status:'not-a-status'},0);
assert.equal(overlapping.ok,false,'Overlapping active contracts on the same commodity lane must be rejected.');
Economy.advanceTurn(sector,1);
const shipments=Logistics.getShipments(sector);
const contracted=shipments.find(s=>s.contractId===created.contract.id);
assert.ok(contracted,'A contract should produce a contracted shipment.');
assert.equal(contracted.saleUnitPriceCr,175);
assert.ok(contracted.quantity<=12.001,'Contract dispatch must respect its per-turn volume.');
assert.equal(contracted.commodityPaidQuantity,0,'Goods are not paid until delivery.');
const dispatchLedger=Contracts.getLedger(sector).length;
assert.equal(Contracts.recordDispatch(sector,created.contract.id,contracted,contracted.quantity,1),null,'Repeated dispatch registration must be idempotent.');
assert.equal(Contracts.getLedger(sector).length,dispatchLedger);
assert.ok(shipments.some(s=>!s.contractId&&s.commodityId==='fresh-produce'),'A contract must not suppress additional spot trade beyond its committed volume.');

// Cargo weight constrains route throughput, and operating expenses are explicit transfers.
const firstLeg=contracted.legs[0];
assert.ok(firstLeg.cargoUnits>contracted.quantity,'Fresh produce requires more than one cargo unit per lot.');
assert.ok(firstLeg.cargoUnits<=100.001);
assert.ok(Settlement.getLedger(sector).some(t=>t.type==='route-operating-cost'&&t.shipmentId===contracted.id),'Route operator operating costs must settle to the infrastructure account.');
assert.ok(firstLeg.financiallySettled===true);

// Goods are paid exactly once, only after each delivered tranche.
const buyer=Settlement.getAccounts(sector).find(a=>a.id==='market:MC');
const seller=Settlement.getAccounts(sector).find(a=>a.id==='faction:F1');
const buyerBefore=buyer.balance, sellerBefore=seller.balance;
Economy.advanceTurn(sector,2);
Economy.advanceTurn(sector,3);
assert.equal(contracted.status,'delivered');
assert.ok(contracted.deliveredQuantity>0);
const shipmentEvents=sector.simulation.chronicle.events.filter(e=>String(e.shipmentId||'')===String(contracted.id));
const eventOf=type=>shipmentEvents.find(e=>e.type===type);
const dispatchedEvent=eventOf('shipment-dispatched'), arrivalEvent=eventOf('shipment-arrival'), paymentEvent=eventOf('commodity-purchase-settled'), deliveredEvent=eventOf('shipment-delivered');
assert.ok(dispatchedEvent&&arrivalEvent&&paymentEvent&&deliveredEvent,'A full shipment must leave dispatch, arrival, payment, and delivery Chronicle records.');
assert.ok(arrivalEvent.causes.includes(dispatchedEvent.id),'Arrival must be causally linked to dispatch.');
assert.ok(paymentEvent.causes.includes(arrivalEvent.id),'Payment must be causally linked to physical arrival, not a later event.');
assert.ok(deliveredEvent.causes.includes(paymentEvent.id),'Delivery completion must follow and reference settlement.');
assert.ok(contracted.chronicleEventIds.includes(arrivalEvent.id)&&contracted.chronicleEventIds.includes(paymentEvent.id)&&contracted.chronicleEventIds.includes(deliveredEvent.id),'Shipment stores a bounded navigable Chronicle chain.');
assert.equal(contracted.commodityPaidQuantity,contracted.deliveredQuantity);
assert.equal(Number(contracted.commodityPaidCr.toFixed(2)),Number((contracted.deliveredQuantity*175).toFixed(2)));
assert.ok(buyer.balance<buyerBefore,'Destination clearing account must pay the supplier.');
assert.ok(seller.balance>sellerBefore,'Origin controller must receive commodity revenue.');
const payments=Settlement.getLedger(sector).filter(t=>t.type==='commodity-purchase'&&t.shipmentId===contracted.id);
assert.equal(payments.length,1,'A single complete arrival must create one purchase settlement.');
assert.equal(Number(payments[0].quantityLots.toFixed(2)),Number(contracted.deliveredQuantity.toFixed(2)));
const afterDeliveryLedger=Settlement.getLedger(sector).length;
Settlement.settleCommodityDelivery(sector,contracted,contracted.deliveredQuantity,3);
assert.equal(Settlement.getLedger(sector).length,afterDeliveryLedger,'Repeated settlement must not double charge the buyer.');
const contractLedgerAfterDelivery=Contracts.getLedger(sector).length;
assert.equal(Contracts.recordDelivery(sector,contracted,contracted.deliveredQuantity,3),null,'Repeated contract delivery callback must be idempotent.');
assert.equal(Contracts.getLedger(sector).length,contractLedgerAfterDelivery,'Repeated delivery callback must not duplicate contract ledger entries.');
Economy.advanceTurn(sector,4);
assert.ok(created.contract.history.some(h=>h.turn===1&&h.shipped>0),'Contract history must archive dispatched volume.');
assert.ok(Contracts.validate(sector).ok,JSON.stringify(Contracts.validate(sector).errors));
assert.ok(Settlement.validate(sector).ok,JSON.stringify(Settlement.validate(sector).errors));
assert.ok(Logistics.validate(sector).ok,JSON.stringify(Logistics.validate(sector).errors));
const balanceTotal=Settlement.getAccounts(sector).reduce((n,a)=>n+Number(a.balance||0),0);
const originalTotal=Settlement.getAccounts(sector).reduce((n,a)=>n+Number(a.openingBalance||0),0);
assert.ok(Math.abs(balanceTotal-originalTotal)<0.011,'Every purchase and route charge must conserve total Cr.');

// Smaller route capacity is measured in cargo units, not arbitrary trade lots.
const constrained=makeSector({capacity:14});
const capContract=Contracts.create(constrained,{name:'Cargo capacity test',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:40,unitPriceCr:100,startTurn:1,priority:'critical'},0);
assert.equal(capContract.ok,true);
Economy.advanceTurn(constrained,1);
const capShipment=Logistics.getShipments(constrained).find(s=>s.contractId===capContract.contract.id);
assert.ok(capShipment);
assert.ok(capShipment.cargoUnits<=14.001,'Cargo usage must not exceed route capacity.');
assert.ok(capShipment.quantity<=10.001,'1.4 cargo units per lot means 14 units support at most 10 lots.');

// Legacy catalogue defaults are upgraded, while explicit GM freight overrides persist.
const migratedDefault=makeSector();
const defaultFresh=migratedDefault.simulation.economy.commodities.find(c=>c.id==='fresh-produce');
defaultFresh.freightUnitsPerLot=1; defaultFresh.storageClass='standard'; defaultFresh.fieldOverrides={}; defaultFresh.manualOverrides={};
Economy.initializeSector(migratedDefault);
const upgradedFresh=Economy.getCommodityCatalogue(migratedDefault).find(c=>c.id==='fresh-produce');
assert.equal(upgradedFresh.freightUnitsPerLot,1.4,'Unprotected legacy catalogue entries must receive the 1.3.6 category freight default.');
assert.equal(upgradedFresh.storageClass,'perishable','Unprotected legacy catalogue entries must receive the 1.3.6 category storage profile.');
const migrated=makeSector();
const fresh=migrated.simulation.economy.commodities.find(c=>c.id==='fresh-produce');
fresh.freightUnitsPerLot=7.25; fresh.storageClass='secure'; fresh.fieldOverrides={}; fresh.manualOverrides={freightUnitsPerLot:true,storageClass:true};
Economy.initializeSector(migrated);
assert.equal(Economy.getCommodityCatalogue(migrated).find(c=>c.id==='fresh-produce').freightUnitsPerLot,7.25,'Legacy manualOverrides must protect existing freight-unit edits.');
assert.equal(Economy.getCommodityCatalogue(migrated).find(c=>c.id==='fresh-produce').fieldOverrides.freightUnitsPerLot,true,'Legacy overrides should migrate into the canonical fieldOverrides map.');
assert.equal(Economy.getCommodityCatalogue(migrated).find(c=>c.id==='fresh-produce').fieldOverrides.storageClass,true);
const overridden=Economy.getCommodityCatalogue(migrated).find(c=>c.id==='fresh-produce');
Sim.setFieldOverride(overridden,'freightUnitsPerLot',7.5);
Sim.setFieldOverride(overridden,'storageClass','secure');
Economy.initializeSector(migrated);
const stillOverridden=Economy.getCommodityCatalogue(migrated).find(c=>c.id==='fresh-produce');
assert.equal(stillOverridden.freightUnitsPerLot,7.5);
assert.equal(stillOverridden.storageClass,'secure');

// Paused, cancelled, future-start, and expired contracts cannot dispatch.
const contractState=makeSector();
const paused=Contracts.create(contractState,{originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:10,startTurn:1,priority:'standard',status:'paused'},0);
assert.equal(paused.ok,true);
Economy.advanceTurn(contractState,1);
assert.ok(!Logistics.getShipments(contractState).some(s=>s.contractId===paused.contract.id));
paused.contract.status='active'; paused.contract.startTurn=5;
Economy.advanceTurn(contractState,2);
assert.ok(!Logistics.getShipments(contractState).some(s=>s.contractId===paused.contract.id));
const expiring=Contracts.create(contractState,{originMarketId:'MA',destinationMarketId:'MC',commodityId:'medical-compounds',quantityPerTurn:5,startTurn:3,endTurn:3,priority:'low'},2);
assert.equal(expiring.ok,true);
Economy.advanceTurn(contractState,3);
Economy.advanceTurn(contractState,4);
assert.equal(expiring.contract.status,'expired');
assert.ok(Contracts.validate(contractState).ok,JSON.stringify(Contracts.validate(contractState).errors));
paused.contract.destinationMarketId='REMOVED-MARKET';
const staleMarketValidation=Contracts.validate(contractState);
assert.equal(staleMarketValidation.ok,true,'Removed market references should retain contract history without invalidating the entire campaign.');
assert.ok(staleMarketValidation.warnings.length>0);

// Partial arrivals settle in separate tranches; repeated callbacks cannot double-pay.
const partialState=makeSector();
const partialShipment={id:'PARTIAL-ARRIVAL',originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',saleUnitPriceCr:25,deliveredQuantity:3,commodityPaidQuantity:0,commodityPaidCr:0,commoditySettlementIds:[]};
partialState.simulation.economy.logistics.shipments.push(partialShipment);
const firstTranche=Settlement.settleCommodityDelivery(partialState,partialShipment,3,1);
assert.equal(firstTranche.quantity,3);
partialShipment.deliveredQuantity=5;
const secondTranche=Settlement.settleCommodityDelivery(partialState,partialShipment,2,2);
assert.equal(secondTranche.quantity,2);
assert.equal(partialShipment.commodityPaidQuantity,5);
assert.equal(Number(partialShipment.commodityPaidCr.toFixed(2)),125);
const partialLedger=Settlement.getLedger(partialState).length;
Settlement.settleCommodityDelivery(partialState,partialShipment,2,2);
assert.equal(Settlement.getLedger(partialState).length,partialLedger,'Repeated partial-delivery settlement must not double-pay a previous tranche.');
assert.ok(Settlement.validate(partialState).ok,JSON.stringify(Settlement.validate(partialState).errors));

// Repeated transit-loss callbacks are idempotent against cumulative per-leg losses.
const lossState=makeSector();
const lossContract=Contracts.create(lossState,{originMarketId:'MA',destinationMarketId:'MC',commodityId:'fresh-produce',quantityPerTurn:5,startTurn:1,priority:'standard'},0);
assert.equal(lossContract.ok,true);
const lossShipment={id:'LOSS-TEST',contractId:lossContract.contract.id,legs:[{quantityLost:2}],contractLostQuantity:0};
const firstLoss=Contracts.recordLoss(lossState,lossShipment,2,1);
assert.ok(firstLoss,'The first transit loss should be recorded.');
const lossLedgerCount=Contracts.getLedger(lossState).length;
assert.equal(Contracts.recordLoss(lossState,lossShipment,2,1),null,'Repeated loss callback must not double count.');
assert.equal(Contracts.getLedger(lossState).length,lossLedgerCount);
assert.equal(lossContract.contract.lostThisTurn,2);

// Save/restore keeps contracts, commodity overrides, cargo weights and purchase ledgers.
const roundTrip=JSON.parse(JSON.stringify(sector));
assert.ok(Contracts.validate(roundTrip).ok);
assert.ok(Settlement.validate(roundTrip).ok);
assert.ok(Logistics.validate(roundTrip).ok);
assert.equal(Contracts.getContracts(roundTrip).length,Contracts.getContracts(sector).length);
assert.equal(Settlement.getLedger(roundTrip).length,Settlement.getLedger(sector).length);
console.log('PASS: 1.3.6 commerce — commodity freight profiles, GM profile overrides, cargo-unit capacity, recurring contracts, contract/spot split, fixed contract pricing, delivered-only commodity settlement, idempotent and partial-tranche purchases, route operating expenses, history, normalized-status overlap rejection, delivery/loss callback idempotency, expiry/pause, stale-reference warnings, validation, and save round-trip.');
