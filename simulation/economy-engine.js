/*
 * Sector Forge 1.3.8 — local market economy and turn coordinator.
 *
 * First playable economy slice: explicit market-account initialization,
 * production, consumption, inventory accounting, bounded scarcity pricing,
 * field-level GM overrides, and Chronicle/ledger integration. The logistics engine runs before and after this phase to process arrivals
 * and commit cross-market departures as separately recorded stock movements.
 */
var SectorEconomy = (function() {
	'use strict';

	var API = {};
	var ECONOMY_SCHEMA_VERSION = 1;
	var ENGINE_VERSION = '1.3.8';
	var PRICE_MIN = 40;
	var PRICE_MAX = 300;
	var PRICE_STEP = 8;

	function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
	function asArray(value) { return Array.isArray(value) ? value : []; }
	function finite(value, fallback, minimum) {
		var number = Number(value);
		if (!Number.isFinite(number)) return fallback;
		return Math.max(minimum == null ? 0 : minimum, number);
	}
	function integer(value, fallback, minimum) { return Math.floor(finite(value, fallback, minimum)); }
	function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
	function roundQuantity(value) { return Math.round(finite(value, 0, 0) * 100) / 100; }
	function slug(value) { return String(value || 'commodity').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'commodity'; }
	function cloneJSON(value) { return JSON.parse(JSON.stringify(value)); }

	function ensureEconomy(sector) {
		if (!isObject(sector.simulation)) {
			if (typeof SectorSimulation === 'undefined' || !SectorSimulation.migrateSector) throw new Error('SectorSimulation is required before initializing the economy.');
			SectorSimulation.migrateSector(sector, {sourceApplicationVersion:ENGINE_VERSION});
		}
		var simulation = sector.simulation;
		simulation.economy = isObject(simulation.economy) ? simulation.economy : {};
		var economy = simulation.economy;
		economy.schemaVersion = ECONOMY_SCHEMA_VERSION;
		economy.engineVersion = ENGINE_VERSION;
		economy.marketStates = asArray(economy.marketStates);
		economy.ledger = asArray(economy.ledger);
		economy.clock = isObject(economy.clock) ? economy.clock : {};
		economy.clock.turn = integer(economy.clock.turn, integer(simulation.clock && simulation.clock.turn, 0, 0), 0);
		economy.clock.lastAdvancedTurn = integer(economy.clock.lastAdvancedTurn, economy.clock.turn, 0);
		economy.nextLedgerSequence = Math.max(integer(economy.nextLedgerSequence, economy.ledger.length + 1, 1), economy.ledger.length + 1);
		return economy;
	}

	function freightProfile(category) {
		var profiles = {
			Agricultural:{units:1.4, storage:'perishable'}, Food:{units:1.25, storage:'perishable'},
			Medical:{units:0.65, storage:'controlled'}, Industrial:{units:2.0, storage:'standard'},
			Technology:{units:0.45, storage:'secure'}, Energy:{units:1.8, storage:'hazardous'},
			Bulk:{units:3.2, storage:'bulk'}, Cultural:{units:0.75, storage:'fragile'},
			Luxury:{units:0.5, storage:'secure'}, Mineral:{units:3.5, storage:'bulk'},
			Biological:{units:0.9, storage:'controlled'}, Consumer:{units:1.1, storage:'standard'},
			Restricted:{units:0.85, storage:'secure'}, Salvage:{units:2.5, storage:'bulk'}
		};
		return profiles[String(category || '')] || {units:1, storage:'standard'};
	}
	function getCatalogue(sector) {
		var byId = new Map(), economy = sector && sector.simulation && sector.simulation.economy;
		var existing = new Map(asArray(economy && economy.commodities).map(function(item) { return [item.id, item]; }));
		function add(good, source) {
			var id = slug(good.name || good.id), category = String(good.category || 'General'), profile = freightProfile(category);
			var generated = {id:id, name:String(good.name || id), category:category, unit:'trade-lot', basePrice:finite(good.basePrice, 100, 1), freightUnitsPerLot:profile.units, storageClass:profile.storage, canBeProduced:true, canBeConsumed:true, source:source};
			var old = existing.get(id);
			if (old) {
				var overrides = Object.assign({}, old.manualOverrides || {}, old.fieldOverrides || {});
				['unit','canBeProduced','canBeConsumed'].forEach(function(field) { if (old[field] != null) generated[field] = old[field]; });
				if (overrides.freightUnitsPerLot === true) generated.freightUnitsPerLot = finite(old.freightUnitsPerLot, profile.units, 0.01);
				if (overrides.storageClass === true) generated.storageClass = String(old.storageClass || profile.storage);
				generated.fieldOverrides = overrides;
				generated.provenance = old.provenance || old.source || 'catalogue';
			}
			byId.set(id, generated);
		}
		var definitions = typeof CampaignTools !== 'undefined' && Array.isArray(CampaignTools.TRADE_GOODS) ? CampaignTools.TRADE_GOODS : [];
		definitions.forEach(function(good) { add(good, 'catalogue'); });
		asArray(sector.markets).forEach(function(market) { asArray(market.goods).forEach(function(good) { if (!byId.has(slug(good.name || good.id))) add(good, 'sector-custom'); }); });
		return Array.from(byId.values()).sort(function(a, b) { return a.id.localeCompare(b.id); });
	}

	var POPULATION_FACTORS = {
		'failed colony':0.25,
		'outpost':0.4,
		'fewer than a million inhabitants':0.65,
		'several million inhabitants':1,
		'hundreds of millions of inhabitants':1.8,
		'billions of inhabitants':2.8,
		'alien inhabitants':0.9
	};

	var PROFILE_PRODUCTION = {
		'Agrarian exporter':{Agricultural:2.7, Food:2.3, Biological:0.8},
		'Industrial exchange':{Industrial:2.5, Technology:1.7, Mineral:0.7},
		'Luxury market':{Luxury:2.4, Cultural:1.8, Consumer:0.8},
		'Salvage bazaar':{Salvage:2.8, Mineral:1.3, Cultural:0.9, Industrial:0.6},
		'Transit hub':{Consumer:0.8, Food:0.5, Industrial:0.5},
		'Regulated port':{Industrial:0.7, Consumer:0.7, Restricted:0.5},
		'Informal bazaar':{Consumer:1.1, Cultural:0.9, Salvage:0.7},
		'Frontier depot':{Bulk:1.1, Food:0.6, Industrial:0.4}
	};

	// Deliberate exact SWN tag mappings. This intentionally avoids trying to
	// infer economic meaning from free-text descriptions.
	var TAG_PRODUCTION = {
		'Heavy Industry':['Industrial','Technology'],
		'Heavy Mining':['Mineral','Industrial'],
		'Major Spaceyard':['Technology','Industrial'],
		'Trade Hub':['Consumer','Industrial','Food'],
		'Desert World':['Bulk','Energy'],
		'Oceanic World':['Agricultural','Food'],
		'Seagoing Cities':['Agricultural','Food'],
		'Badlands World':['Mineral'],
		'Gold Rush':['Mineral','Salvage'],
		'Local Specialty':['Cultural','Luxury'],
		'Local Tech':['Technology'],
		'Robots':['Technology','Industrial'],
		'Post-Scarcity':['Technology','Biological'],
		'Outpost World':['Bulk','Food'],
		'Refugees':['Food','Medical'],
		'Pretech Cultists':['Salvage','Technology'],
		'Feral World':['Agricultural','Biological'],
		'Pleasure World':['Luxury','Cultural'],
		'Urbanized Surface':['Industrial','Consumer'],
		'Former Warriors':['Restricted','Industrial'],
		'Quarantined World':['Medical','Biological'],
		'Freak Geology':['Mineral','Industrial'],
		'Freak Weather':['Energy','Bulk'],
		'Cheap Life':['Biological','Food'],
		'Great Work':['Industrial','Technology'],
		'Exchange Consulate':['Consumer','Cultural']
	};

	function populationFactor(market) {
		var label = String(market && market.population || '').toLowerCase().trim();
		if (POPULATION_FACTORS[label] != null) return POPULATION_FACTORS[label];
		// Legacy labels were normalized by CampaignTools.ensureIds; unknown labels
		// remain conservative rather than being treated as large populations.
		return 0.65;
	}

	function techFactor(market) {
		var match = String(market && market.techLevel || '3').match(/\d+/);
		var level = match ? Number(match[0]) : 3;
		return clamp(0.55 + level * 0.14, 0.55, 1.3);
	}

	function categoryDemand(category, population, tech) {
		var weights = {
			Agricultural:1.1, Food:1.25, Medical:0.22, Industrial:0.32 * tech,
			Technology:0.16 * tech, Energy:0.3 * tech, Bulk:0.35,
			Cultural:0.1, Luxury:0.08, Mineral:0.12 * tech, Biological:0.18,
			Consumer:0.3, Restricted:0.06, Salvage:0.05
		};
		return Math.max(0.1, population * (weights[category] == null ? 0.12 : weights[category]));
	}

	function productionMultiplier(market, category) {
		var profile = PROFILE_PRODUCTION[String(market.profile || '')] || {};
		var multiplier = finite(profile[category], 0, 0);
		asArray(market.traits).forEach(function(tag) {
			var categories = TAG_PRODUCTION[String(tag || '')] || [];
			if (categories.indexOf(category) >= 0) multiplier += 1.45;
		});
		if (market.controlFactionId) multiplier *= 1.04;
		return multiplier;
	}

	function findPlanet(sector, market) {
		for (var i = 0; i < asArray(sector.systems).length; i++) {
			var system = sector.systems[i];
			var planet = asArray(system.planets).find(function(item) { return item && item.id === market.planetId; });
			if (planet) return planet;
		}
		return null;
	}

	function buildMarketState(sector, market, catalogue, turn) {
		var planet = findPlanet(sector, market);
		var population = populationFactor(market);
		var tech = techFactor(market);
		var goodsById = new Map();
		asArray(market.goods).forEach(function(good) { goodsById.set(slug(good.name || good.id), good); });
		var production = [], consumption = [], inventory = [], prices = [];
		var random = SectorSimulation.createRandomStream(sector, {turn:turn, phase:'economy.initial-stock', scope:String(market.id)});

		catalogue.forEach(function(commodity) {
			var good = goodsById.get(commodity.id);
			if (!good) return;
			var demand = categoryDemand(commodity.category, population, tech);
			if (planet && (String(planet.tag1 || '') === 'Post-Scarcity' || String(planet.tag2 || '') === 'Post-Scarcity')) demand *= 0.35;
			if (planet && (String(planet.tag1 || '') === 'Refugees' || String(planet.tag2 || '') === 'Refugees') && ['Food','Medical','Agricultural'].indexOf(commodity.category) >= 0) demand *= 1.5;
			demand = roundQuantity(demand);
			var outputMultiplier = productionMultiplier(market, commodity.category);
			var output = outputMultiplier > 0 ? roundQuantity(Math.max(0.1, population * tech * outputMultiplier * 0.48)) : 0;
			var reason = [];
			if (outputMultiplier > 0) {
				if ((PROFILE_PRODUCTION[String(market.profile || '')] || {})[commodity.category]) reason.push('market profile: ' + market.profile);
				asArray(market.traits).forEach(function(tag) { if ((TAG_PRODUCTION[String(tag || '')] || []).indexOf(commodity.category) >= 0) reason.push('world tag: ' + tag); });
			}
			if (output > 0) production.push({commodityId:commodity.id, quantityPerTurn:output, generatedQuantityPerTurn:output, source:'generated', reason:reason.join('; ') || 'local specialization'});
			consumption.push({commodityId:commodity.id, quantityPerTurn:demand, generatedQuantityPerTurn:demand, source:'generated', reason:'population and category demand'});

			var targetStock = Math.max(2, roundQuantity(demand * 4 + output * 1.5));
			// Opening inventory is a new explicit simulation baseline. Legacy supply
			// labels are deliberately not consulted or converted into quantities.
			var stockFactor = 0.75 + SectorSimulation.nextRandom(random) * 0.5;
			var onHand = Math.min(targetStock * 3, roundQuantity(targetStock * stockFactor));
			inventory.push({commodityId:commodity.id, onHand:onHand, reserved:0, targetStock:targetStock, storageCapacity:roundQuantity(Math.max(targetStock * 3, onHand + output * 2)), averageUnitCost:finite(good.basePrice, commodity.basePrice, 1), source:'simulated'});

			var index = clamp(integer(good.priceIndex, 100, 1), PRICE_MIN, PRICE_MAX);
			var referenceIndex = clamp(integer(good.basePriceIndex, index, 1), PRICE_MIN, PRICE_MAX);
			prices.push({commodityId:commodity.id, referencePrice:finite(good.basePrice, commodity.basePrice, 1), referencePriceIndex:referenceIndex, currentPriceIndex:index, targetPriceIndex:index, lastTurnChange:0, source:'generated'});
		});

		return {
			marketId:String(market.id), systemId:String(market.systemId || ''), planetId:String(market.planetId || ''), initialized:true, initializedAtTurn:turn, source:'generated',
			populationFactor:population, techFactor:tech,
			production:production, consumption:consumption, inventory:inventory, prices:prices,
			policies:{importPriority:'normal', exportPriority:'normal'}, ledger:[], lastAdvancedTurn:turn
		};
	}

	function getInventory(state, commodityId) { return asArray(state && state.inventory).find(function(item) { return item.commodityId === commodityId; }) || null; }
	function getPrice(state, commodityId) { return asArray(state && state.prices).find(function(item) { return item.commodityId === commodityId; }) || null; }

	/*
	 * Cross-market competition is based on actual reachable surplus and unmet
	 * demand, not simply the existence/count of trade routes. It remains a
	 * bounded index signal: cargo still has to ship and arrive before stock
	 * changes. The same trade graph and diplomatic rules used by dispatch are
	 * queried, so blocked or one-way lanes do not create imaginary suppliers.
	 */
	function buildNetworkCompetitionContext(sector, turn) {
		var economy = sector.simulation && sector.simulation.economy;
		var context = {stateById:new Map(asArray(economy && economy.marketStates).map(function(state) { return [String(state.marketId), state]; })), inboundByAccount:new Map(), pathCache:new Map(), turn:turn};
		var shipments = typeof SectorLogistics !== 'undefined' && SectorLogistics.getShipments ? SectorLogistics.getShipments(sector) : [];
		asArray(shipments).forEach(function(shipment) {
			if (!shipment || ['delivered','cancelled','lost','stranded'].indexOf(String(shipment.status)) >= 0) return;
			var remaining = finite(shipment.remainingQuantity, 0, 0);
			if (remaining <= 0) return;
			var eta = finite(shipment.estimatedArrivalTurn, turn + 3, 0);
			var lead = Math.max(0, eta - turn);
			var risk = clamp(finite(shipment.riskPercent, 0, 0), 0, 95);
			var reliability = 1 - risk / 100;
			var timeWeight = 1 / (1 + lead * 0.2);
			var expected = roundQuantity(remaining * reliability * timeWeight);
			var key = String(shipment.destinationMarketId) + '|' + String(shipment.commodityId);
			context.inboundByAccount.set(key, roundQuantity((context.inboundByAccount.get(key) || 0) + expected));
		});
		return context;
	}

	/*
	 * Cross-market competition is based on reachable surplus, unmet demand and
	 * probability-weighted inbound cargo. A shipment still has to arrive before
	 * inventory changes; the forecast only moderates the local price signal.
	 * Candidate lists and path caches bound the work for large sectors.
	 */
	function networkCompetition(sector, market, commodityId, targetIndex, referencePrice, ownTargetStock, context) {
		if (typeof SectorLogistics === 'undefined' || typeof SectorLogistics.getPath !== 'function') return {targetIndex:targetIndex, importDiscount:0, exportPremium:0, bestSupplierMarketId:'', reachableDemand:0, expectedInbound:0};
		context = context || buildNetworkCompetitionContext(sector, finite(sector.factionTurn, 0, 0));
		var bestLandedIndex = Infinity, bestSupplierMarketId = '', weightedDemand = 0, expectedInboundTotal = 0;
		var markets = asArray(sector.markets), stateById = context.stateById;
		var candidates = markets.filter(function(other) { return other && String(other.id) !== String(market.id) && String(other.systemId) !== String(market.systemId); }).map(function(other) {
			var otherState = stateById.get(String(other.id));
			if (!otherState) return null;
			var stock = asArray(otherState.inventory).find(function(x) { return x.commodityId === commodityId; });
			if (!stock) return null;
			var production = getRate(otherState.production, commodityId), consumption = getRate(otherState.consumption, commodityId);
			var key = String(other.id) + '|' + String(commodityId);
			var expectedInbound = finite(context.inboundByAccount.get(key), 0, 0);
			expectedInboundTotal += expectedInbound;
			var available = Math.max(0, finite(stock.onHand, 0, 0) - finite(stock.reserved, 0, 0));
			var forecast = Math.max(0, available + finite(production && production.quantityPerTurn, 0, 0) - finite(consumption && consumption.quantityPerTurn, 0, 0) + expectedInbound);
			var otherTarget = Math.max(1, finite(stock.targetStock, 1, 1));
			return {market:other,state:otherState,stock:stock,forecast:forecast,target:otherTarget,surplus:Math.max(0, forecast - otherTarget * 1.15),deficit:Math.max(0, otherTarget * 0.7 - forecast)};
		}).filter(Boolean);
		var pathFor = function(fromId, toId) {
			var key = String(commodityId) + '|' + String(fromId) + '>' + String(toId);
			if (!context.pathCache.has(key)) context.pathCache.set(key, SectorLogistics.getPath(sector, fromId, toId, commodityId));
			return context.pathCache.get(key);
		};
		var suppliers = candidates.filter(function(x) { return x.surplus > 0; }).sort(function(a,b) { return b.surplus-a.surplus || String(a.market.id).localeCompare(String(b.market.id)); }).slice(0,24);
		var demanders = candidates.filter(function(x) { return x.deficit > 0; }).sort(function(a,b) { return b.deficit-a.deficit || String(a.market.id).localeCompare(String(b.market.id)); }).slice(0,24);
		suppliers.forEach(function(candidate) {
			var inbound = pathFor(candidate.market.systemId, market.systemId);
			if (!inbound || !inbound.reachable) return;
			var p = asArray(candidate.state.prices).find(function(x) { return x.commodityId === commodityId; });
			var supplierIndex = finite(p && p.currentPriceIndex, 100, PRICE_MIN);
			var landed = supplierIndex + (finite(inbound.freightCostPerUnit, 0, 0) / Math.max(1, referencePrice) * 100) + finite(inbound.transitTurns, 0, 0) * 1.5 + finite(inbound.riskPercent, 0, 0) * 0.08 + finite(inbound.tariffCostPerUnit, 0, 0) / Math.max(1, referencePrice) * 100;
			if (landed < bestLandedIndex) { bestLandedIndex = landed; bestSupplierMarketId = candidate.market.id; }
		});
		demanders.forEach(function(candidate) {
			var outbound = pathFor(market.systemId, candidate.market.systemId);
			if (!outbound || !outbound.reachable) return;
			var friction = 1 + finite(outbound.transitTurns, 0, 0) * 0.15 + finite(outbound.riskPercent, 0, 0) * 0.01 + finite(outbound.freightCostPerUnit, 0, 0) / Math.max(1, referencePrice);
			weightedDemand += candidate.deficit / friction;
		});
		var importDiscount = bestLandedIndex < targetIndex ? Math.min(15, Math.max(0, (targetIndex - bestLandedIndex) * 0.18)) : 0;
		var exportPremium = Math.min(8, Math.log(1 + weightedDemand / Math.max(1, ownTargetStock)) * 3.5);
		return {targetIndex:clamp(Math.round(targetIndex - importDiscount + exportPremium), PRICE_MIN, PRICE_MAX),importDiscount:roundQuantity(importDiscount),exportPremium:roundQuantity(exportPremium),bestSupplierMarketId:bestSupplierMarketId,reachableDemand:roundQuantity(weightedDemand),expectedInbound:roundQuantity(expectedInboundTotal)};
	}

	function getRate(lines, commodityId) { return asArray(lines).find(function(item) { return item.commodityId === commodityId; }) || null; }
	function getGood(market, commodityId) { return asArray(market && market.goods).find(function(item) { return slug(item.name || item.id) === commodityId; }) || null; }
	function isOverridden(entity, field) { return typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(entity, field); }

	API.isInitialized = function(sector) {
		var economy = sector && sector.simulation && sector.simulation.economy;
		return !!(economy && economy.initialized === true && Array.isArray(economy.marketStates));
	};

	API.getMarketState = function(sector, marketId) {
		var economy = sector && sector.simulation && sector.simulation.economy;
		return economy && asArray(economy.marketStates).find(function(state) { return state.marketId === marketId; }) || null;
	};

	function reconcileRateLines(existingLines, generatedLines) {
		var oldById = new Map(asArray(existingLines).map(function(line) { return [line.commodityId, line]; }));
		var generatedIds = new Set();
		var result = asArray(generatedLines).map(function(generated) {
			generatedIds.add(generated.commodityId);
			var existing = oldById.get(generated.commodityId);
			if (!existing) return generated;
			existing.generatedQuantityPerTurn = generated.generatedQuantityPerTurn;
			if (!isOverridden(existing, 'quantityPerTurn')) {
				existing.quantityPerTurn = generated.quantityPerTurn;
				existing.source = 'generated';
				existing.reason = generated.reason;
			}
			return existing;
		});
		asArray(existingLines).forEach(function(existing) {
			if (!generatedIds.has(existing.commodityId) && isOverridden(existing, 'quantityPerTurn')) result.push(existing);
		});
		return result;
	}

	// Re-derive schedules when a world's population, Tech Level, tags, or market
	// profile changes. Inventory already on hand is never reset by this refresh.
	API.refreshMarketDrivers = function(sector, marketOrId) {
		if (!sector || !API.isInitialized(sector)) return {ok:false, reason:'Local economy is not initialized.'};
		var market = typeof marketOrId === 'object' ? marketOrId : asArray(sector.markets).find(function(item) { return item && String(item.id) === String(marketOrId); });
		if (!market) return {ok:false, reason:'Market not found.'};
		var economy = ensureEconomy(sector);
		var state = API.getMarketState(sector, String(market.id));
		if (!state) return {ok:false, reason:'Market account is not initialized.'};
		var draft = buildMarketState(sector, market, getCatalogue(sector), economy.clock.lastAdvancedTurn);
		var activeIds = new Set(asArray(market.goods).map(function(good) { return slug(good.name || good.id); }));
		state.retiredCommodities = asArray(state.retiredCommodities);
		state.inventory = asArray(state.inventory).filter(function(stock) {
			if (activeIds.has(stock.commodityId)) return true;
			state.retiredCommodities.push({commodityId:stock.commodityId, retiredAtTurn:economy.clock.lastAdvancedTurn, reason:'removed-from-market', inventory:cloneJSON(stock), price:cloneJSON(getPrice(state, stock.commodityId)), production:cloneJSON(getRate(state.production, stock.commodityId)), consumption:cloneJSON(getRate(state.consumption, stock.commodityId))});
			return false;
		});
		state.prices = asArray(state.prices).filter(function(price) { return activeIds.has(price.commodityId); });
		state.production = reconcileRateLines(state.production, draft.production);
		state.consumption = reconcileRateLines(state.consumption, draft.consumption);
		draft.inventory.forEach(function(generated) {
			var existing = getInventory(state, generated.commodityId);
			if (!existing) state.inventory.push(generated);
			else {
				if (!isOverridden(existing, 'targetStock')) existing.targetStock = generated.targetStock;
				if (!isOverridden(existing, 'storageCapacity')) existing.storageCapacity = roundQuantity(Math.max(Number(existing.onHand || 0), generated.storageCapacity));
			}
		});
		draft.prices.forEach(function(generated) {
			var existing = getPrice(state, generated.commodityId);
			if (!existing) state.prices.push(generated);
		});
		state.populationFactor = draft.populationFactor;
		state.techFactor = draft.techFactor;
		state.systemId = String(market.systemId || '');
		state.planetId = String(market.planetId || '');
		return {ok:true, marketId:String(market.id), inventoryCount:state.inventory.length, retiredCount:state.retiredCommodities.length};
	};

	API.initializeSector = function(sector) {
		if (!isObject(sector)) throw new TypeError('A sector object is required to initialize the economy.');
		if (typeof SectorSimulation === 'undefined' || !SectorSimulation.migrateSector) throw new Error('SectorSimulation is required before initializing the economy.');
		SectorSimulation.migrateSector(sector, {sourceApplicationVersion:ENGINE_VERSION});
		var economy = ensureEconomy(sector);
		var catalogue = getCatalogue(sector);
		var initialized = 0, preserved = 0;
		asArray(sector.markets).forEach(function(market) {
			if (!market || !market.id) return;
			var existing = economy.marketStates.find(function(state) { return state.marketId === String(market.id); });
			if (existing && existing.initialized) { API.refreshMarketDrivers(sector, market); preserved++; return; }
			economy.marketStates = economy.marketStates.filter(function(state) { return state.marketId !== String(market.id); });
			economy.marketStates.push(buildMarketState(sector, market, catalogue, economy.clock.turn));
			initialized++;
		});
		economy.commodities = catalogue;
		economy.initialized = asArray(sector.markets).length > 0 && asArray(sector.markets).every(function(market) {
			return economy.marketStates.some(function(state) { return state.marketId === String(market.id) && state.initialized; });
		});
		economy.initializedAtTurn = economy.initializedAtTurn == null ? economy.clock.turn : economy.initializedAtTurn;
		if (economy.initialized && typeof SectorLogistics !== 'undefined' && SectorLogistics.initialize) SectorLogistics.initialize(sector);
		if (economy.initialized && typeof SectorSettlement !== 'undefined' && SectorSettlement.initialize) SectorSettlement.initialize(sector);
		if (economy.initialized && typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.initialize) SectorTradeContracts.initialize(sector);
		var transportResult = null;
		if (economy.initialized && typeof SectorTransport !== 'undefined' && SectorTransport.initialize) transportResult = SectorTransport.initialize(sector);
		return {ok:true, initializedMarkets:initialized, preservedMarkets:preserved, totalMarkets:asArray(sector.markets).length, transport:transportResult, turn:economy.clock.turn};
	};

	function projectionForMarket(sector, market, state) {
		var changed = 0;
		asArray(state.inventory).forEach(function(stock) {
			var good = getGood(market, stock.commodityId);
			var price = getPrice(state, stock.commodityId);
			if (!good || !price) return;
			var previousIndex = finite(good.priceIndex, price.currentPriceIndex, PRICE_MIN);
			if (!isOverridden(good, 'priceIndex')) good.priceIndex = clamp(Math.round(finite(price.currentPriceIndex, previousIndex, PRICE_MIN)), PRICE_MIN, PRICE_MAX);
			else price.currentPriceIndex = clamp(integer(good.priceIndex, price.currentPriceIndex, PRICE_MIN), PRICE_MIN, PRICE_MAX);
			if (!isOverridden(good, 'localPrice')) good.localPrice = Math.max(1, Math.round(finite(good.basePrice, price.referencePrice, 1) * finite(price.currentPriceIndex, 100, PRICE_MIN) / 100));
			var available = Math.max(0, finite(stock.onHand, 0, 0) - finite(stock.reserved, 0, 0));
			var coverage = available / Math.max(1, finite(stock.targetStock, 1, 1));
			var supply = coverage >= 1.5 ? 'surplus' : coverage >= 0.65 ? 'available' : coverage >= 0.3 ? 'shortage' : 'rare';
			if (!isOverridden(good, 'supply')) good.supply = supply;
			if (!isOverridden(good, 'trend')) good.trend = good.priceIndex > previousIndex ? 'Rising' : good.priceIndex < previousIndex ? 'Falling' : 'Stable';
			changed++;
		});
		market.economyTurn = state.lastAdvancedTurn;
		market.economyGoodCount = changed;
		return changed;
	}

	API.syncMarketProjection = function(sector, market) {
		if (!sector || !market || !sector.simulation || !sector.simulation.economy) return 0;
		var state = API.getMarketState(sector, market.id);
		return state ? projectionForMarket(sector, market, state) : 0;
	};

	API.advanceTurn = function(sector, turnNumber) {
		if (!isObject(sector) || !API.isInitialized(sector)) throw new Error('Initialize the local economy before advancing an economic turn.');
		var economy = ensureEconomy(sector);
		var turn = integer(turnNumber, integer(sector.factionTurn, economy.clock.lastAdvancedTurn + 1, 0), 0);
		if (turn <= economy.clock.lastAdvancedTurn) return {ok:true, skipped:true, reason:'This economic turn has already been processed.', turn:turn, markets:0, ledgers:0};
		if (turn !== economy.clock.lastAdvancedTurn + 1) throw new Error('Economic turns must advance one at a time. Expected turn ' + (economy.clock.lastAdvancedTurn + 1) + ', received ' + turn + '.');

		var contractTurnResult = null;
		if (typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.prepareTurn) contractTurnResult = SectorTradeContracts.prepareTurn(sector, turn);
		var transportResult = null;
		if (typeof SectorTransport !== 'undefined' && SectorTransport.advanceTurn) transportResult = SectorTransport.advanceTurn(sector, turn);
		var logisticsArrivalResult = null;
		if (typeof SectorLogistics !== 'undefined' && SectorLogistics.processArrivals) logisticsArrivalResult = SectorLogistics.processArrivals(sector, turn);
		// Diplomatic and formal political turn transitions consume the evidence
		// now available after arrivals. Complete both before pricing, network
		// competition, or dispatch so every same-turn route query sees one
		// coherent political snapshot. Keep diplomacy before formal politics:
		// active war records must retain their authoritative Open conflict state.
		var diplomacyResult = null, politicsResult = null;
		if (typeof SectorDiplomacy !== 'undefined' && SectorDiplomacy.advanceTurn) diplomacyResult = SectorDiplomacy.advanceTurn(sector, turn);
		if (typeof SectorPolitics !== 'undefined' && SectorPolitics.advanceTurn) politicsResult = SectorPolitics.advanceTurn(sector, turn);
		var markets = asArray(sector.markets);
		var stateById = new Map(economy.marketStates.map(function(state) { return [String(state.marketId), state]; }));
		var competitionContext = buildNetworkCompetitionContext(sector, turn);
		var processedMarkets = 0, changedGoods = 0, shortages = 0, totalProduced = 0, totalConsumed = 0, ledgerCount = 0;
		markets.forEach(function(market) {
			var state = stateById.get(String(market.id));
			if (!state || !state.initialized) return;
			var lines = [];
			var marketProduced = 0, marketConsumed = 0, marketShortages = 0, marketPriceMoves = 0;
			asArray(state.inventory).forEach(function(stock) {
				var commodityId = stock.commodityId;
				var productionLine = getRate(state.production, commodityId);
				var consumptionLine = getRate(state.consumption, commodityId);
				var price = getPrice(state, commodityId);
				var good = getGood(market, commodityId);
				if (!price || !good) return;
				var opening = roundQuantity(stock.onHand);
				var requestedProduction = roundQuantity(productionLine && productionLine.quantityPerTurn);
				var requestedConsumption = roundQuantity(consumptionLine && consumptionLine.quantityPerTurn);
				var reserved = Math.min(opening, roundQuantity(stock.reserved));
				var manualStockLock = isOverridden(stock, 'onHand');
				var produced = manualStockLock ? 0 : requestedProduction;
				var capacity = finite(stock.storageCapacity, Number.MAX_SAFE_INTEGER, 0);
				var afterProduction = manualStockLock ? opening : Math.min(capacity, opening + produced);
				var overflow = manualStockLock ? 0 : Math.max(0, roundQuantity(opening + produced - afterProduction));
				var consumable = Math.max(0, afterProduction - reserved);
				var consumed = manualStockLock ? 0 : Math.min(requestedConsumption, consumable);
				var unmetDemand = manualStockLock ? requestedConsumption : Math.max(0, roundQuantity(requestedConsumption - consumed));
				var closing = manualStockLock ? opening : roundQuantity(Math.max(reserved, afterProduction - consumed));
				if (!manualStockLock && !isOverridden(stock, 'onHand')) stock.onHand = closing;
				stock.lastTurn = turn;
				stock.source = manualStockLock ? (stock.source || 'manual') : 'simulated';

				var available = Math.max(0, closing - reserved);
				var targetStock = Math.max(1, finite(stock.targetStock, 1, 1));
				var coverage = available / targetStock;
				var referenceIndex = clamp(finite(price.referencePriceIndex, 100, PRICE_MIN), PRICE_MIN, PRICE_MAX);
				var scarcityMultiplier = clamp(1.3 - Math.min(2, coverage) * 0.3, 0.7, 1.3);
				var freightPressure = clamp(finite(price.freightCostPressure, 0, 0), 0, 35);
				var targetIndex = clamp(Math.round(referenceIndex * scarcityMultiplier * (1 + freightPressure / 100)), PRICE_MIN, PRICE_MAX);
				var competition = networkCompetition(sector, market, commodityId, targetIndex, finite(price.referencePrice, finite(good.basePrice, 100, 1), 1), targetStock, competitionContext);
				targetIndex = competition.targetIndex;
				price.networkCompetition = {turn:turn,importDiscount:competition.importDiscount,exportPremium:competition.exportPremium,bestSupplierMarketId:competition.bestSupplierMarketId,reachableDemand:competition.reachableDemand,expectedInbound:competition.expectedInbound};
				if (!isOverridden(price, 'freightCostPressure')) price.freightCostPressure = roundQuantity(freightPressure * 0.65);
				var previousIndex = clamp(integer(price.currentPriceIndex, 100, PRICE_MIN), PRICE_MIN, PRICE_MAX);
				var currentIndex = previousIndex;
				if (isOverridden(good, 'priceIndex')) {
					currentIndex = clamp(integer(good.priceIndex, previousIndex, PRICE_MIN), PRICE_MIN, PRICE_MAX);
					price.currentPriceIndex = currentIndex;
					price.targetPriceIndex = currentIndex;
					price.lastTurnChange = 0;
				} else if (isOverridden(price, 'currentPriceIndex')) {
					currentIndex = previousIndex;
					price.targetPriceIndex = targetIndex;
					price.lastTurnChange = 0;
				} else {
					var delta = clamp(targetIndex - previousIndex, -PRICE_STEP, PRICE_STEP);
					currentIndex = clamp(previousIndex + delta, PRICE_MIN, PRICE_MAX);
					price.currentPriceIndex = currentIndex;
					price.targetPriceIndex = targetIndex;
					price.lastTurnChange = currentIndex - previousIndex;
				}
				price.lastUpdatedTurn = turn;

				var line = {
					commodityId:commodityId, opening:opening, production:produced, requestedProduction:requestedProduction,
					consumption:consumed, requestedConsumption:requestedConsumption, unmetDemand:roundQuantity(unmetDemand),
					overflow:roundQuantity(overflow), reserved:reserved, closing:closing,
					priceIndexBefore:previousIndex, priceIndexAfter:currentIndex, targetPriceIndex:targetIndex,
					competitionDiscount:competition.importDiscount, competitionPremium:competition.exportPremium, competitorMarketId:competition.bestSupplierMarketId, expectedInboundFromNetwork:competition.expectedInbound,
					manualStockLock:manualStockLock
				};
				lines.push(line);
				marketProduced += produced; marketConsumed += consumed; marketShortages += unmetDemand; marketPriceMoves += currentIndex !== previousIndex ? 1 : 0;
				if (produced || consumed || unmetDemand || overflow || currentIndex !== previousIndex) changedGoods++;
			});

			var ledger = {
				id:'ECON-LEDGER-' + String(economy.nextLedgerSequence++).padStart(7, '0'),
				turn:turn, marketId:String(market.id), marketName:String(market.planetName || market.id),
				lines:lines, totalProduction:roundQuantity(marketProduced), totalConsumption:roundQuantity(marketConsumed),
				totalUnmetDemand:roundQuantity(marketShortages), changedPriceCount:marketPriceMoves
			};
			state.ledger.push(ledger);
			economy.ledger.push({id:ledger.id, turn:turn, marketId:ledger.marketId, lineCount:lines.length});
			ledgerCount++;
			processedMarkets++;
			totalProduced += marketProduced; totalConsumed += marketConsumed; shortages += marketShortages;
			projectionForMarket(sector, market, state);

			var notable = lines.filter(function(line) { return line.production || line.consumption || line.unmetDemand || line.priceIndexBefore !== line.priceIndexAfter || line.overflow; });
			if (typeof SectorSimulation !== 'undefined' && SectorSimulation.recordEvent && notable.length) {
				var notableIds = new Set(notable.map(function(line) { return String(line.commodityId); }));
				var marketCauses = [];
				if (typeof SectorLogistics !== 'undefined' && SectorLogistics.getShipments) SectorLogistics.getShipments(sector).forEach(function(shipment) {
					if (String(shipment.destinationMarketId)===String(market.id) && Number(shipment.deliveredTurn)===turn && notableIds.has(String(shipment.commodityId)) && shipment.lastChronicleEventId && marketCauses.indexOf(shipment.lastChronicleEventId)<0) marketCauses.push(shipment.lastChronicleEventId);
				});
				var marketEvent = SectorSimulation.recordEvent(sector, {
					category:'economic', type:'local-market-balance', source:'sector-economy',
					summary:market.planetName + ' recorded ' + roundQuantity(marketProduced) + ' lots produced, ' + roundQuantity(marketConsumed) + ' consumed' + (marketShortages ? ', and ' + roundQuantity(marketShortages) + ' lots of unmet demand' : '') + '.',
					marketId:market.id, marketName:market.planetName, ledgerId:ledger.id, causes:marketCauses,
					effects:notable.map(function(line) { return {commodityId:line.commodityId, opening:line.opening, production:line.production, consumption:line.consumption, unmetDemand:line.unmetDemand, overflow:line.overflow, closing:line.closing, priceIndexBefore:line.priceIndexBefore, priceIndexAfter:line.priceIndexAfter}; })
				});
				ledger.chronicleEventId = marketEvent && marketEvent.id || '';
			}
		});

		var logisticsDispatchResult = null;
		if (typeof SectorLogistics !== 'undefined' && SectorLogistics.planAndDispatch) logisticsDispatchResult = SectorLogistics.planAndDispatch(sector, turn);
		var strategicResult = null, settlementSummary = null;
		if (typeof SectorSettlement !== 'undefined' && SectorSettlement.initialize) { SectorSettlement.initialize(sector); settlementSummary = SectorSettlement.getSummary(sector); }
		if (typeof SectorStrategic !== 'undefined' && SectorStrategic.advanceTurn) strategicResult = SectorStrategic.advanceTurn(sector, turn);
		if (typeof SectorSettlement !== 'undefined' && SectorSettlement.markTurnSettled) SectorSettlement.markTurnSettled(sector, turn);
		economy.clock.turn = turn;
		economy.clock.lastAdvancedTurn = turn;
		economy.lastAdvancedTurn = turn;
		return {ok:true, skipped:false, turn:turn, markets:processedMarkets, ledgers:ledgerCount, changedGoods:changedGoods, totalProduction:roundQuantity(totalProduced), totalConsumption:roundQuantity(totalConsumed), unmetDemand:roundQuantity(shortages), logistics:{arrivals:logisticsArrivalResult, dispatch:logisticsDispatchResult}, contracts:contractTurnResult, transport:transportResult, settlement:settlementSummary, diplomacy:diplomacyResult, politics:politicsResult, strategy:strategicResult};
	};

	API.validate = function(sector) {
		var errors = [], warnings = [];
		var economy = sector && sector.simulation && sector.simulation.economy;
		if (!economy) return {ok:true, errors:errors, warnings:['Local economy has not been initialized.']};
		var marketIds = new Set(asArray(sector.markets).map(function(market) { return String(market.id); }));
		var seen = new Set();
		asArray(economy.marketStates).forEach(function(state) {
			if (!state.marketId) errors.push('Economic market state is missing marketId.');
			if (seen.has(String(state.marketId))) errors.push('Duplicate economic market state for ' + state.marketId + '.');
			seen.add(String(state.marketId));
			if (!marketIds.has(String(state.marketId))) warnings.push('Economic state references removed market ' + state.marketId + '.');
			var commodities = new Set();
			asArray(state.inventory).forEach(function(stock) {
				if (commodities.has(stock.commodityId)) errors.push('Duplicate inventory commodity ' + stock.commodityId + ' in ' + state.marketId + '.');
				commodities.add(stock.commodityId);
				if (!Number.isFinite(Number(stock.onHand)) || Number(stock.onHand) < 0) errors.push('Invalid on-hand inventory for ' + state.marketId + '/' + stock.commodityId + '.');
				if (Number(stock.reserved || 0) > Number(stock.onHand || 0)) errors.push('Reserved inventory exceeds on-hand inventory for ' + state.marketId + '/' + stock.commodityId + '.');
				if (Number(stock.onHand || 0) > Number(stock.storageCapacity || 0)) errors.push('Inventory exceeds storage capacity for ' + state.marketId + '/' + stock.commodityId + '.');
			});
		});
		if (economy.initialized && asArray(sector.markets).some(function(market) { return !seen.has(String(market.id)); })) warnings.push('One or more markets do not have initialized economic accounts.');
		return {ok:errors.length === 0, errors:errors, warnings:warnings, counts:{marketStates:asArray(economy.marketStates).length, ledgerEntries:asArray(economy.ledger).length}};
	};

	API.getSummary = function(sector) {
		var economy = sector && sector.simulation && sector.simulation.economy;
		if (!economy || !economy.initialized) return {initialized:false, marketCount:0, turn:0, ledgers:0};
		var states = asArray(economy.marketStates);
		var commodityCount = states.reduce(function(total, state) { return total + asArray(state.inventory).length; }, 0);
		var shortages = states.reduce(function(total, state) {
			return total + asArray(state.inventory).filter(function(stock) { return (Number(stock.onHand || 0) - Number(stock.reserved || 0)) < Number(stock.targetStock || 0) * 0.3; }).length;
		}, 0);
		return {initialized:true, marketCount:states.length, commodityAccounts:commodityCount, turn:integer(economy.clock && economy.clock.lastAdvancedTurn, 0, 0), ledgers:asArray(economy.ledger).length, severeShortages:shortages};
	};

	API.getCommodityCatalogue = function(sector) { return asArray(sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.commodities); };
	API.constants = {schemaVersion:ECONOMY_SCHEMA_VERSION, engineVersion:ENGINE_VERSION, priceMin:PRICE_MIN, priceMax:PRICE_MAX, priceStep:PRICE_STEP};
	return API;
})();
