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
  advanceFactionTurn(sector){
    sector.factionTurn=Number(sector.factionTurn||0)+1;
    const faction=(sector.factions||[])[0]; if(faction)faction.factionCredits=Number(faction.factionCredits||0)+1;
    return [{factionId:'F1',action:'hold',result:'Success'}];
  }
};
[
  'simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js',
  'simulation/settlement-engine.js','simulation/trade-contract-engine.js','simulation/transport-engine.js',
  'simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/political-engine.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const get=name=>vm.runInContext(name,context);
const Sim=get('SectorSimulation'), Economy=get('SectorEconomy'), Settlement=get('SectorSettlement');
const Logistics=get('SectorLogistics'), Diplomacy=get('SectorDiplomacy'), Politics=get('SectorPolitics');
const sector={
  name:'Politics and turn transaction test',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:10,rows:12},
  systems:[
    {id:'A',name:'Aster',x:0,y:0,controllingFactionId:'F1',polityId:'P1',planets:[{id:'WA',name:'Aster Prime',population:'several million inhabitants',techLevel:'3',tag1:'Oceanic World'}]},
    {id:'B',name:'Boreal',x:1,y:0,controllingFactionId:'F2',polityId:'P2',planets:[{id:'WB',name:'Boreal Prime',population:'several million inhabitants',techLevel:'4',tag1:'Heavy Industry'}]}
  ],
  markets:[
    {id:'MA',systemId:'A',planetId:'WA',planetName:'Aster Prime',systemName:'Aster',population:'several million inhabitants',techLevel:'3',profile:'Agrarian exporter',traits:['Oceanic World'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]},
    {id:'MB',systemId:'B',planetId:'WB',planetName:'Boreal Prime',systemName:'Boreal',population:'several million inhabitants',techLevel:'4',profile:'Industrial exchange',traits:['Heavy Industry'],goods:[{name:'Food',category:'Food',basePrice:100,priceIndex:100},{name:'Medical compounds',category:'Medical',basePrice:500,priceIndex:100}]}
  ],
  factions:[{id:'F1',name:'Aster League',factionCredits:10,assets:[]},{id:'F2',name:'Boreal Compact',factionCredits:10,assets:[]}],
  polities:[{id:'P1',name:'Aster Commonwealth',capitalSystemId:'A',memberSystemIds:['A'],relations:[]},{id:'P2',name:'Boreal Union',capitalSystemId:'B',memberSystemIds:['B'],relations:[]}],
  diplomacy:[{id:'D1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:1}],
  tradeRoutes:[{id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:1,tollPerUnit:0,operatingCostPerUnit:0,riskPercent:0}]
};
Sim.migrateSector(sector,{sourceApplicationVersion:'1.3.7'});
Politics.initialize(sector);
Economy.initializeSector(sector);
Settlement.initialize(sector);
Logistics.initialize(sector);

const politicalScenario=JSON.parse(JSON.stringify(sector));
// Polity relation vocabulary and direction are distinct from faction diplomacy.
const polityRel=Politics.setPolityRelation(politicalScenario,'P1','P2','trade pact');
assert.equal(polityRel.type,'trade pact');
assert.equal(politicalScenario.diplomacy[0].state,'Neutral');
assert.equal(politicalScenario.polities[1].relations.length,0,'A directed polity relationship must not silently create a reciprocal record.');
let policy=Politics.getTradeAccess(politicalScenario,'A','B','food');
assert.equal(policy.allowed,true);
assert.ok(policy.tariffDelta<0,'A polity trade pact should reduce the local border tariff.');
policy=Politics.getTradeAccess(politicalScenario,'B','A','food');
assert.equal(policy.tariffDelta,0,'A directed polity relationship must not silently govern the reverse route.');

// Treaty proposals, ratification, terms, and activation turn.
const treaty=Politics.proposeTreaty(politicalScenario,{name:'Aster-Boreal Trade Compact',type:'trade pact',parties:[{type:'faction',id:'F1'},{type:'faction',id:'F2'}],terms:{tradeAccess:'preferred',tariffPercent:1,transitRights:true},endTurn:4});
assert.equal(treaty.status,'proposed');
assert.equal(Politics.getTreaties(politicalScenario).length,1);
Politics.respondToTreaty(politicalScenario,treaty.id,'accept',{type:'faction',id:'F2'});
assert.equal(treaty.status,'active');
assert.equal(treaty.startTurn,1);
assert.equal(Politics.renewTreaty(politicalScenario,treaty.id,6,'Extend compact').endTurn,6);
assert.throws(()=>Politics.renewTreaty(politicalScenario,treaty.id,5),/extend/);
assert.equal(Politics.breachTreaty(politicalScenario,treaty.id,{type:'faction',id:'F2'},'Violated transit terms').status,'breached');
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','food').allowed,true,'A breached treaty is no longer an active trade policy.');
const replacementTreaty=Politics.proposeTreaty(politicalScenario,{name:'Aster-Boreal Trade Compact II',type:'trade pact',parties:[{type:'faction',id:'F1'},{type:'faction',id:'F2'}],terms:{tradeAccess:'preferred',tariffPercent:1,transitRights:true},endTurn:4});
Politics.respondToTreaty(politicalScenario,replacementTreaty.id,'accept',{type:'faction',id:'F2'});
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','food').tariffDelta,-4,'The existing polity pact remains the only preferential policy before the faction treaty starts.');
assert.throws(()=>Politics.respondToTreaty(politicalScenario,treaty.id,'reject'),/pending/);

// Sanctions have explicit scope and start on the next campaign turn.
const sanction=Politics.imposeSanction(politicalScenario,{issuerType:'faction',issuerId:'F1',targetType:'faction',targetId:'F2',kind:'trade embargo',direction:'both',commodityIds:['medical-compounds'],endTurn:2});
assert.equal(sanction.startTurn,1);
policy=Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds');
assert.equal(policy.allowed,true,'A future-dated sanction must not affect the current turn.');
policy=Politics.getTradeAccess(politicalScenario,'A','B','food');
assert.equal(policy.allowed,true,'A commodity-specific embargo must not block unrelated goods.');
politicalScenario.factionTurn=1; Sim.syncLegacyTurn(politicalScenario);
policy=Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds');
assert.equal(policy.allowed,false,'The scoped sanction must take effect on its recorded start turn.');

// War, humanitarian exceptions, ceasefire, and peace transitions.
Politics.liftSanction(politicalScenario,sanction.id,'Test isolation before war checks');
const war=Politics.declareWar(politicalScenario,{type:'faction',id:'F1'},{type:'faction',id:'F2'},{humanitarianCommodityIds:['food']});
assert.equal(war.status,'active');
assert.equal(politicalScenario.diplomacy[0].state,'Neutral','A future-dated war must not rewrite the faction relationship early.');
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds').allowed,true,'A war declared between turns must not take effect prematurely.');
politicalScenario.factionTurn=2; Sim.syncLegacyTurn(politicalScenario);
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds').allowed,false);
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','food').allowed,true,'Declared war must retain explicit humanitarian exceptions.');
assert.equal(Politics.advanceTurn(politicalScenario,1).skipped,false);
const politicsTurn=Politics.advanceTurn(politicalScenario,2);
assert.equal(politicsTurn.skipped,false);
assert.equal(politicalScenario.diplomacy[0].state,'Open conflict','Faction diplomacy reflects war only when the declaration becomes effective.');
assert.equal(Politics.advanceTurn(politicalScenario,2).skipped,true);
Politics.declareCeasefire(politicalScenario,war.id,{untilTurn:4});
assert.equal(war.status,'ceasefire');
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds').allowed,false,'The previous war remains in force until the ceasefire start turn.');
politicalScenario.factionTurn=3; Sim.syncLegacyTurn(politicalScenario);
policy=Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds');
assert.equal(policy.allowed,true,'Ceasefire should reopen the border with restrictions.');
assert.ok(policy.tariffDelta>=7&&policy.riskModifier>=5);
Politics.makePeace(politicalScenario,war.id,{settlement:'Border accord'});
assert.equal(war.status,'peace-pending');
policy=Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds');
assert.equal(policy.allowed,true,'A signed peace settlement should preserve the ceasefire until its effective turn.');
assert.ok(policy.tariffDelta>=7&&policy.riskModifier>=5,'A peace-pending status must not accidentally remove restrictions from an already-started ceasefire.');
politicalScenario.factionTurn=4; Sim.syncLegacyTurn(politicalScenario);
Politics.advanceTurn(politicalScenario,3);
const peaceTurn=Politics.advanceTurn(politicalScenario,4);
assert.equal(peaceTurn.skipped,false);
assert.equal(war.status,'peace');
assert.equal(Politics.getTradeAccess(politicalScenario,'A','B','medical-compounds').allowed,true,'Effective peace should remove wartime route restrictions.');

// Verify clock progression is sequenced and idempotent.
assert.equal(sanction.status,'lifted');
const financialRestriction=Politics.imposeSanction(politicalScenario,{issuerType:'faction',issuerId:'F1',targetType:'faction',targetId:'F2',kind:'financial restriction',direction:'both'});
financialRestriction.startTurn=1;
policy=Politics.getTradeAccess(politicalScenario,'A','B','food');
assert.equal(policy.allowed,true,'A financial restriction does not itself embargo trade or freeze settlement accounts.');
assert.ok(policy.riskModifier>=4,'The referee-facing financial restriction contributes its documented border-risk modifier.');
Politics.liftSanction(politicalScenario,financialRestriction.id,'Clear the financial-risk test.');
assert.equal(Politics.validate(politicalScenario).ok,true);

// Cross-engine campaign turn transaction: a later-phase fault must leave the live
// sector completely unchanged; a subsequent successful run commits all phases.
const snapshot=JSON.stringify(sector);
const realAdvance=Economy.advanceTurn;
Economy.advanceTurn=function(){throw new Error('injected logistics/economy failure');};
assert.throws(()=>Sim.advanceCampaignTurn(sector),/previous sector state has been preserved/);
assert.equal(JSON.stringify(sector),snapshot,'Failure must roll back faction actions, history, clock, and Chronicle state.');
Economy.advanceTurn=realAdvance;
const committed=Sim.advanceCampaignTurn(sector);
assert.equal(committed.ok,true);
assert.equal(committed.turn,1);
assert.equal(sector.factionTurn,1);
assert.equal(sector.factions[0].factionCredits,11);
assert.equal(sector.simulation.turnCoordinator.lastCommittedTurn,1);
assert.equal(Sim.validateTurnCoordinator(sector).ok,true);
assert.ok(sector.simulation.chronicle.events.some(e=>e.type==='campaign-turn-committed'));
assert.equal(Sim.advanceCampaignTurn(sector).turn,2,'A new explicit command advances exactly one new turn.');
assert.equal(Sim.validateTurnCoordinator(sector).ok,true);

console.log('PASS: 1.3.8 political system and transaction coordinator — directed polity relations, treaty proposals/ratification/expiry, scoped sanctions, war/humanitarian exceptions/ceasefire/peace, border policy, rollback on injected failure, atomic campaign commit, turn journal, and save-safe validation.');
