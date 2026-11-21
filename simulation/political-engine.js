/*
 * Sector Forge 1.3.10 — formal political agreements, conflict, and faction-level diplomatic autonomy.
 *
 * This layer deliberately keeps faction diplomacy and polity relations as
 * separate vocabularies. Proposals, treaties, sanctions, wars, ceasefires,
 * and peace settlements are persistent GM-facing campaign records. Their
 * policy effects are evaluated at the exact system border where trade occurs.
 */
var SectorPolitics = (function() {
	'use strict';
	var API = {}, ENGINE_VERSION = '1.3.12', SCHEMA_VERSION = 1;
	var PROPOSAL_RESPONSE_WINDOW_TURNS = 3;
	var POLITY_RELATIONS = ['rivalry','cold peace','mutual aid','trade pact','proxy conflict'];
	var TREATY_TYPES = ['alliance','trade pact','mutual aid','transit agreement','non-aggression','ceasefire'];
	var TREATY_STATUS = ['proposed','active','rejected','expired','terminated','breached'];
	var systemIndexes = new WeakMap();
	function systemIndex(sector) {
		var list = sector && sector.systems; if (!Array.isArray(list)) return new Map();
		var entry = systemIndexes.get(list);
		if (!entry || entry.length !== list.length) { var map = new Map(); list.forEach(function(item) { if (item && item.id != null) map.set(String(item.id), item); }); entry = {length:list.length,map:map}; systemIndexes.set(list, entry); }
		return entry.map;
	}
	var SANCTION_TYPES = ['trade embargo','tariff','transit ban','inspection regime','financial restriction'];
	function arr(v) { return Array.isArray(v) ? v : []; }
	function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
	function num(v,d,min,max) { var n=Number(v); if(!Number.isFinite(n))return d; if(min!=null)n=Math.max(min,n); if(max!=null)n=Math.min(max,n); return n; }
	function str(v) { return String(v == null ? '' : v).trim(); }
	function clone(v) { return JSON.parse(JSON.stringify(v)); }
	function ensure(sector) {
		if (!sector || !obj(sector.simulation)) {
			if (typeof SectorSimulation === 'undefined') throw new Error('SectorSimulation must be loaded before political state is initialized.');
			SectorSimulation.migrateSector(sector, {sourceApplicationVersion:ENGINE_VERSION});
		}
		var p=sector.simulation.politics;
		if(!obj(p))p=sector.simulation.politics={};
		p.schemaVersion=SCHEMA_VERSION; p.engineVersion=ENGINE_VERSION;
		p.clock=obj(p.clock)?p.clock:{};
		var baseline=Math.max(Math.floor(num(sector.factionTurn,0,0)),Math.floor(num(sector.simulation.clock&&sector.simulation.clock.turn,0,0)),Math.floor(num(sector.simulation.economy&&sector.simulation.economy.clock&&sector.simulation.economy.clock.lastAdvancedTurn,0,0)));
		p.clock.lastProcessedTurn=Math.max(0,Math.floor(num(p.clock.lastProcessedTurn,baseline,0)));
		p.treaties=arr(p.treaties); p.sanctions=arr(p.sanctions); p.wars=arr(p.wars); p.history=arr(p.history);
		p.nextTreatySequence=Math.max(1,Math.floor(num(p.nextTreatySequence,1,1)));
		p.nextSanctionSequence=Math.max(1,Math.floor(num(p.nextSanctionSequence,1,1)));
		p.nextWarSequence=Math.max(1,Math.floor(num(p.nextWarSequence,1,1)));
		return p;
	}
	function polity(sector,id) { return arr(sector.polities).find(function(x){return x&&String(x.id)===String(id);})||null; }
	function faction(sector,id) { return arr(sector.factions).find(function(x){return x&&String(x.id)===String(id);})||null; }
	function partyExists(sector,type,id) { return type==='faction'?!!faction(sector,id):type==='polity'?!!polity(sector,id):false; }
	function party(type,id) { type=str(type).toLowerCase(); id=str(id); if(['faction','polity'].indexOf(type)<0||!id)throw new Error('A party must identify an existing faction or polity.'); return {type:type,id:id}; }
	function partyKey(p) { return p.type+':'+p.id; }
	// Restrictive policy wins over preferential policy when multiple borders or
	// instruments apply. Among policies of the same sign, keep the strongest.
	function mergePolicyDelta(current, incoming) {
		current=num(current,0); incoming=num(incoming,0);
		if(current>0 || incoming>0) return Math.max(current,incoming);
		return Math.min(current,incoming);
	}
	function normalizeParties(input) {
		var parties=arr(input).map(function(p){return party(p.type,p.id);});
		if(parties.length!==2||partyKey(parties[0])===partyKey(parties[1]))throw new Error('Exactly two distinct political parties are required.');
		return parties;
	}
	function pairKey(a,b) { return [partyKey(a),partyKey(b)].sort().join('|'); }
	function event(sector,category,type,summary,extra) {
		if(typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent)return SectorSimulation.recordEvent(sector,Object.assign({category:category,type:type,source:'sector-politics',visibility:'gm',summary:summary},extra||{}));
		return null;
	}
	function invalidatePathCache(sector) { if (typeof SectorLogistics !== 'undefined' && SectorLogistics.invalidatePathCache) SectorLogistics.invalidatePathCache(sector); }
	function expireProposal(sector, war, key, turn) {
		var proposal = war && war[key];
		if (!proposal || proposal.status !== 'proposed' || Number(proposal.expiresTurn || (Number(proposal.proposedTurn || 0) + PROPOSAL_RESPONSE_WINDOW_TURNS)) >= turn) return false;
		proposal.status = 'expired'; proposal.expiredTurn = turn;
		var kind = key === 'peaceProposal' ? 'peace' : 'ceasefire';
		var summary = 'The pending ' + kind + ' proposal for ' + war.id + ' expired without a response.';
		war.history.push({turn:turn,status:kind + '-expired',proposalId:proposal.id,summary:summary});
		var expiredEvent = event(sector,'politics',kind + '-proposal-expired',summary,{affectedEntityIds:arr(war.parties).map(function(item){return item.id;}),warId:war.id,proposalId:proposal.id,causes:proposal.eventId?[proposal.eventId]:[]});
		proposal.expiryEventId = expiredEvent && expiredEvent.id || '';
		return true;
	}
	function pushHistory(p,entry) { p.history.push(entry); if(p.history.length>1000)p.history.splice(0,p.history.length-1000); }
	function nextId(p,key,prefix) { var n=p[key]++; return prefix+'-'+String(n).padStart(5,'0'); }
	function currentTurn(sector) { return Math.max(0,Math.floor(num(sector.factionTurn,0,0))); }
	function relationForPolity(sector,fromId,toId) {
		var source=polity(sector,fromId); if(!source)return null;
		return arr(source.relations).find(function(r){return String(r.polityId)===String(toId);})||null;
	}
	function polityPolicy(type) {
		switch(String(type||'').toLowerCase()) {
			case 'trade pact': return {access:'preferred',tariffPercent:1,riskModifier:-1};
			case 'mutual aid': return {access:'preferred',tariffPercent:0,riskModifier:-2};
			case 'cold peace': return {access:'restricted',tariffPercent:10,riskModifier:3};
			case 'rivalry': return {access:'restricted',tariffPercent:16,riskModifier:8};
			case 'proxy conflict': return {access:'restricted',tariffPercent:20,riskModifier:12};
			default: return {access:'open',tariffPercent:5,riskModifier:0};
		}
	}
	function systemById(sector,id) { return systemIndex(sector).get(String(id)) || null; }
	function systemParties(sector,systemId) {
		var s=systemById(sector,systemId); if(!s)return [];
		var result=[]; var factionId=str(s.manualControllerFactionId||s.controllingFactionId||''); var polityId=str(s.polityId||'');
		if(factionId)result.push({type:'faction',id:factionId});
		if(polityId)result.push({type:'polity',id:polityId});
		return result;
	}
	function partiesMatchPair(parties,a,b) { return parties.length===2&&((partyKey(parties[0])===partyKey(a)&&partyKey(parties[1])===partyKey(b))||(partyKey(parties[0])===partyKey(b)&&partyKey(parties[1])===partyKey(a))); }
	function treatyDefaults(kind) {
		kind=String(kind||'').toLowerCase();
		if(kind==='alliance'||kind==='mutual aid')return {tradeAccess:'preferred',tariffPercent:0,transitRights:true,mutualDefense:true};
		if(kind==='trade pact')return {tradeAccess:'preferred',tariffPercent:2,transitRights:true,mutualDefense:false};
		if(kind==='transit agreement')return {tradeAccess:'open',tariffPercent:3,transitRights:true,mutualDefense:false};
		if(kind==='non-aggression')return {tradeAccess:'open',tariffPercent:5,transitRights:true,mutualDefense:false};
		if(kind==='ceasefire')return {tradeAccess:'restricted',tariffPercent:12,transitRights:true,mutualDefense:false};
		return {tradeAccess:'open',tariffPercent:5,transitRights:true,mutualDefense:false};
	}
	API.initialize=function(sector) {
		var p=ensure(sector);
		arr(sector.polities).forEach(function(pol){ if(!Array.isArray(pol.relations))pol.relations=[]; });
		return p;
	};
	API.getState=function(sector) { return ensure(sector); };
	API.getTreaties=function(sector) { return arr(ensure(sector).treaties); };
	API.getSanctions=function(sector) { return arr(ensure(sector).sanctions); };
	API.getWars=function(sector) { return arr(ensure(sector).wars); };
	API.setPolityRelation=function(sector,fromPolityId,toPolityId,type,options) {
		var p=ensure(sector), source=polity(sector,fromPolityId), target=polity(sector,toPolityId);
		if(!source||!target||source.id===target.id)throw new Error('Two distinct existing polities are required.');
		type=String(type||'cold peace').toLowerCase(); if(POLITY_RELATIONS.indexOf(type)<0)throw new Error('Unsupported polity relation type: '+type+'.');
		options=options||{}; source.relations=arr(source.relations);
		var rel=source.relations.find(function(r){return String(r.polityId)===String(target.id);});
		var before=rel?rel.type:null;
		if(!rel){rel={polityId:target.id,type:type,source:'manual',history:[]};source.relations.push(rel);} else rel.type=type;
		rel.source=options.source||'manual'; rel.updatedTurn=currentTurn(sector); rel.history=arr(rel.history);
		if(before!==type){var change={turn:currentTurn(sector),fromPolityId:source.id,toPolityId:target.id,before:before,after:type,summary:source.name+' set its relationship with '+target.name+' to '+type+'.'};rel.history.push(change);if(rel.history.length>24)rel.history=rel.history.slice(-24);event(sector,'politics','polity-relation-changed',change.summary,{actorIds:[source.id],affectedEntityIds:[source.id,target.id],relationshipType:type});pushHistory(p,change);}
		invalidatePathCache(sector); return rel;
	};
	API.proposeTreaty=function(sector,draft) {
		var p=ensure(sector); draft=obj(draft)?draft:{}; var parties=normalizeParties(draft.parties);
		parties.forEach(function(x){if(!partyExists(sector,x.type,x.id))throw new Error('Unknown treaty party '+partyKey(x)+'.');});
		var type=String(draft.type||'trade pact').toLowerCase();if(TREATY_TYPES.indexOf(type)<0)throw new Error('Unsupported treaty type: '+type+'.');
		var terms=Object.assign({},treatyDefaults(type),obj(draft.terms)?clone(draft.terms):{});
		terms.tariffPercent=num(terms.tariffPercent,5,0,100);terms.tradeAccess=['preferred','open','restricted','embargoed'].indexOf(terms.tradeAccess)>=0?terms.tradeAccess:'open';terms.transitRights=terms.transitRights!==false;terms.embargoCommodityIds=arr(terms.embargoCommodityIds).map(String);
		var proposedBy=party(draft.proposedBy&&draft.proposedBy.type||parties[0].type,draft.proposedBy&&draft.proposedBy.id||parties[0].id);if(!partyExists(sector,proposedBy.type,proposedBy.id)||!parties.some(function(x){return partyKey(x)===partyKey(proposedBy);}))throw new Error('The treaty proposer must be one of the two existing signatories.');
		var record={id:nextId(p,'nextTreatySequence','TREATY'),name:str(draft.name)||type.replace(/\b\w/g,function(c){return c.toUpperCase();}),type:type,parties:parties,status:'proposed',proposedTurn:currentTurn(sector),startTurn:0,endTurn:Math.max(0,Math.floor(num(draft.endTurn,0,0))),terms:terms,proposedBy:proposedBy,history:[],notes:str(draft.notes)};
		p.treaties.push(record);var proposalEvent=event(sector,'politics','treaty-proposed',record.name+' was proposed between '+parties.map(function(x){return x.id;}).join(' and ')+'.',{affectedEntityIds:parties.map(function(x){return x.id;}),treatyId:record.id,terms:clone(terms)});record.proposalEventId=proposalEvent&&proposalEvent.id||'';pushHistory(p,{turn:currentTurn(sector),type:'treaty-proposed',treatyId:record.id,summary:record.name+' was proposed.'});
		return record;
	};
	API.respondToTreaty=function(sector,treatyId,decision,respondingParty) {
		var p=ensure(sector),record=p.treaties.find(function(x){return x.id===treatyId;});if(!record)throw new Error('Treaty proposal not found.');
		if(record.status!=='proposed')throw new Error('Only a pending treaty proposal can be accepted or rejected.');
		decision=String(decision||'').toLowerCase();if(decision!=='accept'&&decision!=='reject')throw new Error('Decision must be accept or reject.');
		if(respondingParty){var responder=party(respondingParty.type,respondingParty.id);if(!record.parties.some(function(x){return partyKey(x)===partyKey(responder);}))throw new Error('Responding party is not named in this treaty.');if(record.proposedBy&&partyKey(record.proposedBy)===partyKey(responder))throw new Error('The proposing party cannot respond to its own treaty proposal.');}
		record.status=decision==='accept'?'active':'rejected';record.startTurn=decision==='accept'?currentTurn(sector)+1:0;record.respondedTurn=currentTurn(sector);record.respondedBy=respondingParty?party(respondingParty.type,respondingParty.id):null;if(decision==='reject')record.reproposalCooldownUntilTurn=currentTurn(sector)+5;
		var summary=record.name+(decision==='accept'?' was ratified and takes effect on turn ':' was rejected on turn ')+(decision==='accept'?record.startTurn:currentTurn(sector))+'.';record.history.push({turn:currentTurn(sector),status:record.status,summary:summary});var responseEvent=event(sector,'politics','treaty-'+record.status,summary,{affectedEntityIds:record.parties.map(function(x){return x.id;}),treatyId:record.id,terms:clone(record.terms),causes:record.proposalEventId?[record.proposalEventId]:[]});record.responseEventId=responseEvent&&responseEvent.id||'';record.lastEventId=record.responseEventId;pushHistory(p,{turn:currentTurn(sector),type:'treaty-'+record.status,treatyId:record.id,summary:summary});invalidatePathCache(sector);return record;
	};
	API.terminateTreaty=function(sector,treatyId,reason) {
		var p=ensure(sector),record=p.treaties.find(function(x){return x.id===treatyId;});if(!record)throw new Error('Treaty not found.');if(record.status!=='active')throw new Error('Only active treaties can be terminated.');record.status='terminated';record.terminatedTurn=currentTurn(sector);record.terminationReason=str(reason)||'Terminated by the referee';record.history.push({turn:currentTurn(sector),status:'terminated',summary:record.terminationReason});event(sector,'politics','treaty-terminated',record.name+' was terminated: '+record.terminationReason+'.',{affectedEntityIds:record.parties.map(function(x){return x.id;}),treatyId:record.id});invalidatePathCache(sector);return record;
	};
	API.renewTreaty=function(sector,treatyId,newEndTurn,notes) { var p=ensure(sector),record=p.treaties.find(function(x){return x.id===treatyId;});if(!record)throw new Error('Treaty not found.');if(record.status!=='active')throw new Error('Only active treaties can be renewed.');var nextEnd=Math.max(0,Math.floor(num(newEndTurn,0,0)));if(nextEnd>0&&nextEnd<=currentTurn(sector))throw new Error('A renewed treaty must end after the current campaign turn.');if(record.endTurn>0&&nextEnd>0&&nextEnd<=record.endTurn)throw new Error('Renewal must extend the existing treaty term.');var previousEnd=record.endTurn;record.endTurn=nextEnd;record.renewedTurn=currentTurn(sector);record.renewalNotes=str(notes);record.history.push({turn:currentTurn(sector),status:'renewed',previousEndTurn:previousEnd,newEndTurn:nextEnd,summary:'Treaty term renewed.'});var renewalEvent=event(sector,'politics','treaty-renewed',record.name+' was renewed'+(nextEnd?' through turn '+nextEnd:' indefinitely')+'.',{affectedEntityIds:record.parties.map(function(x){return x.id;}),treatyId:record.id,causes:record.responseEventId?[record.responseEventId]:[]});record.lastEventId=renewalEvent&&renewalEvent.id||record.lastEventId;pushHistory(p,{turn:currentTurn(sector),type:'treaty-renewed',treatyId:record.id,summary:record.name+' was renewed.'});invalidatePathCache(sector);return record; };
	API.breachTreaty=function(sector,treatyId,breachingParty,reason) { var p=ensure(sector),record=p.treaties.find(function(x){return x.id===treatyId;});if(!record)throw new Error('Treaty not found.');if(record.status!=='active')throw new Error('Only active treaties can be breached.');var breacher=party(breachingParty&&breachingParty.type,breachingParty&&breachingParty.id);if(!record.parties.some(function(x){return partyKey(x)===partyKey(breacher);}))throw new Error('The breaching party must be a treaty signatory.');record.status='breached';record.breachedTurn=currentTurn(sector);record.breachingParty=breacher;record.breachReason=str(reason)||'Breach recorded by the referee';record.history.push({turn:currentTurn(sector),status:'breached',breachingParty:breacher,summary:record.breachReason});var breachEvent=event(sector,'politics','treaty-breached',record.name+' was breached by '+breacher.id+': '+record.breachReason+'.',{actorIds:[breacher.id],affectedEntityIds:record.parties.map(function(x){return x.id;}),treatyId:record.id,causes:record.lastEventId?[record.lastEventId]:(record.responseEventId?[record.responseEventId]:[])});record.lastEventId=breachEvent&&breachEvent.id||record.lastEventId;pushHistory(p,{turn:currentTurn(sector),type:'treaty-breached',treatyId:record.id,summary:record.name+' was breached.'});invalidatePathCache(sector);return record; };
	API.imposeSanction=function(sector,draft) {
		var p=ensure(sector);draft=obj(draft)?draft:{};var issuer=party(draft.issuerType,draft.issuerId),target=party(draft.targetType,draft.targetId);
		if(!partyExists(sector,issuer.type,issuer.id)||!partyExists(sector,target.type,target.id)||partyKey(issuer)===partyKey(target))throw new Error('A sanction requires two distinct existing political parties.');
		var kind=String(draft.kind||'trade embargo').toLowerCase();if(SANCTION_TYPES.indexOf(kind)<0)throw new Error('Unsupported sanction type: '+kind+'.');
		var r={id:nextId(p,'nextSanctionSequence','SANCTION'),name:str(draft.name)||kind,issuer:issuer,target:target,kind:kind,status:'active',startTurn:currentTurn(sector)+1,endTurn:Math.max(0,Math.floor(num(draft.endTurn,0,0))),direction:['outbound','both'].indexOf(draft.direction)>=0?draft.direction:'both',commodityIds:arr(draft.commodityIds).map(String),tariffPercent:num(draft.tariffPercent,kind==='tariff'?25:0,0,100),notes:str(draft.notes),history:[]};
		p.sanctions.push(r);event(sector,'politics','sanction-imposed',issuer.id+' imposed '+kind+' on '+target.id+'.',{actorIds:[issuer.id],affectedEntityIds:[issuer.id,target.id],sanctionId:r.id,kind:kind});pushHistory(p,{turn:currentTurn(sector),type:'sanction-imposed',sanctionId:r.id,summary:r.name+' imposed.'});invalidatePathCache(sector);return r;
	};
	API.liftSanction=function(sector,sanctionId,reason) { var p=ensure(sector),r=p.sanctions.find(function(x){return x.id===sanctionId;});if(!r)throw new Error('Sanction not found.');if(r.status!=='active')return r;r.status='lifted';r.liftedTurn=currentTurn(sector);r.liftReason=str(reason)||'Lifted by the referee';event(sector,'politics','sanction-lifted',r.issuer.id+' lifted '+r.kind+' against '+r.target.id+'.',{affectedEntityIds:[r.issuer.id,r.target.id],sanctionId:r.id});invalidatePathCache(sector);return r; };
	API.declareWar=function(sector,partyA,partyB,options) {
		var p=ensure(sector),a=party(partyA.type,partyA.id),b=party(partyB.type,partyB.id);if(!partyExists(sector,a.type,a.id)||!partyExists(sector,b.type,b.id)||partyKey(a)===partyKey(b))throw new Error('War requires two distinct existing political parties.');
		var existing=p.wars.find(function(w){return w.status==='active'&&pairKey(w.parties[0],w.parties[1])===pairKey(a,b);});if(existing)return existing;
		options=options||{};var w={id:nextId(p,'nextWarSequence','WAR'),parties:[a,b],status:'active',declaredTurn:currentTurn(sector)+1,endedTurn:0,humanitarianCommodityIds:arr(options.humanitarianCommodityIds).map(String),blockadeSystemIds:arr(options.blockadeSystemIds).map(String),history:[],notes:str(options.notes)};
		p.wars.push(w);var declarationEvent=event(sector,'politics','war-declared',a.id+' declared war on '+b.id+'.',{actorIds:[a.id],affectedEntityIds:[a.id,b.id],warId:w.id,humanitarianCommodityIds:w.humanitarianCommodityIds,blockadeSystemIds:w.blockadeSystemIds});w.declarationEventId=declarationEvent&&declarationEvent.id||'';pushHistory(p,{turn:currentTurn(sector),type:'war-declared',warId:w.id,summary:a.id+' declared war on '+b.id+'.'});
		invalidatePathCache(sector);return w;
	};
	API.declareCeasefire=function(sector,warId,options) { var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;});if(!w||w.status!=='active')throw new Error('An active war is required for a ceasefire.');options=options||{};w.status='ceasefire';w.ceasefireStartTurn=currentTurn(sector)+1;w.ceasefireUntilTurn=Math.max(w.ceasefireStartTurn,Math.floor(num(options.untilTurn,currentTurn(sector)+3,1)));w.history.push({turn:currentTurn(sector),effectiveTurn:w.ceasefireStartTurn,status:'ceasefire'});var ceasefireEvent=event(sector,'politics','ceasefire-declared','The referee recorded a ceasefire between '+w.parties.map(function(x){return x.id;}).join(' and ')+', effective on turn '+w.ceasefireStartTurn+'.',{affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,authority:'referee',causes:w.declarationEventId?[w.declarationEventId]:[]});w.ceasefireEventId=ceasefireEvent&&ceasefireEvent.id||'';invalidatePathCache(sector);return w; };
	API.makePeace=function(sector,warId,terms) { var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;});if(!w||['active','ceasefire'].indexOf(w.status)<0)throw new Error('An active war or ceasefire is required to make peace.');w.prePeaceStatus=w.status;w.status='peace-pending';w.peaceEffectiveTurn=currentTurn(sector)+1;w.peaceTerms=obj(terms)?clone(terms):{};w.history.push({turn:currentTurn(sector),effectiveTurn:w.peaceEffectiveTurn,status:'peace-pending',terms:w.peaceTerms});var peaceEvent=event(sector,'politics','peace-settlement-recorded','The referee recorded a peace settlement for '+w.parties.map(function(x){return x.id;}).join(' and ')+', effective on turn '+w.peaceEffectiveTurn+'.',{affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,terms:w.peaceTerms,authority:'referee',causes:w.ceasefireEventId?[w.ceasefireEventId]:(w.declarationEventId?[w.declarationEventId]:[])});w.peaceEventId=peaceEvent&&peaceEvent.id||'';invalidatePathCache(sector);return w; };
	API.proposeCeasefire=function(sector,warId,proposingParty,options) {
		var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;});
		if(!w||w.status!=='active')throw new Error('An active war is required to propose a ceasefire.');
		var proposer=party(proposingParty&&proposingParty.type,proposingParty&&proposingParty.id);
		if(!w.parties.some(function(x){return partyKey(x)===partyKey(proposer);}))throw new Error('The ceasefire proposer must be a war participant.');
		var current=currentTurn(sector),existing=w.ceasefireProposal;
		if(existing&&existing.status==='proposed')return {ok:false,reason:'A ceasefire proposal is already awaiting the other party.',proposal:existing};
		if(existing&&existing.status==='rejected'&&current<Number(existing.cooldownUntilTurn||0))return {ok:false,reason:'The rejected ceasefire proposal is still in its response cooldown.',proposal:existing};
		options=obj(options)?options:{};
		var proposal={id:'CEASEFIRE-'+w.id+'-'+String(current),status:'proposed',proposedBy:proposer,proposedTurn:current,expiresTurn:current+PROPOSAL_RESPONSE_WINDOW_TURNS,untilTurn:Math.max(current+2,Math.floor(num(options.untilTurn,current+3,1))),terms:obj(options.terms)?clone(options.terms):{}};
		w.ceasefireProposal=proposal;w.history.push({turn:current,status:'ceasefire-proposed',proposalId:proposal.id,proposedBy:proposer});
		var e=event(sector,'politics','ceasefire-proposed',proposer.id+' proposed a ceasefire in '+w.id+'; the other party must respond.',{actorIds:[proposer.id],affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,proposalId:proposal.id,causes:w.declarationEventId?[w.declarationEventId]:[]});proposal.eventId=e&&e.id||'';invalidatePathCache(sector);
		return {ok:true,proposal:proposal};
	};
	API.respondToCeasefire=function(sector,warId,decision,respondingParty) {
		var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;}),proposal=w&&w.ceasefireProposal;
		if (w && proposal && expireProposal(sector,w,'ceasefireProposal',currentTurn(sector))) invalidatePathCache(sector);
		if(!w||w.status!=='active'||!proposal||proposal.status!=='proposed')throw new Error('No pending ceasefire proposal exists for this active war.');
		decision=String(decision||'').toLowerCase();if(decision!=='accept'&&decision!=='reject')throw new Error('Decision must be accept or reject.');
		var responder=party(respondingParty&&respondingParty.type,respondingParty&&respondingParty.id);
		if(!w.parties.some(function(x){return partyKey(x)===partyKey(responder);})||partyKey(responder)===partyKey(proposal.proposedBy))throw new Error('Only the other war participant may respond to this ceasefire proposal.');
		if(currentTurn(sector)<=Number(proposal.proposedTurn||0))throw new Error('The other party may respond from the next campaign turn.');
		proposal.status=decision==='accept'?'accepted':'rejected';proposal.respondedBy=responder;proposal.respondedTurn=currentTurn(sector);
		if(decision==='accept'){
			w.status='ceasefire';w.ceasefireStartTurn=currentTurn(sector)+1;w.ceasefireUntilTurn=Math.max(w.ceasefireStartTurn,proposal.untilTurn||currentTurn(sector)+3);w.ceasefireTerms=clone(proposal.terms||{});
		}else proposal.cooldownUntilTurn=currentTurn(sector)+5;
		var summary=decision==='accept'?'Both parties accepted a ceasefire for '+w.id+'; it takes effect on turn '+w.ceasefireStartTurn+'.':'The ceasefire proposal for '+w.id+' was rejected; hostilities continue.';
		w.history.push({turn:currentTurn(sector),status:'ceasefire-'+proposal.status,proposalId:proposal.id,responder:responder,effectiveTurn:decision==='accept'?w.ceasefireStartTurn:null,summary:summary});
		var responseEvent=event(sector,'politics','ceasefire-'+proposal.status,summary,{actorIds:[responder.id],affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,proposalId:proposal.id,causes:proposal.eventId?[proposal.eventId]:[]});proposal.responseEventId=responseEvent&&responseEvent.id||'';invalidatePathCache(sector);
		return {ok:true,war:w,proposal:proposal};
	};
	API.proposePeace=function(sector,warId,proposingParty,terms) {
		var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;});
		if(!w||w.status!=='ceasefire'||Number(w.ceasefireStartTurn||0)>=currentTurn(sector))throw new Error('A ceasefire must hold for a full turn before peace can be proposed.');
		var proposer=party(proposingParty&&proposingParty.type,proposingParty&&proposingParty.id);
		if(!w.parties.some(function(x){return partyKey(x)===partyKey(proposer);}))throw new Error('The peace proposer must be a war participant.');
		var current=currentTurn(sector),existing=w.peaceProposal;
		if(existing&&existing.status==='proposed')return {ok:false,reason:'A peace proposal is already awaiting the other party.',proposal:existing};
		if(existing&&existing.status==='rejected'&&current<Number(existing.cooldownUntilTurn||0))return {ok:false,reason:'The rejected peace proposal is still in its response cooldown.',proposal:existing};
		var proposal={id:'PEACE-'+w.id+'-'+String(current),status:'proposed',proposedBy:proposer,proposedTurn:current,expiresTurn:current+PROPOSAL_RESPONSE_WINDOW_TURNS,terms:obj(terms)?clone(terms):{}};
		w.peaceProposal=proposal;w.history.push({turn:current,status:'peace-proposed',proposalId:proposal.id,proposedBy:proposer});
		var e=event(sector,'politics','peace-proposed',proposer.id+' proposed a peace settlement for '+w.id+'; the other party must respond.',{actorIds:[proposer.id],affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,proposalId:proposal.id,causes:w.ceasefireEventId?[w.ceasefireEventId]:[]});proposal.eventId=e&&e.id||'';invalidatePathCache(sector);
		return {ok:true,proposal:proposal};
	};
	API.respondToPeace=function(sector,warId,decision,respondingParty) {
		var p=ensure(sector),w=p.wars.find(function(x){return x.id===warId;}),proposal=w&&w.peaceProposal;
		if (w && proposal && expireProposal(sector,w,'peaceProposal',currentTurn(sector))) invalidatePathCache(sector);
		if(!w||w.status!=='ceasefire'||!proposal||proposal.status!=='proposed')throw new Error('No pending peace proposal exists during an active ceasefire.');
		decision=String(decision||'').toLowerCase();if(decision!=='accept'&&decision!=='reject')throw new Error('Decision must be accept or reject.');
		var responder=party(respondingParty&&respondingParty.type,respondingParty&&respondingParty.id);
		if(!w.parties.some(function(x){return partyKey(x)===partyKey(responder);})||partyKey(responder)===partyKey(proposal.proposedBy))throw new Error('Only the other war participant may respond to this peace proposal.');
		if(currentTurn(sector)<=Number(proposal.proposedTurn||0))throw new Error('The other party may respond from the next campaign turn.');
		proposal.status=decision==='accept'?'accepted':'rejected';proposal.respondedBy=responder;proposal.respondedTurn=currentTurn(sector);
		if(decision==='accept'){w.prePeaceStatus='ceasefire';w.status='peace-pending';w.peaceEffectiveTurn=currentTurn(sector)+1;w.peaceTerms=clone(proposal.terms||{});w.peaceEventId=proposal.id;}
		else proposal.cooldownUntilTurn=currentTurn(sector)+5;
		var summary=decision==='accept'?'Both parties accepted a peace settlement for '+w.id+'; it takes effect on turn '+w.peaceEffectiveTurn+'.':'The peace proposal for '+w.id+' was rejected; the ceasefire remains in place.';
		w.history.push({turn:currentTurn(sector),status:'peace-'+proposal.status,proposalId:proposal.id,responder:responder,effectiveTurn:decision==='accept'?w.peaceEffectiveTurn:null,summary:summary});
		var responseEvent=event(sector,'politics','peace-'+proposal.status,summary,{actorIds:[responder.id],affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,proposalId:proposal.id,causes:proposal.eventId?[proposal.eventId]:[]});proposal.responseEventId=responseEvent&&responseEvent.id||'';invalidatePathCache(sector);
		return {ok:true,war:w,proposal:proposal};
	};
	API.getTradeAccess=function(sector,fromSystemId,toSystemId,commodityId) {
		var p=ensure(sector),from=systemParties(sector,fromSystemId),to=systemParties(sector,toSystemId);if(!from.length||!to.length)return {allowed:true,tariffDelta:0,riskModifier:0,reason:'No polity or faction border policy'};
		var result={allowed:true,tariffDelta:0,riskModifier:0,reason:'No additional political restriction'},matchingPairs=[];
		from.forEach(function(a){to.forEach(function(b){if(partyKey(a)!==partyKey(b))matchingPairs.push([a,b]);});});
		// Polity relations are directional: only the origin polity's record
		// governs this route direction. No reciprocal record is inferred.
		matchingPairs.forEach(function(pair){var a=pair[0],b=pair[1];if(a.type==='polity'&&b.type==='polity'){
			var relation=relationForPolity(sector,a.id,b.id);if(relation){var policy=polityPolicy(relation.type);result.tariffDelta=mergePolicyDelta(result.tariffDelta,policy.tariffPercent-5);result.riskModifier=mergePolicyDelta(result.riskModifier,policy.riskModifier);if(policy.access==='restricted'&&result.reason==='No additional political restriction')result.reason='Polity relation: '+relation.type;}
		}});
		p.wars.forEach(function(w){
			var partyCrossing=matchingPairs.some(function(pair){return partiesMatchPair(w.parties,pair[0],pair[1]);});
			var declared=Number(w.declaredTurn||0)<=currentTurn(sector);
			var ceasefireStarted=(w.status==='ceasefire'||(w.status==='peace-pending'&&w.prePeaceStatus==='ceasefire'))&&Number(w.ceasefireStartTurn||w.declaredTurn||0)<=currentTurn(sector);
			var pendingPeace=w.status==='peace-pending'&&Number(w.peaceEffectiveTurn||0)>currentTurn(sector);
			var pendingCeasefire=w.status==='ceasefire'&&!ceasefireStarted;
			var activeBeforePeace=pendingPeace&&(w.prePeaceStatus==='active'||(w.prePeaceStatus==='ceasefire'&&!ceasefireStarted));
			var warStillActive=w.status==='active'||pendingCeasefire||activeBeforePeace;
			var blockaded=(arr(w.blockadeSystemIds).indexOf(String(fromSystemId))>=0||arr(w.blockadeSystemIds).indexOf(String(toSystemId))>=0)&&matchingPairs.some(function(pair){return w.parties.some(function(partyRecord){return partyKey(partyRecord)===partyKey(pair[0])||partyKey(partyRecord)===partyKey(pair[1]);});});
			if(declared&&warStillActive&&(partyCrossing||blockaded)){
				if(arr(w.humanitarianCommodityIds).indexOf(String(commodityId))>=0&&!blockaded){result.tariffDelta=Math.max(result.tariffDelta,10);result.riskModifier=Math.max(result.riskModifier,12);result.reason='Wartime humanitarian exception';}
				else {result.allowed=false;result.reason=blockaded?'Wartime blockade':'Active war between political parties';}
			}
			if(declared&&ceasefireStarted&&(partyCrossing||blockaded)){result.tariffDelta=Math.max(result.tariffDelta,7);result.riskModifier=Math.max(result.riskModifier,5);if(result.allowed)result.reason='Ceasefire restrictions';}
		});
		p.sanctions.filter(function(s){return s.status==='active'&&Number(s.startTurn)<=currentTurn(sector)&&(s.endTurn===0||Number(s.endTurn)>=currentTurn(sector));}).forEach(function(s){
			var direct=matchingPairs.some(function(pair){return partyKey(pair[0])===partyKey(s.issuer)&&partyKey(pair[1])===partyKey(s.target);});
			var reverse=s.direction==='both'&&matchingPairs.some(function(pair){return partyKey(pair[1])===partyKey(s.issuer)&&partyKey(pair[0])===partyKey(s.target);});if(!direct&&!reverse)return;
			if(s.kind==='trade embargo'&&(!s.commodityIds.length||s.commodityIds.indexOf(String(commodityId))>=0)){result.allowed=false;result.reason='Sanctioned trade embargo';}
			else if(s.kind==='transit ban'){result.allowed=false;result.reason='Sanctioned transit ban';}
			else if(s.kind==='tariff'){result.tariffDelta=Math.max(result.tariffDelta,Number(s.tariffPercent||0));result.reason='Sanctioned tariff';}
			else if(s.kind==='inspection regime'){result.riskModifier=Math.max(result.riskModifier,10);result.tariffDelta=Math.max(result.tariffDelta,3);result.reason='Enhanced customs inspection';}
			else if((s.kind==='financial restriction'||s.kind==='asset freeze')){result.riskModifier=Math.max(result.riskModifier,4);result.reason='Financial restriction';}
		});
		var activeTreaties=p.treaties.filter(function(t){return t.status==='active'&&Number(t.startTurn)<=currentTurn(sector)&&(t.endTurn===0||Number(t.endTurn)>=currentTurn(sector));});
		activeTreaties.forEach(function(t){var crosses=matchingPairs.some(function(pair){return partiesMatchPair(t.parties,pair[0],pair[1]);});if(!crosses)return;var terms=obj(t.terms)?t.terms:{};if(arr(terms.embargoCommodityIds).indexOf(String(commodityId))>=0){result.allowed=false;result.reason='Treaty commodity restriction';}if(terms.transitRights===false){result.allowed=false;result.reason='Treaty denies transit rights';}if(terms.tariffPercent!=null)result.tariffDelta=mergePolicyDelta(result.tariffDelta,num(terms.tariffPercent,0,0,100)-5);if(terms.tradeAccess==='embargoed'){result.allowed=false;result.reason='Treaty-controlled embargo';}else if(terms.tradeAccess==='restricted'){result.tariffDelta=Math.max(result.tariffDelta,5);result.riskModifier=Math.max(result.riskModifier,2);if(result.allowed)result.reason='Treaty-restricted access';}else if(terms.tradeAccess==='preferred'&&result.allowed){result.tariffDelta=mergePolicyDelta(result.tariffDelta,-3);result.riskModifier=mergePolicyDelta(result.riskModifier,-1);result.reason='Preferential treaty access';}});
		return result;
	};
	API.advanceTurn=function(sector,turnNumber) {
		var p=ensure(sector),turn=Math.floor(num(turnNumber,currentTurn(sector),0));if(turn<=p.clock.lastProcessedTurn)return {ok:true,skipped:true,turn:turn,expiredTreaties:0,expiredSanctions:0,expiredProposals:0};
		if(turn!==p.clock.lastProcessedTurn+1)throw new Error('Political turns must advance one at a time. Expected '+(p.clock.lastProcessedTurn+1)+', received '+turn+'.');
		var expiredTreaties=0,expiredSanctions=0,expiredProposals=0,tradeAccessChanged=false;
		p.treaties.forEach(function(t){if(t.status==='active'&&Number(t.endTurn)>0&&Number(t.endTurn)<turn){t.status='expired';t.expiredTurn=turn;expiredTreaties++;event(sector,'politics','treaty-expired',t.name+' expired at the end of turn '+(turn-1)+'.',{affectedEntityIds:t.parties.map(function(x){return x.id;}),treatyId:t.id});}});
		p.sanctions.forEach(function(s){if(s.status==='active'&&Number(s.endTurn)>0&&Number(s.endTurn)<turn){s.status='expired';s.expiredTurn=turn;expiredSanctions++;event(sector,'politics','sanction-expired',s.name+' expired at the end of turn '+(turn-1)+'.',{affectedEntityIds:[s.issuer.id,s.target.id],sanctionId:s.id});}});
		p.wars.forEach(function(w){
			if (expireProposal(sector,w,'ceasefireProposal',turn)) expiredProposals++;
			if (expireProposal(sector,w,'peaceProposal',turn)) expiredProposals++;
			if(w.status==='peace-pending'&&Number(w.peaceEffectiveTurn)<=turn){w.status='peace';w.endedTurn=turn;tradeAccessChanged=true;w.history.push({turn:turn,status:'peace',summary:'Peace settlement became effective.'});event(sector,'politics','peace-settled','Peace took effect between '+w.parties.map(function(x){return x.id;}).join(' and ')+'.',{affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id,causes:w.peaceEventId?[w.peaceEventId]:[]});}
			if(w.status==='ceasefire'&&Number(w.ceasefireStartTurn||0)<=turn&&Number(w.ceasefireUntilTurn)>0&&Number(w.ceasefireUntilTurn)<turn){w.status='active';tradeAccessChanged=true;w.history.push({turn:turn,status:'active',summary:'Ceasefire expired; hostilities are unresolved.'});event(sector,'politics','ceasefire-expired','A ceasefire expired between '+w.parties.map(function(x){return x.id;}).join(' and ')+'.',{affectedEntityIds:w.parties.map(function(x){return x.id;}),warId:w.id});}
			if(w.status==='active'&&Number(w.declaredTurn)<=turn&&!w.diplomaticStateAppliedTurn&&w.parties.every(function(x){return x.type==='faction';})){var a=w.parties[0].id,b=w.parties[1].id;var rel=arr(sector.diplomacy).find(function(r){return (r.factionAId===a&&r.factionBId===b)||(r.factionAId===b&&r.factionBId===a);});if(rel&&!rel.locked&&rel.manualOverride!==true&&!(rel.fieldOverrides&&rel.fieldOverrides.state===true)){if(rel.state!=='Open conflict')tradeAccessChanged=true;rel.state='Open conflict';rel.tension=10;rel.lastEvent='Open conflict was declared by the political record.';rel.lastUpdatedTurn=turn;}w.diplomaticStateAppliedTurn=turn;}
		});
		p.clock.lastProcessedTurn=turn;if(tradeAccessChanged||expiredTreaties||expiredSanctions||expiredProposals)invalidatePathCache(sector);return {ok:true,skipped:false,turn:turn,expiredTreaties:expiredTreaties,expiredSanctions:expiredSanctions,expiredProposals:expiredProposals,tradeAccessChanged:tradeAccessChanged,activeTreaties:p.treaties.filter(function(t){return t.status==='active';}).length,activeSanctions:p.sanctions.filter(function(s){return s.status==='active';}).length,activeWars:p.wars.filter(function(w){return w.status==='active';}).length};
	};
	API.getSummary=function(sector){var p=ensure(sector);return {treaties:p.treaties.length,proposals:p.treaties.filter(function(t){return t.status==='proposed';}).length,activeTreaties:p.treaties.filter(function(t){return t.status==='active';}).length,activeSanctions:p.sanctions.filter(function(s){return s.status==='active';}).length,activeWars:p.wars.filter(function(w){return w.status==='active'||(w.status==='peace-pending'&&w.prePeaceStatus==='active');}).length,ceasefires:p.wars.filter(function(w){return w.status==='ceasefire'||(w.status==='peace-pending'&&w.prePeaceStatus==='ceasefire');}).length,pendingPeace:p.wars.filter(function(w){return w.status==='peace-pending';}).length,events:p.history.length};};
	API.validate=function(sector){var errors=[],warnings=[],p=sector&&sector.simulation&&sector.simulation.politics;if(!p)return {ok:true,errors:errors,warnings:['Formal political layer is not initialized.']};var ids=new Set();arr(p.treaties).forEach(function(t){if(!t.id||ids.has(t.id))errors.push('Missing or duplicate treaty ID.');ids.add(t.id);if(TREATY_STATUS.indexOf(t.status)<0)errors.push('Treaty '+t.id+' has invalid status.');if(arr(t.parties).length!==2||t.parties.some(function(x){return !partyExists(sector,x.type,x.id);}))warnings.push('Treaty '+t.id+' references a missing or invalid party.');if(!obj(t.terms))errors.push('Treaty '+t.id+' has no terms object.');});var sids=new Set();arr(p.sanctions).forEach(function(s){if(!s.id||sids.has(s.id))errors.push('Missing or duplicate sanction ID.');sids.add(s.id);if(['active','lifted','expired'].indexOf(s.status)<0)errors.push('Sanction '+s.id+' has invalid status.');if(!s.issuer||!s.target||!partyExists(sector,s.issuer.type,s.issuer.id)||!partyExists(sector,s.target.type,s.target.id))warnings.push('Sanction '+s.id+' references a missing or invalid party.');});var wids=new Set();arr(p.wars).forEach(function(w){if(!w.id||wids.has(w.id))errors.push('Missing or duplicate war ID.');wids.add(w.id);if(!['active','ceasefire','peace-pending','peace'].includes(w.status))errors.push('War '+w.id+' has invalid status.');['ceasefireProposal','peaceProposal'].forEach(function(key){var proposal=w[key];if(proposal&&['proposed','accepted','rejected','expired'].indexOf(proposal.status)<0)errors.push('War '+w.id+' has invalid '+key+' status.');});if(arr(w.parties).length!==2||w.parties.some(function(x){return !partyExists(sector,x.type,x.id);}))warnings.push('War '+w.id+' references a missing or invalid party.');});arr(sector.polities).forEach(function(pol){var seen=new Set();arr(pol.relations).forEach(function(r){if(POLITY_RELATIONS.indexOf(String(r.type||'').toLowerCase())<0)errors.push('Polity '+pol.id+' has invalid relation type '+r.type+'.');if(seen.has(String(r.polityId)))errors.push('Polity '+pol.id+' has duplicate relation to '+r.polityId+'.');seen.add(String(r.polityId));if(!polity(sector,r.polityId))warnings.push('Polity '+pol.id+' references missing polity '+r.polityId+'.');});});return {ok:errors.length===0,errors:errors,warnings:warnings,treaties:arr(p.treaties).length,sanctions:arr(p.sanctions).length,wars:arr(p.wars).length};};
	API.constants={engineVersion:ENGINE_VERSION,schemaVersion:SCHEMA_VERSION,proposalResponseWindowTurns:PROPOSAL_RESPONSE_WINDOW_TURNS,polityRelations:POLITY_RELATIONS.slice(),treatyTypes:TREATY_TYPES.slice(),sanctionTypes:SANCTION_TYPES.slice()};
	return API;
})();
