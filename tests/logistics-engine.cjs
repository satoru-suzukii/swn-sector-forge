#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

const context = vm.createContext({console, Date, Math, Map, Set, Object, Array, String, Number, JSON, RegExp});
context.CampaignTools = {
  TRADE_GOODS:[
    {name:'Fresh produce',category:'Agricultural',basePrice:120},
    {name:'Medical compounds',category:'Medical',basePrice:1600},
    {name:'Machine parts',category:'Industrial',basePrice:1100},
    {name:'Microelectronics',category:'Technology',basePrice:3200}
  ],
  getDiplomaticRelation(sector, a, b) {
    return (sector.diplomacy || []).find(r => (r.factionAId === a && r.factionBId === b) || (r.factionAId === b && r.factionBId === a)) || null;
  }
};
for (const file of ['simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js','simulation/logistics-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
}
const Sim = vm.runInContext('SectorSimulation', context);
const Economy = vm.runInContext('SectorEconomy', context);
const Logistics = vm.runInContext('SectorLogistics', context);

function makeSector(options = {}) {
  const sector = {
    name:'Logistics Test', schemaVersion:3, gmMode:true, factionTurn:0,
    grid:{columns:10,rows:12},
    systems:[
      {id:'SYS-A',name:'Agraria',x:0,y:0,controllingFactionId:'F-1',planets:[{id:'WORLD-A',name:'Agraria Prime',population:'hundreds of millions of inhabitants',techLevel:'3',tag1:'Oceanic World',tag2:'Trade Hub'}]},
      {id:'SYS-B',name:'Waystation',x:1,y:0,controllingFactionId:'F-1',planets:[]},
      {id:'SYS-C',name:'Forge',x:2,y:0,controllingFactionId:'F-2',planets:[{id:'WORLD-C',name:'Forge Prime',population:'several million inhabitants',techLevel:'5',tag1:'Heavy Industry',tag2:'Major Spaceyard'}]}
    ],
    markets:[
      {id:'MARKET-A',systemId:'SYS-A',planetId:'WORLD-A',systemName:'Agraria',planetName:'Agraria Prime',techLevel:'3',population:'hundreds of millions of inhabitants',profile:'Agrarian exporter',traits:['Oceanic World','Trade Hub'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'surplus'},{name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100,supply:'available'}]},
      {id:'MARKET-C',systemId:'SYS-C',planetId:'WORLD-C',systemName:'Forge',planetName:'Forge Prime',techLevel:'5',population:'several million inhabitants',profile:'Industrial exchange',traits:['Heavy Industry','Major Spaceyard'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'shortage'},{name:'Machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100,supply:'available'}]}
    ],
    factions:[{id:'F-1',name:'Agrarian League'},{id:'F-2',name:'Forge Directorate'}],
    diplomacy:[],
    tradeRoutes:[
      {id:'R-AB',fromSystemId:'SYS-A',toSystemId:'SYS-B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,riskPercent:0},
      {id:'R-BC',fromSystemId:'SYS-B',toSystemId:'SYS-C',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,riskPercent:0}
    ],
    corporationMarketLinks:[]
  };
  if (options.direct) sector.tradeRoutes.push({id:'R-AC',fromSystemId:'SYS-A',toSystemId:'SYS-C',distance:2,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:50,riskPercent:0});
  if (options.blockConflict) sector.diplomacy.push({id:'DIP-1-2',factionAId:'F-1',factionBId:'F-2',state:'Open conflict',trust:-5,tension:10,tradeAccess:'automatic',tradeTariffPercent:-1,tradeTransitRights:true,embargoCommodityIds:''});
  Sim.migrateSector(sector, {sourceApplicationVersion:'1.3.3'});
  Economy.initializeSector(sector);
  const source = Economy.getMarketState(sector, 'MARKET-A').inventory.find(i => i.commodityId === 'fresh-produce');
  const destination = Economy.getMarketState(sector, 'MARKET-C').inventory.find(i => i.commodityId === 'fresh-produce');
  source.targetStock = 20; source.storageCapacity = 500; source.onHand = 250;
  destination.targetStock = 100; destination.storageCapacity = 500; destination.onHand = 0;
  if (options.sourceLocked) Sim.setFieldOverride(source, 'onHand', source.onHand);
  if (options.capacity != null) sector.tradeRoutes.forEach(r => { r.capacityPerTurn = options.capacity; });
  if (options.risk != null) sector.tradeRoutes.forEach(r => { r.riskPercent = options.risk; });
  return sector;
}

// Weighted pathfinding selects the cheaper multi-hop path over an expensive direct corridor.
const pathSector = makeSector({direct:true});
const bestPath = Logistics.getPath(pathSector, 'SYS-A', 'SYS-C', 'fresh-produce');
assert.equal(bestPath.reachable, true);
assert.deepEqual(JSON.parse(JSON.stringify(bestPath.routeIds)), ['R-AB','R-BC']);
assert.deepEqual(JSON.parse(JSON.stringify(bestPath.systemIds)), ['SYS-A','SYS-B','SYS-C']);
assert.equal(bestPath.transitTurns, 2);

// One-way route semantics and blocked-route eligibility are enforced.
const directional = makeSector();
directional.tradeRoutes[0].direction = 'forward';
assert.equal(Logistics.getPath(directional, 'SYS-A', 'SYS-C', 'fresh-produce').reachable, true);
assert.equal(Logistics.getPath(directional, 'SYS-C', 'SYS-A', 'fresh-produce').reachable, false);
directional.tradeRoutes[1].status = 'Blocked';
assert.equal(Logistics.getPath(directional, 'SYS-A', 'SYS-C', 'fresh-produce').reachable, false);

// Multi-hop dispatch debits origin stock, uses capacity, waits at the intermediary, then arrives.
const sector = makeSector();
const sourceStock = Economy.getMarketState(sector, 'MARKET-A').inventory.find(i => i.commodityId === 'fresh-produce');
const destinationStock = Economy.getMarketState(sector, 'MARKET-C').inventory.find(i => i.commodityId === 'fresh-produce');
const sourceOpening = sourceStock.onHand;
const turn1 = Economy.advanceTurn(sector, 1);
assert.equal(turn1.logistics.dispatch.skipped, false);
assert.ok(turn1.logistics.dispatch.dispatched > 0, 'Shortage and surplus should create an automatic shipment.');
const shipment = Logistics.getShipments(sector)[0];
assert.ok(shipment, 'Shipment record should persist in the GM simulation state.');
assert.equal(shipment.status, 'in-transit');
assert.equal(shipment.legs.length, 1);
assert.equal(shipment.legs[0].routeId, 'R-AB');
assert.ok(sourceStock.onHand < sourceOpening, 'Cargo is debited at departure, not at delivery.');
assert.equal(destinationStock.onHand, 0, 'Destination must not receive cargo before arrival.');
assert.equal(Logistics.getSummary(sector).inTransit, 1);
assert.equal(Economy.advanceTurn(sector, 1).skipped, true, 'A duplicate campaign turn cannot dispatch the shipment twice.');

const turn2 = Economy.advanceTurn(sector, 2);
assert.ok(shipment.legs.length >= 2, 'A multi-hop shipment must start its second leg after reaching the intermediary.');
assert.equal(shipment.legs[1].routeId, 'R-BC');
assert.equal(shipment.legs[1].departedTurn, 2);
assert.notEqual(shipment.status, 'delivered', 'A two-leg itinerary cannot arrive in one hop or teleport.');
const turn3 = Economy.advanceTurn(sector, 3);
assert.equal(shipment.status, 'delivered');
assert.ok(shipment.deliveredQuantity > 0);
assert.ok(destinationStock.onHand > 0, 'Cargo is credited to destination inventory on arrival.');
assert.ok(Logistics.getSummary(sector).delivered > 0);
assert.ok(shipment.freightCost > 0 && shipment.tollCost >= 0, 'Freight and toll costs are persisted separately from cargo.');
assert.ok(Economy.getMarketState(sector, 'MARKET-A').logisticsLedger.some(e => e.type === 'export'), 'Origin market keeps its export movement ledger.');
assert.ok(Economy.getMarketState(sector, 'MARKET-C').logisticsLedger.some(e => e.type === 'arrival'), 'Destination market keeps its import movement ledger.');
assert.ok(Economy.getMarketState(sector, 'MARKET-C').prices.find(p => p.commodityId === 'fresh-produce').freightCostPressure > 0, 'Delivered freight costs contribute bounded pressure to destination pricing.');
assert.ok(sector.simulation.chronicle.events.some(e => e.category === 'logistics' && e.type === 'shipment-dispatched'));
assert.ok(sector.simulation.chronicle.events.some(e => e.category === 'logistics' && e.type === 'shipment-delivered'));
assert.ok(sector.simulation.economy.logistics.ledger.some(e => e.type === 'departure'));
assert.ok(sector.simulation.economy.logistics.ledger.some(e => e.type === 'arrival'));
assert.equal(Logistics.validate(sector).ok, true, JSON.stringify(Logistics.validate(sector).errors));

// Route capacity is enforced in cargo units and GM-locked stocks are not auto-exported.
const lowCapacity = makeSector({capacity:2});
Economy.advanceTurn(lowCapacity, 1);
const lowCapShipment = Logistics.getShipments(lowCapacity)[0];
assert.ok(lowCapShipment);
assert.ok(lowCapShipment.cargoUnits <= 2.0001, 'Shipment quantity must respect the dispatch route capacity.');
const locked = makeSector({sourceLocked:true});
Economy.advanceTurn(locked, 1);
assert.equal(Logistics.getShipments(locked).length, 0, 'GM-locked origin stock is not automatically exported.');
const destinationLocked = makeSector();
Economy.advanceTurn(destinationLocked, 1);
const waitingShipment = Logistics.getShipments(destinationLocked)[0];
const destinationLockedStock = Economy.getMarketState(destinationLocked, 'MARKET-C').inventory.find(i => i.commodityId === 'fresh-produce');
Sim.setFieldOverride(destinationLockedStock, 'onHand', destinationLockedStock.onHand);
Economy.advanceTurn(destinationLocked, 2);
Economy.advanceTurn(destinationLocked, 3);
assert.equal(waitingShipment.status, 'awaiting-storage', 'Cargo must wait when destination inventory is GM-locked.');
assert.equal(destinationLockedStock.onHand, 0, 'A GM-locked destination inventory is not automatically changed.');
Sim.clearFieldOverride(destinationLockedStock, 'onHand');
Economy.advanceTurn(destinationLocked, 4);
assert.ok(waitingShipment.status === 'delivered' && destinationLockedStock.onHand > 0, 'Waiting cargo can be credited after the GM unlocks destination stock.');

// An Open Conflict border blocks trade by default, while an explicit GM access override can reopen it.
const conflict = makeSector({blockConflict:true});
assert.equal(Logistics.getPath(conflict, 'SYS-A', 'SYS-C', 'fresh-produce').reachable, false);
conflict.diplomacy[0].tradeAccess = 'open';
assert.equal(Logistics.getPath(conflict, 'SYS-A', 'SYS-C', 'fresh-produce').reachable, true);
conflict.diplomacy[0].tradeTariffPercent = 20;
assert.ok(Logistics.getPath(conflict, 'SYS-A', 'SYS-C', 'fresh-produce').tariffCostPerUnit > 0, 'An explicit tariff is included in weighted path costs.');
conflict.diplomacy[0].embargoCommodityIds = 'fresh-produce';
assert.equal(Logistics.getPath(conflict, 'SYS-A', 'SYS-C', 'fresh-produce').reachable, false, 'Explicit commodity embargo wins over an open general access policy.');

// Transit-risk outcomes are reproducible from sector seed + turn + shipment + route scope.
const riskA = makeSector({risk:95});
const riskB = makeSector({risk:95});
Economy.advanceTurn(riskA, 1); Economy.advanceTurn(riskB, 1);
const riskShipmentA = Logistics.getShipments(riskA)[0];
const riskShipmentB = Logistics.getShipments(riskB)[0];
assert.equal(riskShipmentA.status, riskShipmentB.status);
assert.equal(riskShipmentA.legs[0].incident, riskShipmentB.legs[0].incident);
assert.equal(riskShipmentA.remainingQuantity, riskShipmentB.remainingQuantity);

// GM JSON round-trip keeps active itinerary, progress, ledger, and capacity metadata.
const reloaded = JSON.parse(JSON.stringify(sector));
assert.deepEqual(JSON.parse(JSON.stringify(reloaded.simulation.economy.logistics.shipments)), JSON.parse(JSON.stringify(sector.simulation.economy.logistics.shipments)));
assert.deepEqual(JSON.parse(JSON.stringify(reloaded.simulation.economy.logistics.ledger)), JSON.parse(JSON.stringify(sector.simulation.economy.logistics.ledger)));
assert.equal(Logistics.validate(reloaded).ok, true);

// A shipment stranded between legs must not process its previous arrival twice.
const interrupted = makeSector();
Economy.advanceTurn(interrupted, 1);
const interruptedShipment = Logistics.getShipments(interrupted)[0];
interrupted.tradeRoutes.find(r => r.id === 'R-BC').status = 'Blocked';
Economy.advanceTurn(interrupted, 2);
assert.equal(interruptedShipment.status, 'delayed');
assert.equal(interruptedShipment.currentLegIndex, 1);
const arrivalEventsBeforeRetry = interrupted.simulation.economy.logistics.ledger.filter(e => e.type === 'leg-arrival' && e.shipmentId === interruptedShipment.id).length;
Economy.advanceTurn(interrupted, 3);
assert.equal(interruptedShipment.currentLegIndex, 1, 'A stranded shipment cannot advance the same already-arrived leg again.');
assert.equal(interrupted.simulation.economy.logistics.ledger.filter(e => e.type === 'leg-arrival' && e.shipmentId === interruptedShipment.id).length, arrivalEventsBeforeRetry, 'Leg-arrival ledger entries must be idempotent.');
interrupted.tradeRoutes.find(r => r.id === 'R-BC').status = 'Established';
Economy.advanceTurn(interrupted, 4);
assert.ok(interruptedShipment.legs.length >= 2, 'A restored route can resume a shipment from its current system.');

// The shipment's original quantity is conserved across cargo in transit,
// delivered stock, and recorded transit losses.
function assertCargoConserved(item) {
  const losses = item.legs.reduce((sum, leg) => sum + Number(leg.quantityLost || 0), 0);
  const accounted = Number(item.remainingQuantity || 0) + Number(item.deliveredQuantity || 0) + losses;
  assert.ok(Math.abs(Number(item.quantity) - accounted) < 0.021, `Cargo conservation failed for ${item.id}: ${item.quantity} != ${accounted}`);
}
for (const item of Logistics.getShipments(sector)) assertCargoConserved(item);
for (const item of Logistics.getShipments(riskA)) assertCargoConserved(item);

console.log('PASS: 1.3.4 logistics — weighted multi-hop pathfinding, directionality, operational route filtering, turn-based transit, capacity enforcement, diplomatic embargoes/overrides, deterministic route incidents, delivery, ledgers, Chronicle, GM-stock locks, and save round-trip.');
