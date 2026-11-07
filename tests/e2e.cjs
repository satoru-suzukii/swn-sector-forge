#!/usr/bin/env node
/* Dependency-free browser E2E suite. Requires Node 22+ (global WebSocket) and Chromium. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const INLINE_MODE = process.env.E2E_INLINE === '1';
function inlinePage() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const virtualText = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.txt')) {
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        virtualText[relative] = fs.readFileSync(full, 'utf8').split(/[\n\r]+/);
      }
    }
  }
  walk(path.join(ROOT, 'generators', 'data'));
  const textData = JSON.stringify(virtualText);
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/i, (_, file) => '<style>\n' + fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/<\/style/gi, '<\\/style') + '\n</style>');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) => {
    if (file === 'textload.js') return '<script>let TextLoad=(function(){const data=' + textData + ';return {load:function(url,cb){if(cb)cb(data[url]||[]);},massLoad:function(items){for(const k in items)this.load(items[k],v=>items[k]=v);},onAllLoad:function(cb){if(cb)cb();}};})();</script>';
    return '<script>\n' + fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });
  return html;
}
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'};
function assert(ok, message) { if (!ok) throw new Error(message); }
function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  for (const name of ['chromium','chromium-browser','google-chrome','google-chrome-stable','chrome']) {
    try { const out=execFileSync('which',[name],{encoding:'utf8'}).trim(); if(out && fs.existsSync(out)) return out; } catch (_) {}
  }
  throw new Error('Chromium was not found. Set CHROME_BIN to a Chromium/Chrome executable.');
}
async function main() {
  const chrome=findChrome(); console.log('E2E start: Chromium '+chrome+(INLINE_MODE?' (inline offline mode)':''));
  const requests=[];
  const server=http.createServer((req,res)=>{
    let pathname; try { pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch (_) {res.writeHead(400);res.end();return;}
    if(pathname==='/') pathname='/index.html';
    const file=path.resolve(ROOT,'.'+pathname); requests.push({path:pathname,status:fs.existsSync(file)?200:404});
    if(!file.startsWith(ROOT+path.sep) && file!==path.join(ROOT,'index.html')) {res.writeHead(403);res.end('forbidden');return;}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('not found');return;}res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const port=server.address().port; console.log('E2E server http port '+port);
  const userDir=fs.mkdtempSync(path.join(os.tmpdir(),'sector-forge-e2e-'));
  const chromeProcess=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--no-proxy-server','--user-data-dir='+userDir,'--window-size=1440,1200',INLINE_MODE?'about:blank':'http://127.0.0.1:'+port],{stdio:'ignore'});
  let ws, serverClosed=false;
  try {
    const activePortFile=path.join(userDir,'DevToolsActivePort');
    let debugPort;
    for(let i=0;i<120;i++) { if(fs.existsSync(activePortFile)){const lines=fs.readFileSync(activePortFile,'utf8').trim().split(/\r?\n/);debugPort=Number(lines[0]);break;} await new Promise(r=>setTimeout(r,100)); }
    assert(debugPort,'Chrome DevTools did not start.'); console.log('E2E DevTools port '+debugPort);
    let targets=[];
    for(let i=0;i<50;i++){try{targets=await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();if(targets.some(t=>t.type==='page'))break;}catch(_){}await new Promise(r=>setTimeout(r,100));}
    const target=targets.find(t=>t.type==='page'); assert(target&&target.webSocketDebuggerUrl,'Could not locate a browser page target.'); console.log('E2E target '+target.url);
    ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let nextId=0;const pending=new Map();const errors=[];
    ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result||{});}else if(m.method==='Runtime.exceptionThrown'){errors.push((m.params.exceptionDetails.text||'JS exception')+' '+(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||''));}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){errors.push(m.params.args.map(a=>a.value||a.description||'').join(' '));}});
    function cmd(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
    async function evaluate(expression) {const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||''));return r.result&&r.result.value;}
    console.log('E2E websocket connected'); await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Log.enable'); console.log('E2E CDP enabled');
    if (INLINE_MODE) { const tree=await cmd('Page.getFrameTree'); await cmd('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:inlinePage()}); }
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    console.log('E2E evaluating app readiness');
    let appState={}; for(let i=0;i<200;i++){appState=await evaluate("({app:typeof App,ready:document.readyState,button:!!document.querySelector('#generate-button'),initialized:!!document.querySelector('#generator-container')&&!document.querySelector('#generator-container').classList.contains('hide-section'),modal:!!document.querySelector('.dynmodal-container'),body:document.body.innerText.slice(0,80)})");if(appState.app!=='undefined'&&appState.button&&appState.initialized)break;await new Promise(r=>setTimeout(r,50));}
    console.log('E2E app state',JSON.stringify(appState)); assert(appState.app!=='undefined'&&appState.button,'Application scripts did not initialize.');
    await evaluate("document.querySelector('#generate-button').click()"); console.log('E2E sector generation triggered');
    let mapState={}; for(let i=0;i<300;i++){mapState=await evaluate("({sector:typeof App!=='undefined'&&!!App.currentSector,hexes:document.querySelectorAll('#hexmap .hex-cell').length,viewer:document.querySelector('#viewer-container').className})");if(mapState.sector&&mapState.hexes===120)break;await new Promise(r=>setTimeout(r,50));}
    console.log('E2E map state',JSON.stringify(mapState)); if(!(mapState.sector&&mapState.hexes===120)){ console.log('E2E diagnostics',JSON.stringify(await evaluate("({body:document.body.innerText.slice(0,300),modal:document.querySelector('.dynmodal')?.innerText||document.querySelector('[role=dialog]')?.innerText,ready:document.readyState,textload:typeof TextLoad,performance:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,transfer:r.transferSize})).slice(-30)})"))); console.log('E2E browser errors',JSON.stringify(errors)); console.log('E2E requests',JSON.stringify(requests)); } assert(mapState.sector&&mapState.hexes===120,'Sector generation/map initialization timed out.'); if (process.env.E2E_SCREENSHOT) { await evaluate("const m=document.querySelector('#hexmap');window.scrollTo(0,Math.max(0,m.getBoundingClientRect().top-80))"); await new Promise(r=>setTimeout(r,150)); const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(process.env.E2E_SCREENSHOT,Buffer.from(shot.data,'base64')); console.log('E2E screenshot '+process.env.E2E_SCREENSHOT); }
    const baseline=await evaluate("({systems:App.currentSector.systems.length,markets:App.currentSector.markets.length,assets:App.currentSector.factions.reduce((n,f)=>n+f.assets.length,0),svg:document.querySelectorAll('#hexmap .hex-cell').length,allSvg:document.querySelector('#hexmap')?.tagName.toLowerCase()==='svg',marketCards:document.querySelectorAll('#markets-output .market-card').length})");
    assert(baseline.systems>=21 && baseline.systems<=30,'Generated sector does not have the expected system count.');
    assert(baseline.svg===120 && baseline.allSvg,'The map must be a crisp SVG containing 120 editable hexes.');
    const gridBounds=await evaluate("(()=>{const b=[...document.querySelectorAll('#hexmap .hex-cell polygon')].map(p=>p.getBBox());return {count:b.length,minX:Math.min(...b.map(r=>r.x)),minY:Math.min(...b.map(r=>r.y)),maxX:Math.max(...b.map(r=>r.x+r.width)),maxY:Math.max(...b.map(r=>r.y+r.height))}})()");
    assert(gridBounds.count===120&&gridBounds.minX>=0&&gridBounds.minY>=0&&gridBounds.maxX<=641&&gridBounds.maxY<=881,'One or more hex polygons render outside the map viewBox.');
    assert(baseline.marketCards===baseline.markets && baseline.markets>0,'Markets did not render all linked market cards.');
    const linkedCheck=await evaluate("(()=>({corpRows:document.querySelectorAll('#corp-market-links-output tbody tr').length,links:App.currentSector.corporationMarketLinks.length,linkIds:App.currentSector.corporationMarketLinks.every(l=>App.currentSector.corporations.some(c=>c.id===l.corporationId)&&App.currentSector.markets.some(m=>m.id===l.marketId)),allMarketsLinked:App.currentSector.markets.every(m=>m.systemId&&m.planetId&&Array.isArray(m.routeIds)&&Array.isArray(m.linkedCorporationIds)),routesValid:App.currentSector.tradeRoutes.every(r=>App.currentSector.systems.some(s=>s.id===r.fromSystemId)&&App.currentSector.systems.some(s=>s.id===r.toSystemId)),corporationDirectoryLinked:[...document.querySelectorAll('#corporations-output tbody tr')].some(r=>/[1-9][0-9]* linked/.test(r.children[2]?.textContent||''))}))()");
    assert(linkedCheck.corpRows===linkedCheck.links&&linkedCheck.links>0&&linkedCheck.linkIds&&linkedCheck.allMarketsLinked&&linkedCheck.routesValid&&linkedCheck.corporationDirectoryLinked,'Cross-record system/world/market/corporation/route links are incomplete.');

    // The map starts in safe browse mode: editing controls are entirely hidden. Faction
    // domination is separately optional and colors system hexes with the owning faction.
    const mapToggleInitial=await evaluate("(()=>{const controlled=App.currentSector.systems.find(s=>s.controllingFactionId),cell=controlled&&document.querySelector('#hexmap .hex-cell[data-hex-x=\"'+controlled.x+'\"][data-hex-y=\"'+controlled.y+'\"] polygon');return {edit:Hexmap._editMode,toolsHidden:document.querySelector('#map-edit-tools').hidden,moveHidden:!document.querySelector('#map-move-selected').getClientRects().length,domination:Hexmap._showFactionDomination,pressed:document.querySelector('#map-domination-toggle').getAttribute('aria-pressed'),rings:document.querySelectorAll('#hexmap .territory-ring').length,controlled:!!controlled,fill:cell&&cell.getAttribute('fill'),ownerColor:controlled&&controlled.controllingFactionColor,ownerName:controlled&&App.currentSector.factions.find(f=>f.id===controlled.controllingFactionId)?.name,legend:document.querySelector('.map-legend').textContent}})()");
    assert(!mapToggleInitial.edit&&mapToggleInitial.toolsHidden&&mapToggleInitial.moveHidden,'Map editing controls must be hidden when edit mode starts off.');
    assert(mapToggleInitial.domination&&mapToggleInitial.pressed==='true'&&mapToggleInitial.rings>0&&mapToggleInitial.controlled&&mapToggleInitial.fill===mapToggleInitial.ownerColor&&mapToggleInitial.legend.includes(mapToggleInitial.ownerName),'Faction domination did not color controlled system hexes and explain the faction colors.');
    await evaluate("document.querySelector('#map-domination-toggle').click()");
    const mapToggleOff=await evaluate("(()=>{const controlled=App.currentSector.systems.find(s=>s.controllingFactionId),cell=controlled&&document.querySelector('#hexmap .hex-cell[data-hex-x=\"'+controlled.x+'\"][data-hex-y=\"'+controlled.y+'\"] polygon');return {domination:Hexmap._showFactionDomination,pressed:document.querySelector('#map-domination-toggle').getAttribute('aria-pressed'),rings:document.querySelectorAll('#hexmap .territory-ring').length,systemRings:document.querySelectorAll('#hexmap .system-control').length,fill:cell&&cell.getAttribute('fill'),legend:document.querySelector('.map-legend').textContent,routes:document.querySelectorAll('#hexmap .route-line').length}})()");
    assert(!mapToggleOff.domination&&mapToggleOff.pressed==='false'&&mapToggleOff.rings===0&&mapToggleOff.systemRings===0&&mapToggleOff.fill==='#0d1725'&&mapToggleOff.routes>0,'Faction domination OFF must hide ownership colors/rings while preserving routes and neutral map coloring.');
    await evaluate("document.querySelector('#map-domination-toggle').click()");
    const mapToggleRestored=await evaluate("({domination:Hexmap._showFactionDomination,pressed:document.querySelector('#map-domination-toggle').getAttribute('aria-pressed'),rings:document.querySelectorAll('#hexmap .territory-ring').length})");
    assert(mapToggleRestored.domination&&mapToggleRestored.pressed==='true'&&mapToggleRestored.rings>0,'Faction domination could not be re-enabled.');
    console.log('PASS: safe default browse mode and independent faction-domination color toggle.');
    const gridImport=await evaluate("(()=>{const csv='Name,Entity Type,Location,Children,Neighbors,Parent,Occupation,Situation,Tags\\nHelios,System,0911,,Asterion,Sample Sector,,,\\nMeridian,Planet,0911,,,Helios,,,\\nStation One,Research Base,0911,,,Meridian,Researchers,Power failure,Pretech Archive';const s=SwnImport.fromCSV(csv,'Sample Sector.csv','preserve');return {isNative:typeof SwnImport.fromCSV==='function',grid:s.grid,systems:s.systems.length,x:s.systems[0].x,y:s.systems[0].y,worlds:s.systems[0].planets.length,sourceRows:s.swnImport.records.length,mode:s.importMetadata.mode,warnings:s.importMetadata.warnings.length}})()");
    assert(gridImport.isNative&&gridImport.grid.columns===10&&gridImport.grid.rows===12&&gridImport.systems===1&&gridImport.x===9&&gridImport.y===11&&gridImport.worlds===1&&gridImport.sourceRows===3&&gridImport.mode==='preserve','Sectors Without Number CSV import did not preserve records or map the 10×12 boundary correctly.');
    const boundaryEdit=await evaluate("(()=>({valid:SectorGrid.validCoordinates({grid:{columns:10,rows:12}},9,11),invalid:SectorGrid.validCoordinates({grid:{columns:10,rows:12}},10,11),hexes:document.querySelectorAll('#hexmap .hex-cell').length}))()");
    assert(boundaryEdit.valid&&!boundaryEdit.invalid&&boundaryEdit.hexes===120,'Grid coordinate validation does not match the 10×12 sector dimensions.');
    console.log('PASS: SWN CSV import smoke test and 10×12 boundary validation.');
    console.log('PASS: sector generation and SVG map ('+baseline.systems+' systems, '+baseline.markets+' markets, '+baseline.assets+' assets).');
    console.log('PASS: linked system/world/market/route/corporation IDs ('+linkedCheck.links+' corporate-market links).');

    // Advanced generation remains optional: its disclosure starts closed and untouched
    // defaults retain the original one-click 21–30-system / core-world output.
    const densityReport = await evaluate(`(()=>{
      const advanced=document.querySelector('#advanced-generation-options'),sys=document.querySelector('#system-density'),world=document.querySelector('#world-density');
      if(advanced.open)throw new Error('Advanced generation options must start collapsed');
      if(sys.value!=='default'||world.value!=='default')throw new Error('Density selectors must start at Default');
      function generate(s,w){sys.value=s;world.value=w;return App.generateSector();}
      const base=generate('default','default');
      if(base.systems.length<21||base.systems.length>30||base.systems.some(x=>!x.planets.length))throw new Error('Default generation behavior changed');
      const empty=generate('empty','empty');
      if(empty.systems.length!==0||empty.markets.length!==0||empty.tradeRoutes.length!==0)throw new Error('Empty sector did not remain structurally valid');
      const scarceSystems=generate('scarce','empty'),normalSystems=generate('normal','empty'),crowdedSystems=generate('crowded','empty');
      if(scarceSystems.systems.length<8||scarceSystems.systems.length>14)throw new Error('Scarce systems count outside 8–14');
      if(normalSystems.systems.length<31||normalSystems.systems.length>40)throw new Error('Normal systems count outside 31–40');
      if(crowdedSystems.systems.length<45||crowdedSystems.systems.length>65)throw new Error('Crowded systems count outside 45–65');
      const worldProfiles={};
      for(const density of ['empty','scarce','normal','crowded']){
        const sector=generate('scarce',density);
        const totals={systems:sector.systems.length,worlds:sector.systems.reduce((n,s)=>n+s.planets.length,0),sites:sector.systems.reduce((n,s)=>n+(s.pointsOfInterest||[]).length,0),orbitalObjects:sector.systems.reduce((n,s)=>n+(s.bodies||[]).filter(b=>b.bodyClass!=='S'&&b.bodyClass!=='B'&&b.bodyClass!=='P').length,0)};
        for(const s of sector.systems){const p=s.planets.length,q=(s.pointsOfInterest||[]).length,o=(s.bodies||[]).filter(b=>b.bodyClass!=='S'&&b.bodyClass!=='B'&&b.bodyClass!=='P').length;
          if(density==='empty'&&(p!==0||q!==0||o!==0))throw new Error('Empty content created world/site/orbital records');
          if(density==='scarce'&&(p>2||q>2||o>2))throw new Error('Scarce content exceeded bounds');
          if(density==='normal'&&(p<1||p>4||q>5||o<3||o>6))throw new Error('Normal content exceeded bounds');
          if(density==='crowded'&&(p<2||p>6||q<1||q>8||o<6||o>12))throw new Error('Crowded content exceeded bounds');
        }
        worldProfiles[density]=totals;
      }
      sys.value='default';world.value='default';
      return {advancedInitiallyCollapsed:!advanced.open,defaultSystems:base.systems.length,emptySystems:empty.systems.length,systemPresets:{scarce:scarceSystems.systems.length,normal:normalSystems.systems.length,crowded:crowdedSystems.systems.length},worldProfiles,selectorsRestored:sys.value==='default'&&world.value==='default'};
    })()`);
    assert(densityReport.advancedInitiallyCollapsed&&densityReport.defaultSystems>=21&&densityReport.defaultSystems<=30&&densityReport.emptySystems===0&&densityReport.selectorsRestored,'Advanced generation options or baseline defaults failed: '+JSON.stringify(densityReport));
    console.log('PASS: advanced system/world density presets ('+JSON.stringify(densityReport.systemPresets)+') and valid zero-system sectors.');

    // Exercise every generated System Survey, then stress the table with unusually long
    // descriptors/names at desktop, tablet, compact, and mobile viewport widths.
    const surveyReport = {systemsChecked:baseline.systems,viewportChecks:0,report:[],stressResults:[]};
    for (const width of [1440,1024,820,390]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:1200,deviceScaleFactor:1,mobile:width<600});
      const run = await evaluate(`(()=>{
        const inspector=document.querySelector('#inspector');
        const sector=App.currentSector;
        const original=Hexmap._state.selectedSystem || sector.systems[0];
        const currentWidth=innerWidth;
        const report=[];
        for(const sys of sector.systems){
          App.displaySystemInspector(inspector,sys,sector);
          const table=inspector.querySelector('.system-survey-table');
          if(!table)throw new Error('Missing System Survey table for '+sys.name);
          const rows=table.querySelectorAll('tbody > tr');
          if(rows.length!==(sys.bodies||[]).length)throw new Error('Survey row mismatch for '+sys.name);
          const rect=table.getBoundingClientRect(), panel=inspector.getBoundingClientRect();
          const cells=[...table.querySelectorAll('td')];
          const badCells=cells.filter(c=>c.clientWidth>0&&c.scrollWidth>c.clientWidth+1).length;
          report.push({system:sys.name,viewport:currentWidth,rows:rows.length,tableClient:table.clientWidth,tableScroll:table.scrollWidth,panelClient:inspector.clientWidth,panelScroll:inspector.scrollWidth,tableInside:rect.left>=panel.left-1&&rect.right<=panel.right+1,badCells});
        }
        const target=sector.systems.find(s=>Array.isArray(s.bodies)&&s.bodies.length)||sector.systems[0];
        const long='UNBROKEN-SURVEY-IDENTIFIER-'.repeat(7);
        const stress={...target,name:'Survey stress '+long,bodies:(target.bodies||[]).map((b,i)=>({...b,type:'Long descriptor '+long+' '+i,name:long+(b.name||''),worldName:b.worldName?long+b.worldName:b.worldName})),pointsOfInterest:[{name:long,type:'Unusual occurrence '+long,occupants:long,situation:'Detailed incident '+long}]};
        App.displaySystemInspector(inspector,stress,sector);
        const table=inspector.querySelector('.system-survey-table'), panel=inspector.getBoundingClientRect(), tr=table.getBoundingClientRect();
        const cells=[...table.querySelectorAll('td')];
        const poi=inspector.querySelector('.inspector-poi-table');
        const invalidPoiRows=inspector.querySelectorAll('.inspector-poi-body > tr, .inspector-poi-body > p > tr').length;
        const stressResult={viewport:currentWidth,rows:table.querySelectorAll('tbody > tr').length,expectedRows:stress.bodies.length,tableInside:tr.left>=panel.left-1&&tr.right<=panel.right+1,tableScroll:table.scrollWidth,tableClient:table.clientWidth,panelScroll:inspector.scrollWidth,panelClient:inspector.clientWidth,badCells:cells.filter(c=>c.clientWidth>0&&c.scrollWidth>c.clientWidth+1).length,normalWrapping:[...table.querySelectorAll('td')].every(c=>getComputedStyle(c).whiteSpace==='normal'&&getComputedStyle(c).overflowWrap==='anywhere'),poiRows:poi?poi.querySelectorAll('tbody > tr').length:0,invalidPoiRows};
        App.displaySystemInspector(inspector,original,sector);
        return {currentWidth,report,stressResult};
      })()`);
      assert(run.currentWidth===width,'Browser viewport did not resize to '+width+'px.');
      surveyReport.report.push(...run.report);
      surveyReport.viewportChecks+=run.report.length;
      surveyReport.stressResults.push(run.stressResult);
    }
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    assert(surveyReport.systemsChecked===baseline.systems&&surveyReport.viewportChecks===baseline.systems*4,'System Survey did not render every system across all viewport test passes.');
    assert(surveyReport.report.every(r=>r.tableInside&&r.tableScroll<=r.tableClient+1&&r.panelScroll<=r.panelClient+2&&r.badCells===0),'One or more generated System Survey tables overflow at a tested viewport: '+JSON.stringify(surveyReport.report.filter(r=>!r.tableInside||r.tableScroll>r.tableClient+1||r.panelScroll>r.panelClient+2||r.badCells!==0).slice(0,8)));
    assert(surveyReport.stressResults.every(r=>r.rows===r.expectedRows&&r.tableInside&&r.tableScroll<=r.tableClient+1&&r.panelScroll<=r.panelClient+2&&r.badCells===0&&r.normalWrapping),'Long-token System Survey layout stress test failed: '+JSON.stringify(surveyReport.stressResults));
    assert(surveyReport.stressResults.every(r=>r.poiRows===2&&r.invalidPoiRows===0),'Point-of-interest survey rows were not rendered as valid table rows.');
    // Imported station details must be visible/editable and survive both body sync and survey rerolls.
    const importedSurveyReport=await evaluate(`(()=>{
      const system=Hexmap._state.selectedSystem, inspector=document.querySelector('#inspector');
      const research={type:'Research Base',name:'Kepler 7',worldName:'Kepler 7',bodyClass:'N',isGeneratedWorld:false,sourceEntityId:'e2e-research',sourceEntityType:'researchBase',importedFromSWN:true,occupation:'Scientists from a major local corp',situation:'Perilous research underway',sourceParentName:'Meridian',sourceAttributes:{occupation:'Scientists from a major local corp',situation:'Perilous research underway'}};
      const moon={type:'Moon',name:'Tsyomatsa',worldName:'Tsyomatsa',bodyClass:'N',isGeneratedWorld:false,sourceEntityId:'e2e-moon',sourceEntityType:'moon',importedFromSWN:true,sourceParentName:'Meridian',sourceAttributes:{}};
      system.bodies.push(research,moon);
      App.displaySystemInspector(inspector,system,App.currentSector);
      const rows=[...inspector.querySelectorAll('.system-survey-table tbody tr')];
      const researchRow=rows.find(row=>row.textContent.includes('Kepler 7'));
      const moonRow=rows.find(row=>row.textContent.includes('Tsyomatsa'));
      const result={researchDetails:researchRow&&researchRow.cells[2].textContent,moonDetails:moonRow&&moonRow.cells[2].textContent,hasImportedEdit:!!(researchRow&&researchRow.querySelector('.survey-row-actions .textbutton'))};
      App.syncSystemBodies(system);
      result.survivesBodySync=(system.bodies||[]).includes(research)&&(system.bodies||[]).includes(moon);
      return result;
    })()`);
    assert(importedSurveyReport.researchDetails&&importedSurveyReport.researchDetails.includes('Occupation: Scientists from a major local corp')&&importedSurveyReport.researchDetails.includes('Situation: Perilous research underway'),'Imported research station details are not displayed in System Survey: '+JSON.stringify(importedSurveyReport));
    assert(importedSurveyReport.moonDetails&&importedSurveyReport.moonDetails.includes('No additional details were included'),'Source-empty moons should be clearly distinguished from failed imports: '+JSON.stringify(importedSurveyReport));
    assert(importedSurveyReport.hasImportedEdit&&importedSurveyReport.survivesBodySync,'Imported custom entities should be editable and survive system-body synchronization: '+JSON.stringify(importedSurveyReport));
    // Exercise the real survey reroll action after restoring the selected live system.
    await evaluate("document.querySelector('#inspector .system-survey-heading [aria-label=\"Reroll system survey\"]').click()");
    const rerolledSurvey=await evaluate("(()=>{const s=Hexmap._state.selectedSystem,table=document.querySelector('#inspector .system-survey-table');return {hasTable:!!table,rows:table?table.querySelectorAll('tbody > tr').length:0,bodies:(s.bodies||[]).length,hasWorlds:(s.planets||[]).every(p=>(s.bodies||[]).some(b=>b.planetId===p.id)),keptImported:(s.bodies||[]).some(b=>b.sourceEntityId==='e2e-research')&&(s.bodies||[]).some(b=>b.sourceEntityId==='e2e-moon'),wrap:table?getComputedStyle(table).tableLayout:'',overflow:table?table.scrollWidth>table.clientWidth:false}})()");
    assert(rerolledSurvey.hasTable&&rerolledSurvey.rows===rerolledSurvey.bodies&&rerolledSurvey.hasWorlds&&rerolledSurvey.keptImported&&rerolledSurvey.wrap==='fixed'&&!rerolledSurvey.overflow,'Rerolling the real System Survey broke linked worlds, custom imported entities, or fixed layout: '+JSON.stringify(rerolledSurvey));
    if (process.env.E2E_SURVEY_SCREENSHOT) {
      await evaluate("(()=>{const i=document.querySelector('#inspector'),m=document.querySelector('#hexmap');i.scrollTop=i.scrollHeight;window.scrollTo(0,Math.max(0,m.getBoundingClientRect().top-80));return true})()");
      await new Promise(r=>setTimeout(r,150));
      const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(process.env.E2E_SURVEY_SCREENSHOT,Buffer.from(shot.data,'base64'));
      console.log('E2E System Survey screenshot '+process.env.E2E_SURVEY_SCREENSHOT);
    }
    console.log('PASS: System Survey for '+surveyReport.systemsChecked+' systems at four viewport widths ('+surveyReport.viewportChecks+' render checks), long-token overflow stress, valid POI table structure, and reroll action.');

    // The map is intentionally static: real pointer drags and wheel input must never move its viewBox or systems.
    const fixedView=await evaluate("document.querySelector('#hexmap').getAttribute('viewBox')");
    assert(fixedView==='0 0 641 881','The map does not start with the canonical fixed viewport.');
    const staticLayout=await evaluate("(()=>{const svg=document.querySelector('#hexmap'),stage=document.querySelector('.map-canvas-scroll'),a=svg.getBoundingClientRect(),b=stage.getBoundingClientRect(),cs=getComputedStyle(stage);return {svg:{left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width,height:a.height},stage:{left:b.left,right:b.right,width:b.width,height:b.height},overflowX:cs.overflowX,overflowY:cs.overflowY,box:{view:svg.getAttribute('viewBox'),w:svg.viewBox.baseVal.width,h:svg.viewBox.baseVal.height}}})()");
    assert(staticLayout.svg.width>0&&staticLayout.svg.right<=staticLayout.stage.right+1&&staticLayout.svg.left>=staticLayout.stage.left-1,'The SVG map escapes its own layout area.');
    assert(staticLayout.overflowY==='visible'&&staticLayout.overflowX==='visible','The map has an internal scroll trap; page scrolling should remain natural.');
    const chosen=await evaluate("(()=>{const svg=document.querySelector('#hexmap'),node=[...svg.querySelectorAll('.system-node')].find(n=>n.querySelector('.system-core')),sys=App.currentSector.systems.find(s=>s.id===node.dataset.systemId),r=node.querySelector('.system-core').getBoundingClientRect();return {id:sys.id,x:sys.x,y:sys.y,point:{x:r.left+r.width/2,y:r.top+r.height/2}}})()");
    await evaluate("document.querySelector('#hexmap').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})");
    const chosenPoint=await evaluate("(()=>{const n=[...document.querySelectorAll('#hexmap .system-node')].find(n=>n.dataset.systemId==="+JSON.stringify(chosen.id)+"),r=n.querySelector('.system-core').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
    await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:chosenPoint.x,y:chosenPoint.y});
    await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:chosenPoint.x,y:chosenPoint.y,button:'left',buttons:1,clickCount:1});
    await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:chosenPoint.x,y:chosenPoint.y,button:'left',buttons:0,clickCount:1});
    const selected=await evaluate("({id:Hexmap._state.selectedSystem&&Hexmap._state.selectedSystem.id,view:document.querySelector('#hexmap').getAttribute('viewBox')})");
    assert(selected.id===chosen.id&&selected.view===fixedView,'A normal system click failed to select the system or changed the fixed viewport.');
    // A long mouse gesture on a star is now inert by design: it cannot drag the star or the map.
    await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:chosenPoint.x,y:chosenPoint.y});
    await cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:chosenPoint.x,y:chosenPoint.y,button:'left',buttons:1,clickCount:1});
    for(let i=1;i<=5;i++){await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:chosenPoint.x+45*i/5,y:chosenPoint.y+25*i/5,button:'left',buttons:1});}
    await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:chosenPoint.x+45,y:chosenPoint.y+25,button:'left',buttons:0,clickCount:1});
    const afterGesture=await evaluate("(()=>{const s=App.currentSector.systems.find(x=>x.id==="+JSON.stringify(chosen.id)+"),n=[...document.querySelectorAll('#hexmap .system-node')].find(n=>n.dataset.systemId===s.id);return {x:s.x,y:s.y,view:document.querySelector('#hexmap').getAttribute('viewBox'),transform:n.getAttribute('transform')}})()");
    const expectedTransform=await evaluate("(()=>{const s=App.currentSector.systems.find(x=>x.id==="+JSON.stringify(chosen.id)+");return 'translate('+(40+Number(s.x)*58.5)+' '+(35+(Number(s.y)+.5*(Number(s.x)%2))*67.55)+')'})()");
    assert(afterGesture.x===chosen.x&&afterGesture.y===chosen.y&&afterGesture.view===fixedView&&afterGesture.transform===expectedTransform,'A pointer drag moved a system or altered the fixed map viewport.');
    // Browser document scrolling should not pan/zoom the SVG. Native wheel/touch injection
    // is inconsistent in headless Chromium, so the scroll position itself is moved instantly;
    // actual pointer/click/move interactions are exercised separately below.
    const pageScrollBefore=await evaluate("({scroll:scrollY,max:document.documentElement.scrollHeight-innerHeight,view:document.querySelector('#hexmap').getAttribute('viewBox')})");
    const pageScrollTarget = pageScrollBefore.scroll >= pageScrollBefore.max - 2 ? Math.max(0,pageScrollBefore.scroll-100) : Math.min(pageScrollBefore.max,pageScrollBefore.scroll+100);
    await evaluate("window.scrollTo({top:"+pageScrollTarget+",behavior:'instant'})");
    const pageScrollAfter=await evaluate("({scroll:scrollY,view:document.querySelector('#hexmap').getAttribute('viewBox')})");
    assert(Math.abs(pageScrollAfter.scroll-pageScrollBefore.scroll)>20&&pageScrollAfter.view===fixedView,'Page scrolling changed the SVG viewport or did not scroll the document.');

    // Mobile viewport regression: verify native touch-action remains enabled on SVG children,
    // and document scrolling leaves the sector map and system coordinates unchanged.
    await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await evaluate("(()=>{document.documentElement.style.scrollBehavior='auto';const e=document.querySelector('#hexmap'),r=e.getBoundingClientRect(),max=document.documentElement.scrollHeight-innerHeight;window.scrollTo({top:Math.max(0,Math.min(max-200,window.scrollY+r.top-200)),behavior:'instant'});return true})()");
    const touchStart=await evaluate("(()=>{const svg=document.querySelector('#hexmap'),cells=[...svg.querySelectorAll('.hex-cell')],cell=cells.find(c=>!c.querySelector('.system-node')),p=cell.querySelector('polygon').getBoundingClientRect(),r=svg.getBoundingClientRect();return {x:Math.max(r.left+10,Math.min(r.right-10,p.left+p.width/2)),y:Math.max(r.top+10,Math.min(r.bottom-10,p.top+p.height/2)),scroll:scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,svgTop:r.top,svgBottom:r.bottom,rootAction:getComputedStyle(svg).touchAction,childAction:getComputedStyle(cell).touchAction,view:svg.getAttribute('viewBox')}})()");
    assert(touchStart.maxScroll>50&&touchStart.y>0&&touchStart.y<844,'Mobile map positioning failed: '+JSON.stringify(touchStart));
    assert(touchStart.rootAction==='auto'&&touchStart.childAction==='auto','Native touch-action was not restored on SVG and hex children.');
    const systemBeforeTouch=await evaluate("(()=>{const s=App.currentSector.systems[0];return {id:s.id,x:s.x,y:s.y}})()");
    const mobileScrollTarget = Math.min(touchStart.maxScroll, touchStart.scroll + 100);
    await evaluate("window.scrollTo({top:"+mobileScrollTarget+",behavior:'instant'})");
    await new Promise(r=>setTimeout(r,80));
    const touchAfter=await evaluate("(()=>({scroll:scrollY,view:document.querySelector('#hexmap').getAttribute('viewBox'),selectedHex:Hexmap._selectedHex&&{x:Hexmap._selectedHex.x,y:Hexmap._selectedHex.y}}))()");
    const systemAfterTouch=await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(systemBeforeTouch.id)+");return {id:s.id,x:s.x,y:s.y}})()");
    assert(touchAfter.scroll>touchStart.scroll+35,'Mobile document scrolling did not advance while testing touch-action policy.');
    assert(touchAfter.view===fixedView&&systemAfterTouch.x===systemBeforeTouch.x&&systemAfterTouch.y===systemBeforeTouch.y,'Mobile document scrolling altered map viewport or moved a star system.');
    await cmd('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('#hexmap').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})");
    console.log('PASS: mobile touch-action policy, deterministic document scrolling, and fixed map/system geometry.');
    // Enable editing explicitly before the editor tests; controls should appear only now.
    await evaluate("document.querySelector('#map-edit-toggle').click()");
    const editModeOn=await evaluate("({edit:Hexmap._editMode,pressed:document.querySelector('#map-edit-toggle').getAttribute('aria-pressed'),toolsHidden:document.querySelector('#map-edit-tools').hidden,moveVisible:!!document.querySelector('#map-move-selected').getClientRects().length})");
    assert(editModeOn.edit&&editModeOn.pressed==='true'&&!editModeOn.toolsHidden&&editModeOn.moveVisible,'Edit mode ON did not reveal the map editing controls.');
    // Region creation and membership use explicit clicks, and the region count stays in sync.
    await evaluate("document.querySelector('#map-region-name').value='Inner Reach';document.querySelector('#map-region-create').click();document.querySelector('#map-region-select').dispatchEvent(new Event('change',{bubbles:true}))");
    await evaluate("document.querySelector('.hex-cell[data-hex-x=\"0\"][data-hex-y=\"0\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    const regionState=await evaluate("({count:App.currentSector.regions.length,hexes:App.currentSector.regions[0].hexes.length,selected:Hexmap._activeRegionId,option:document.querySelector('#map-region-select').selectedOptions[0].textContent,view:document.querySelector('#hexmap').getAttribute('viewBox')})");
    assert(regionState.count===1&&regionState.hexes===1&&regionState.selected==='REGION-01'&&regionState.option.includes('1 hex')&&regionState.view===fixedView,'Region creation/editing did not persist or its picker count/viewBox drifted.');
    await evaluate("(()=>{const node=[...document.querySelectorAll('#hexmap .system-node')].find(n=>{const s=App.currentSector.systems.find(x=>x.id===n.dataset.systemId);return s&&(Number(s.x)!==0||Number(s.y)!==0)});if(!node)throw new Error('No occupied system hex distinct from 00,00 was found.');node.dispatchEvent(new MouseEvent('click',{bubbles:true}));return node.dataset.systemId})()");
    const occupiedRegionState=await evaluate("({count:App.currentSector.regions[0].hexes.length,option:document.querySelector('#map-region-select').selectedOptions[0].textContent,hasSystemHex:App.currentSector.regions[0].hexes.some(h=>App.currentSector.systems.some(s=>Number(s.x)===h.x&&Number(s.y)===h.y)),hasSecondHex:App.currentSector.regions[0].hexes.some(h=>!(h.x===0&&h.y===0))})");
    assert(occupiedRegionState.count===2&&occupiedRegionState.option.includes('2 hex')&&occupiedRegionState.hasSystemHex&&occupiedRegionState.hasSecondHex,'Region edit mode could not include a distinct populated system hex: '+JSON.stringify(occupiedRegionState));
    await evaluate("document.querySelector('#map-region-select').value='';document.querySelector('#map-region-select').dispatchEvent(new Event('change',{bubbles:true}))");
    // System relocation is a deliberate two-click edit, never a drag: choose target only after arming move mode.
    const moveInfo=await evaluate("(()=>{const s=App.currentSector.systems.find(x=>x.id==="+JSON.stringify(chosen.id)+"),cells=[...document.querySelectorAll('#hexmap .hex-cell')].map(el=>({x:+el.dataset.hexX,y:+el.dataset.hexY,el})).filter(c=>!App.currentSector.systems.some(o=>Number(o.x)===c.x&&Number(o.y)===c.y)&&!(c.x===s.x&&c.y===s.y));const target=cells.find(c=>Math.abs(c.x-s.x)+Math.abs(c.y-s.y)<=3)||cells[0];const r=target.el.querySelector('polygon').getBoundingClientRect();return {id:s.id,oldX:s.x,oldY:s.y,x:target.x,y:target.y,point:{x:r.left+r.width/2,y:r.top+r.height/2}}})()");
    assert(moveInfo&&Number.isFinite(moveInfo.x),'No empty hex was available for explicit system relocation.');
    await evaluate("document.querySelector('#map-move-selected').click()");
    const armed=await evaluate("({mode:Hexmap._moveMode,view:document.querySelector('#hexmap').getAttribute('viewBox'),targets:document.querySelectorAll('#hexmap .hex-move-target').length,button:document.querySelector('#map-cancel-move').hidden})");
    assert(armed.mode&&armed.view===fixedView&&armed.targets>0&&!armed.button,'Explicit move mode did not arm safely without changing map geometry.');
    await evaluate("document.querySelector('#hexmap .hex-cell[data-hex-x=\""+moveInfo.x+"\"][data-hex-y=\""+moveInfo.y+"\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await new Promise(r=>setTimeout(r,80));
    const moved=await evaluate("(()=>{const s=App.currentSector.systems.find(x=>x.id==="+JSON.stringify(moveInfo.id)+");return {x:s.x,y:s.y,duplicates:App.currentSector.systems.filter(x=>x.x===s.x&&x.y===s.y).length,mode:Hexmap._moveMode,view:document.querySelector('#hexmap').getAttribute('viewBox'),routesValid:App.currentSector.tradeRoutes.every(r=>{const a=App.currentSector.systems.find(s=>s.id===r.fromSystemId),b=App.currentSector.systems.find(s=>s.id===r.toSystemId);return a&&b&&r.distance===CampaignTools.hexDistance(a,b)&&r.distance<=3})}})()");
    assert(moved.x===moveInfo.x&&moved.y===moveInfo.y&&moved.duplicates===1&&!moved.mode&&moved.view===fixedView&&moved.routesValid,'Explicit move-to-hex editing did not update the system and linked routes safely: target='+JSON.stringify(moveInfo)+' result='+JSON.stringify(moved));
    await evaluate("document.querySelector('#map-edit-toggle').click()");
    const editModeOff=await evaluate("({edit:Hexmap._editMode,pressed:document.querySelector('#map-edit-toggle').getAttribute('aria-pressed'),toolsHidden:document.querySelector('#map-edit-tools').hidden,moveMode:Hexmap._moveMode,activeRegion:Hexmap._activeRegionId,deleteDisabled:document.querySelector('#map-region-delete').disabled})");
    assert(!editModeOff.edit&&editModeOff.pressed==='false'&&editModeOff.toolsHidden&&!editModeOff.moveMode&&!editModeOff.activeRegion&&editModeOff.deleteDisabled,'Turning Edit mode off did not hide the controls and cancel active editing state.');
    // Verify responsive map containment, then restore the standard viewport for the rest of the suite.
    for(const width of [820,390]){
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
      const bounds=await evaluate("(()=>{const s=document.querySelector('#hexmap').getBoundingClientRect(),p=document.querySelector('.map-canvas-scroll').getBoundingClientRect(),v=document.querySelector('.map-visual').getBoundingClientRect();return {w:innerWidth,left:s.left,right:s.right,pLeft:p.left,pRight:p.right,vLeft:v.left,vRight:v.right}})()");
      assert(bounds.left>=bounds.pLeft-1&&bounds.right<=bounds.pRight+1&&bounds.left>=bounds.vLeft-1&&bounds.right<=bounds.vRight+1,'Map exceeded its panel at viewport width '+width+': '+JSON.stringify(bounds));
    }
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    console.log('PASS: fixed viewport, inert drag gestures, normal page scrolling, explicit select-then-move editing, responsive containment, and region editor.');

    // Markets layout test at desktop and compact desktop widths: every card stays inside its column.
    await cmd('Emulation.setDeviceMetricsOverride',{width:1024,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('[role=tab][aria-controls]').click && [...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click();document.querySelectorAll('#markets-output .market-card').forEach(c=>c.open=true)");
    const marketLayout=await evaluate("(()=>{const out=document.querySelector('#markets-output'),cards=[...out.querySelectorAll('.market-card')];return {visible:out.getBoundingClientRect().width>0,client:out.getBoundingClientRect().right,cards:cards.map(c=>{const r=c.getBoundingClientRect(),w=c.querySelector('.market-table-wrap');return {left:r.left,right:r.right,width:r.width,wrapRight:w.getBoundingClientRect().right,wrapWidth:w.getBoundingClientRect().width,overflow:w.scrollWidth>w.clientWidth}})}})()");
    assert(marketLayout.visible,'Trade & Routes panel/Markets output is not visible.');
    assert(marketLayout.cards.every(c=>c.width>0 && c.right<=marketLayout.client+2 && c.wrapRight<=c.right+1),'A market table or card extends beyond its own column.');
    assert(marketLayout.cards.every(c=>c.overflow),'The wide market goods table is not contained in a horizontal scroll wrapper.');
    await cmd('Emulation.setDeviceMetricsOverride',{width:820,height:1200,deviceScaleFactor:1,mobile:false});
    const compactMarketLayout=await evaluate("(()=>{const out=document.querySelector('#markets-output'),cards=[...out.querySelectorAll('.market-card')];return {width:innerWidth,outRight:out.getBoundingClientRect().right,cards:cards.map(c=>{const r=c.getBoundingClientRect(),w=c.querySelector('.market-table-wrap');return {left:r.left,right:r.right,width:r.width,wrapRight:w.getBoundingClientRect().right,overflow:w.scrollWidth>w.clientWidth}})}})()");
    assert(compactMarketLayout.cards.every(c=>c.width>0&&c.right<=compactMarketLayout.outRight+2&&c.wrapRight<=c.right+1&&c.overflow),'Compact viewport produced a market/right-column overlap or escaped goods table.');
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    const wideMarketLayout=await evaluate("(()=>{const out=document.querySelector('#markets-output'),cards=[...out.querySelectorAll('.market-card')];return {outRight:out.getBoundingClientRect().right,cards:cards.map(c=>{const r=c.getBoundingClientRect(),w=c.querySelector('.market-table-wrap');return {right:r.right,width:r.width,wrapRight:w.getBoundingClientRect().right,overflow:w.scrollWidth>w.clientWidth}})}})()");
    assert(wideMarketLayout.cards.every(c=>c.width>0&&c.right<=wideMarketLayout.outRight+2&&c.wrapRight<=c.right+1&&c.overflow),'Expanded market cards overlap the right column or overflow their containers at 1440px.');
    await evaluate("document.querySelector('#markets-output .market-card .story-controls .campaign-action:nth-of-type(2)').click()");
    const crossNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),map:!!document.querySelector('#hexmap .system-node'),inspector:!!document.querySelector('#inspector')})");
    assert(crossNav.tab==='Sector Map'&&crossNav.map&&crossNav.inspector,'Market-to-system navigation did not open the linked system inspector.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#markets-output .market-card .story-controls .campaign-action:nth-of-type(3)').click()");
    const worldNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),highlighted:!!document.querySelector('#worlds-output .linked-highlight-row')})");
    assert(worldNav.tab==='Worlds'&&worldNav.highlighted,'Market-to-world navigation did not locate and highlight its linked world record.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#corp-market-links-output tbody tr .campaign-row-actions .campaign-action:nth-of-type(2)').click()");
    const marketNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),open:[...document.querySelectorAll('#markets-output .market-card')].some(c=>c.open&&c.classList.contains('linked-highlight-card'))})");
    assert(marketNav.tab==='Trade & Routes'&&marketNav.open,'Corporate contract did not navigate back to its linked market.');
    await evaluate("document.querySelector('#corp-market-links-output tbody tr .campaign-row-actions .campaign-action:nth-of-type(4)').click()");
    const corpNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),highlighted:!!document.querySelector('#corporations-output .linked-highlight-row')})");
    assert(corpNav.tab==='Corporations'&&corpNav.highlighted,'Corporate market link did not locate its linked corporation record.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#markets-reroll').click()");
    const reroll=await evaluate("({visible:document.querySelector('#markets-output').getBoundingClientRect().width>0,cards:document.querySelectorAll('#markets-output .market-card').length,markets:App.currentSector.markets.length})");
    assert(reroll.visible&&reroll.cards===reroll.markets,'Rerolling markets broke the Trade & Routes layout.');
    console.log('PASS: Markets layout at 1024px/820px/1440px, nested-table scrolling, linked navigation, and market reroll.');

    // Diplomacy, influence, assets, and faction turns are interactive and connected to markets.
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#influence-output .campaign-row-actions .campaign-action').click()");
    const territoryAfter=await evaluate("({manual:App.currentSector.systems[0].manualControllerFactionId||'',controller:App.currentSector.systems[0].controllingFactionId||''})");
    assert(territoryAfter.manual&&territoryAfter.controller,'Territorial influence override did not assign explicit control.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Factions').click()");
    const factionCountBefore=await evaluate("App.currentSector.factions.length");
    const generatedFactionBefore=await evaluate("App.currentSector.factions[0].name");
    await evaluate("(()=>{const row=document.querySelector('#factions-output tbody tr');row.querySelector('button').click();const modal=document.querySelector('.dynmodal-container .dynedit');const name=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='name:');name.querySelector('textarea').value='Edited Generated Faction';[...modal.querySelectorAll('.textbutton')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    assert(await evaluate("App.currentSector.factions.some(f=>f.name==='Edited Generated Faction')"),'A generated faction could not be edited.');
    await evaluate("document.querySelector('#factions-add').click();const modal=document.querySelector('.dynmodal-container .dynedit');if(!modal)throw new Error('Custom faction editor did not open');const row=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='name:');if(!row)throw new Error('Custom faction name field missing');row.querySelector('textarea').value='Wayfarer Cooperative';const goal=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='goal:');goal.querySelector('textarea').value='Protect independent settlements';[...modal.querySelectorAll('.textbutton')].find(e=>e.textContent.trim()==='(Save)').click()");
    const customFaction=await evaluate("(()=>{const f=App.currentSector.factions.find(f=>f.name==='Wayfarer Cooperative');return {count:App.currentSector.factions.length,exists:!!f,goal:f&&f.goal,hasBase:f&&(f.assets||[]).some(a=>a.isBase),homeworld:f&&f.homeworldSystemId,relations:App.currentSector.diplomacy.filter(r=>f&&(r.factionAId===f.id||r.factionBId===f.id)).length,editButton:!![...document.querySelectorAll('#factions-output tbody tr')].find(r=>r.textContent.includes('Wayfarer Cooperative'))?.querySelector('button')}})()");
    assert(customFaction.count===factionCountBefore+1&&customFaction.exists&&customFaction.goal==='Protect independent settlements'&&customFaction.hasBase&&customFaction.homeworld&&customFaction.relations===factionCountBefore&&customFaction.editButton,'Custom faction creation did not preserve user fields or initialize its campaign links: '+JSON.stringify(customFaction));
    await evaluate("(()=>{const row=[...document.querySelectorAll('#factions-output tbody tr')].find(r=>r.textContent.includes('Wayfarer Cooperative'));row.querySelector('button').click();const modal=document.querySelector('.dynmodal-container .dynedit');const name=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='name:');name.querySelector('textarea').value='Wayfarer Compact';[...modal.querySelectorAll('.textbutton')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    assert(await evaluate("App.currentSector.factions.some(f=>f.name==='Wayfarer Compact')"),'A newly created faction could not be edited after saving.');
    console.log('PASS: custom faction creation, editable custom fields, base placement, diplomacy links, and subsequent editing.');

    // Regression checks for editor randomise/revert across factions, corporations,
    // campaign records, and boolean controls (checkboxes use .checked, not .value).
    const factionRerollCheck = await evaluate(`(()=>{
      const row=[...document.querySelectorAll('#factions-output tbody tr')].find(r=>r.textContent.includes('Wayfarer Compact'));
      row.querySelector('button').click();
      const modal=document.querySelector('.dynmodal-container .dynedit');
      const field=(name)=>[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()===name+':');
      const randomize=(name)=>{const b=field(name)?.querySelector('[aria-label="Randomize '+name+'"]');if(!b)throw new Error('Missing faction randomizer: '+name);b.click();};
      const before={name:field('name').querySelector('textarea').value,goal:field('goal').querySelector('textarea').value,force:field('force').querySelector('input').value,cunning:field('cunning').querySelector('input').value,wealth:field('wealth').querySelector('input').value};
      randomize('name');
      const rerolledName=field('name').querySelector('textarea').value;
      field('name').querySelector('[aria-label="Revert name"]').click();
      const singleRevert=field('name').querySelector('textarea').value===before.name;
      modal.querySelectorAll('.dynedit-toolbar-button')[0].click();
      const changedAfterAll=['name','goal','force','cunning','wealth','type','scale'].some(k=>{
        const r=field(k), c=r?.querySelector('textarea, input, select');
        return c && (c.type==='checkbox'?c.checked:String(c.value))!==String(before[k]??({name:before.name,goal:before.goal,force:before.force,cunning:before.cunning,wealth:before.wealth}[k]??''));
      });
      modal.querySelectorAll('.dynedit-toolbar-button')[1].click();
      const allReverted=field('name').querySelector('textarea').value===before.name&&field('goal').querySelector('textarea').value===before.goal&&field('force').querySelector('input').value===before.force&&field('cunning').querySelector('input').value===before.cunning&&field('wealth').querySelector('input').value===before.wealth;
      modal.querySelectorAll('.dynedit-toolbar-button')[2].click();
      return {randomizerCount:modal.querySelectorAll('[aria-label^="Randomize "]').length,rerolledName,singleRevert,changedAfterAll,allReverted,saved:App.currentSector.factions.some(f=>f.name==='Wayfarer Compact')};
    })()`);
    assert(factionRerollCheck.randomizerCount>=10&&factionRerollCheck.rerolledName&&factionRerollCheck.rerolledName!=='Wayfarer Compact'&&factionRerollCheck.singleRevert&&factionRerollCheck.changedAfterAll&&factionRerollCheck.allReverted&&factionRerollCheck.saved,'Faction randomise/revert controls failed: '+JSON.stringify(factionRerollCheck));

    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Corporations').click();document.querySelector('#corporations-output tbody tr .edit-cell .textbutton').click()");
    const corporationRerollCheck = await evaluate(`(()=>{
      const modal=document.querySelector('.dynmodal-container .dynedit');
      const field=(name)=>[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()===name+':');
      const before={name:field('name').querySelector('textarea').value,markets:field('markets').querySelector('textarea').value,ownership:field('ownership').querySelector('select').value,strategy:field('strategy').querySelector('select').value,valuation:field('valuation').querySelector('select').value};
      const names=['name','markets','ownership','strategy','valuation'];
      const missing=names.filter(name=>!field(name)?.querySelector('[aria-label="Randomize '+name+'"]'));
      field('name').querySelector('[aria-label="Randomize name"]').click();
      const rerolledName=field('name').querySelector('textarea').value;
      field('name').querySelector('[aria-label="Revert name"]').click();
      const singleRevert=field('name').querySelector('textarea').value===before.name;
      modal.querySelectorAll('.dynedit-toolbar-button')[0].click();
      const allChanged=names.some(name=>{const c=field(name).querySelector('textarea,select');return c.value!==before[name];});
      modal.querySelectorAll('.dynedit-toolbar-button')[1].click();
      const allReverted=names.every(name=>field(name).querySelector('textarea,select').value===before[name]);
      modal.querySelectorAll('.dynedit-toolbar-button')[2].click();
      return {missing,rerolledName,singleRevert,allChanged,allReverted,savedName:App.currentSector.corporations[0].name};
    })()`);
    assert(corporationRerollCheck.missing.length===0&&corporationRerollCheck.rerolledName&&corporationRerollCheck.rerolledName!==corporationRerollCheck.savedName&&corporationRerollCheck.singleRevert&&corporationRerollCheck.allChanged&&corporationRerollCheck.allReverted,'Corporation randomise/revert controls failed: '+JSON.stringify(corporationRerollCheck));

    // Verify the other directory-backed editors received their own generator
    // templates and that every field can be individually reverted.
    const additionalEditorChecks = await evaluate(`(()=>{
      const specs=[
        {tab:'Religions',output:'religions-output',fields:['name','leadership','doctrine']},
        {tab:'Political Groups',output:'political-groups-output',fields:['name','leadership']},
        {tab:'Aliens',output:'aliens-output',fields:['name','type','body','lenses','government','motivation','humanRelations','techLevel','firstContact']}
      ];
      function control(row){return row?.querySelector('textarea,input,select');}
      function value(el){return el?.type==='checkbox'?el.checked:el?.value;}
      const results=[];
      for(const spec of specs){
        const tab=[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()===spec.tab);
        if(!tab)throw new Error('Missing '+spec.tab+' tab'); tab.click();
        const recordRow=document.querySelector('#'+spec.output+' tbody tr');
        if(!recordRow)throw new Error('No '+spec.tab+' records to edit');
        const edit=recordRow.querySelector('.edit-cell .textbutton');
        if(!edit)throw new Error(spec.tab+' edit control missing'); edit.click();
        const modal=document.querySelector('.dynmodal-container .dynedit');
        const field=name=>[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()===name+':');
        const before={};
        const missing=[];
        for(const name of spec.fields){
          const row=field(name), el=control(row);
          if(!el||!row.querySelector('[aria-label="Randomize '+name+'"]')){missing.push(name);continue;}
          before[name]=value(el);
          row.querySelector('[aria-label="Randomize '+name+'"]').click();
          row.querySelector('[aria-label="Revert '+name+'"]').click();
          if(value(control(row))!==before[name])throw new Error(spec.tab+' field Revert failed for '+name);
        }
        if(missing.length)throw new Error(spec.tab+' missing randomizers: '+missing.join(', '));
        modal.querySelectorAll('.dynedit-toolbar-button')[0].click();
        modal.querySelectorAll('.dynedit-toolbar-button')[1].click();
        const allReverted=spec.fields.every(name=>value(control(field(name)))===before[name]);
        modal.querySelectorAll('.dynedit-toolbar-button')[2].click();
        if(!allReverted)throw new Error(spec.tab+' Revert All did not restore original field values');
        results.push({tab:spec.tab,fields:spec.fields.length,individualReverts:spec.fields.length,allReverted});
      }
      return results;
    })()`);
    assert(additionalEditorChecks.length===3&&additionalEditorChecks.every(x=>x.allReverted),'Religion/political-group/alien editor randomise/revert regression failed: '+JSON.stringify(additionalEditorChecks));

    const campaignEditorChecks = await evaluate(`(()=>{
      const specs=[
        {label:'Faction asset',record:{id:'A-TEST',ownerFactionId:'F-TEST',type:'Base of Influence',name:'Test Base',stat:'force',rating:3,minimumRating:0,hp:5,maintenance:1,cost:4,income:1,active:true,stealthed:false},fields:['type','name','stat','rating','minimumRating','hp','maintenance','cost','income','active','stealthed']},
        {label:'Polity',record:{id:'P-TEST',name:'Test Polity',memberSystemIds:[],government:'Federated republic',policy:'preserve peace',stability:3},fields:['name','government','policy','stability']},
        {label:'Market good',record:{id:'G-TEST',name:'Test Good',category:'Technology',supply:'Common',priceIndex:100,basePrice:200,localPrice:200,note:'Original note'},fields:['supply','priceIndex','localPrice','note']},
        {label:'Campaign story',record:{id:'S-TEST',name:'Test Story',title:'Original title',objective:'Original objective',motive:'Original motive',status:'Active',notes:'Original notes'},fields:['name','title','objective','motive','status','notes']}
      ];
      function control(row){return row?.querySelector('textarea,input,select');}
      function value(el){if(!el)return undefined;if(el.type==='checkbox')return !!el.checked;if(el.type==='number')return el.value===''?null:Number(el.value);return el.value;}
      const results=[];
      for(const spec of specs){
        DynEdit.edit('Regression '+spec.label,spec.record,App.buildCampaignEditTemplate(spec.label,spec.record,[]),function(){});
        const modal=document.querySelector('.dynmodal-container .dynedit');
        const field=name=>[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()===name+':');
        const before={};
        for(const name of spec.fields){
          const row=field(name),el=control(row),randomize=row?.querySelector('[aria-label="Randomize '+name+'"]'),revert=row?.querySelector('[aria-label="Revert '+name+'"]');
          if(!el||!randomize||!revert)throw new Error(spec.label+' missing randomize/revert for '+name);
          before[name]=value(el); randomize.click(); revert.click();
          if(value(control(field(name)))!==before[name])throw new Error(spec.label+' individual Revert failed for '+name);
        }
        modal.querySelectorAll('.dynedit-toolbar-button')[0].click();
        modal.querySelectorAll('.dynedit-toolbar-button')[1].click();
        const allReverted=spec.fields.every(name=>value(control(field(name)))===before[name]);
        modal.querySelectorAll('.dynedit-toolbar-button')[2].click();
        if(!allReverted)throw new Error(spec.label+' Revert All failed');
        results.push({label:spec.label,fields:spec.fields.length,allReverted});
      }
      return results;
    })()`);
    assert(campaignEditorChecks.length===4&&campaignEditorChecks.every(x=>x.allReverted),'Campaign asset/polity/market/story editor randomise/revert regression failed: '+JSON.stringify(campaignEditorChecks));

    const checkboxRevertCheck = await evaluate(`(()=>{
      const record={enabled:true,score:4,label:'Original'};
      DynEdit.edit('Editor checkbox regression',record,{generators:{enabled:()=>false,score:()=>9,label:()=> 'Randomized'}},function(){});
      const modal=document.querySelector('.dynmodal-container .dynedit');
      const row=(name)=>[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()===name+':');
      row('enabled').querySelector('[aria-label="Randomize enabled"]').click();
      const randomizeBoolean=!row('enabled').querySelector('input').checked;
      row('enabled').querySelector('[aria-label="Revert enabled"]').click();
      const fieldRevert=row('enabled').querySelector('input').checked;
      modal.querySelectorAll('.dynedit-toolbar-button')[0].click();
      modal.querySelectorAll('.dynedit-toolbar-button')[1].click();
      const allRevert=row('enabled').querySelector('input').checked&&row('score').querySelector('input').value==='4'&&row('label').querySelector('textarea').value==='Original';
      modal.querySelectorAll('.dynedit-toolbar-button')[2].click();
      return {randomizeBoolean,fieldRevert,allRevert,record};
    })()`);
    assert(checkboxRevertCheck.randomizeBoolean&&checkboxRevertCheck.fieldRevert&&checkboxRevertCheck.allRevert&&checkboxRevertCheck.record.enabled===true&&checkboxRevertCheck.record.score===4&&checkboxRevertCheck.record.label==='Original','Editor checkbox/randomize/revert regression failed: '+JSON.stringify(checkboxRevertCheck));
    console.log('PASS: field and all-field randomise/revert for factions, corporations, religions, political groups and aliens, plus campaign assets/polities/market goods/story records and checkbox value restoration.');
    const assetBefore=await evaluate("(()=>{const a=App.currentSector.factions.flatMap(f=>f.assets)[0];return {id:a.id,location:a.locationSystemId,active:a.active}})()");
    await evaluate("document.querySelector('#assets-output .asset-op').click()");
    const assetAfterMove=await evaluate("(()=>{const a=App.currentSector.factions.flatMap(f=>f.assets).find(a=>a.id==="+JSON.stringify(assetBefore.id)+");return {location:a.locationSystemId,owner:a.ownerFactionId,valid:App.currentSector.systems.some(s=>s.id===a.locationSystemId)}})()");
    assert(assetAfterMove.valid&&assetAfterMove.location!==assetBefore.location&&assetAfterMove.owner,'Faction asset Move control did not update its linked system and ownership.');
    await evaluate("document.querySelectorAll('#assets-output .asset-op')[1].click()");
    const assetStandDown=await evaluate("App.currentSector.factions.flatMap(f=>f.assets).find(a=>a.id==="+JSON.stringify(assetBefore.id)+").active");
    assert(assetStandDown===false,'Faction asset readiness control did not stand down the moved asset.');
    const simBefore=await evaluate("({turn:App.currentSector.factionTurn,rels:App.currentSector.diplomacy.length,marketTurn:App.currentSector.markets[0].lastUpdatedTurn,assets:App.currentSector.factions.reduce((n,f)=>n+f.assets.length,0),links:App.currentSector.corporationMarketLinks.length,worldLinks:App.currentSector.markets.every(m=>(App.currentSector.systems.some(s=>s.id===m.systemId))&&(App.currentSector.systems.some(s=>(s.planets||[]).some(p=>p.id===m.planetId))))})");
    assert(simBefore.rels>0&&simBefore.assets>0&&simBefore.links>0&&simBefore.worldLinks,'Campaign cross-links were not initialized.');
    await evaluate("document.querySelector('#diplomacy-output .campaign-action').click()");
    const stateAfterDiplomacy=await evaluate("App.currentSector.diplomacy[0].state");
    assert(stateAfterDiplomacy,'Diplomacy relationship action did not run.');
    const stateBeforeTurn=await evaluate("App.currentSector.diplomacy.map(r=>r.state).join('|')");
    await evaluate("document.querySelector('#faction-turn-button').click()");
    const simAfter=await evaluate("({turn:App.currentSector.factionTurn,marketTurn:App.currentSector.markets[0].lastUpdatedTurn,hasInfluence:App.currentSector.systems.some(s=>Array.isArray(s.factionInfluence)),hasMarketPrices:App.currentSector.markets.every(m=>m.goods.every(g=>Number.isFinite(g.localPrice)&&g.localPrice>0)),territoryRows:document.querySelectorAll('#influence-output tbody tr').length})");
    assert(simAfter.turn===simBefore.turn+1,'Faction turn did not increment.');
    assert(simAfter.marketTurn===simAfter.turn&&simAfter.hasInfluence&&simAfter.hasMarketPrices,'Faction turn failed to recalculate influence and markets.');
    assert(simAfter.territoryRows>0,'Territorial influence table did not render.');
    console.log('PASS: asset deployment/readiness, territorial override, diplomacy editing, faction turns, influence, and market repricing.');

    // Full map-editor workflow: safe default inspector, empty-hex creation, then
    // a custom orbital object, point of interest, and world with linked market/survey rows.
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Sector Map').click();Hexmap.setEditMode(false)");
    const editorOff = await evaluate("({edit:Hexmap._editMode,inspectorEdits:[...document.querySelectorAll('#inspector .edit-zone')].some(e=>e.getClientRects().length>0)})");
    assert(!editorOff.edit&&!editorOff.inspectorEdits,'System inspector edit controls must stay hidden while map Edit Mode is OFF.');
    await evaluate("document.querySelector('#map-edit-toggle').click()");
    const emptyHex = await evaluate("(()=>{const used=new Set(App.currentSector.systems.map(s=>Number(s.x)+','+Number(s.y)));for(let x=0;x<10;x++)for(let y=0;y<12;y++)if(!used.has(x+','+y))return {x,y};throw new Error('No empty hex available in 10x12 grid')})()");
    await evaluate("document.querySelector('#hexmap .hex-cell[data-hex-x=\""+emptyHex.x+"\"][data-hex-y=\""+emptyHex.y+"\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    const createVisible = await evaluate("!!document.querySelector('#map-create-system-button')");
    assert(createVisible,'Selecting an empty hex in Edit Mode did not offer Create system here.');
    await evaluate("document.querySelector('#map-create-system-button').click()");
    const createdSystem = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>Number(s.x)==="+emptyHex.x+"&&Number(s.y)==="+emptyHex.y+");return s?{id:s.id,x:s.x,y:s.y,planets:s.planets.length,bodies:s.bodies.length,selected:document.querySelector('#inspector .inspector-system-name')?.textContent.includes(s.name)}:null})()");
    assert(createdSystem&&createdSystem.planets===0&&createdSystem.bodies>=1&&createdSystem.selected,'Creating an empty-hex system did not create/select a valid star system.');
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add survey object');if(!e)throw new Error('Add survey object control missing');e.click();const f=[...document.querySelectorAll('.dynmodal-container .dynedit textarea')];if(f.length<2)throw new Error('Survey object editor fields missing');f[0].value='Mining platform';f[1].value='Morrow Mine';[...document.querySelectorAll('.dynmodal-container .dynedit .textbutton')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    const customBody = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+");return {exists:!!s,bodies:s&&(s.bodies||[]).map(b=>({type:b.type,name:b.name,bodyClass:b.bodyClass,isGeneratedWorld:b.isGeneratedWorld,worldName:b.worldName,planetId:b.planetId})),survey:!!document.querySelector('#inspector .system-survey-table'),modalCount:document.querySelectorAll('.dynmodal-container').length,modalText:[...document.querySelectorAll('.dynmodal-container')].map(m=>m.innerText.slice(0,240)),modalStack:DynModal._stack.length,inspector:document.querySelector('#inspector').innerText.slice(0,400)}})()");
    assert(customBody.exists&&customBody.bodies.some(b=>b.type==='Mining platform'&&b.name==='Morrow Mine'&&b.bodyClass==='N')&&customBody.survey,'Custom mining platform did not persist in the system survey: '+JSON.stringify(customBody));
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add point of interest');if(!e)throw new Error('Add point of interest control missing');e.click();const f=[...document.querySelectorAll('.dynmodal-container .dynedit textarea')];if(f.length<2)throw new Error('POI editor fields missing');f[0].value='Old Observatory';f[1].value='Ancient ruins';[...document.querySelectorAll('.dynmodal-container .dynedit .textbutton')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    const customPoi = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+");return !!s&&s.pointsOfInterest.some(p=>p.name==='Old Observatory'&&p.type==='Ancient ruins')&&!!document.querySelector('#inspector .inspector-poi-table')})()");
    assert(customPoi,'Custom ancient-ruins point of interest did not persist.');
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add planet');if(!e)throw new Error('Add planet control missing');e.click();const save=[...document.querySelectorAll('.dynmodal-container .dynedit .textbutton')].find(e=>e.textContent.trim()==='(Save)');if(!save)throw new Error('Planet editor save control missing');save.click()})()");
    const createdWorld = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+"),p=s&&s.planets[0],m=p&&(App.currentSector.markets||[]).find(m=>m.planetId===p.id),b=p&&(s.bodies||[]).find(b=>b.planetId===p.id);return {worlds:s&&s.planets.length,worldId:p&&p.id,market:!!m,surveyLink:!!b,worldDirectory:!![...document.querySelectorAll('#worlds-output tbody tr')].find(r=>r.textContent.includes(p&&p.name||'__none__')),validRoutes:App.currentSector.tradeRoutes.every(r=>App.currentSector.systems.some(s=>s.id===r.fromSystemId)&&App.currentSector.systems.some(s=>s.id===r.toSystemId))}})()");
    assert(createdWorld.worlds===1&&createdWorld.worldId&&createdWorld.market&&createdWorld.surveyLink&&createdWorld.worldDirectory&&createdWorld.validRoutes,'Added planet did not create a linked world, market, survey record, or valid route graph: '+JSON.stringify(createdWorld));

    // Regression for Captain_Hoyt's imported-world data-loss report: changing a
    // single field must not blank SWN vocabulary values or mutate source details.
    const planetEditRegression=await evaluate("(()=>{const system=App.currentSector.systems[0];const planet={id:'REGRESSION-SWN-WORLD',systemId:system.id,name:'Imported Test World',atmosphere:'Breathable mix',temperature:'Temperate',biosphere:'Immiscible',gravity:'',population:'Hundreds of millions of inhabitants',techLevel:'TL4+',tag1:'Pretech Archive',tag2:'Urbanized Surface',tagCandidate3:'',terrain:'Terran',description:'Original imported description',sourceEntityType:'planet',sourceAttributes:{atmosphere:'Breathable mix',temperature:'Temperate',biosphere:'Immiscible',population:'Hundreds of millions of inhabitants',techLevel:'TL4+',description:'Original imported description'}};system.planets.push(planet);DynEdit.edit('Regression: imported planet',planet,WorldGenerator.planetTemplate,function(saved){if(saved){if(!planet.sourceEntityType)planet.description=WorldGenerator.describePlanet(planet);App.ensureMarketForPlanet(App.currentSector,system,planet);App.refreshSectorAfterMapEdit(App.currentSector,system);}});const modal=document.querySelector('.dynmodal-container .dynedit');const tech=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='techLevel:');const immutableFields=['sourceEntityType','sourceIsHidden'];const immutableEditorFields=[...modal.querySelectorAll('tr')].map(r=>r.cells[0]?.textContent.trim().replace(/:$/,''));tech.querySelector('select').value='4-';[...modal.querySelectorAll('.textbutton')].find(e=>e.textContent.trim()==='(Save)').click();return {atmosphere:planet.atmosphere,temperature:planet.temperature,biosphere:planet.biosphere,gravity:planet.gravity,population:planet.population,techLevel:planet.techLevel,description:planet.description,sourceAtmosphere:planet.sourceAttributes.atmosphere,sourceFieldsHidden:immutableFields.every(key=>!immutableEditorFields.includes(key)),selectedOptions:tech.querySelector('select')?.options?.length||0};})()");
    assert(planetEditRegression.atmosphere==='Breathable mix'&&planetEditRegression.temperature==='Temperate'&&planetEditRegression.biosphere==='Immiscible'&&planetEditRegression.gravity===''&&planetEditRegression.population==='Hundreds of millions of inhabitants'&&planetEditRegression.techLevel==='4-'&&planetEditRegression.description==='Original imported description'&&planetEditRegression.sourceAtmosphere==='Breathable mix'&&planetEditRegression.sourceFieldsHidden,'Editing one imported planet field overwrote unchanged SWN fields: '+JSON.stringify(planetEditRegression));
    console.log('PASS: imported planet one-field edit preserves all unchanged SWN values and its source description.');

    // Black holes imported from SWN must have a distinct map symbol and inspector label.
    const blackHoleCheck=await evaluate("(()=>{const used=new Set(App.currentSector.systems.map(s=>s.x+','+s.y));let x=0,y=0;outer:for(x=0;x<10;x++)for(y=0;y<12;y++)if(!used.has(x+','+y))break outer;const bh={id:'REGRESSION-BLACK-HOLE',name:'NG03-7',x:x,y:y,planets:[],bodies:[],pointsOfInterest:[],sourceEntityType:'blackHole'};App.currentSector.systems.push(bh);App.syncSystemBodies(bh);App.displayHexmap(App.currentSector,bh);const node=[...document.querySelectorAll('#hexmap .system-node-black-hole')].find(n=>n.getAttribute('data-system-id')==='REGRESSION-BLACK-HOLE');return {node:!!node,disk:!!node?.querySelector('.black-hole-disk'),primary:bh.bodies?.[0]?.type||'',hasNormalStar:(bh.bodies||[]).some(b=>b.bodyClass==='S'),label:document.querySelector('#inspector .inspector-system-name')?.textContent||'',aria:node?.getAttribute('aria-label')||''};})()");
    assert(blackHoleCheck.node&&blackHoleCheck.disk&&blackHoleCheck.primary==='Black hole'&&!blackHoleCheck.hasNormalStar&&blackHoleCheck.label.includes('Black Hole')&&blackHoleCheck.aria.includes('black hole'),'Black hole was rendered or labeled like an ordinary star system: '+JSON.stringify(blackHoleCheck));
    console.log('PASS: black-hole systems have a distinct map marker and inspector/accessibility label.');
    console.log('PASS: map editor safe visibility, empty-hex system creation, custom orbital object/site creation, and planet/market/survey linkage.');

    // Save/export data and verify browser-level errors were absent.
    const privacy=await evaluate("(()=>{const p=App.censorSector(App.currentSector);return {hasRegions:Array.isArray(p.regions),leaks:p.systems.some(s=>s.controllingFactionId||s.factionInfluence||s.manualControllerFactionId),marketLinks:p.corporationMarketLinks&&p.corporationMarketLinks.length}})()");
    assert(privacy.hasRegions&&!privacy.leaks,'Player-safe export leaked referee territorial information or omitted editable map regions.');

    // End-to-end import mode check: preserve mode must not manufacture Forge details;
    // the explicit enrichment mode may fill gaps while keeping all source records.
    const preserveImport=await evaluate("(()=>{const csv='Name,Entity Type,Location,Children,Neighbors,Parent,Occupation,Situation,Tags\\nHelios,System,0911,,,,,,\\nMeridian,Planet,0911,,,Helios,,,Pretech Archive\\nStation One,Research Base,0911,,,Meridian,Researchers,Power failure,';const s=SwnImport.fromCSV(csv,'Preserve Test.csv','preserve');App.displaySector(s);return {mode:App.currentSector.importMetadata.mode,systems:App.currentSector.systems.length,worlds:App.currentSector.systems[0].planets.length,description:App.currentSector.systems[0].planets[0].description||'',markets:App.currentSector.markets.length,factions:App.currentSector.factions.length,sourceRows:App.currentSector.swnImport.records.length,visibleRows:document.querySelectorAll('#source-data-output tbody tr').length,importedSurveyObjects:App.currentSector.systems[0].bodies.filter(b=>b.importedFromSWN).length,coordinate:App.currentSector.systems[0].x+','+App.currentSector.systems[0].y}})()");
    assert(preserveImport.mode==='preserve'&&preserveImport.systems===1&&preserveImport.worlds===1&&preserveImport.description===''&&preserveImport.markets===0&&preserveImport.factions===0&&preserveImport.sourceRows===3&&preserveImport.visibleRows===3&&preserveImport.importedSurveyObjects===1&&preserveImport.coordinate==='9,11','Preserve import created generated content, lost source rows, or mis-mapped the 10×12 edge: '+JSON.stringify(preserveImport));
    const enrichImport=await evaluate("(()=>{const csv='Name,Entity Type,Location,Children,Neighbors,Parent,Occupation,Situation,Tags\\nHelios,System,0911,,,,,,\\nMeridian,Planet,0911,,,Helios,,,Pretech Archive\\nStation One,Research Base,0911,,,Meridian,Researchers,Power failure,';const s=SwnImport.fromCSV(csv,'Enrich Test.csv','enrich');App.displaySector(s);return {mode:App.currentSector.importMetadata.mode,systems:App.currentSector.systems.length,worlds:App.currentSector.systems[0].planets.length,description:App.currentSector.systems[0].planets[0].description||'',markets:App.currentSector.markets.length,factions:App.currentSector.factions.length,corporations:App.currentSector.corporations.length,sourceRows:App.currentSector.swnImport.records.length,importedSurveyObjects:App.currentSector.systems[0].bodies.filter(b=>b.importedFromSWN).length}})()");
    assert(enrichImport.mode==='enrich'&&enrichImport.systems===1&&enrichImport.worlds===1&&enrichImport.description.length>0&&enrichImport.markets>0&&enrichImport.factions>0&&enrichImport.corporations>0&&enrichImport.sourceRows===3&&enrichImport.importedSurveyObjects===1,'Enrichment mode did not fill supported gaps or dropped source records: '+JSON.stringify(enrichImport));
    console.log('PASS: end-to-end SWN import modes (preserve-as-is vs opt-in Forge enrichment).');
    const nativeImport=await evaluate("(()=>{const data={sector:{sec1:{id:'sec1',type:'sector',name:'Native Browser Test',attributes:{}}},system:{sys1:{id:'sys1',type:'system',name:'Helios',x:10,y:12,parent:'sec1',parentEntity:'sector',attributes:{}},sys2:{id:'sys2',type:'system',name:'Referee Secret',x:1,y:1,parent:'sec1',parentEntity:'sector',isHidden:true,attributes:{}}},planet:{pl1:{id:'pl1',type:'planet',name:'Meridian',parent:'sys1',parentEntity:'system',attributes:{tags:[{name:'Pretech Archive'}]}},pl2:{id:'pl2',type:'planet',name:'Hidden Meridian',parent:'sys1',parentEntity:'system',isHidden:true,attributes:{}}},researchBase:{rb1:{id:'rb1',type:'researchBase',name:'Visible Research Station',parent:'pl1',parentEntity:'planet',attributes:{occupation:'Public researchers',situation:'Stable operations'}},rb2:{id:'rb2',type:'researchBase',name:'Hidden Black Site',parent:'sys1',parentEntity:'system',isHidden:true,attributes:{occupation:'Secret staff',situation:'Secret project'}}},moon:{mHidden:{id:'mHidden',type:'moon',name:'Hidden Moon',parent:'pl2',parentEntity:'planet',attributes:{}}},moonBase:{mbHidden:{id:'mbHidden',type:'moonBase',name:'Hidden Moon Base',parent:'mHidden',parentEntity:'moon',attributes:{occupation:'Secret colonists',situation:'Hidden settlement'}}},routes:{r1:{id:'r1',name:'Old Jump',route:['0000','0303','0911'],color:'#ffaa44',width:'thick',type:'dashed'}},layers:{l1:{id:'l1',name:'Layer',regions:{g1:{name:'Amber Reach',color:'#ffaa44'},g2:{name:'Secret Zone',color:'#ff2244',isHidden:true}},hexes:{'0000':{regions:['g1','g2']},'0303':{regions:['g1']}}}},factions:{f1:{id:'f1',name:'Quiet Bloc',force:4,cunning:6,wealth:3,assets:{}}}};const s=SwnImport.fromJSON(data,'Native Browser Test.json','preserve');App.displaySector(s);const player=App.censorSector(App.currentSector);return {coordinate:App.currentSector.systems[0].x+','+App.currentSector.systems[0].y,regions:App.currentSector.regions.length,playerRegions:player.regions.length,playerHasSourceArchive:!!player.swnImport,sourceRoutes:App.currentSector.swnImport.navigationRoutes.length,drawnRouteSegments:document.querySelectorAll('.swn-navigation-route').length,auxiliaryRows:document.querySelectorAll('#source-data-auxiliary-output tbody tr').length,sourceRecords:App.currentSector.swnImport.records.length,playerSystems:player.systems.length,playerWorlds:player.systems.reduce((n,s)=>n+s.planets.length,0),hiddenSystemPreserved:!!App.currentSector.systems.find(s=>s.name==='Referee Secret'&&s.sourceIsHidden),hiddenWorldPreserved:!!App.currentSector.systems[0].planets.find(p=>p.name==='Hidden Meridian'&&p.sourceIsHidden),gmSurveyBodies:App.currentSector.systems[0].bodies.map(b=>b.name),playerSurveyBodies:player.systems[0].bodies.map(b=>b.name)}})()");
    assert(nativeImport.coordinate==='9,11'&&nativeImport.regions===2&&nativeImport.playerRegions===1&&!nativeImport.playerHasSourceArchive&&nativeImport.sourceRoutes===1&&nativeImport.drawnRouteSegments===2&&nativeImport.auxiliaryRows===3&&nativeImport.sourceRecords===9&&nativeImport.playerSystems===1&&nativeImport.playerWorlds===1&&nativeImport.hiddenSystemPreserved&&nativeImport.hiddenWorldPreserved&&nativeImport.gmSurveyBodies.includes('Visible Research Station')&&nativeImport.gmSurveyBodies.includes('Hidden Black Site')&&nativeImport.gmSurveyBodies.includes('Hidden Moon Base')&&JSON.stringify(nativeImport.playerSurveyBodies)===JSON.stringify(['Visible Research Station']),'Native SWN JSON route/layer/faction import, coordinate mapping, or hidden child-entity export filtering failed: '+JSON.stringify(nativeImport));
    console.log('PASS: native JSON import maps one-based entity coordinates, draws navigation routes, imports map regions, and lists source factions.');
    // Regression: scan the complete serialized player export, not only visible
    // survey rows. Hidden direct children and multi-level descendants must not leak.
    const privacyRegression=await evaluate("(()=>{const data={sector:{s:{id:'s',name:'Privacy Regression'}},system:{sys:{id:'sys',name:'Public System',x:1,y:1,parent:'s',parentEntity:'sector',attributes:{}}},planet:{p:{id:'p',name:'Public World',parent:'sys',parentEntity:'system',attributes:{}},hp:{id:'hp',name:'Hidden World',parent:'sys',parentEntity:'system',isHidden:true,attributes:{description:'HIDDEN_WORLD_SENTINEL'}}},researchBase:{visible:{id:'visible',name:'Public Research Station',parent:'p',parentEntity:'planet',attributes:{occupation:'PUBLIC_OWNER_SENTINEL',situation:'Public condition'}},secret:{id:'secret',name:'Hidden Research Station',parent:'sys',parentEntity:'system',isHidden:true,attributes:{occupation:'SECRET_OWNER_SENTINEL',situation:'SECRET_CONDITION_SENTINEL',description:'SECRET_DESCRIPTION_SENTINEL'}}},moon:{moon:{id:'moon',name:'Hidden Moon',parent:'hp',parentEntity:'planet',attributes:{description:'HIDDEN_MOON_SENTINEL'}}},moonBase:{mb:{id:'mb',name:'Hidden Moon Base',parent:'moon',parentEntity:'moon',attributes:{occupation:'SECRET_MOON_OWNER_SENTINEL'}}}};const source=SwnImport.fromJSON(data,'Privacy Regression.json','preserve');App.displaySector(source);const player=App.censorSector(App.currentSector);const json=JSON.stringify(player);const secrets=['HIDDEN_WORLD_SENTINEL','SECRET_OWNER_SENTINEL','SECRET_CONDITION_SENTINEL','SECRET_DESCRIPTION_SENTINEL','HIDDEN_MOON_SENTINEL','SECRET_MOON_OWNER_SENTINEL','Hidden Research Station','Hidden World','Hidden Moon','Hidden Moon Base'];return {hasSourceArchive:!!player.swnImport,publicStationRetained:json.includes('PUBLIC_OWNER_SENTINEL'),visibleParentEntityRetained:(player.systems[0].planets[0].importedEntities||[]).some(e=>e.name==='Public Research Station'),hiddenDirectEntityRetained:(player.systems[0].importedEntities||[]).some(e=>e.name==='Hidden Research Station'),secretLeaks:secrets.filter(value=>json.includes(value)),systemImportedEntities:(player.systems[0].importedEntities||[]).map(e=>e.name),planetImportedEntities:(player.systems[0].planets[0].importedEntities||[]).map(e=>e.name)}})()");
    assert(!privacyRegression.hasSourceArchive&&privacyRegression.publicStationRetained&&privacyRegression.visibleParentEntityRetained&&!privacyRegression.hiddenDirectEntityRetained&&privacyRegression.secretLeaks.length===0,'Player export must preserve public imported details while excluding hidden nested entities, ancestors, descendants, and source attributes: '+JSON.stringify(privacyRegression));
    console.log('PASS: player export privacy regression scans serialized JSON for hidden sentinels across direct and multi-level imported entities.');
    // Exercise the owner's actual sector export in Chromium after the parent
    // resolver changes; check all records and the five corrected asteroid bases.
    const acheronSource=JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','acheron-rho-native-2026-10-30.json'),'utf8'));
    const acheronExpression="(()=>{const sector=SwnImport.fromJSON("+JSON.stringify(acheronSource)+",'Acheron Rho - October 30, 2026.json','preserve');App.displaySector(sector);const entries=App.currentSector.systems.flatMap(system=>(system.bodies||[]).map(body=>({name:body.name,system:system.name,occupation:body.occupation,situation:body.situation,parent:body.sourceParentName,type:body.sourceEntityType,imported:!!body.importedFromSWN})));const expected={'Tarma 1':'Amedere Orbere','Bremerhaven':'Amedere Orbere','Schiaparelli 5':'Meneus','Tomari 3':'Pamita Cha','Crewe 6':'Phalest'};const parentChecks=Object.entries(expected).map(([name,system])=>({name,expected:system,actual:(entries.find(entry=>entry.name===name)||{}).system||''}));const research=entries.filter(entry=>entry.parent&&entry.occupation&&entry.situation);const blackHoles=App.currentSector.systems.filter(system=>system.sourceEntityType==='blackHole').map(system=>({name:system.name,systemType:system.systemType,primary:(system.bodies||[]).find(body=>body.bodyClass==='B')?.type||'',ordinaryStars:(system.bodies||[]).filter(body=>body.bodyClass==='S').length}));return {blackHoles,records:App.currentSector.swnImport.records.length,systems:App.currentSector.systems.length,planets:App.currentSector.systems.reduce((n,system)=>n+system.planets.length,0),surveyObjects:entries.filter(entry=>entry.imported).length,researchBases:entries.filter(entry=>entry.type==='researchBase').length,parentChecks,researchDetailsPresent:entries.filter(entry=>entry.type==='researchBase').length===42&&entries.filter(entry=>entry.type==='researchBase').every(entry=>entry.occupation&&entry.situation&&entry.parent)}})()";
    const acheronBrowser=await evaluate(acheronExpression);
    assert(acheronBrowser.blackHoles.length===3&&acheronBrowser.blackHoles.every(system=>system.systemType==='blackHole'&&system.primary==='Black hole'&&system.ordinaryStars===0)&&acheronBrowser.records===293&&acheronBrowser.systems===36&&acheronBrowser.planets===46&&acheronBrowser.surveyObjects===210&&acheronBrowser.parentChecks.every(check=>check.actual===check.expected)&&acheronBrowser.researchDetailsPresent,'Acheron Rho full browser import failed record counts or parent graph validation: '+JSON.stringify(acheronBrowser));
    console.log('PASS: full Acheron Rho JSON import in Chromium; 293 source records, 36 top-level systems, 46 planets, 210 survey objects, and all five repaired asteroid-base parents.');
    const responsiveness = await evaluate(`(async()=>{
      const sector=App.currentSector, svg=document.querySelector('#hexmap');
      function sample(fn,count){const values=[];for(let i=0;i<count;i++){const start=performance.now();fn();values.push(Number((performance.now()-start).toFixed(2)));}values.sort((a,b)=>a-b);return {medianMs:values[Math.floor(values.length/2)],maxMs:Math.max(...values),samples:values};}
      const map=sample(()=>Hexmap.render(svg,sector,Hexmap._state&&Hexmap._state.selectedSystem),8);
      const campaign=sample(()=>App.renderCampaignPanels(sector),4);
      const start=performance.now();
      for(let i=0;i<4;i++) App.persistSector(sector);
      await App.waitForExports();
      const exportCompletionMs=Number((performance.now()-start).toFixed(2));
      return {systems:sector.systems.length,sourceRecords:sector.swnImport.records.length,map,campaign,exportSchedulingMs:sample(()=>App.persistSector(sector),2),exportCompletionMs,workerEnabled:!!App._exportWorker};
    })()`);
    assert(responsiveness.map.maxMs<1500&&responsiveness.campaign.maxMs<2500&&responsiveness.exportSchedulingMs.maxMs<3000&&responsiveness.exportCompletionMs<10000,'Responsiveness smoke-test exceeded the generous freeze thresholds: '+JSON.stringify(responsiveness));
    console.log('PASS: responsiveness smoke test on the 36-system / 293-record imported sector: '+JSON.stringify(responsiveness));
    if (responsiveness.workerEnabled) {
      const workerQueue = await evaluate(`(async()=>{
        const sector=App.currentSector, startSeq=App._exportSequence, count=25;
        for(let i=1;i<=count;i++){sector.__workerQueueMarker='QUEUE_'+i;App.persistSector(sector);}
        const pendingLinksDisabled=!document.querySelector('#export-json-gm').getAttribute('href')&&document.querySelector('#export-json-gm').getAttribute('aria-disabled')==='true';
        await App.waitForExports();
        const gm=JSON.parse(await(await fetch(document.querySelector('#export-json-gm').href)).text());
        const result={count,sequenceDelta:App._exportSequence-startSeq,latestMarker:gm.__workerQueueMarker,pendingLinksDisabled,workerBusy:App._exportWorkerBusy,queueEmpty:!App._queuedExport,downloadReady:!!document.querySelector('#export-json-gm').href};
        delete sector.__workerQueueMarker;App.persistSector(sector);await App.waitForExports();
        return result;
      })()`);
      assert(workerQueue.sequenceDelta===25&&workerQueue.latestMarker==='QUEUE_25'&&workerQueue.pendingLinksDisabled&&!workerQueue.workerBusy&&workerQueue.queueEmpty&&workerQueue.downloadReady,'Worker save coalescing/stale-link regression failed: '+JSON.stringify(workerQueue));
      console.log('PASS: 25 rapid worker-backed saves coalesce to the newest sector snapshot; stale downloads stay disabled until completion. '+JSON.stringify(workerQueue));
    } else {
      console.log('SKIP: browser Worker queue stress is unavailable in this fallback-only context; synchronous export fallback is covered by the round-trip checks.');
    }
    // Sector Forge native GM archive round-trip: the app's own exported JSON must
    // preserve edits, custom records, campaign relationships, and original SWN source.
    const rtSource=JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','acheron-rho-native-2026-10-30.json'),'utf8'));
    const rtSetup=await evaluate(`(async()=>{const s=SwnImport.fromJSON(${JSON.stringify(rtSource)},'Acheron Rho.json','preserve');App.displaySector(s);const sys=App.currentSector.systems.find(x=>x.planets&&x.planets.length);const p=sys.planets[0];p.name='ROUNDTRIP_EDITED_WORLD';p.techLevel='TL5';p.atmosphere='ROUNDTRIP_BREATHABLE';p.description='ROUNDTRIP_DESCRIPTION_SENTINEL';p.customCampaignNote='ROUNDTRIP_CUSTOM_WORLD_NOTE';sys.pointsOfInterest=sys.pointsOfInterest||[];sys.pointsOfInterest.push({id:'ROUNDTRIP-POI',name:'ROUNDTRIP_CUSTOM_SITE',type:'Research complex'});sys.bodies=sys.bodies||[];sys.bodies.push({id:'ROUNDTRIP-BODY',name:'ROUNDTRIP_ORBITAL_STATION',type:'Orbital station',bodyClass:'N',isGeneratedWorld:false});App.currentSector.factions=App.currentSector.factions||[];App.currentSector.factions.push({id:'ROUNDTRIP-FACTION',name:'ROUNDTRIP_CUSTOM_FACTION',type:'Political',scale:'Sector',force:4,cunning:5,wealth:3,goal:'Protect the edited world',homeworldSystemId:sys.id,homeworld:sys.name,assets:[],rivals:[],turnLog:[]});App.currentSector.gmNotes='ROUNDTRIP_GM_NOTE_SENTINEL';App.persistSector(App.currentSector);await App.waitForExports();return {sys:sys.id,planet:p.id,records:App.currentSector.swnImport.records.length};})()`);
    const rt=await evaluate(`(async()=>{const gm=JSON.parse(await(await fetch(document.querySelector('#export-json-gm').href)).text());const player=JSON.parse(await(await fetch(document.querySelector('#export-json-player').href)).text());const sys=${JSON.stringify(rtSetup.sys)},pid=${JSON.stringify(rtSetup.planet)};const world=x=>x.systems.flatMap(s=>s.planets||[]).find(p=>p.id===pid);const gs=gm.systems.find(s=>s.id===sys),ps=player.systems.find(s=>s.id===sys);const gmCheck={world:world(gm),poi:(gs.pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),body:(gs.bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),faction:(gm.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),gmNote:gm.gmNotes,sourceCount:gm.swnImport&&gm.swnImport.records.length};const playerCheck={world:world(player),hasSource:!!player.swnImport,hasGMNote:Object.prototype.hasOwnProperty.call(player,'gmNotes'),hiddenSecret:JSON.stringify(player).includes('SECRET_'),redactsPoi:!(ps.pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),redactsCustomBody:!(ps.bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),redactsCampaignFactions:!(player.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION')};App.displaySector(gm);App.persistSector(App.currentSector);await App.waitForExports();const gm2=JSON.parse(await(await fetch(document.querySelector('#export-json-gm').href)).text());const g2=world(gm2);const compressed=App.compressSector(gm2);const urlRoundTrip=App.decompressSector(compressed);return {gm:{name:gmCheck.world&&gmCheck.world.name,tech:gmCheck.world&&gmCheck.world.techLevel,atmosphere:gmCheck.world&&gmCheck.world.atmosphere,description:gmCheck.world&&gmCheck.world.description,customNote:gmCheck.world&&gmCheck.world.customCampaignNote,poi:gmCheck.poi,body:gmCheck.body,faction:gmCheck.faction,gmNote:gmCheck.gmNote,sourceCount:gmCheck.sourceCount},gmReload:{name:g2&&g2.name,tech:g2&&g2.techLevel,customNote:g2&&g2.customCampaignNote,poi:(gm2.systems.find(s=>s.id===sys).pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),body:(gm2.systems.find(s=>s.id===sys).bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),faction:(gm2.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),gmNote:gm2.gmNotes,sourceCount:gm2.swnImport&&gm2.swnImport.records.length},player:{name:playerCheck.world&&playerCheck.world.name,tech:playerCheck.world&&playerCheck.world.techLevel,atmosphere:playerCheck.world&&playerCheck.world.atmosphere,hasSource:playerCheck.hasSource,hasGMNote:playerCheck.hasGMNote,hiddenSecret:playerCheck.hiddenSecret,redactsPoi:playerCheck.redactsPoi,redactsCustomBody:playerCheck.redactsCustomBody,redactsCampaignFactions:playerCheck.redactsCampaignFactions},url:{world:world(urlRoundTrip)&&world(urlRoundTrip).name,tech:world(urlRoundTrip)&&world(urlRoundTrip).techLevel,poi:(urlRoundTrip.systems.find(s=>s.id===sys).pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),faction:(urlRoundTrip.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),sourceCount:urlRoundTrip.swnImport&&urlRoundTrip.swnImport.records.length}}})()`);
    assert(rt.gm.name==='ROUNDTRIP_EDITED_WORLD'&&rt.gm.tech==='TL5'&&rt.gm.atmosphere==='ROUNDTRIP_BREATHABLE'&&rt.gm.description==='ROUNDTRIP_DESCRIPTION_SENTINEL'&&rt.gm.customNote==='ROUNDTRIP_CUSTOM_WORLD_NOTE'&&rt.gm.poi&&rt.gm.body&&rt.gm.faction&&rt.gm.gmNote==='ROUNDTRIP_GM_NOTE_SENTINEL'&&rt.gm.sourceCount===rtSetup.records,'GM JSON export lost edits or source data: '+JSON.stringify(rt.gm));
    assert(rt.gmReload.name==='ROUNDTRIP_EDITED_WORLD'&&rt.gmReload.tech==='TL5'&&rt.gmReload.customNote==='ROUNDTRIP_CUSTOM_WORLD_NOTE'&&rt.gmReload.poi&&rt.gmReload.body&&rt.gmReload.faction&&rt.gmReload.gmNote==='ROUNDTRIP_GM_NOTE_SENTINEL'&&rt.gmReload.sourceCount===rtSetup.records,'GM JSON import/re-export lost edits: '+JSON.stringify(rt.gmReload));
    assert(rt.url.world==='ROUNDTRIP_EDITED_WORLD'&&rt.url.tech==='TL5'&&rt.url.poi&&rt.url.faction&&rt.url.sourceCount===rtSetup.records,'Compressed GM URL round-trip lost edited content/source archive: '+JSON.stringify(rt.url));
    assert(rt.player.name==='ROUNDTRIP_EDITED_WORLD'&&rt.player.tech==='TL5'&&rt.player.atmosphere==='ROUNDTRIP_BREATHABLE'&&!rt.player.hasSource&&!rt.player.hasGMNote&&!rt.player.hiddenSecret&&rt.player.redactsPoi&&rt.player.redactsCustomBody&&rt.player.redactsCampaignFactions,'Player-safe export redaction behavior changed or leaked GM data: '+JSON.stringify(rt.player));
    console.log('PASS: Sector Forge own-format GM JSON export → import → re-export and compressed URL round-trip preserve edited worlds, custom notes, POIs, orbital objects, factions and SWN source records. Player export retains edited public world fields while intentionally omitting GM-only source archive/notes, POIs, custom survey objects and campaign factions. '+JSON.stringify(rt));
    assert(errors.length===0,'Browser JS errors: '+errors.slice(0,6).join(' | '));
    console.log('PASS: player-safe export retains public imported details and removes hidden records, nested raw attributes, and all descendants; zero uncaught browser JavaScript errors.');
    console.log(JSON.stringify({overall:'PASS',chromium:chrome,checks:19,baseline,densityReport,editor:{createdSystem,createdWorld,customBody,customPoi},marketLayout:{visible:marketLayout.visible,cardCount:marketLayout.cards.length,contained:true},simulation:simAfter,consoleErrors:errors.length},null,2));
  } finally {
    try { if(ws) ws.close(); } catch (_) {}
    try { chromeProcess.kill('SIGTERM'); } catch (_) {}
    await new Promise(resolve=>{let timer=setTimeout(resolve,1500);chromeProcess.once('exit',()=>{clearTimeout(timer);resolve();});});
    try { server.close(); serverClosed=true; } catch (_) {}
    try { fs.rmSync(userDir,{recursive:true,force:true}); } catch (_) {}
  }
}
main().catch(e=>{console.error('E2E FAIL:',e&&e.stack||e);process.exitCode=1;});
