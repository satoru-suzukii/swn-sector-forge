/*
 * Sector Forge 1.3.9 — persistent inter-market supply contracts with stable ledger sequencing.
 * Contracts are referee-authored commercial terms. They influence shipment
 * planning but never create goods, bypass route policy, or advance on render.
 */
var SectorTradeContracts = (function() {
	'use strict';
	var API = {}, SCHEMA_VERSION = 1, ENGINE_VERSION = '1.3.10.1';
	function arr(v) { return Array.isArray(v) ? v : []; }
	function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
	function num(v, d, min) { var n = Number(v); return Number.isFinite(n) ? Math.max(min == null ? 0 : min, n) : d; }
	function round(v) { return Math.round(num(v, 0, 0) * 100) / 100; }
	function slug(v) { return String(v || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
	function state(sector) {
		var economy = sector && sector.simulation && sector.simulation.economy;
		if (!economy || economy.initialized !== true) throw new Error('Initialize the local economy before managing trade contracts.');
		economy.contracts = obj(economy.contracts) ? economy.contracts : {};
		var c = economy.contracts;
		c.schemaVersion = SCHEMA_VERSION; c.engineVersion = ENGINE_VERSION;
		c.records = arr(c.records); c.ledger = arr(c.ledger); c.clock = obj(c.clock) ? c.clock : {};
		var maxLedger = c.ledger.reduce(function(maximum, record) { var match = String(record && record.id || '').match(/(\d+)$/); return Math.max(maximum, match ? Number(match[1]) : 0); }, 0);
		c.nextLedgerSequence = Math.max(1, Math.floor(num(c.nextLedgerSequence, maxLedger + 1, 1)), maxLedger + 1);
		var maximum = c.records.reduce(function(m, r) { var n = Number(String(r && r.id || '').replace(/^TC-/, '')); return Math.max(m, Number.isFinite(n) ? n : 0); }, 0);
		c.nextSequence = Math.max(1, Math.floor(num(c.nextSequence, maximum + 1, 1)), maximum + 1);
		c.clock.lastPreparedTurn = Math.max(0, Math.floor(num(c.clock.lastPreparedTurn, economy.clock && economy.clock.lastAdvancedTurn || 0, 0)));
		return c;
	}
	function market(sector, id) { return arr(sector.markets).find(function(m) { return String(m.id) === String(id); }) || null; }
	function hasCommodity(sector, marketId, commodityId) {
		var economy = sector.simulation.economy;
		var account = arr(economy.marketStates).find(function(s) { return String(s.marketId) === String(marketId); });
		return !!(account && arr(account.inventory).some(function(line) { return line.commodityId === commodityId; }));
	}
	function log(sector, c, record) {
		record.id = 'CONTRACT-LEDGER-' + String(c.nextLedgerSequence++).padStart(7, '0');
		c.ledger.push(record);
		if (typeof SectorSimulation !== 'undefined' && SectorSimulation.recordEvent) SectorSimulation.recordEvent(sector, {category:'commerce', source:'trade-contract-engine', type:record.type, summary:record.summary, contractId:record.contractId, shipmentId:record.shipmentId, turn:record.turn, visibility:'gm'});
		return record;
	}
	function priorityRank(value) { return ({critical:0,high:1,standard:2,low:3})[String(value || 'standard')] == null ? 2 : ({critical:0,high:1,standard:2,low:3})[String(value || 'standard')]; }
	function overlaps(aStart, aEnd, bStart, bEnd) { var ae = Number(aEnd) > 0 ? Number(aEnd) : Infinity, be = Number(bEnd) > 0 ? Number(bEnd) : Infinity; return Number(aStart || 0) <= be && Number(bStart || 0) <= ae; }
	function sameLane(a, b) { return String(a.originMarketId) === String(b.originMarketId) && String(a.destinationMarketId) === String(b.destinationMarketId) && String(a.commodityId) === String(b.commodityId); }
	API.initialize = function(sector) { var c = state(sector); return {ok:true, contracts:c.records.length, ledger:c.ledger.length}; };
	API.create = function(sector, draft, turn) {
		var c = state(sector), data = obj(draft) ? draft : {};
		var origin = market(sector, data.originMarketId), destination = market(sector, data.destinationMarketId);
		var commodityId = slug(data.commodityId);
		if (!origin || !destination) return {ok:false, reason:'Select valid origin and destination markets.'};
		if (String(origin.id) === String(destination.id) || String(origin.systemId) === String(destination.systemId)) return {ok:false, reason:'A supply contract must connect markets in different systems.'};
		if (!hasCommodity(sector, origin.id, commodityId) || !hasCommodity(sector, destination.id, commodityId)) return {ok:false, reason:'The selected commodity must exist in both market accounts.'};
		var quantity = round(num(data.quantityPerTurn, 0, 0));
		if (quantity <= 0) return {ok:false, reason:'Quantity per turn must be greater than zero.'};
		var startTurn = Math.floor(num(data.startTurn, Math.max(1, Number(turn) || 1), 0));
		var endTurn = Math.floor(num(data.endTurn, 0, 0));
		if (endTurn > 0 && endTurn < startTurn) return {ok:false, reason:'End turn cannot be earlier than start turn.'};
		var status = ['active','paused'].indexOf(String(data.status || 'active')) >= 0 ? String(data.status || 'active') : 'active';
		var active = status === 'active';
		if (active && c.records.some(function(existing) { return existing.status === 'active' && sameLane(existing, {originMarketId:origin.id,destinationMarketId:destination.id,commodityId:commodityId}) && overlaps(startTurn, endTurn, existing.startTurn, existing.endTurn); })) return {ok:false, reason:'An active contract already covers this market pair and commodity during an overlapping turn range. Pause or reschedule one contract first.'};
		var id = String(data.id || '').trim();
		if (!id) id = 'TC-' + String(c.nextSequence++).padStart(5, '0');
		if (c.records.some(function(r) { return String(r.id) === id; })) return {ok:false, reason:'A contract with that ID already exists.'};
		var contract = {
			id:id, name:String(data.name || (origin.planetName + ' → ' + destination.planetName + ' · ' + commodityId)),
			originMarketId:String(origin.id), destinationMarketId:String(destination.id), commodityId:commodityId,
			quantityPerTurn:quantity, unitPriceCr:round(num(data.unitPriceCr, 0, 0)), startTurn:startTurn, endTurn:endTurn,
			priority:['critical','high','standard','low'].indexOf(String(data.priority)) >= 0 ? String(data.priority) : 'standard',
			status:status,
			createdTurn:Math.max(0, Math.floor(num(turn, startTurn, 0))), source:'manual', notes:String(data.notes || ''),
			shippedThisTurn:0, deliveredThisTurn:0, lostThisTurn:0, history:[], lastPreparedTurn:0
		};
		c.records.push(contract);
		log(sector, c, {turn:contract.createdTurn, type:'contract-created', contractId:id, summary:'Trade contract ' + contract.name + ' was created for ' + quantity + ' lots per turn.'});
		return {ok:true, contract:contract};
	};
	API.getContracts = function(sector) { var e = sector && sector.simulation && sector.simulation.economy; return arr(e && e.contracts && e.contracts.records); };
	API.getLedger = function(sector) { var e = sector && sector.simulation && sector.simulation.economy; return arr(e && e.contracts && e.contracts.ledger); };
	API.prepareTurn = function(sector, turn) {
		var c = state(sector), t = Math.floor(num(turn, 0, 0));
		if (t <= c.clock.lastPreparedTurn) return {ok:true, skipped:true, turn:t};
		if (t !== c.clock.lastPreparedTurn + 1) throw new Error('Trade-contract turns must advance one at a time. Expected ' + (c.clock.lastPreparedTurn + 1) + ', received ' + t + '.');
		var expired = 0;
		c.records.forEach(function(contract) {
			if (contract.lastPreparedTurn > 0) {
				contract.history = arr(contract.history);
				contract.history.push({turn:contract.lastPreparedTurn, shipped:round(contract.shippedThisTurn), delivered:round(contract.deliveredThisTurn), lost:round(contract.lostThisTurn), target:round(contract.quantityPerTurn), shortfall:round(Math.max(0, Number(contract.quantityPerTurn || 0) - Number(contract.shippedThisTurn || 0)))});
				if (contract.history.length > 24) contract.history.splice(0, contract.history.length - 24);
			}
			contract.shippedThisTurn = 0; contract.deliveredThisTurn = 0; contract.lostThisTurn = 0;
			contract.lastPreparedTurn = t;
			if (contract.status === 'active' && Number(contract.endTurn) > 0 && t > Number(contract.endTurn)) { contract.status = 'expired'; expired++; log(sector, c, {turn:t, type:'contract-expired', contractId:contract.id, summary:'Trade contract ' + contract.name + ' expired.'}); }
		});
		c.clock.lastPreparedTurn = t;
		return {ok:true, skipped:false, turn:t, contracts:c.records.length, expired:expired};
	};
	API.getMatchingContract = function(sector, originMarketId, destinationMarketId, commodityId, turn) {
		var c = state(sector), t = Math.floor(num(turn, 0, 0));
		var matches = c.records.filter(function(contract) {
			return contract.status === 'active' && Number(contract.startTurn || 0) <= t && (!Number(contract.endTurn) || t <= Number(contract.endTurn)) && String(contract.originMarketId) === String(originMarketId) && String(contract.destinationMarketId) === String(destinationMarketId) && contract.commodityId === commodityId && Number(contract.shippedThisTurn || 0) + 0.0001 < Number(contract.quantityPerTurn || 0);
		});
		matches.sort(function(a,b) { return priorityRank(a.priority)-priorityRank(b.priority) || String(a.id).localeCompare(String(b.id)); });
		if (!matches.length) return null;
		var best = matches[0];
		return {contract:best, remainingQuantity:round(Math.max(0, Number(best.quantityPerTurn) - Number(best.shippedThisTurn || 0))), unitPriceCr:round(num(best.unitPriceCr, 0, 0)), priority:best.priority};
	};
	API.recordDispatch = function(sector, contractId, shipment, quantity, turn) {
		if (!contractId || !shipment) return null;
		var c = state(sector), contract = c.records.find(function(r) { return String(r.id) === String(contractId); });
		if (!contract || (String(shipment.contractId || '') === String(contractId) && !!shipment.contractDispatchLedgerId)) return null;
		contract.shippedThisTurn = round(Number(contract.shippedThisTurn || 0) + num(quantity, 0, 0));
		shipment.contractId = contract.id;
		var rec = log(sector, c, {turn:turn, type:'contract-shipment', contractId:contract.id, shipmentId:shipment.id, quantity:round(quantity), summary:round(quantity) + ' lots shipped under contract ' + contract.name + '.'});
		shipment.contractDispatchRecords = arr(shipment.contractDispatchRecords); shipment.contractDispatchRecords.push(rec.id); shipment.contractDispatchLedgerId = rec.id;
		return rec;
	};
	API.recordDelivery = function(sector, shipment, quantity, turn) {
		if (!shipment || !shipment.contractId || num(quantity, 0, 0) <= 0) return null;
		var c = state(sector), contract = c.records.find(function(r) { return String(r.id) === String(shipment.contractId); });
		if (!contract) return null;
		var cumulative = round(num(shipment.deliveredQuantity, quantity, 0)), already = round(num(shipment.contractDeliveredQuantity, 0));
		var newlyRecorded = round(Math.min(num(quantity, 0, 0), Math.max(0, cumulative - already)));
		if (newlyRecorded <= 0) return null;
		shipment.contractDeliveredQuantity = round(already + newlyRecorded);
		contract.deliveredThisTurn = round(Number(contract.deliveredThisTurn || 0) + newlyRecorded);
		return log(sector, c, {turn:turn, type:'contract-delivery', contractId:contract.id, shipmentId:shipment.id, quantity:newlyRecorded, summary:newlyRecorded + ' lots delivered under contract ' + contract.name + '.'});
	};
	API.recordLoss = function(sector, shipment, quantity, turn) {
		if (!shipment || !shipment.contractId || num(quantity, 0, 0) <= 0) return null;
		var c = state(sector), contract = c.records.find(function(r) { return String(r.id) === String(shipment.contractId); });
		if (!contract) return null;
		var cumulative = round(arr(shipment.legs).reduce(function(n, leg) { return n + num(leg && leg.quantityLost, 0, 0); }, 0));
		var already = round(num(shipment.contractLostQuantity, 0));
		var newlyRecorded = round(Math.min(num(quantity, 0, 0), Math.max(0, cumulative - already)));
		if (newlyRecorded <= 0) return null;
		shipment.contractLostQuantity = round(already + newlyRecorded);
		contract.lostThisTurn = round(Number(contract.lostThisTurn || 0) + newlyRecorded);
		return log(sector, c, {turn:turn, type:'contract-loss', contractId:contract.id, shipmentId:shipment.id, quantity:newlyRecorded, summary:newlyRecorded + ' lots were lost in transit under contract ' + contract.name + '.'});
	};
	API.getSummary = function(sector) {
		var contracts = API.getContracts(sector);
		return {total:contracts.length, active:contracts.filter(function(c) { return c.status === 'active'; }).length, paused:contracts.filter(function(c) { return c.status === 'paused'; }).length, expired:contracts.filter(function(c) { return c.status === 'expired'; }).length, shippedThisTurn:round(contracts.reduce(function(n,c) { return n + num(c.shippedThisTurn,0,0); },0)), deliveredThisTurn:round(contracts.reduce(function(n,c) { return n + num(c.deliveredThisTurn,0,0); },0))};
	};
	API.validate = function(sector) {
		var errors = [], warnings = [], records = API.getContracts(sector), ids = new Set(), m = new Map(arr(sector && sector.markets).map(function(x) { return [String(x.id),x]; }));
		records.forEach(function(c, index) {
			if (!c.id) errors.push('Trade contract is missing an ID.');
			if (ids.has(c.id)) errors.push('Duplicate trade contract ID ' + c.id + '.'); ids.add(c.id);
			var origin = m.get(String(c.originMarketId)), destination = m.get(String(c.destinationMarketId));
			if (!origin || !destination) warnings.push('Contract ' + c.id + ' references a market that is no longer present; its history is retained and it cannot dispatch until the reference is repaired.');
			else if (!hasCommodity(sector, origin.id, c.commodityId) || !hasCommodity(sector, destination.id, c.commodityId)) warnings.push('Contract ' + c.id + ' references a commodity absent from one of its current market accounts; the agreement is retained but cannot dispatch until the market data is repaired.');
			if (String(c.originMarketId) === String(c.destinationMarketId) || (origin && destination && String(origin.systemId) === String(destination.systemId))) errors.push('Contract ' + c.id + ' must connect markets in different systems.');
			if (!(Number(c.quantityPerTurn) > 0) || !Number.isFinite(Number(c.quantityPerTurn))) errors.push('Contract ' + c.id + ' has an invalid per-turn quantity.');
			if (!['active','paused','expired','cancelled','completed'].includes(c.status)) errors.push('Contract ' + c.id + ' has an invalid status.');
			if (!['critical','high','standard','low'].includes(c.priority)) errors.push('Contract ' + c.id + ' has an invalid priority.');
			if (Number(c.endTurn) > 0 && Number(c.endTurn) < Number(c.startTurn)) errors.push('Contract ' + c.id + ' ends before it starts.');
			if (c.status === 'active') records.slice(index + 1).forEach(function(other) { if (other.status === 'active' && sameLane(c, other) && overlaps(c.startTurn, c.endTurn, other.startTurn, other.endTurn)) errors.push('Active contracts ' + c.id + ' and ' + other.id + ' overlap on the same market pair and commodity.'); });
		});
		return {ok:errors.length===0, errors:errors, warnings:warnings, counts:{contracts:records.length, ledger:API.getLedger(sector).length}};
	};
	API.constants = {schemaVersion:SCHEMA_VERSION, engineVersion:ENGINE_VERSION};
	return API;
})();
