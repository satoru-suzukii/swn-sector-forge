#!/usr/bin/env node
'use strict';

// Repeatable end-to-end turn benchmark. Uses the actual campaign coordinator,
// faction executor, economy, logistics, diplomacy, politics, settlement and
// strategic engines on a generated 36+ system / 70+ market sector.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = {
  console: {log(){},warn(){},error(){}}, Set, Map, Math, JSON, Date, URL, URLSearchParams,
  document: {getElementById(){return {textContent:'',innerHTML:''};}}
};
context.TextLoad = {
  load(url, callback) {try {callback(fs.readFileSync(path.join(root,url),'utf8').split(/[\n\r]+/));} catch (_) {callback([]);}},
  onAllLoad(callback) {if (callback) callback();}
};
vm.createContext(context);
const modules = [
  'generators/genutil.js','generators/namegen.js','generators/swnnamegen.js',
  'generators/buzzword_generator.js','generators/world-terrain-generator.js',
  'generators/star-system-generator.js','generators/world-generator.js',
  'generators/corporation-generator.js','generators/religion-generator.js',
  'generators/political-group-generator.js','generators/alien-generator.js',
  'simulation/trade-route-rules.js','generators/campaign-tools.js',
  'simulation/sector-simulation.js','simulation/economy-engine.js',
  'simulation/settlement-engine.js','simulation/trade-contract-engine.js',
  'simulation/transport-engine.js','simulation/logistics-engine.js',
  'simulation/diplomacy-engine.js','simulation/political-engine.js',
  'simulation/strategic-engine.js'
];
for (const file of modules) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const run = expression => vm.runInContext(expression,context);
const minimumSystems = Number(process.env.SWN_BENCH_MIN_SYSTEMS || 36);
const minimumMarkets = Number(process.env.SWN_BENCH_MIN_MARKETS || 70);
const turns = Math.max(1,Number(process.env.SWN_BENCH_TURNS || 14));
const maxTurnMs = Number(process.env.SWN_BENCH_MAX_TURN_MS || 10000);

let sector = null;
let generationAttempts = 0;
let best = null;
for (let attempt=0; attempt<40; attempt++) {
  generationAttempts++;
  const candidate = {
    name:'Sector Forge 1.4.1 full-campaign performance fixture',
    gmMode:true, schemaVersion:3,
    systems:run("WorldGenerator.generate({systemDensity:'normal',worldDensity:'normal'})"),
    corporations:run('CorporationGenerator.generate()'),
    religions:run('ReligionGenerator.generate()'),
    politicalGroups:run('PoliticalGroupGenerator.generate()'),
    aliens:run('AlienGenerator.generate()'), regions:[]
  };
  context.__sectorForgeBenchCandidate = candidate;
  run('CampaignTools.enrichSector(globalThis.__sectorForgeBenchCandidate, false)');
  const quality = {systems:candidate.systems.length,markets:(candidate.markets||[]).length};
  if (!best || quality.systems+quality.markets > best.systems+best.markets) best={candidate, ...quality};
  if (quality.systems>=minimumSystems && quality.markets>=minimumMarkets) {sector=candidate;break;}
}
if (!sector && best) sector=best.candidate;
assert.ok(sector,'Could not generate a benchmark sector.');
context.__sectorForgeBenchCandidate = sector;

run('SectorSimulation.migrateSector(globalThis.__sectorForgeBenchCandidate, {sourceApplicationVersion:"1.4.1"})');
run('SectorEconomy.initializeSector(globalThis.__sectorForgeBenchCandidate)');
run('SectorPolitics.initialize(globalThis.__sectorForgeBenchCandidate)');
assert.ok(sector.systems.length>=minimumSystems,'Benchmark sector has only '+sector.systems.length+' systems; need '+minimumSystems+'.');
assert.ok(sector.markets.length>=minimumMarkets,'Benchmark sector has only '+sector.markets.length+' markets; need '+minimumMarkets+'.');

const samples=[];
const dispatches=[];
for (let i=0;i<turns;i++) {
  const started=process.hrtime.bigint();
  const result=run('SectorSimulation.advanceCampaignTurn(globalThis.__sectorForgeBenchCandidate)');
  const elapsed=Number(process.hrtime.bigint()-started)/1e6;
  assert.ok(result&&result.ok,'Campaign coordinator failed to commit turn '+(i+1)+'.');
  samples.push(+elapsed.toFixed(2));
  dispatches.push(Number(result.economy&&result.economy.logistics&&result.economy.logistics.dispatch&&result.economy.logistics.dispatch.dispatched||0));
  const checks=run('({economy:SectorEconomy.validate(globalThis.__sectorForgeBenchCandidate),logistics:SectorLogistics.validate(globalThis.__sectorForgeBenchCandidate),settlement:SectorSettlement.validate(globalThis.__sectorForgeBenchCandidate),politics:SectorPolitics.validate(globalThis.__sectorForgeBenchCandidate),diplomacy:SectorDiplomacy.validate(globalThis.__sectorForgeBenchCandidate),strategy:SectorStrategic.validate(globalThis.__sectorForgeBenchCandidate),transport:SectorTransport.validate(globalThis.__sectorForgeBenchCandidate)})');
  for (const [name,check] of Object.entries(checks)) assert.ok(check&&check.ok, name+' validation failed after turn '+(i+1)+': '+JSON.stringify(check&&check.errors||check));
}
const sorted=samples.slice().sort((a,b)=>a-b);
const median=sorted[Math.floor(sorted.length/2)];
const p95=sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)];
const totalShipments=run('globalThis.__sectorForgeBenchCandidate.simulation.economy.logistics.shipments.length');
const delivered=run('globalThis.__sectorForgeBenchCandidate.simulation.economy.logistics.shipments.filter(s=>s.status==="delivered").length');
const summary={
  version:'1.4.1',overall:'PASS',generationAttempts,
  systems:sector.systems.length,markets:sector.markets.length,
  turnsCommitted:turns,turnMs:samples,medianTurnMs:+median.toFixed(2),p95TurnMs:+p95.toFixed(2),maxTurnMs:+Math.max(...samples).toFixed(2),
  dispatchesByTurn:dispatches,totalShipments,deliveredShipments:delivered,
  shipmentLegs:run('globalThis.__sectorForgeBenchCandidate.simulation.economy.logistics.shipments.reduce((n,s)=>n+(s.legs||[]).length,0)'),
  serializedBytes:Buffer.byteLength(JSON.stringify(sector)),maxAllowedTurnMs:maxTurnMs
};
assert.ok(summary.maxTurnMs<=maxTurnMs,'Campaign turn exceeded the configured '+maxTurnMs+' ms ceiling: '+summary.maxTurnMs+' ms.');
assert.ok(totalShipments>=0&&delivered>=0,'Shipment counters must be non-negative.');
console.log(JSON.stringify(summary,null,2));
