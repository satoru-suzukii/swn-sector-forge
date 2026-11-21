/*
 * Sector Forge 1.3.9 — campaign financial settlement, compacted audit history and idempotency.
 *
 * Turns recorded logistics costs into balanced campaign-credit transfers.
 * Existing faction FacCreds remain separate; this layer models abstract
 * commercial credits (Cr) and is deliberately referee-facing and tunable.
 */
var SectorSettlement = (function() {
	'use strict';
	var API = {}, SCHEMA_VERSION = 2, ENGINE_VERSION = '1.3.12';
	var sequenceRuntimeCaches = new WeakMap();
	function arr(v) { return Array.isArray(v) ? v : []; }
	function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
	function num(v, fallback, min) { var n = Number(v); return Number.isFinite(n) ? Math.max(min == null ? 0 : min, n) : fallback; }
	function round(v) { var n = Number(v); return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100; }
	function slug(v) { return String(v || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'unknown'; }
	function hash(v) { var h = 2166136261; String(v).split('').forEach(function(c) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }); return (h >>> 0).toString(36).toUpperCase(); }
	function economy(sector) { return sector && sector.simulation && sector.simulation.economy || null; }
	function finance(sector) {
		var e = economy(sector);
		if (!e) throw new Error('Initialize the local economy before using financial settlement.');
		e.settlement = obj(e.settlement) ? e.settlement : {};
		var f = e.settlement;
		f.schemaVersion = SCHEMA_VERSION; f.engineVersion = ENGINE_VERSION; f.currency = 'Cr';
		f.accounts = arr(f.accounts); f.ledger = arr(f.ledger); f.archivedLedger = arr(f.archivedLedger);
		f.archive = obj(f.archive) ? f.archive : {};
		f.archive.externalKeys = obj(f.archive.externalKeys) ? f.archive.externalKeys : {};
		f.archive.shipmentTransactions = obj(f.archive.shipmentTransactions) ? f.archive.shipmentTransactions : {};
		f.archive.latestSequence = Math.max(0, Math.floor(num(f.archive.latestSequence, 0, 0)));
		f.archive.archivedCount = Math.max(0, Math.floor(num(f.archive.archivedCount, 0, 0)));
		f.archive.totalCreditsTransferred = round(f.archive.totalCreditsTransferred || 0);
		f.nextAccountSequence = Math.max(1, Math.floor(num(f.nextAccountSequence, f.accounts.length + 1, 1)));
		ensureTransactionSequence(f);
		f.clock = obj(f.clock) ? f.clock : {}; var baseline = num(e.clock && e.clock.lastAdvancedTurn, 0, 0); f.clock.lastSettledTurn = Math.max(0, Math.floor(num(f.clock.lastSettledTurn, baseline, 0)));
		return f;
	}
	function ensureTransactionSequence(f) {
		var cached = sequenceRuntimeCaches.get(f);
		if (!cached || cached.ledgerRef !== f.ledger || cached.ledgerLength !== f.ledger.length) {
			var maximum = f.ledger.reduce(function(maximum, transaction) {
				var sequence = Number(transaction && transaction.sequence);
				if (!Number.isFinite(sequence)) { var match = String(transaction && transaction.id || '').match(/(\d+)$/); sequence = match ? Number(match[1]) : 0; }
				return Math.max(maximum, Number.isFinite(sequence) ? Math.floor(sequence) : 0);
			}, f.archive.latestSequence);
			f.nextTransactionSequence = Math.max(maximum + 1, Math.floor(num(f.nextTransactionSequence, maximum + 1, 1)));
			sequenceRuntimeCaches.set(f, {ledgerRef:f.ledger, ledgerLength:f.ledger.length});
		} else f.nextTransactionSequence = Math.max(1, Math.floor(num(f.nextTransactionSequence, 1, 1)));
	}
	function syncTransactionSequence(f) { sequenceRuntimeCaches.set(f, {ledgerRef:f.ledger, ledgerLength:f.ledger.length}); }
	function accountId(type, id) { return String(type) + ':' + String(id); }
	function findAccount(f, id) { return f.accounts.find(function(a) { return a.id === id; }) || null; }
	function ensureAccount(f, type, id, name, opening, creditLimit, source) {
		var key = accountId(type, id), item = findAccount(f, key);
		if (!item) {
			item = {id:key, ownerType:type, ownerId:String(id), name:String(name || id), currency:'Cr', balance:round(opening), openingBalance:round(opening), creditLimit:round(creditLimit), source:source || 'estimated-opening-capital', createdAtTurn:f.clock.lastSettledTurn, active:true};
			f.accounts.push(item);
		}
		return item;
	}
	function stableCorporationIds(sector) {
		var used = new Set();
		arr(sector.corporations).forEach(function(corp) {
			if (!corp || corp.id) { if (corp && corp.id) used.add(String(corp.id)); return; }
			var base = 'CORP-' + slug(corp.name) + '-' + hash(corp.name || 'unknown');
			var candidate = base, suffix = 2;
			while (used.has(candidate)) candidate = base + '-' + suffix++;
			corp.id = candidate; used.add(candidate);
		});
	}
	function initialFactionCapital(faction) {
		var wealth = num(faction.wealth, 1, 0), assets = arr(faction.assets).length;
		return round(5000 + wealth * 1800 + assets * 350);
	}
	function initialCorporateCapital(corp) {
		var v = String(corp.valuation || 'steady').toLowerCase();
		var values = {crashing:8000, shrinking:18000, steady:40000, growing:85000, booming:160000};
		return values[v] || 30000;
	}
	API.initialize = function(sector) {
		if (!sector || !sector.simulation || !sector.simulation.economy) throw new Error('Initialize the local economy before initializing settlement.');
		var f = finance(sector); stableCorporationIds(sector);
		arr(sector.factions).forEach(function(faction) {
			var opening = Number.isFinite(Number(faction.treasuryCredits)) ? Number(faction.treasuryCredits) : initialFactionCapital(faction);
			var a = ensureAccount(f, 'faction', faction.id, faction.name, opening, Math.max(5000, opening * 0.75), Number.isFinite(Number(faction.treasuryCredits)) ? 'GM-or-existing-value' : 'estimated-opening-capital');
			if (Number.isFinite(Number(faction.treasuryCredits)) && a.source === 'estimated-opening-capital') a.source = 'GM-or-existing-value';
		});
		arr(sector.corporations).forEach(function(corp) {
			var opening = Number.isFinite(Number(corp.treasuryCredits)) ? Number(corp.treasuryCredits) : initialCorporateCapital(corp);
			ensureAccount(f, 'corporation', corp.id, corp.name, opening, Math.max(10000, opening * 0.5), Number.isFinite(Number(corp.treasuryCredits)) ? 'GM-or-existing-value' : 'valuation-based-estimate');
		});
		ensureAccount(f, 'service', 'INTERSTELLAR-GUILD', 'Interstellar Logistics Guild', 0, 0, 'system-account');
		ensureAccount(f, 'service', 'CUSTOMS-AUTHORITY', 'Interstellar Customs Authority', 0, 0, 'system-account');
		ensureAccount(f, 'service', 'INTERSTELLAR-INFRASTRUCTURE', 'Interstellar Infrastructure Services', 0, 0, 'system-account');
		arr(sector.markets).forEach(function(market) {
			ensureAccount(f, 'market', market.id, (market.planetName || market.id) + ' Market Clearing', 2500, 5000, 'estimated-market-clearing-fund');
		});
		f.initialized = true;
		return {ok:true, accounts:f.accounts.length, factions:arr(sector.factions).length, corporations:arr(sector.corporations).length};
	};
	function controller(sector, systemId) {
		var system = arr(sector.systems).find(function(s) { return String(s.id) === String(systemId); });
		return system ? String(system.manualControllerFactionId || system.controllingFactionId || '') : '';
	}
	function resolveAccount(sector, type, id, fallbackName) {
		var f = finance(sector), current = findAccount(f, accountId(type, id));
		if (current) return current;
		if (type === 'faction') {
			var faction = arr(sector.factions).find(function(x) { return String(x.id) === String(id); });
			if (faction) return ensureAccount(f, 'faction', id, faction.name, initialFactionCapital(faction), Math.max(5000, initialFactionCapital(faction) * 0.75), 'estimated-opening-capital');
		}
		if (type === 'corporation') {
			var corp = arr(sector.corporations).find(function(x) { return String(x.id) === String(id); });
			if (corp) return ensureAccount(f, 'corporation', id, corp.name, initialCorporateCapital(corp), Math.max(10000, initialCorporateCapital(corp) * 0.5), 'valuation-based-estimate');
		}
		return ensureAccount(f, type, id, fallbackName || id, 0, 0, 'system-account');
	}
	function findExternalTransaction(f, externalKey) {
		if (!externalKey) return null;
		var key = String(externalKey);
		var current = f.ledger.find(function(item) { return String(item.externalKey || '') === key; });
		if (current) return current;
		var archived = f.archive && f.archive.externalKeys && f.archive.externalKeys['$' + key];
		if (archived) return {id:archived.id, sequence:archived.sequence, externalKey:key, archived:true};
		// Maintenance keys are turn-scoped. Once their detailed index entry has
		// rolled out of the eight-turn window, the settled campaign clock itself
	// is sufficient to reject a late replay without retaining every old key.
		var maintenance=key.match(/^(?:fleet|port)-maintenance:(\d+):/);
		var lastTurn=num(f.clock && f.clock.lastSettledTurn,0,0);
		if(maintenance && Number(maintenance[1])<=lastTurn-8) return {id:'FIN-EXPIRED-IDEMPOTENCY-KEY',sequence:0,externalKey:key,archived:true,expired:true};
		return null;
	}
	function appendTransaction(f, transaction) {
		var seq = f.nextTransactionSequence++;
		f.archive.latestSequence = Math.max(Number(f.archive.latestSequence || 0), seq);
		transaction.id = 'FIN-' + String(seq).padStart(8, '0');
		transaction.sequence = seq; f.ledger.push(transaction); syncTransactionSequence(f); return transaction;
	}
	function transfer(sector, payer, payee, amount, details) {
		amount = round(amount);
		if (amount <= 0) return null;
		var f = finance(sector);
		details = details || {};
		if (details.externalKey) {
			var prior = findExternalTransaction(f, details.externalKey);
			if (prior) return prior;
		}
		if (payer.id === payee.id) return null;
		var beforePayer = round(payer.balance), beforePayee = round(payee.balance);
		payer.balance = round(beforePayer - amount); payee.balance = round(beforePayee + amount);
		payer.lastTransactionTurn = details.turn; payee.lastTransactionTurn = details.turn;
		var tx = appendTransaction(f, {
			turn:details.turn, type:details.type || 'transfer', shipmentId:details.shipmentId || '', legIndex:details.legIndex == null ? null : details.legIndex,
			fromAccountId:payer.id, toAccountId:payee.id, amount:amount, currency:'Cr',
			fromBalanceBefore:beforePayer, fromBalanceAfter:payer.balance, toBalanceBefore:beforePayee, toBalanceAfter:payee.balance,
			quantityLots:details.quantityLots == null ? null : round(details.quantityLots), unitPriceCr:details.unitPriceCr == null ? null : round(details.unitPriceCr), commodityId:details.commodityId || '',
			originMarketId:details.originMarketId || '', destinationMarketId:details.destinationMarketId || '',
			memo:String(details.memo || ''), externalKey:String(details.externalKey || ''), source:'simulated', balanced:true,
			creditLimitExceeded:payer.balance < -num(payer.creditLimit, 0, 0)
		});
		return tx;
	}
	API.settleRouteLeg = function(sector, shipment, leg, turn) {
		if (!shipment || !leg) return {ok:false, reason:'Missing shipment or route leg'};
		var f = finance(sector);
		if (!f.initialized) API.initialize(sector);
		if (leg.financialSettlementId) return {ok:true, skipped:true, transactionId:leg.financialSettlementId};
		var origin = arr(sector.markets).find(function(m) { return String(m.id) === String(shipment.originMarketId); });
		var fromFactionId = String(shipment.ownerFactionId || controller(sector, leg.fromSystemId) || '');
		var payer = fromFactionId ? resolveAccount(sector, 'faction', fromFactionId) : resolveAccount(sector, 'market', shipment.originMarketId, (origin && origin.planetName || 'Market') + ' Market Clearing');
		var route = arr(sector.tradeRoutes).find(function(r) { return String(r.id) === String(leg.routeId); }) || {};
		var routeFactionId = String(route.ownerFactionId || route.operatorFactionId || controller(sector, leg.fromSystemId) || '');
		var routeCorpId = String(route.ownerCorporationId || route.operatorCorporationId || '');
		var operator = routeCorpId ? resolveAccount(sector, 'corporation', routeCorpId) : (routeFactionId ? resolveAccount(sector, 'faction', routeFactionId) : resolveAccount(sector, 'service', 'INTERSTELLAR-GUILD'));
		var destinationFactionId = controller(sector, leg.toSystemId);
		var customs = destinationFactionId ? resolveAccount(sector, 'faction', destinationFactionId) : resolveAccount(sector, 'service', 'CUSTOMS-AUTHORITY');
		var guild = resolveAccount(sector, 'service', 'INTERSTELLAR-GUILD');
		var fees = [
			{kind:'freight', amount:leg.freightCost, recipient:operator, memo:'Freight service on route ' + leg.routeId},
			{kind:'toll', amount:leg.tollCost, recipient:operator, memo:'Route toll on ' + leg.routeId},
			{kind:'tariff', amount:leg.tariffCost, recipient:customs, memo:'Border tariff at ' + leg.toSystemId}
		];
		var transactionIds = [];
		fees.forEach(function(fee) {
			var payee = fee.recipient;
			if (!payee || payee.id === payer.id) payee = guild.id === payer.id ? customs : guild;
			var tx = transfer(sector, payer, payee, fee.amount, {turn:turn, type:fee.kind, shipmentId:shipment.id, legIndex:arr(shipment.legs).length - 1, memo:fee.memo});
			if (tx) transactionIds.push(tx.id);
		});
		// Route operators incur a separate, explicit operating expense. It is a
		// service cost, not additional revenue or a second charge to the shipper.
		var operatingCost = round(leg.operatingCost);
		if (operatingCost > 0) {
			var infrastructure = resolveAccount(sector, 'service', 'INTERSTELLAR-INFRASTRUCTURE');
			var operationTx = transfer(sector, operator, infrastructure, operatingCost, {turn:turn, type:'route-operating-cost', shipmentId:shipment.id, legIndex:arr(shipment.legs).length - 1, memo:'Fuel, navigation, maintenance and route services on ' + leg.routeId});
			if (operationTx) transactionIds.push(operationTx.id);
		}
		leg.financialSettlementIds = transactionIds;
		leg.financialSettlementId = transactionIds[0] || 'FIN-NO-CHARGE';
		leg.financiallySettled = true;
		return {ok:true, skipped:false, transactionIds:transactionIds, payerAccountId:payer.id};
	};
	function sellerAccount(sector, shipment, origin) {
		var corpId = String(origin && (origin.sellerCorporationId || origin.ownerCorporationId) || '');
		if (corpId) return resolveAccount(sector, 'corporation', corpId, 'Market Supplier Corporation');
		var factionId = String(origin && (origin.controlFactionId || controller(sector, shipment.originSystemId)) || shipment.ownerFactionId || '');
		if (factionId) return resolveAccount(sector, 'faction', factionId, 'Market Supplier Faction');
		return resolveAccount(sector, 'market', shipment.originMarketId, (origin && origin.planetName || 'Origin') + ' Market Clearing');
	}
	API.settleCommodityDelivery = function(sector, shipment, deliveredQuantity, turn) {
		if (!shipment || !shipment.id) return {ok:false, reason:'Missing shipment.'};
		var f = finance(sector); if (!f.initialized) API.initialize(sector);
		var delivered = round(num(deliveredQuantity, 0, 0));
		if (delivered <= 0) return {ok:true, skipped:true, amount:0};
		var totalDelivered = round(num(shipment.deliveredQuantity, delivered, 0));
		var alreadyPaid = round(num(shipment.commodityPaidQuantity, 0, 0));
		var unpaidQuantity = round(Math.min(delivered, Math.max(0, totalDelivered - alreadyPaid)));
		if (unpaidQuantity <= 0) return {ok:true, skipped:true, amount:0};
		var unitPrice = round(num(shipment.saleUnitPriceCr, 0, 0));
		if (unitPrice <= 0) { shipment.commodityPaymentStatus = 'unpriced-legacy'; return {ok:true, skipped:true, reason:'No sale price was recorded on this pre-1.3.6 shipment.'}; }
		var origin = arr(sector.markets).find(function(m) { return String(m.id) === String(shipment.originMarketId); });
		var destination = arr(sector.markets).find(function(m) { return String(m.id) === String(shipment.destinationMarketId); });
		var buyer = resolveAccount(sector, 'market', shipment.destinationMarketId, (destination && destination.planetName || 'Destination') + ' Market Clearing');
		var seller = sellerAccount(sector, shipment, origin);
		var amount = round(unitPrice * unpaidQuantity);
		var tx = transfer(sector, buyer, seller, amount, {turn:turn, type:'commodity-purchase', shipmentId:shipment.id, quantityLots:unpaidQuantity, unitPriceCr:unitPrice, commodityId:shipment.commodityId, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, memo:'Purchase of ' + unpaidQuantity + ' lots of ' + shipment.commodityId + ' from ' + (origin && origin.planetName || shipment.originMarketId)});
		if (!tx) return {ok:false, skipped:true, reason:'The buyer and seller accounts could not be settled.'};
		shipment.commodityPaidQuantity = round(alreadyPaid + unpaidQuantity);
		shipment.commoditySettlementIds = arr(shipment.commoditySettlementIds);
		shipment.commoditySettlementIds.push(tx.id);
		shipment.commodityPaidCr = round(num(shipment.commodityPaidCr, 0, 0) + amount);
		shipment.commodityPaymentStatus = 'settled';
		if (typeof SectorSimulation !== 'undefined' && SectorSimulation.recordEvent && tx) { var paymentEvent=SectorSimulation.recordEvent(sector, {category:'economic', type:'commodity-purchase-settled', source:'settlement-engine', summary:unpaidQuantity + ' lots of ' + shipment.commodityId + ' were purchased for ' + amount + ' Cr on delivery.', shipmentId:shipment.id, originMarketId:shipment.originMarketId, destinationMarketId:shipment.destinationMarketId, amount:amount, unitPriceCr:unitPrice, turn:turn, visibility:'gm', causes:shipment.lastChronicleEventId?[shipment.lastChronicleEventId]:[]}); shipment.chronicleEventIds=arr(shipment.chronicleEventIds);if(paymentEvent){shipment.chronicleEventIds.push(paymentEvent.id);if(shipment.chronicleEventIds.length>32)shipment.chronicleEventIds=shipment.chronicleEventIds.slice(-32);shipment.lastChronicleEventId=paymentEvent.id;} }
		return {ok:true, skipped:!tx, amount:amount, quantity:unpaidQuantity, transactionId:tx && tx.id, buyerAccountId:buyer.id, sellerAccountId:seller.id};
	};
	API.transferCredits = function(sector, fromOwner, toOwner, amount, details) {
		var f = finance(sector);
		if (!f.initialized) API.initialize(sector);
		fromOwner = obj(fromOwner) ? fromOwner : {}; toOwner = obj(toOwner) ? toOwner : {}; details = obj(details) ? details : {};
		if (!fromOwner.ownerType || !fromOwner.ownerId || !toOwner.ownerType || !toOwner.ownerId) return {ok:false, reason:'Both transfer accounts require an owner type and ID.'};
		var payer = resolveAccount(sector, String(fromOwner.ownerType), String(fromOwner.ownerId), fromOwner.name || fromOwner.ownerId);
		var payee = resolveAccount(sector, String(toOwner.ownerType), String(toOwner.ownerId), toOwner.name || toOwner.ownerId);
		var prior = findExternalTransaction(f, details.externalKey);
		if (prior) return {ok:true, skipped:true, transaction:prior, id:prior.id, reason:'This external transfer key was already settled.'};
		var transaction = transfer(sector, payer, payee, amount, Object.assign({turn:Math.floor(num(details.turn, sector.factionTurn || 0, 0)), type:'transfer'}, details));
		if (!transaction) return {ok:false, reason:'The transfer amount must be positive and the accounts must be different.'};
		return {ok:true, skipped:false, transaction:transaction, id:transaction.id};
	};
	API.markTurnSettled = function(sector, turn) { var f = finance(sector); f.clock.lastSettledTurn = Math.max(f.clock.lastSettledTurn, Math.floor(num(turn, 0, 0))); return f.clock.lastSettledTurn; };
	API.getAccounts = function(sector) { var f = sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.settlement; return arr(f && f.accounts); };
	API.getLedger = function(sector) { var f = sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.settlement; return arr(f && f.ledger); };
	API.getSummary = function(sector) {
		var f = sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.settlement;
		var accounts = arr(f && f.accounts), ledger = arr(f && f.ledger);
		return {initialized:!!(f && f.schemaVersion === SCHEMA_VERSION), accounts:accounts.length, factions:accounts.filter(function(a){return a.ownerType==='faction';}).length, corporations:accounts.filter(function(a){return a.ownerType==='corporation';}).length, transactions:ledger.length+num(f && f.archive && f.archive.archivedCount,0,0), retainedTransactions:ledger.length, archivedTransactions:num(f && f.archive && f.archive.archivedCount,0,0), totalCreditsTransferred:round(num(f && f.archive && f.archive.totalCreditsTransferred,0,0)+ledger.reduce(function(t,x){return t+num(x.amount,0,0);},0)), debtAccounts:accounts.filter(function(a){return Number(a.balance)<0;}).length, turn:num(f && f.clock && f.clock.lastSettledTurn,0,0)};
	};
	API.validate = function(sector) {
		var errors=[], warnings=[], f=sector&&sector.simulation&&sector.simulation.economy&&sector.simulation.economy.settlement;
		if(!f)return {ok:true,errors:errors,warnings:['Financial settlement has not been initialized.']};
		var seen=new Set(); arr(f.accounts).forEach(function(a){if(!a.id)errors.push('Financial account is missing an ID.');if(seen.has(a.id))errors.push('Duplicate financial account '+a.id+'.');seen.add(a.id);if(!Number.isFinite(Number(a.balance)))errors.push('Invalid account balance for '+a.id+'.');if(!Number.isFinite(Number(a.openingBalance)))errors.push('Invalid opening balance for '+a.id+'.');if(!Number.isFinite(Number(a.creditLimit))||Number(a.creditLimit)<0)errors.push('Invalid overdraft warning threshold for '+a.id+'.');});
		var transactionIds=new Set(), transactionById=new Map();
		arr(f.ledger).forEach(function(t){if(!t.id)errors.push('Financial transaction is missing an ID.');if(transactionIds.has(t.id))errors.push('Duplicate financial transaction '+t.id+'.');transactionIds.add(t.id);transactionById.set(String(t.id),t);if(!Number.isFinite(Number(t.amount))||Number(t.amount)<=0)errors.push('Invalid transaction amount for '+t.id+'.');if(t.balanced!==true)errors.push('Unbalanced transfer '+t.id+'.');var from=findAccount(f,t.fromAccountId),to=findAccount(f,t.toAccountId);if(!from||!to)errors.push('Transaction '+t.id+' references a missing account.');if(t.fromAccountId===t.toAccountId)errors.push('Transaction '+t.id+' transfers to the same account.');if(Number.isFinite(Number(t.amount))&&Number.isFinite(Number(t.fromBalanceBefore))&&Number.isFinite(Number(t.fromBalanceAfter))&&Math.abs((Number(t.fromBalanceBefore)-Number(t.amount))-Number(t.fromBalanceAfter))>0.011)errors.push('Payer balance arithmetic does not reconcile for '+t.id+'.');if(Number.isFinite(Number(t.amount))&&Number.isFinite(Number(t.toBalanceBefore))&&Number.isFinite(Number(t.toBalanceAfter))&&Math.abs((Number(t.toBalanceBefore)+Number(t.amount))-Number(t.toBalanceAfter))>0.011)errors.push('Payee balance arithmetic does not reconcile for '+t.id+'.');});
		var archivedShipmentTransactions = obj(f.archive && f.archive.shipmentTransactions) ? f.archive.shipmentTransactions : {};
		Object.keys(archivedShipmentTransactions).forEach(function(key) { var tx = archivedShipmentTransactions[key]; if (!tx || !tx.id) return; transactionIds.add(String(tx.id)); transactionById.set(String(tx.id), tx); });
		var logisticsState = sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.logistics;
		var shipmentList = arr(logisticsState && logisticsState.shipments).slice();
		var archivedShipments = obj(logisticsState && logisticsState.shipmentArchive && logisticsState.shipmentArchive.shipments) ? logisticsState.shipmentArchive.shipments : {};
		Object.keys(archivedShipments).forEach(function(key) { if (archivedShipments[key]) shipmentList.push(archivedShipments[key]); });
		shipmentList.forEach(function(shipment) {
			var paid = Number(shipment.commodityPaidQuantity || 0), delivered = Number(shipment.deliveredQuantity || 0);
			if (!Number.isFinite(paid) || paid < -0.001 || paid > delivered + 0.011) errors.push('Commodity settlement quantity exceeds delivery for ' + shipment.id + '.');
			var ids = arr(shipment.commoditySettlementIds), paidAmount = 0, paidLots = 0;
			ids.forEach(function(id) {
				if (!transactionIds.has(id)) errors.push('Shipment ' + shipment.id + ' references missing commodity payment ' + id + '.');
				var tx = transactionById.get(String(id));
				if (tx) { if (tx.type !== 'commodity-purchase' || tx.shipmentId !== shipment.id) errors.push('Shipment ' + shipment.id + ' references a non-matching commodity payment ' + id + '.'); paidAmount += Number(tx.amount || 0); paidLots += Number(tx.quantityLots || 0); }
			});
			if (Math.abs(paidAmount - Number(shipment.commodityPaidCr || 0)) > 0.011) errors.push('Commodity payment value does not reconcile for ' + shipment.id + '.');
			if (Math.abs(paidLots - paid) > 0.011) errors.push('Commodity payment quantity does not reconcile for ' + shipment.id + '.');
		});
		return {ok:errors.length===0,errors:errors,warnings:warnings,counts:{accounts:arr(f.accounts).length,ledger:arr(f.ledger).length,archivedLedger:num(f.archive && f.archive.archivedCount,0,0)}};
	};
	API.constants = {schemaVersion:SCHEMA_VERSION,engineVersion:ENGINE_VERSION,currency:'Cr'};
	return API;
})();
