#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const context={console:{log(){},warn(){},error(){}},Date,Math,Map,Set,Object,Array,String,Number,JSON,RegExp,Error,TypeError,RangeError,parseInt,parseFloat};
context.TextLoad={load(url,cb){try{cb(fs.readFileSync(path.join(root,url),'utf8').split(/[\n\r]+/));}catch(_){cb([]);}},onAllLoad(cb){if(cb)cb();}};
vm.createContext(context);
['generators/genutil.js','generators/namegen.js','generators/swnnamegen.js','generators/buzzword_generator.js','generators/world-terrain-generator.js','generators/star-system-generator.js','generators/world-generator.js','generators/alien-generator.js'].forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
const run=expression=>vm.runInContext(expression,context);
let core=0,expanded=0;
for(let i=0;i<500;i++){
 const c=run("WorldGenerator.generatePlanet('core')");
 assert.equal(c.generationMode,'core');
 assert.equal(c.tagCandidate3,'');
 assert.equal(c.populationEstimate,'');
 const e=run("WorldGenerator.generatePlanet('expanded')");
 assert.equal(e.generationMode,'expanded');
 assert.ok(e.tagCandidate3);
 assert.ok(e.populationEstimate);
 assert.notEqual(e.tagCandidate3,e.tag1);
 assert.notEqual(e.tagCandidate3,e.tag2);
 core++; expanded++;
}
let min=99,max=0;
for(let i=0;i<2000;i++){
 const aliens=run('AlienGenerator.generate()');
 min=Math.min(min,aliens.length); max=Math.max(max,aliens.length);
 assert.ok(aliens.length>=3&&aliens.length<=8,'Alien count outside generator contract.');
 assert.ok(aliens.every(a=>a&&a.name&&a.type&&a.body&&a.government),'Alien generator returned an incomplete species record.');
}
console.log(JSON.stringify({overall:'PASS',coreWorldSamples:core,expandedWorldSamples:expanded,alienCatalogSamples:2000,alienCountRangeObserved:[min,max],contracts:{coreSupplementFields:'intentionally absent',expandedSupplementFields:'required',alienCount:'3–8'}}));
