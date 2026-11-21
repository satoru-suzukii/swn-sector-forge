/*
 * Sector Forge 1.3.10 — strategic actors with political instruments and commercial competition.
 * Faction decisions score viable actions against actual political, economic,
 * asset, route, and goal conditions. Corporations autonomously negotiate
 * selected recurring supply contracts and invest in transport capacity.
 * Decisions remain seeded, explainable, editable, and intentionally imperfect.
 */
var SectorStrategic = (function() {
	'use strict';
	var API={},ENGINE_VERSION='1.3.10.1';
	var systemIndexes=new WeakMap(),marketStateIndexes=new WeakMap(),relationIndexes=new WeakMap();
	function indexed(array,cache,keyOf){if(!Array.isArray(array))return new Map();var entry=cache.get(array);if(!entry||entry.length!==array.length){var map=new Map();array.forEach(function(item){var key=keyOf(item);if(key!=null&&key!=='')map.set(String(key),item);});entry={length:array.length,map:map};cache.set(array,entry);}return entry.map;}
	function arr(v){return Array.isArray(v)?v:[];}
	function obj(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
	function num(v,d,min){var n=Number(v);return Number.isFinite(n)?Math.max(min==null?0:min,n):d;}
	function round(v){return Math.round(num(v,0,0)*100)/100;}
	function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
	function economy(sector){return sector&&sector.simulation&&sector.simulation.economy||null;}
	function ensure(sector){if(!sector.simulation)throw new Error('Migrate the sector before strategic assessment.');sector.simulation.strategy=obj(sector.simulation.strategy)?sector.simulation.strategy:{};var s=sector.simulation.strategy;s.schemaVersion=2;s.engineVersion=ENGINE_VERSION;s.factions=obj(s.factions)?s.factions:{};s.corporations=obj(s.corporations)?s.corporations:{};s.clock=obj(s.clock)?s.clock:{};s.decisions=arr(s.decisions);var baseline=num(economy(sector)&&economy(sector).clock&&economy(sector).clock.lastAdvancedTurn,0,0);s.clock.lastProcessedTurn=Math.max(0,Math.floor(num(s.clock.lastProcessedTurn,baseline,0)));sector.simulation.settings=obj(sector.simulation.settings)?sector.simulation.settings:{};sector.simulation.settings.strategicAI=obj(sector.simulation.settings.strategicAI)?sector.simulation.settings.strategicAI:{};var cfg=sector.simulation.settings.strategicAI;if(cfg.enabled==null)cfg.enabled=true;if(cfg.factionAutonomy==null)cfg.factionAutonomy=true;if(cfg.corporateAutonomy==null)cfg.corporateAutonomy=true;if(cfg.factionPoliticalAutonomy==null)cfg.factionPoliticalAutonomy=true;if(cfg.decisionNoise==null)cfg.decisionNoise=0.16;return s;}
	function systems(sector){return arr(sector&&sector.systems);}
	function markets(sector){return arr(sector&&sector.markets);}
	function systemById(sector,id){return indexed(sector&&sector.systems,systemIndexes,function(x){return x&&x.id;}).get(String(id))||null;}
	function systemController(sector,id){var s=systemById(sector,id);return s?String(s.manualControllerFactionId||s.controllingFactionId||''):'';}
	function stateFor(sector,marketId){var e=economy(sector);return indexed(e&&e.marketStates,marketStateIndexes,function(x){return x&&x.marketId;}).get(String(marketId))||null;}
	function accountFor(sector,type,id){return arr(economy(sector)&&economy(sector).settlement&&economy(sector).settlement.accounts).find(function(a){return a.ownerType===type&&String(a.ownerId)===String(id);})||null;}
	function locked(entity,field){return !!(entity&&(entity.locked===true||entity.automatic===false||entity.manualOverride===true||entity.isManual===true||(entity.fieldOverrides&&entity.fieldOverrides[field]===true)||(entity.manualOverrides&&entity.manualOverrides[field]===true)));}
	function evaluateMarket(state){var result={critical:0,shortage:0,surplus:0,criticalGoods:[],shortageGoods:[],surplusGoods:[],pressure:0};arr(state&&state.inventory).forEach(function(stock){var available=Math.max(0,num(stock.onHand,0,0)-num(stock.reserved,0,0)),target=Math.max(1,num(stock.targetStock,1,1)),coverage=available/target;var line={commodityId:stock.commodityId,available:round(available),target:round(target),coverage:round(coverage)};if(coverage<0.3){result.critical++;result.criticalGoods.push(line);result.pressure+=3;}else if(coverage<0.7){result.shortage++;result.shortageGoods.push(line);result.pressure+=1;}if(coverage>1.5){result.surplus++;result.surplusGoods.push(line);}});return result;}
	function priorityFor(result){return result.critical>0?'emergency':result.shortage>0?'high':'normal';}
	function goalProfile(goal){var g=String(goal||'').toLowerCase();return {expansion:/expand|control|recognition|neighboring power/.test(g),military:/rival|remove|prevent|threat|force|military/.test(g),trade:/trade|corridor|resource|supply|commercial|wealth/.test(g),defense:/protect|threatened|client|secure/.test(g),cunning:/conspir|expose|intelligence|recover|pretech/.test(g),diplomacy:/recognition|legitimate|agreement|diplom|client/.test(g)};}
	function relationship(sector,a,b){if(!a||!b||a===b)return null;var index=indexed(sector&&sector.diplomacy,relationIndexes,function(r){return r&&[String(r.factionAId),String(r.factionBId)].sort().join('|');});return index.get([String(a),String(b)].sort().join('|'))||null;}
	function marketImportance(sector,systemId){var m=markets(sector).filter(function(x){return String(x.systemId)===String(systemId);}).length;var r=arr(sector.tradeRoutes).filter(function(x){return String(x.fromSystemId)===String(systemId)||String(x.toSystemId)===String(systemId);}).length;var p=systemById(sector,systemId);return m*3+r*1.5+(p&&p.polityId?1:0);}
	function marketSignalsForFaction(sector,faction){var controlled=markets(sector).filter(function(m){return systemController(sector,m.systemId)===String(faction.id);}),critical=0,shortages=0,surplus=0,pressure=0,criticalSystems=new Set();controlled.forEach(function(m){var metric=evaluateMarket(stateFor(sector,m.id));critical+=metric.critical;shortages+=metric.shortage;surplus+=metric.surplus;pressure+=metric.pressure;if(metric.critical)criticalSystems.add(String(m.systemId));});return {markets:controlled,critical:critical,shortages:shortages,surplus:surplus,pressure:pressure,criticalSystems:criticalSystems};}
	function chooseBest(list, score, randomStream){var ranked=arr(list).map(function(item,index){return {item:item,index:index,score:score(item)};}).sort(function(a,b){return b.score-a.score||a.index-b.index;});if(!ranked.length)return null;var top=ranked[0].score,near=ranked.filter(function(x){return x.score>=top*0.9;});if(near.length>1&&randomStream&&typeof SectorSimulation!=='undefined'&&SectorSimulation.nextRandom(randomStream)<0.12)return near[1];return ranked[0];}
	API.chooseFactionAction=function(sector,faction,turn,context,randomStream){
		var sim=sector&&sector.simulation,cfg=sim&&sim.settings&&sim.settings.strategicAI||{};
		if(cfg.enabled===false||cfg.factionAutonomy===false||faction&&faction.manualStrategicControl===true||faction&&faction.automaticActions===false)return null;
		context=obj(context)?context:{};var goal=goalProfile(faction.goal),signals=marketSignalsForFaction(sector,faction),credits=num(faction.factionCredits,0,0),assets=arr(faction.assets).filter(function(a){return a.active!==false&&Number(a.readyOnTurn||0)<=turn;}),damaged=arr(context.damaged),attacks=arr(context.attacks),buyable=arr(context.buyable),expandable=arr(context.expandableSystems),incomeAssets=arr(context.incomeAssets);
		var threatLevel=attacks.length, maintenancePressure=num(faction.lastMaintenanceSkipped,0,0),scores={},targets={},reasons={};
		function set(action,score,reason){scores[action]=Math.max(0,round(score));reasons[action]=reason;}
		var attackScore=attacks.length?9+Math.min(16,attacks.length*2):0;
		if(attacks.length){var postureScores=attacks.map(function(a){var rel=relationship(sector,faction.id,a.defender&&a.defender.id);return rel&&rel.state==='Open conflict'?10:rel&&rel.state==='Rivalry'?6:rel&&rel.state==='Strained'?1:rel&&rel.state==='Trade pact'?-10:rel&&rel.state==='Alliance'?-50:-5;});attackScore+=Math.max.apply(Math,postureScores);if(goal.military)attackScore+=6;if(goal.defense)attackScore+=3;if(signals.critical)attackScore-=Math.min(8,signals.critical*2);attackScore-=maintenancePressure*3;var targetPick=chooseBest(attacks,function(a){var defender=a.defender||{},target=a.target||{},rel=relationship(sector,faction.id,defender.id),v=Number(target.income||0)*1.8+(target.isBase?4:0)+(Number(target.hp||1)<Number(target.maxHp||1)?2:0)+marketImportance(sector,target.locationSystemId)*0.4+(rel&&rel.state==='Open conflict'?4:rel&&rel.state==='Rivalry'?2:rel&&rel.state==='Trade pact'?-4:0);var strength=num(faction.force,0,0)-num(defender.force,0,0);return v+strength*0.7;},randomStream);if(targetPick)targets.attackKey=String((targetPick.item.asset&&targetPick.item.asset.id)||'')+'|'+String((targetPick.item.defender&&targetPick.item.defender.id)||'')+'|'+String((targetPick.item.target&&targetPick.item.target.id)||'');}
		set('attack',attackScore,attackScore?'Attack only where a legal target exists; hostility and strategic value influence target choice.':'No legal attack target.');
		var repairPick=chooseBest(damaged,function(a){var missing=Math.max(0,Number(a.maxHp||a.hp||0)-Number(a.hp||0));return missing*4+(a.isBase?5:0)+Number(a.income||0)*2+marketImportance(sector,a.locationSystemId)*0.8+(signals.criticalSystems.has(String(a.locationSystemId))?8:0);},randomStream);
		var repairScore=repairPick?8+repairPick.score*0.65+(signals.criticalSystems.has(String(repairPick.item.locationSystemId))?7:0):0;
		if(repairPick)targets.repairAssetId=repairPick.item.id;
		set('repair',repairScore,repairPick?'Repairs are prioritized by damage, income, base status, and the importance of the system they protect.':'No damaged operational assets need repair.');
		var buyPick=chooseBest(buyable,function(template){var stat=String(template.stat||'wealth'),need=stat==='force'?(goal.military||threatLevel?8:2):stat==='wealth'?(goal.trade||signals.shortages||signals.surplus?9:3):(goal.cunning?8:4);var repeat=assets.filter(function(a){return a.name===template.name||a.type===template.type;}).length;var cost=num(template.cost,0,0),maintenance=num(template.maintenance,0,0);return need+num(faction[stat],0,0)*0.4-cost*1.4-maintenance*2-repeat*2+(template.income?template.income*2:0)+(template.type==='Facility'&&goal.trade?2:0);},randomStream);
		var buyScore=buyPick?10+buyPick.score*0.8+(credits<=4?2:0)-maintenancePressure*3:0;if(buyPick)targets.buyTemplateName=buyPick.item.name;
		set('buy',buyScore,buyPick?'Chooses an asset that fills a capability gap while weighing cost, upkeep, income, and existing force structure.':'No affordable asset meets its stat requirements.');
		var expandPick=chooseBest(expandable,function(system){var ownPresence=assets.some(function(a){return String(a.locationSystemId)===String(system.id);});return marketImportance(sector,system.id)*2+(system.polityId?1:0)+(ownPresence?3:0)+(goal.expansion?4:0)+(goal.trade&&arr(sector.tradeRoutes).some(function(r){return (r.fromSystemId===system.id||r.toSystemId===system.id);})?2:0);},randomStream);
		var expandScore=expandPick?8+expandPick.score*0.8+(goal.expansion?6:0)-maintenancePressure*3-(credits<=1?4:0):0;if(expandPick)targets.expandSystemId=expandPick.item.id;
		set('expand',expandScore,expandPick?'Expansion favors commercially important, connected systems rather than random empty locations.':'No viable presence can be expanded.');
		var incomePick=chooseBest(incomeAssets,function(a){return num(a.income,0,0)*3+marketImportance(sector,a.locationSystemId)*0.3;},randomStream);var incomeScore=incomePick?7+incomePick.score+(credits<5?18:credits<10?9:0)+(goal.trade?3:0):0;if(incomePick)targets.incomeAssetId=incomePick.item.id;
		set('income',incomeScore,incomePick?'Uses an available income-producing asset when treasury pressure or commercial goals make cash valuable.':'No income-producing asset is available.');
		var diplomaticNeed=0;arr(sector.diplomacy).forEach(function(rel){if(String(rel.factionAId)!==String(faction.id)&&String(rel.factionBId)!==String(faction.id))return;if(locked(rel,'state')&&locked(rel,'trust')&&locked(rel,'tension'))return;var other=String(rel.factionAId)===String(faction.id)?rel.factionBId:rel.factionAId;var border=markets(sector).some(function(m){return systemController(sector,m.systemId)===String(faction.id);})&&markets(sector).some(function(m){return systemController(sector,m.systemId)===String(other);});if(border)diplomaticNeed=Math.max(diplomaticNeed,Number(rel.tension||0)*0.7+(rel.state==='Strained'?5:rel.state==='Rivalry'?2:0));});
		var diplomacyScore=10+(goal.diplomacy?7:0)+(signals.critical?Math.min(10,signals.critical*2):0)+diplomaticNeed+(credits<3?2:0);
		set('diplomacy',diplomacyScore,'Uses political effort when tension, cross-border supply dependence, or the faction goal makes negotiation relevant.');
		var decisionNoise=clamp(num(cfg.decisionNoise,0.16,0),0,0.5),ranked=Object.keys(scores).filter(function(k){return scores[k]>0;}).map(function(k){var random=(typeof SectorSimulation!=='undefined'&&SectorSimulation.nextRandom)?SectorSimulation.nextRandom(randomStream):0.5;var noise=(random*2-1)*decisionNoise*scores[k];return {action:k,baseScore:scores[k],score:round(Math.max(0,scores[k]+noise)),reason:reasons[k]};}).sort(function(a,b){return b.score-a.score||a.action.localeCompare(b.action);});
		if(!ranked.length)return null;
		var selected=ranked[0];if(ranked.length>1&&ranked[1].score>=selected.score*0.9&&typeof SectorSimulation!=='undefined'&&SectorSimulation.nextRandom(randomStream)<0.10){selected=ranked[1];selected.nearMissChoice=true;}
		var decision={turn:turn,action:selected.action,score:selected.score,baseScore:selected.baseScore,confidence:round(clamp(selected.score/40,0.2,0.95)),risk:round(clamp((selected.action==='attack'?0.65:selected.action==='expand'?0.35:selected.action==='buy'?0.25:0.15)+(goal.military?0.08:0),0,1)),reason:selected.reason,targets:targets,alternatives:ranked.slice(0,3).filter(function(x){return x.action!==selected.action;}).map(function(x){return {action:x.action,score:x.score};}),imperfection:selected.nearMissChoice?'A close alternative was chosen despite scoring slightly lower.':'Small uncertainty affected the final ranking.'};
		faction.lastStrategicDecision=decision;
		return decision;
	};
	function corporationLinks(sector,corp){var links=arr(sector.corporationMarketLinks).filter(function(x){return String(x.corporationId)===String(corp.id);});var ids=links.map(function(x){return String(x.marketId);});if(!ids.length)ids=arr(corp.linkedMarketIds).map(String);return Array.from(new Set(ids)).map(function(id){return markets(sector).find(function(m){return String(m.id)===id;});}).filter(Boolean);}
	function marketPrice(sector,market,commodityId){var st=stateFor(sector,market.id),p=arr(st&&st.prices).find(function(x){return x.commodityId===commodityId;}),good=arr(market.goods).find(function(x){return String(x.name||x.id).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')===commodityId;});if(good&&Number(good.localPrice)>0)return round(good.localPrice);return Math.max(1,num(good&&good.basePrice,p&&p.referencePrice,1)*num(p&&p.currentPriceIndex,100,1)/100);}
	function contractDeliveryReliability(contract) {
		var history = arr(contract && contract.history).slice(-4);
		if (!history.length) return 1;
		var expected = history.reduce(function(total, item) { return total + Math.max(0, num(item.quantity || item.scheduled || contract.quantityPerTurn, 0, 0)); }, 0);
		var delivered = history.reduce(function(total, item) { return total + Math.max(0, num(item.delivered, 0, 0)); }, 0);
		return expected > 0 ? round(clamp(delivered / expected, 0, 1)) : 1;
	}
	function politicalPartyForFaction(factionId) { return {type:'faction',id:String(factionId)}; }
	function otherParty(record, factionId) { return arr(record && record.parties).find(function(p) { return !(p.type === 'faction' && String(p.id) === String(factionId)); }) || null; }
	function partyExists(sector, party) {
		if (!party) return false;
		return party.type === 'faction' ? arr(sector.factions).some(function(x) { return String(x.id) === String(party.id); }) : party.type === 'polity' ? arr(sector.polities).some(function(x) { return String(x.id) === String(party.id); }) : false;
	}
	function politicalRelationLocked(sector, factionId, otherId) {
		var rel = relationship(sector, factionId, otherId);
		return rel ? (locked(rel,'state') || locked(rel,'trust') || locked(rel,'tension')) : false;
	}
	function hasTradeBorder(sector, factionId, otherId) {
		return arr(sector.tradeRoutes).some(function(route) {
			if (typeof SectorSimulation !== 'undefined' && SectorSimulation.isTradeRouteOperational && !SectorSimulation.isTradeRouteOperational(route)) return false;
			var a = systemController(sector, route.fromSystemId), b = systemController(sector, route.toSystemId);
			return (a === String(factionId) && b === String(otherId)) || (a === String(otherId) && b === String(factionId));
		});
	}
	function existingPairAgreement(sector, a, b) {
		if (typeof SectorPolitics === 'undefined' || !SectorPolitics.getTreaties) return false;
		return SectorPolitics.getTreaties(sector).some(function(t) {
			var pendingOrActive = ['proposed','active'].indexOf(t.status) >= 0;
			var coolingDown = t.status === 'rejected' && Number(t.reproposalCooldownUntilTurn || 0) > Number(sector.factionTurn || 0);
			if (!pendingOrActive && !coolingDown) return false;
			var ids = arr(t.parties).filter(function(p) { return p.type === 'faction'; }).map(function(p) { return String(p.id); }).sort();
			return ids.length === 2 && ids[0] === [String(a),String(b)].sort()[0] && ids[1] === [String(a),String(b)].sort()[1];
		});
	}
	API.resolveFactionDiplomacy = function(sector, faction, turn, context) {
		var cfg = sector && sector.simulation && sector.simulation.settings && sector.simulation.settings.strategicAI || {};
		if (!sector || !faction || cfg.enabled === false || cfg.factionAutonomy === false || cfg.factionPoliticalAutonomy === false || faction.manualStrategicControl === true || faction.automaticActions === false) return {ok:false,skipped:true,reason:'Faction political autonomy is disabled or GM-controlled.'};
		if (typeof SectorPolitics === 'undefined') return {ok:false,skipped:true,reason:'The formal political engine is unavailable.'};
		context = obj(context) ? context : {};
		var signals = marketSignalsForFaction(sector, faction), goal = goalProfile(faction.goal), power = num(faction.force,0,0)+num(faction.cunning,0,0)+num(faction.wealth,0,0);
		var party = politicalPartyForFaction(faction.id), state = SectorPolitics.getState(sector), chosen = null;
		// War termination is bilateral. A faction may answer the opposing side's
		// ceasefire/peace offer, but it cannot sign its own proposal.
		var pendingWarOffer = null;
		for (var warIndex = 0; warIndex < arr(state.wars).length; warIndex++) {
			var candidateWar = state.wars[warIndex];
			var ceasefireOffer = candidateWar.ceasefireProposal, peaceOffer = candidateWar.peaceProposal;
			if (candidateWar.status === 'active' && ceasefireOffer && ceasefireOffer.status === 'proposed' && Number(ceasefireOffer.proposedTurn || 0) < Number(turn) && ceasefireOffer.proposedBy && !(ceasefireOffer.proposedBy.type === 'faction' && String(ceasefireOffer.proposedBy.id) === String(faction.id)) && arr(candidateWar.parties).some(function(p){return p.type==='faction'&&String(p.id)===String(faction.id);})) { pendingWarOffer={war:candidateWar,type:'ceasefire',proposal:ceasefireOffer}; break; }
			if (candidateWar.status === 'ceasefire' && peaceOffer && peaceOffer.status === 'proposed' && Number(peaceOffer.proposedTurn || 0) < Number(turn) && peaceOffer.proposedBy && !(peaceOffer.proposedBy.type === 'faction' && String(peaceOffer.proposedBy.id) === String(faction.id)) && arr(candidateWar.parties).some(function(p){return p.type==='faction'&&String(p.id)===String(faction.id);})) { pendingWarOffer={war:candidateWar,type:'peace',proposal:peaceOffer}; break; }
		}
		if (pendingWarOffer) {
			var offerWar=pendingWarOffer.war, offerType=pendingWarOffer.type, offerProposer=pendingWarOffer.proposal.proposedBy;
			var offerOpponent=arr(offerWar.parties).find(function(p){return p.type==='faction'&&String(p.id)!==String(faction.id);});
			var offerOpponentFaction=offerOpponent&&arr(sector.factions).find(function(x){return String(x.id)===String(offerOpponent.id);});
			var ownPower=power, otherPower=offerOpponentFaction?(num(offerOpponentFaction.force,0,0)+num(offerOpponentFaction.cunning,0,0)+num(offerOpponentFaction.wealth,0,0)):power;
			var trust=offerOpponent?num(relationship(sector,faction.id,offerOpponent.id)&&relationship(sector,faction.id,offerOpponent.id).trust,0,-10):0;
			var tension=offerOpponent?num(relationship(sector,faction.id,offerOpponent.id)&&relationship(sector,faction.id,offerOpponent.id).tension,0,0):0;
			var acceptance=signals.critical*3.2+signals.shortages*0.85+(ownPower<otherPower?3:0)+trust*0.28-tension*0.42+(goal.defense?1.5:0)-(goal.military?1.5:0);
			if (offerType==='peace') acceptance+=2.5;
			var response=acceptance>=1.5?'accept':'reject';
			var responded=offerType==='ceasefire'?SectorPolitics.respondToCeasefire(sector,offerWar.id,response,party):SectorPolitics.respondToPeace(sector,offerWar.id,response,party);
			chosen={ok:true,action:response+'-'+offerType+'-proposal',warId:offerWar.id,counterparty:offerProposer,reason:response==='accept'?'Accepted the opposing faction’s proposal after weighing supply pressure, relative strength and diplomatic costs.':'Rejected the opposing faction’s proposal because its terms or strategic timing remain unfavorable.',confidence:round(clamp(Math.abs(acceptance-1.5)/10+0.55,0.55,0.93)),risk:0.12};
			chosen.summary=faction.name+' '+chosen.action.replace(/-/g,' ')+' for '+offerWar.id+'. '+chosen.reason;
			recordDecision(sector,{turn:turn,actorId:faction.id,actorName:faction.name,kind:'faction',type:'faction-political-decision',decision:chosen.action,reason:chosen.reason,confidence:chosen.confidence,risk:chosen.risk,summary:chosen.summary,affectedEntityIds:[faction.id,offerProposer.id,offerWar.id]});
			return chosen;
		}
		// First respond to a pending agreement from another actor. Proposals are
		// evaluated using this faction's own scarcity, trust, threat and goal.
		var proposals = arr(state.treaties).filter(function(t) {
			return t.status === 'proposed' && Number(t.proposedTurn || 0) < Number(turn) && arr(t.parties).some(function(p) { return p.type === 'faction' && String(p.id) === String(faction.id); }) && !(t.proposedBy && t.proposedBy.type === 'faction' && String(t.proposedBy.id) === String(faction.id));
		}).sort(function(a,b) { return Number(a.proposedTurn||0)-Number(b.proposedTurn||0) || String(a.id).localeCompare(String(b.id)); });
		for (var pi = 0; pi < proposals.length; pi++) {
			var proposal = proposals[pi], counterparty = otherParty(proposal,faction.id);
			if (!counterparty || !partyExists(sector,counterparty)) continue;
			var rel = counterparty.type === 'faction' ? relationship(sector,faction.id,counterparty.id) : null;
			if (rel && politicalRelationLocked(sector,faction.id,counterparty.id)) continue;
			var terms = proposal.terms || {}, trust = num(rel && rel.trust,0,-6), tension = num(rel && rel.tension,0,0), tariff = num(terms.tariffPercent,5,0);
			var acceptance = trust*0.45 - tension*0.18 + (signals.critical*2.2) + (signals.shortages*0.65) + (goal.trade?2:0) + (goal.diplomacy?1.5:0);
			if (terms.transitRights !== false) acceptance += 1.5;
			if (terms.tradeAccess === 'preferred') acceptance += 2;
			if (terms.tradeAccess === 'restricted' || terms.tradeAccess === 'embargoed') acceptance -= 5;
			acceptance -= Math.max(0,tariff-5)*0.42;
			if (proposal.type === 'non-aggression' && tension >= 5) acceptance += 4;
			if ((proposal.type === 'trade pact' || proposal.type === 'transit agreement') && rel && ['Rivalry','Open conflict'].indexOf(rel.state)>=0) acceptance -= 3;
			var response = acceptance >= 2.5 ? 'accept' : 'reject';
			var updated = SectorPolitics.respondToTreaty(sector,proposal.id,response,party);
			chosen = {ok:true,action:response+'-treaty-proposal',treatyId:updated.id,counterparty:counterparty,reason:response==='accept'?'Accepted terms that improve supply access or reduce political risk.':'Rejected terms that do not compensate for their restrictions, tariffs or political cost.',confidence:round(clamp(Math.abs(acceptance-2.5)/10+0.55,0.55,0.92)),risk:0.12};
			break;
		}
		if (chosen) {
			var responseSummary = faction.name+' '+chosen.action.replace(/-/g,' ')+' '+chosen.treatyId+'. '+chosen.reason;
			recordDecision(sector,{turn:turn,actorId:faction.id,actorName:faction.name,kind:'faction',type:'faction-political-decision',decision:chosen.action,reason:chosen.reason,confidence:chosen.confidence,risk:chosen.risk,summary:responseSummary,affectedEntityIds:[faction.id,counterparty.id,chosen.treatyId]});
			chosen.summary=responseSummary; return chosen;
		}
		// An active war can prompt a ceasefire; an existing ceasefire must last
		// at least one full campaign turn before this actor may propose peace.
		var wars = arr(state.wars).filter(function(w) { return arr(w.parties).some(function(p) { return p.type==='faction' && String(p.id)===String(faction.id); }); });
		for (var wi=0; wi<wars.length; wi++) {
			var war=wars[wi], opponent=otherParty(war,faction.id); if(!opponent||opponent.type!=='faction') continue;
			if(politicalRelationLocked(sector,faction.id,opponent.id)) continue;
			var opponentFaction=arr(sector.factions).find(function(x){return String(x.id)===String(opponent.id);});
			var opponentPower=opponentFaction?num(opponentFaction.force,0,0)+num(opponentFaction.cunning,0,0)+num(opponentFaction.wealth,0,0):power;
			var underPressure=signals.critical>0||signals.shortages>1||power<opponentPower*0.82;
			if(war.status==='active'&&underPressure){
				var ceasefire=SectorPolitics.proposeCeasefire(sector,war.id,party,{untilTurn:turn+3});
				if(ceasefire.ok){chosen={ok:true,action:'seek-ceasefire',warId:war.id,proposalId:ceasefire.proposal.id,counterparty:opponent,reason:'Military or supply pressure makes a negotiated pause in hostilities preferable to continued escalation.',confidence:0.78,risk:0.18,summary:faction.name+' proposed a ceasefire to '+(opponentFaction&&opponentFaction.name||opponent.id)+'; the opposing faction must accept it.'};break;}
			}
			if(war.status==='ceasefire'&&Number(war.ceasefireStartTurn||0)<Number(turn)&&!signals.critical){
				var peace=SectorPolitics.proposePeace(sector,war.id,party,{settlement:'Autonomous faction peace proposal',initiative:faction.id});
				if(peace.ok){chosen={ok:true,action:'seek-peace-settlement',warId:war.id,proposalId:peace.proposal.id,counterparty:opponent,reason:'The ceasefire held for a full turn and immediate critical shortages have eased; a negotiated peace is preferable.',confidence:0.69,risk:0.1,summary:faction.name+' proposed a peace settlement to '+(opponentFaction&&opponentFaction.name||opponent.id)+'; the opposing faction must accept it.'};break;}
			}
		}
		if (chosen) {
			recordDecision(sector,{turn:turn,actorId:faction.id,actorName:faction.name,kind:'faction',type:'faction-political-decision',decision:chosen.action,reason:chosen.reason,confidence:chosen.confidence,risk:chosen.risk,summary:chosen.summary,affectedEntityIds:[faction.id,chosen.counterparty.id,chosen.treatyId||chosen.warId]});
			return chosen;
		}
		// If no war or incoming proposal needs a response, seek a narrow accord
		// with a faction that shares an active trade border or supply dependency.
		var candidates = arr(sector.factions).filter(function(other){return other&&String(other.id)!==String(faction.id)&&!politicalRelationLocked(sector,faction.id,other.id);}).map(function(other){
			var rel=relationship(sector,faction.id,other.id); if(existingPairAgreement(sector,faction.id,other.id)) return null;
			var hasBorder=hasTradeBorder(sector,faction.id,other.id);
			var otherSignals=marketSignalsForFaction(sector,other);
			var tension=num(rel&&rel.tension,0,0), trust=num(rel&&rel.trust,0,-6);
			var score=(signals.critical*2.5)+(signals.shortages*0.9)+(otherSignals.surplus*0.8)+(goal.trade?2.5:0)+(goal.diplomacy?2:0)+(tension*0.7)+(hasBorder?3:0)+(rel&&rel.state==='Strained'?2:0)+(rel&&rel.state==='Rivalry'?1:0)-Math.max(0,trust)*0.2;
			return {faction:other,relation:rel,signals:otherSignals,hasBorder:hasBorder,score:score};
		}).filter(function(x){return x&&x.score>=7&&(x.hasBorder||x.relation&&Number(x.relation.tension||0)>=6);}).sort(function(a,b){return b.score-a.score||String(a.faction.id).localeCompare(String(b.faction.id));});
		if(candidates.length){
			var candidate=candidates[0],other=candidate.faction,rel=candidate.relation;
			var type=(Number(rel&&rel.tension||0)>=6||rel&&['Rivalry','Open conflict'].indexOf(rel.state)>=0)?'non-aggression':(signals.critical>0||signals.shortages>0||candidate.signals.surplus>0)?'transit agreement':'trade pact';
			var draft={name:faction.name+'–'+other.name+' '+type, type:type, parties:[party,politicalPartyForFaction(other.id)], proposedBy:party, endTurn:turn+5, notes:'Autonomous proposal based on supply exposure, commercial opportunity and diplomatic conditions.'};
			var treaty=SectorPolitics.proposeTreaty(sector,draft);
			chosen={ok:true,action:'propose-'+type.replace(/ /g,'-'),treatyId:treaty.id,counterparty:{type:'faction',id:other.id},reason:'Proposed a limited agreement to improve cross-border access or reduce the risk of conflict.',confidence:round(clamp(candidate.score/22,0.48,0.88)),risk:0.2,summary:faction.name+' proposed a '+type+' to '+other.name+'.'};
			recordDecision(sector,{turn:turn,actorId:faction.id,actorName:faction.name,kind:'faction',type:'faction-political-decision',decision:chosen.action,reason:chosen.reason,confidence:chosen.confidence,risk:chosen.risk,summary:chosen.summary,affectedEntityIds:[faction.id,other.id,treaty.id]});
			return chosen;
		}
		return {ok:false,skipped:true,reason:'No pending political offer, urgent conflict exit, or sufficiently valuable diplomatic opportunity.'};
	};

	function supplyOpportunities(sector,linkedMarkets,contracts,corpIdForMarketScope){var found=[];for(var i=0;i<linkedMarkets.length;i++){var origin=linkedMarkets[i],originState=stateFor(sector,origin.id);if(!originState)continue;for(var j=0;j<linkedMarkets.length;j++){var destination=linkedMarkets[j];if(i===j||String(origin.systemId)===String(destination.systemId))continue;var destState=stateFor(sector,destination.id);if(!destState)continue;arr(originState.inventory).forEach(function(stock){var dest=arr(destState.inventory).find(function(x){return x.commodityId===stock.commodityId;});if(!dest)return;var available=Math.max(0,Number(stock.onHand||0)-Number(stock.reserved||0)),sourceTarget=Math.max(1,Number(stock.targetStock||1)),needed=Math.max(0,Number(dest.targetStock||1)*0.72-(Number(dest.onHand||0)-Number(dest.reserved||0)));var surplus=Math.max(0,available-sourceTarget*1.4);if(surplus<0.5||needed<0.5)return;if(contracts.some(function(c){return c.status==='active'&&String(c.originMarketId)===String(origin.id)&&String(c.destinationMarketId)===String(destination.id)&&c.commodityId===stock.commodityId;}))return;var path=typeof SectorLogistics!=='undefined'&&SectorLogistics.getPath?SectorLogistics.getPath(sector,origin.systemId,destination.systemId,stock.commodityId):{reachable:false};if(!path.reachable||!path.routeIds.length)return;var quantity=round(Math.min(surplus,needed,Math.max(1,Math.min(6,sourceTarget*0.25))));var destMetric=evaluateMarket(destState);var quote=round(marketPrice(sector,origin,stock.commodityId)*1.08);var competitors=contracts.filter(function(c){return c.status==='active'&&String(c.destinationMarketId)===String(destination.id)&&String(c.commodityId)===String(stock.commodityId)&&String(c.originMarketId)!==String(origin.id)&&String(c.ownerCorporationId||'')!==String(corpIdForMarketScope||'');});var competitorQuotes=competitors.map(function(c){var reliability=contractDeliveryReliability(c),unitPrice=num(c.unitPriceCr,0,0);return {contractId:c.id,ownerCorporationId:String(c.ownerCorporationId||''),originMarketId:String(c.originMarketId||''),unitPriceCr:unitPrice,quantityPerTurn:num(c.quantityPerTurn,0,0),deliveryReliability:reliability,effectiveUnitPriceCr:round(unitPrice/Math.max(0.5,reliability))};}).filter(function(c){return c.unitPriceCr>0;}).sort(function(a,b){return a.effectiveUnitPriceCr-b.effectiveUnitPriceCr;});var bestCompetitor=competitorQuotes[0]||null;var priceDelta=bestCompetitor?round((quote-bestCompetitor.effectiveUnitPriceCr)/Math.max(1,bestCompetitor.effectiveUnitPriceCr)*100):null;var competitionAdjustment=bestCompetitor?(priceDelta<=-5?Math.min(4,Math.abs(priceDelta)*0.18):priceDelta>10?-Math.min(8,(priceDelta-10)*0.28):0):0;var score=Math.min(needed,quantity)*2+Math.min(12,surplus/sourceTarget*3)+(destMetric.critical?7:destMetric.shortage?3:0)-num(path.score,0,0)*0.12+competitionAdjustment;found.push({origin:origin,destination:destination,commodityId:stock.commodityId,quantity:quantity,path:path,score:round(score),unitPriceCr:quote,priority:destMetric.critical?'critical':destMetric.shortage?'high':'standard',competition:{competitorCount:competitorQuotes.length,bestCompetitor:bestCompetitor,priceDeltaPercent:priceDelta,scoreAdjustment:round(competitionAdjustment)}});});}}
	found.sort(function(a,b){return b.score-a.score||String(a.origin.id).localeCompare(String(b.origin.id))||String(a.destination.id).localeCompare(String(b.destination.id))||a.commodityId.localeCompare(b.commodityId);});return found;}
	function recordDecision(sector,record){var s=sector.simulation.strategy;s.decisions.push(record);if(s.decisions.length>240)s.decisions.splice(0,s.decisions.length-240);if(typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent)SectorSimulation.recordEvent(sector,{category:'strategy',type:record.type||'strategic-decision',source:'strategic-engine',actorIds:record.actorId?[record.actorId]:[],affectedEntityIds:arr(record.affectedEntityIds),locationSystemIds:arr(record.locationSystemIds),summary:record.summary,decision:record.decision,reason:record.reason,confidence:record.confidence,risk:record.risk});}
	function executeCorporateDecision(sector,corp,turn,linked,opportunities,report){var cfg=sector.simulation.settings.strategicAI||{};if(cfg.enabled===false||cfg.corporateAutonomy===false||corp.automaticStrategy===false||corp.manualStrategyLock===true)return {action:'manual-control',reason:'Corporate autonomy is disabled or GM-controlled.'};
		var contracts=typeof SectorTradeContracts!=='undefined'?SectorTradeContracts.getContracts(sector):[];
		var ownedContracts=contracts.filter(function(c){return String(c.ownerCorporationId||'')===String(corp.id)&&c.status==='active';});
		var account=accountFor(sector,'corporation',corp.id),balance=num(account&&account.balance,0,-Number.MAX_SAFE_INTEGER);
		var shipments=typeof SectorLogistics!=='undefined'?SectorLogistics.getShipments(sector):[];
		var overloaded=shipments.filter(function(sh){return (sh.status==='awaiting-capacity'||sh.status==='delayed')&&ownedContracts.some(function(c){return c.id===sh.contractId;});});
		var poorContract=ownedContracts.map(function(c){var history=arr(c.history).slice(-2),target=Math.max(0.1,Number(c.quantityPerTurn||1));if(history.length<2)return null;var delivered=history.reduce(function(n,h){return n+Number(h.delivered||0);},0),lost=history.reduce(function(n,h){return n+Number(h.lost||0);},0);return {contract:c,ratio:delivered/(target*history.length),loss:lost/(target*history.length)};}).filter(function(x){return x&&x.ratio<0.2&&x.loss>0.2;}).sort(function(a,b){return a.ratio-b.ratio;})[0];
		if(poorContract){poorContract.contract.status='paused';poorContract.contract.automaticPause=true;poorContract.contract.pauseReason='Repeated low delivery and high transit loss';return {action:'pause-unviable-contract',targetId:poorContract.contract.id,reason:'Paused a persistently unfulfilled contract after repeated delivery failure and transit loss.',confidence:0.82,risk:0.1};}
		var top=opportunities[0];
		if(top&&top.score>=5&&!(top.competition&&top.competition.bestCompetitor&&Number(top.competition.priceDeltaPercent)>18)&&typeof SectorTradeContracts!=='undefined'&&SectorTradeContracts.create&&ownedContracts.length<Math.max(1,Math.min(4,1+Math.floor(num(corp.valuation==='booming'?4:corp.valuation==='growing'?3:2,2,1))))){
			var created=SectorTradeContracts.create(sector,{name:corp.name+' supply agreement: '+top.commodityId,originMarketId:top.origin.id,destinationMarketId:top.destination.id,commodityId:top.commodityId,quantityPerTurn:top.quantity,unitPriceCr:top.unitPriceCr,startTurn:turn+1,endTurn:turn+5,priority:top.priority,status:'active',notes:'Automatically negotiated from linked-market surplus and shortage signals.'},turn);
			if(created.ok){created.contract.source='corporate-ai';created.contract.ownerCorporationId=String(corp.id);created.contract.autoGenerated=true;created.contract.negotiatedByCorporationId=String(corp.id);created.contract.decisionTurn=turn;return {action:'negotiate-supply-contract',targetId:created.contract.id,reason:top.competition&&top.competition.bestCompetitor?'Won a contested supply opportunity with a competitive delivered-price offer.':'Negotiated a limited-volume agreement between a linked surplus market and a reachable market with unmet demand.',confidence:round(clamp(top.score/30,0.45,0.92)),risk:0.22,quantity:top.quantity,commodityId:top.commodityId,originMarketId:top.origin.id,destinationMarketId:top.destination.id};}
		}
		var activeFleets=typeof SectorTransport!=='undefined'?SectorTransport.getFleets(sector).filter(function(f){return f.ownerType==='corporation'&&String(f.ownerId)===String(corp.id)&&f.status!=='retired';}):[];
		if(overloaded.length&&activeFleets.length<2&&balance>30000&&typeof SectorTransport!=='undefined'){
			var targetShipment=overloaded[0],routeId=arr(targetShipment.routeIds)[Math.max(0,Number(targetShipment.currentLegIndex||0))]||arr(targetShipment.routeIds)[0];
			if(routeId){var fleet=SectorTransport.createFleet(sector,{name:corp.name+' Commercial Flotilla '+(activeFleets.length+1),type:'Merchant flotilla',ownerType:'corporation',ownerId:String(corp.id),homeSystemId:targetShipment.currentSystemId||targetShipment.originSystemId,capacityPerTurn:20,speed:1.15,reliability:88,condition:100,operatingCostCrPerTurn:240,variableCostPerCargoUnit:0.04,purchaseCostCr:24000,assignments:[{routeId:routeId,allocationPercent:100}]},turn,{source:'corporate-ai'});if(fleet.ok)return {action:'expand-transport-fleet',targetId:fleet.fleet.id,routeId:routeId,reason:'Added capacity to a commercially important route where contracted cargo repeatedly waits for space.',confidence:0.78,risk:0.38,costCr:24000};}
		}
		if(top&&top.score>=2)return {action:'defer-commercial-opportunity',reason:'A trade opportunity exists, but contract limits or lane terms prevented another commitment.',confidence:0.62,risk:0.12};
		return {action:'hold-capital',reason:balance<0?'The corporation is conserving capital while its account remains in deficit.':linked.length<2?'The corporation lacks enough linked markets to justify a new shipping commitment.':'No profitable linked-market opportunity currently outweighs the risks and costs.',confidence:0.68,risk:0.05};
	}
	API.advanceTurn=function(sector,turnNumber){
		if(!sector||!sector.simulation||!economy(sector)||!economy(sector).initialized)return {ok:true,skipped:true,reason:'Local economy is not initialized.'};
		var s=ensure(sector),turn=Math.max(0,Math.floor(num(turnNumber,0,0)));
		if(turn<=s.clock.lastProcessedTurn)return {ok:true,skipped:true,turn:turn,factions:0,corporations:0};
		if(turn!==s.clock.lastProcessedTurn+1)throw new Error('Strategic turns must advance one at a time. Expected '+(s.clock.lastProcessedTurn+1)+', received '+turn+'.');
		var e=economy(sector),factionReports=[],corporateReports=[];
		arr(sector.markets).forEach(function(market){var st=stateFor(sector,market.id);if(!st)return;st.policies=obj(st.policies)?st.policies:{};st.automaticPolicies=obj(st.automaticPolicies)?st.automaticPolicies:{};var metrics=evaluateMarket(st);if(!locked(st.policies,'importPriority'))st.automaticPolicies.importPriority=priorityFor(metrics);st.automaticPolicies.lastStrategicTurn=turn;st.automaticPolicies.reason=metrics.critical?'Critical stock coverage in '+metrics.criticalGoods.map(function(x){return x.commodityId;}).join(', '):metrics.shortage?'Market stock below target':'No urgent import signal';});
		arr(sector.factions).forEach(function(faction){
			var signals=marketSignalsForFaction(sector,faction),critical=signals.critical,shortages=signals.shortages,surplus=signals.surplus,marketsForFaction=signals.markets;
			var activeAssets=arr(faction.assets).filter(function(a){return a.active!==false;}).length;
			var directive=critical?'Protect critical supply':(shortages?'Secure imports and trade access':(surplus?'Expand export access':'Consolidate influence'));
			var priority=critical?'emergency':shortages?'high':surplus?'commercial':'normal';
			var decision=faction.lastStrategicDecision&&Number(faction.lastStrategicDecision.turn)===turn?faction.lastStrategicDecision:null;
			var report={factionId:faction.id,factionName:faction.name,turn:turn,controlledMarkets:marketsForFaction.length,criticalShortages:critical,otherShortages:shortages,surplusAccounts:surplus,activeAssets:activeAssets,priority:priority,directive:directive,pressure:signals.pressure,signals:[],decision:decision,summary:critical?faction.name+' faces '+critical+' critical commodity shortage(s) in controlled markets.':shortages?faction.name+' is watching '+shortages+' below-target market account(s).':surplus?faction.name+' has '+surplus+' export-surplus account(s) to exploit.':faction.name+' has no immediate market emergency.'};
			marketsForFaction.forEach(function(m){var metric=evaluateMarket(stateFor(sector,m.id));if(metric.critical)report.signals.push({marketId:m.id,marketName:m.planetName,kind:'critical-shortage',goods:metric.criticalGoods});});
			s.factions[String(faction.id)]=report;faction.strategyAssessment=report;factionReports.push(report);
			if(critical&&typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent)SectorSimulation.recordEvent(sector,{category:'faction',type:'strategic-supply-alert',source:'sector-strategy',summary:report.summary,factionId:faction.id,marketIds:report.signals.map(function(x){return x.marketId;}),priority:priority});
			if(decision){var outcome=arr(sector.factionNews).find(function(ev){return String(ev.factionId)===String(faction.id)&&Number(ev.turn)===turn;});recordDecision(sector,{turn:turn,actorId:faction.id,actorName:faction.name,kind:'faction',type:'faction-ai-decision',decision:decision.action,reason:decision.reason,confidence:decision.confidence,risk:decision.risk,summary:faction.name+' chose '+decision.action+': '+(decision.reason||'')+(outcome?' Outcome: '+outcome.result+'.':''),outcome:outcome?outcome.result:'unrecorded',affectedEntityIds:arr(decision.targets&&[decision.targets.attackKey,decision.targets.repairAssetId,decision.targets.buyTemplateName,decision.targets.expandSystemId,decision.targets.incomeAssetId]).filter(Boolean)});}
		});
		arr(sector.corporations).forEach(function(corp){
			var linked=corporationLinks(sector,corp),critical=0,shortages=0,surplus=0,goods=[];linked.forEach(function(m){var metrics=evaluateMarket(stateFor(sector,m.id));critical+=metrics.critical;shortages+=metrics.shortage;surplus+=metrics.surplus;metrics.criticalGoods.concat(metrics.surplusGoods).forEach(function(x){goods.push({marketId:m.id,marketName:m.planetName,commodityId:x.commodityId,coverage:x.coverage});});});
			var outlook=critical?'Supply disruption':shortages?'Tight markets':surplus?'Export opportunity':'Stable';var contracts=typeof SectorTradeContracts!=='undefined'?SectorTradeContracts.getContracts(sector):[];var opportunities=supplyOpportunities(sector,linked,contracts,String(corp.id));var decision=executeCorporateDecision(sector,corp,turn,linked,opportunities,{critical:critical,shortages:shortages,surplus:surplus});
			var competition={opportunities:opportunities.length,contested:opportunities.filter(function(x){return x.competition&&x.competition.competitorCount>0;}).length,priceCompetitive:opportunities.filter(function(x){return x.competition&&x.competition.competitorCount>0&&Number(x.competition.priceDeltaPercent)<=0;}).length,priceDisadvantaged:opportunities.filter(function(x){return x.competition&&x.competition.competitorCount>0&&Number(x.competition.priceDeltaPercent)>10;}).length,bestCompetitorPrice:opportunities.reduce(function(best,x){var quote=x.competition&&x.competition.bestCompetitor&&Number(x.competition.bestCompetitor.effectiveUnitPriceCr);return quote>0?(best==null?quote:Math.min(best,quote)):best;},null)};var report={corporationId:corp.id,corporationName:corp.name,turn:turn,linkedMarkets:linked.length,criticalShortages:critical,otherShortages:shortages,surplusAccounts:surplus,outlook:outlook,goods:goods,competition:competition,decision:decision,summary:critical?corp.name+' sees critical supply pressure across its linked markets.':shortages?corp.name+' sees tighter-than-target stocks in linked markets.':surplus?corp.name+' has linked markets with exportable surplus.':corp.name+' sees stable linked-market conditions.'};
			s.corporations[String(corp.id)]=report;corp.marketOutlook=outlook;corp.marketOutlookTurn=turn;corp.lastStrategicAction=decision.action;corp.lastStrategicActionTurn=turn;corp.lastStrategicActionReason=decision.reason;corporateReports.push(report);
			if((critical||surplus||decision.action!=='hold-capital')&&typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent)SectorSimulation.recordEvent(sector,{category:'corporate',type:'market-intelligence',source:'sector-strategy',summary:report.summary,corporationId:corp.id,marketIds:linked.map(function(m){return m.id;}),outlook:outlook});
			if(decision.action!=='hold-capital'&&decision.action!=='manual-control')recordDecision(sector,{turn:turn,actorId:corp.id,actorName:corp.name,kind:'corporation',type:'corporate-ai-decision',decision:decision.action,reason:decision.reason,confidence:decision.confidence,risk:decision.risk,summary:corp.name+' chose '+decision.action+': '+decision.reason,affectedEntityIds:decision.targetId?[decision.targetId]:[]});
		});
		s.clock.lastProcessedTurn=turn;
		return {ok:true,skipped:false,turn:turn,factions:factionReports.length,corporations:corporateReports.length,factionReports:factionReports,corporateReports:corporateReports,decisions:s.decisions.filter(function(d){return d.turn===turn;})};
	};
	API.getFactionReports=function(sector){var s=sector&&sector.simulation&&sector.simulation.strategy;return Object.keys(s&&s.factions||{}).map(function(k){return s.factions[k];}).sort(function(a,b){return String(a.factionName).localeCompare(String(b.factionName));});};
	API.getCorporateReports=function(sector){var s=sector&&sector.simulation&&sector.simulation.strategy;return Object.keys(s&&s.corporations||{}).map(function(k){return s.corporations[k];}).sort(function(a,b){return String(a.corporationName).localeCompare(String(b.corporationName));});};
	API.getDecisionHistory=function(sector){return arr(sector&&sector.simulation&&sector.simulation.strategy&&sector.simulation.strategy.decisions);};
	API.getMarketImportPriority=function(state){if(!state)return 'normal';var manual=state.policies&&state.policies.importPriority;if(locked(state.policies,'importPriority'))return String(manual||'normal');return String(state.automaticPolicies&&state.automaticPolicies.importPriority||manual||'normal');};
	API.setSettings=function(sector,settings){var s=ensure(sector),current=sector.simulation.settings.strategicAI,d=obj(settings)?settings:{};['enabled','factionAutonomy','corporateAutonomy','factionPoliticalAutonomy'].forEach(function(k){if(d[k]!=null)current[k]=!!d[k];});if(d.decisionNoise!=null)current.decisionNoise=clamp(num(d.decisionNoise,current.decisionNoise,0),0,0.5);return current;};
	API.getSettings=function(sector){ensure(sector);return sector.simulation.settings.strategicAI;};
	API.validate=function(sector){var errors=[],warnings=[],s=sector&&sector.simulation&&sector.simulation.strategy;if(!s)return {ok:true,errors:errors,warnings:['Strategic engine has not processed a turn.']};Object.keys(s.factions||{}).forEach(function(id){var r=s.factions[id];if(!['emergency','high','commercial','normal'].includes(r.priority))errors.push('Unknown strategic priority for '+id+'.');if(!Number.isFinite(Number(r.turn)))errors.push('Invalid strategic assessment turn for '+id+'.');});arr(s.decisions).forEach(function(d){if(!Number.isFinite(Number(d.turn)))errors.push('Strategic decision has an invalid turn.');if(!d.actorId||!d.decision)errors.push('Strategic decision is missing actor or action identity.');if(!(Number(d.confidence)>=0&&Number(d.confidence)<=1))errors.push('Strategic decision has invalid confidence.');});if(economy(sector)&&arr(sector.corporations).some(function(c){return c.lastStrategicActionTurn>0&&!c.lastStrategicAction;}))errors.push('A corporation has a turn marker without a strategic action.');return {ok:errors.length===0,errors:errors,warnings:warnings,factions:Object.keys(s.factions||{}).length,corporations:Object.keys(s.corporations||{}).length,decisions:arr(s.decisions).length};};
	API.constants={engineVersion:ENGINE_VERSION};return API;
})();
