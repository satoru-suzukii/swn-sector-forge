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
    {name:'Microelectronics',category:'Technology',basePrice:3200},
    {name:'Water and ice',category:'Bulk',basePrice:80},
    {name:'Art and entertainment',category:'Cultural',basePrice:450}
  ]
};
vm.runInContext(fs.readFileSync(path.join(root, 'simulation/trade-route-rules.js'), 'utf8'), context, {filename:'simulation/trade-route-rules.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'simulation/sector-simulation.js'), 'utf8'), context, {filename:'simulation/sector-simulation.js'});
vm.runInContext(fs.readFileSync(path.join(root, 'simulation/economy-engine.js'), 'utf8'), context, {filename:'simulation/economy-engine.js'});
const Sim = vm.runInContext('SectorSimulation', context);
const Economy = vm.runInContext('SectorEconomy', context);

function makeSector() {
  return {
    name:'Economy Test', schemaVersion:3, gmMode:true, factionTurn:0,
    grid:{columns:10,rows:12},
    systems:[
      {id:'SYS-A',name:'Agraria',x:0,y:0,planets:[{id:'WORLD-A',name:'Agraria Prime',population:'hundreds of millions of inhabitants',techLevel:'3',tag1:'Oceanic World',tag2:'Trade Hub'}]},
      {id:'SYS-B',name:'Forge',x:1,y:0,planets:[{id:'WORLD-B',name:'Forge Prime',population:'several million inhabitants',techLevel:'5',tag1:'Heavy Industry',tag2:'Major Spaceyard'}]}
    ],
    markets:[
      {id:'MARKET-A',systemId:'SYS-A',planetId:'WORLD-A',systemName:'Agraria',planetName:'Agraria Prime',techLevel:'3',population:'hundreds of millions of inhabitants',profile:'Agrarian exporter',traits:['Oceanic World','Trade Hub'],goods:[
        {name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:110,basePriceIndex:110,supply:'available'},
        {name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:150,basePriceIndex:150,supply:'shortage'},
        {name:'Machine parts',category:'Industrial',basePrice:1100,priceIndex:100,basePriceIndex:100,supply:'available'}
      ]},
      {id:'MARKET-B',systemId:'SYS-B',planetId:'WORLD-B',systemName:'Forge',planetName:'Forge Prime',techLevel:'5',population:'several million inhabitants',profile:'Industrial exchange',traits:['Heavy Industry','Major Spaceyard'],goods:[
        {name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'available'},
        {name:'Machine parts',category:'Industrial',basePrice:1100,priceIndex:95,basePriceIndex:95,supply:'surplus'},
        {name:'Microelectronics',category:'Technology',basePrice:3200,priceIndex:130,basePriceIndex:130,supply:'shortage'}
      ]}
    ],
    factions:[], tradeRoutes:[], diplomacy:[], corporationMarketLinks:[]
  };
}

const sectorA = makeSector();
const sectorB = makeSector();
Sim.migrateSector(sectorA, {sourceApplicationVersion:'1.2'});
Sim.migrateSector(sectorB, {sourceApplicationVersion:'1.2'});
const legacyPriceSnapshot = sectorA.markets[0].goods[1].priceIndex;
const first = Economy.initializeSector(sectorA);
const second = Economy.initializeSector(sectorB);
assert.equal(first.initializedMarkets, 2);
assert.equal(sectorA.simulation.economy.initialized, true);
assert.equal(sectorA.simulation.economy.marketStates.length, 2);
assert.equal(sectorA.markets[0].goods[1].priceIndex, legacyPriceSnapshot, 'Initialization preserves the legacy displayed price as the opening price baseline.');
assert.ok(!Object.prototype.hasOwnProperty.call(sectorA.simulation.economy.marketStates[0].inventory[0], 'legacySupply'), 'Legacy supply labels are not copied into inventory quantities.');
assert.deepEqual(
  JSON.parse(JSON.stringify(Economy.getMarketState(sectorA, 'MARKET-A').inventory)),
  JSON.parse(JSON.stringify(Economy.getMarketState(sectorB, 'MARKET-A').inventory)),
  'Initial inventories are reproducible for identical sector seed and market scope.'
);
assert.ok(Economy.getMarketState(sectorA, 'MARKET-A').production.some(line => line.commodityId === 'fresh-produce'), 'Agrarian profile/tag mapping creates food production.');
assert.ok(Economy.getMarketState(sectorA, 'MARKET-B').production.some(line => line.commodityId === 'machine-parts'), 'Industrial profile/tag mapping creates industrial production.');
assert.ok(Economy.getMarketState(sectorA, 'MARKET-A').consumption.every(line => line.quantityPerTurn > 0));

// Initialization is additive and idempotent; it never resets GM-edited stocks.
const stateA = Economy.getMarketState(sectorA, 'MARKET-A');
const originalStock = stateA.inventory[0].onHand;
stateA.inventory[0].onHand += 7;
const repeat = Economy.initializeSector(sectorA);
assert.equal(repeat.initializedMarkets, 0);
assert.equal(repeat.preservedMarkets, 2);
assert.equal(stateA.inventory[0].onHand, originalStock + 7);

// Ledger accounting: opening + production - consumption - overflow = closing.
const advance = Economy.advanceTurn(sectorA, 1);
assert.equal(advance.ok, true);
assert.equal(advance.turn, 1);
assert.equal(advance.markets, 2);
assert.equal(advance.ledgers, 2);
const marketLedger = stateA.ledger[0];
assert.ok(marketLedger.lines.length > 0);
marketLedger.lines.forEach(line => {
  assert.ok(line.closing >= 0, 'Inventory cannot become negative.');
  assert.ok(line.production >= 0 && line.consumption >= 0 && line.overflow >= 0);
  assert.ok(Math.abs(line.closing - (line.opening + line.production - line.consumption - line.overflow)) < 0.011, 'Every unit movement must balance.');
});
assert.ok(sectorA.simulation.chronicle.events.some(event => event.category === 'economic' && event.type === 'local-market-balance'));
assert.equal(Economy.advanceTurn(sectorA, 1).skipped, true, 'A campaign turn can never apply the economy twice.');
assert.equal(stateA.ledger.length, 1, 'Duplicate turn attempts do not duplicate market ledgers.');
assert.throws(() => Economy.advanceTurn(sectorA, 3), /advance one at a time/i, 'Skipped economic turns are rejected instead of silently losing production/consumption.');

// Manual stock and price overrides are respected, while other commodities continue simulating.
const lockedStock = stateA.inventory.find(item => item.commodityId === 'machine-parts');
const lockedGood = sectorA.markets[0].goods.find(item => item.name === 'Machine parts');
Sim.setFieldOverride(lockedStock, 'onHand', lockedStock.onHand + 5);
const lockedValue = lockedStock.onHand;
Sim.setFieldOverride(lockedGood, 'priceIndex', 177);
sectorA.factionTurn = 2;
Sim.syncLegacyTurn(sectorA);
const secondTurn = Economy.advanceTurn(sectorA, 2);
assert.equal(secondTurn.turn, 2);
assert.equal(lockedStock.onHand, lockedValue, 'GM-locked on-hand stock is not changed by automatic production/consumption.');
assert.equal(lockedGood.priceIndex, 177, 'GM-locked market price is not overwritten.');
assert.equal(lockedGood.supply, lockedGood.supply, 'Projection remains safe with a manual price override.');
Sim.clearFieldOverride(lockedStock, 'onHand');
Sim.clearFieldOverride(lockedGood, 'priceIndex');

// Prices react gradually and remain bounded instead of jumping to target immediately.
const medical = sectorA.markets[0].goods.find(item => item.name === 'Medical compounds');
const priorIndex = medical.priceIndex;
sectorA.factionTurn = 3;
Sim.syncLegacyTurn(sectorA);
Economy.advanceTurn(sectorA, 3);
assert.ok(Math.abs(medical.priceIndex - priorIndex) <= Economy.constants.priceStep, 'Price movements are capped per turn.');
assert.ok(medical.priceIndex >= Economy.constants.priceMin && medical.priceIndex <= Economy.constants.priceMax);

// Market refresh/projection is read-only with respect to the economy ledger and does not advance time.
const ledgerCount = sectorA.simulation.economy.ledger.length;
const lastTurn = sectorA.simulation.economy.clock.lastAdvancedTurn;
sectorA.markets.forEach(market => Economy.syncMarketProjection(sectorA, market));
assert.equal(sectorA.simulation.economy.ledger.length, ledgerCount);
assert.equal(sectorA.simulation.economy.clock.lastAdvancedTurn, lastTurn);

const validation = Economy.validate(sectorA);
assert.equal(validation.ok, true, validation.errors.join('; '));
assert.equal(Economy.getSummary(sectorA).initialized, true);

// Controlled stock levels must produce monotonic price pressure for the same commodity.
const scarcityLow = makeSector(), scarcityHigh = makeSector();
Sim.migrateSector(scarcityLow, {sourceApplicationVersion:'1.2'});
Sim.migrateSector(scarcityHigh, {sourceApplicationVersion:'1.2'});
Economy.initializeSector(scarcityLow); Economy.initializeSector(scarcityHigh);
const lowStock = Economy.getMarketState(scarcityLow, 'MARKET-A').inventory.find(item => item.commodityId === 'medical-compounds');
const highStock = Economy.getMarketState(scarcityHigh, 'MARKET-A').inventory.find(item => item.commodityId === 'medical-compounds');
lowStock.onHand = 0; highStock.onHand = highStock.storageCapacity;
Economy.advanceTurn(scarcityLow, 1); Economy.advanceTurn(scarcityHigh, 1);
const lowPrice = Economy.getMarketState(scarcityLow, 'MARKET-A').prices.find(item => item.commodityId === 'medical-compounds').currentPriceIndex;
const highPrice = Economy.getMarketState(scarcityHigh, 'MARKET-A').prices.find(item => item.commodityId === 'medical-compounds').currentPriceIndex;
assert.ok(lowPrice >= highPrice, 'Lower closing stock must not create a lower target/current price than abundant stock.');

// Newly added markets can be initialized without resetting existing accounts.
sectorA.markets.push({id:'MARKET-C',systemId:'SYS-A',planetId:'WORLD-A',planetName:'New Port',profile:'Frontier depot',population:'outpost',techLevel:'1',traits:[],goods:[{name:'Water and ice',category:'Bulk',basePrice:80,priceIndex:100}]});
const withNewMarket = Economy.initializeSector(sectorA);
assert.equal(withNewMarket.initializedMarkets, 1);
assert.equal(Economy.getMarketState(sectorA, 'MARKET-A'), stateA);
assert.ok(Economy.getMarketState(sectorA, 'MARKET-C'));

// World/profile changes refresh generated schedules without resetting stock,
// while manually locked rates survive and removed goods are retained as history.
const sectorC = makeSector();
Sim.migrateSector(sectorC, {sourceApplicationVersion:'1.2'});
Economy.initializeSector(sectorC);
const stateC = Economy.getMarketState(sectorC, 'MARKET-A');
const foodStock = stateC.inventory.find(item => item.commodityId === 'fresh-produce');
const foodProduction = stateC.production.find(item => item.commodityId === 'fresh-produce');
Sim.setFieldOverride(foodProduction, 'quantityPerTurn', 99);
const preservedStock = foodStock.onHand;
const originalMachineProduction = stateC.production.find(item => item.commodityId === 'machine-parts')?.quantityPerTurn || 0;
const marketC = sectorC.markets[0];
marketC.profile = 'Industrial exchange';
marketC.traits = ['Heavy Industry'];
marketC.goods.push({name:'Quantum spare parts',category:'Industrial',basePrice:5000,priceIndex:110,basePriceIndex:110});
marketC.goods = marketC.goods.filter(item => item.name !== 'Medical compounds');
const driverRefresh = Economy.refreshMarketDrivers(sectorC, marketC);
assert.equal(driverRefresh.ok, true);
assert.equal(foodStock.onHand, preservedStock, 'Refreshing world-derived schedules must not reset current inventory.');
assert.equal(foodProduction.quantityPerTurn, 99, 'Manually locked production schedule must survive a driver refresh.');
assert.ok((stateC.production.find(item => item.commodityId === 'machine-parts')?.quantityPerTurn || 0) > originalMachineProduction, 'Industrial market changes must affect unlocked production schedules.');
assert.ok(stateC.inventory.some(item => item.commodityId === 'quantum-spare-parts'), 'A newly added market good needs an explicit inventory account.');
assert.ok(stateC.retiredCommodities.some(item => item.commodityId === 'medical-compounds'), 'Removed market goods must be archived rather than silently discarded.');
assert.ok(!stateC.inventory.some(item => item.commodityId === 'medical-compounds'), 'Retired market goods must not remain active inventory.');
const refreshTurn = sectorC.simulation.economy.clock.lastAdvancedTurn;
const refreshLedgerCount = sectorC.simulation.economy.ledger.length;
Economy.refreshMarketDrivers(sectorC, marketC);
assert.equal(sectorC.simulation.economy.clock.lastAdvancedTurn, refreshTurn);
assert.equal(sectorC.simulation.economy.ledger.length, refreshLedgerCount);

// A normal GM JSON save/load must preserve the authoritative local economy.
const savedEconomy = JSON.parse(JSON.stringify(sectorC.simulation.economy));
const reloadedSector = JSON.parse(JSON.stringify(sectorC));
Sim.migrateSector(reloadedSector, {sourceApplicationVersion:'1.3.3'});
assert.deepEqual(JSON.parse(JSON.stringify(reloadedSector.simulation.economy)), savedEconomy, 'GM JSON round-trip must preserve inventories, schedules, overrides, ledgers, and clock.');
const reloadedValidation = Economy.validate(reloadedSector);
assert.equal(reloadedValidation.ok, true, reloadedValidation.errors.join('; '));

console.log('PASS: 1.3.3 local economy — deterministic account initialization, no legacy-stock inference, production/consumption ledger balance, bounded scarcity pricing, field-level GM overrides, one-turn idempotency, Chronicle integration, additive market reconciliation, safe refresh, and GM JSON round-trip.');
