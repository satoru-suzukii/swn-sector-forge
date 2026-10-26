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
    let mapState={}; for(let i=0;i<300;i++){mapState=await evaluate("({sector:typeof App!=='undefined'&&!!App.currentSector,hexes:document.querySelectorAll('#hexmap .hex-cell').length,viewer:document.querySelector('#viewer-container').className})");if(mapState.sector&&mapState.hexes===80)break;await new Promise(r=>setTimeout(r,50));}
    console.log('E2E map state',JSON.stringify(mapState)); if(!(mapState.sector&&mapState.hexes===80)){ console.log('E2E diagnostics',JSON.stringify(await evaluate("({body:document.body.innerText.slice(0,300),modal:document.querySelector('.dynmodal')?.innerText||document.querySelector('[role=dialog]')?.innerText,ready:document.readyState,textload:typeof TextLoad,performance:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,transfer:r.transferSize})).slice(-30)})"))); console.log('E2E browser errors',JSON.stringify(errors)); console.log('E2E requests',JSON.stringify(requests)); } assert(mapState.sector&&mapState.hexes===80,'Sector generation/map initialization timed out.'); if (process.env.E2E_SCREENSHOT) { await evaluate("const m=document.querySelector('#hexmap');window.scrollTo(0,Math.max(0,m.getBoundingClientRect().top-80))"); await new Promise(r=>setTimeout(r,150)); const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(process.env.E2E_SCREENSHOT,Buffer.from(shot.data,'base64')); console.log('E2E screenshot '+process.env.E2E_SCREENSHOT); }
    const baseline=await evaluate("({systems:App.currentSector.systems.length,markets:App.currentSector.markets.length,assets:App.currentSector.factions.reduce((n,f)=>n+f.assets.length,0),svg:document.querySelectorAll('#hexmap .hex-cell').length,allSvg:document.querySelector('#hexmap')?.tagName.toLowerCase()==='svg',marketCards:document.querySelectorAll('#markets-output .market-card').length})");
    assert(baseline.systems>=21 && baseline.systems<=30,'Generated sector does not have the expected system count.');
    assert(baseline.svg===80 && baseline.allSvg,'The map must be a crisp SVG containing 80 editable hexes.');
    const gridBounds=await evaluate("(()=>{const b=[...document.querySelectorAll('#hexmap .hex-cell polygon')].map(p=>p.getBBox());return {count:b.length,minX:Math.min(...b.map(r=>r.x)),minY:Math.min(...b.map(r=>r.y)),maxX:Math.max(...b.map(r=>r.x+r.width)),maxY:Math.max(...b.map(r=>r.y+r.height))}})()");
    assert(gridBounds.count===80&&gridBounds.minX>=0&&gridBounds.minY>=0&&gridBounds.maxX<=530&&gridBounds.maxY<=745,'One or more hex polygons render outside the map viewBox.');
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
        const totals={systems:sector.systems.length,worlds:sector.systems.reduce((n,s)=>n+s.planets.length,0),sites:sector.systems.reduce((n,s)=>n+(s.pointsOfInterest||[]).length,0),orbitalObjects:sector.systems.reduce((n,s)=>n+(s.bodies||[]).filter(b=>b.bodyClass!=='S'&&b.bodyClass!=='P').length,0)};
        for(const s of sector.systems){const p=s.planets.length,q=(s.pointsOfInterest||[]).length,o=(s.bodies||[]).filter(b=>b.bodyClass!=='S'&&b.bodyClass!=='P').length;
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
    // Exercise the real survey reroll action after restoring the selected live system.
    await evaluate("document.querySelector('#inspector .system-survey-heading [aria-label=\"Reroll system survey\"]').click()");
    const rerolledSurvey=await evaluate("(()=>{const s=Hexmap._state.selectedSystem,table=document.querySelector('#inspector .system-survey-table');return {hasTable:!!table,rows:table?table.querySelectorAll('tbody > tr').length:0,bodies:(s.bodies||[]).length,hasWorlds:(s.planets||[]).every(p=>(s.bodies||[]).some(b=>b.planetId===p.id)),wrap:table?getComputedStyle(table).tableLayout:'',overflow:table?table.scrollWidth>table.clientWidth:false}})()");
    assert(rerolledSurvey.hasTable&&rerolledSurvey.rows===rerolledSurvey.bodies&&rerolledSurvey.hasWorlds&&rerolledSurvey.wrap==='fixed'&&!rerolledSurvey.overflow,'Rerolling the real System Survey broke its rows, world links, or fixed layout: '+JSON.stringify(rerolledSurvey));
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
    assert(fixedView==='0 0 530 745','The map does not start with the canonical fixed viewport.');
    const staticLayout=await evaluate("(()=>{const svg=document.querySelector('#hexmap'),stage=document.querySelector('.map-canvas-scroll'),a=svg.getBoundingClientRect(),b=stage.getBoundingClientRect(),cs=getComputedStyle(stage);return {svg:{left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width,height:a.height},stage:{left:b.left,right:b.right,width:b.width,height:b.height},overflowX:cs.overflowX,overflowY:cs.overflowY,box:{view:svg.getAttribute('viewBox'),w:svg.viewBox.baseVal.width,h:svg.viewBox.baseVal.height}}})()");
    assert(staticLayout.svg.width>0&&staticLayout.svg.right<=staticLayout.stage.right+1&&staticLayout.svg.left>=staticLayout.stage.left-1,'The SVG map escapes its own layout area.');
    assert(staticLayout.overflowY==='visible'&&staticLayout.overflowX==='visible','The map has an internal scroll trap; page scrolling should remain natural.');
    const chosen=await evaluate("(()=>{const svg=document.querySelector('#hexmap'),node=svg.querySelector('.system-node'),sys=App.currentSector.systems.find(s=>s.id===node.dataset.systemId),r=node.querySelector('.system-core').getBoundingClientRect();return {id:sys.id,x:sys.x,y:sys.y,point:{x:r.left+r.width/2,y:r.top+r.height/2}}})()");
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
    const expectedTransform=await evaluate("(()=>{const s=App.currentSector.systems.find(x=>x.id==="+JSON.stringify(chosen.id)+");return 'translate('+(48+Number(s.x)*58.5)+' '+(40+(Number(s.y)+.5*(Number(s.x)%2))*67.55)+')'})()");
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
    const emptyHex = await evaluate("(()=>{const used=new Set(App.currentSector.systems.map(s=>Number(s.x)+','+Number(s.y)));for(let x=0;x<8;x++)for(let y=0;y<10;y++)if(!used.has(x+','+y))return {x,y};throw new Error('No empty hex available in 8x10 grid')})()");
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
    console.log('PASS: map editor safe visibility, empty-hex system creation, custom orbital object/site creation, and planet/market/survey linkage.');

    // Save/export data and verify browser-level errors were absent.
    const privacy=await evaluate("(()=>{const p=App.censorSector(App.currentSector);return {hasRegions:Array.isArray(p.regions),leaks:p.systems.some(s=>s.controllingFactionId||s.factionInfluence||s.manualControllerFactionId),marketLinks:p.corporationMarketLinks&&p.corporationMarketLinks.length}})()");
    assert(privacy.hasRegions&&!privacy.leaks,'Player-safe export leaked referee territorial information or omitted editable map regions.');
    assert(errors.length===0,'Browser JS errors: '+errors.slice(0,6).join(' | '));
    console.log('PASS: player-safe export filtering and zero uncaught browser JavaScript errors.');
    console.log(JSON.stringify({overall:'PASS',chromium:chrome,checks:10,baseline,densityReport,editor:{createdSystem,createdWorld,customBody,customPoi},marketLayout:{visible:marketLayout.visible,cardCount:marketLayout.cards.length,contained:true},simulation:simAfter,consoleErrors:errors.length},null,2));
  } finally {
    try { if(ws) ws.close(); } catch (_) {}
    try { chromeProcess.kill('SIGTERM'); } catch (_) {}
    await new Promise(resolve=>{let timer=setTimeout(resolve,1500);chromeProcess.once('exit',()=>{clearTimeout(timer);resolve();});});
    try { server.close(); serverClosed=true; } catch (_) {}
    try { fs.rmSync(userDir,{recursive:true,force:true}); } catch (_) {}
  }
}
main().catch(e=>{console.error('E2E FAIL:',e&&e.stack||e);process.exitCode=1;});
