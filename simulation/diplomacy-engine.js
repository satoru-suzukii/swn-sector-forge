/*
 * Sector Forge 1.3.5 — evidence-driven bilateral diplomacy.
 * Faction relationship vocabulary is intentionally kept distinct from polity
 * relationship vocabulary. GM-authored field locks always take precedence.
 */
var SectorDiplomacy = (function() {
	'use strict';
	var API = {}, ENGINE_VERSION = '1.3.12';
	function arr(v){return Array.isArray(v)?v:[];}
	function num(v,d,min){var n=Number(v);return Number.isFinite(n)?Math.max(min==null?-Infinity:min,n):d;}
	function round(v){return Math.round(num(v,0)*100)/100;}
	function locked(entity,field){return !!(entity && (entity.locked===true || entity.automatic===false || entity.manualOverride===true || entity.isManual===true || (entity.fieldOverrides && entity.fieldOverrides[field]===true) || (entity.manualOverrides && entity.manualOverrides[field]===true)));}
	function relationKey(a,b){return [String(a),String(b)].sort().join('|');}
	function controller(sector,systemId){var s=arr(sector.systems).find(function(x){return String(x.id)===String(systemId);});return s?String(s.manualControllerFactionId||s.controllingFactionId||''):'';}
	function invalidatePathCache(sector){if(typeof SectorLogistics!=='undefined'&&SectorLogistics.invalidatePathCache)SectorLogistics.invalidatePathCache(sector);}
	function ensureState(sector){sector.simulation.diplomacy=sector.simulation.diplomacy||{};var d=sector.simulation.diplomacy;d.schemaVersion=1;d.engineVersion=ENGINE_VERSION;d.clock=d.clock||{};var baseline=num(sector.simulation.economy&&sector.simulation.economy.clock&&sector.simulation.economy.clock.lastAdvancedTurn,0,0);d.clock.lastProcessedTurn=Math.max(0,Math.floor(num(d.clock.lastProcessedTurn,baseline,0)));d.history=arr(d.history);return d;}
	function tradeSignals(sector,relation,turn){
		var lo=relation.factionAId,hi=relation.factionBId,delivered=0,incidents=0,shipments=0;
		var logistics=sector.simulation&&sector.simulation.economy&&sector.simulation.economy.logistics;
		arr(logistics&&logistics.shipments).forEach(function(s){
			if(Number(s.deliveredTurn)!==turn) return;
			var a=String(s.ownerFactionId||controller(sector,s.originSystemId)||''), b=controller(sector,s.destinationSystemId);
			if(relationKey(a,b)!==relationKey(lo,hi))return;
			delivered+=num(s.deliveredQuantity,0,0);shipments++;
			arr(s.legs).forEach(function(l){if(Number(l.departedTurn)===turn&&(l.incident||num(l.quantityLost,0,0)>0))incidents++;});
		});
		arr(logistics&&logistics.shipments).forEach(function(s){
			if(['delayed','awaiting-capacity','stranded','lost'].indexOf(s.status)<0)return;
			var a=String(s.ownerFactionId||controller(sector,s.originSystemId)||''),b=controller(sector,s.destinationSystemId);
			if(relationKey(a,b)===relationKey(lo,hi)&&arr(s.legs).some(function(l){return Number(l.departedTurn)===turn&&l.status!=='arrived';}))incidents++;
		});
		var attacks=arr(sector.factionNews).filter(function(e){return Number(e.turn)===turn&&e.action==='Attack'&&relationKey(e.factionId,e.targetFactionId)===relationKey(lo,hi);}).length;
		return {deliveredLots:round(delivered),shipments:shipments,incidents:incidents,attacks:attacks};
	}
	function postureFor(relation){
		var trust=num(relation.trust,0,-10),tension=num(relation.tension,0,0),state=String(relation.state||'Neutral');
		if(tension>=9&&trust<=-7)return 'Open conflict';
		if(tension>=7||trust<=-5)return 'Rivalry';
		if(trust>=7&&tension<=2)return 'Alliance';
		if(trust>=3&&tension<=4)return 'Trade pact';
		if(tension>=5||trust<0)return 'Strained';
		if(state==='Open conflict'&&tension>3)return 'Open conflict';
		return 'Neutral';
	}
	API.advanceTurn=function(sector,turnNumber){
		if(!sector||!sector.simulation)throw new Error('Migrate the sector before advancing diplomacy.');
		var d=ensureState(sector),turn=Math.max(0,Math.floor(num(turnNumber,0,0)));
		if(turn<=d.clock.lastProcessedTurn)return {ok:true,skipped:true,turn:turn,changed:0};
		if(turn!==d.clock.lastProcessedTurn+1)throw new Error('Diplomacy turns must advance one at a time. Expected '+(d.clock.lastProcessedTurn+1)+', received '+turn+'.');
		var changes=[];
		arr(sector.diplomacy).forEach(function(relation){
			if(!relation||!relation.factionAId||!relation.factionBId)return;
			var signals=tradeSignals(sector,relation,turn),before={state:relation.state,trust:num(relation.trust,0,-10),tension:num(relation.tension,0,0)};
			var trustDelta=0,tensionDelta=0;
			if(signals.deliveredLots>=20){trustDelta+=2;tensionDelta-=1;}
			else if(signals.deliveredLots>=4){trustDelta+=1;tensionDelta-=1;}
			if(signals.incidents>0){trustDelta-=Math.min(2,signals.incidents);tensionDelta+=Math.min(2,signals.incidents);}
			if(signals.attacks>0){trustDelta-=Math.min(3,signals.attacks);tensionDelta+=Math.min(3,signals.attacks)*2;}
			// No activity permits slow de-escalation, but never erases a war by itself.
			if(!signals.deliveredLots&&!signals.incidents&&!signals.attacks&&String(relation.state)!=='Open conflict') tensionDelta-=1;
			if(!locked(relation,'trust'))relation.trust=Math.max(-10,Math.min(10,before.trust+trustDelta));
			if(!locked(relation,'tension'))relation.tension=Math.max(0,Math.min(10,before.tension+tensionDelta));
			if(!locked(relation,'state'))relation.state=postureFor(relation);
			var after={state:relation.state,trust:num(relation.trust,0,-10),tension:num(relation.tension,0,0)};
			if(before.state!==after.state||before.trust!==after.trust||before.tension!==after.tension){
				var why=[];if(signals.deliveredLots)why.push(round(signals.deliveredLots)+' lots of bilateral trade');if(signals.incidents)why.push(signals.incidents+' trade/logistics incident(s)');if(signals.attacks)why.push(signals.attacks+' hostile engagement(s)');if(!why.length)why.push('a quiet diplomatic period');
				var entry={turn:turn,relationId:relation.id||relationKey(relation.factionAId,relation.factionBId),factionAId:relation.factionAId,factionBId:relation.factionBId,before:before,after:after,signals:signals,summary:'Relationship shifted from '+before.state+' to '+after.state+' after '+why.join(', ')+'.'};
				relation.lastEvent=entry.summary;relation.lastUpdatedTurn=turn;relation.history=arr(relation.history);relation.history.push(entry);if(relation.history.length>24)relation.history=relation.history.slice(-24);changes.push(entry);
				if(typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent)SectorSimulation.recordEvent(sector,{category:'diplomacy',type:'relationship-evolved',source:'sector-diplomacy',summary:entry.summary,relationId:entry.relationId,factionAId:entry.factionAId,factionBId:entry.factionBId,before:before,after:after,signals:signals});
			}
		});
		d.history=d.history.concat(changes).slice(-500);d.clock.lastProcessedTurn=turn;if(changes.length)invalidatePathCache(sector);
		return {ok:true,skipped:false,turn:turn,changed:changes.length,events:changes};
	};
	API.getSummary=function(sector){var d=sector&&sector.simulation&&sector.simulation.diplomacy;var rel=arr(sector&&sector.diplomacy);return {initialized:!!d,relationships:rel.length,alliances:rel.filter(function(r){return r.state==='Alliance';}).length,tradePacts:rel.filter(function(r){return r.state==='Trade pact';}).length,rivalries:rel.filter(function(r){return r.state==='Rivalry';}).length,openConflicts:rel.filter(function(r){return r.state==='Open conflict';}).length,events:arr(d&&d.history).length};};
	API.validate=function(sector){var errors=[],d=sector&&sector.simulation&&sector.simulation.diplomacy;if(!d)return {ok:true,errors:errors};var seen=new Set();arr(sector.diplomacy).forEach(function(r){var k=relationKey(r.factionAId,r.factionBId);if(seen.has(k))errors.push('Duplicate faction relationship '+k+'.');seen.add(k);if(num(r.trust,0,-10)<-10||num(r.trust,0,-10)>10)errors.push('Trust outside bounds for '+k+'.');if(num(r.tension,0,0)<0||num(r.tension,0,0)>10)errors.push('Tension outside bounds for '+k+'.');});return {ok:errors.length===0,errors:errors,history:arr(d.history).length};};
	API.constants={engineVersion:ENGINE_VERSION};return API;
})();
