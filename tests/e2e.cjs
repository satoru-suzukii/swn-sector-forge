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
const NAVIGATION_HOST = process.env.E2E_HOST || '127.0.0.1';
const CDP_COMMAND_TIMEOUT_MS = Math.max(1000, Number(process.env.E2E_COMMAND_TIMEOUT_MS || 45000));
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
  const chromeProcess=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--no-proxy-server','--user-data-dir='+userDir,'--window-size=1440,1200','--host-resolver-rules=MAP '+NAVIGATION_HOST+' 127.0.0.1',INLINE_MODE?'about:blank':'http://'+NAVIGATION_HOST+':'+port],{stdio:'ignore',detached:process.platform !== 'win32'});
  let ws;
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
    ws.addEventListener('close',()=>{for(const entry of pending.values())entry.reject(new Error('Chromium DevTools connection closed with commands still pending.'));pending.clear();});
    ws.addEventListener('error',()=>{for(const entry of pending.values())entry.reject(new Error('Chromium DevTools websocket reported an error.'));pending.clear();});
    function cmd(method,params={}){
      const id=++nextId;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{
          pending.delete(id);
          reject(new Error('Chromium DevTools command '+method+' timed out after '+CDP_COMMAND_TIMEOUT_MS+' ms. The browser may be unresponsive; terminating this isolated test browser.'));
        },CDP_COMMAND_TIMEOUT_MS);
        pending.set(id,{
          resolve(value){clearTimeout(timer);resolve(value);},
          reject(error){clearTimeout(timer);reject(error);}
        });
        try { ws.send(JSON.stringify({id,method,params})); }
        catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
      });
    }
    let evaluationCount=0;
    async function evaluate(expression) {
      evaluationCount++;
      try {
        const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
        if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||''));
        return r.result&&r.result.value;
      } catch(error) {
        error.message='Browser evaluation #'+evaluationCount+': '+error.message;
        throw error;
      }
    }
    console.log('E2E websocket connected'); await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Log.enable'); console.log('E2E CDP enabled');
    if (INLINE_MODE) { const tree=await cmd('Page.getFrameTree'); await cmd('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:inlinePage()}); }
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    console.log('E2E evaluating app readiness');
    let appState={}; for(let i=0;i<200;i++){appState=await evaluate("({app:typeof App,ready:document.readyState,button:!!document.querySelector('#generate-button'),initialized:!!document.querySelector('#generator-container')&&!document.querySelector('#generator-container').classList.contains('hide-section'),modal:!!document.querySelector('.dynmodal-container'),body:document.body.innerText.slice(0,80)})");if(appState.app!=='undefined'&&appState.button&&appState.initialized)break;await new Promise(r=>setTimeout(r,50));}
    console.log('E2E app state',JSON.stringify(appState)); assert(appState.app!=='undefined'&&appState.button,'Application scripts did not initialize.');
    await evaluate("document.querySelector('#generate-button').click()"); console.log('E2E sector generation triggered');
    let mapState={}; for(let i=0;i<300;i++){mapState=await evaluate("({sector:typeof App!=='undefined'&&!!App.currentSector,hexes:document.querySelectorAll('#hexmap .hex-cell').length,viewer:document.querySelector('#viewer-container').className})");if(mapState.sector&&mapState.hexes===120)break;await new Promise(r=>setTimeout(r,50));}
    console.log('E2E map state',JSON.stringify(mapState)); if(!(mapState.sector&&mapState.hexes===120)){ console.log('E2E diagnostics',JSON.stringify(await evaluate("({body:document.body.innerText.slice(0,300),modal:document.querySelector('.dynmodal')?.innerText||document.querySelector('[role=dialog]')?.innerText,ready:document.readyState,textload:typeof TextLoad,performance:performance.getEntriesByType('resource').map(r=>({name:r.name,duration:r.duration,transfer:r.transferSize})).slice(-30)})"))); console.log('E2E browser errors',JSON.stringify(errors)); console.log('E2E requests',JSON.stringify(requests)); } assert(mapState.sector&&mapState.hexes===120,'Sector generation/map initialization timed out.'); if (process.env.E2E_SCREENSHOT) { await evaluate("const m=document.querySelector('#hexmap');window.scrollTo(0,Math.max(0,m.getBoundingClientRect().top-80))"); await new Promise(r=>setTimeout(r,150)); const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(process.env.E2E_SCREENSHOT,Buffer.from(shot.data,'base64')); console.log('E2E screenshot '+process.env.E2E_SCREENSHOT); }
    // World/Alien directory columns must remain readable on narrow screens.
    await cmd('Emulation.setDeviceMetricsOverride',{width:320,height:780,deviceScaleFactor:1,mobile:false});
    const narrowDirectoryLayout=await evaluate(`(()=>{
      const buttons=[...document.querySelectorAll('.dyntab-button')];
      const switchTo=name=>{const button=buttons.find(item=>item.textContent.trim()===name);if(button)button.click();return !!button;};
      const testWorld={id:'LAYOUT-WORLD',name:'Layout Planet',atmosphere:'Breathable mix',gravity:'standard',temperature:'temperate',biosphere:'human-miscible',population:'millions',techLevel:'TL 4 — Pretech / Orbital',tag1:'Xenophobic',tag2:'Technologically Advanced',terrain:'Billowing Ash Fields',generationMode:'core'};
      const testSector={worldGenerationMode:'core',systems:[{id:'LAYOUT-SYSTEM',name:'Layout System',x:0,y:0,planets:[testWorld]}]};
      App.displayWorlds(testSector);switchTo('Worlds');
      const worldOut=document.querySelector('#worlds-output'),worldTable=worldOut&&worldOut.querySelector('.dyntable'),worldRow=worldTable&&worldTable.querySelector('tbody tr');
      const worldColWidths=worldTable?[...worldTable.querySelectorAll('colgroup col')].map(col=>Math.round(col.getBoundingClientRect().width)):[];
      const worldCells=worldRow?[...worldRow.cells]:[];
      const world={container:Math.round(worldOut.getBoundingClientRect().width),scroll:worldOut.scrollWidth,table:Math.round(worldTable.getBoundingClientRect().width),tag1:worldCells[9]?.textContent.trim(),tag2:worldCells[10]?.textContent.trim(),terrain:worldCells[13]?.textContent.trim(),techWidth:Math.round(worldCells[8]?.getBoundingClientRect().width||0),techWhiteSpace:worldCells[8]?getComputedStyle(worldCells[8]).whiteSpace:'',techTextFits:(()=>{const cell=worldCells[8];if(!cell)return false;const range=document.createRange();range.selectNodeContents(cell);const rects=[...range.getClientRects()],box=cell.getBoundingClientRect(),style=getComputedStyle(cell),right=box.right-parseFloat(style.paddingRight||0);return rects.length>0&&rects.every(rect=>rect.right<=right+1);})(),tagWidth:Math.round(worldCells[9]?.getBoundingClientRect().width||0),terrainWidth:Math.round(worldCells[13]?.getBoundingClientRect().width||0),editWidth:Math.round(worldCells[14]?.getBoundingClientRect().width||0),editWhiteSpace:worldCells[14]?getComputedStyle(worldCells[14]).whiteSpace:'',wrap:worldCells[9]?getComputedStyle(worldCells[9]).overflowWrap:'' ,colWidths:worldColWidths};
      App.displayWorlds(App.currentSector);
      const alienFixture={aliens:[{name:'Long Form Test Species',type:'aquatic',body:'Amphibious with layered breathing membranes',lenses:'Communal memory',government:'Consensus federation'}]};
      App.displayAliens(alienFixture);switchTo('Aliens');
      const alienOut=document.querySelector('#aliens-output'),alienTable=alienOut&&alienOut.querySelector('.dyntable'),alienRow=alienTable&&alienTable.querySelector('tbody tr'),alienCells=alienRow?[...alienRow.cells]:[];
      const alien={container:Math.round(alienOut.getBoundingClientRect().width),scroll:alienOut.scrollWidth,table:Math.round(alienTable.getBoundingClientRect().width),editWidth:Math.round(alienCells[5]?.getBoundingClientRect().width||0),editWhiteSpace:alienCells[5]?getComputedStyle(alienCells[5]).whiteSpace:'',wrap:alienCells[0]?getComputedStyle(alienCells[0]).overflowWrap:''};
      App.displayAliens(App.currentSector);
      const corporationFixture={markets:[],corporations:[{id:'LAYOUT-CORP',name:'The Interstellar Corporate Conglomerate',markets:'Heavy manufacturing, interstellar logistics, planetary resource extraction, and proprietary technologies',linkedMarketIds:[],ownership:'Public shareholder consortium',strategy:'Vertical integration and aggressive expansion across frontier settlements',valuation:'145,000 Cr'}]};
      App.displayCorporationDirectory(corporationFixture);switchTo('Corporations');
      const corpOut=document.querySelector('#corporations-output'),corpTable=corpOut&&corpOut.querySelector('.dyntable'),corpRow=corpTable&&corpTable.querySelector('tbody tr'),corpCells=corpRow?[...corpRow.cells]:[];
      const corpEdit=corpCells[6],corpRange=corpEdit?document.createRange():null;if(corpRange)corpRange.selectNodeContents(corpEdit);
      const corpEditRects=corpRange?[...corpRange.getClientRects()]:[],corpEditBox=corpEdit&&corpEdit.getBoundingClientRect();
      const corporation={container:Math.round(corpOut.getBoundingClientRect().width),scroll:corpOut.scrollWidth,table:Math.round(corpTable.getBoundingClientRect().width),columnWidths:corpTable?[...corpTable.querySelectorAll('colgroup col')].map(col=>Math.round(col.getBoundingClientRect().width)):[],editWidth:Math.round(corpEdit?.getBoundingClientRect().width||0),editWhiteSpace:corpEdit?getComputedStyle(corpEdit).whiteSpace:'',editTextFits:!!(corpEditBox&&corpEditRects.length&&corpEditRects.every(rect=>rect.right<=corpEditBox.right-parseFloat(getComputedStyle(corpEdit).paddingRight||0)+1)),sectorInterests:corpCells[1]?.textContent.trim()||'',strategy:corpCells[4]?.textContent.trim()||''};
      App.displayCorporationDirectory(App.currentSector);
      return {viewport:innerWidth,world,alien,corporation};
    })()`);
    assert(narrowDirectoryLayout.viewport===320&&narrowDirectoryLayout.world.container<=320&&narrowDirectoryLayout.world.table>=1475&&narrowDirectoryLayout.world.scroll>=1475&&narrowDirectoryLayout.world.techWidth>=100&&narrowDirectoryLayout.world.techTextFits&&narrowDirectoryLayout.world.tagWidth>=100&&narrowDirectoryLayout.world.terrainWidth>=105&&narrowDirectoryLayout.world.editWidth>=70&&narrowDirectoryLayout.world.editWhiteSpace==='nowrap'&&narrowDirectoryLayout.world.tag1==='Xenophobic'&&narrowDirectoryLayout.world.tag2==='Technologically Advanced'&&narrowDirectoryLayout.world.terrain==='Billowing Ash Fields'&&narrowDirectoryLayout.alien.container<=320&&narrowDirectoryLayout.alien.table>=820&&narrowDirectoryLayout.alien.scroll>=820&&narrowDirectoryLayout.alien.editWidth>=75&&narrowDirectoryLayout.alien.editWhiteSpace==='nowrap'&&narrowDirectoryLayout.corporation.container<=320&&narrowDirectoryLayout.corporation.table>=1000&&narrowDirectoryLayout.corporation.scroll>=1000&&narrowDirectoryLayout.corporation.editWidth>=80&&narrowDirectoryLayout.corporation.editWhiteSpace==='nowrap'&&narrowDirectoryLayout.corporation.editTextFits&&narrowDirectoryLayout.corporation.sectorInterests.includes('interstellar logistics')&&narrowDirectoryLayout.corporation.strategy.includes('frontier settlements'),'World Tech Level/Tag or Corporation Edit columns compressed and overlapped at mobile width: '+JSON.stringify(narrowDirectoryLayout));
    console.log('PASS: World Tech Level/tags/terrain, Alien Edit, and Corporation Edit retain readable columns and horizontal scrolling at 320px. '+JSON.stringify(narrowDirectoryLayout));
    if (process.env.E2E_LAYOUT_ONLY === '1') {
      const viewportReports=[];
      for (const width of [390,768,1024,1440]) {
        await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        const report=await evaluate(`(()=>{
          const worldFixture={worldGenerationMode:'core',systems:[{id:'VP-S',name:'Viewport System',x:0,y:0,planets:[{id:'VP-W',name:'Viewport World',atmosphere:'Breathable mix',gravity:'standard',temperature:'temperate',biosphere:'human-miscible',techLevel:'TL 4 — Pretech / Orbital',tag1:'Xenophobic',tag2:'Technologically Advanced',population:'millions',terrain:'Billowing Ash Fields',generationMode:'core'}]}]};
          App.displayWorlds(worldFixture);[...document.querySelectorAll('.dyntab-button')].find(b=>b.textContent.trim()==='Worlds')?.click();
          const wo=document.querySelector('#worlds-output'),wt=wo.querySelector('.dyntable'),wr=wt.querySelector('tbody tr'),wc=[...wr.cells];
          const fits=cell=>{const range=document.createRange();range.selectNodeContents(cell);const rects=[...range.getClientRects()],box=cell.getBoundingClientRect(),right=box.right-parseFloat(getComputedStyle(cell).paddingRight||0);return rects.length>0&&rects.every(r=>r.right<=right+1);};
          const world={container:Math.round(wo.getBoundingClientRect().width),table:Math.round(wt.getBoundingClientRect().width),scroll:wo.scrollWidth,tech:Math.round(wc[8].getBoundingClientRect().width),tag1:Math.round(wc[9].getBoundingClientRect().width),tag2:Math.round(wc[10].getBoundingClientRect().width),techFits:fits(wc[8]),tag1Fits:fits(wc[9]),tag2Fits:fits(wc[10])};
          const corpFixture={markets:[],corporations:[{name:'Corporate fixture',markets:'Long manufacturing, transport and research interests',linkedMarketIds:[],ownership:'Shareholder group',strategy:'Vertical expansion into frontier settlements',valuation:'145,000 Cr'}]};
          App.displayCorporationDirectory(corpFixture);[...document.querySelectorAll('.dyntab-button')].find(b=>b.textContent.trim()==='Corporations')?.click();
          const co=document.querySelector('#corporations-output'),ct=co.querySelector('.dyntable'),cr=ct.querySelector('tbody tr'),cc=[...cr.cells],edit=cc[6],eb=edit.getBoundingClientRect(),er=document.createRange();er.selectNodeContents(edit);const editRects=[...er.getClientRects()];
          const corporation={container:Math.round(co.getBoundingClientRect().width),table:Math.round(ct.getBoundingClientRect().width),scroll:co.scrollWidth,edit:Math.round(eb.width),nowrap:getComputedStyle(edit).whiteSpace==='nowrap',editFits:editRects.length>0&&editRects.every(r=>r.right<=eb.right-parseFloat(getComputedStyle(edit).paddingRight||0)+1)};
          return {viewport:innerWidth,world,corporation};
        })()`);
        viewportReports.push(report);
      }
      assert(viewportReports.every(r=>r.world.tech>=100&&r.world.tag1>=105&&r.world.tag2>=105&&r.world.techFits&&r.world.tag1Fits&&r.world.tag2Fits&&r.world.table>=1475&&r.corporation.edit>=80&&r.corporation.nowrap&&r.corporation.editFits&&r.corporation.table>=1000),'Responsive directory layout failed at one or more widths: '+JSON.stringify(viewportReports));
      console.log('PASS: World Tech Level/tags and Corporation Edit remain stable at 390, 768, 1024, and 1440px. '+JSON.stringify(viewportReports));
      return;
    }
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelectorAll('.dyntab-button')[1]?.click()");
    const baseline=await evaluate("({systems:App.currentSector.systems.length,markets:App.currentSector.markets.length,assets:App.currentSector.factions.reduce((n,f)=>n+f.assets.length,0),svg:document.querySelectorAll('#hexmap .hex-cell').length,allSvg:document.querySelector('#hexmap')?.tagName.toLowerCase()==='svg',marketCards:document.querySelectorAll('#markets-output .market-card').length})");
    const generationDisplayCheck=await evaluate("(()=>{const s=App.currentSector,rows=[...document.querySelectorAll('#worlds-output tbody tr')],first=rows[0]?[...rows[0].children].map(c=>c.textContent.trim()):[],mode=s.worldGenerationMode,alienCount=(s.aliens||[]).length,alienRows=document.querySelectorAll('#aliens-output tbody tr').length;return {mode,tagCandidateCell:first[11]||'',populationEstimateCell:first[12]||'',worldStatus:document.querySelector('#world-generation-profile-status')?.textContent||'',alienCount,alienRows,alienStatus:document.querySelector('#alien-catalog-status')?.textContent||''};})()");
    assert(generationDisplayCheck.mode==='core'&&generationDisplayCheck.tagCandidateCell==='Not generated (Core)'&&generationDisplayCheck.populationEstimateCell==='Not generated (Core)'&&generationDisplayCheck.worldStatus.includes('Revised Edition Core'),'Core-profile supplemental world columns must explain why the third tag and population estimate are absent: '+JSON.stringify(generationDisplayCheck));
    assert(generationDisplayCheck.alienCount>=3&&generationDisplayCheck.alienCount<=8&&generationDisplayCheck.alienRows===generationDisplayCheck.alienCount&&generationDisplayCheck.alienStatus.includes(String(generationDisplayCheck.alienCount)),'Generated alien count must remain in the documented 3–8 range and render every species record: '+JSON.stringify(generationDisplayCheck));
    const expandedWorldDisplayCheck=await evaluate("(()=>{const planet=WorldGenerator.generatePlanet('expanded'),testSector={worldGenerationMode:'expanded',systems:[{id:'E2E-EXPANDED',name:'Expanded Test',x:0,y:0,planets:[planet]}]};App.displayWorlds(testSector);const cells=[...document.querySelectorAll('#worlds-output tbody tr')][0]?.children||[];const result={mode:planet.generationMode,tag:planet.tagCandidate3,estimate:planet.populationEstimate,tagCell:cells[11]?.textContent.trim()||'',estimateCell:cells[12]?.textContent.trim()||'',status:document.querySelector('#world-generation-profile-status')?.textContent||''};App.displayWorlds(App.currentSector);return result;})()");
    assert(expandedWorldDisplayCheck.mode==='expanded'&&!!expandedWorldDisplayCheck.tag&&!!expandedWorldDisplayCheck.estimate&&expandedWorldDisplayCheck.tagCell===expandedWorldDisplayCheck.tag&&expandedWorldDisplayCheck.estimateCell===expandedWorldDisplayCheck.estimate&&expandedWorldDisplayCheck.status.includes('Expanded'),'Expanded profile must create and display both supplemental world fields: '+JSON.stringify(expandedWorldDisplayCheck));
    const alienCatalogRoundTrip=await evaluate("(()=>{const original=App.currentSector,six=Array.from({length:6},(_,i)=>({name:'Preservation Species '+(i+1),type:'exotic',body:'test morphology',lenses:'curiosity',government:'Democratic'})),copy=JSON.parse(JSON.stringify(original));copy.aliens=six;const compressed=App.compressSector(copy),decoded=App.decompressSector(compressed),player=App.censorSector(copy);App.displayAliens(copy);const rendered=document.querySelectorAll('#aliens-output tbody tr').length;App.displayAliens(original);return {source:copy.aliens.length,decoded:decoded.aliens.length,player:player.aliens.length,rendered};})()");
    assert(alienCatalogRoundTrip.source===6&&alienCatalogRoundTrip.decoded===6&&alienCatalogRoundTrip.player===6&&alienCatalogRoundTrip.rendered===6,'A six-entry alien catalog must survive GM serialization, player-safe copying, and table rendering without truncation: '+JSON.stringify(alienCatalogRoundTrip));
    console.log('PASS: Core/Expanded world-column semantics, random alien catalog count visibility, and six-entry GM/player/render round-trip.');
    const foundationCheck=await evaluate("(()=>{const s=App.currentSector,player=App.censorSector(s),before=JSON.stringify(s),derived=SectorSimulation.calculateDerivedState(s),after=JSON.stringify(s);return {hasEnvelope:!!s.simulation,simulationSchema:s.simulation?.schemaVersion,legacySchema:s.schemaVersion,clock:s.simulation?.clock?.turn,legacyTurn:s.factionTurn,sourceVersion:s.simulation?.migration?.sourceApplicationVersion,devLabel:document.querySelector('.version-label')?.textContent,engineVersion:s.simulation?.engineVersion,economyEngine:SectorEconomy.constants?.engineVersion,settlementEngine:SectorSettlement.constants?.engineVersion,transportEngine:typeof SectorTransport==='object'&&SectorTransport.constants?.engineVersion,logisticsEngine:typeof SectorLogistics,logisticsVersion:typeof SectorLogistics==='object'&&SectorLogistics.constants?.engineVersion,logisticsSummary:typeof SectorLogistics!=='undefined'&&SectorLogistics.getSummary(s),playerHasSimulation:Object.prototype.hasOwnProperty.call(player,'simulation'),derivedFingerprint:derived.fingerprint,cachedFingerprint:s.simulation?.derived?.lastFingerprint,derivedReadOnly:before===after}})()");
    assert(foundationCheck.hasEnvelope&&foundationCheck.simulationSchema===1&&foundationCheck.legacySchema===3&&foundationCheck.clock===foundationCheck.legacyTurn,'Generated sector did not receive the compatible 1.3 simulation envelope: '+JSON.stringify(foundationCheck));
    assert(foundationCheck.devLabel==='SECTOR FORGE 1.4.1'&&foundationCheck.sourceVersion==='1.4.1'&&foundationCheck.engineVersion==='1.3.12'&&foundationCheck.economyEngine==='1.3.8'&&foundationCheck.settlementEngine==='1.3.12'&&foundationCheck.transportEngine==='1.3.12'&&foundationCheck.logisticsEngine==='object'&&foundationCheck.logisticsVersion==='1.3.12'&&foundationCheck.logisticsSummary.initialized&&!foundationCheck.playerHasSimulation&&foundationCheck.derivedReadOnly&&/^fnv1a-/.test(foundationCheck.derivedFingerprint)&&foundationCheck.cachedFingerprint===foundationCheck.derivedFingerprint,'1.4.1 application identity, source provenance, independent engine versions, logistics initialization, player privacy, or derived-state contract failed: '+JSON.stringify(foundationCheck));
    console.log('PASS: application 1.4.1 identity, source provenance, independent simulation-engine versions, derived-state purity, and player export privacy.');
    const politicsChronicleUi=await evaluate("(()=>{const s=App.currentSector,a=s.factions[0],b=s.factions[1];if(!a||!b)throw new Error('Generated sector needs two factions for the political UI check');const t=SectorPolitics.proposeTreaty(s,{name:'E2E treaty proposal',type:'trade pact',parties:[{type:'faction',id:a.id},{type:'faction',id:b.id}]});App.renderCampaignPanels(s);const rows=document.querySelectorAll('#politics-treaties-output tbody tr').length;const input=document.querySelector('#chronicle-note-text');input.value='E2E_PRIVATE_CHRONICLE_NOTE';document.querySelector('#chronicle-note-add').click();const player=App.censorSector(s);return {treaty:t.status,treatyRows:rows,noteVisible:document.querySelector('#chronicle-output').innerText.includes('E2E_PRIVATE_CHRONICLE_NOTE'),gmNote:s.simulation.chronicle.events.some(e=>e.gmNote==='E2E_PRIVATE_CHRONICLE_NOTE'),playerHasSimulation:Object.prototype.hasOwnProperty.call(player,'simulation'),filter:!!document.querySelector('#chronicle-filter'),sanctionsPanel:!!document.querySelector('#politics-sanctions-output'),warsPanel:!!document.querySelector('#politics-wars-output')}})()");
    assert(politicsChronicleUi.treaty==='proposed'&&politicsChronicleUi.treatyRows>0&&politicsChronicleUi.noteVisible&&politicsChronicleUi.gmNote&&!politicsChronicleUi.playerHasSimulation&&politicsChronicleUi.filter&&politicsChronicleUi.sanctionsPanel&&politicsChronicleUi.warsPanel,'1.3.8 formal politics or GM Chronicle UI/privacy regression failed: '+JSON.stringify(politicsChronicleUi));
    console.log('PASS: formal political proposal panel, searchable Chronicle, private GM notes, and player-safe export boundary.');
    const retentionUi=await evaluate("(()=>({chronicle:document.querySelector('#chronicle-retention-status')?.textContent||'',factionHistory:document.querySelector('#faction-history-retention-status')?.textContent||'',chronicleRole:document.querySelector('#chronicle-retention-status')?.getAttribute('role'),factionRole:document.querySelector('#faction-history-retention-status')?.getAttribute('role')}))()");
    assert(retentionUi.chronicle.includes('Chronicle events')&&retentionUi.factionHistory.includes('faction turns')&&retentionUi.chronicleRole==='status'&&retentionUi.factionRole==='status','History retention disclosure or accessible status semantics failed: '+JSON.stringify(retentionUi));
    console.log('PASS: visible, accessible Chronicle and faction-history retention status communicates what is retained and compacted.');
    const recoveryGuards=await evaluate("(async()=>{const player=await App.saveLocalRecoverySnapshot({gmMode:false,systems:[]},'privacy-test');const first=App.checksumLocalRecoveryJSON('{\\\"sector\\\":1}'),same=App.checksumLocalRecoveryJSON('{\\\"sector\\\":1}'),changed=App.checksumLocalRecoveryJSON('{\\\"sector\\\":2}');return {playerRejected:player.ok===false&&/referee-edition/i.test(player.reason),checksumStable:first===same,checksumDetectsChange:first!==changed}})()");
    assert(recoveryGuards.playerRejected&&recoveryGuards.checksumStable&&recoveryGuards.checksumDetectsChange,'Local recovery GM-only guard or snapshot checksum behavior failed: '+JSON.stringify(recoveryGuards));
    console.log('PASS: local recovery rejects player-edition snapshots and detects accidental snapshot changes.');
    const recoveryUi=await evaluate("(()=>({toggle:document.querySelector('#recovery-auto-enable')?.type,save:!!document.querySelector('#recovery-save-button'),restore:!!document.querySelector('#recovery-restore-button'),clear:!!document.querySelector('#recovery-clear-button'),statusRole:document.querySelector('#recovery-status')?.getAttribute('role'),privacyText:document.querySelector('.recovery-panel')?.innerText||''}))()");
    assert(recoveryUi.toggle==='checkbox'&&recoveryUi.save&&recoveryUi.restore&&recoveryUi.clear&&recoveryUi.statusRole==='status'&&recoveryUi.privacyText.includes('Nothing is uploaded')&&recoveryUi.privacyText.includes('shared devices'),'Local recovery UI, explicit opt-in, privacy disclosure, or accessible status failed: '+JSON.stringify(recoveryUi));
    console.log('PASS: opt-in local recovery controls, device-only privacy disclosure, and accessible status render correctly.');
    const recoveryStorage=await evaluate(`(async()=>{const copy=JSON.parse(JSON.stringify(App.currentSector));copy.name='E2E_LOCAL_RECOVERY_SENTINEL';const saved=await App.saveLocalRecoverySnapshot(copy,'e2e-validation');if(!saved.ok)return {available:false,reason:saved.reason||'storage unavailable'};const loaded=await App.getLocalRecoverySnapshot();const roundTrip=loaded&&loaded.sector&&loaded.sector.name==='E2E_LOCAL_RECOVERY_SENTINEL'&&loaded.appVersion===App.VERSION;await App.clearLocalRecoverySnapshot();const cleared=!(await App.getLocalRecoverySnapshot());return {available:true,roundTrip,cleared};})()`);
    if(recoveryStorage.available) assert(recoveryStorage.roundTrip&&recoveryStorage.cleared,'IndexedDB local recovery save/read/delete round-trip failed: '+JSON.stringify(recoveryStorage));
    else console.log('SKIP: IndexedDB local recovery transaction test unavailable in the inline/opaque-origin Chromium context: '+recoveryStorage.reason);
    if(recoveryStorage.available) console.log('PASS: IndexedDB local recovery snapshot write/read/delete round-trip preserves the GM snapshot on this browser origin.');
    const economyInitial=await evaluate("(()=>{const s=App.currentSector,e=s.simulation.economy,card=document.querySelector('#markets-output .market-card');if(card){card.open=true;App.renderMarketDetail(s,s.markets.find(m=>String(m.id)===String(card.dataset.marketId)),card);}return {initialized:!!e?.initialized,markets:e?.marketStates?.length,sectorMarkets:s.markets.length,accountCount:e?.marketStates?.reduce((n,m)=>n+(m.inventory||[]).length,0),hasButton:!!document.querySelector('#markets-initialize-economy'),hasStockColumn:[...document.querySelectorAll('#markets-output th')].some(th=>th.textContent==='Stock / target'),lazyTables:document.querySelectorAll('#markets-output .market-card table').length};})()");
    assert(economyInitial.initialized&&economyInitial.markets===economyInitial.sectorMarkets&&economyInitial.accountCount>0&&economyInitial.hasButton&&economyInitial.hasStockColumn,'Newly generated sector did not initialize its 1.3.5 local economy: '+JSON.stringify(economyInitial));
    const logisticsInitial=await evaluate("(()=>({loaded:typeof SectorLogistics==='object',panel:!!document.querySelector('#shipments-output'),status:document.querySelector('#logistics-status')?.textContent||'',routeHeaders:[...document.querySelectorAll('#routes-output th')].map(x=>x.textContent),shipmentHeaders:[...document.querySelectorAll('#shipments-output th')].map(x=>x.textContent)}))()");
    assert(logisticsInitial.loaded&&logisticsInitial.panel&&logisticsInitial.status.includes('0 in transit')&&logisticsInitial.routeHeaders.includes('Cargo capacity / turn')&&logisticsInitial.routeHeaders.includes('Toll / cargo unit'),'The 1.3.6 logistics engine or route controls did not initialize in the campaign UI: '+JSON.stringify(logisticsInitial));
    console.log('PASS: generated sectors initialize logistics state and render cargo-unit route capacity, toll, and shipment controls.');
    const financeInitial=await evaluate("(()=>({loaded:typeof SectorSettlement==='object',initialized:SectorSettlement.getSummary(App.currentSector).initialized,accounts:SectorSettlement.getSummary(App.currentSector).accounts,panel:!!document.querySelector('#finance-output'),headers:[...document.querySelectorAll('#finance-output th')].map(th=>th.textContent),playerSimulation:Object.prototype.hasOwnProperty.call(App.censorSector(App.currentSector),'simulation')}))()");
    assert(financeInitial.loaded&&financeInitial.initialized&&financeInitial.accounts>0&&financeInitial.panel&&financeInitial.headers.includes('Overdraft warning (Cr)')&&!financeInitial.playerSimulation,'1.3.5 commercial settlement UI, account initialization, or player privacy failed: '+JSON.stringify(financeInitial));
    const strategyInitial=await evaluate("({loaded:typeof SectorDiplomacy==='object'&&typeof SectorStrategic==='object',panel:!!document.querySelector('#strategic-output'),diplomacyPanel:!!document.querySelector('#diplomacy-output')})");
    assert(strategyInitial.loaded&&strategyInitial.panel&&strategyInitial.diplomacyPanel,'1.3.6 diplomacy/strategic engines or campaign panels did not load.');
    const commerceInitial=await evaluate("(()=>({contractEngine:typeof SectorTradeContracts==='object',contractPanel:!!document.querySelector('#contracts-output'),contractButton:!!document.querySelector('#trade-contract-add'),freightPanel:!!document.querySelector('#commodity-freight-output'),routeHeaders:[...document.querySelectorAll('#routes-output th')].map(x=>x.textContent),shipmentHeaders:[...document.querySelectorAll('#shipments-output th')].map(x=>x.textContent),freightHeaders:[...document.querySelectorAll('#commodity-freight-output th')].map(x=>x.textContent),contractHeaders:[...document.querySelectorAll('#contracts-output th')].map(x=>x.textContent),contractsInitialized:!!App.currentSector.simulation.economy.contracts,validation:SectorTradeContracts.validate(App.currentSector)}))()");
    assert(commerceInitial.contractEngine&&commerceInitial.contractPanel&&commerceInitial.contractButton&&commerceInitial.freightPanel&&commerceInitial.contractsInitialized&&commerceInitial.validation.ok&&commerceInitial.routeHeaders.includes('Operating cost / cargo unit')&&commerceInitial.freightHeaders.includes('Freight units / lot'),'1.3.6 commerce/contract/freight UI failed to initialize: '+JSON.stringify(commerceInitial));
    const strategicTransportInitial=await evaluate("(()=>{const s=App.currentSector,settings=SectorStrategic.getSettings(s),summary=SectorTransport.getSummary(s),ports=[...document.querySelectorAll('#transport-ports-output tbody tr')],fleets=[...document.querySelectorAll('#transport-fleets-output tbody tr')],strategicHeaders=[...document.querySelectorAll('#strategic-output th')].map(x=>x.textContent);const corp=s.corporations&&s.corporations[0];let privacy={checked:false,missing:false};if(corp){const keys=['lastStrategicAction','lastStrategicActionTurn','lastStrategicActionReason','marketOutlook','marketOutlookTurn'],saved={};keys.forEach(k=>{saved[k]=corp[k];corp[k]='E2E-PRIVATE-SENTINEL';});const player=App.censorSector(s),publicCorp=(player.corporations||[]).find(c=>c.id===corp.id)||{};privacy={checked:true,missing:keys.every(k=>!Object.prototype.hasOwnProperty.call(publicCorp,k))};keys.forEach(k=>{if(saved[k]===undefined)delete corp[k];else corp[k]=saved[k];});}return {strategicLoaded:typeof SectorStrategic==='object',transportLoaded:typeof SectorTransport==='object',settings,summary,portRows:ports.length,fleetRows:fleets.length,transportStatus:document.querySelector('#transport-status')?.textContent||'',hasFleetButton:!!document.querySelector('#transport-fleet-add'),hasStrategyButton:!!document.querySelector('#strategic-settings-edit'),strategicHeaders,privacy};})()")
    assert(strategicTransportInitial.strategicLoaded&&strategicTransportInitial.transportLoaded&&strategicTransportInitial.settings.enabled&&strategicTransportInitial.settings.factionAutonomy&&strategicTransportInitial.settings.factionPoliticalAutonomy&&strategicTransportInitial.settings.corporateAutonomy&&strategicTransportInitial.settings.decisionNoise===0.16&&strategicTransportInitial.summary.ports>0&&strategicTransportInitial.portRows>0&&strategicTransportInitial.hasFleetButton&&strategicTransportInitial.hasStrategyButton&&strategicTransportInitial.privacy.checked&&strategicTransportInitial.privacy.missing,'1.3.10 strategic/political autonomy controls, initialized port infrastructure, or private corporate intelligence rendering/export protection failed: '+JSON.stringify(strategicTransportInitial));
    const fleetUiCheck=await evaluate("(()=>{const s=App.currentSector,id='E2E-FLEET-'+String(s.factionTurn||0),created=SectorTransport.createFleet(s,{id,name:'E2E validation vessel',type:'Test freighter',ownerType:'independent',ownerId:'E2E',homeSystemId:s.systems[0].id,capacityPerTurn:12,speed:1.1,reliability:92,condition:100,operatingCostCrPerTurn:10,variableCostPerCargoUnit:0.01,status:'operational',readyOnTurn:Number(s.factionTurn||0)},Number(s.factionTurn||0),{source:'e2e'});if(!created.ok)return {created:false,reason:created.reason};App.renderCampaignPanels(s);const row=[...document.querySelectorAll('#transport-fleets-output tbody tr')].some(r=>r.textContent.includes('E2E validation vessel')),headers=[...document.querySelectorAll('#transport-fleets-output th')].map(x=>x.textContent);SectorTransport.retireFleet(s,id);App.renderCampaignPanels(s);return {created:true,row,headers,retired:SectorTransport.getFleets(s).some(f=>f.id===id&&f.status==='retired')};})()")
    assert(fleetUiCheck.created&&fleetUiCheck.row&&fleetUiCheck.retired&&fleetUiCheck.headers.includes('Capacity')&&fleetUiCheck.headers.includes('Route assignments')&&fleetUiCheck.headers.includes('Operating cost'),'1.3.7 fleet commission, fleet table rendering, or retirement UI flow failed: '+JSON.stringify(fleetUiCheck));
    console.log('PASS: 1.3.10.2 faction/political/corporate autonomy settings, initialized ports, fleet UI lifecycle, and private corporate-decision metadata redaction.');
    const contractUiCheck=await evaluate("(()=>{const s=App.currentSector,states=s.simulation.economy.marketStates;let chosen=null;for(let i=0;i<states.length&&!chosen;i++)for(let j=i+1;j<states.length&&!chosen;j++){const a=App.currentSector.markets.find(m=>String(m.id)===String(states[i].marketId)),b=App.currentSector.markets.find(m=>String(m.id)===String(states[j].marketId));if(!a||!b||String(a.systemId)===String(b.systemId))continue;const line=(states[i].inventory||[]).find(x=>(states[j].inventory||[]).some(y=>y.commodityId===x.commodityId));if(line)chosen={a,b,commodityId:line.commodityId};}if(!chosen)return {created:false,reason:'No shared commodity across two market accounts'};const r=SectorTradeContracts.create(s,{name:'E2E recurring supply',originMarketId:chosen.a.id,destinationMarketId:chosen.b.id,commodityId:chosen.commodityId,quantityPerTurn:1,startTurn:Number(s.factionTurn||0)+1,status:'active'},Number(s.factionTurn||0));const shipments=SectorLogistics.getShipments(s),fake={id:'E2E-UI-ONLY',commodityId:chosen.commodityId,originMarketId:chosen.a.id,destinationMarketId:chosen.b.id,quantity:1,cargoUnits:SectorLogistics.getCommodityFreightUnits(s,chosen.commodityId),status:'delivered',routeIds:[],legs:[],estimatedArrivalTurn:0,saleUnitPriceCr:100,commodityPaidCr:100,freightCost:0,tollCost:0,tariffCost:0,operatingCost:0,contractId:r.ok?r.contract.id:'',delayReason:''};shipments.push(fake);App.renderCampaignPanels(s);const headers=[...document.querySelectorAll('#shipments-output th')].map(x=>x.textContent);shipments.pop();App.renderCampaignPanels(s);return {created:r.ok,reason:r.reason,rows:document.querySelectorAll('#contracts-output tbody tr').length,shipmentHeaders:headers,contractHeaders:[...document.querySelectorAll('#contracts-output th')].map(x=>x.textContent),playerHasSimulation:Object.prototype.hasOwnProperty.call(App.censorSector(s),'simulation'),valid:SectorTradeContracts.validate(s).ok,history:SectorTradeContracts.getLedger(s).length};})()");
    assert(contractUiCheck.created&&contractUiCheck.rows>=1&&contractUiCheck.shipmentHeaders.includes('Goods paid')&&contractUiCheck.shipmentHeaders.includes('Cargo units')&&contractUiCheck.shipmentHeaders.includes('Route operating cost')&&contractUiCheck.contractHeaders.includes('Lots / turn')&&contractUiCheck.valid&&contractUiCheck.history>=1&&!contractUiCheck.playerHasSimulation,'1.3.6 recurring supply contract UI/API integration or player privacy failed: '+JSON.stringify(contractUiCheck));
    console.log('PASS: 1.3.6 commodity freight profiles, route operating costs, purchase settlement, and recurring contract panels load; a contract can be created and persisted in GM state without leaking into player exports.');
    console.log('PASS: 1.3.6 financial accounts initialize and render with explicit overdraft-warning semantics; player exports exclude the simulation envelope.');
    console.log('PASS: 1.3.6 diplomacy and strategic assessment engines load in the campaign UI.');
    console.log('PASS: new sectors initialize local market accounts; campaign-turn integration is checked with the faction history regression below.');
    assert(baseline.systems>=21 && baseline.systems<=30,'Generated sector does not have the expected system count.');
    assert(baseline.svg===120 && baseline.allSvg,'The map must be a crisp SVG containing 120 editable hexes.');
    const gridBounds=await evaluate("(()=>{const b=[...document.querySelectorAll('#hexmap .hex-cell polygon')].map(p=>p.getBBox());return {count:b.length,minX:Math.min(...b.map(r=>r.x)),minY:Math.min(...b.map(r=>r.y)),maxX:Math.max(...b.map(r=>r.x+r.width)),maxY:Math.max(...b.map(r=>r.y+r.height))}})()");
    assert(gridBounds.count===120&&gridBounds.minX>=0&&gridBounds.minY>=0&&gridBounds.maxX<=641&&gridBounds.maxY<=881,'One or more hex polygons render outside the map viewBox.');
    assert(baseline.marketCards>0 && baseline.marketCards<=12 && baseline.markets>=baseline.marketCards && (await evaluate("document.querySelector('#market-browser-status')?.textContent.includes('of')")),'Searchable market directory did not render its bounded first page.');
    const linkedCheck=await evaluate("(()=>({corpRows:document.querySelectorAll('#corp-market-links-output tbody tr').length,links:App.currentSector.corporationMarketLinks.length,linkIds:App.currentSector.corporationMarketLinks.every(l=>App.currentSector.corporations.some(c=>c.id===l.corporationId)&&App.currentSector.markets.some(m=>m.id===l.marketId)),allMarketsLinked:App.currentSector.markets.every(m=>m.systemId&&m.planetId&&Array.isArray(m.routeIds)&&Array.isArray(m.linkedCorporationIds)),routesValid:App.currentSector.tradeRoutes.every(r=>App.currentSector.systems.some(s=>s.id===r.fromSystemId)&&App.currentSector.systems.some(s=>s.id===r.toSystemId)),corporationDirectoryLinked:[...document.querySelectorAll('#corporations-output tbody tr')].some(r=>/[1-9][0-9]* linked/.test(r.children[2]?.textContent||''))}))()");
    assert(linkedCheck.corpRows>0&&linkedCheck.corpRows<=15&&linkedCheck.links>=linkedCheck.corpRows&&linkedCheck.links>0&&linkedCheck.linkIds&&linkedCheck.allMarketsLinked&&linkedCheck.routesValid&&linkedCheck.corporationDirectoryLinked,'Cross-record system/world/market/corporation/route links are incomplete.');

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
    const rerolledSurvey=await evaluate("(()=>{const s=Hexmap._state.selectedSystem,table=document.querySelector('#inspector .system-survey-table'),rows=table?[...table.querySelectorAll('tbody > tr')]:[],rowText=rows.map(r=>r.textContent).join(' | ');return {hasTable:!!table,rows:rows.length,bodies:(s.bodies||[]).length,hasWorlds:(s.planets||[]).every(p=>(s.bodies||[]).some(b=>b.planetId===p.id)),keptImported:(s.bodies||[]).some(b=>b.sourceEntityId==='e2e-research')&&(s.bodies||[]).some(b=>b.sourceEntityId==='e2e-moon'),renderedImported:rowText.includes('Kepler 7')&&rowText.includes('Tsyomatsa'),wrap:table?getComputedStyle(table).tableLayout:'',overflow:table?table.scrollWidth>table.clientWidth:false}})()");
    assert(rerolledSurvey.hasTable&&rerolledSurvey.rows>=2&&rerolledSurvey.hasWorlds&&rerolledSurvey.keptImported&&rerolledSurvey.renderedImported&&rerolledSurvey.wrap==='fixed'&&!rerolledSurvey.overflow,'Rerolling the real System Survey broke linked worlds, visible custom imported entities, or fixed layout: '+JSON.stringify(rerolledSurvey));
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

    // Recalculating routes must retain GM-authored records and never reroll
    // political blocs; an overextended manual route is warned about, not deleted.
    await evaluate(`(()=>{const systems=App.currentSector.systems;let pair=null;for(let i=0;i<systems.length&&!pair;i++)for(let j=i+1;j<systems.length;j++)if(CampaignTools.hexDistance(systems[i],systems[j])>3){pair=[systems[i],systems[j]];break;}if(!pair)throw new Error('No distant system pair found for manual-route regression');App.currentSector.tradeRoutes.push({id:'E2E-MANUAL-ROUTE',fromSystemId:pair[0].id,toSystemId:pair[1].id,distance:CampaignTools.hexDistance(pair[0],pair[1]),kind:'trade',status:'MANUALLY-CLOSED',note:'KEEP THIS GM ROUTE',source:'manual',manualOverride:true,customFlag:'retain'});window.__politiesBeforeRouteRefresh=JSON.stringify(App.currentSector.polities||[]);document.querySelector('#routes-reroll').click();})()`);
    const routeRefreshCheck=await evaluate("(()=>{const route=App.currentSector.tradeRoutes.find(item=>item.id==='E2E-MANUAL-ROUTE');return {exists:!!route,status:route&&route.status,note:route&&route.note,customFlag:route&&route.customFlag,topologyStatus:route&&route.topologyStatus,politiesPreserved:window.__politiesBeforeRouteRefresh===JSON.stringify(App.currentSector.polities||[])}})()");
    assert(routeRefreshCheck.exists&&routeRefreshCheck.status==='MANUALLY-CLOSED'&&routeRefreshCheck.note==='KEEP THIS GM ROUTE'&&routeRefreshCheck.customFlag==='retain'&&routeRefreshCheck.topologyStatus==='Overextended'&&routeRefreshCheck.politiesPreserved,'Route recalculation erased GM route data or changed political blocs: '+JSON.stringify(routeRefreshCheck));
    const beforeNoOpPrices=await evaluate("JSON.stringify(App.currentSector.markets.map(m=>(m.goods||[]).map(g=>g.priceIndex)))");
    await evaluate("App.refreshSectorAfterMapEdit(App.currentSector,null)");
    const afterNoOpPrices=await evaluate("JSON.stringify(App.currentSector.markets.map(m=>(m.goods||[]).map(g=>g.priceIndex)))");
    assert(beforeNoOpPrices===afterNoOpPrices,'A no-op sector refresh changed market prices.');
    console.log('PASS: route recalculation retains manual GM routes and political blocs; repeated no-op refreshes leave market prices unchanged.');

    // Markets are paginated and commodity details are lazily built for one expanded card.
    await cmd('Emulation.setDeviceMetricsOverride',{width:1024,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('[role=tab][aria-controls]') && [...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click();const cards=[...document.querySelectorAll('#markets-output .market-card')];if(cards[0]){cards[0].open=true;App.renderMarketDetail(App.currentSector,App.currentSector.markets.find(m=>String(m.id)===String(cards[0].dataset.marketId)),cards[0]);}");
    const marketLayout=await evaluate("(()=>{const out=document.querySelector('#markets-output'),cards=[...out.querySelectorAll('.market-card')],open=cards.filter(c=>c.open),wrap=open[0]?.querySelector('.market-table-wrap');return {visible:out.getBoundingClientRect().width>0,client:out.getBoundingClientRect().right,cardCount:cards.length,marketCount:App.currentSector.markets.length,status:document.querySelector('#market-browser-status')?.textContent||'',opened:open.length,wrap:!!wrap,overflow:wrap?getComputedStyle(wrap).overflowX==='auto':false,tableMinWidth:wrap?getComputedStyle(wrap.querySelector('table')).minWidth:'',cardBounds:cards.every(c=>c.getBoundingClientRect().right<=out.getBoundingClientRect().right+2)};})()");
    assert(marketLayout.visible,'Trade & Routes panel/Markets output is not visible.');
    assert(marketLayout.cardCount<=12&&marketLayout.marketCount>=marketLayout.cardCount&&marketLayout.status.includes('of')&&marketLayout.opened===1&&marketLayout.wrap&&marketLayout.overflow&&marketLayout.cardBounds,'Market directory did not paginate or lazy-render a single contained commodity table: '+JSON.stringify(marketLayout));
    await cmd('Emulation.setDeviceMetricsOverride',{width:820,height:1200,deviceScaleFactor:1,mobile:false});
    const compactMarketLayout=await evaluate("(()=>{const out=document.querySelector('#markets-output'),cards=[...out.querySelectorAll('.market-card')],opened=cards.find(c=>c.open),r=opened?.getBoundingClientRect(),w=opened?.querySelector('.market-table-wrap');return {width:innerWidth,outRight:out.getBoundingClientRect().right,cardCount:cards.length,cardRight:r?.right||0,wrapRight:w?.getBoundingClientRect().right||0,overflow:w? w.scrollWidth>w.clientWidth:false};})()");
    assert(compactMarketLayout.cardCount<=12&&(!compactMarketLayout.cardRight||compactMarketLayout.cardRight<=compactMarketLayout.outRight+2)&&(!compactMarketLayout.wrapRight||compactMarketLayout.wrapRight<=compactMarketLayout.cardRight+1)&&compactMarketLayout.overflow,'Compact viewport produced a market/right-column overlap or escaped goods table: '+JSON.stringify(compactMarketLayout));
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('#markets-output .market-card .story-controls .campaign-action:nth-of-type(2)').click()");
    const crossNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),map:!!document.querySelector('#hexmap .system-node'),inspector:!!document.querySelector('#inspector')})");
    assert(crossNav.tab==='Sector Map'&&crossNav.map&&crossNav.inspector,'Market-to-system navigation did not open the linked system inspector.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#markets-output .market-card .story-controls .campaign-action:nth-of-type(3)').click()");
    const worldNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),highlighted:!!document.querySelector('#worlds-output .linked-highlight-row')})");
    assert(worldNav.tab==='Worlds'&&worldNav.highlighted,'Market-to-world navigation did not locate and highlight its linked world record.');
    const worldDirectoryEdit=await evaluate(`(()=>{const row=document.querySelector('#worlds-output tbody tr');if(!row)throw new Error('World Directory has no editable rows');const name=row.children[2]?.textContent.trim();const worlds=App.currentSector.systems.flatMap(system=>(system.planets||[]).map(planet=>({system,planet})));const target=worlds.find(entry=>entry.planet.name===name);if(!target)throw new Error('Could not resolve visible World Directory row to a planet');const other=worlds.find(entry=>entry.planet.id!==target.planet.id);if(!other)throw new Error('Need a second world to verify unrelated descriptions');other.planet.description='UNRELATED_WORLD_DESCRIPTION_SENTINEL';row.querySelector('.edit-cell .textbutton').click();const modal=document.querySelector('.dynmodal-container .dynedit');const field=[...modal.querySelectorAll('tr')].find(item=>item.cells[0]?.textContent.trim()==='techLevel:');if(!field?.querySelector('select'))throw new Error('World Directory tech level selector missing');const selector=field.querySelector('select'),option=[...selector.options].find(item=>item.value!==target.planet.techLevel&&!item.hasAttribute('data-preserved-existing-value'));if(!option)throw new Error('No alternate supported Tech Level option available');selector.value=option.value;const expectedTech=option.value;modal.querySelectorAll('.dynedit-toolbar-button')[2].click();const market=App.currentSector.markets.find(item=>item.planetId===target.planet.id);return {name:target.planet.name,tech:target.planet.techLevel,expectedTech,marketTech:market&&market.techLevel,overrides:target.planet.fieldOverrides,otherDescription:other.planet.description,otherId:other.planet.id}})()`);
    assert(worldDirectoryEdit.tech===worldDirectoryEdit.expectedTech&&worldDirectoryEdit.marketTech===worldDirectoryEdit.expectedTech&&worldDirectoryEdit.overrides?.techLevel===true&&worldDirectoryEdit.otherDescription==='UNRELATED_WORLD_DESCRIPTION_SENTINEL','World Directory save failed to synchronize only the edited world and market, or did not retain the manual field lock: '+JSON.stringify(worldDirectoryEdit));
    console.log('PASS: World Directory edit updates its linked market, records the field-level GM override, and preserves unrelated world descriptions.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#corp-market-links-output tbody tr .campaign-row-actions .campaign-action:nth-of-type(2)').click()");
    const marketNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),open:[...document.querySelectorAll('#markets-output .market-card')].some(c=>c.open&&c.classList.contains('linked-highlight-card'))})");
    assert(marketNav.tab==='Trade & Routes'&&marketNav.open,'Corporate contract did not navigate back to its linked market.');
    await evaluate("document.querySelector('#corp-market-links-output tbody tr .campaign-row-actions .campaign-action:nth-of-type(4)').click()");
    const corpNav=await evaluate("({tab:document.querySelector('#viewer-tabs .dyntab-header [aria-selected=true]')?.textContent.trim(),highlighted:!!document.querySelector('#corporations-output .linked-highlight-row')})");
    assert(corpNav.tab==='Corporations'&&corpNav.highlighted,'Corporate market link did not locate its linked corporation record.');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.trim()==='Trade & Routes').click()");
    await evaluate("document.querySelector('#markets-reroll').click()");
    const reroll=await evaluate("(()=>({visible:document.querySelector('#markets-output').getBoundingClientRect().width>0,cards:document.querySelectorAll('#markets-output .market-card').length,markets:App.currentSector.markets.length,status:document.querySelector('#market-browser-status')?.textContent||''}))()");
    assert(reroll.visible&&reroll.cards>0&&reroll.cards<=12&&reroll.markets>=reroll.cards&&reroll.status.includes('of'),'Rerolling markets broke the paginated Trade & Routes directory: '+JSON.stringify(reroll));
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
    const relationId=await evaluate("App.currentSector.diplomacy[0].id");
    await evaluate("document.querySelector('#diplomacy-output .campaign-action').click()");
    const directDiplomacyEdit=await evaluate(`(()=>{const modal=document.querySelector('.dynmodal-container .dynedit');if(!modal)throw new Error('Direct diplomacy editor did not open');const field=name=>[...modal.querySelectorAll('tr')].find(row=>row.cells[0]?.textContent.trim()===name+':');const state=field('state')?.querySelector('select'),trust=field('trust')?.querySelector('input'),tension=field('tension')?.querySelector('input');if(!state||!trust||!tension)throw new Error('Direct diplomacy editor is missing state/trust/tension controls');state.value='Alliance';trust.value='6';tension.value='0';modal.querySelectorAll('.dynedit-toolbar-button')[2].click();const rel=App.currentSector.diplomacy.find(item=>item.id===${JSON.stringify(relationId)});const a=App.currentSector.factions.find(f=>f.id===rel.factionAId),b=App.currentSector.factions.find(f=>f.id===rel.factionBId);return {state:rel.state,trust:rel.trust,tension:rel.tension,lastEvent:rel.lastEvent,aRival:!!a?.rivals?.includes(b.id),bRival:!!b?.rivals?.includes(a.id)}})()`);
    assert(directDiplomacyEdit.state==='Alliance'&&directDiplomacyEdit.trust===6&&directDiplomacyEdit.tension===0&&!directDiplomacyEdit.aRival&&!directDiplomacyEdit.bRival,'Direct diplomacy editor did not save the exact referee-selected values and synchronize rival lists: '+JSON.stringify(directDiplomacyEdit));
    await evaluate("document.querySelector('#diplomacy-output .diplomacy-shift-action').click()");
    const stateAfterDiplomacy=await evaluate("App.currentSector.diplomacy.find(r=>r.id==="+JSON.stringify(relationId)+").state");
    assert(stateAfterDiplomacy==='Trade pact','The quick Change posture action should remain available beside direct editing.');
    const stateBeforeTurn=await evaluate("App.currentSector.diplomacy.map(r=>r.state).join('|')");
    const economyBeforeTurn=await evaluate("({turn:App.currentSector.simulation.economy.clock.lastAdvancedTurn,ledgers:App.currentSector.simulation.economy.ledger.length})");
    const turnBusyState=await evaluate(`(()=>{const button=document.querySelector('#faction-turn-button');const original=window.setTimeout;let queued=null;window.setTimeout=(fn,delay)=>{if(delay===0){queued=fn;return 1;}return original(fn,delay);};try{button.click();const visible={disabled:button.disabled,busy:button.getAttribute('aria-busy')==='true',label:button.textContent.trim()};if(!queued)throw new Error('Campaign turn callback was not scheduled');if(!visible.disabled||!visible.busy||!visible.label.includes('Processing'))throw new Error('Campaign turn did not expose its busy state before processing: '+JSON.stringify(visible));queued();return visible;}finally{window.setTimeout=original;}})()`);
    assert(turnBusyState.disabled&&turnBusyState.busy&&turnBusyState.label.includes('Processing'),'Campaign turn button failed its immediate busy-state check: '+JSON.stringify(turnBusyState));
    console.log('PASS: campaign-turn control exposes an accessible busy/disabled state before synchronous resolution starts.');
    const simAfter=await evaluate("({turn:App.currentSector.factionTurn,marketTurn:App.currentSector.markets[0].lastUpdatedTurn,hasInfluence:App.currentSector.systems.some(s=>Array.isArray(s.factionInfluence)),hasMarketPrices:App.currentSector.markets.every(m=>m.goods.every(g=>Number.isFinite(g.localPrice)&&g.localPrice>0)),territoryRows:document.querySelectorAll('#influence-output tbody tr').length,economyTurn:App.currentSector.simulation.economy.clock.lastAdvancedTurn,economyLedgers:App.currentSector.simulation.economy.ledger.length,settlementTurn:App.currentSector.simulation.economy.settlement?.clock?.lastSettledTurn,diplomacyTurn:App.currentSector.simulation.diplomacy?.clock?.lastProcessedTurn,strategyTurn:App.currentSector.simulation.strategy?.clock?.lastProcessedTurn,strategicRows:document.querySelectorAll('#strategic-output tbody tr').length,factionCount:App.currentSector.factions.length,financeRows:document.querySelectorAll('#finance-output tbody tr').length,economyStatus:document.querySelector('#faction-turn-status')?.textContent,coordinatorTurn:App.currentSector.simulation.turnCoordinator?.lastCommittedTurn,coordinatorJournal:App.currentSector.simulation.turnCoordinator?.journal?.length})");
    assert(simAfter.turn===simBefore.turn+1,'Faction turn did not increment.');
    assert(simAfter.marketTurn===simAfter.turn&&simAfter.hasInfluence&&simAfter.hasMarketPrices,'Faction turn failed to recalculate influence and markets.');
    assert(simAfter.territoryRows>0,'Territorial influence table did not render.');
    assert(simAfter.economyTurn===simAfter.turn&&simAfter.economyLedgers>economyBeforeTurn.ledgers&&simAfter.economyStatus.includes('committed')&&simAfter.economyStatus.includes('markets'),'Campaign turn did not advance local economic accounts exactly once: '+JSON.stringify({before:economyBeforeTurn,after:simAfter}));
    assert(simAfter.coordinatorTurn===simAfter.turn&&simAfter.coordinatorJournal===1&&simAfter.settlementTurn===simAfter.turn&&simAfter.diplomacyTurn===simAfter.turn&&simAfter.strategyTurn===simAfter.turn&&simAfter.financeRows>0&&simAfter.strategicRows>=simAfter.factionCount,'Campaign turn failed to run 1.3.5 settlement, diplomacy, and strategic intelligence exactly once: '+JSON.stringify(simAfter));
    console.log('PASS: campaign turns settle finance, advance automatic diplomacy and strategic assessments, and render the resulting reports.');
    const turnHistoryBeforeNote=await evaluate("({count:App.currentSector.factionTurnHistory.length,turn:App.currentSector.factionTurnHistory[0]?.turn,events:App.currentSector.factionTurnHistory[0]?.events.length,card:!!document.querySelector('#faction-turn-history .story-card')})");
    assert(turnHistoryBeforeNote.count===1&&turnHistoryBeforeNote.turn===simAfter.turn&&turnHistoryBeforeNote.events>0&&turnHistoryBeforeNote.card,'Faction turn advancement did not create a visible persistent turn-log entry: '+JSON.stringify(turnHistoryBeforeNote));
    const turnNoteResult=await evaluate(`(()=>{const card=document.querySelector('#faction-turn-history .story-card');card.querySelector('button').click();const note=card.querySelector('textarea');if(!note)throw new Error('Turn-note editor did not open');note.value='GM NOTE: preserve the border agreement and review the new corridor.';[...card.querySelectorAll('button')].find(button=>button.textContent.trim()==='Save notes').click();const record=App.currentSector.factionTurnHistory.find(item=>item.turn===App.currentSector.factionTurn);const gmJson=JSON.stringify(App.currentSector),playerJson=JSON.stringify(App.censorSector(App.currentSector));return {note:record?.gmNotes,visible:document.querySelector('#faction-turn-history').textContent.includes('GM NOTE: preserve the border agreement'),gmArchiveContains:gmJson.includes('GM NOTE: preserve the border agreement'),playerArchiveExcludes:!playerJson.includes('GM NOTE: preserve the border agreement'),simulationClock:App.currentSector.simulation?.clock?.turn,legacyClock:App.currentSector.factionTurn};})()`);
    assert(turnNoteResult.note==='GM NOTE: preserve the border agreement and review the new corridor.'&&turnNoteResult.visible&&turnNoteResult.gmArchiveContains&&turnNoteResult.playerArchiveExcludes,'Campaign turn log did not save/render referee notes with correct GM/player export handling: '+JSON.stringify(turnNoteResult));
    assert(turnNoteResult.simulationClock===turnNoteResult.legacyClock,'The 1.3 simulation clock did not track a legacy faction-turn advance.');
    const repeatedTurnStress=await evaluate(`(()=>{const s=App.currentSector,timings=[],states=[];document.querySelector('#market-search').value='';App.marketDirectoryState.page=0;for(let i=0;i<4;i++){const started=performance.now(),tx=SectorSimulation.advanceCampaignTurn(s);if(!tx||!tx.ok)throw new Error('Repeated campaign turn '+(i+1)+' did not commit');App.renderCampaignPanels(s);timings.push(+(performance.now()-started).toFixed(1));const state={markets:document.querySelectorAll('#markets-output .market-card').length,marketTables:document.querySelectorAll('#markets-output .market-card table').length,openMarkets:document.querySelectorAll('#markets-output .market-card[open]').length,history:document.querySelectorAll('#faction-turn-history .faction-turn-log-card').length,chronicle:document.querySelectorAll('#chronicle-output .chronicle-event-card').length,openHistoryDetails:document.querySelectorAll('#faction-turn-history details[open]').length,openChronicleDetails:document.querySelectorAll('#chronicle-output details[open]').length};states.push(state);}return {turns:4,committedTurn:s.factionTurn,timingsMs:timings,maxRenderAndTurnMs:Math.max(...timings),final:states[states.length-1],maxima:{markets:Math.max(...states.map(x=>x.markets)),marketTables:Math.max(...states.map(x=>x.marketTables)),history:Math.max(...states.map(x=>x.history)),chronicle:Math.max(...states.map(x=>x.chronicle))},stable:states.every(x=>x.markets<=12&&x.marketTables<=1&&x.openMarkets<=1&&x.history<=6&&x.chronicle<=20&&x.openHistoryDetails===0&&x.openChronicleDetails===0)};})()`);
    assert(repeatedTurnStress.stable&&repeatedTurnStress.turns===4,'Campaign-turn output grew without bounds across repeated turns: '+JSON.stringify(repeatedTurnStress));
    console.log('PASS: four consecutive campaign turns keep market, faction-history, and Chronicle DOM bounded; detail panels remain collapsed. '+JSON.stringify(repeatedTurnStress));
    const outputStress = await evaluate(`(async()=>{
      const s=App.currentSector,originalMarkets=s.markets,base=originalMarkets[0];
      const synthetic=Object.assign({},s,{markets:Array.from({length:144},(_,i)=>{const goods=JSON.parse(JSON.stringify(base.goods||[]));if(i===89&&goods[0])goods[0].name='E2E_UNIQUE_COMMODITY_NEEDLE';return Object.assign({},base,{id:'E2E-MARKET-'+i,planetName:'Stress World '+i,systemName:'Stress System '+(i%18),goods});})});
      App.marketDirectoryState.page=0;document.querySelector('#market-search').value='';App.renderMarketDirectory(synthetic);
      const firstPage=document.querySelectorAll('#markets-output .market-card').length,initialTables=document.querySelectorAll('#markets-output .market-card table').length;
      const first=document.querySelector('#markets-output .market-card'),firstMarket=synthetic.markets.find(m=>m.id===first.dataset.marketId);first.open=true;App.renderMarketDetail(synthetic,firstMarket,first);
      const openedTables=document.querySelectorAll('#markets-output .market-card table').length,openedRows=first.querySelectorAll('tbody tr').length;
      first.open=false;first.dispatchEvent(new Event('toggle'));
      const closedTables=document.querySelectorAll('#markets-output .market-card table').length;
      document.querySelector('#market-search').value='E2E_UNIQUE_COMMODITY_NEEDLE';App.renderMarketDirectory(synthetic);
      const searchMatches=document.querySelectorAll('#markets-output .market-card').length,searchWorld=document.querySelector('#markets-output .market-card summary')?.textContent||'';
      document.querySelector('#market-search').value='';App.renderMarketDirectory(s);
      return {firstPage,initialTables,openedTables,openedRows,closedTables,searchMatches,searchWorld,sourceMarkets:originalMarkets.length};
    })()`);
    assert(outputStress.firstPage===12&&outputStress.initialTables===0&&outputStress.openedTables===1&&outputStress.openedRows>0&&outputStress.closedTables===0&&outputStress.searchMatches===1&&outputStress.searchWorld.includes('Stress World 89'),'Market directory failed pagination, lazy detail lifecycle, close-time DOM release, or commodity search: '+JSON.stringify(outputStress));
    console.log('PASS: market directory bounds the visible cards, lazily builds one commodity table, releases its DOM on collapse, and searches hidden commodity metadata.');
    const tableBrowserCheck=await evaluate(`(()=>{const host=document.createElement('div');host.id='e2e-generic-table-browser';document.body.appendChild(host);const rows=Array.from({length:150},(_,i)=>({item:{id:'ROW-'+i},values:['Record '+i,i===137?'E2E_SEARCH_NEEDLE':'ordinary value '+i,'Long description '+i]}));App.renderSimpleTable(host,['Record','Value','Description'],rows,null);const initial=host.querySelectorAll('tbody tr').length,search=host.querySelector('.data-table-toolbar input'),hasStatus=!!host.querySelector('.data-table-toolbar [role=status]');search.value='E2E_SEARCH_NEEDLE';search.dispatchEvent(new Event('input',{bubbles:true}));const matchRows=host.querySelectorAll('tbody tr').length,matchText=host.querySelector('tbody')?.textContent||'',matchStatus=host.querySelector('.data-table-toolbar [role=status]')?.textContent||'';const current=host.querySelector('.data-table-toolbar input');current.value='';current.dispatchEvent(new Event('input',{bubbles:true}));host.querySelector('.data-table-toolbar button:last-child').click();const nextRows=host.querySelectorAll('tbody tr').length,nextFirst=host.querySelector('tbody tr')?.textContent||'',nextStatus=host.querySelector('.data-table-toolbar [role=status]')?.textContent||'';host.remove();return {initial,matchRows,matchText,matchStatus,nextRows,nextFirst,nextStatus,hasStatus};})()`);
    assert(tableBrowserCheck.initial===15&&tableBrowserCheck.matchRows===1&&tableBrowserCheck.matchText.includes('E2E_SEARCH_NEEDLE')&&tableBrowserCheck.matchStatus.includes('1 matches')&&tableBrowserCheck.nextRows===15&&tableBrowserCheck.nextFirst.includes('Record 15')&&tableBrowserCheck.nextStatus.includes('16–30')&&tableBrowserCheck.hasStatus,'Large-table search or pagination failed: '+JSON.stringify(tableBrowserCheck));
    console.log('PASS: large campaign data tables render 15 rows per page with searchable records and bounded horizontal layout. '+JSON.stringify(tableBrowserCheck));

    const factionHistoryStress=await evaluate(`(()=>{const s=App.currentSector,old=s.factionTurnHistory,oldArchive=s.factionTurnHistoryArchive,search=document.querySelector('#faction-history-search'),container=document.querySelector('#faction-turn-history');s.factionTurnHistory=Array.from({length:90},(_,i)=>({id:'E2E-HISTORY-'+i,turn:i+1,gmNotes:'Stress note '+i,events:[{factionName:'Test Faction '+i,action:'Test action',result:'Success',event:i===72?'E2E_HISTORY_NEEDLE_EVENT':'Routine event '+i}]}));s.factionTurnHistoryArchive={archivedCount:90,records:[]};search.value='';container.dataset.page='0';App.renderFactionTurnHistory(s);const firstCards=container.querySelectorAll('.story-card').length,expanded=[...container.querySelectorAll('.faction-turn-events-details')].filter(d=>d.open).length;search.value='E2E_HISTORY_NEEDLE_EVENT';container.dataset.page='0';App.renderFactionTurnHistory(s);const searchCards=container.querySelectorAll('.story-card').length,searchText=container.textContent.includes('E2E_HISTORY_NEEDLE_EVENT');s.factionTurnHistory=old;s.factionTurnHistoryArchive=oldArchive;search.value='';container.dataset.page='0';App.renderFactionTurnHistory(s);return {firstCards,expanded,searchCards,searchText,restored: s.factionTurnHistory===old};})()`);
    assert(factionHistoryStress.firstCards===6&&factionHistoryStress.expanded===0&&factionHistoryStress.searchCards===1&&factionHistoryStress.searchText&&factionHistoryStress.restored,'Faction turn archive did not paginate/collapse/search safely: '+JSON.stringify(factionHistoryStress));
    console.log('PASS: campaign turn history shows six compact turns at a time, keeps events collapsed, and finds old entries by searchable event text.');

    const chronicleStress=await evaluate(`(()=>{const s=App.currentSector,old=s.simulation.chronicle,output=document.querySelector('#chronicle-output'),search=document.querySelector('#chronicle-search'),filter=document.querySelector('#chronicle-filter');s.simulation.chronicle={events:Array.from({length:260},(_,i)=>({id:'E2E-CHR-'+i,sequence:i+1,turn:i+1,category:'economic',type:'market-test',summary:i===211?'Needle Chronicle Result':'Routine market event '+i,effects:[{amount:12,reason:'Supply adjustment',detail:'Structured result'},i===211?JSON.stringify({amount:7,reason:'String-encoded JSON effect',recipient:'E2E recipient'}):'Routine effect']})),archive:{archivedCount:0,records:[]}};output.dataset.visibleLimit='20';search.value='';filter.value='all';App.renderChronicle(s);const firstCards=output.querySelectorAll('.chronicle-event-card').length,expanded=[...output.querySelectorAll('.chronicle-event-details')].filter(d=>d.open).length,rawJson=output.textContent.includes('{"amount"')||output.textContent.includes('{\"amount\"');output.querySelector('.archive-load-more')?.click();const moreCards=output.querySelectorAll('.chronicle-event-card').length;search.value='Needle Chronicle Result';output.dataset.visibleLimit='20';App.renderChronicle(s);const searchCards=output.querySelectorAll('.chronicle-event-card').length,searchText=output.textContent.includes('Needle Chronicle Result'),parsedJson=output.textContent.includes('Amount: 7')||output.textContent.includes('Amount:7');s.simulation.chronicle=old;search.value='';filter.value='all';output.dataset.visibleLimit='20';App.renderChronicle(s);return {firstCards,expanded,rawJson,moreCards,searchCards,searchText,parsedJson,restored:s.simulation.chronicle===old};})()`);
    assert(chronicleStress.firstCards===20&&chronicleStress.expanded===0&&!chronicleStress.rawJson&&chronicleStress.moreCards===40&&chronicleStress.searchCards===1&&chronicleStress.searchText&&chronicleStress.restored,'Chronicle did not page/collapse/search or render structured details without raw JSON: '+JSON.stringify(chronicleStress));
    console.log('PASS: Chronicle shows 20 compact events, loads older entries on demand, searches archived details, and formats object and JSON-string payloads as readable text.');
    console.log('PASS: asset deployment/readiness, territorial override, exact diplomacy editing plus quick posture cycling, alliance-safe faction turns, persistent turn history and GM notes, influence, and market repricing.');

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
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add survey object');if(!e)throw new Error('Add survey object control missing');e.click();const modal=document.querySelector('.dynmodal-container .dynedit'),toolbar=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.includes('Randomize All'));if(!toolbar||toolbar.hidden||!modal.querySelectorAll('.dynedit-randomize:not(.dynedit-revert)').length)throw new Error('Survey-object editor randomizers are missing');toolbar.click();if(!/^Randomized [1-9]/.test(modal.querySelector('.dynedit-status')?.textContent||''))throw new Error('Survey-object Randomize All did not work');const typeRow=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='type:'),nameRow=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='name:');if(!typeRow||!nameRow)throw new Error('Survey object type/name fields missing');typeRow.querySelector('select').value='Mining platform';nameRow.querySelector('textarea,input').value='Morrow Mine';[...modal.querySelectorAll('.dynedit-toolbar-button')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    const customBody = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+");return {exists:!!s,bodies:s&&(s.bodies||[]).map(b=>({type:b.type,name:b.name,bodyClass:b.bodyClass,isGeneratedWorld:b.isGeneratedWorld,worldName:b.worldName,planetId:b.planetId})),survey:!!document.querySelector('#inspector .system-survey-table'),modalCount:document.querySelectorAll('.dynmodal-container').length,modalText:[...document.querySelectorAll('.dynmodal-container')].map(m=>m.innerText.slice(0,240)),modalStack:DynModal._stack.length,inspector:document.querySelector('#inspector').innerText.slice(0,400)}})()");
    assert(customBody.exists&&customBody.bodies.some(b=>b.type==='Mining platform'&&b.name==='Morrow Mine'&&b.bodyClass==='N')&&customBody.survey,'Custom mining platform did not persist in the system survey: '+JSON.stringify(customBody));
    await evaluate("document.querySelector('#inspector .system-survey-heading [aria-label=\"Reroll system survey\"]').click()");
    const customBodyAfterReroll=await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+");const body=(s.bodies||[]).find(b=>b.name==='Morrow Mine');return {exists:!!body,source:body&&body.source,manualOverride:body&&body.manualOverride}})()");
    assert(customBodyAfterReroll.exists&&customBodyAfterReroll.source==='manual'&&customBodyAfterReroll.manualOverride,'Rerolling a survey deleted or downgraded the manually created mining platform: '+JSON.stringify(customBodyAfterReroll));
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add point of interest');if(!e)throw new Error('Add point of interest control missing');e.click();const modal=document.querySelector('.dynmodal-container .dynedit'),toolbar=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.includes('Randomize All'));if(!toolbar||toolbar.hidden||!modal.querySelectorAll('.dynedit-randomize:not(.dynedit-revert)').length)throw new Error('POI editor randomizers are missing');toolbar.click();if(!/^Randomized [1-9]/.test(modal.querySelector('.dynedit-status')?.textContent||''))throw new Error('POI Randomize All did not work');const nameRow=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='name:'),typeRow=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='type:');if(!nameRow||!typeRow)throw new Error('POI name/type fields missing');nameRow.querySelector('textarea,input').value='Old Observatory';typeRow.querySelector('select').value='Ancient ruins';[...modal.querySelectorAll('.dynedit-toolbar-button')].find(e=>e.textContent.trim()==='(Save)').click()})()");
    const customPoi = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+");return !!s&&s.pointsOfInterest.some(p=>p.name==='Old Observatory'&&p.type==='Ancient ruins')&&!!document.querySelector('#inspector .inspector-poi-table')})()");
    assert(customPoi,'Custom ancient-ruins point of interest did not persist.');
    await evaluate("(()=>{const e=[...document.querySelectorAll('#inspector .edit-zone .textbutton')].find(e=>e.textContent.trim()==='add planet');if(!e)throw new Error('Add planet control missing');e.click();const save=[...document.querySelectorAll('.dynmodal-container .dynedit .textbutton')].find(e=>e.textContent.trim()==='(Save)');if(!save)throw new Error('Planet editor save control missing');save.click()})()");
    const createdWorld = await evaluate("(()=>{const s=App.currentSector.systems.find(s=>s.id==="+JSON.stringify(createdSystem.id)+"),p=s&&s.planets[0],m=p&&(App.currentSector.markets||[]).find(m=>m.planetId===p.id),b=p&&(s.bodies||[]).find(b=>b.planetId===p.id),account=m&&SectorEconomy.getMarketState(App.currentSector,m.id);return {worlds:s&&s.planets.length,worldId:p&&p.id,market:!!m,surveyLink:!!b,economyAccount:!!account,worldDirectory:!![...document.querySelectorAll('#worlds-output tbody tr')].find(r=>r.textContent.includes(p&&p.name||'__none__')),validRoutes:App.currentSector.tradeRoutes.every(r=>App.currentSector.systems.some(s=>s.id===r.fromSystemId)&&App.currentSector.systems.some(s=>s.id===r.toSystemId))}})()");
    assert(createdWorld.worlds===1&&createdWorld.worldId&&createdWorld.market&&createdWorld.surveyLink&&createdWorld.economyAccount&&createdWorld.worldDirectory&&createdWorld.validRoutes,'Added planet did not create a linked world, market, economy account, survey record, or valid route graph: '+JSON.stringify(createdWorld));
    const rerollContinuity = await evaluate("(()=>{const before=App.currentSector.factionTurn;document.querySelector('#factions-reroll').click();return {before,after:App.currentSector.factionTurn,economyTurn:App.currentSector.simulation.economy.clock.lastAdvancedTurn}})()");
    assert(rerollContinuity.after===rerollContinuity.before&&rerollContinuity.economyTurn===rerollContinuity.before,'Regenerating factions rewound or desynchronized the local economy campaign clock: '+JSON.stringify(rerollContinuity));
    console.log('PASS: adding a world initializes its market account without resetting existing accounts; faction rerolls preserve the campaign/economy clock. '+JSON.stringify(rerollContinuity));

    // Regression for Captain_Hoyt's imported-world data-loss report: changing a
    // single field must not blank SWN vocabulary values or mutate source details.
    const planetEditRegression=await evaluate("(()=>{const system=App.currentSector.systems[0];const planet={id:'REGRESSION-SWN-WORLD',systemId:system.id,name:'Imported Test World',atmosphere:'Breathable mix',temperature:'Temperate',biosphere:'Immiscible',gravity:'',population:'Hundreds of millions of inhabitants',techLevel:'TL4+',tag1:'Pretech Archive',tag2:'Urbanized Surface',tagCandidate3:'',terrain:'Terran',description:'Original imported description',sourceEntityType:'planet',sourceAttributes:{atmosphere:'Breathable mix',temperature:'Temperate',biosphere:'Immiscible',population:'Hundreds of millions of inhabitants',techLevel:'TL4+',description:'Original imported description'}};system.planets.push(planet);DynEdit.edit('Regression: imported planet',planet,WorldGenerator.planetTemplate,function(saved){if(saved){if(!planet.sourceEntityType)planet.description=WorldGenerator.describePlanet(planet);App.ensureMarketForPlanet(App.currentSector,system,planet);App.refreshSectorAfterMapEdit(App.currentSector,system);}});const modal=document.querySelector('.dynmodal-container .dynedit');const tech=[...modal.querySelectorAll('tr')].find(r=>r.cells[0]?.textContent.trim()==='techLevel:');const immutableFields=['sourceEntityType','sourceIsHidden'];const immutableEditorFields=[...modal.querySelectorAll('tr')].map(r=>r.cells[0]?.textContent.trim().replace(/:$/,''));tech.querySelector('select').value='4-';[...modal.querySelectorAll('.textbutton')].find(e=>e.textContent.trim()==='(Save)').click();return {atmosphere:planet.atmosphere,temperature:planet.temperature,biosphere:planet.biosphere,gravity:planet.gravity,population:planet.population,techLevel:planet.techLevel,description:planet.description,sourceAtmosphere:planet.sourceAttributes.atmosphere,sourceFieldsHidden:immutableFields.every(key=>!immutableEditorFields.includes(key)),selectedOptions:tech.querySelector('select')?.options?.length||0};})()");
    assert(planetEditRegression.atmosphere==='Breathable mix'&&planetEditRegression.temperature==='Temperate'&&planetEditRegression.biosphere==='Immiscible'&&planetEditRegression.gravity===''&&planetEditRegression.population==='Hundreds of millions of inhabitants'&&planetEditRegression.techLevel==='4-'&&planetEditRegression.description==='Original imported description'&&planetEditRegression.sourceAtmosphere==='Breathable mix'&&planetEditRegression.sourceFieldsHidden,'Editing one imported planet field overwrote unchanged SWN fields: '+JSON.stringify(planetEditRegression));
    console.log('PASS: imported planet one-field edit preserves all unchanged SWN values and its source description.');
    const expandedPopulationReroll=await evaluate(`(()=>{
      const originalPicker=WorldGenerator.pickRandom2d6;
      const originalRoller=WorldGenerator.rollExpandedPopulation;
      const read=(modal,key)=>{const row=[...modal.querySelectorAll('tr')].find(item=>item.cells[0]?.textContent.trim()===key+':');return row&&(row.querySelector('input,textarea,select')?.value||'');};
      const makePlanet=(id)=>({id,name:'Expanded Metadata Test',generationMode:'expanded',population:'outpost',populationEstimate:'OLD ESTIMATE SENTINEL',populationNumber:700,expandedPopulationType:'Outpost',techLevel:'4',gravity:'standard',tag1:'Pretech Archive',tag2:'Urbanized Surface',tagCandidate3:'Alien Ruins',atmosphere:'Breathable mix',temperature:'Temperate',biosphere:'Immiscible',terrain:'Terran',description:'Metadata regression'});
      const runCase=(id,population,expanded,revertBeforeSave)=>{
        const planet=makePlanet(id);
        DynEdit.edit('Regression: expanded population reroll',planet,App.getPlanetEditTemplate(planet),function(){});
        const modal=document.querySelector('.dynmodal-container .dynedit');
        if(!modal)throw new Error('Expanded population editor did not open');
        const populationRow=()=>[...modal.querySelectorAll('tr')].find(item=>item.cells[0]?.textContent.trim()==='population:');
        try {
          WorldGenerator.pickRandom2d6=()=>({name:population});
          WorldGenerator.rollExpandedPopulation=()=>JSON.parse(JSON.stringify(expanded));
          const randomize=populationRow()?.querySelector('.dynedit-randomize:not(.dynedit-revert)');
          if(!randomize)throw new Error('Expanded population randomizer is missing');
          randomize.click();
          const generated={population:read(modal,'population'),estimate:read(modal,'populationEstimate'),techLevel:read(modal,'techLevel'),gravity:read(modal,'gravity')};
          if(generated.population!==population||generated.estimate!==expanded.estimate||!generated.techLevel||!generated.gravity)throw new Error('Expanded population reroll left visible dependent fields stale: '+JSON.stringify(generated));
          let reverted=null;
          if(revertBeforeSave){
            const revert=populationRow()?.querySelector('.dynedit-revert');
            if(!revert)throw new Error('Expanded population Revert control is missing');
            revert.click();
            // Revert rebuilds editor rows; always reacquire controls rather than clicking stale DOM nodes.
            reverted={population:read(modal,'population'),estimate:read(modal,'populationEstimate'),techLevel:read(modal,'techLevel'),gravity:read(modal,'gravity')};
          }
          const save=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(button=>button.textContent.trim()==='(Save)');
          if(!save)throw new Error('Expanded population Save control is missing');
          save.click();
          return {generated,reverted,planet:{population:planet.population,populationEstimate:planet.populationEstimate,populationNumber:planet.populationNumber,expandedPopulationType:planet.expandedPopulationType,techLevel:planet.techLevel,gravity:planet.gravity}};
        } finally {
          WorldGenerator.pickRandom2d6=originalPicker;
          WorldGenerator.rollExpandedPopulation=originalRoller;
          if(document.querySelector('.dynedit')){
            const cancelButton=[...document.querySelectorAll('.dynedit-toolbar-button')].find(button=>button.textContent.trim()==='(Cancel)');
            if(cancelButton)cancelButton.click();
          }
        }
      };
      const remnant=runCase('E2E-REMNANT-REROLL','failed colony',{type:'Remnant',populationNumber:null,estimate:'Scattered survivors; exact population unknown'},false);
      const counted=runCase('E2E-COUNTED-REROLL','several million inhabitants',{type:'Millions to Billions',populationNumber:5000000,estimate:'5,000,000 inhabitants'},false);
      const revert=runCase('E2E-REVERT-REROLL','failed colony',{type:'Remnant',populationNumber:null,estimate:'Scattered survivors; exact population unknown'},true);
      const remnantValid=remnant.generated.estimate.includes('exact population unknown')&&remnant.planet.populationNumber===null&&remnant.planet.expandedPopulationType==='Remnant';
      const countedValid=counted.generated.estimate==='5,000,000 inhabitants'&&counted.planet.populationNumber===5000000&&counted.planet.expandedPopulationType==='Millions to Billions';
      const revertValid=revert.reverted&&revert.reverted.population==='outpost'&&revert.reverted.estimate==='OLD ESTIMATE SENTINEL'&&revert.planet.population==='outpost'&&revert.planet.populationNumber===700&&revert.planet.expandedPopulationType==='Outpost'&&revert.planet.populationEstimate==='OLD ESTIMATE SENTINEL';
      if(!remnantValid||!countedValid||!revertValid)throw new Error('Expanded population Remnant, counted, or Revert metadata contract failed: '+JSON.stringify({remnant,counted,revert,remnantValid,countedValid,revertValid}));
      return {remnant,counted,revert,remnantValid,countedValid,revertValid};
    })()`);
    assert(expandedPopulationReroll.remnantValid&&expandedPopulationReroll.countedValid&&expandedPopulationReroll.revertValid,'Expanded population reroll did not preserve both valid population classes and dependent metadata: '+JSON.stringify(expandedPopulationReroll));
    console.log('PASS: Expanded population rerolls preserve valid Remnant and counted outcomes, synchronize derived metadata, and Revert restores the original record.');

    // Black holes imported from SWN must have a distinct map symbol and inspector label.
    const blackHoleCheck=await evaluate("(()=>{const used=new Set(App.currentSector.systems.map(s=>s.x+','+s.y));let x=0,y=0;outer:for(x=0;x<10;x++)for(y=0;y<12;y++)if(!used.has(x+','+y))break outer;const bh={id:'REGRESSION-BLACK-HOLE',name:'NG03-7',x:x,y:y,planets:[],bodies:[],pointsOfInterest:[],sourceEntityType:'blackHole'};App.currentSector.systems.push(bh);App.syncSystemBodies(bh);App.displayHexmap(App.currentSector,bh);const node=[...document.querySelectorAll('#hexmap .system-node-black-hole')].find(n=>n.getAttribute('data-system-id')==='REGRESSION-BLACK-HOLE');return {node:!!node,disk:!!node?.querySelector('.black-hole-disk'),primary:bh.bodies?.[0]?.type||'',hasNormalStar:(bh.bodies||[]).some(b=>b.bodyClass==='S'),label:document.querySelector('#inspector .inspector-system-name')?.textContent||'',aria:node?.getAttribute('aria-label')||''};})()");
    assert(blackHoleCheck.node&&blackHoleCheck.disk&&blackHoleCheck.primary==='Black hole'&&!blackHoleCheck.hasNormalStar&&blackHoleCheck.label.includes('Black Hole')&&blackHoleCheck.aria.includes('black hole'),'Black hole was rendered or labeled like an ordinary star system: '+JSON.stringify(blackHoleCheck));
    console.log('PASS: black-hole systems have a distinct map marker and inspector/accessibility label.');
    console.log('PASS: map editor safe visibility, empty-hex system creation, custom orbital object/site creation, and planet/market/survey linkage.');

    // Save/export data and verify browser-level errors were absent.
    const privacy=await evaluate("(()=>{const p=App.censorSector(App.currentSector);return {hasRegions:Array.isArray(p.regions),leaks:p.systems.some(s=>s.controllingFactionId||s.factionInfluence||s.manualControllerFactionId),marketLinks:p.corporationMarketLinks&&p.corporationMarketLinks.length}})()");
    assert(privacy.hasRegions&&!privacy.leaks,'Player-safe export leaked referee territorial information or omitted editable map regions.');

    // 1.3.12: every requested directory can receive a referee-created record, and
    // the creation dialog must expose real Randomize All generators before Save.
    const directoryCreationCheck=await evaluate(`(()=>{
      const sector=App.currentSector;
      const specs=[
        {button:'corporations-add',collection:'corporations',label:'corporation'},
        {button:'religions-add',collection:'religions',label:'religion'},
        {button:'political-groups-add',collection:'politicalGroups',label:'political group'},
        {button:'aliens-add',collection:'aliens',label:'alien species'}
      ];
      const results={};
      specs.forEach(spec=>{
        const before=(sector[spec.collection]||[]).length;
        const button=document.getElementById(spec.button);
        if(!button||button.hidden||button.disabled)throw new Error('Missing or disabled Add control for '+spec.label);
        button.click();
        const modal=document.querySelector('.dynmodal-container .dynedit');
        if(!modal)throw new Error('Add '+spec.label+' did not open an editor');
        const randomize=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.includes('Randomize All'));
        const fieldButtons=modal.querySelectorAll('.dynedit-randomize:not(.dynedit-revert)').length;
        if(!randomize||randomize.hidden||fieldButtons===0)throw new Error(spec.label+' creation dialog has no working randomizer');
        randomize.click();
        const status=modal.querySelector('.dynedit-status')?.textContent||'';
        if(!/^Randomized [1-9]/.test(status))throw new Error(spec.label+' Randomize All did not change a value: '+status);
        const save=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.trim()==='(Save)');
        if(!save)throw new Error(spec.label+' dialog has no Save action');
        save.click();
        const items=sector[spec.collection]||[];
        const added=items.length===before+1?items[items.length-1]:null;
        if(!added||!String(added.name||'').trim())throw new Error(spec.label+' was not persisted with a name');
        results[spec.label]={count:items.length,randomizedFields:fieldButtons,status};
      });
      const factionCount=sector.factions.length;
      document.getElementById('factions-add').click();
      const factionModal=document.querySelector('.dynmodal-container .dynedit');
      const factionRandomize=[...factionModal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.includes('Randomize All'));
      const factionButtons=factionModal.querySelectorAll('.dynedit-randomize:not(.dynedit-revert)').length;
      if(!factionRandomize||factionRandomize.hidden||!factionButtons)throw new Error('Custom faction creation lacks functional randomizers');
      factionRandomize.click();
      const factionStatus=factionModal.querySelector('.dynedit-status')?.textContent||'';
      if(!/^Randomized [1-9]/.test(factionStatus))throw new Error('Faction Randomize All did not change any fields: '+factionStatus);
      [...factionModal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.trim()==='(Save)').click();
      if(sector.factions.length!==factionCount+1||!sector.factions[sector.factions.length-1].name)throw new Error('Custom faction was not saved');
      results.faction={count:sector.factions.length,randomizedFields:factionButtons,status:factionStatus};
      const addedCorp=sector.corporations[sector.corporations.length-1];
      const corporateAccount=SectorSettlement.getAccounts(sector).find(a=>a.ownerType==='corporation'&&a.ownerId===addedCorp.id);
      if(!addedCorp.id||!corporateAccount)throw new Error('Manually added corporation did not receive a stable ID and settlement account');
      const roundTrip=App.decompressSector(App.compressSector(sector));
      const collections=['corporations','religions','politicalGroups','aliens','factions'];
      const preserved={};
      collections.forEach(key=>{preserved[key]=(roundTrip[key]||[]).length===sector[key].length&&roundTrip[key][roundTrip[key].length-1]?.name===sector[key][sector[key].length-1]?.name;});
      if(Object.values(preserved).some(ok=>!ok))throw new Error('Manually created directory records did not survive a GM save/link round-trip: '+JSON.stringify(preserved));
      results.corporationAccount=true;results.roundTrip=preserved;
      return results;
    })()`);
    assert(directoryCreationCheck.corporation&&directoryCreationCheck.religion&&directoryCreationCheck['political group']&&directoryCreationCheck['alien species']&&directoryCreationCheck.faction,'1.3.12 Add and Randomize All flows did not create every requested record: '+JSON.stringify(directoryCreationCheck));
    console.log('PASS: 1.3.12 manual creation and working Randomize All for corporations, religions, political groups, alien species, and factions. '+JSON.stringify(directoryCreationCheck));

    // 1.3.12.2 regression: imported/player-safe sector archives may have no
    // baseline arrays for corporations, religions, political groups or aliens.
    // Their Add controls must remain visible just like Add Faction in no-edit
    // mode, and each handler must initialize a missing collection on first use.
    const importedEmptyDirectoryCheck=await evaluate(`(()=>{
      const previous=App.currentSector;
      const imported=JSON.parse(JSON.stringify(previous));
      imported.name='Imported Empty Directory Regression';
      imported.gmMode=false;
      imported.importMetadata={source:'regression fixture',format:'json',mode:'preserve',warnings:[]};
      ['corporations','religions','politicalGroups','aliens'].forEach(key=>delete imported[key]);
      App.displaySector(imported);
      if(!document.body.classList.contains('no-edit'))throw new Error('Fixture did not enter imported/player-safe no-edit mode');
      const specs=[
        {button:'corporations-add',collection:'corporations',output:'corporations-output',label:'corporation'},
        {button:'religions-add',collection:'religions',output:'religions-output',label:'religion'},
        {button:'political-groups-add',collection:'politicalGroups',output:'political-groups-output',label:'political group'},
        {button:'aliens-add',collection:'aliens',output:'aliens-output',label:'alien species'}
      ];
      const results={};
      specs.forEach(spec=>{
        const button=document.getElementById(spec.button);
        if(!button)throw new Error('Missing '+spec.label+' Add control');
        const style=window.getComputedStyle(button);
        if(style.display==='none'||style.visibility==='hidden'||button.classList.contains('gm-only-control'))
          throw new Error(spec.label+' Add control is hidden in imported/player-safe mode');
        button.click();
        const modal=document.querySelector('.dynmodal-container .dynedit');
        if(!modal)throw new Error(spec.label+' Add control did not open its editor from an empty imported collection');
        const save=[...modal.querySelectorAll('.dynedit-toolbar-button')].find(b=>b.textContent.trim()==='(Save)');
        if(!save)throw new Error(spec.label+' editor has no Save action');
        save.click();
        if(!Array.isArray(imported[spec.collection])||imported[spec.collection].length!==1)
          throw new Error(spec.label+' collection was not initialized and populated');
        const rowCount=document.querySelectorAll('#'+spec.output+' tbody tr').length;
        if(rowCount!==1)throw new Error(spec.label+' record was not rendered into its directory');
        results[spec.label]={visible:true,created:imported[spec.collection][0].name,rows:rowCount};
      });
      const factionsAdd=document.getElementById('factions-add');
      if(!factionsAdd||window.getComputedStyle(factionsAdd).display==='none')throw new Error('Existing Faction Add control unexpectedly hidden in imported/player-safe mode');
      results.factionAddRemainsVisible=true;
      if(!document.body.classList.contains('no-edit'))throw new Error('Directory Add actions unexpectedly enabled inline editing of the player-safe archive');
      results.inlineEditingRemainsDisabled=true;
      App.displaySector(previous);
      return results;
    })()`);
    assert(importedEmptyDirectoryCheck.corporation&&importedEmptyDirectoryCheck.religion&&importedEmptyDirectoryCheck['political group']&&importedEmptyDirectoryCheck['alien species']&&importedEmptyDirectoryCheck.factionAddRemainsVisible&&importedEmptyDirectoryCheck.inlineEditingRemainsDisabled,
      'Imported no-baseline JSON did not expose all directory Add controls while preserving read-only editing: '+JSON.stringify(importedEmptyDirectoryCheck));
    console.log('PASS: imported/player-safe JSON with missing directory baselines can add corporations, religions, political groups and aliens; existing read-only behavior remains intact. '+JSON.stringify(importedEmptyDirectoryCheck));

    // End-to-end import mode check: preserve mode must not manufacture Forge details;
    // the explicit enrichment mode may fill gaps while keeping all source records.
    const preserveImport=await evaluate("(()=>{const csv='Name,Entity Type,Location,Children,Neighbors,Parent,Occupation,Situation,Tags\\nHelios,System,0911,,,,,,\\nMeridian,Planet,0911,,,Helios,,,Pretech Archive\\nStation One,Research Base,0911,,,Meridian,Researchers,Power failure,';const s=SwnImport.fromCSV(csv,'Preserve Test.csv','preserve');App.displaySector(s);return {mode:App.currentSector.importMetadata.mode,systems:App.currentSector.systems.length,worlds:App.currentSector.systems[0].planets.length,description:App.currentSector.systems[0].planets[0].description||'',markets:App.currentSector.markets.length,factions:App.currentSector.factions.length,sourceRows:App.currentSector.swnImport.records.length,visibleRows:document.querySelectorAll('#source-data-output tbody tr').length,importedSurveyObjects:App.currentSector.systems[0].bodies.filter(b=>b.importedFromSWN).length,coordinate:App.currentSector.systems[0].x+','+App.currentSector.systems[0].y}})()");
    assert(preserveImport.mode==='preserve'&&preserveImport.systems===1&&preserveImport.worlds===1&&preserveImport.description===''&&preserveImport.markets===0&&preserveImport.factions===0&&preserveImport.sourceRows===3&&preserveImport.visibleRows===3&&preserveImport.importedSurveyObjects===1&&preserveImport.coordinate==='9,11','Preserve import created generated content, lost source rows, or mis-mapped the 10×12 edge: '+JSON.stringify(preserveImport));
    const enrichImport=await evaluate("(()=>{const csv='Name,Entity Type,Location,Children,Neighbors,Parent,Occupation,Situation,Tags\\nHelios,System,0911,,,,,,\\nMeridian,Planet,0911,,,Helios,,,Pretech Archive\\nStation One,Research Base,0911,,,Meridian,Researchers,Power failure,';const s=SwnImport.fromCSV(csv,'Enrich Test.csv','enrich');App.displaySector(s);return {mode:App.currentSector.importMetadata.mode,systems:App.currentSector.systems.length,worlds:App.currentSector.systems[0].planets.length,description:App.currentSector.systems[0].planets[0].description||'',markets:App.currentSector.markets.length,factions:App.currentSector.factions.length,corporations:App.currentSector.corporations.length,sourceRows:App.currentSector.swnImport.records.length,importedSurveyObjects:App.currentSector.systems[0].bodies.filter(b=>b.importedFromSWN).length}})()");
    assert(enrichImport.mode==='enrich'&&enrichImport.systems===1&&enrichImport.worlds===1&&enrichImport.description.length>0&&enrichImport.markets>0&&enrichImport.factions>0&&enrichImport.corporations>0&&enrichImport.sourceRows===3&&enrichImport.importedSurveyObjects===1,'Enrichment mode did not fill supported gaps or dropped source records: '+JSON.stringify(enrichImport));
    console.log('PASS: end-to-end SWN import modes (preserve-as-is vs opt-in Forge enrichment).');
    const nativeImport=await evaluate("(()=>{const data={sector:{sec1:{id:'sec1',type:'sector',name:'Native Browser Test',attributes:{}}},system:{sys1:{id:'sys1',type:'system',name:'Helios',x:10,y:12,parent:'sec1',parentEntity:'sector',attributes:{}},sys2:{id:'sys2',type:'system',name:'Referee Secret',x:1,y:1,parent:'sec1',parentEntity:'sector',isHidden:true,attributes:{}}},planet:{pl1:{id:'pl1',type:'planet',name:'Meridian',parent:'sys1',parentEntity:'system',attributes:{tags:[{name:'Pretech Archive'}]}},pl2:{id:'pl2',type:'planet',name:'Hidden Meridian',parent:'sys1',parentEntity:'system',isHidden:true,attributes:{}}},researchBase:{rb1:{id:'rb1',type:'researchBase',name:'Visible Research Station',parent:'pl1',parentEntity:'planet',attributes:{occupation:'Public researchers',situation:'Stable operations'}},rb2:{id:'rb2',type:'researchBase',name:'Hidden Black Site',parent:'sys1',parentEntity:'system',isHidden:true,attributes:{occupation:'Secret staff',situation:'Secret project'}}},moon:{mHidden:{id:'mHidden',type:'moon',name:'Hidden Moon',parent:'pl2',parentEntity:'planet',attributes:{}}},moonBase:{mbHidden:{id:'mbHidden',type:'moonBase',name:'Hidden Moon Base',parent:'mHidden',parentEntity:'moon',attributes:{occupation:'Secret colonists',situation:'Hidden settlement'}}},routes:{r1:{id:'r1',name:'Old Jump',route:['0000','0303','0911'],color:'#ffaa44',width:'thick',type:'dashed'}},layers:{l1:{id:'l1',name:'Layer',regions:{g1:{name:'Amber Reach',color:'#ffaa44'},g2:{name:'Secret Zone',color:'#ff2244',isHidden:true}},hexes:{'0000':{regions:['g1','g2']},'0303':{regions:['g1']}}}},factions:{f1:{id:'f1',name:'Quiet Bloc',force:4,cunning:6,wealth:3,assets:{}}}};const s=SwnImport.fromJSON(data,'Native Browser Test.json','preserve');App.displaySector(s);const player=App.censorSector(App.currentSector);return {coordinate:App.currentSector.systems[0].x+','+App.currentSector.systems[0].y,regions:App.currentSector.regions.length,playerRegions:player.regions.length,playerHasSourceArchive:!!player.swnImport,sourceRoutes:App.currentSector.swnImport.navigationRoutes.length,drawnRouteSegments:document.querySelectorAll('.swn-navigation-route').length,auxiliaryRows:document.querySelectorAll('#source-data-auxiliary-output tbody tr').length,sourceRecords:App.currentSector.swnImport.records.length,playerSystems:player.systems.length,playerWorlds:player.systems.reduce((n,s)=>n+s.planets.length,0),hiddenSystemPreserved:!!App.currentSector.systems.find(s=>s.name==='Referee Secret'&&s.sourceIsHidden),hiddenWorldPreserved:!!App.currentSector.systems[0].planets.find(p=>p.name==='Hidden Meridian'&&p.sourceIsHidden),gmSurveyBodies:App.currentSector.systems[0].bodies.map(b=>b.name),playerSurveyBodies:player.systems[0].bodies.map(b=>b.name),simulationSchema:App.currentSector.simulation?.schemaVersion,simulationTurn:App.currentSector.simulation?.clock?.turn,playerHasSimulation:Object.prototype.hasOwnProperty.call(player,'simulation')}})()");
    assert(nativeImport.simulationSchema===1&&nativeImport.simulationTurn===0&&!nativeImport.playerHasSimulation,'Preserve-mode SWN import did not receive the additive 1.3 migration or leaked simulation metadata into its player projection: '+JSON.stringify(nativeImport));
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
    const renderPurity=await evaluate("(()=>{const s=App.currentSector,before=JSON.stringify(s);App.renderCampaignPanels(s);const after=JSON.stringify(s);return {pure:before===after,beforeLength:before.length,afterLength:after.length};})()");
    assert(renderPurity.pure,'Campaign panel rendering mutated canonical campaign state: '+JSON.stringify(renderPurity));
    console.log('PASS: campaign panel rendering is read-only against the full imported-sector snapshot.');
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
      console.log('SKIP: native origin-bound browser Worker construction cannot run in about:blank; the shared queue handlers are exercised by the Worker-compatible adapter below, and the real worker source is covered by the Node worker-thread test.');
    }
    // Sector Forge native GM archive round-trip: the app's own exported JSON must
    // preserve edits, custom records, campaign relationships, and original SWN source.
    const rtSource=JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','acheron-rho-native-2026-10-30.json'),'utf8'));
    const rtSetup=await evaluate(`(async()=>{const s=SwnImport.fromJSON(${JSON.stringify(rtSource)},'Acheron Rho.json','preserve');App.displaySector(s);const sys=App.currentSector.systems.find(x=>x.planets&&x.planets.length);const p=sys.planets[0];p.name='ROUNDTRIP_EDITED_WORLD';p.techLevel='TL5';p.atmosphere='ROUNDTRIP_BREATHABLE';p.description='ROUNDTRIP_DESCRIPTION_SENTINEL';p.customCampaignNote='ROUNDTRIP_CUSTOM_WORLD_NOTE';sys.pointsOfInterest=sys.pointsOfInterest||[];sys.pointsOfInterest.push({id:'ROUNDTRIP-POI',name:'ROUNDTRIP_CUSTOM_SITE',type:'Research complex'});sys.bodies=sys.bodies||[];sys.bodies.push({id:'ROUNDTRIP-BODY',name:'ROUNDTRIP_ORBITAL_STATION',type:'Orbital station',bodyClass:'N',isGeneratedWorld:false});App.currentSector.factions=App.currentSector.factions||[];App.currentSector.factions.push({id:'ROUNDTRIP-FACTION',name:'ROUNDTRIP_CUSTOM_FACTION',type:'Political',scale:'Sector',force:4,cunning:5,wealth:3,goal:'Protect the edited world',homeworldSystemId:sys.id,homeworld:sys.name,assets:[],rivals:[],turnLog:[]});App.currentSector.gmNotes='ROUNDTRIP_GM_NOTE_SENTINEL';App.currentSector.simulation.economy={initialized:true,schemaVersion:1,engineVersion:'1.3.4',clock:{turn:0,lastAdvancedTurn:0},marketStates:[],commodities:[]};SectorLogistics.initialize(App.currentSector);App.currentSector.simulation.economy.logistics.shipments.push({id:'ROUNDTRIP_PRIVATE_SHIPMENT_SENTINEL',commodityId:'machine-parts',quantity:1,remainingQuantity:1,deliveredQuantity:0,status:'in-transit',routeIds:[],legs:[],source:'simulated'});App.persistSector(App.currentSector);await App.waitForExports();return {sys:sys.id,planet:p.id,records:App.currentSector.swnImport.records.length};})()`);
    const rt=await evaluate(`(async()=>{const gm=JSON.parse(await(await fetch(document.querySelector('#export-json-gm').href)).text());const player=JSON.parse(await(await fetch(document.querySelector('#export-json-player').href)).text());const sys=${JSON.stringify(rtSetup.sys)},pid=${JSON.stringify(rtSetup.planet)};const world=x=>x.systems.flatMap(s=>s.planets||[]).find(p=>p.id===pid);const gs=gm.systems.find(s=>s.id===sys),ps=player.systems.find(s=>s.id===sys);const gmCheck={shipment:(gm.simulation?.economy?.logistics?.shipments||[]).some(x=>x.id==='ROUNDTRIP_PRIVATE_SHIPMENT_SENTINEL'),world:world(gm),poi:(gs.pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),body:(gs.bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),faction:(gm.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),gmNote:gm.gmNotes,sourceCount:gm.swnImport&&gm.swnImport.records.length};const playerJson=JSON.stringify(player);const playerCheck={world:world(player),hasSource:!!player.swnImport,hasGMNote:Object.prototype.hasOwnProperty.call(player,'gmNotes'),hiddenSecret:JSON.stringify(player).includes('SECRET_'),redactsPoi:!(ps.pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),redactsCustomBody:!(ps.bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),redactsCampaignFactions:!(player.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION')};App.displaySector(gm);App.persistSector(App.currentSector);await App.waitForExports();const gm2=JSON.parse(await(await fetch(document.querySelector('#export-json-gm').href)).text());const g2=world(gm2);const compressed=App.compressSector(gm2);const urlRoundTrip=App.decompressSector(compressed);return {gm:{name:gmCheck.world&&gmCheck.world.name,tech:gmCheck.world&&gmCheck.world.techLevel,atmosphere:gmCheck.world&&gmCheck.world.atmosphere,description:gmCheck.world&&gmCheck.world.description,customNote:gmCheck.world&&gmCheck.world.customCampaignNote,poi:gmCheck.poi,body:gmCheck.body,faction:gmCheck.faction,gmNote:gmCheck.gmNote,sourceCount:gmCheck.sourceCount,shipment:gmCheck.shipment},gmReload:{name:g2&&g2.name,tech:g2&&g2.techLevel,customNote:g2&&g2.customCampaignNote,poi:(gm2.systems.find(s=>s.id===sys).pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),body:(gm2.systems.find(s=>s.id===sys).bodies||[]).some(x=>x.name==='ROUNDTRIP_ORBITAL_STATION'),faction:(gm2.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),gmNote:gm2.gmNotes,sourceCount:gm2.swnImport&&gm2.swnImport.records.length,shipment:(gm2.simulation?.economy?.logistics?.shipments||[]).some(x=>x.id==='ROUNDTRIP_PRIVATE_SHIPMENT_SENTINEL')},player:{name:playerCheck.world&&playerCheck.world.name,tech:playerCheck.world&&playerCheck.world.techLevel,atmosphere:playerCheck.world&&playerCheck.world.atmosphere,hasSource:playerCheck.hasSource,hasGMNote:playerCheck.hasGMNote,hasPrivateShipment:playerJson.includes('ROUNDTRIP_PRIVATE_SHIPMENT_SENTINEL'),hiddenSecret:playerCheck.hiddenSecret,redactsPoi:playerCheck.redactsPoi,redactsCustomBody:playerCheck.redactsCustomBody,redactsCampaignFactions:playerCheck.redactsCampaignFactions},url:{world:world(urlRoundTrip)&&world(urlRoundTrip).name,tech:world(urlRoundTrip)&&world(urlRoundTrip).techLevel,poi:(urlRoundTrip.systems.find(s=>s.id===sys).pointsOfInterest||[]).some(x=>x.name==='ROUNDTRIP_CUSTOM_SITE'),faction:(urlRoundTrip.factions||[]).some(x=>x.id==='ROUNDTRIP-FACTION'),sourceCount:urlRoundTrip.swnImport&&urlRoundTrip.swnImport.records.length,shipment:(urlRoundTrip.simulation?.economy?.logistics?.shipments||[]).some(x=>x.id==='ROUNDTRIP_PRIVATE_SHIPMENT_SENTINEL')}}})()`);
    const exportSizeStatus=await evaluate("document.querySelector('#export-size-status')?.textContent||''");
    assert(exportSizeStatus.includes('GM JSON:')&&exportSizeStatus.includes('GM share link:')&&exportSizeStatus.includes('Detailed archive:'),'Export panel did not expose GM JSON size, share-link length, and detailed archive usage: '+exportSizeStatus);
    console.log('PASS: export panel reports actual GM JSON size, share-link length and detailed-history budget usage.');
    assert(rt.gm.name==='ROUNDTRIP_EDITED_WORLD'&&rt.gm.tech==='TL5'&&rt.gm.atmosphere==='ROUNDTRIP_BREATHABLE'&&rt.gm.description==='ROUNDTRIP_DESCRIPTION_SENTINEL'&&rt.gm.customNote==='ROUNDTRIP_CUSTOM_WORLD_NOTE'&&rt.gm.poi&&rt.gm.body&&rt.gm.faction&&rt.gm.shipment&&rt.gm.gmNote==='ROUNDTRIP_GM_NOTE_SENTINEL'&&rt.gm.sourceCount===rtSetup.records,'GM JSON export lost edits or source data: '+JSON.stringify(rt.gm));
    assert(rt.gmReload.name==='ROUNDTRIP_EDITED_WORLD'&&rt.gmReload.tech==='TL5'&&rt.gmReload.customNote==='ROUNDTRIP_CUSTOM_WORLD_NOTE'&&rt.gmReload.poi&&rt.gmReload.body&&rt.gmReload.faction&&rt.gmReload.shipment&&rt.gmReload.gmNote==='ROUNDTRIP_GM_NOTE_SENTINEL'&&rt.gmReload.sourceCount===rtSetup.records,'GM JSON import/re-export lost edits: '+JSON.stringify(rt.gmReload));
    assert(rt.url.world==='ROUNDTRIP_EDITED_WORLD'&&rt.url.tech==='TL5'&&rt.url.poi&&rt.url.faction&&rt.url.shipment&&rt.url.sourceCount===rtSetup.records,'Compressed GM URL round-trip lost edited content/source archive: '+JSON.stringify(rt.url));
    assert(rt.player.name==='ROUNDTRIP_EDITED_WORLD'&&rt.player.tech==='TL5'&&rt.player.atmosphere==='ROUNDTRIP_BREATHABLE'&&!rt.player.hasSource&&!rt.player.hasGMNote&&!rt.player.hasPrivateShipment&&!rt.player.hiddenSecret&&rt.player.redactsPoi&&rt.player.redactsCustomBody&&rt.player.redactsCampaignFactions,'Player-safe export redaction behavior changed or leaked GM data: '+JSON.stringify(rt.player));
    console.log('PASS: Sector Forge own-format GM JSON export → import → re-export and compressed URL round-trip preserve edited worlds, custom notes, POIs, orbital objects, factions and SWN source records. Player export retains edited public world fields while intentionally omitting GM-only source archive/notes, POIs, custom survey objects and campaign factions. '+JSON.stringify(rt));
    const accessibilityAudit=await evaluate("(()=>{const nodes=[...document.querySelectorAll('button,input,select,textarea,a[href],[role=button],[role=checkbox],[role=radio]')].filter(e=>{const s=getComputedStyle(e);return e.getClientRects().length&&s.display!=='none'&&s.visibility!=='hidden'&&e.type!=='hidden'});function name(e){const aria=e.getAttribute('aria-label');if(aria&&aria.trim())return aria.trim();const ids=(e.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean),labelled=ids.map(id=>document.getElementById(id)?.innerText||'').join(' ').trim();if(labelled)return labelled;const labels=[...(e.labels||[])].map(x=>x.innerText||x.textContent||'').join(' ').trim();if(labels)return labels;if(e.title)return e.title.trim();if(e.matches('button,a[href],[role=button]'))return (e.innerText||e.textContent||'').trim();if(['button','submit','reset'].includes(String(e.type||'')))return String(e.value||'').trim();return '';}const missing=nodes.filter(e=>!name(e)).map(e=>({tag:e.tagName.toLowerCase(),id:e.id,type:e.type||'',role:e.getAttribute('role')||'',placeholder:e.placeholder||''}));return {visibleControls:nodes.length,unnamed:missing,focusVisibleRule:!![...document.styleSheets].some(sh=>{try{return [...sh.cssRules].some(r=>r.selectorText&&/:focus-visible/.test(r.selectorText));}catch(_){return false;}})}})()");
    assert(accessibilityAudit.unnamed.length===0&&accessibilityAudit.focusVisibleRule,'Visible interactive controls need accessible names and keyboard focus indication: '+JSON.stringify(accessibilityAudit));
    console.log('PASS: visible interactive controls have accessible names ('+accessibilityAudit.visibleControls+' controls checked).');

    const recoveryRecordValidation=await evaluate(`(()=>{
      const sector={name:'Recovery validation fixture',systems:[{id:'SYS-1'}],markets:[],factions:[]};
      const serialized=JSON.stringify(sector);
      const valid={appVersion:App.VERSION,sector,checksum:App.checksumLocalRecoveryJSON(serialized)};
      const tampered=Object.assign({},valid,{checksum:'00000000'});
      const malformed=Object.assign({},valid,{sector:{systems:[{id:'SYS-1'},null]}});
      const missingCurrentChecksum={appVersion:App.VERSION,sector};
      const missingThresholdChecksum={appVersion:'1.3.9',sector};
      const legacy={appVersion:'1.3.8',sector};
      return {
        valid:App.validateLocalRecoveryRecord(valid).ok,
        tamperedRejected:!App.validateLocalRecoveryRecord(tampered).ok,
        malformedSystemRejected:!App.validateLocalRecoveryRecord(malformed).ok,
        currentMissingChecksumRejected:!App.validateLocalRecoveryRecord(missingCurrentChecksum).ok,
        thresholdMissingChecksumRejected:!App.validateLocalRecoveryRecord(missingThresholdChecksum).ok,
        futureVersionRequiresChecksum:App.isLocalRecoveryChecksumRequired('2.0'),
        releaseVersionRequiresChecksum:App.isLocalRecoveryChecksumRequired('1.4'),
        currentReleaseRequiresChecksum:App.isLocalRecoveryChecksumRequired(App.VERSION),
        priorFourPartVersionRequiresChecksum:App.isLocalRecoveryChecksumRequired('1.3.12.4'),
        patchVersionRequiresChecksum:App.isLocalRecoveryChecksumRequired('1.3.10.2'),
        malformedVersionNotPartiallyParsed:!App.isLocalRecoveryChecksumRequired('1.3.invalid'),
        legacyChecksumlessAccepted:App.validateLocalRecoveryRecord(legacy).ok
      };
    })()`);
    assert(recoveryRecordValidation.valid&&recoveryRecordValidation.tamperedRejected&&recoveryRecordValidation.malformedSystemRejected&&recoveryRecordValidation.currentMissingChecksumRejected&&recoveryRecordValidation.thresholdMissingChecksumRejected&&recoveryRecordValidation.futureVersionRequiresChecksum&&recoveryRecordValidation.releaseVersionRequiresChecksum&&recoveryRecordValidation.currentReleaseRequiresChecksum&&recoveryRecordValidation.priorFourPartVersionRequiresChecksum&&recoveryRecordValidation.patchVersionRequiresChecksum&&recoveryRecordValidation.malformedVersionNotPartiallyParsed&&recoveryRecordValidation.legacyChecksumlessAccepted,'Local recovery validation accepted a corrupt/current incomplete record or rejected a supported legacy record: '+JSON.stringify(recoveryRecordValidation));
    console.log('PASS: recovery record integrity, malformed structure, mandatory current checksum, and legacy checksum compatibility.');

    const mockWorkerQueue=await evaluate(`(async()=>{
      const worker={messages:[],terminated:false,onmessage:null,onerror:null,
        postMessage(payload){this.messages.push(payload);},
        terminate(){this.terminated=true;},
        respond(index,overrideSeq){
          const payload=this.messages[index];
          if(!payload)throw new Error('No worker payload at index '+index);
          const result=App._buildExportPayload(payload);
          result.seq=overrideSeq==null?payload.seq:overrideSeq;
          this.onmessage({data:result});
        }};
      worker.onmessage=App._handleExportWorkerMessage;worker.onerror=App._handleExportWorkerError;
      App._exportWorkerAttempted=true;App._exportWorker=worker;App._exportWorkerBusy=false;
      App._activeExport=null;App._queuedExport=null;App._exportWaiters=[];
      const snapshots=[1,2,3].map(n=>{const copy=JSON.parse(JSON.stringify(App.currentSector));copy.name='WORKER_QUEUE_'+n;return copy;});
      const promises=snapshots.map(copy=>App.createDownloadLink(copy));
      const oneRequest=worker.messages.length===1&&worker.messages[0].sector.name==='WORKER_QUEUE_1';
      const coalesced=App._queuedExport&&App._queuedExport.sector.name==='WORKER_QUEUE_3';
      worker.respond(0);
      const newestDispatched=worker.messages.length===2&&worker.messages[1].sector.name==='WORKER_QUEUE_3';
      worker.respond(1);
      const resolved=await Promise.all(promises);
      const completed=resolved.every(Boolean)&&App._exportWaiters.length===0&&!App._exportWorkerBusy&&!App._queuedExport&&!App._activeExport;
      const fourth=JSON.parse(JSON.stringify(App.currentSector));fourth.name='WORKER_BAD_SEQUENCE_FALLBACK';
      const fallbackPromise=App.createDownloadLink(fourth);
      const seq=worker.messages[2].seq;
      worker.respond(2,seq+99);
      const fallbackResolved=await fallbackPromise;
      const fallbackClean=fallbackResolved&&App._exportWaiters.length===0&&!App._exportWorkerBusy&&!App._queuedExport&&!App._activeExport;
      const fifth=JSON.parse(JSON.stringify(App.currentSector));fifth.name='WORKER_ERROR_EVENT_FALLBACK';
      const errorPromise=App.createDownloadLink(fifth);
      worker.onerror({message:'E2E simulated worker crash'});
      const errorResolved=await errorPromise;
      const errorClean=errorResolved&&worker.terminated&&App._exportWorker===null&&App._exportWaiters.length===0&&!App._exportWorkerBusy&&!App._queuedExport&&!App._activeExport;
      App._exportWorkerBusy=false;App._queuedExport=null;App._activeExport=null;
      App._exportWorkerAttempted=true; // inline Chromium uses the deterministic page-thread fallback after this test
      return {oneRequest,coalesced,newestDispatched,completed,fallbackClean,errorClean,downloadReady:!!document.querySelector('#export-json-gm').href};
    })()`);
    assert(mockWorkerQueue.oneRequest&&mockWorkerQueue.coalesced&&mockWorkerQueue.newestDispatched&&mockWorkerQueue.completed&&mockWorkerQueue.fallbackClean&&mockWorkerQueue.errorClean&&mockWorkerQueue.downloadReady,'Worker queue coalescing, stale completion, mismatched sequence fallback, or waiter cleanup failed: '+JSON.stringify(mockWorkerQueue));
    console.log('PASS: mocked Worker queue coalescing, stale sequence handling, mismatch/error fallback, and waiter cleanup. '+JSON.stringify(mockWorkerQueue));

    const malformedImportRecovery=await evaluate(`(async()=>{
      const previous=App.currentSector;
      const alerts=[];const oldAlert=window.alert;window.alert=function(message){alerts.push(String(message));};
      const input=document.getElementById('file-input');
      const malformedFile=new File(['{ "systems": ['], 'malformed-sector.json', {type:'application/json'});
      Object.defineProperty(input,'files',{configurable:true,value:[malformedFile]});
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,100));
      const result={
        sameCampaign:App.currentSector===previous,
        generatorRestored:!document.getElementById('generator-container').classList.contains('hide-section'),
        viewerHidden:document.getElementById('viewer-container').classList.contains('hide-section'),
        priorCampaignMessage:alerts.some(message=>message.includes('previous campaign was not replaced')),
        inputCleared:input.value==='',
        alertCount:alerts.length
      };
      window.alert=oldAlert;
      return result;
    })()`);
    assert(malformedImportRecovery.sameCampaign&&malformedImportRecovery.generatorRestored&&malformedImportRecovery.viewerHidden&&malformedImportRecovery.priorCampaignMessage&&malformedImportRecovery.inputCleared,'Malformed JSON import did not preserve the current campaign and restore the generator UI: '+JSON.stringify(malformedImportRecovery));
    console.log('PASS: malformed JSON load preserves the previous campaign, restores the generator screen, and clears the file input.');

    const noGeneratorToolbar=await evaluate(`(()=>{
      const fixture={label:'Manual entry',notes:'No safe randomizer'};
      DynEdit.edit('No-randomizer editor fixture',fixture,{hide:[],lists:{},generators:{}},()=>{});
      const editor=document.querySelector('.dynedit');
      const randomizeAll=editor&&[...editor.querySelectorAll('button')].find(button=>button.textContent.includes('Randomize All'));
      const status=editor&&editor.querySelector('.dynedit-status');
      const hidden=!!randomizeAll&&randomizeAll.hidden&&!!status&&status.hidden;
      const cancel=editor&&[...editor.querySelectorAll('button')].find(button=>button.textContent.includes('Cancel'));
      if(cancel)cancel.click();
      return {toolbarHidden:hidden,editorClosed:!document.querySelector('.dynedit')};
    })()`);
    assert(noGeneratorToolbar.toolbarHidden&&noGeneratorToolbar.editorClosed,'An editor with no field generators still exposes a misleading Randomize All control: '+JSON.stringify(noGeneratorToolbar));
    console.log('PASS: editors with no usable generators hide the Randomize All toolbar and its status. '+JSON.stringify(noGeneratorToolbar));

    const cancelDraftIsolation=await evaluate(`(()=>{
      const fixture={population:'outpost',populationEstimate:'700 inhabitants',populationNumber:700,expandedPopulationType:'Outpost',techLevel:'4',gravity:'standard',generationMode:'expanded'};
      const original=JSON.stringify(fixture);let callbackValue=null;
      const template=App.getPlanetEditTemplate(fixture);
      DynEdit.edit('Cancel draft isolation fixture',fixture,template,function(saved){callbackValue=saved;});
      const editor=document.querySelector('.dynedit');
      const populationRow=editor&&[...editor.querySelectorAll('tr')].find(row=>row.cells[0]&&row.cells[0].textContent.trim()==='population:');
      const reroll=populationRow&&populationRow.querySelector('button.dynedit-randomize:not(.dynedit-revert)');
      if(reroll)reroll.click();
      const sourceUntouchedWhileOpen=JSON.stringify(fixture)===original;
      const cancel=editor&&[...editor.querySelectorAll('button')].find(button=>button.textContent.includes('Cancel'));
      if(cancel)cancel.click();
      return {randomizerAvailable:!!reroll,sourceUntouchedWhileOpen,sourceUntouchedAfterCancel:JSON.stringify(fixture)===original,callbackValue,editorClosed:!document.querySelector('.dynedit')};
    })()`);
    assert(cancelDraftIsolation.randomizerAvailable&&cancelDraftIsolation.sourceUntouchedWhileOpen&&cancelDraftIsolation.sourceUntouchedAfterCancel&&cancelDraftIsolation.callbackValue===false&&cancelDraftIsolation.editorClosed,'Cancel committed generated draft values or failed to close cleanly: '+JSON.stringify(cancelDraftIsolation));
    console.log('PASS: rerolled hidden/derived planet data remains draft-only and Cancel leaves the live world untouched. '+JSON.stringify(cancelDraftIsolation));

    assert(errors.length===0,'Browser JS errors: '+errors.slice(0,6).join(' | '));
    console.log('PASS: player-safe export retains public imported details and removes hidden records, nested raw attributes, and all descendants; zero uncaught browser JavaScript errors.');
    console.log(JSON.stringify({overall:'PASS',chromium:chrome,checks:47,baseline,densityReport,editor:{createdSystem,createdWorld,customBody,customPoi},marketLayout:{visible:marketLayout.visible,cardCount:marketLayout.cardCount,marketCount:marketLayout.marketCount,opened:marketLayout.opened,contained:true},simulation:simAfter,consoleErrors:errors.length},null,2));
  } finally {
    try { if(ws) ws.close(); } catch (_) {}
    try {
      if(process.platform !== 'win32' && chromeProcess.pid) process.kill(-chromeProcess.pid,'SIGTERM');
      else chromeProcess.kill('SIGTERM');
    } catch (_) {}
    await new Promise(resolve=>{
      if(chromeProcess.exitCode!==null || chromeProcess.signalCode!==null) return resolve();
      const timer=setTimeout(()=>{
        try {
          if(process.platform !== 'win32' && chromeProcess.pid) process.kill(-chromeProcess.pid,'SIGKILL');
          else chromeProcess.kill('SIGKILL');
        } catch (_) {}
        resolve();
      },2000);
      chromeProcess.once('exit',()=>{clearTimeout(timer);resolve();});
    });
    try { await new Promise(resolve=>server.close(()=>resolve())); } catch (_) {}
    try { fs.rmSync(userDir,{recursive:true,force:true}); } catch (_) {}
  }
}
main().catch(e=>{console.error('E2E FAIL:',e&&e.stack||e);process.exitCode=1;});
