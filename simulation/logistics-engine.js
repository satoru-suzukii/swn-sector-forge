/*
 * Sector Forge 1.3.10 — commodity-aware logistics with lossless shipment archives.
 *
 * Adds persistent multi-hop shipments to the 1.3.3 local economy. Cargo is
 * debited when a shipment departs, each route leg takes actual campaign time,
 * route capacity is consumed at dispatch, and delivery is credited only on
 * arrival. The model is intentionally deterministic for a given sector seed,
 * turn, shipment, and route. No interface refresh advances logistics.
 */
var SectorLogistics = (function() {
	'use strict';

	var API = {};
	var SCHEMA_VERSION = 1;
	var ENGINE_VERSION = '1.3.12';
	var EPSILON = 0.0001;
	var MAX_NEW_SHIPMENTS_PER_TURN = 250;
	var systemIndexes = new WeakMap(), marketIndexes = new WeakMap(), marketStateIndexes = new WeakMap(), routeIndexes = new WeakMap(), commodityIndexes = new WeakMap();
	var pathRuntimeCaches = new WeakMap(), sequenceRuntimeCaches = new WeakMap();
	function indexed(array, cache, keyOf) {
		if (!Array.isArray(array)) return new Map();
		var entry = cache.get(array);
		if (!entry || entry.length !== array.length) {
			var map = new Map();
			array.forEach(function(item) { var key = keyOf(item); if (key != null && key !== '') map.set(String(key), item); });
			entry = {length:array.length, map:map}; cache.set(array, entry);
		}
		return entry.map;
	}

	function arr(value) { return Array.isArray(value) ? value : []; }
	function obj(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
	function num(value, fallback, min) { var n = Number(value); return Number.isFinite(n) ? Math.max(min == null ? 0 : min, n) : fallback; }
	function int(value, fallback, min) { return Math.floor(num(value, fallback, min)); }
	function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
	function round(value) { return Math.round(num(value, 0, 0) * 100) / 100; }
	function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
	function clone(value) { return JSON.parse(JSON.stringify(value)); }

	function getEconomy(sector) {
		return sector && sector.simulation && sector.simulation.economy && obj(sector.simulation.economy) ? sector.simulation.economy : null;
	}

	function ensureSequenceCounters(logistics) {
		var archiveShipments = logistics.shipmentArchive.shipments;
		var cached = sequenceRuntimeCaches.get(logistics);
		var changed = !cached || cached.shipmentsRef !== logistics.shipments || cached.shipmentsLength !== logistics.shipments.length || cached.ledgerRef !== logistics.ledger || cached.ledgerLength !== logistics.ledger.length || cached.archiveShipmentsRef !== archiveShipments;
		if (changed) {
			var archivedLatestSequence = int(logistics.shipmentArchive.latestSequence, 0, 0);
			Object.keys(archiveShipments).forEach(function(key) {
				var archived = archiveShipments[key], match = String(archived && archived.id || key || '').match(/(\d+)$/);
				if (match) archivedLatestSequence = Math.max(archivedLatestSequence, int(match[1], 0, 0));
			});
			logistics.shipmentArchive.latestSequence = archivedLatestSequence;
			var retainedLatestSequence = logistics.shipments.reduce(function(maximum, shipment) {
				var match = String(shipment && shipment.id || '').match(/(\d+)$/);
				return Math.max(maximum, match ? int(match[1], 0, 0) : 0);
			}, 0);
			logistics.nextShipmentSequence = Math.max(int(logistics.nextShipmentSequence, 1, 1), archivedLatestSequence + 1, retainedLatestSequence + 1, 1);
			logistics.nextLedgerSequence = Math.max(int(logistics.nextLedgerSequence, logistics.ledger.length + 1, 1), logistics.ledger.length + 1);
			sequenceRuntimeCaches.set(logistics, {shipmentsRef:logistics.shipments, shipmentsLength:logistics.shipments.length, ledgerRef:logistics.ledger, ledgerLength:logistics.ledger.length, archiveShipmentsRef:archiveShipments});
		} else {
			// The serialized counters are authoritative between known append operations.
			logistics.nextShipmentSequence = int(logistics.nextShipmentSequence, 1, 1);
			logistics.nextLedgerSequence = int(logistics.nextLedgerSequence, logistics.ledger.length + 1, 1);
		}
	}
	function syncSequenceCache(logistics) {
		sequenceRuntimeCaches.set(logistics, {shipmentsRef:logistics.shipments, shipmentsLength:logistics.shipments.length, ledgerRef:logistics.ledger, ledgerLength:logistics.ledger.length, archiveShipmentsRef:logistics.shipmentArchive.shipments});
	}
	function pathCacheSignatureParts(sector) {
		var simulation = sector && sector.simulation || {}, politics = simulation.politics || {}, transport = simulation.transport || {};
		return {
			systems:sector && sector.systems, routes:sector && sector.tradeRoutes, factions:sector && sector.factions,
			diplomacy:sector && sector.diplomacy, polities:sector && sector.polities,
			politics:politics, wars:politics.wars, treaties:politics.treaties, sanctions:politics.sanctions,
			transport:transport, ports:transport.ports, fleets:transport.fleets
		};
	}
	function getPathRuntimeCache(sector) {
		var parts = pathCacheSignatureParts(sector);
		var turn = int(sector && sector.factionTurn, int(getEconomy(sector) && getEconomy(sector).clock && getEconomy(sector).clock.turn, 0, 0), 0);
		var cached = pathRuntimeCaches.get(sector);
		var changed = !cached || cached.turn !== turn || Object.keys(parts).some(function(key) { return cached.parts[key] !== parts[key]; });
		if (changed) {
			cached = {turn:turn, parts:parts, graphs:new Map(), searches:new Map()};
			pathRuntimeCaches.set(sector, cached);
		}
		return cached;
	}
	function pathGraphKey(commodityId, basePrice) {
		return String(commodityId || '') + '|' + String(Number.isFinite(Number(basePrice)) ? Number(basePrice) : 100);
	}
	function cachedPathSearch(sector, logistics, fromSystemId, commodityId, basePrice, suppliedGraph, suppliedTree) {
		if (suppliedGraph) return {graph:suppliedGraph, tree:suppliedTree || shortestPathsFrom(suppliedGraph, fromSystemId)};
		var cache = getPathRuntimeCache(sector), graphKey = pathGraphKey(commodityId, basePrice), graph = cache.graphs.get(graphKey);
		if (!graph) { graph = buildGraph(sector, logistics, commodityId, basePrice); cache.graphs.set(graphKey, graph); }
		var searchKey = graphKey + '|' + String(fromSystemId), tree = cache.searches.get(searchKey);
		if (!tree) { tree = shortestPathsFrom(graph, fromSystemId); cache.searches.set(searchKey, tree || null); }
		return {graph:graph, tree:tree};
	}
	function ensure(sector) {
		var economy = getEconomy(sector);
		if (!economy || economy.initialized !== true) throw new Error('Initialize the local economy before running interstellar logistics.');
		economy.logistics = obj(economy.logistics) ? economy.logistics : {};
		var logistics = economy.logistics;
		logistics.schemaVersion = SCHEMA_VERSION;
		logistics.engineVersion = ENGINE_VERSION;
		logistics.shipments = arr(logistics.shipments);
		logistics.ledger = arr(logistics.ledger);
		logistics.shipmentArchive = obj(logistics.shipmentArchive) ? logistics.shipmentArchive : {schemaVersion:1, archivedCount:0, firstTurn:null, lastTurn:0, byStatus:{}, totalDeliveredLots:0, totalPaidLots:0, totalPaidCr:0, latestSequence:0, shipments:{}};
		logistics.shipmentArchive.shipments = obj(logistics.shipmentArchive.shipments) ? logistics.shipmentArchive.shipments : {};
		logistics.shipmentArchive.byStatus = obj(logistics.shipmentArchive.byStatus) ? logistics.shipmentArchive.byStatus : {};
		ensureSequenceCounters(logistics);
		logistics.capacityUsage = obj(logistics.capacityUsage) ? logistics.capacityUsage : {};
		logistics.clock = obj(logistics.clock) ? logistics.clock : {};
		var baseline = int(economy.clock && economy.clock.lastAdvancedTurn, 0, 0);
		if (logistics.clock.arrivalsProcessedTurn == null) logistics.clock.arrivalsProcessedTurn = baseline;
		if (logistics.clock.dispatchProcessedTurn == null) logistics.clock.dispatchProcessedTurn = baseline;
		if (logistics.clock.capacityUsageTurn == null) logistics.clock.capacityUsageTurn = baseline;
		return logistics;
	}

	function systemById(sector, id) { return indexed(sector && sector.systems, systemIndexes, function(s) { return s && s.id; }).get(String(id)) || null; }
	function marketById(sector, id) { return indexed(sector && sector.markets, marketIndexes, function(m) { return m && m.id; }).get(String(id)) || null; }
	function marketState(sector, marketId) { var economy = getEconomy(sector); return economy && indexed(economy.marketStates, marketStateIndexes, function(s) { return s && s.marketId; }).get(String(marketId)) || null; }
	function inventoryLine(state, commodityId) { return indexed(state && state.inventory, commodityIndexes, function(s) { return s && s.commodityId; }).get(String(commodityId)) || null; }
	function priceLine(state, commodityId) { return indexed(state && state.prices, commodityIndexes, function(s) { return s && s.commodityId; }).get(String(commodityId)) || null; }
	function goodLine(market, commodityId) { return arr(market && market.goods).find(function(g) { return slug(g.name || g.id) === commodityId; }) || null; }
	function findRoute(sector, routeId) { return indexed(sector && sector.tradeRoutes, routeIndexes, function(r) { return r && r.id; }).get(String(routeId)) || null; }
	function routeProfile(route, sector, turn) {
		var distance = Math.max(1, int(route && route.distance, 1, 1));
		var profile = {
			capacityPerTurn:Math.max(0, num(route && route.capacityPerTurn, Math.round(32 / distance * 100) / 100, 0)),
			transitTurns:Math.max(1, int(route && route.transitTurns, Math.max(1, Math.ceil(distance / 2)), 1)),
			freightCostPerUnit:num(route && route.freightCostPerUnit, round(distance * 1.25), 0),
			tollPerUnit:num(route && route.tollPerUnit, 0, 0),
			operatingCostPerUnit:num(route && route.operatingCostPerUnit, round(distance * 0.3), 0),
			riskPercent:clamp(num(route && route.riskPercent, 2 + distance * 2, 0), 0, 95),
			direction:String(route && route.direction || 'both'),
			source:['capacityPerTurn','transitTurns','freightCostPerUnit','tollPerUnit','operatingCostPerUnit','riskPercent','direction'].some(function(k) { return route && route[k] != null; }) ? 'manual/configured' : 'derived provisional'
		};
		if (sector && typeof SectorTransport !== 'undefined' && SectorTransport.getRouteModifiers) {
			var transport = SectorTransport.getRouteModifiers(sector, route, turn);
			if (transport) {
				profile.baseCapacityPerTurn = profile.capacityPerTurn;
				profile.capacityPerTurn = transport.capacityPerTurn;
				profile.transitTurns = transport.transitTurns;
				profile.riskPercent = clamp(profile.riskPercent + transport.riskModifier, 0, 95);
				profile.operatingCostPerUnit = round(profile.operatingCostPerUnit + transport.variableCostPerCargoUnit);
				profile.transport = transport;
			}
		}
		return profile;
	}

	function controllerFor(sector, systemId) {
		var system = systemById(sector, systemId);
		return system ? String(system.manualControllerFactionId || system.controllingFactionId || '') : '';
	}

	function relationFor(sector, a, b) {
		if (!a || !b || a === b) return null;
		if (typeof CampaignTools !== 'undefined' && CampaignTools.getDiplomaticRelation) return CampaignTools.getDiplomaticRelation(sector, a, b);
		return arr(sector.diplomacy).find(function(r) { return r && ((r.factionAId === a && r.factionBId === b) || (r.factionAId === b && r.factionBId === a)); }) || null;
	}

	function tradeAccess(sector, fromSystemId, toSystemId, commodityId) {
		var a = controllerFor(sector, fromSystemId), b = controllerFor(sector, toSystemId);
		var political = typeof SectorPolitics !== 'undefined' && SectorPolitics.getTradeAccess ? SectorPolitics.getTradeAccess(sector, fromSystemId, toSystemId, commodityId) : {allowed:true,tariffDelta:0,riskModifier:0,reason:''};
		function applyPolitics(base) {
			if (!political.allowed) return {allowed:false,tariffPercent:0,riskModifier:Math.max(Number(base.riskModifier||0),Number(political.riskModifier||0)),reason:political.reason||'Formal political restriction'};
			var merged = Object.assign({},base);
			merged.tariffPercent = clamp(num(merged.tariffPercent,0,0)+num(political.tariffDelta,0),0,100);
			merged.riskModifier = num(merged.riskModifier,0)+num(political.riskModifier,0);
			if (political.reason && political.reason !== 'No additional political restriction') merged.reason += '; '+political.reason;
			return merged;
		}
		if (!a || !b || a === b) return applyPolitics({allowed:true,tariffPercent:0,riskModifier:0,reason:'No hostile controlled faction border'});
		var relation = relationFor(sector, a, b);
		if (!relation) return applyPolitics({allowed:true, tariffPercent:5, riskModifier:0, reason:'No formal faction relationship; neutral trade default'});
		var posture = String(relation.state || 'Neutral');
		var formalPassage = political.allowed && (political.reason === 'Ceasefire restrictions' || political.reason === 'Wartime humanitarian exception');
		var defaultAccess = posture === 'Open conflict' ? 'embargoed' : (posture === 'Strained' || posture === 'Rivalry' ? 'restricted' : (posture === 'Alliance' || posture === 'Trade pact' ? 'preferred' : 'open'));
		var policy = obj(relation.tradePolicy) ? relation.tradePolicy : {};
		var authoredAccess = relation.tradeAccess || policy.access;
		var access = String(authoredAccess || 'automatic');
		if (access === 'automatic' || !access) access = formalPassage && posture === 'Open conflict' ? 'restricted' : defaultAccess;
		var rawEmbargoes = relation.embargoCommodityIds || policy.embargoCommodityIds || [];
		var embargoes = (Array.isArray(rawEmbargoes) ? rawEmbargoes : String(rawEmbargoes).split(/[\s,;]+/)).filter(Boolean);
		if (relation.tradeTransitRights === false || policy.transitRights === false) return applyPolitics({allowed:false,tariffPercent:0,riskModifier:0,reason:'Faction transit rights revoked'});
		if (embargoes.indexOf(commodityId) >= 0) return applyPolitics({allowed:false,tariffPercent:0,riskModifier:0,reason:'Faction commodity embargo'});
		if (access === 'embargoed') return applyPolitics({allowed:false,tariffPercent:0,riskModifier:0,reason:'Faction diplomatic embargo'});
		var defaults = {Alliance:0, 'Trade pact':2, Neutral:5, Strained:10, Rivalry:16, 'Open conflict':formalPassage?5:25};
		var tariff = Number(relation.tradeTariffPercent != null ? relation.tradeTariffPercent : policy.tariffPercent);
		if (!Number.isFinite(tariff) || tariff < 0) tariff = defaults[posture] == null ? 5 : defaults[posture];
		if (access === 'preferred') tariff = Math.min(tariff, 2);
		if (access === 'open') tariff = Math.min(tariff, 5);
		if (access === 'restricted') tariff = Math.max(tariff, 12);
		var riskModifier = posture === 'Rivalry' ? 8 : posture === 'Strained' ? 4 : posture === 'Open conflict' ? (formalPassage?0:25) : 0;
		return applyPolitics({allowed:true, tariffPercent:clamp(tariff, 0, 100), riskModifier:riskModifier, reason:access + ' faction access under ' + posture});
	}

	function routeAllowedDirection(sector, route, fromId, toId) {
		var profile = routeProfile(route, sector, sector && sector.factionTurn);
		if (fromId === route.fromSystemId && toId === route.toSystemId) return profile.direction !== 'reverse' && profile.direction !== 'to-from';
		if (fromId === route.toSystemId && toId === route.fromSystemId) return profile.direction !== 'forward' && profile.direction !== 'from-to';
		return false;
	}

	function capacityKey(routeId, fromId, toId) { return String(routeId) + '|' + String(fromId) + '>' + String(toId); }
	function usedCapacity(logistics, routeId, fromId, toId) { return num(logistics.capacityUsage[capacityKey(routeId, fromId, toId)], 0, 0); }
	function routeRemaining(sector, logistics, route, fromId, toId, turn) { return Math.max(0, routeProfile(route, sector, turn).capacityPerTurn - usedCapacity(logistics, route.id, fromId, toId)); }

	function buildGraph(sector, logistics, commodityId, basePrice) {
		var adjacency = new Map();
		arr(sector.systems).forEach(function(system) { adjacency.set(String(system.id), []); });
		arr(sector.tradeRoutes).forEach(function(route) {
			if (!route || typeof TradeRouteRules === 'undefined' || !TradeRouteRules.isOperational(route)) return;
			var a = String(route.fromSystemId || ''), b = String(route.toSystemId || '');
			if (!adjacency.has(a) || !adjacency.has(b) || a === b) return;
			var profile = routeProfile(route, sector, sector && sector.factionTurn);
			if (profile.capacityPerTurn <= 0) return;
			[[a,b],[b,a]].forEach(function(pair) {
				var from = pair[0], to = pair[1];
				if (!routeAllowedDirection(sector, route, from, to)) return;
				var access = tradeAccess(sector, from, to, commodityId);
				if (!access.allowed) return;
				var cargoWeight = freightUnits(sector, commodityId);
				var freight = (profile.freightCostPerUnit + profile.tollPerUnit) * cargoWeight + basePrice * access.tariffPercent / 100;
				var risk = clamp(profile.riskPercent + access.riskModifier, 0, 95);
				var score = profile.transitTurns * 4 + freight + risk * 0.18;
				adjacency.get(from).push({routeId:String(route.id), fromSystemId:from, toSystemId:to, profile:profile, access:access, freightCostPerUnit:freight, freightUnitMultiplier:cargoWeight, riskPercent:risk, score:score});
			});
		});
		adjacency.forEach(function(edges) { edges.sort(function(a,b) { return a.score-b.score || a.routeId.localeCompare(b.routeId) || a.toSystemId.localeCompare(b.toSystemId); }); });
		return adjacency;
	}

	function shortestPathsFrom(graph, fromSystemId) {
		var from = String(fromSystemId), distances = new Map(), previous = new Map(), visited = new Set();
		graph.forEach(function(_, id) { distances.set(id, Infinity); });
		if (!distances.has(from)) return null;
		distances.set(from, 0);
		while (visited.size < graph.size) {
			var current = null, best = Infinity;
			distances.forEach(function(value, id) { if (!visited.has(id) && value < best) { best = value; current = id; } });
			if (current == null || !Number.isFinite(best)) break;
			visited.add(current);
			arr(graph.get(current)).forEach(function(edge) {
				if (visited.has(edge.toSystemId)) return;
				var candidate = best + edge.score;
				if (candidate < distances.get(edge.toSystemId)) { distances.set(edge.toSystemId, candidate); previous.set(edge.toSystemId, {from:current, edge:edge}); }
			});
		}
		return {from:from, distances:distances, previous:previous};
	}

	function pathFromSearch(tree, toSystemId, basePrice) {
		if (!tree) return null;
		var target = String(toSystemId), distance = tree.distances.get(target);
		if (!Number.isFinite(distance)) return null;
		if (target === tree.from) return {edges:[], score:0, freightCostPerUnit:0, tariffCostPerUnit:0, riskPercent:0, transitTurns:0};
		var edges = [], cursor = target;
		while (cursor !== tree.from) {
			var step = tree.previous.get(cursor);
			if (!step) return null;
			edges.unshift(step.edge);
			cursor = step.from;
		}
		return {
			edges:edges,
			score:distance,
			freightCostPerUnit:round(edges.reduce(function(total, edge) { return total + (edge.profile.freightCostPerUnit + edge.profile.tollPerUnit) * num(edge.freightUnitMultiplier, 1, 0.01); }, 0)),
			tariffCostPerUnit:round(edges.reduce(function(total, edge) { return total + basePrice * edge.access.tariffPercent / 100; }, 0)),
			riskPercent:round(edges.reduce(function(total, edge) { return total + edge.riskPercent; }, 0)),
			transitTurns:edges.reduce(function(total, edge) { return total + edge.profile.transitTurns; }, 0)
		};
	}

	function findPath(sector, logistics, fromSystemId, toSystemId, commodityId, basePrice, suppliedGraph, suppliedTree) {
		if (String(fromSystemId) === String(toSystemId)) return {edges:[], score:0, freightCostPerUnit:0, tariffCostPerUnit:0, riskPercent:0, transitTurns:0};
		var cached = cachedPathSearch(sector, logistics, fromSystemId, commodityId, basePrice, suppliedGraph, suppliedTree);
		return pathFromSearch(cached.tree, toSystemId, basePrice);
	}

	function freightUnits(sector, commodityId) {
		var economy = getEconomy(sector);
		var commodity = arr(economy && economy.commodities).find(function(item) { return item.id === commodityId; });
		return Math.max(0.01, num(commodity && commodity.freightUnitsPerLot, 1, 0.01));
	}
	function marketUnitPrice(market, state, commodityId) {
		var good = goodLine(market, commodityId), price = priceLine(state, commodityId);
		var base = num(good && good.basePrice, 100, 1);
		if (good && Number(good.localPrice) > 0) return round(good.localPrice);
		return round(base * num(price && price.currentPriceIndex, num(good && good.priceIndex, 100, 1), 1) / 100);
	}

	function nextId(logistics, prefix) {
		var id = prefix + String(logistics.nextShipmentSequence++).padStart(7, '0');
		while (logistics.shipments.some(function(item) { return item.id === id; })) id = prefix + String(logistics.nextShipmentSequence++).padStart(7, '0');
		return id;
	}

	function logEvent(sector, event) {
		if (typeof SectorSimulation === 'undefined' || !SectorSimulation.recordEvent) return null;
		var shipment = event && event.shipmentId && getShipmentsForSector(sector).find(function(x) { return String(x.id) === String(event.shipmentId); });
		var causes = arr(event && event.causes).slice();
		if (shipment && shipment.lastChronicleEventId && causes.indexOf(shipment.lastChronicleEventId) < 0) causes.push(shipment.lastChronicleEventId);
		var record = SectorSimulation.recordEvent(sector, Object.assign({category:'logistics', source:'sector-logistics', visibility:'gm', causes:causes}, event));
		if (shipment && record) {
			shipment.chronicleEventIds = arr(shipment.chronicleEventIds);
			shipment.chronicleEventIds.push(record.id);
			if (shipment.chronicleEventIds.length > 32) shipment.chronicleEventIds = shipment.chronicleEventIds.slice(-32);
			shipment.lastChronicleEventId = record.id;
		}
		return record;
	}
	function getShipmentsForSector(sector) { var economy = getEconomy(sector); return arr(economy && economy.logistics && economy.logistics.shipments); }

	function addLogisticsLedger(sector, logistics, record) {
		record.id = 'LOG-LEDGER-' + String(logistics.nextLedgerSequence++).padStart(7, '0');
		logistics.ledger.push(record);
		syncSequenceCache(logistics);
		return record;
	}

	function updateFreightPressure(sector, shipment, deliveredQuantity, turn) {
		var market = marketById(sector, shipment.destinationMarketId);
		var state = marketState(sector, shipment.destinationMarketId);
		if (!market || !state || deliveredQuantity <= 0) return;
		var price = priceLine(state, shipment.commodityId);
		var good = goodLine(market, shipment.commodityId);
		if (!price || !good || (typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(price, 'freightCostPressure'))) return;
		var reference = Math.max(1, num(good.basePrice, price.referencePrice, 1));
		var perUnit = (num(shipment.freightCost, 0, 0) + num(shipment.tollCost, 0, 0) + num(shipment.tariffCost, 0, 0)) / Math.max(0.01, num(shipment.quantity, deliveredQuantity, 0.01));
		var pressure = clamp(perUnit / reference * 100, 0, 35);
		price.freightCostPressure = round(num(price.freightCostPressure, 0, 0) * 0.65 + pressure * 0.35);
		price.lastFreightTurn = turn;
	}

	function attemptDelivery(sector, logistics, shipment, turn) {
		var destination = marketState(sector, shipment.destinationMarketId);
		var stock = inventoryLine(destination, shipment.commodityId);
		var remaining = round(shipment.remainingQuantity);
		if (remaining <= EPSILON) { shipment.status = 'delivered'; shipment.deliveredTurn = turn; return 0; }
		if (!stock) { shipment.status = 'awaiting-storage'; shipment.delayReason = 'Destination commodity account is unavailable'; return 0; }
		if (typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(stock, 'onHand')) {
			shipment.status = 'awaiting-storage'; shipment.delayReason = 'Destination inventory is GM-locked'; return 0;
		}
		var capacity = Math.max(0, num(stock.storageCapacity, 0, 0) - num(stock.onHand, 0, 0));
		var delivered = round(Math.min(remaining, capacity));
		if (delivered > EPSILON) {
			stock.onHand = round(num(stock.onHand, 0, 0) + delivered);
			stock.source = 'simulated';
			stock.lastImportTurn = turn;
			shipment.remainingQuantity = round(remaining - delivered);
			shipment.deliveredQuantity = round(num(shipment.deliveredQuantity, 0, 0) + delivered);
			updateFreightPressure(sector, shipment, delivered, turn);
			// The physical arrival is the cause of settlement, not a later report
			// about it. Record it first so the payment event points to this event.
			logEvent(sector, {type:'shipment-arrival', summary:delivered + ' lots of ' + shipment.commodityId + ' arrived at ' + (marketById(sector, shipment.destinationMarketId) || {}).planetName + '.', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, marketId:shipment.destinationMarketId, commodityId:shipment.commodityId, quantity:delivered});
			if (typeof SectorSettlement !== 'undefined' && SectorSettlement.settleCommodityDelivery) SectorSettlement.settleCommodityDelivery(sector, shipment, delivered, turn);
			if (shipment.contractId && typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.recordDelivery) SectorTradeContracts.recordDelivery(sector, shipment, delivered, turn);
			var arrivalEntry = addLogisticsLedger(sector, logistics, {turn:turn, type:'arrival', shipmentId:shipment.id, marketId:shipment.destinationMarketId, commodityId:shipment.commodityId, quantity:delivered, cost:round((num(shipment.freightCost, 0, 0) + num(shipment.tollCost, 0, 0) + num(shipment.tariffCost, 0, 0)) * delivered / Math.max(0.01, num(shipment.quantity, delivered, 0.01)))});
			destination.logisticsLedger = arr(destination.logisticsLedger); destination.logisticsLedger.push(clone(arrivalEntry));
		}
		if (shipment.remainingQuantity <= EPSILON) {
			shipment.remainingQuantity = 0;
			shipment.status = 'delivered';
			shipment.deliveredTurn = turn;
			shipment.delayReason = '';
			logEvent(sector, {type:'shipment-delivered', summary:shipment.quantity + ' lots of ' + shipment.commodityId + ' arrived at ' + (marketById(sector, shipment.destinationMarketId) || {}).planetName + '.', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, commodityId:shipment.commodityId, quantity:shipment.deliveredQuantity, freightCost:shipment.freightCost, tariffCost:shipment.tariffCost});
		} else {
			shipment.status = 'awaiting-storage';
			shipment.delayReason = 'Destination storage capacity is full';
		}
		return delivered;
	}

	function edgeForRoute(sector, routeId, fromSystemId, commodityId, basePrice) {
		var route = findRoute(sector, routeId);
		if (!route || typeof TradeRouteRules === 'undefined' || !TradeRouteRules.isOperational(route) || !routeAllowedDirection(sector, route, fromSystemId, route.fromSystemId === fromSystemId ? route.toSystemId : route.fromSystemId)) return null;
		var toSystemId = route.fromSystemId === fromSystemId ? route.toSystemId : route.fromSystemId;
		var access = tradeAccess(sector, fromSystemId, toSystemId, commodityId);
		if (!access.allowed) return null;
		var profile = routeProfile(route, sector, sector && sector.factionTurn);
		return {route:route, routeId:String(route.id), fromSystemId:String(fromSystemId), toSystemId:String(toSystemId), profile:profile, access:access, riskPercent:clamp(profile.riskPercent + access.riskModifier, 0, 95), freightCostPerUnit:profile.freightCostPerUnit + profile.tollPerUnit + basePrice * access.tariffPercent / 100};
	}

	function replanShipment(sector, logistics, shipment) {
		var destination = marketById(sector, shipment.destinationMarketId);
		if (!destination) { shipment.status = 'stranded'; shipment.closedTurn = int(turn, 0, 0); shipment.delayReason = 'Destination market was removed'; return false; }
		var good = goodLine(destination, shipment.commodityId);
		var basePrice = num(good && good.basePrice, 100, 1);
		var path = findPath(sector, logistics, shipment.currentSystemId, destination.systemId, shipment.commodityId, basePrice);
		if (!path || !path.edges.length) { shipment.status = 'delayed'; shipment.delayReason = 'No permitted operational route is currently available'; return false; }
		shipment.routeIds = path.edges.map(function(edge) { return edge.routeId; });
		shipment.currentLegIndex = 0;
		shipment.status = 'awaiting-capacity';
		shipment.delayReason = 'Itinerary recalculated after a route or policy change';
		return true;
	}

	function dispatchLeg(sector, logistics, shipment, turn) {
		var destination = marketById(sector, shipment.destinationMarketId);
		if (!destination) { shipment.status = 'stranded'; shipment.closedTurn = int(turn, 0, 0); shipment.delayReason = 'Destination market was removed'; return false; }
		if (String(shipment.currentSystemId) === String(destination.systemId)) { attemptDelivery(sector, logistics, shipment, turn); return shipment.status === 'delivered'; }
		var routeId = arr(shipment.routeIds)[shipment.currentLegIndex];
		var good = goodLine(destination, shipment.commodityId);
		var basePrice = num(good && good.basePrice, 100, 1);
		var edge = routeId ? edgeForRoute(sector, routeId, shipment.currentSystemId, shipment.commodityId, basePrice) : null;
		if (!edge) {
			if (replanShipment(sector, logistics, shipment)) return dispatchLeg(sector, logistics, shipment, turn);
			return false;
		}
		var cargoUnits = round(num(shipment.remainingQuantity, 0, 0) * freightUnits(sector, shipment.commodityId));
		var availableCapacity = routeRemaining(sector, logistics, edge.route, edge.fromSystemId, edge.toSystemId, turn);
		if (cargoUnits > availableCapacity + EPSILON) {
			shipment.status = 'awaiting-capacity';
			shipment.delayReason = 'Route capacity is full; shipment will retry next turn';
			return false;
		}
		logistics.capacityUsage[capacityKey(edge.routeId, edge.fromSystemId, edge.toSystemId)] = round(usedCapacity(logistics, edge.routeId, edge.fromSystemId, edge.toSystemId) + cargoUnits);
		var random = SectorSimulation.createRandomStream(sector, {turn:turn, phase:'logistics.route-risk', scope:shipment.id + ':' + edge.routeId + ':' + shipment.currentLegIndex});
		var incident = SectorSimulation.nextRandom(random) * 100 < edge.riskPercent;
		var loss = 0, delay = 0, incidentType = '';
		if (incident) {
			if (SectorSimulation.nextRandom(random) < 0.25) {
				loss = round(shipment.remainingQuantity * (0.05 + SectorSimulation.nextRandom(random) * 0.15));
				shipment.remainingQuantity = round(Math.max(0, shipment.remainingQuantity - loss));
				incidentType = 'cargo-loss';
			} else { delay = 1; incidentType = 'transit-delay'; }
		}
		var arrivalTurn = turn + edge.profile.transitTurns + delay;
		if (shipment.departedTurn == null) shipment.departedTurn = turn;
		var legLots = round(shipment.remainingQuantity + loss);
		var legFreight = round(edge.profile.freightCostPerUnit * cargoUnits);
		var legToll = round(edge.profile.tollPerUnit * cargoUnits);
		var legOperating = round(edge.profile.operatingCostPerUnit * cargoUnits);
		var saleBasis = num(shipment.saleUnitPriceCr, basePrice, 1);
		var legTariff = round(saleBasis * edge.access.tariffPercent / 100 * legLots);
		var leg = {routeId:edge.routeId, fromSystemId:edge.fromSystemId, toSystemId:edge.toSystemId, departedTurn:turn, arrivalTurn:arrivalTurn, transitTurns:edge.profile.transitTurns + delay, cargoUnits:cargoUnits, freightCost:legFreight, tollCost:legToll, operatingCost:legOperating, tariffCost:legTariff, riskPercent:edge.riskPercent, status:'in-transit', incident:incidentType, quantityLost:loss};
		shipment.legs = arr(shipment.legs);
		shipment.legs.push(leg);
		if (typeof SectorSettlement !== 'undefined' && SectorSettlement.settleRouteLeg) SectorSettlement.settleRouteLeg(sector, shipment, leg, turn);
		shipment.currentLeg = clone(leg);
		shipment.currentLegArrivalTurn = arrivalTurn;
		shipment.currentSystemId = edge.fromSystemId;
		shipment.status = delay ? 'delayed' : 'in-transit';
		shipment.delayReason = delay ? 'A route incident delayed the shipment by one turn' : '';
		shipment.freightCost = round(num(shipment.freightCost, 0, 0) + legFreight);
		shipment.tollCost = round(num(shipment.tollCost, 0, 0) + legToll);
		shipment.operatingCost = round(num(shipment.operatingCost, 0, 0) + legOperating);
		shipment.tariffCost = round(num(shipment.tariffCost, 0, 0) + legTariff);
		shipment.riskPercent = round(num(shipment.riskPercent, 0, 0) + edge.riskPercent);
		shipment.estimatedArrivalTurn = arr(shipment.legs).reduce(function(max, item) { return Math.max(max, item.arrivalTurn); }, turn);
		addLogisticsLedger(sector, logistics, {turn:turn, type:'departure', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, routeId:edge.routeId, commodityId:shipment.commodityId, quantity:round(shipment.remainingQuantity + loss), cargoUnits:cargoUnits, freightCost:leg.freightCost, tollCost:leg.tollCost, tariffCost:leg.tariffCost});
		if (loss > 0) {
			addLogisticsLedger(sector, logistics, {turn:turn, type:'transit-loss', shipmentId:shipment.id, routeId:edge.routeId, commodityId:shipment.commodityId, quantity:loss, cargoUnits:round(loss * freightUnits(sector, shipment.commodityId)), systemId:edge.fromSystemId});
			if (typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.recordLoss) SectorTradeContracts.recordLoss(sector, shipment, loss, turn);
		}
		if (incident) {
			logEvent(sector, {type:incidentType, summary:incidentType === 'cargo-loss' ? loss + ' lots of ' + shipment.commodityId + ' were lost during transit on ' + edge.routeId + '.' : 'A transit incident delayed shipment ' + shipment.id + ' on ' + edge.routeId + ' by one turn.', shipmentId:shipment.id, routeId:edge.routeId, quantityLost:loss, addedDelayTurns:delay});
		}
		return true;
	}

	function buildPendingInboundIndex(logistics) {
		var index = new Map();
		arr(logistics && logistics.shipments).forEach(function(shipment) {
			if (!shipment || ['delivered','cancelled','lost','stranded'].indexOf(String(shipment.status)) >= 0) return;
			var key = String(shipment.destinationMarketId) + '|' + String(shipment.commodityId);
			index.set(key, (index.get(key) || 0) + num(shipment.remainingQuantity, 0, 0));
		});
		return index;
	}
	function pendingInbound(index, marketId, commodityId) { return index.get(String(marketId) + '|' + String(commodityId)) || 0; }

	function commodityBasePrice(market, commodityId) {
		var good = goodLine(market, commodityId);
		return num(good && good.basePrice, 100, 1);
	}

	function startShipment(sector, logistics, candidate, turn) {
		var originState = marketState(sector, candidate.origin.id);
		var originStock = inventoryLine(originState, candidate.commodityId);
		if (!originStock || (typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(originStock, 'onHand'))) return null;
		var route = candidate.path.edges[0];
		var remaining = routeRemaining(sector, logistics, findRoute(sector, route.routeId), route.fromSystemId, route.toSystemId, turn);
		var unitsPerLot = freightUnits(sector, candidate.commodityId);
		var quantity = round(Math.min(candidate.quantity, remaining / unitsPerLot));
		var destinationMarket = marketById(sector, candidate.destination.id);
		var destinationState = marketState(sector, candidate.destination.id);
		var originPrice = marketUnitPrice(candidate.origin, originState, candidate.commodityId);
		var destinationPrice = marketUnitPrice(destinationMarket, destinationState, candidate.commodityId);
		var negotiatedPrice = candidate.contractPriceCr > 0 ? round(candidate.contractPriceCr) : round((originPrice + destinationPrice) / 2);
		if (quantity <= EPSILON) return null;
		originStock.onHand = round(Math.max(0, originStock.onHand - quantity));
		originStock.lastExportTurn = turn;
		originStock.source = 'simulated';
		var shipment = {
			id:nextId(logistics, 'SHIP-'),
			commodityId:candidate.commodityId,
			contractId:candidate.contractId || '',
			saleUnitPriceCr:negotiatedPrice,
			sellerAskCr:originPrice,
			buyerLocalPriceCr:destinationPrice,
			commodityPaidQuantity:0, commodityPaidCr:0, commoditySettlementIds:[],
			quantity:quantity,
			remainingQuantity:quantity,
			deliveredQuantity:0,
			cargoUnits:round(quantity * unitsPerLot),
			originMarketId:candidate.origin.id,
			destinationMarketId:candidate.destination.id,
			originSystemId:candidate.origin.systemId,
			destinationSystemId:candidate.destination.systemId,
			currentSystemId:candidate.origin.systemId,
			routeIds:candidate.path.edges.map(function(edge) { return edge.routeId; }),
			currentLegIndex:0,
			legs:[],
			status:'awaiting-capacity',
			departedTurn:null,
			estimatedArrivalTurn:null,
			ownerFactionId:controllerFor(sector, candidate.origin.systemId) || '',
			freightCost:0,
			tollCost:0,
			tariffCost:0,
			riskPercent:0,
			source:'simulated',
			createdTurn:turn,
			delayReason:''
		};
		logistics.shipments.push(shipment);
		syncSequenceCache(logistics);
		if (!dispatchLeg(sector, logistics, shipment, turn) || !shipment.legs.length) {
			originStock.onHand = round(originStock.onHand + quantity);
			logistics.shipments = logistics.shipments.filter(function(item) { return item !== shipment; });
			syncSequenceCache(logistics);
			return null;
		}
		var originLedger = marketState(sector, candidate.origin.id); originLedger.logisticsLedger = arr(originLedger.logisticsLedger);
		var exportEntry = addLogisticsLedger(sector, logistics, {turn:turn, type:'export', shipmentId:shipment.id, marketId:candidate.origin.id, commodityId:candidate.commodityId, quantity:quantity});
		originLedger.logisticsLedger.push(clone(exportEntry));
		addLogisticsLedger(sector, logistics, {turn:turn, type:'order-created', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, commodityId:shipment.commodityId, quantity:quantity, saleUnitPriceCr:shipment.saleUnitPriceCr, contractId:shipment.contractId, routeIds:shipment.routeIds.slice()});
		if (shipment.contractId && typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.recordDispatch) SectorTradeContracts.recordDispatch(sector, shipment.contractId, shipment, quantity, turn);
		logEvent(sector, {type:'shipment-dispatched', summary:quantity + ' lots of ' + candidate.commodityId + ' dispatched from ' + candidate.origin.planetName + ' toward ' + candidate.destination.planetName + ' via ' + shipment.routeIds.length + ' route leg(s).', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, commodityId:candidate.commodityId, quantity:quantity, routeIds:shipment.routeIds.slice()});
		return shipment;
	}

	function getMarketGood(market, commodityId) { return goodLine(market, commodityId); }

	function buildCandidates(sector, logistics) {
		var economy = getEconomy(sector), markets = arr(sector.markets), states = new Map(arr(economy.marketStates).map(function(state) { return [String(state.marketId), state]; }));
		var exportsByMarket = new Map(), needsByMarket = new Map(), candidates = [], pathCache = new Map(), graphCache = new Map(), searchCache = new Map();
		// Pending cargo is aggregated once, rather than rescanning every shipment for
		// every market/commodity inventory line (a quadratic hot path on large sectors).
		var inboundByMarketCommodity = buildPendingInboundIndex(logistics);
		markets.forEach(function(market) {
			var state = states.get(String(market.id));
			if (!state || !state.initialized) return;
			arr(state.inventory).forEach(function(stock) {
				var id = stock.commodityId;
				if (typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(stock, 'onHand')) return;
				var onHand = num(stock.onHand, 0, 0), reserved = num(stock.reserved, 0, 0), target = Math.max(1, num(stock.targetStock, 1, 1));
				var outbound = Math.max(0, round(onHand - Math.max(reserved, target * 1.15)));
				var inbound = pendingInbound(inboundByMarketCommodity, String(market.id), id);
				var deficit = Math.max(0, round(target * 0.7 - onHand - inbound));
				if (outbound > 0.05) exportsByMarket.set(String(market.id) + '|' + id, outbound);
				if (deficit > 0.05) needsByMarket.set(String(market.id) + '|' + id, deficit);
			});
		});
		markets.forEach(function(origin) {
			var originState = states.get(String(origin.id));
			if (!originState) return;
			arr(originState.inventory).forEach(function(stock) {
				var key = String(origin.id) + '|' + stock.commodityId;
				var available = exportsByMarket.get(key) || 0;
				if (available <= 0.05) return;
				markets.forEach(function(destination) {
					if (destination.id === origin.id || String(destination.systemId) === String(origin.systemId)) return;
					var needKey = String(destination.id) + '|' + stock.commodityId;
					var needed = needsByMarket.get(needKey) || 0;
					if (needed <= 0.05) return;
					var basePrice = commodityBasePrice(destination, stock.commodityId);
					var cacheKey = [String(origin.systemId),String(destination.systemId),stock.commodityId,basePrice].join('|');
					var path = pathCache.get(cacheKey);
					if (path === undefined) {
						var graphKey = stock.commodityId + '|' + basePrice;
						var graph = graphCache.get(graphKey);
						if (!graph) { graph = buildGraph(sector, logistics, stock.commodityId, basePrice); graphCache.set(graphKey, graph); }
						var searchKey = String(origin.systemId) + '|' + graphKey;
						var search = searchCache.get(searchKey);
						if (!search) { search = shortestPathsFrom(graph, origin.systemId); searchCache.set(searchKey, search); }
						path = findPath(sector, logistics, origin.systemId, destination.systemId, stock.commodityId, basePrice, graph, search);
						pathCache.set(cacheKey, path);
					}
					if (!path || !path.edges.length) return;
					var destinationState = states.get(String(destination.id));
					var importPriority = typeof SectorStrategic !== 'undefined' && SectorStrategic.getMarketImportPriority ? SectorStrategic.getMarketImportPriority(destinationState) : 'normal';
					var priorityWeight = importPriority === 'emergency' ? 80 : (importPriority === 'high' ? 30 : (importPriority === 'low' ? -15 : 0));
					var contractInfo = typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.getMatchingContract ? SectorTradeContracts.getMatchingContract(sector, origin.id, destination.id, stock.commodityId, logistics.clock.dispatchProcessedTurn + 1) : null;
					var basePriority = path.score - Math.min(20, needed) * 0.05 - priorityWeight;
					if (contractInfo) {
						var contractedQuantity = Math.min(available, needed, contractInfo.remainingQuantity);
						var contractWeight = ({critical:180,high:90,standard:25,low:-5}[contractInfo.priority] || 0);
						if (contractedQuantity > 0.05) candidates.push({origin:origin,destination:destination,commodityId:stock.commodityId,quantity:contractedQuantity,path:path,importPriority:importPriority,contractId:contractInfo.contract.id,contractPriceCr:contractInfo.unitPriceCr,priority:basePriority-contractWeight});
						// A contract sets the committed volume, not a blanket ban on spot
						// trade. Remaining surplus may still satisfy additional demand.
						var spotQuantity = Math.min(Math.max(0, available-contractedQuantity), Math.max(0, needed-contractedQuantity));
						if (spotQuantity > 0.05) candidates.push({origin:origin,destination:destination,commodityId:stock.commodityId,quantity:spotQuantity,path:path,importPriority:importPriority,contractId:'',contractPriceCr:0,priority:basePriority+0.001});
					} else {
						var plannedQuantity = Math.min(available, needed);
						if (plannedQuantity > 0.05) candidates.push({origin:origin,destination:destination,commodityId:stock.commodityId,quantity:plannedQuantity,path:path,importPriority:importPriority,contractId:'',contractPriceCr:0,priority:basePriority});
					}
				});
			});
		});
		candidates.sort(function(a,b) { return a.priority-b.priority || b.quantity-a.quantity || String(a.origin.id).localeCompare(String(b.origin.id)) || String(a.destination.id).localeCompare(String(b.destination.id)); });
		return {candidates:candidates, exportsByMarket:exportsByMarket, needsByMarket:needsByMarket};
	}

	function shipmentCompletionTurn(shipment) {
		var values = [shipment && shipment.deliveredTurn, shipment && shipment.closedTurn, shipment && shipment.completedTurn, shipment && shipment.updatedTurn, shipment && shipment.createdTurn];
		for (var i = 0; i < values.length; i++) {
			if (values[i] != null && Number.isFinite(Number(values[i]))) return Math.max(0, Math.floor(Number(values[i])));
		}
		var legs = arr(shipment && shipment.legs);
		if (legs.length) {
			var last = legs[legs.length - 1];
			if (last && last.arrivalTurn != null && Number.isFinite(Number(last.arrivalTurn))) return Math.max(0, Math.floor(Number(last.arrivalTurn)));
		}
		return null;
	}

	function shipmentArchiveSummary(shipment, completionTurn) {
		return {
			id:String(shipment.id), status:String(shipment.status), createdTurn:int(shipment.createdTurn, completionTurn, 0),
			completedTurn:completionTurn, deliveredTurn:shipment.deliveredTurn == null ? null : int(shipment.deliveredTurn, completionTurn, 0),
			commodityId:String(shipment.commodityId || ''), originMarketId:String(shipment.originMarketId || ''), destinationMarketId:String(shipment.destinationMarketId || ''),
			originSystemId:String(shipment.originSystemId || ''), destinationSystemId:String(shipment.destinationSystemId || ''), ownerFactionId:String(shipment.ownerFactionId || ''),
			contractId:String(shipment.contractId || ''), quantity:num(shipment.quantity, 0, 0), remainingQuantity:num(shipment.remainingQuantity, 0, 0),
			deliveredQuantity:num(shipment.deliveredQuantity, 0, 0), commodityPaidQuantity:num(shipment.commodityPaidQuantity, 0, 0),
			commodityPaidCr:num(shipment.commodityPaidCr, 0, 0), commoditySettlementIds:arr(shipment.commoditySettlementIds).map(String),
			saleUnitPriceCr:num(shipment.saleUnitPriceCr, 0, 0), lastChronicleEventId:String(shipment.lastChronicleEventId || '')
		};
	}

	API.compactShipments = function(sector, requestedLimit) {
		var logistics = ensure(sector), limit = Math.max(10, Math.min(100000, int(requestedLimit, 1000, 10)));
		var currentTurn = int(sector && sector.simulation && sector.simulation.clock && sector.simulation.clock.turn, sector && sector.factionTurn || 0, 0);
		var terminal = arr(logistics.shipments).filter(function(shipment) { return shipment && ['delivered','cancelled','lost','stranded'].indexOf(String(shipment.status)) >= 0; });
		if (terminal.length <= limit) return {archived:0, retained:terminal.length, limit:limit};
		var candidates = terminal.map(function(shipment) { return {shipment:shipment, turn:shipmentCompletionTurn(shipment)}; })
			.filter(function(item) { return item.turn != null && item.turn < currentTurn; })
			.sort(function(a,b) { return a.turn - b.turn || String(a.shipment.id).localeCompare(String(b.shipment.id)); });
		var excess = terminal.length - limit, count = Math.min(excess, candidates.length);
		if (!count) return {archived:0, retained:terminal.length, limit:limit};
		var archive = logistics.shipmentArchive, removeIds = new Set();
		for (var i = 0; i < count; i++) {
			var shipment = candidates[i].shipment, turn = candidates[i].turn, key = '$' + String(shipment.id);
			if (archive.shipments[key]) continue;
			// Keep the complete terminal shipment, including route legs, incidents,
			// costs and causal event links. The compact summary fields remain on
			// the record for existing reconciliation and reporting consumers.
			archive.shipments[key] = Object.assign({}, JSON.parse(JSON.stringify(shipment)), shipmentArchiveSummary(shipment, turn), {completedTurn:turn, archivedAtTurn:currentTurn});
			archive.archivedCount = int(archive.archivedCount, 0, 0) + 1;
			archive.firstTurn = archive.firstTurn == null ? turn : Math.min(int(archive.firstTurn, turn, 0), turn);
			archive.lastTurn = Math.max(int(archive.lastTurn, 0, 0), turn);
			var statusKey = '$' + String(shipment.status);
			archive.byStatus[statusKey] = int(archive.byStatus[statusKey], 0, 0) + 1;
			archive.totalDeliveredLots = round(num(archive.totalDeliveredLots, 0, 0) + num(shipment.deliveredQuantity, 0, 0));
			archive.totalPaidLots = round(num(archive.totalPaidLots, 0, 0) + num(shipment.commodityPaidQuantity, 0, 0));
			archive.totalPaidCr = round(num(archive.totalPaidCr, 0, 0) + num(shipment.commodityPaidCr, 0, 0));
			var sequence = String(shipment.id).match(/(\d+)$/);
			if (sequence) archive.latestSequence = Math.max(int(archive.latestSequence, 0, 0), int(sequence[1], 0, 0));
			removeIds.add(String(shipment.id));
		}
		if (removeIds.size) { logistics.shipments = logistics.shipments.filter(function(shipment) { return !removeIds.has(String(shipment && shipment.id || '')); }); syncSequenceCache(logistics); }
		return {archived:removeIds.size, retained:terminal.length - removeIds.size, limit:limit};
	};

	API.initialize = function(sector) {
		var logistics = ensure(sector);
		return {ok:true, shipments:logistics.shipments.length, turn:logistics.clock.dispatchProcessedTurn};
	};

	API.processArrivals = function(sector, turnNumber) {
		var logistics = ensure(sector), turn = int(turnNumber, 0, 0);
		if (turn <= int(logistics.clock.arrivalsProcessedTurn, 0, 0)) return {ok:true, skipped:true, arrivals:0, turn:turn};
		if (logistics.clock.capacityUsageTurn !== turn) {
			logistics.clock.capacityUsageTurn = turn;
			logistics.capacityUsage = {};
		}
		var arrivals = 0, delivered = 0;
		arr(logistics.shipments).slice().sort(function(a,b) { return String(a.id).localeCompare(String(b.id)); }).forEach(function(shipment) {
			if (shipment.status === 'in-transit' || shipment.status === 'delayed') {
				var leg = arr(shipment.legs)[shipment.legs.length - 1];
				// A delayed shipment can mean either a leg still in transit or a
				// shipment stranded between legs. Only the former may be processed
				// as a new arrival; otherwise we would count the same leg repeatedly.
				if (!leg || leg.status !== 'in-transit' || int(leg.arrivalTurn, Number.MAX_SAFE_INTEGER, 0) > turn) return;
				leg.status = 'arrived';
				shipment.currentSystemId = leg.toSystemId;
				shipment.currentLegIndex = Math.max(0, int(shipment.currentLegIndex, 0, 0) + 1);
				shipment.currentLegArrivalTurn = null;
				arrivals++;
				addLogisticsLedger(sector, logistics, {turn:turn, type:'leg-arrival', shipmentId:shipment.id, routeId:leg.routeId, systemId:leg.toSystemId, quantity:shipment.remainingQuantity});
				if (shipment.currentLegIndex >= arr(shipment.routeIds).length || String(shipment.currentSystemId) === String(shipment.destinationSystemId)) {
					delivered += attemptDelivery(sector, logistics, shipment, turn);
				} else {
					shipment.status = 'awaiting-capacity';
					shipment.delayReason = '';
				}
			}
			if (shipment.status === 'awaiting-storage') delivered += attemptDelivery(sector, logistics, shipment, turn);
		});
		logistics.clock.arrivalsProcessedTurn = turn;
		return {ok:true, skipped:false, arrivals:arrivals, delivered:round(delivered), turn:turn};
	};

	API.planAndDispatch = function(sector, turnNumber) {
		var logistics = ensure(sector), turn = int(turnNumber, 0, 0);
		if (turn <= int(logistics.clock.dispatchProcessedTurn, 0, 0)) return {ok:true, skipped:true, dispatched:0, turn:turn};
		if (logistics.clock.capacityUsageTurn !== turn) { logistics.clock.capacityUsageTurn = turn; logistics.capacityUsage = {}; }
		var dispatched = 0, legsStarted = 0;
		arr(logistics.shipments).slice().filter(function(shipment) { var lastLeg = arr(shipment.legs)[arr(shipment.legs).length - 1]; return shipment.status === 'awaiting-capacity' || (shipment.status === 'delayed' && (!lastLeg || lastLeg.status === 'arrived')); }).sort(function(a,b) { return String(a.id).localeCompare(String(b.id)); }).forEach(function(shipment) {
			if (shipment.currentSystemId === shipment.destinationSystemId) { attemptDelivery(sector, logistics, shipment, turn); return; }
			var before = arr(shipment.legs).length;
			if (dispatchLeg(sector, logistics, shipment, turn) && arr(shipment.legs).length > before) legsStarted++;
		});
		var planning = buildCandidates(sector, logistics);
		for (var i = 0; i < planning.candidates.length && dispatched < MAX_NEW_SHIPMENTS_PER_TURN; i++) {
			var candidate = planning.candidates[i];
			var exportKey = String(candidate.origin.id) + '|' + candidate.commodityId;
			var needKey = String(candidate.destination.id) + '|' + candidate.commodityId;
			var available = planning.exportsByMarket.get(exportKey) || 0;
			var needed = planning.needsByMarket.get(needKey) || 0;
			candidate.quantity = Math.min(candidate.quantity, available, needed);
			if (candidate.quantity <= 0.05) continue;
			var shipment = startShipment(sector, logistics, candidate, turn);
			if (!shipment) continue;
			planning.exportsByMarket.set(exportKey, round(available - shipment.quantity));
			planning.needsByMarket.set(needKey, round(needed - shipment.quantity));
			dispatched++;
		}
		logistics.clock.dispatchProcessedTurn = turn;
		logistics.clock.lastProcessedTurn = turn;
		return {ok:true, skipped:false, dispatched:dispatched, legsStarted:legsStarted, activeShipments:arr(logistics.shipments).filter(function(s) { return ['delivered','cancelled','lost','stranded'].indexOf(s.status) < 0; }).length, turn:turn};
	};

	API.getPath = function(sector, fromSystemId, toSystemId, commodityId) {
		var logistics = ensure(sector), path = findPath(sector, logistics, fromSystemId, toSystemId, commodityId || '', 100);
		return path ? {reachable:true, routeIds:path.edges.map(function(edge) { return edge.routeId; }), systemIds:[String(fromSystemId)].concat(path.edges.map(function(edge) { return edge.toSystemId; })), transitTurns:path.transitTurns, freightCostPerUnit:path.freightCostPerUnit, tariffCostPerUnit:path.tariffCostPerUnit, riskPercent:path.riskPercent, score:path.score} : {reachable:false, routeIds:[], systemIds:[], transitTurns:0, freightCostPerUnit:0, tariffCostPerUnit:0, riskPercent:0};
	};

	API.invalidatePathCache = function(sector) { if (sector && typeof sector === 'object') pathRuntimeCaches.delete(sector); return true; };
	API.getPathCacheStats = function(sector) { var cache = sector && pathRuntimeCaches.get(sector); return cache ? {turn:cache.turn, graphs:cache.graphs.size, searches:cache.searches.size} : {turn:null, graphs:0, searches:0}; };
	API.getRouteProfile = function(route, sector) { return routeProfile(route, sector, sector && sector.factionTurn); };
	API.getCommodityFreightUnits = function(sector, commodityId) { return freightUnits(sector, commodityId); };
	API.getShipments = function(sector) { var logistics = getEconomy(sector) && getEconomy(sector).logistics; return arr(logistics && logistics.shipments); };
	API.getSummary = function(sector) {
		var logistics = getEconomy(sector) && getEconomy(sector).logistics;
		var shipments = arr(logistics && logistics.shipments);
		var archive = logistics && logistics.shipmentArchive || {}; return {initialized:!!(logistics && logistics.schemaVersion === SCHEMA_VERSION), total:shipments.length+int(archive.archivedCount,0,0), retained:shipments.length, archived:int(archive.archivedCount,0,0), inTransit:shipments.filter(function(s) { return s.status === 'in-transit' || s.status === 'delayed'; }).length, awaitingCapacity:shipments.filter(function(s) { return s.status === 'awaiting-capacity'; }).length, awaitingStorage:shipments.filter(function(s) { return s.status === 'awaiting-storage'; }).length, delivered:shipments.filter(function(s) { return s.status === 'delivered'; }).length+int(archive.byStatus && archive.byStatus.$delivered,0,0), purchasedLots:round(num(archive.totalPaidLots,0,0)+shipments.reduce(function(n,s) { return n + num(s.commodityPaidQuantity,0,0); },0)), commodityValueCr:round(num(archive.totalPaidCr,0,0)+shipments.reduce(function(n,s) { return n + num(s.commodityPaidCr,0,0); },0)), turn:int(logistics && logistics.clock && logistics.clock.dispatchProcessedTurn, 0, 0)};
	};

	API.validate = function(sector) {
		var errors = [], warnings = [], economy = getEconomy(sector), logistics = economy && economy.logistics;
		if (!logistics) return {ok:true, errors:errors, warnings:['Logistics has not been initialized.']};
		var ids = new Set();
		arr(logistics.shipments).forEach(function(shipment) {
			if (!shipment.id) errors.push('Shipment is missing a stable ID.');
			if (ids.has(shipment.id)) errors.push('Duplicate shipment ID ' + shipment.id + '.');
			ids.add(shipment.id);
			if (!marketById(sector, shipment.originMarketId)) warnings.push('Shipment ' + shipment.id + ' references a missing origin market.');
			if (!marketById(sector, shipment.destinationMarketId)) warnings.push('Shipment ' + shipment.id + ' references a missing destination market.');
			if (!(Number(shipment.quantity) > 0) || Number(shipment.remainingQuantity) < -EPSILON || Number(shipment.remainingQuantity) > Number(shipment.quantity) + EPSILON) errors.push('Shipment ' + shipment.id + ' has invalid cargo quantities.');
			if (!Number.isFinite(Number(shipment.saleUnitPriceCr)) || Number(shipment.saleUnitPriceCr) < 0) errors.push('Shipment ' + shipment.id + ' has an invalid recorded sale price.');
			if (Number(shipment.commodityPaidQuantity || 0) > Number(shipment.deliveredQuantity || 0) + 0.011) errors.push('Shipment ' + shipment.id + ' has been paid for more cargo than delivered.');
			if (!['awaiting-capacity','in-transit','delayed','awaiting-storage','delivered','cancelled','lost','stranded'].includes(shipment.status)) errors.push('Shipment ' + shipment.id + ' has unknown status ' + shipment.status + '.');
			arr(shipment.legs).forEach(function(leg, index) {
				if (!findRoute(sector, leg.routeId) && leg.status !== 'arrived') warnings.push('Shipment ' + shipment.id + ' leg ' + index + ' references removed route ' + leg.routeId + '.');
				if (leg.arrivalTurn < leg.departedTurn) errors.push('Shipment ' + shipment.id + ' leg arrives before departure.');
				if (!Number.isFinite(Number(leg.cargoUnits)) || Number(leg.cargoUnits) < 0) errors.push('Shipment ' + shipment.id + ' leg has invalid freight-unit usage.');
				if (!Number.isFinite(Number(leg.operatingCost || 0)) || Number(leg.operatingCost || 0) < 0) errors.push('Shipment ' + shipment.id + ' leg has invalid operating cost.');
			});
		});
		var shipmentArchive = obj(logistics.shipmentArchive) ? logistics.shipmentArchive : {}, archivedShipments = obj(shipmentArchive.shipments) ? shipmentArchive.shipments : {};
		Object.keys(archivedShipments).forEach(function(key) {
			var shipment = archivedShipments[key];
			if (!shipment || !shipment.id) { errors.push('Archived shipment record is missing a stable ID.'); return; }
			if (ids.has(String(shipment.id))) errors.push('Duplicate retained/archived shipment ID ' + shipment.id + '.');
			ids.add(String(shipment.id));
			if (!['delivered','cancelled','lost','stranded'].includes(String(shipment.status))) errors.push('Archived shipment ' + shipment.id + ' has non-terminal status.');
			if (!(Number(shipment.quantity) > 0) || Number(shipment.remainingQuantity) < -EPSILON || Number(shipment.remainingQuantity) > Number(shipment.quantity) + EPSILON) errors.push('Archived shipment ' + shipment.id + ' has invalid cargo quantities.');
			if (Number(shipment.commodityPaidQuantity || 0) > Number(shipment.deliveredQuantity || 0) + 0.011) errors.push('Archived shipment ' + shipment.id + ' has been paid for more cargo than delivered.');
		});
		return {ok:errors.length === 0, errors:errors, warnings:warnings, counts:{shipments:arr(logistics.shipments).length, archivedShipments:Object.keys(archivedShipments).length, ledger:arr(logistics.ledger).length}};
	};

	API.constants = {schemaVersion:SCHEMA_VERSION, engineVersion:ENGINE_VERSION, maxNewShipmentsPerTurn:MAX_NEW_SHIPMENTS_PER_TURN};
	return API;
})();
