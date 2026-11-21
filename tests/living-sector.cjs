const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({console, Math, JSON, Number, String, Boolean, Array, Object, Map, Set, Date, RegExp, Error, TypeError, RangeError, parseInt, parseFloat});
context.CampaignTools = {
  TRADE_GOODS:[{name:'Fresh produce',category:'Agricultural',basePrice:120},{name:'Medical compounds',category:'Medical',basePrice:1600}],
  getDiplomaticRelation(sector,a,b){return (sector.diplomacy||[]).find(r=>(r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a))||null;},
  recordFactionTurn(){}, recalculateInfluence(){}, linkCampaignRecords(){}, updateMarkets(){}
};
for (const file of ['simulation/trade-route-rules.js','simulation/sector-simulation.js','simulation/economy-engine.js','simulation/settlement-engine.js','simulation/logistics-engine.js','simulation/diplomacy-engine.js','simulation/strategic-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
}
const Sim=vm.runInContext('SectorSimulation',context), Economy=vm.runInContext('SectorEconomy',context), Settlement=vm.runInContext('SectorSettlement',context), Logistics=vm.runInContext('SectorLogistics',context), Diplomacy=vm.runInContext('SectorDiplomacy',context), Strategic=vm.runInContext('SectorStrategic',context);
function makeSector(locked=false, automaticLock=false){
  const s={name:'1.3.5 Test Sector',schemaVersion:3,gmMode:true,factionTurn:0,grid:{columns:10,rows:12},
    systems:[
      {id:'A',name:'Origin',x:0,y:0,controllingFactionId:'F1',planets:[{id:'WA',name:'Origin World',population:'hundreds of millions of inhabitants',techLevel:'3',tag1:'Oceanic World',tag2:'Trade Hub'}]},
      {id:'B',name:'Relay',x:1,y:0,controllingFactionId:'F1',planets:[]},
      {id:'C',name:'Destination',x:2,y:0,controllingFactionId:'F2',planets:[{id:'WC',name:'Destination World',population:'several million inhabitants',techLevel:'5',tag1:'Heavy Industry',tag2:'Major Spaceyard'}]}
    ],
    markets:[
      {id:'MA',systemId:'A',planetId:'WA',systemName:'Origin',planetName:'Origin World',techLevel:'3',population:'hundreds of millions of inhabitants',profile:'Agrarian exporter',traits:['Oceanic World','Trade Hub'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'surplus'},{name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100,supply:'available'}]},
      {id:'MC',systemId:'C',planetId:'WC',systemName:'Destination',planetName:'Destination World',techLevel:'5',population:'several million inhabitants',profile:'Industrial exchange',traits:['Heavy Industry','Major Spaceyard'],goods:[{name:'Fresh produce',category:'Agricultural',basePrice:120,priceIndex:100,basePriceIndex:100,supply:'shortage'},{name:'Medical compounds',category:'Medical',basePrice:1600,priceIndex:100,basePriceIndex:100,supply:'shortage'}]}
    ],
    factions:[{id:'F1',name:'Origin League',wealth:4,assets:[],factionCredits:5},{id:'F2',name:'Destination Authority',wealth:3,assets:[],factionCredits:4}],
    corporations:[{id:'CORP-1',name:'Farline Freight',valuation:'growing'}],
    corporationMarketLinks:[{id:'L1',corporationId:'CORP-1',marketId:'MA'},{id:'L2',corporationId:'CORP-1',marketId:'MC'}],
    diplomacy:[{id:'DIP-1',factionAId:'F1',factionBId:'F2',state:'Neutral',trust:0,tension:2,fieldOverrides:locked?{trust:true,state:true}:undefined,automatic:automaticLock?false:undefined}],
    tradeRoutes:[
      {id:'R1',fromSystemId:'A',toSystemId:'B',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:2,tollPerUnit:1,riskPercent:0,operatorCorporationId:'CORP-1'},
      {id:'R2',fromSystemId:'B',toSystemId:'C',distance:1,kind:'trade',status:'Established',capacityPerTurn:100,transitTurns:1,freightCostPerUnit:2,tollPerUnit:0,riskPercent:0}
    ]
  };
  Sim.migrateSector(s,{sourceApplicationVersion:'1.3.5'}); Economy.initializeSector(s);
  let a=Economy.getMarketState(s,'MA').inventory.find(x=>x.commodityId==='fresh-produce');
  let c=Economy.getMarketState(s,'MC').inventory.find(x=>x.commodityId==='fresh-produce');
  a.targetStock=10;a.storageCapacity=500;a.onHand=240;c.targetStock=80;c.storageCapacity=500;c.onHand=0;
  if(locked){Sim.setFieldOverride(s.diplomacy[0],'trust',0);Sim.setFieldOverride(s.diplomacy[0],'state','Neutral');}
  Settlement.initialize(s);
  return s;
}

// Initial financial accounts have stable IDs and are idempotently preserved.
const sector=makeSector();
const initial=Settlement.getAccounts(sector).length;
assert.ok(initial>=5,'Faction, corporate, and system accounts should initialize.');
const corpAccount=Settlement.getAccounts(sector).find(a=>a.id==='corporation:CORP-1');
assert.ok(corpAccount && corpAccount.balance>0);
Settlement.initialize(sector);
assert.equal(Settlement.getAccounts(sector).length,initial,'Account initialization must be idempotent.');
const f1Before=Settlement.getAccounts(sector).find(a=>a.id==='faction:F1').balance;
const corpBefore=corpAccount.balance;
const totalBalanceBefore=Settlement.getAccounts(sector).reduce((sum,account)=>sum+Number(account.balance||0),0);

// Multi-hop trade settles each leg into actual accounts.
Economy.advanceTurn(sector,1);
const shipment=Logistics.getShipments(sector)[0];
assert.ok(shipment && shipment.legs.length===1);
assert.ok(shipment.legs[0].financiallySettled===true);
assert.ok(Settlement.getLedger(sector).length>=2,'Freight/toll/charges should post ledger transfers.');
const firstTransfer=Settlement.getLedger(sector)[0];
assert.equal(Number((firstTransfer.fromBalanceBefore-firstTransfer.amount).toFixed(2)),Number(firstTransfer.fromBalanceAfter.toFixed(2)));
assert.equal(Number((firstTransfer.toBalanceBefore+firstTransfer.amount).toFixed(2)),Number(firstTransfer.toBalanceAfter.toFixed(2)));
assert.ok(Settlement.getAccounts(sector).find(a=>a.id==='corporation:CORP-1').balance>corpBefore,'Named corporate route operator should receive freight revenue.');
assert.ok(Settlement.getAccounts(sector).find(a=>a.id==='faction:F1').balance<f1Before,'Origin faction should pay route charges.');
Economy.advanceTurn(sector,2); Economy.advanceTurn(sector,3);
assert.equal(shipment.status,'delivered');
assert.ok(shipment.legs.every(l=>l.financiallySettled===true));
assert.equal(Settlement.validate(sector).ok,true,JSON.stringify(Settlement.validate(sector).errors));
const totalBalanceAfter=Settlement.getAccounts(sector).reduce((sum,account)=>sum+Number(account.balance||0),0);
assert.ok(Math.abs(totalBalanceAfter-totalBalanceBefore)<0.011,'Settlement transfers must conserve total account balances.');
const ledgerCount=Settlement.getLedger(sector).length;
Economy.advanceTurn(sector,3);
assert.equal(Settlement.getLedger(sector).length,ledgerCount,'Duplicate turn cannot settle finance twice.');

// Trade should improve an unlocked relationship and produce strategic reports.
assert.ok(sector.diplomacy[0].trust>0,'Verified bilateral deliveries should improve trust.');
assert.ok(sector.simulation.chronicle.events.some(e=>e.category==='diplomacy'&&e.type==='relationship-evolved'));
assert.ok(Strategic.getFactionReports(sector).length===2);
assert.ok(Strategic.getCorporateReports(sector).length===1);
const destinationAccount=Economy.getMarketState(sector,'MC');
destinationAccount.inventory.find(x=>x.commodityId==='fresh-produce').targetStock=10000;
Economy.advanceTurn(sector,4);
assert.equal(Strategic.getMarketImportPriority(destinationAccount),'emergency','A severe shortage should set an emergency import signal.');
assert.equal(Strategic.validate(sector).ok,true);
const destinationState=Economy.getMarketState(sector,'MC');
destinationState.policies={automatic:false,importPriority:'low'};
assert.equal(Strategic.getMarketImportPriority(destinationState),'low','A GM-disabled automatic policy must retain its manual priority.');

// The diplomacy engine consumes the real CampaignTools factionNews event shape.
const hostile = makeSector();
hostile.factionNews = [{turn:1,factionId:'F1',factionName:'Origin League',action:'Attack',result:'Success',event:'Attacked a defender asset.',targetFactionId:'F2',targetFactionName:'Destination Authority',systemId:'A'}];
Diplomacy.advanceTurn(hostile,1);
assert.equal(hostile.diplomacy[0].trust,-1,'A hostile CampaignTools attack must reduce bilateral trust.');
assert.equal(hostile.diplomacy[0].tension,4,'A hostile CampaignTools attack must increase bilateral tension.');
assert.ok(hostile.simulation.chronicle.events.some(e=>e.category==='diplomacy'&&e.signals&&e.signals.attacks===1),'The Chronicle should explain the attack signal.');

// GM-locked trust and posture remain unchanged despite new trade evidence.
const locked=makeSector(true);
Economy.advanceTurn(locked,1); Economy.advanceTurn(locked,2); Economy.advanceTurn(locked,3);
assert.equal(locked.diplomacy[0].trust,0);
assert.equal(locked.diplomacy[0].state,'Neutral');
assert.equal(Diplomacy.validate(locked).ok,true);

// A full automatic=false lock protects every relationship dimension, not only posture.
const fullyLocked=makeSector(false,true);
Economy.advanceTurn(fullyLocked,1); Economy.advanceTurn(fullyLocked,2); Economy.advanceTurn(fullyLocked,3);
assert.equal(fullyLocked.diplomacy[0].trust,0);
assert.equal(fullyLocked.diplomacy[0].tension,2);
assert.equal(fullyLocked.diplomacy[0].state,'Neutral');

// A migrated 1.3.4 campaign resumes its clocks at its saved turn instead of replaying old turns.
const legacy=makeSector();
legacy.simulation.economy.clock.lastAdvancedTurn=6;
legacy.simulation.economy.clock.turn=6;
legacy.factionTurn=6;
legacy.simulation.economy.settlement.clock.lastSettledTurn=6;
Economy.advanceTurn(legacy,7);
assert.equal(legacy.simulation.diplomacy.clock.lastProcessedTurn,7);
assert.equal(legacy.simulation.strategy.clock.lastProcessedTurn,7);
assert.equal(legacy.simulation.economy.settlement.clock.lastSettledTurn,7);

// The credit threshold is diagnostic: overdrafts are visible but transfers still settle.
const overdraft=makeSector();
Settlement.getAccounts(overdraft).find(a=>a.id==='faction:F1').balance=-9000;
Economy.advanceTurn(overdraft,1);
assert.ok(Settlement.getLedger(overdraft).some(tx=>tx.fromAccountId==='faction:F1'&&tx.creditLimitExceeded===true),'Overdrafts must be flagged against the warning threshold.');

// Financial state and IDs survive a GM JSON round trip.
const roundTrip=JSON.parse(JSON.stringify(sector));
assert.equal(Settlement.validate(roundTrip).ok,true);
assert.equal(Settlement.getAccounts(roundTrip).length,Settlement.getAccounts(sector).length);
assert.equal(Settlement.getLedger(roundTrip).length,Settlement.getLedger(sector).length);
console.log('PASS: 1.3.5 finance settlement, balanced transfers, corporate route revenue, overdraft warnings, automatic diplomacy, full GM locks, strategic market priorities, corporate intelligence, legacy turn resumption, idempotency, and save round-trip.');
