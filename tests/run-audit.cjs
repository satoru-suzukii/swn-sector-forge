const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const failures = [];
const ctx = {
  console: { log(){}, warn(){}, error(){} }, Set, Map, Math, JSON, Date, URL, URLSearchParams,
  document: { getElementById(){ return { textContent:'', innerHTML:'' }; } }
};
ctx.TextLoad = {
  load(url, cb) { try { cb(fs.readFileSync(path.join(root, url), 'utf8').split(/[\n\r]+/)); } catch (e) { cb([]); } },
  onAllLoad(cb) { cb(); }
};
vm.createContext(ctx);
const modules = [
  'generators/genutil.js','generators/namegen.js','generators/swnnamegen.js',
  'generators/buzzword_generator.js','generators/world-terrain-generator.js',
  'generators/star-system-generator.js','generators/world-generator.js',
  'generators/corporation-generator.js','generators/religion-generator.js',
  'generators/political-group-generator.js','generators/alien-generator.js',
  'generators/campaign-tools.js'
];
for (const file of modules) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename:file });
const run = expr => vm.runInContext(expr, ctx);
const assert = (condition, message) => { if (!condition) failures.push(message); };
const coreRuns = Math.max(100, Number(process.env.SWN_CORE_RUNS || 2000));
const expandedRuns = Math.max(50, Number(process.env.SWN_EXPANDED_RUNS || 500));
const factionSectors = Math.max(1, Number(process.env.SWN_FACTION_SECTORS || 15));
const stats = { runs:coreRuns, crashes:0, systems:0, planets:0, duplicateCoords:0, emptySystems:0, duplicateTags:0, missingBodies:0, missingTerrain:0, missingDescriptions:0, invalidPopulation:0, missingIds:0, routesOver3:0, danglingRoutes:0, marketsMissingWorld:0, badDiplomacyRefs:0, badInfluenceRefs:0, badCorporateLinks:0, badMarketRouteLinks:0, emptyAdventure:0, emptyFaction:0, emptyThreat:0, emptyPeople:0, extraToolErrors:0 };
const goodPopulation = new Set(['failed colony','outpost','fewer than a million inhabitants','several million inhabitants','hundreds of millions of inhabitants','billions of inhabitants','alien inhabitants']);
for (let i=0; i<stats.runs; i++) {
  try {
    const sector = { systems: run('WorldGenerator.generate()') };
    stats.systems += sector.systems.length;
    const coordSet = new Set();
    for (const system of sector.systems) {
      const coord = `${system.x},${system.y}`;
      if (coordSet.has(coord)) stats.duplicateCoords++;
      coordSet.add(coord);
      if (!system.bodies || !system.bodies.length) stats.missingBodies++;
      if (system.planets.some(p=>!(system.bodies||[]).some(b=>b.planetId===p.id))) failures.push('Survey missing linked planet: '+system.id);
      if (!system.planets || !system.planets.length) stats.emptySystems++;
      if (!system.id) stats.missingIds++;
      stats.planets += system.planets.length;
      for (const planet of system.planets) {
        if (planet.tag1 === planet.tag2) stats.duplicateTags++;
        if (!goodPopulation.has(planet.population)) stats.invalidPopulation++;
        if (!planet.terrain) stats.missingTerrain++;
        if (!planet.description) stats.missingDescriptions++;
        if (!planet.id || !planet.systemId) stats.missingIds++;
      }
    }
    assert(sector.systems.length >= 21 && sector.systems.length <= 30, 'System count outside 21-30');
    assert(new Set(sector.systems.flatMap(s => s.planets.map(p => p.id))).size === sector.systems.reduce((n,s)=>n+s.planets.length,0), 'Duplicate world IDs');
  } catch (e) { stats.crashes++; if (stats.crashes < 4) failures.push('generation crash: '+e.message); }
}
// Exercise campaign enrichment against a real generated sector and inspect graph/data integrity.
try {
  ctx.__sector = { systems:run('WorldGenerator.generate()'), politicalGroups:run('PoliticalGroupGenerator.generate()'), corporations:run('CorporationGenerator.generate()'), religions:run('ReligionGenerator.generate()') };
  run('CampaignTools.enrichSector(globalThis.__sector, false)');
  const s = ctx.__sector;
  for (const route of s.tradeRoutes) {
    const a = s.systems.find(x=>x.id===route.fromSystemId), b = s.systems.find(x=>x.id===route.toSystemId);
    if (!a || !b) stats.danglingRoutes++;
    else if (ctx.CampaignTools.hexDistance(a,b)>3) stats.routesOver3++;
  }
  const worldIds = new Set(s.systems.flatMap(system=>system.planets.map(p=>p.id)));
  const worldSystem = new Map(s.systems.flatMap(system=>system.planets.map(p=>[p.id,system.id])));
  const factionIds = new Set(s.factions.map(f=>f.id));
  const corporationIds = new Set(s.corporations.map(c=>c.id));
  const marketIds = new Set(s.markets.map(m=>m.id));
  const routeIds = new Set(s.tradeRoutes.map(r=>r.id));
  const diplomacyPairs = new Set();
  for (const rel of (s.diplomacy||[])) {
    const key = [rel.factionAId,rel.factionBId].sort().join('|');
    if (!factionIds.has(rel.factionAId) || !factionIds.has(rel.factionBId) || rel.factionAId===rel.factionBId || diplomacyPairs.has(key)) stats.badDiplomacyRefs++;
    diplomacyPairs.add(key);
  }
  if (diplomacyPairs.size !== s.factions.length*(s.factions.length-1)/2) stats.badDiplomacyRefs++;
  for (const system of s.systems) {
    if (!Array.isArray(system.factionInfluence)) stats.badInfluenceRefs++;
    if (system.controllingFactionId && !factionIds.has(system.controllingFactionId)) stats.badInfluenceRefs++;
    if (system.manualControllerFactionId && !factionIds.has(system.manualControllerFactionId)) stats.badInfluenceRefs++;
    for (const influence of (system.factionInfluence||[])) if (!factionIds.has(influence.factionId)) stats.badInfluenceRefs++;
  }
  for (const market of s.markets) {
    if (!worldIds.has(market.planetId)) stats.marketsMissingWorld++;
    if (worldSystem.get(market.planetId)!==market.systemId) stats.badMarketRouteLinks++;
    for (const routeId of (market.routeIds||[])) if (!routeIds.has(routeId)) stats.badMarketRouteLinks++;
    for (const corporationId of (market.linkedCorporationIds||[])) {
      const corp = s.corporations.find(c=>c.id===corporationId);
      if (!corp || !(corp.linkedMarketIds||[]).includes(market.id)) stats.badCorporateLinks++;
    }
    for (const good of (market.goods||[])) if (!Number.isFinite(Number(good.localPrice)) || Number(good.localPrice)<=0) stats.badMarketRouteLinks++;
  }
  for (const link of (s.corporationMarketLinks||[])) {
    const corp = s.corporations.find(c=>c.id===link.corporationId), market = s.markets.find(m=>m.id===link.marketId);
    if (!corporationIds.has(link.corporationId)||!marketIds.has(link.marketId)||!corp||!market||!(corp.linkedMarketIds||[]).includes(link.marketId)||!(market.linkedCorporationIds||[]).includes(link.corporationId)) stats.badCorporateLinks++;
    if (market && (link.systemId!==market.systemId || link.planetId!==market.planetId)) stats.badCorporateLinks++;
  }
  if (!s.adventures.length || s.adventures.some(x=>!x.title||!x.objective)) stats.emptyAdventure++;
  if (!s.factions.length || s.factions.some(x=>!x.id||!x.assets)) stats.emptyFaction++;
  if (!s.threats.length || s.threats.some(x=>!x.name||!x.hp)) stats.emptyThreat++;
  if (!s.people.length || s.people.some(x=>!x.name||!x.motive)) stats.emptyPeople++;
  for (const type of ['espionage','merchant','military','naval','vehicle','character','cyberpunk','sorcery','outpost','ruin','relic','site','person']) {
    const result = run(`CampaignTools.generateSupplement(${JSON.stringify(type)}, globalThis.__sector, '')`);
    if (!result || !result.title || !result.details) stats.extraToolErrors++;
  }
} catch (e) { stats.extraToolErrors++; failures.push('campaign enrichment error: '+e.stack); }
// Expanded World Generation stress, table values, and derived population outputs.
let expandedCrashes = 0, expandedMissingEstimate = 0, expandedInvalidTech = 0;
const validExpandedTech = new Set(['0','1','2','3','3+','4-','4','4+','5']);
for (let i=0; i<expandedRuns; i++) {
  try {
    const systems = run("WorldGenerator.generate({worldGenerationMode:'expanded'})");
    for (const system of systems) for (const planet of system.planets) {
      if (!planet.populationEstimate || !planet.expandedPopulationType) expandedMissingEstimate++;
      if (!validExpandedTech.has(String(planet.techLevel))) expandedInvalidTech++;
    }
  } catch (e) { expandedCrashes++; if (expandedCrashes < 3) failures.push('expanded generation crash: '+e.message); }
}
assert(expandedCrashes===0, `Expanded generation crashes: ${expandedCrashes}`);
assert(expandedMissingEstimate===0, `Expanded worlds missing population data: ${expandedMissingEstimate}`);
assert(expandedInvalidTech===0, `Expanded worlds invalid tech labels: ${expandedInvalidTech}`);
const coreTech = run("WorldGenerator.techlevels.map(x=>x.value).join(',')");
assert(coreTech==='0,1,2,3,3,4,4,4,4,4+,5', `Unexpected Revised core tech table: ${coreTech}`);
const populationRolls = run("WorldGenerator.populations.map(x=>x.name).join('|')");
assert(populationRolls==='failed colony|outpost|fewer than a million inhabitants|fewer than a million inhabitants|several million inhabitants|several million inhabitants|several million inhabitants|hundreds of millions of inhabitants|hundreds of millions of inhabitants|billions of inhabitants|alien inhabitants', 'Unexpected Revised core population table');
const expandedTechTable = run('JSON.stringify(WorldGenerator.expandedTechTable)');
const expectedExpandedTechTable = JSON.stringify([
  ['0','2','0','0','1'], ['0','3','0','0','2'], ['0','3+','1','1','3'],
  ['0','4-','2','2','3+'], ['0','4-','3','3','4-'], ['0','4-','3+','3+','4-'],
  ['0','4-','4-','4-','4'], ['0','4-','4-','4-','4'], ['1','4-','4-','4','4'],
  ['1','4','4','4','4+'], ['1','4','4','4+','4+'], ['2','4+','4+','5','5'],
  ['3','5','5','4+','4+']
]);
assert(expandedTechTable===expectedExpandedTechTable, 'Expanded World Generation tech table changed or was misindexed');

// Migrate a legacy-style sector with missing IDs, unnormalized population, and no survey.
let legacyMigrationFailures = 0;
try {
  const tagNames = run('WorldGenerator.tags.slice(0,2).map(t=>t.name)');
  ctx.__legacy = {name:'Legacy Test Sector', systems:[{name:'Old Station',x:0,y:0,planets:[{name:'Old World',atmosphere:'breathable',temperature:'temperate',biosphere:'human-miscible',gravity:'standard',population:'M 1+',techLevel:'4',tag1:tagNames[0],tag2:tagNames[1]}]}]};
  run('CampaignTools.enrichSector(globalThis.__legacy, true)');
  const legacy = ctx.__legacy, ls = legacy.systems[0], lp = ls.planets[0];
  if (legacy.schemaVersion !== 3 || !ls.id || !lp.id || lp.population !== 'several million inhabitants' || !lp.terrain || !lp.description || !(ls.bodies||[]).some(b=>b.planetId===lp.id) || !legacy.markets.some(m=>m.planetId===lp.id)) legacyMigrationFailures++;
} catch (e) { legacyMigrationFailures++; failures.push('legacy migration error: '+e.stack); }
assert(legacyMigrationFailures===0, `Legacy sector migration failures: ${legacyMigrationFailures}`);

// A player-mode import must not get hidden GM tags copied into its description.
let playerMigrationLeaks = 0;
try {
  ctx.__playerLegacy = {name:'Player Test Sector',gmMode:false,systems:[{name:'Player System',x:0,y:0,planets:[{name:'Public World',population:'several million inhabitants',techLevel:'3',atmosphere:'breathable',temperature:'temperate',biosphere:'human-miscible',gravity:'standard'}]}]};
  run('CampaignTools.enrichSector(globalThis.__playerLegacy, true)');
  const lp = ctx.__playerLegacy.systems[0].planets[0];
  if (/known for/i.test(lp.description) || /secret tag|trade hub/i.test(lp.description) || lp.terrain) playerMigrationLeaks++;
} catch (e) { playerMigrationLeaks++; failures.push('player migration error: '+e.stack); }
assert(playerMigrationLeaks===0, `Player-mode migration privacy failures: ${playerMigrationLeaks}`);

// Advance faction engines over multiple turns and validate assets, funds, and state.
let factionTurnCrashes = 0, factionBadAssets = 0, factionBadCredits = 0, factionTurnEvents = 0;
for (let i=0; i<factionSectors; i++) {
  try {
    const systems = run('WorldGenerator.generate()');
    ctx.__turnSector = {systems, politicalGroups:run('PoliticalGroupGenerator.generate()'), corporations:run('CorporationGenerator.generate()'), religions:run('ReligionGenerator.generate()')};
    run('CampaignTools.enrichSector(globalThis.__turnSector, false)');
    for (let t=0; t<12; t++) factionTurnEvents += run('CampaignTools.advanceFactionTurn(globalThis.__turnSector)').length;
    const factions = ctx.__turnSector.factions;
    const assetIds = new Set();
    for (const faction of factions) {
      if (!Number.isFinite(Number(faction.factionCredits)) || Number(faction.factionCredits)<0) factionBadCredits++;
      for (const asset of faction.assets) {
        if (!asset.id || assetIds.has(asset.id) || Number(asset.hp)<0 || Number(asset.maxHp)<1) factionBadAssets++;
        assetIds.add(asset.id);
        if (Number(asset.hp)>Number(asset.maxHp)) factionBadAssets++;
      }
    }
  } catch (e) { factionTurnCrashes++; if (factionTurnCrashes<3) failures.push('faction turn crash: '+e.stack); }
}
assert(factionTurnCrashes===0, `Faction simulation crashes: ${factionTurnCrashes}`);
assert(factionBadAssets===0, `Invalid faction asset states/IDs: ${factionBadAssets}`);
assert(factionBadCredits===0, `Invalid faction credit balances: ${factionBadCredits}`);
assert(factionTurnEvents>0, 'Faction turn engine produced no events');

// Density preset audit: each setting is independent, bounded, and the Empty profile
// is a valid sector shape rather than a crash or a phantom system/world collection.
const densityAudit = {systemCounts:{}, worldCounts:{}, emptySectorEnriched:false, failures:[]};
function generateDensity(systemDensity, worldDensity) {
  return run('WorldGenerator.generate(' + JSON.stringify({systemDensity, worldDensity}) + ')');
}
const densitySystemCases = [
  ['empty', 0, 0], ['scarce', 8, 14], ['normal', 31, 40], ['crowded', 45, 65]
];
for (const [preset, min, max] of densitySystemCases) {
  const generated = generateDensity(preset, 'empty');
  densityAudit.systemCounts[preset] = generated.length;
  assert(generated.length >= min && generated.length <= max, `${preset} system density produced ${generated.length} systems, expected ${min}-${max}`);
  assert(generated.every(s => Array.isArray(s.planets) && s.planets.length === 0 && Array.isArray(s.pointsOfInterest) && s.pointsOfInterest.length === 0 && (s.bodies||[]).every(b => b.bodyClass === 'S')), `${preset} + empty world content created planets, POIs, or non-star orbital objects`);
}
for (const preset of ['empty','scarce','normal','crowded']) {
  const generated = generateDensity('scarce', preset);
  const statsForPreset = {systems:generated.length, planets:0, poi:0, extras:0};
  for (const system of generated) {
    const planets = (system.planets||[]).length;
    const poi = (system.pointsOfInterest||[]).length;
    const extras = (system.bodies||[]).filter(b => b.bodyClass !== 'S' && b.bodyClass !== 'P').length;
    statsForPreset.planets += planets; statsForPreset.poi += poi; statsForPreset.extras += extras;
    if (preset==='empty' && (planets!==0 || poi!==0 || extras!==0)) failures.push('Empty world density is not empty');
    if (preset==='scarce' && (planets>2 || poi>2 || extras>2)) failures.push('Scarce world density exceeded a per-system cap');
    if (preset==='normal' && (planets<1 || planets>4 || poi>5 || extras<3 || extras>6)) failures.push('Normal world density is outside configured per-system bounds');
    if (preset==='crowded' && (planets<2 || planets>6 || poi<1 || poi>8 || extras<6 || extras>12)) failures.push('Crowded world density is outside configured per-system bounds');
  }
  densityAudit.worldCounts[preset] = statsForPreset;
}
assert(failures.length===0, 'Density preset bounds failed: '+failures.slice(0,5).join('; '));
try {
  ctx.__densityEmptySector = {name:'Empty test sector', gmMode:true, systems:[], corporations:[], religions:[], politicalGroups:[], aliens:[], regions:[]};
  run('CampaignTools.enrichSector(globalThis.__densityEmptySector, false)');
  densityAudit.emptySectorEnriched = ctx.__densityEmptySector.systems.length===0 && ctx.__densityEmptySector.tradeRoutes.length===0 && ctx.__densityEmptySector.markets.length===0 && Array.isArray(ctx.__densityEmptySector.factions);
  assert(densityAudit.emptySectorEnriched, 'Empty sector did not enrich into valid empty system/route/market arrays');
} catch (e) { failures.push('Empty sector enrichment failed: '+e.message); }

assert(stats.crashes===0, `Generation crashes: ${stats.crashes}`);
assert(stats.duplicateCoords===0, `Duplicate coordinates: ${stats.duplicateCoords}`);
assert(stats.duplicateTags===0, `Duplicate tag pairs: ${stats.duplicateTags}`);
assert(stats.missingBodies===0, `Missing system bodies: ${stats.missingBodies}`);
assert(stats.emptySystems===0, `Systems without a primary-world record: ${stats.emptySystems}`);
assert(stats.missingTerrain===0, `Worlds missing terrain: ${stats.missingTerrain}`);
assert(stats.missingDescriptions===0, `Worlds missing descriptions: ${stats.missingDescriptions}`);
assert(stats.invalidPopulation===0, `Invalid population labels: ${stats.invalidPopulation}`);
assert(stats.missingIds===0, `Missing IDs: ${stats.missingIds}`);
assert(stats.routesOver3===0, `Routes longer than 3 hexes: ${stats.routesOver3}`);
assert(stats.danglingRoutes===0, `Dangling route refs: ${stats.danglingRoutes}`);
assert(stats.marketsMissingWorld===0, `Markets pointing to missing worlds: ${stats.marketsMissingWorld}`);
assert(stats.badDiplomacyRefs===0, `Invalid or incomplete diplomacy relationships: ${stats.badDiplomacyRefs}`);
assert(stats.badInfluenceRefs===0, `Invalid faction territory/influence references: ${stats.badInfluenceRefs}`);
assert(stats.badCorporateLinks===0, `Broken corporate-market cross-links: ${stats.badCorporateLinks}`);
assert(stats.badMarketRouteLinks===0, `Broken market/world/route/price links: ${stats.badMarketRouteLinks}`);
assert(stats.emptyAdventure===0, 'Adventure seed data incomplete');
assert(stats.emptyFaction===0, 'Faction data incomplete');
assert(stats.emptyThreat===0, 'Threat data incomplete');
assert(stats.emptyPeople===0, 'People data incomplete');
assert(stats.extraToolErrors===0, `Supplement tool failures: ${stats.extraToolErrors}`);
const summary = {
  stressRuns:stats.runs, crashes:stats.crashes, expandedStressRuns:expandedRuns, expandedCrashes, expandedMissingEstimate, expandedInvalidTech, legacyMigrationFailures, playerMigrationLeaks, factionSimulationSectors:factionSectors, factionTurnsPerSector:12, factionTurnCrashes, factionTurnEvents, factionBadAssets, factionBadCredits,
  averageSystems:+(stats.systems/stats.runs).toFixed(2), averagePlanets:+(stats.planets/stats.runs).toFixed(2),
  duplicateCoords:stats.duplicateCoords, emptySystems:stats.emptySystems, duplicateTagPairs:stats.duplicateTags,
  missingBodies:stats.missingBodies, missingTerrain:stats.missingTerrain,
  missingDescriptions:stats.missingDescriptions, invalidPopulation:stats.invalidPopulation,
  missingIds:stats.missingIds, routesOver3Hexes:stats.routesOver3, danglingRoutes:stats.danglingRoutes,
  marketsMissingWorld:stats.marketsMissingWorld, badDiplomacyRefs:stats.badDiplomacyRefs, badInfluenceRefs:stats.badInfluenceRefs, badCorporateLinks:stats.badCorporateLinks, badMarketRouteLinks:stats.badMarketRouteLinks, incompleteAdventureBatches:stats.emptyAdventure,
  incompleteFactionBatches:stats.emptyFaction, incompleteThreatBatches:stats.emptyThreat,
  incompletePeopleBatches:stats.emptyPeople, supplementToolFailures:stats.extraToolErrors,
  worldTagCount:run('WorldGenerator.tags.length'), poiTableCount:run('WorldGenerator.pointsOfInterest.length'),
  densityAudit, overall:failures.length?'FAIL':'PASS', failures
};
console.log(JSON.stringify(summary,null,2));
if (failures.length) process.exitCode=1;
