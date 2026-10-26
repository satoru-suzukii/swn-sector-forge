/*
 * Sector Forge campaign tool layer.
 * These are original, system-facing procedures designed to complement the
 * bundled SWN data without copying supplement tables verbatim. The streamlined
 * faction pulse and local trade prices are GM-facing tools, not a replacement
 * for the full published faction asset/economic subsystems.
 */
var CampaignTools = (function() {
	var Tools = {};
	var pick = function(items) { return items[Math.floor(Math.random() * items.length)]; };
	var int = function(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); };
	var shuffled = function(items) { return GenUtil.shuffle(items.slice()); };
	var idSlug = function(value) { return String(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
	var cleanText = function(value) { return String(value == null ? '' : value); };

	Tools.hexDistance = function(a, b) {
		// Map rows are odd-column-offset coordinates; convert them to axial.
		var aq = Number(a.x), ar = Number(a.y) - Math.floor(Number(a.x) / 2);
		var bq = Number(b.x), br = Number(b.y) - Math.floor(Number(b.x) / 2);
		var dq = aq - bq, dr = ar - br;
		return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
	};

	Tools.ensureIds = function(sector) {
		sector.systems = Array.isArray(sector.systems) ? sector.systems : [];
		var used = new Set();
		sector.systems.forEach(function(system, index) {
			if (!system.id || used.has(system.id)) system.id = 'SYS-' + String(index + 1).padStart(2, '0');
			used.add(system.id);
			if (!Number.isFinite(Number(system.x))) system.x = index % 8;
			if (!Number.isFinite(Number(system.y))) system.y = Math.floor(index / 8) % 10;
			system.x = Math.max(0, Math.min(7, Math.round(Number(system.x))));
			system.y = Math.max(0, Math.min(9, Math.round(Number(system.y))));
			system.planets = Array.isArray(system.planets) ? system.planets : [];
			if (!Array.isArray(system.pointsOfInterest)) system.pointsOfInterest = [];
			system.planets.forEach(function(planet, pIndex) {
				planet.id = planet.id || system.id + '-W' + String(pIndex + 1).padStart(2, '0');
				planet.systemId = system.id;
				// Migrate old population labels to the Revised Edition categories.
				var legacyPopulations = {
					'K 10+':'fewer than a million inhabitants', 'K 100+':'fewer than a million inhabitants',
					'M 1+':'several million inhabitants', 'M 10+':'several million inhabitants',
					'M 100+':'hundreds of millions of inhabitants', 'B 1+':'billions of inhabitants',
					'alien civ.':'alien inhabitants'
				};
				if (legacyPopulations[planet.population]) planet.population = legacyPopulations[planet.population];
				if (sector.gmMode !== false && !planet.terrain && typeof WorldTerrainGenerator !== 'undefined') planet.terrain = WorldTerrainGenerator.generate();
				if (typeof WorldGenerator !== 'undefined') {
					if (sector.gmMode === false) planet.description = WorldGenerator.describePlanet(planet, {hideTags:true});
					else if (!planet.description) planet.description = WorldGenerator.describePlanet(planet);
				}
			});
			if (!Array.isArray(system.bodies) || !system.bodies.length) {
				system.bodies = StarSystemGenerator.generate(system.planets);
			} else {
				// Older surveys included generic gas giants/planets that were not linked
				// to world records. Replace those placeholders with linked world entries.
				system.bodies = system.bodies.filter(function(body) { return body.bodyClass !== 'P' || body.planetId || body.worldName; });
				system.planets.forEach(function(planet, pIndex) {
					var existingBody = system.bodies.find(function(body) { return body.planetId === planet.id || (body.worldName && body.worldName === planet.name); });
					if (existingBody) {
						existingBody.planetId = planet.id; existingBody.worldName = planet.name; existingBody.name = planet.name; existingBody.isGeneratedWorld = true;
					} else {
						system.bodies.push({type:'World · TL ' + (planet.techLevel || '?') + ' · ' + (planet.population || 'unknown population'), name:planet.name || ('World ' + (pIndex + 1)), worldName:planet.name || ('World ' + (pIndex + 1)), planetId:planet.id, bodyClass:'P', isGeneratedWorld:true});
					}
				});
			}
		});
		return sector;
	};

	Tools.generateTradeRoutes = function(sector) {
		var systems = sector.systems || [];
		var candidates = [];
		for (var i = 0; i < systems.length; i++) {
			for (var j = i + 1; j < systems.length; j++) {
				var d = Tools.hexDistance(systems[i], systems[j]);
				if (d > 0 && d <= 3) candidates.push({fromSystemId:systems[i].id, toSystemId:systems[j].id, distance:d});
			}
		}
		candidates.sort(function(a,b) { return a.distance - b.distance; });
		var parent = {};
		systems.forEach(function(system) { parent[system.id] = system.id; });
		function root(id) { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; }
		var routes = [];
		var routeKeys = new Set();
		function addRoute(route, kind) {
			var key = [route.fromSystemId, route.toSystemId].sort().join('|');
			if (routeKeys.has(key)) return;
			routeKeys.add(key);
			routes.push({id:'ROUTE-' + String(routes.length + 1).padStart(2, '0'), fromSystemId:route.fromSystemId, toSystemId:route.toSystemId, distance:route.distance, kind:kind || (route.distance <= 2 ? 'trade' : 'scout'), status:route.distance <= 2 ? 'Established' : 'Surveyed', note:route.distance === 3 ? 'Long drill; verify local drive capabilities.' : 'Short-drill connection'});
		}
		// Minimum spanning forest within the normal drive-3 limit.
		candidates.forEach(function(edge) {
			var ra = root(edge.fromSystemId), rb = root(edge.toSystemId);
			if (ra !== rb) { parent[ra] = rb; addRoute(edge, edge.distance <= 2 ? 'trade' : 'scout'); }
		});
		// Add extra links to busy corridors. Every route remains within 3 hexes.
		candidates.forEach(function(edge) {
			var key = [edge.fromSystemId, edge.toSystemId].sort().join('|');
			if (!routeKeys.has(key) && Math.random() < (edge.distance <= 2 ? 0.24 : 0.1)) addRoute(edge, edge.distance <= 2 ? 'trade' : 'scout');
		});
		return routes;
	};

	Tools.generatePolities = function(sector) {
		var systems = (sector.systems || []).slice();
		var inhabited = systems.filter(function(system) { return system.planets && system.planets.length; });
		if (!inhabited.length) { sector.polities = []; return sector.polities; }
		var names = (sector.politicalGroups || []).map(function(group) { return group.name; }).filter(Boolean);
		var count = Math.min(6, Math.max(1, Math.round(inhabited.length / 5)), inhabited.length);
		var available = shuffled(inhabited);
		var polities = [];
		var govs = ['Federated republic', 'Dynastic compact', 'Corporate protectorate', 'Loose trade league', 'Military directorate', 'Theocratic concord', 'Mutual-defense pact', 'Client-state network', 'Confederated worlds'];
		var intents = ['secure a jump corridor', 'preserve a fragile peace', 'control a rare resource', 'contain a rival ideology', 'restore an old mandate claim', 'open a new market', 'protect a frontier from raiders', 'keep outsiders away'];
		for (var p = 0; p < count && available.length; p++) {
			var capital = available.shift();
			var targetSize = Math.min(available.length + 1, int(2, Math.min(6, Math.max(2, Math.ceil(inhabited.length / count)))));
			var members = [capital];
			while (members.length < targetSize && available.length) {
				var bestIndex = 0, bestDistance = Infinity;
				for (var a = 0; a < available.length; a++) {
					var nearest = Math.min.apply(null, members.map(function(member) { return Tools.hexDistance(member, available[a]); }));
					if (nearest < bestDistance) { bestDistance = nearest; bestIndex = a; }
				}
				if (bestDistance > 4 && members.length > 1 && Math.random() < 0.6) break;
				members.push(available.splice(bestIndex, 1)[0]);
			}
			var name = names.length ? names[p % names.length] : pick(['Outer Reach', 'Veyra Compact', 'The Meridian League', 'Northstar Protectorate', 'Free Systems Assembly', 'Orion Corridor Authority']) + ' ' + pick(['Authority', 'Compact', 'League', 'Union', 'Mandate']);
			var polity = {id:'POLITY-' + String(p + 1).padStart(2, '0'), name:name, government:pick(govs), capitalSystemId:capital.id, memberSystemIds:members.map(function(m) { return m.id; }), policy:pick(intents), stability:int(1, 6), relations:[]};
			polities.push(polity);
			members.forEach(function(member) { member.polityId = polity.id; member.polityName = polity.name; });
		}
		// Systems outside a polity remain independent rather than silently claimed.
		systems.forEach(function(system) {
			if (!system.polityId) { delete system.polityId; delete system.polityName; }
		});
		for (var i = 0; i < polities.length; i++) {
			for (var j = i + 1; j < polities.length; j++) {
				if (Math.random() < 0.55) polities[i].relations.push({polityId:polities[j].id, type:pick(['rivalry', 'cold peace', 'mutual aid', 'trade pact', 'proxy conflict'])});
			}
		}
		sector.polities = polities;
		return polities;
	};

	Tools.TRADE_GOODS = [
		{name:'Metals and alloys', category:'Industrial', basePrice:800}, {name:'Fresh produce', category:'Agricultural', basePrice:120},
		{name:'Preserved food', category:'Food', basePrice:250}, {name:'Medical compounds', category:'Medical', basePrice:1600},
		{name:'Industrial catalysts', category:'Industrial', basePrice:2400}, {name:'Luxury textiles', category:'Luxury', basePrice:900},
		{name:'Machine parts', category:'Industrial', basePrice:1100}, {name:'Microelectronics', category:'Technology', basePrice:3200},
		{name:'Reactor feedstock', category:'Energy', basePrice:1800}, {name:'Water and ice', category:'Bulk', basePrice:80},
		{name:'Cultural artifacts', category:'Cultural', basePrice:2100}, {name:'Rare earths', category:'Mineral', basePrice:2600},
		{name:'Synthetic proteins', category:'Food', basePrice:400}, {name:'Farm equipment', category:'Industrial', basePrice:700},
		{name:'Ship components', category:'Technology', basePrice:5000}, {name:'Civilian drones', category:'Technology', basePrice:2900},
		{name:'Biotech cultures', category:'Biological', basePrice:3400}, {name:'Perfumes and stimulants', category:'Luxury', basePrice:1250},
		{name:'Bulk ceramics', category:'Industrial', basePrice:260}, {name:'Textbooks and data', category:'Cultural', basePrice:600},
		{name:'Survey instruments', category:'Technology', basePrice:2250}, {name:'Construction polymers', category:'Industrial', basePrice:500},
		{name:'Antique machinery', category:'Salvage', basePrice:2800}, {name:'Pretech fragments', category:'Salvage', basePrice:7500},
		{name:'Seed stock', category:'Agricultural', basePrice:700}, {name:'Fabrics and clothing', category:'Consumer', basePrice:300},
		{name:'Security equipment', category:'Restricted', basePrice:1900}, {name:'Art and entertainment', category:'Cultural', basePrice:450}
	];

	Tools.generateMarkets = function(sector) {
		var markets = [];
		(sector.systems || []).forEach(function(system) {
			(system.planets || []).forEach(function(planet) {
				var goods = shuffled(Tools.TRADE_GOODS).slice(0, 8).map(function(good) {
					var supply = pick(['surplus', 'surplus', 'available', 'available', 'shortage', 'rare']);
					var range = supply === 'surplus' ? [45, 80] : supply === 'available' ? [85, 115] : supply === 'shortage' ? [125, 175] : [180, 260];
					var index = int(range[0], range[1]);
					return {name:good.name, category:good.category, basePrice:good.basePrice, supply:supply, priceIndex:index, localPrice:Math.round(good.basePrice * index / 100), note:pick(['Reliable contracts', 'Seasonal fluctuation', 'Customs scrutiny', 'Middlemen dominate distribution', 'Unstable transport insurance', 'Quality varies by district'])};
				});
				var traits = [];
				if (planet.tag1) traits.push(planet.tag1);
				if (planet.tag2) traits.push(planet.tag2);
				markets.push({id:'MARKET-' + String(markets.length + 1).padStart(3, '0'), systemId:system.id, planetId:planet.id, systemName:system.name, planetName:planet.name, techLevel:planet.techLevel, population:planet.population, traits:traits, profile:pick(['Frontier depot', 'Industrial exchange', 'Luxury market', 'Agrarian exporter', 'Salvage bazaar', 'Transit hub', 'Regulated port', 'Informal bazaar']), friction:int(0, 6), goods:goods});
			});
		});
		return markets;
	};


	Tools.DIPLOMACY_STATES = ['Alliance', 'Trade pact', 'Neutral', 'Strained', 'Rivalry', 'Open conflict'];
	Tools.FACTION_COLORS = ['#70e0cf', '#e6bd83', '#a7a7ff', '#e78eab', '#8bb4ef', '#b4db85', '#d6a4f2', '#f0a878'];

	Tools.generateDiplomacy = function(sector) {
		var factions = sector.factions || [], relations = [];
		for (var i = 0; i < factions.length; i++) for (var j = i + 1; j < factions.length; j++) {
			var a = factions[i], b = factions[j];
			var rival = (a.rivals || []).indexOf(b.id) >= 0 || (b.rivals || []).indexOf(a.id) >= 0;
			var state = rival ? 'Rivalry' : (Math.random() < .18 ? 'Trade pact' : 'Neutral');
			relations.push({id:'DIP-' + a.id + '-' + b.id, factionAId:a.id, factionBId:b.id, state:state,
				trust:state === 'Trade pact' ? int(1, 3) : (rival ? int(-4, -1) : int(-1, 1)),
				tension:rival ? int(4, 6) : int(1, 3), lastEvent:'Initial diplomatic posture'});
		}
		sector.diplomacy = relations;
		return relations;
	};

	Tools.ensureDiplomacy = function(sector) {
		var factions = sector.factions || [];
		sector.diplomacy = Array.isArray(sector.diplomacy) ? sector.diplomacy : [];
		var seen = new Set(sector.diplomacy.map(function(r) { return [r.factionAId, r.factionBId].sort().join('|'); }));
		for (var i = 0; i < factions.length; i++) for (var j = i + 1; j < factions.length; j++) {
			var key = [factions[i].id, factions[j].id].sort().join('|');
			if (!seen.has(key)) {
				var rivals = (factions[i].rivals || []).indexOf(factions[j].id) >= 0 || (factions[j].rivals || []).indexOf(factions[i].id) >= 0;
				sector.diplomacy.push({id:'DIP-' + key.replace('|','-'), factionAId:factions[i].id, factionBId:factions[j].id,
					state:rivals?'Rivalry':'Neutral', trust:rivals?-2:0, tension:rivals?4:2, lastEvent:'Relationship initialized'});
			}
		}
		sector.diplomacy = sector.diplomacy.filter(function(r) { return factions.some(function(f){return f.id===r.factionAId;}) && factions.some(function(f){return f.id===r.factionBId;}); });
		return sector.diplomacy;
	};

	Tools.cycleDiplomacy = function(sector, relation) {
		if (!relation) return;
		var states = Tools.DIPLOMACY_STATES, index = states.indexOf(relation.state);
		relation.state = states[(index + 1 + states.length) % states.length];
		relation.lastEvent = 'Diplomatic posture changed by the referee';
		relation.trust = Math.max(-6, Math.min(6, Number(relation.trust || 0) + (relation.state === 'Alliance' ? 2 : relation.state === 'Rivalry' || relation.state === 'Open conflict' ? -2 : 0)));
		relation.tension = Math.max(0, Math.min(10, relation.state === 'Alliance' || relation.state === 'Trade pact' ? Number(relation.tension || 0)-2 : relation.state === 'Open conflict' ? Number(relation.tension || 0)+3 : Number(relation.tension || 0)));
		var a=(sector.factions||[]).find(function(f){return f.id===relation.factionAId;}), b=(sector.factions||[]).find(function(f){return f.id===relation.factionBId;});
		if (a && b) {
			a.rivals=Array.isArray(a.rivals)?a.rivals:[]; b.rivals=Array.isArray(b.rivals)?b.rivals:[];
			if (relation.state==='Rivalry'||relation.state==='Open conflict') { if(a.rivals.indexOf(b.id)<0)a.rivals.push(b.id);if(b.rivals.indexOf(a.id)<0)b.rivals.push(a.id); }
			else if (relation.state==='Alliance'||relation.state==='Trade pact'||relation.state==='Neutral') { a.rivals=a.rivals.filter(function(id){return id!==b.id;});b.rivals=b.rivals.filter(function(id){return id!==a.id;}); }
		}
		return relation;
	};

	Tools.recalculateInfluence = function(sector) {
		var factions=sector.factions||[], systems=sector.systems||[];
		factions.forEach(function(faction,i){faction.color=faction.color||Tools.FACTION_COLORS[i%Tools.FACTION_COLORS.length];});
		var colorByFaction={};factions.forEach(function(f){colorByFaction[f.id]=f.color;});
		systems.forEach(function(system){
			var scores={};
			factions.forEach(function(faction){
				var score=system.id===faction.homeworldSystemId?5:0;
				if(system.manualControllerFactionId===faction.id)score+=100;
				(faction.assets||[]).forEach(function(asset){if(asset.locationSystemId!==system.id)return;if(asset.active===false)return;
					if(asset.isBase||asset.type==='Base of Influence')score+=4;
					else if(/trade exchange|industrial combine|logistics network/i.test(asset.name||''))score+=2;
					else score+=1;
				});
				if(score>0)scores[faction.id]=score;
			});
			var entries=Object.keys(scores).map(function(id){var faction=factions.find(function(f){return f.id===id;});return {factionId:id,factionName:faction?faction.name:id,score:scores[id],color:colorByFaction[id]||'#70e0cf'};}).sort(function(a,b){return b.score-a.score;});
			system.factionInfluence=entries;
			var first=entries[0],second=entries[1];
			if(first&&(!second||first.score>second.score)){
				system.controllingFactionId=first.factionId;system.controllingFactionName=first.factionName;system.controllingFactionColor=first.color;system.isContested=false;
			}else if(first&&second&&first.score===second.score){system.controllingFactionId='';system.controllingFactionName='Contested';system.controllingFactionColor='#e6bd83';system.isContested=true;}
			else{system.controllingFactionId='';system.controllingFactionName='Independent';system.controllingFactionColor='';system.isContested=false;}
		});
		return systems;
	};

	Tools.linkCampaignRecords = function(sector) {
		var systems=sector.systems||[], factions=sector.factions||[], markets=sector.markets||[], corps=sector.corporations||[];
		var systemById=new Map(systems.map(function(sys){return [sys.id,sys];}));
		var planetById=new Map();systems.forEach(function(sys){(sys.planets||[]).forEach(function(p){planetById.set(p.id,{system:sys,planet:p});});});
		markets.forEach(function(market,i){
			var pair=planetById.get(market.planetId);
			if(!pair && systems.length){var fallback=systems.find(function(sys){return sys.id===market.systemId;})||systems[i%systems.length];pair={system:fallback,planet:(fallback.planets||[])[0]};if(pair.planet)market.planetId=pair.planet.id;market.systemId=fallback.id;}
			if(pair){market.systemId=pair.system.id;market.systemName=pair.system.name;market.planetId=pair.planet.id;market.planetName=pair.planet.name;market.techLevel=pair.planet.techLevel;market.population=pair.planet.population;}
			market.goods=Array.isArray(market.goods)?market.goods:[];
		});
		corps.forEach(function(corp,i){if(!corp.id)corp.id='CORP-'+String(i+1).padStart(3,'0');corp.linkedMarketIds=Array.isArray(corp.linkedMarketIds)?corp.linkedMarketIds:[];});
		if(!Array.isArray(sector.corporationMarketLinks)) {
			sector.corporationMarketLinks=[];
			if(markets.length&&corps.length) markets.forEach(function(market,i){
				var main=corps[i%corps.length];sector.corporationMarketLinks.push({id:'COM-LINK-'+String(sector.corporationMarketLinks.length+1).padStart(4,'0'),corporationId:main.id,marketId:market.id,systemId:market.systemId,planetId:market.planetId,relationship:'Commercial presence',stake:int(1,4)});
				if(i%5===0&&corps.length>1){var secondary=corps[(i+7)%corps.length];sector.corporationMarketLinks.push({id:'COM-LINK-'+String(sector.corporationMarketLinks.length+1).padStart(4,'0'),corporationId:secondary.id,marketId:market.id,systemId:market.systemId,planetId:market.planetId,relationship:'Secondary contract',stake:int(1,2)});}
			});
		}
		sector.corporationMarketLinks=sector.corporationMarketLinks.filter(function(link){return corps.some(function(c){return c.id===link.corporationId;})&&markets.some(function(m){return m.id===link.marketId;});});
		corps.forEach(function(corp){corp.linkedMarketIds=[];});
		markets.forEach(function(market){market.linkedCorporationIds=[];});
		sector.corporationMarketLinks.forEach(function(link){var corp=corps.find(function(c){return c.id===link.corporationId;}),market=markets.find(function(m){return m.id===link.marketId;});if(corp&&market){if(corp.linkedMarketIds.indexOf(market.id)<0)corp.linkedMarketIds.push(market.id);if(market.linkedCorporationIds.indexOf(corp.id)<0)market.linkedCorporationIds.push(corp.id);link.systemId=market.systemId;link.planetId=market.planetId;}});
		markets.forEach(function(market){
			var sys=systemById.get(market.systemId);market.routeIds=[];
			(sector.tradeRoutes||[]).forEach(function(route){if(route.fromSystemId===market.systemId||route.toSystemId===market.systemId)market.routeIds.push(route.id);});
			market.routeAccess=market.routeIds.length;market.controlFactionId=sys&&sys.controllingFactionId||'';market.controlFactionName=sys&&sys.controllingFactionName||'Independent';
			market.stability=market.routeAccess>=2?'Well connected':(market.routeAccess===1?'Connected':'Isolated');
			market.friction=Math.max(0,Math.min(10,Number(market.friction||0)));
		});
		// Keep all asset placements tied to stable system IDs; the visible label is derived from the record.
		factions.forEach(function(faction){(faction.assets||[]).forEach(function(asset){var sys=systemById.get(asset.locationSystemId);if(!sys&&asset.location){sys=systems.find(function(s){return s.name===asset.location;});if(sys)asset.locationSystemId=sys.id;}if(sys)asset.location=sys.name;asset.ownerFactionId=faction.id;});});
		return sector;
	};

	Tools.updateMarkets = function(sector, turnNumber) {
		Tools.recalculateInfluence(sector);
		var markets=sector.markets||[], routes=sector.tradeRoutes||[], links=sector.corporationMarketLinks||[];
		markets.forEach(function(market){
			var routeCount=routes.filter(function(r){return r.kind==='trade'&&(r.fromSystemId===market.systemId||r.toSystemId===market.systemId);}).length;
			var corporateCount=links.filter(function(link){return link.marketId===market.id;}).length;
			var system=(sector.systems||[]).find(function(s){return s.id===market.systemId;});
			var influence=system&&system.factionInfluence||[];var conflict=(sector.diplomacy||[]).some(function(rel){return (rel.state==='Open conflict'||rel.state==='Rivalry')&&influence.some(function(inf){return inf.factionId===rel.factionAId;})&&influence.some(function(inf){return inf.factionId===rel.factionBId;});});
			market.routeAccess=routeCount;market.corporatePresence=corporateCount;market.controlFactionId=system&&system.controllingFactionId||'';market.controlFactionName=system&&system.controllingFactionName||'Independent';
			market.tradeVolume=Math.max(0,routeCount*10+corporateCount*4-(Number(market.friction||0)*2));
			market.stability=conflict?'Disrupted':(routeCount>=2?'Well connected':routeCount===1?'Connected':'Isolated');
			(market.goods||[]).forEach(function(good){
				var oldPrice=Number(good.priceIndex||100), price=oldPrice, drift=int(-6,6), bonus=(routeCount>0?-2:2)+(corporateCount>1?-1:0)+(conflict?5:0)+(market.controlFactionId? -1:0);
				price=Math.round(Math.max(40,Math.min(300,price+drift+bonus)));
				good.priceIndex=price;good.localPrice=Math.max(1,Math.round(Number(good.basePrice||0)*price/100));
				good.supply=price<80?'surplus':price<120?'available':price<180?'shortage':'rare';
				good.trend=price>oldPrice?'Rising':price<oldPrice?'Falling':'Stable';
				good.previousPriceIndex=oldPrice;
			});
			market.lastUpdatedTurn=Number(turnNumber||sector.factionTurn||0);
		});
		return markets;
	};

 	Tools.ASSET_CATALOG = [
		{name:'Frontier Militia', stat:'force', type:'Military Unit', minimumRating:1, cost:3, hp:6, maintenance:1, minTech:0, attackStat:'force', defenseStat:'force', attackDamage:'1d6', counterattackDamage:'1d4', stealth:false},
		{name:'Security Detachment', stat:'force', type:'Military Unit', minimumRating:1, cost:2, hp:5, maintenance:1, minTech:0, attackStat:'force', defenseStat:'cunning', attackDamage:'1d4+1', counterattackDamage:'1d4', stealth:false},
		{name:'Patrol Flotilla', stat:'force', type:'Starship', minimumRating:2, cost:4, hp:7, maintenance:1, minTech:4, attackStat:'force', defenseStat:'force', attackDamage:'1d6+1', counterattackDamage:'1d4', stealth:false},
		{name:'Intelligence Cell', stat:'cunning', type:'Special Forces', minimumRating:1, cost:2, hp:4, maintenance:1, minTech:0, attackStat:'cunning', defenseStat:'cunning', attackDamage:'1d6', counterattackDamage:'1d4-1', stealth:true},
		{name:'Propaganda Network', stat:'cunning', type:'Tactic', minimumRating:1, cost:2, hp:4, maintenance:0, minTech:0, attackStat:'cunning', defenseStat:'wealth', attackDamage:'1d4', counterattackDamage:'0', stealth:false},
		{name:'Diplomatic Mission', stat:'cunning', type:'Special', minimumRating:1, cost:2, hp:5, maintenance:0, minTech:0, attackStat:null, defenseStat:'cunning', attackDamage:'0', counterattackDamage:'0', stealth:false},
		{name:'Trade Exchange', stat:'wealth', type:'Facility', minimumRating:1, cost:2, hp:4, maintenance:0, minTech:0, attackStat:'wealth', defenseStat:'wealth', attackDamage:'1d4', counterattackDamage:'1d4-1', income:1, stealth:false},
		{name:'Industrial Combine', stat:'wealth', type:'Facility', minimumRating:2, cost:4, hp:8, maintenance:1, minTech:3, attackStat:null, defenseStat:'wealth', attackDamage:'0', counterattackDamage:'1d4', income:2, stealth:false},
		{name:'Logistics Network', stat:'wealth', type:'Facility', minimumRating:1, cost:3, hp:6, maintenance:0, minTech:0, attackStat:null, defenseStat:'wealth', attackDamage:'0', counterattackDamage:'1d4', income:1, stealth:false},
		{name:'Research Enclave', stat:'wealth', type:'Facility', minimumRating:2, cost:3, hp:5, maintenance:1, minTech:2, attackStat:null, defenseStat:'wealth', attackDamage:'0', counterattackDamage:'0', income:0, stealth:false}
	];

	Tools.createAsset = function(faction, template, system, serial, readyOnTurn) {
		return {
			id:'ASSET-' + faction.id + '-' + String(serial || 1).padStart(2, '0'), ownerFactionId:faction.id,
			name:template.name, type:template.type, stat:template.stat, rating:Math.max(0, Number(faction[template.stat] || 0)),
			minimumRating:template.minimumRating || 1, cost:template.cost || 0,
			hp:template.hp || 4, maxHp:template.hp || 4, maintenance:template.maintenance || 0,
			minTech:template.minTech || 0, attackStat:template.attackStat || '', defenseStat:template.defenseStat || template.stat,
			attackDamage:template.attackDamage || '0', counterattackDamage:template.counterattackDamage || '0',
			income:template.income || 0, locationSystemId:system ? system.id : '', location:system ? system.name : 'Unplaced',
			stealthed:!!template.stealth, active:readyOnTurn === undefined || readyOnTurn <= 0,
			readyOnTurn:readyOnTurn || 0, missedMaintenance:0, isBase:template.type === 'Base of Influence',
			notes:template.notes || ''
		};
	};

	Tools.generateFactions = function(sector, count) {
		var systems = (sector.systems || []).filter(function(s) { return (s.planets || []).length; });
		var names = [];
		(sector.politicalGroups || []).forEach(function(x) { if (x.name) names.push(x.name); });
		(sector.corporations || []).forEach(function(x) { if (x.name) names.push(x.name); });
		(sector.religions || []).forEach(function(x) { if (x.name) names.push(x.name); });
		var factionCount = Math.max(2, Math.min(count || Math.ceil(systems.length / 4) || 2, 8));
		var tiers = [
			{name:'Minor power', primary:4, hp:15, assets:2},
			{name:'Established power', primary:6, hp:29, assets:4},
			{name:'Regional hegemon', primary:8, hp:49, assets:8}
		];
		var primary = ['force', 'cunning', 'wealth'];
		var types = ['Planetary government', 'Trade combine', 'Intelligence service', 'Mercenary league', 'Religious movement', 'Frontier coalition', 'Research directorate', 'Free-trader network', 'Colonial authority', 'Veteran diaspora'];
		var goals = ['Expand influence along a trade corridor', 'Remove a rival from a strategic world', 'Gain control of a vital resource', 'Protect a threatened client system', 'Expose a concealed conspiracy', 'Secure recognition as a legitimate government', 'Recover an abandoned pretech facility', 'Prevent a neighboring power from expanding'];
		var factions = [];
		for (var i = 0; i < factionCount; i++) {
			var tier = tiers[i === 0 ? 1 : (i % 7 === 0 ? 2 : 0)];
			var main = pick(primary);
			var remaining = shuffled(primary.filter(function(k) { return k !== main; }));
			var values = {}; values[main] = tier.primary; values[remaining[0]] = Math.max(1, tier.primary - 1); values[remaining[1]] = Math.max(1, tier.primary - 3);
			var home = systems.length ? systems[i % systems.length] : null;
			var name = names.length ? names[(i * 3) % names.length] : pick(['Meridian', 'Ashfall', 'Peregrine', 'Cinder', 'Halcyon', 'Farstar', 'Argent', 'Duskline']) + ' ' + pick(types);
			var faction = {
				id:'FACTION-' + String(i + 1).padStart(2, '0'), name:name, type:pick(types), scale:tier.name,
				homeworldSystemId:home ? home.id : '', homeworld:home ? home.name : 'Unplaced',
				force:values.force, cunning:values.cunning, wealth:values.wealth,
				hitPoints:tier.hp, maxHitPoints:tier.hp, factionCredits:int(2, 8), experience:0,
				primaryRating:main, goal:pick(goals), tag:pick(['ambitious','secretive','warlike','plutocratic','zealous','technically adept','fragmented','reluctant']),
				assets:[], progress:0, tension:int(1, 6), lastAction:'Awaiting first faction turn', turnLog:[]
			};
			var baseTemplate = {name:'Base of Influence', stat:'cunning', type:'Base of Influence', minimumRating:0, cost:tier.hp, hp:tier.hp, maintenance:0, minTech:0, attackStat:null, defenseStat:'cunning', attackDamage:'0', counterattackDamage:'0', stealth:false};
			var base = Tools.createAsset(faction, baseTemplate, home, 1, 0);
			base.isBase = true;
			faction.assets.push(base);
			for (var a = 0; a < tier.assets; a++) {
				var eligible = Tools.ASSET_CATALOG.filter(function(t) { return Number(faction[t.stat] || 0) >= Number(t.minimumRating || 1); });
				if (!eligible.length) eligible = Tools.ASSET_CATALOG;
				var template = pick(eligible);
				var location = systems.length ? systems[(i + a) % systems.length] : home;
				var asset = Tools.createAsset(faction, template, location, a + 2, 0);
				if (Math.random() < 0.12) asset.stealthed = true;
				faction.assets.push(asset);
			}
			faction.rivals = [];
			factions.push(faction);
		}
		factions.forEach(function(faction, index) {
			faction.rivals = factions.filter(function(other, otherIndex) { return otherIndex !== index && Math.abs(otherIndex - index) <= 2 && Math.random() < 0.5; }).map(function(other) { return other.id; });
		});
		return factions;
	};

	Tools.rollDamage = function(expression) {
		var match = String(expression || '0').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
		if (!match) return Math.max(0, Number(expression) || 0);
		var count = Math.max(1, Number(match[1]));
		var sides = Math.max(1, Number(match[2]));
		var modifier = Number(match[3] || 0);
		var total = modifier;
		for (var i = 0; i < count; i++) total += int(1, sides);
		return Math.max(0, total);
	};

	Tools.advanceFactionTurn = function(sector) {
		var events = [];
		var factions = (sector.factions || []).slice();
		var systems = sector.systems || [];
		if (!factions.length) { sector.factionTurn = Number(sector.factionTurn || 0) + 1; sector.factionNews = []; Tools.recalculateInfluence(sector); Tools.linkCampaignRecords(sector); Tools.updateMarkets(sector, sector.factionTurn); return []; }
		Tools.ensureDiplomacy(sector);
		var turn = Number(sector.factionTurn || 0) + 1;
		// Randomized cyclic initiative, mirroring the faction-turn order procedure.
		var start = int(0, factions.length - 1);
		factions = factions.slice(start).concat(factions.slice(0, start));
		function statValue(faction, stat) { return Math.max(0, Number(faction[stat] || 0)); }
		function rollDie(sides) { return int(1, sides); }
		function findSystem(id) { return systems.find(function(system) { return system.id === id; }) || null; }
		function event(faction, action, result, detail, extra) {
			var entry = Object.assign({turn:turn, factionId:faction.id, factionName:faction.name, action:action, result:result, event:detail, systemName:faction.homeworld || 'Unknown', systemId:faction.homeworldSystemId || ''}, extra || {});
			faction.turnLog = Array.isArray(faction.turnLog) ? faction.turnLog : [];
			faction.turnLog.unshift(entry); faction.turnLog = faction.turnLog.slice(0, 8); events.push(entry); return entry;
		}
		function removeAsset(faction, asset, reason) {
			faction.assets = (faction.assets || []).filter(function(a) { return a.id !== asset.id; });
			if (asset.isBase) faction.hitPoints = Math.max(0, Number(faction.hitPoints || 0) - Number(asset.hp || 0));
			return reason || 'The asset was lost.';
		}
		function damageAsset(owner, asset, amount) {
			amount = Math.max(0, Number(amount) || 0);
			asset.hp = Math.max(0, Number(asset.hp || 0) - amount);
			if (asset.isBase) owner.hitPoints = Math.max(0, Number(owner.hitPoints || 0) - amount);
			if (asset.hp <= 0) return removeAsset(owner, asset, asset.name + ' was destroyed.');
			return asset.name + ' took ' + amount + ' damage (' + asset.hp + '/' + asset.maxHp + ' HP remain).';
		}
		factions.forEach(function(faction) {
			faction.assets = Array.isArray(faction.assets) ? faction.assets : [];
			// Start-of-turn FacCred income, then mandatory maintenance.
			var income = Math.ceil(statValue(faction, 'wealth') / 2) + Math.floor((statValue(faction, 'force') + statValue(faction, 'cunning')) / 4);
			faction.factionCredits = Math.max(0, Math.min(999, Number(faction.factionCredits || 0) + income));
			var maintenancePaid = 0, maintenanceSkipped = 0, lostToMaintenance = [];
			faction.assets.slice().forEach(function(asset) {
				if (Number(asset.readyOnTurn || 0) > turn) return;
				asset.active = true;
				var upkeep = Math.max(0, Number(asset.maintenance || 0));
				if (!upkeep) { asset.missedMaintenance = 0; return; }
				if (faction.factionCredits >= upkeep) {
					faction.factionCredits -= upkeep; maintenancePaid += upkeep; asset.missedMaintenance = 0; asset.active = true;
				} else {
					asset.active = false; asset.missedMaintenance = Number(asset.missedMaintenance || 0) + 1; maintenanceSkipped++;
					if (asset.missedMaintenance >= 2) { removeAsset(faction, asset, 'Maintenance default'); lostToMaintenance.push(asset.name); }
				}
			});
			if (lostToMaintenance.length) event(faction, 'Maintenance', 'Loss', lostToMaintenance.join(', ') + ' lost after two missed maintenance payments.');
			var usable = faction.assets.filter(function(asset) { return asset.active !== false && Number(asset.readyOnTurn || 0) <= turn; });
			var attacks = [];
			usable.forEach(function(asset) {
				if (!asset.attackStat) return;
				factions.forEach(function(defender) {
					if (defender.id === faction.id) return;
					(defender.assets || []).forEach(function(target) {
						if (target.active === false || target.stealthed || Number(target.readyOnTurn || 0) > turn) return;
						if (target.locationSystemId && target.locationSystemId === asset.locationSystemId) attacks.push({asset:asset, defender:defender, target:target});
					});
				});
			});
			var damaged = usable.filter(function(asset) { return Number(asset.hp) < Number(asset.maxHp); });
			var buyable = Tools.ASSET_CATALOG.filter(function(template) {
				return statValue(faction, template.stat) >= Number(template.minimumRating || 1) && Number(faction.factionCredits) >= Number(template.cost || 0);
			});
			var incomeAssets = usable.filter(function(asset) { return Number(asset.income || 0) > 0; });
			var expandableSystems = systems.filter(function(system) {
				var hasPresence = (faction.assets || []).some(function(asset) { return asset.locationSystemId === system.id && !asset.isBase; });
				var hasBase = (faction.assets || []).some(function(asset) { return asset.locationSystemId === system.id && asset.isBase; });
				return hasPresence && !hasBase && Number(faction.factionCredits) >= 1;
			});
			var actionOptions = [];
			if (attacks.length) actionOptions.push('attack', 'attack');
			if (damaged.length && faction.factionCredits >= 1) actionOptions.push('repair');
			if (buyable.length) actionOptions.push('buy');
			if (expandableSystems.length) actionOptions.push('expand');
			if (incomeAssets.length) actionOptions.push('income');
			actionOptions.push('diplomacy');
			var action = pick(actionOptions);
			var home = findSystem(faction.homeworldSystemId) || pick(systems);
			if (action === 'attack' && attacks.length) {
				var engagement = pick(attacks), attacker = engagement.asset, defender = engagement.defender, target = engagement.target;
				var attackRoll = rollDie(10) + statValue(faction, attacker.attackStat);
				var defenseStat = target.defenseStat || target.stat || 'force';
				var defenseRoll = rollDie(10) + statValue(defender, defenseStat);
				var resultParts = [];
				if (attackRoll >= defenseRoll) {
					var inflicted = Tools.rollDamage(attacker.attackDamage);
					resultParts.push('Attack roll ' + attackRoll + ' vs ' + defenseRoll + ': ' + damageAsset(defender, target, inflicted));
				}
				// A tie means both attacks land; a defender win triggers only its counterattack.
				if (attackRoll <= defenseRoll) {
					var counter = Tools.rollDamage(target.counterattackDamage);
					if (counter > 0) resultParts.push('Counterattack: ' + damageAsset(faction, attacker, counter));
				}
				faction.lastAction = 'Attacked ' + target.name + ' at ' + (attacker.location || 'an unknown location');
				event(faction, 'Attack', attackRoll === defenseRoll ? 'Mutual damage' : (attackRoll > defenseRoll ? 'Success' : 'Counterattack'), resultParts.join(' '), {roll:attackRoll, opposingRoll:defenseRoll, targetFactionId:defender.id, targetFactionName:defender.name, systemId:attacker.locationSystemId, systemName:attacker.location});
			} else if (action === 'repair' && damaged.length) {
				var repairTarget = pick(damaged);
				var repairStat = repairTarget.stat || 'wealth';
				var repairRating = Math.max(1, statValue(faction, repairStat));
				var restored = Math.min(repairRating, Number(repairTarget.maxHp) - Number(repairTarget.hp));
				faction.factionCredits -= 1; repairTarget.hp += restored; if (repairTarget.isBase) faction.hitPoints = Math.min(Number(faction.maxHitPoints || faction.hitPoints), Number(faction.hitPoints || 0) + restored);
				faction.lastAction = 'Repaired ' + repairTarget.name;
				event(faction, 'Repair', 'Recovered', repairTarget.name + ' restored by ' + restored + ' HP for 1 FacCred.', {systemId:repairTarget.locationSystemId, systemName:repairTarget.location});
			} else if (action === 'buy' && buyable.length) {
				var template = pick(buyable); var location = home;
				if (!location) location = findSystem(faction.homeworldSystemId);
				faction.factionCredits -= Number(template.cost || 0);
				var nextId = faction.assets.reduce(function(max, asset) { var match = String(asset.id).match(/-(\d+)$/); return Math.max(max, match ? Number(match[1]) : 0); }, 0) + 1;
				var newAsset = Tools.createAsset(faction, template, location, nextId, turn + 1);
				newAsset.active = false; faction.assets.push(newAsset);
				faction.lastAction = 'Purchased ' + template.name;
				event(faction, 'Buy asset', 'Commissioned', template.name + ' commissioned at ' + (location ? location.name : 'an unplaced location') + '; it becomes active next turn.', {systemId:location ? location.id : '', systemName:location ? location.name : 'Unplaced'});
			} else if (action === 'expand' && expandableSystems.length) {
				var destination = pick(expandableSystems);
				var baseHp = Math.min(4, Math.max(1, Number(faction.maxHitPoints || 1)));
				var baseCost = baseHp; if (faction.factionCredits < baseCost) { baseHp = Math.max(1, Math.min(2, Number(faction.factionCredits))); baseCost = baseHp; }
				faction.factionCredits -= baseCost;
				var baseAsset = Tools.createAsset(faction, {name:'Base of Influence', stat:'cunning', type:'Base of Influence', minimumRating:0, cost:baseCost, hp:baseHp, maintenance:0, minTech:0, defenseStat:'cunning', attackDamage:'0', counterattackDamage:'0'}, destination, faction.assets.reduce(function(max, asset) { var match = String(asset.id).match(/-(\d+)$/); return Math.max(max, match ? Number(match[1]) : 0); }, 0) + 1, turn + 1);
				baseAsset.isBase = true; baseAsset.active = false; faction.assets.push(baseAsset);
				faction.lastAction = 'Expanded influence to ' + destination.name;
				event(faction, 'Expand influence', 'Established', 'A new Base of Influence is being established at ' + destination.name + ' (' + baseHp + ' HP).', {systemId:destination.id, systemName:destination.name});
			} else if (action === 'income' && incomeAssets.length) {
				var incomeAsset = pick(incomeAssets);
				var gained = Math.max(1, Number(incomeAsset.income || 1) + rollDie(3) - 1);
				faction.factionCredits = Math.min(999, Number(faction.factionCredits || 0) + gained);
				faction.lastAction = 'Activated ' + incomeAsset.name;
				event(faction, 'Use asset ability', 'Income', incomeAsset.name + ' generated ' + gained + ' additional FacCreds.', {systemId:incomeAsset.locationSystemId, systemName:incomeAsset.location});
			} else {
				var stat = faction.primaryRating || 'cunning';
				var roll = rollDie(10) + statValue(faction, stat);
				var success = roll >= 10;
				if (success) { faction.progress = Math.min(100, Number(faction.progress || 0) + int(1, 3)); faction.tension = Math.max(0, Number(faction.tension || 0) - 1); }
				else faction.tension = Math.min(10, Number(faction.tension || 0) + 1);
				faction.lastAction = success ? 'Advanced its goal through diplomacy' : 'Hit a diplomatic or political setback';
				event(faction, 'Pursue goal', success ? 'Success' : 'Setback', success ? 'It advances its agenda: ' + faction.goal + '.' : 'Its effort to ' + faction.goal.toLowerCase() + ' meets resistance.', {roll:roll, systemId:home ? home.id : '', systemName:home ? home.name : 'Unknown'});
			}
			faction.turnLog = Array.isArray(faction.turnLog) ? faction.turnLog : [];
			faction.lastIncome = income; faction.lastMaintenancePaid = maintenancePaid; faction.lastMaintenanceSkipped = maintenanceSkipped;
		});
		sector.factionTurn = turn;
		sector.factionNews = events.slice(0, 16);
		Tools.recalculateInfluence(sector);
		Tools.linkCampaignRecords(sector);
		Tools.updateMarkets(sector, turn);
		return events;
	};

	Tools.generateAdventureSeeds = function(sector, count) {
		var worlds = [];
		(sector.systems || []).forEach(function(system) { (system.planets || []).forEach(function(planet) { worlds.push({system:system, planet:planet}); }); });
		if (!worlds.length) return [];
		var seeds = [];
		var stakes = ['before the next supply convoy arrives', 'without revealing who hired them', 'while a political summit is underway', 'before the evidence is erased', 'without triggering an interstellar incident', 'while a local revolt is gathering force', 'before a rival crew reaches the site', 'with only one safe route off-world'];
		var twist = ['the apparent enemy is preventing a worse disaster', 'the patron has concealed a personal stake', 'the needed evidence is itself dangerous', 'the local authorities are divided', 'the reward is valuable to a second faction', 'the clock advances whenever the crew takes a long rest', 'the target has a legitimate claim to the object', 'an ally is feeding information to the opposition'];
		for (var i = 0; i < (count || 8); i++) {
			var pair = pick(worlds);
			var planet = pair.planet, system = pair.system;
			var tagA = WorldGenerator.tagDictionary.get(planet.tag1) || pick(WorldGenerator.tags);
			var tagB = WorldGenerator.tagDictionary.get(planet.tag2) || pick(WorldGenerator.tags);
			var enemy = pick(tagA.enemies.concat(tagB.enemies));
			var friend = pick(tagA.friends.concat(tagB.friends));
			var complication = pick(tagA.complications.concat(tagB.complications));
			var thing = pick(tagA.things.concat(tagB.things));
			var place = pick(tagA.places.concat(tagB.places));
			var seedType = pick(['Investigation', 'Extraction', 'Negotiation', 'Salvage', 'Smuggling', 'Protection', 'First contact', 'Heist', 'Rescue', 'Sabotage']);
			seeds.push({id:'ADVENTURE-' + String(i + 1).padStart(2, '0'), type:seedType, title:seedType + ': ' + (thing || place || planet.name), systemId:system.id, systemName:system.name, planetId:planet.id, planetName:planet.name, tags:[planet.tag1, planet.tag2], patron:friend, opposition:enemy, complication:complication, keyPlace:place, objective:pick(['recover', 'protect', 'expose', 'escort', 'destroy', 'negotiate for', 'smuggle', 'identify']) + ' ' + String(thing).toLowerCase(), hook:friend + ' approaches the crew on ' + planet.name + ' after a dispute involving ' + enemy.toLowerCase() + '.', stakes:'The crew must act ' + pick(stakes) + '.', twist:pick(twist), reward:pick(['cash and a trusted contact', 'access to restricted records', 'a share of recovered cargo', 'safe harbor and repairs', 'political leverage', 'a lead to a lost site', 'a favor from a powerful patron']), status:'Unplayed'});
		}
		return seeds;
	};

	Tools.generateThreats = function(sector, count) {
		var systems = sector.systems || [];
		var humanProfiles = [
			{name:'Dockside tough', hd:1, ac:12, atk:1, damage:'By weapon', morale:7, skill:1},
			{name:'Security officer', hd:1, ac:14, atk:1, damage:'By weapon', morale:8, skill:1},
			{name:'Veteran fighter', hd:2, ac:14, atk:2, damage:'By weapon +1', morale:9, skill:1},
			{name:'Elite operative', hd:3, ac:16, atk:4, damage:'By weapon +1', morale:10, skill:2},
			{name:'Gengineered killer', hd:4, ac:16, atk:5, damage:'By weapon +1', morale:10, skill:2},
			{name:'Sector legend', hd:6, ac:18, atk:8, damage:'By weapon +3', morale:11, skill:3}
		];
		var creatureRoles = ['ambush predator', 'territorial grazer', 'pack hunter', 'parasitoid', 'burrowing scavenger', 'apex aquatic predator', 'spore colony', 'electromagnetic feeder', 'ruin guardian', 'escaped gene-work'];
		var behaviors = ['stalks the most isolated target', 'defends a nesting or spawning site', 'mimics familiar signals to draw prey close', 'moves only during local nightfall', 'responds violently to a particular sound', 'avoids direct conflict until cornered', 'learns from failed encounters', 'is drawn to active power systems'];
		var names = ['Glassback', 'Cinder Maw', 'Needle Stalker', 'Vesper Grazer', 'Vault Warden', 'Red Tide', 'Hollow Runner', 'Static Bloom', 'Iron Mite', 'Ghost Hound', 'Lantern Brood', 'Silt Leviathan'];
		var threats = [];
		for (var i = 0; i < (count || 12); i++) {
			var roll = Math.random();
			var kind = roll < 0.38 ? 'Hostile human' : roll < 0.62 ? 'Virtual intelligence / robot' : 'Xenobeast';
			var profile;
			if (kind === 'Hostile human') {
				profile = Object.assign({}, pick(humanProfiles));
				profile.name = pick(['Insurgent', 'Privateer', 'Black-ops agent', 'Militia enforcer', 'Hired gun', 'Cult executioner', 'Rogue scout', 'Corporate recovery team']);
			} else if (kind === 'Virtual intelligence / robot') {
				var hd = int(1, 5);
				profile = {name:pick(['Maintenance VI', 'Perimeter drone', 'Custodian chassis', 'Sentry shell', 'Archive mind', 'Industrial walker']), hd:hd, ac:int(12, 18), atk:hd + int(0, 2), damage:pick(['1d6', '1d8', '2d6', 'By integrated weapon']), morale:int(8, 12), skill:int(1, 3)};
			} else {
				var hd = int(1, 6);
				profile = {name:pick(names), hd:hd, ac:int(10, 17), atk:hd + int(0, 2), damage:pick(['1d6', '1d8', '1d10', '2d6', '1d6 + venom']), morale:int(6, 11), skill:int(1, 3)};
			}
			var location = systems.length ? pick(systems) : null;
			var habitat = location && location.planets && location.planets.length ? pick(location.planets).name : (location ? location.name + ' orbital space' : 'Uncharted space');
			threats.push({id:'THREAT-' + String(i + 1).padStart(2, '0'), name:profile.name, kind:kind, role:kind === 'Xenobeast' ? pick(creatureRoles) : pick(['guard', 'hunter', 'saboteur', 'pursuer', 'gatekeeper', 'specialist']), locationSystemId:location ? location.id : '', location:habitat, hd:profile.hd, hp:rollHitPoints(profile.hd), ac:profile.ac, attackBonus:'+' + profile.atk, damage:profile.damage, move:'10m', morale:profile.morale, skillBonus:'+' + profile.skill, save:(15 - Math.floor(profile.hd / 2)) + '+', behavior:pick(behaviors), signature:pick(['keeps trophies from every encounter', 'wears a harmless-looking disguise', 'broadcasts a warning before attacking', 'has a weakness that careful observers can exploit', 'is pursuing a goal unrelated to the crew', 'guards a piece of evidence']), notes:'Generated game-ready scaffold; adjust armor, weapons, and special traits to the scene.'});
		}
		return threats;
	};
	function rollHitPoints(hd) { var total = 0; for (var i = 0; i < hd; i++) total += int(1, 8); return total; }

	Tools.generatePeople = function(sector, count) {
		var worlds = [];
		(sector.systems || []).forEach(function(system) { (system.planets || []).forEach(function(planet) { worlds.push({system:system, planet:planet}); }); });
		var roles = ['disgraced navigator', 'union organizer', 'frontier doctor', 'private investigator', 'salvage broker', 'exiled diplomat', 'cargo factor', 'former intelligence handler', 'ruin scholar', 'shipyard foreman', 'pilgrim-guide', 'independent fixer', 'local judge', 'retired marine'];
		var drives = ['wants to settle an old debt', 'is trying to protect a dependent', 'seeks proof of a hidden crime', 'needs a rare component immediately', 'wants revenge without starting a war', 'is concealing a dangerous mistake', 'needs outsiders to test a theory', 'is trying to buy a path off-world'];
		var mannerisms = ['answers questions with questions', 'checks every exit on entering a room', 'uses formal titles obsessively', 'collects obsolete transit tokens', 'never speaks first', 'is warm until challenged', 'records everything on paper', 'treats every meeting as a negotiation'];
		var people = [];
		for (var i = 0; i < (count || 10); i++) {
			var loc = worlds.length ? pick(worlds) : null;
			var role = pick(roles);
			var hd = pick([1,1,1,1,2,2,3,4]);
			people.push({id:'PERSON-' + String(i + 1).padStart(2, '0'), name:SWNNameGen.getName(), role:role, locationSystemId:loc ? loc.system.id : '', location:loc ? loc.planet.name : 'Uncharted space', motive:pick(drives), mannerism:pick(mannerisms), secret:pick(['owes money to a rival faction', 'has a second identity', 'knows the local customs officer', 'has concealed a dangerous piece of pretech', 'is genuinely innocent but looks guilty', 'is passing selective information to an unknown patron']), hd:hd, hp:rollHitPoints(hd), ac:pick([10,10,12,12,14,16]), attackBonus:'+' + hd, save:(15 - Math.floor(hd / 2)) + '+', status:'Available'});
		}
		return people;
	};

	Tools.generateSupplement = function(type, sector, targetId) {
		var systems = sector.systems || [];
		var worlds = [];
		systems.forEach(function(system) { (system.planets || []).forEach(function(planet) { worlds.push({system:system, planet:planet}); }); });
		var target = worlds.find(function(w) { return w.planet.id === targetId || w.system.id === targetId; }) || pick(worlds) || null;
		var targetName = target ? target.planet.name : (pick(systems) || {name:'the frontier'}).name;
		var systemName = target ? target.system.name : 'Uncharted system';
		var result = {id:'TOOL-' + Date.now() + '-' + int(100,999), module:type, generatedAt:new Date().toISOString(), targetSystemId:target ? target.system.id : '', targetPlanetId:target ? target.planet.id : '', target:targetName, system:systemName, title:'', summary:'', details:{}};
		var choose = function(a) { return pick(a); };
		switch(type) {
			case 'espionage':
				result.title = choose(['The Quiet Ledger', 'Nightglass Protocol', 'The Unasked Question', 'Dead Drop at Dawn', 'The Empty Embassy']);
				result.summary = 'A covert operation unfolds around ' + targetName + ' before a local crisis makes deniability impossible.';
				result.details = {agency:choose(['a treaty-monitoring office', 'a corporate counterintelligence bureau', 'a defunct Mandate listening post', 'a diaspora intelligence cell', 'a private security directorate']), objective:choose(['replace a forged record', 'identify a compromised courier', 'prevent a covert transfer', 'turn an enemy asset', 'recover an erased archive']), method:choose(['false-flag humanitarian aid', 'intercepted navigation data', 'a compromised public official', 'a dead-drop chain', 'an autonomous surveillance swarm']), target:choose(['a merchant prince', 'a frontier governor', 'a militant network', 'a research director', 'a religious envoy']), complication:choose(['two handlers have contradictory orders', 'the target has evidence of a larger conspiracy', 'an innocent intermediary is under surveillance', 'the operation is being copied by a rival service']), clock:'Each major delay lets the opposition remove one layer of evidence.'}; break;
			case 'merchant':
				var m1 = (sector.markets || []).find(function(m) { return m.planetId === (target && target.planet.id); }) || pick(sector.markets || []);
				var m2 = pick((sector.markets || []).filter(function(m) { return !m1 || m.id !== m1.id; })) || null;
				var good = m1 && m1.goods ? pick(m1.goods) : pick(Tools.TRADE_GOODS);
				result.title = 'Cargo run: ' + (good.name || 'high-value cargo');
				result.summary = 'A buyer on ' + (m2 ? m2.planetName : targetName) + ' needs a shipment currently obtainable near ' + (m1 ? m1.planetName : targetName) + '.';
				result.details = {cargo:good.name, category:good.category, localPrice:good.localPrice || good.basePrice, demand:choose(['urgent', 'quiet but reliable', 'politically sensitive', 'speculative', 'backed by a guarantor']), quantity:choose(['one sealed container', 'a light freighter’s hold', 'a full convoy allotment', 'one fragile research lot']), risk:choose(['customs inspection', 'pirate attention', 'contaminated storage', 'an embargo change', 'competing bidders', 'a dishonest factor']), complication:choose(['the buyer is a front for a third party', 'part of the cargo must be delivered off-manifest', 'the route crosses a disputed border', 'the local market collapses before arrival']), priceNote:'Local prices are creative estimates, not exact Suns of Gold rules.'}; break;
			case 'military':
				result.title = choose(['Operation Iron Lantern', 'The Long Supply Line', 'Blackwater Perimeter', 'Quiet Thunder', 'The Last Bridgehead']);
				result.summary = 'A military operation around ' + targetName + ' must succeed before the local situation becomes irreversible.';
				result.details = {objective:choose(['hold a landing zone', 'extract a cut-off unit', 'destroy a mobile logistics hub', 'secure a civilian evacuation corridor', 'locate an infiltrator', 'capture a communications node']), forceCondition:choose(['trained but undersupplied', 'numerically strong with poor morale', 'elite cadre with no replacement capacity', 'local militia split by politics', 'well-equipped but unfamiliar with terrain']), logistics:choose(['fuel is rationed', 'medical supplies are trapped behind a checkpoint', 'the only bridge is damaged', 'a convoy is late', 'orders rely on a vulnerable relay']), civilianStake:choose(['a populated settlement lies in the engagement zone', 'local leaders refuse evacuation', 'food distribution depends on the contested site', 'a neutral hospital is inside the perimeter']), twist:choose(['the enemy is also protecting civilians', 'command has hidden the true objective', 'the apparent supply failure is sabotage', 'the operation will expose an allied war crime'])}; break;
			case 'vehicle':
				var design = choose(['Mule-class cargo crawler', 'Needleback scout car', 'Bastion urban carrier', 'Pioneer survey rover', 'Warden patrol skimmer', 'Kestrel grav bike', 'Cicada utility walker', 'Ashline desert hauler']);
				var vehicleRole = choose(['frontier logistics', 'combat patrol', 'survey and rescue', 'smuggling', 'civil defence', 'remote exploration', 'hazard response', 'heavy construction']);
				var vehicleTech = target && target.planet && target.planet.techLevel ? target.planet.techLevel : 'unrestricted / GM-set';
				result.title = design;
				result.summary = 'An original vehicle-design prompt for ' + vehicleRole + ' near ' + targetName + '. Use its technology and local supply limits as campaign constraints, not as a published vehicle stat block.';
				result.details = {role:vehicleRole, localTechLevel:vehicleTech, chassis:choose(['reinforced wheeled frame', 'tracked low-pressure chassis', 'sealed pressure hull', 'light grav platform', 'articulated crawler', 'modular cargo sled', 'rugged all-terrain suspension']), propulsion:choose(['diesel-electric hybrid', 'compact fission plant', 'high-density battery pack', 'chemical rocket / thruster pack', 'grav lift and vector fans', 'fuel-cell drive', 'pedal / hand-crank fallback']), crew:choose(['single operator', 'driver plus one specialist', 'two-person crew', 'four-person crew', 'six-person crew']), capacity:choose(['two passengers and light kits', 'one tonne cargo', 'six passengers', 'a sensor mast and field lab', 'a weapon mount and spare ammunition', 'sealed medevac bay', 'two weeks of expedition supplies']), specialFit:choose(['terrain radar', 'modular armor plates', 'quiet-running motor', 'recovery winch', 'autonomous route planner', 'radiation shelter', 'field repair drone', 'long-range comms mast']), weakness:choose(['spare parts are proprietary', 'poor performance in deep mud', 'visible thermal signature', 'battery pack is difficult to replace', 'unreliable software after EMP exposure', 'overloaded suspension', 'loud drive train', 'needs a rare lubricant']), currentProblem:choose(['a key component is counterfeit', 'its last crew left an unexplained modification', 'a local authority has impounded the registration', 'the manufacturer issued a quiet recall', 'it carries a sensor log someone wants erased', 'it is stranded beyond the route map'])}; break;
			case 'character':
				var characterClass = choose(['Warrior', 'Expert', 'Psychic', 'Adventurer', 'Ship specialist', 'Frontier generalist']);
				result.title = SWNNameGen.getName() + ' — ' + characterClass;
				result.summary = 'An original character concept anchored to ' + targetName + '. This builds a playable starting dossier, not a complete rules-legal character sheet.';
				result.details = {archetype:characterClass, background:choose(['belter / spacer', 'colonial militia', 'corporate academy', 'dispossessed aristocracy', 'frontier clinic', 'merchant crew', 'religious community', 'research enclave', 'war refugee', 'licensed scavenger', 'station-born technician', 'world-hopping courier']), formativeEvent:choose(['survived a failed evacuation', 'was blamed for a mission that actually succeeded', 'inherited a debt and an encrypted map', 'served as a neutral negotiator during a riot', 'discovered their mentor was using a false identity', 'spent years in cryogenic transit', 'witnessed a first-contact incident', 'lost a home to a faction operation']), strongestCapability:choose(['combat discipline', 'social leverage', 'technical improvisation', 'field medicine', 'reconnaissance', 'navigation', 'investigation', 'psychic discipline', 'commerce', 'leadership']), signatureTechnique:choose(['turns old equipment into a one-use solution', 'can read a room before anyone speaks', 'memorizes routes after one passage', 'keeps a second plan and never explains it', 'builds trust with practical favors', 'recognizes military procedure by sound', 'finds the flaw in a complex system', 'uses an obsolete custom as cover']), definingTie:choose(['a sibling working for a rival faction', 'a patron who once saved their life', 'an ex-partner with a legal claim', 'a community that expects them to return', 'a former commander who wants silence', 'an AI that remembers a different version of events']), complication:choose(['their credentials are under review', 'their reputation was built on a misunderstanding', 'they carry evidence someone wants destroyed', 'they owe a favor to an unfriendly power', 'their safest ally is politically radioactive', 'a personal vow conflicts with the next job']), campaignUse:'Add skill levels, attributes, foci, equipment, and other mechanical choices using the books and house rules at your table.'}; break;
			case 'naval':
				result.title = choose(['Watch at the Veil', 'Patrol Group Meridian', 'The Fallow Transit', 'Silent Picket', 'Breakwater Squadron']);
				result.summary = 'A naval detachment is assigned to the approaches near ' + systemName + ', where mission and political reality are misaligned.';
				result.details = {doctrine:choose(['commerce protection', 'rapid interception', 'show-the-flag deterrence', 'deep reconnaissance', 'convoy escort', 'raider suppression']), readiness:choose(['fully mission-capable', 'one key system awaiting repair', 'short on trained crew', 'fuel reserves below plan', 'excellent crews in aging hulls']), commander:choose(['career tactician', 'popular reformer', 'cautious logistics specialist', 'ambitious noble', 'quietly compromised veteran']), opposingForce:choose(['a fast raider group', 'a rival patrol squadron', 'a privateer flotilla', 'a stealthy survey ship', 'a local defense force']), complication:choose(['rules of engagement are politically restrictive', 'the target has a legal claim to the transit lane', 'a rescue signal interrupts the operation', 'fleet intelligence may be stale'])}; break;
			case 'cyberpunk':
				result.title = choose(['Glass District', 'Chrome Weather', 'The Memory Market', 'Ghosts in the Switchyard', 'Black Iris Protocol']);
				result.summary = 'A dense urban enclave on ' + targetName + ' turns technology into leverage, surveillance, and social debt.';
				result.details = {district:choose(['stacked arcology warrens', 'a rain-drenched port market', 'the old industrial ring', 'a sensory entertainment quarter', 'a sealed corporate campus']), augmentation:choose(['illegal sensory overlays', 'neural co-processors', 'subdermal identity chips', 'industrial-grade limbs', 'memory-editing services']), corporateScheme:choose(['sell predictive policing data', 'buy out a neighborhood through debt', 'erase a whistleblower’s identity', 'turn a labor dispute into a security contract', 'test a black-market neural implant']), localResistance:choose(['a tenant mutual-aid mesh', 'a worker-run drone collective', 'an anonymous pirate broadcast', 'a street clinic network']), cost:choose(['the evidence is embedded in a patient’s memories', 'the only witness is legally owned by a firm', 'the upgrade has a hidden dependency', 'the district’s network is about to be wiped'])}; break;
			case 'sorcery':
				result.title = choose(['The Blue Equation', 'A Door in the Vacuum', 'The Ninth Harmonic', 'A Name That Burns', 'The Quiet Star']);
				result.summary = 'A strange metadimensional phenomenon appears near ' + targetName + '. Treat this as optional setting content, not a spell-rules implementation.';
				result.details = {phenomenon:choose(['a voice repeats from several seconds in the future', 'shadows point toward an absent star', 'an impossible room appears in old structures', 'a machine answers questions with memories', 'nearby navigation systems dream the same dream']), apparentEffect:choose(['short-range movement becomes unreliable', 'a hidden object becomes visible', 'identity records rewrite themselves', 'dead communications repeat in living voices', 'probability seems biased around one individual']), cost:choose(['each use erases a personal memory', 'nearby machines begin to awaken', 'the effect attracts a predatory intelligence', 'the phenomenon spreads by being described']), factionInterest:choose(['a research directorate', 'a forbidden cult', 'a state security bureau', 'a relic broker', 'an alien enclave'])}; break;
			case 'outpost':
				result.title = choose(['Last Light Station', 'The Sable Anchorage', 'Horizon Camp', 'Rookery Nine', 'Tideglass Outpost']);
				result.summary = 'A small frontier settlement near ' + targetName + ' depends on one fragile system that may soon fail.';
				result.details = {purpose:choose(['survey a jump corridor', 'extract a rare mineral', 'maintain a relay beacon', 'quarantine an old ruin', 'support a deep-space rescue route', 'monitor a disputed border']), authority:choose(['an elected committee', 'a corporate contractor', 'a retired officer', 'a local family compact', 'an absent remote administrator']), population:int(40, 2400), supplyShortage:choose(['medicine', 'reactor parts', 'potable water', 'qualified technicians', 'replacement filters']), crisis:choose(['the life-support system is failing', 'a survey team is overdue', 'the administrator has disappeared', 'a nearby signal contradicts official records', 'a feud threatens the landing pad']), secret:choose(['the outpost sits on a buried installation', 'the distress beacon is being deliberately suppressed', 'the official population count is false', 'the settlement is preparing to abandon its charter'])}; break;
			case 'ruin':
				result.title = choose(['The Silent Archive', 'Vault of the Second Dawn', 'The Glass Basilica', 'The Cinder Engine', 'Station Without a Sky']);
				result.summary = 'A lost site on ' + targetName + ' promises valuable discoveries, but its original purpose is not what local stories claim.';
				result.details = {origin:choose(['pre-Silence research campus', 'abandoned colony shelter', 'alien contact complex', 'private military laboratory', 'failed terraforming plant', 'automated archive']), currentCustodian:choose(['a broken maintenance intelligence', 'descendants who reject outsiders', 'a scavenger crew with a legal claim', 'an ecological system that treats people as intruders', 'a security machine that still follows obsolete orders']), hazard:choose(['unstable power routing', 'contaminated atmosphere', 'spatial distortion', 'structural collapse', 'self-repairing security doors']), discovery:choose(['a route database', 'a family archive', 'a prototype device', 'evidence of an erased expedition', 'a map to a more important site']), twist:choose(['the ruin is still receiving orders', 'the most valuable room is deliberately empty', 'the custodian is protecting refugees', 'the discovery implicates the current government'])}; break;
			case 'relic':
				result.title = choose(['The Orpheus Lens', 'Saint Vey’s Engine', 'Mnemonic Crown', 'The Saffron Key', 'Zero-Point Seed', 'The Last Cartographer']);
				result.summary = 'A lost technology artifact tied to ' + targetName + ' can change a campaign, but it is difficult to control or keep.';
				result.details = {form:choose(['memory crystal', 'self-calibrating tool', 'sealed surgical device', 'navigation instrument', 'adaptive alloy relic', 'pretech fabrication seed']), capability:choose(['reveals a hidden data layer', 'repairs one class of damaged machine', 'stores a person’s sensory memories', 'maps a route through unstable space', 'temporarily masks an energy signature']), limitation:choose(['requires a rare consumable', 'works only near a particular star', 'misidentifies unfamiliar users', 'cannot distinguish a lie from a mistaken memory', 'draws attention when activated']), custodian:choose(['a collector with a dangerous debt', 'a family that treats it as sacred', 'a faction that wants it destroyed', 'a ship AI with conflicting directives']), complication:choose(['the object is one component of a larger system', 'its last use caused a local disaster', 'two copies exist and one is fake', 'the buyer has withheld the real purpose'])}; break;
			case 'site':
				result.title = choose(['The Vanta Garden', 'Pilgrim’s Switch', 'The Nine-Bell Market', 'The Broken Meridian', 'The Low Orbit Bazaar', 'The Orchard Below']);
				result.summary = 'A memorable adventure location in ' + targetName + ' combines a strong local custom, a practical need, and a dangerous secret.';
				result.details = {sensoryDetail:choose(['walls carry a soft electrical hum', 'rain falls upward inside the central hall', 'every door is marked with a personal debt', 'the lights dim when someone lies', 'a local song is broadcast on an obsolete frequency']), inhabitants:choose(['salvagers with a strict code', 'pilgrims carrying sealed cargo', 'immigrant workers on strike', 'archivists who barter in memories', 'merchants protected by neighborhood crews']), immediateProblem:choose(['a vital person has vanished', 'a public auction is about to be interrupted', 'a power failure has trapped the wrong people', 'an old contract is being enforced literally', 'someone has brought a forbidden object into public view']), hiddenTruth:choose(['the site is built around a disguised sensor array', 'the local custom began as an emergency protocol', 'the dispute was engineered to flush out a spy', 'the location is about to be condemned'])}; break;
			case 'person':
				var person = pick(sector.people || []);
				result.title = person ? person.name + ' — ' + person.role : SWNNameGen.getName() + ', the Unquiet Patron';
				result.summary = 'A patron or nemesis whose personal need can become a full adventure.';
				result.details = {motive:person ? person.motive : choose(['recover a stolen identity', 'expose a dangerous secret', 'escape a political obligation']), mannerism:person ? person.mannerism : choose(['speaks in careful hypotheticals', 'never sits with their back to a door']), leverage:choose(['controls access to a restricted facility', 'has a debt owed by a faction leader', 'holds a navigational key', 'can make a crime disappear', 'knows a witness is still alive']), price:choose(['requires complete discretion', 'wants the crew to take the blame', 'demands a future favor', 'cannot pay in money']), complication:choose(['the patron is being watched', 'their story is mostly true but crucially incomplete', 'the nemesis is protecting someone vulnerable', 'the request will destabilize a local peace'])}; break;
			default:
				result.title = 'Unmapped Opportunity'; result.summary = 'A loose campaign seed near ' + targetName + '.'; result.details = {hook:'An unexpected signal opens a new lead.', complication:'The first explanation is incomplete.'};
		}
		return result;
	};

	Tools.enrichSector = function(sector, legacy) {
		Tools.ensureIds(sector);
		sector.schemaVersion = 3;
		if (!Array.isArray(sector.tradeRoutes)) sector.tradeRoutes = Tools.generateTradeRoutes(sector);
		if (!Array.isArray(sector.polities)) sector.polities = Tools.generatePolities(sector);
		if (!Array.isArray(sector.markets)) sector.markets = Tools.generateMarkets(sector);
		if (!Array.isArray(sector.factions)) sector.factions = sector.gmMode === false ? [] : Tools.generateFactions(sector);
		if (!Array.isArray(sector.adventures)) sector.adventures = sector.gmMode === false ? [] : Tools.generateAdventureSeeds(sector, 8);
		if (!Array.isArray(sector.threats)) sector.threats = sector.gmMode === false ? [] : Tools.generateThreats(sector, 10);
		if (!Array.isArray(sector.people)) sector.people = sector.gmMode === false ? [] : Tools.generatePeople(sector, 10);
		if (!Array.isArray(sector.supplementContent)) sector.supplementContent = [];
		if (!Number.isFinite(Number(sector.factionTurn))) sector.factionTurn = 0;
		if (!Array.isArray(sector.regions)) sector.regions = [];
		Tools.ensureDiplomacy(sector);
		Tools.recalculateInfluence(sector);
		Tools.linkCampaignRecords(sector);
		return sector;
	};

	return Tools;
})();
