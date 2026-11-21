/*
 * Sector Forge 1.3.10.1 — simulation foundation, recovery identity, bounded archives and turn coordination.
 *
 * This module preserves CampaignTools as the legacy faction-action executor.
 * It owns the versioned simulation envelope, explicit migration, keyed random
 * streams, provenance/override helpers, derived-state boundaries, Chronicle,
 * and the staged campaign-turn transaction. Economy, logistics, settlement,
 * politics, strategic actors and transport remain separate cooperating engines.
 */
var SectorSimulation = (function() {
	'use strict';

	var API = {};
	var recoveryIdentitySequence = 0;
	var SIMULATION_SCHEMA_VERSION = 1;
	var ENGINE_VERSION = '1.3.12';
	var DEFAULT_HISTORY_RETENTION = {chronicleEvents:150, economyLedgerEntries:300, marketLedgerEntries:4, logisticsLedgerEntries:500, shipmentRecords:500, settlementLedgerEntries:300, contractLedgerEntries:300, transportLedgerEntries:300, diplomacyEvents:200, politicsEvents:250, perRecordHistory:25, turnJournal:20, factionTurnHistoryEntries:20};
	var DEFAULT_ARCHIVE_DETAIL_BUDGET_BYTES = 512 * 1024;
	var DEFAULT_LIVE_ECONOMY_HISTORY_BUDGET_BYTES = 1024 * 1024;
	var UINT32_RANGE = 4294967296;

	function isObject(value) {
		return !!value && typeof value === 'object' && !Array.isArray(value);
	}

	function asArray(value) {
		return Array.isArray(value) ? value : [];
	}

	function cloneJSON(value) {
		if (value === undefined) return undefined;
		return JSON.parse(JSON.stringify(value));
	}

	function finiteInteger(value, fallback, minimum) {
		var parsed = Number(value);
		if (!Number.isFinite(parsed)) return fallback;
		return Math.max(minimum == null ? 0 : minimum, Math.floor(parsed));
	}

	function hashString(value) {
		var hash = 2166136261;
		var input = String(value == null ? '' : value);
		for (var i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}

	function sectorSeed(sector) {
		var systems = asArray(sector.systems).map(function(system) {
			return {
				id:String(system && system.id || ''),
				name:String(system && system.name || ''),
				x:Number.isFinite(Number(system && system.x != null ? system.x : NaN)) ? Number(system.x) : null,
				y:Number.isFinite(Number(system && system.y != null ? system.y : NaN)) ? Number(system.y) : null,
				worlds:asArray(system && system.planets).map(function(planet) {
					return {id:String(planet && planet.id || ''), name:String(planet && planet.name || '')};
				}).sort(function(a, b) { return a.id.localeCompare(b.id); })
			};
		}).sort(function(a, b) { return a.id.localeCompare(b.id); });
		var factions = asArray(sector.factions).map(function(faction) { return String(faction && faction.id || ''); }).sort();
		var identity = JSON.stringify({
			name:String(sector.name || 'Unnamed Sector'),
				grid:{columns:finiteInteger(sector.grid && sector.grid.columns, 10, 1), rows:finiteInteger(sector.grid && sector.grid.rows, 12, 1)},
				systems:systems,
				factions:factions
			});
		var seed = hashString(identity);
		return seed || 0x6D2B79F5;
	}

	function retentionPolicy(sector) {
		var stored = sector && sector.simulation && sector.simulation.settings && sector.simulation.settings.historyRetention;
		var result = {};
		Object.keys(DEFAULT_HISTORY_RETENTION).forEach(function(key) {
			var value = Number(stored && stored[key]);
			result[key] = Number.isFinite(value) ? Math.max(4, Math.min(100000, Math.floor(value))) : DEFAULT_HISTORY_RETENTION[key];
		});
		return result;
	}

	function archiveRecord(archive, record, domain) {
		// Detailed records are retained until the campaign-wide byte budget is
		// reached. Aggregate counters and settlement idempotency indexes survive
		// pruning; old 1.3.9 summary-only records cannot be reconstructed.
		archive.records = asArray(archive.records);
		if (record && typeof record === 'object') archive.records.push(cloneJSON(record));
		var turn = finiteInteger(record && record.turn, 0, 0);
		archive.archivedCount = finiteInteger(archive.archivedCount, 0, 0) + 1;
		archive.firstTurn = archive.firstTurn == null ? turn : Math.min(archive.firstTurn, turn);
		archive.lastTurn = Math.max(finiteInteger(archive.lastTurn, 0, 0), turn);
		if (record && record.id) {
			if (!archive.firstId) archive.firstId = String(record.id);
			archive.lastId = String(record.id);
		}
		var type = String(record && (record.type || record.category) || 'other').slice(0, 80);
		archive.byType = isObject(archive.byType) ? archive.byType : {};
		var typeKey = '$' + type;
		archive.byType[typeKey] = finiteInteger(archive.byType[typeKey], 0, 0) + 1;
		if (domain === 'settlement') {
			var amount = Number(record && record.amount);
			if (Number.isFinite(amount)) archive.totalCreditsTransferred = Math.round((Number(archive.totalCreditsTransferred || 0) + amount) * 100) / 100;
			if (record && record.externalKey) {
				archive.externalKeys = isObject(archive.externalKeys) ? archive.externalKeys : {};
				archive.externalKeys['$' + String(record.externalKey)] = {id:String(record.id || ''), sequence:finiteInteger(record.sequence, 0, 0)};
			}
			if (record && record.type === 'commodity-purchase' && record.shipmentId && record.id) {
				archive.shipmentTransactions = isObject(archive.shipmentTransactions) ? archive.shipmentTransactions : {};
				archive.shipmentTransactions['$' + String(record.id)] = {id:String(record.id), type:String(record.type), shipmentId:String(record.shipmentId), amount:Number(record.amount || 0), quantityLots:Number(record.quantityLots || 0), unitPriceCr:Number(record.unitPriceCr || 0), commodityId:String(record.commodityId || '')};
			}
			archive.latestSequence = Math.max(finiteInteger(archive.latestSequence, 0, 0), finiteInteger(record && record.sequence, 0, 0));
		} else if (domain === 'economy') {
			['totalProduction','totalConsumption','totalUnmetDemand'].forEach(function(field) {
				var value = Number(record && record[field]);
				if (Number.isFinite(value)) archive[field] = Math.round((Number(archive[field] || 0) + value) * 100) / 100;
			});
		} else if (domain === 'chronicle') {
			archive.byCategory = isObject(archive.byCategory) ? archive.byCategory : {};
			var category = String(record && record.category || 'general').slice(0, 80);
			var categoryKey = '$' + category;
			archive.byCategory[categoryKey] = finiteInteger(archive.byCategory[categoryKey], 0, 0) + 1;
			if (record && record.visibility === 'public') archive.publicEvents = finiteInteger(archive.publicEvents, 0, 0) + 1;
			else archive.gmEvents = finiteInteger(archive.gmEvents, 0, 0) + 1;
		} else if (domain === 'faction-turn-history') {
			archive.turnCount = finiteInteger(archive.turnCount, 0, 0) + 1;
			archive.eventCount = finiteInteger(archive.eventCount, 0, 0) + asArray(record && record.events).length;
			if (record && record.gmNotes) {
				archive.notesByTurn = isObject(archive.notesByTurn) ? archive.notesByTurn : {};
				archive.notesByTurn['$' + String(record.turn || record.id || 'unknown')] = {turn:finiteInteger(record.turn, 0, 0),id:String(record.id || ''),notes:String(record.gmNotes)};
			}
			archive.eventActions = isObject(archive.eventActions) ? archive.eventActions : {};
			asArray(record && record.events).forEach(function(entry) {
				var action = String(entry && (entry.action || entry.event || entry.result) || 'other').slice(0, 80);
				var actionKey = '$' + action;
				archive.eventActions[actionKey] = finiteInteger(archive.eventActions[actionKey], 0, 0) + 1;
			});
		}
	}

	function compactArray(owner, property, archiveProperty, limit, domain) {
		if (!isObject(owner) || !Array.isArray(owner[property])) return 0;
		var records = owner[property];
		if (records.length <= limit) return 0;
		var removed = records.splice(0, records.length - limit);
		var archive = isObject(owner[archiveProperty]) ? owner[archiveProperty] : {schemaVersion:1, archivedCount:0, firstTurn:null, lastTurn:0, byType:{}};
		removed.forEach(function(record) { archiveRecord(archive, record, domain); });
		archive.schemaVersion = 2;
		archive.lastCompactedAtTurn = removed.length ? Math.max(finiteInteger(archive.lastCompactedAtTurn, 0, 0), finiteInteger(removed[removed.length - 1] && removed[removed.length - 1].turn, 0, 0)) : finiteInteger(archive.lastCompactedAtTurn, 0, 0);
		owner[archiveProperty] = archive;
		return removed.length;
	}

	function compactRecordHistories(records, limit) {
		var count = 0;
		asArray(records).forEach(function(record) {
			if (!isObject(record) || !Array.isArray(record.history) || record.history.length <= limit) return;
			var removed = record.history.splice(0, record.history.length - limit);
			var archive = isObject(record.historyArchive) ? record.historyArchive : {schemaVersion:2, archivedCount:0, firstTurn:null, lastTurn:0, byType:{}, records:[]};
			removed.forEach(function(entry) { archiveRecord(archive, entry, 'history'); });
			archive.schemaVersion = 2;
			record.historyArchive = archive;
			count += removed.length;
		});
		return count;
	}

	function jsonByteLength(value) {
		var json = JSON.stringify(value);
		if (typeof Blob !== 'undefined') return new Blob([json]).size;
		try { return unescape(encodeURIComponent(json)).length; } catch (error) { return json.length * 2; }
	}
	function collectDetailedArchiveEntries(sector) {
		var result = [], seen = new Set(), sim = sector && sector.simulation || {}, economy = sim.economy || {};
		function addArray(owner, property, label) {
			var records = owner && owner[property]; if (!Array.isArray(records)) return;
			records.forEach(function(record) {
				if (!record || typeof record !== 'object' || seen.has(record)) return;
				seen.add(record); result.push({kind:'record',owner:owner,property:property,record:record,turn:finiteInteger(record.turn != null ? record.turn : record.completedTurn,0,0),label:label});
			});
		}
		function addArchive(archive,label) { addArray(archive,'records',label); }
		addArchive(sector && sector.factionTurnHistoryArchive,'faction-turn-history');
		addArchive(sim.chronicle && sim.chronicle.archive,'chronicle');
		addArchive(economy.ledgerArchive,'economy');
		asArray(economy.marketStates).forEach(function(state) { addArchive(state.ledgerArchive,'market-ledger'); addArchive(state.logisticsLedgerArchive,'market-logistics-ledger'); });
		var logistics=economy.logistics||{}; addArchive(logistics.ledgerArchive,'logistics-ledger');
		addArchive(economy.settlement && economy.settlement.archive,'settlement');
		addArchive(economy.contracts && economy.contracts.ledgerArchive,'contracts');
		addArchive(sim.transport && sim.transport.ledgerArchive,'transport');
		addArchive(sim.diplomacy && sim.diplomacy.historyArchive,'diplomacy');
		addArchive(sim.politics && sim.politics.historyArchive,'politics');
		addArchive(sim.turnCoordinator && sim.turnCoordinator.journalArchive,'turn-journal');
		['treaties','sanctions','wars'].forEach(function(kind) { asArray(sim.politics && sim.politics[kind]).forEach(function(record) { addArchive(record && record.historyArchive,'political-record-history'); }); });
		var shipments=logistics.shipmentArchive && logistics.shipmentArchive.shipments || {};
		Object.keys(shipments).forEach(function(key) { var record=shipments[key]; if(record&&typeof record==='object'&&record._detailPruned!==true) result.push({kind:'shipment',owner:shipments,key:key,record:record,turn:finiteInteger(record.completedTurn != null ? record.completedTurn : record.createdTurn,0,0),label:'shipment-detail'}); });
		return result;
	}
	function archiveDetailBudget(sector) {
		var settings=sector && sector.simulation && sector.simulation.settings || {}, requested=Number(settings.archiveDetailBudgetBytes);
		return Number.isFinite(requested) ? Math.max(64*1024,Math.min(10*1024*1024,Math.floor(requested))) : DEFAULT_ARCHIVE_DETAIL_BUDGET_BYTES;
	}
	function liveEconomyHistoryBudget(sector) {
		var settings=sector && sector.simulation && sector.simulation.settings || {}, requested=Number(settings.liveEconomyHistoryBudgetBytes);
		return Number.isFinite(requested) ? Math.max(128*1024,Math.min(16*1024*1024,Math.floor(requested))) : DEFAULT_LIVE_ECONOMY_HISTORY_BUDGET_BYTES;
	}
	function collectLiveEconomyHistoryEntries(sector) {
		var result=[], seen=new Set(), simulation=sector && sector.simulation || {}, economy=simulation.economy || {};
		function add(owner,property,archiveProperty,domain,label) {
			var records=owner && owner[property]; if(!Array.isArray(records))return;
			for(var i=0;i<records.length;i++) {
				var record=records[i]; if(!record || typeof record!=='object' || seen.has(record))continue;
				seen.add(record);
				result.push({owner:owner,property:property,archiveProperty:archiveProperty,domain:domain,label:label,record:record,turn:finiteInteger(record.turn != null ? record.turn : record.completedTurn,0,0),isLatest:i===records.length-1});
			}
		}
		add(economy,'ledger','ledgerArchive','economy','economy-ledger');
		asArray(economy.marketStates).forEach(function(state) {
			add(state,'ledger','ledgerArchive','economy','market-ledger:'+String(state.marketId||''));
			add(state,'logisticsLedger','logisticsLedgerArchive','logistics','market-logistics-ledger:'+String(state.marketId||''));
		});
		add(economy.logistics,'ledger','ledgerArchive','logistics','logistics-ledger');
		add(economy.settlement,'ledger','archive','settlement','settlement-ledger');
		add(economy.contracts,'ledger','ledgerArchive','contracts','contract-ledger');
		add(simulation.transport,'ledger','ledgerArchive','transport','transport-ledger');
		return result;
	}
	function compactLiveEconomyHistory(sector) {
		var entries=collectLiveEconomyHistoryEntries(sector), budget=liveEconomyHistoryBudget(sector), bytes=0, compacted=0;
		entries.forEach(function(entry){entry.bytes=jsonByteLength(entry.record);bytes+=entry.bytes;});
		if(bytes>budget) {
			// Preserve the newest record in each individual ledger. Otherwise trim
			// oldest records first across markets and economy subsystems, which keeps
			// the retained window fair without sacrificing every record for a market.
			var candidates=entries.filter(function(entry){return !entry.isLatest;}).sort(function(a,b){return a.turn-b.turn||a.label.localeCompare(b.label)||String(a.record.id||'').localeCompare(String(b.record.id||''));});
			for(var i=0;i<candidates.length && bytes>budget;i++) {
				var entry=candidates[i], list=entry.owner[entry.property], index=list.indexOf(entry.record);
				if(index<0)continue;
				list.splice(index,1);
				var archive=isObject(entry.owner[entry.archiveProperty])?entry.owner[entry.archiveProperty]:{schemaVersion:1,archivedCount:0,firstTurn:null,lastTurn:0,byType:{}};
				archiveRecord(archive,entry.record,entry.domain);
				archive.schemaVersion=2;
				archive.lastCompactedAtTurn=Math.max(finiteInteger(archive.lastCompactedAtTurn,0,0),entry.turn);
				entry.owner[entry.archiveProperty]=archive;
				bytes-=entry.bytes; compacted++;
			}
		}
		return {compacted:compacted,bytes:Math.max(0,bytes),budgetBytes:budget,retainedRecords:entries.length-compacted,overBudget:bytes>budget};
	}
	function measureDetailedArchive(sector) {
		var entries=collectDetailedArchiveEntries(sector), bytes=0;
		entries.forEach(function(entry){entry.bytes=jsonByteLength(entry.record);bytes+=entry.bytes;});
		return {bytes:bytes,budgetBytes:archiveDetailBudget(sector),records:entries.length};
	}
	function pruneDetailedArchive(sector) {
		var measured=measureDetailedArchive(sector); if(measured.bytes<=measured.budgetBytes)return Object.assign({pruned:0},measured);
		var entries=collectDetailedArchiveEntries(sector); entries.forEach(function(entry){entry.bytes=jsonByteLength(entry.record);});
		entries.sort(function(a,b){return a.turn-b.turn||a.label.localeCompare(b.label)||String(a.record.id||'').localeCompare(String(b.record.id||''));});
		var total=measured.bytes,pruned=0,shipmentPruned=0;
		for(var i=0;i<entries.length&&total>measured.budgetBytes;i++){
			var entry=entries[i];
			if(entry.kind==='shipment'){
				var full=entry.record;
				// Keep a compact reconciliation stub for the settlement/logistics validators.
				entry.owner[entry.key]={id:full.id,status:full.status,createdTurn:full.createdTurn,completedTurn:full.completedTurn,deliveredTurn:full.deliveredTurn,commodityId:full.commodityId,originMarketId:full.originMarketId,destinationMarketId:full.destinationMarketId,originSystemId:full.originSystemId,destinationSystemId:full.destinationSystemId,quantity:full.quantity,remainingQuantity:full.remainingQuantity,deliveredQuantity:full.deliveredQuantity,commodityPaidQuantity:full.commodityPaidQuantity,commodityPaidCr:full.commodityPaidCr,commoditySettlementIds:Array.isArray(full.commoditySettlementIds)?full.commoditySettlementIds.slice():[],saleUnitPriceCr:full.saleUnitPriceCr,_detailPruned:true};shipmentPruned++;}
			else {var list=entry.owner[entry.property],index=list.indexOf(entry.record);if(index>=0){list.splice(index,1);entry.owner.detailedRecordsPruned=finiteInteger(entry.owner.detailedRecordsPruned,0,0)+1;}}
			total-=entry.bytes;pruned++;
		}
		var shipmentArchive=sector.simulation&&sector.simulation.economy&&sector.simulation.economy.logistics&&sector.simulation.economy.logistics.shipmentArchive;
		if(shipmentArchive&&shipmentPruned)shipmentArchive.detailedRecordsPruned=finiteInteger(shipmentArchive.detailedRecordsPruned,0,0)+shipmentPruned;
		return {bytes:Math.max(0,total),budgetBytes:measured.budgetBytes,records:Math.max(0,measured.records-pruned),pruned:pruned};
	}

	function compactSettlementExternalKeyIndex(sector, retentionTurns) {
		var settlement=sector && sector.simulation && sector.simulation.economy && sector.simulation.economy.settlement;
		var index=settlement && settlement.archive && settlement.archive.externalKeys;
		if(!isObject(index))return 0;
		var lastTurn=finiteInteger(settlement.clock && settlement.clock.lastSettledTurn,finiteInteger(sector && sector.factionTurn,0,0),0);
		var cutoff=lastTurn-Math.max(1,finiteInteger(retentionTurns,8,1)),removed=0;
		Object.keys(index).forEach(function(key) {
			var match=String(key).replace(/^\$/,'').match(/^(?:fleet|port)-maintenance:(\d+):/);
			if(match && Number(match[1])<=cutoff) { delete index[key]; removed++; }
		});
		settlement.archive.externalKeyRetentionTurns=Math.max(1,finiteInteger(retentionTurns,8,1));
		settlement.archive.externalKeysPruned=finiteInteger(settlement.archive.externalKeysPruned,0,0)+removed;
		return removed;
	}

	function compactHistoryInternal(sector) {
		var simulation = sector && sector.simulation;
		if (!isObject(simulation)) return {compacted:0, limits:cloneJSON(DEFAULT_HISTORY_RETENTION)};
		var limits = retentionPolicy(sector), compacted = 0, economy = simulation.economy || {};
		var chronicle = ensureChronicle(simulation);
		compacted += compactArray(sector, 'factionTurnHistory', 'factionTurnHistoryArchive', limits.factionTurnHistoryEntries, 'faction-turn-history');
		compacted += compactArray(chronicle, 'events', 'archive', limits.chronicleEvents, 'chronicle');
		compacted += compactArray(economy, 'ledger', 'ledgerArchive', limits.economyLedgerEntries, 'economy');
		asArray(economy.marketStates).forEach(function(state) {
			compacted += compactArray(state, 'retiredCommodities', 'retiredCommoditiesArchive', 50, 'economy');
			compacted += compactArray(state, 'ledger', 'ledgerArchive', limits.marketLedgerEntries, 'economy');
			// Market logistics ledgers are independent arrays; include them or they
			// bypass the ordinary market-history retention limit.
			compacted += compactArray(state, 'logisticsLedger', 'logisticsLedgerArchive', limits.marketLedgerEntries, 'logistics');
		});
		if (isObject(economy.logistics)) {
			compacted += compactArray(economy.logistics, 'ledger', 'ledgerArchive', limits.logisticsLedgerEntries, 'logistics');
			if (economy.initialized === true && typeof SectorLogistics !== 'undefined' && typeof SectorLogistics.compactShipments === 'function') compacted += SectorLogistics.compactShipments(sector, limits.shipmentRecords).archived || 0;
		}
		if (isObject(economy.settlement)) { compacted += compactArray(economy.settlement, 'ledger', 'archive', limits.settlementLedgerEntries, 'settlement'); compactSettlementExternalKeyIndex(sector, 8); }
		if (isObject(economy.contracts)) compacted += compactArray(economy.contracts, 'ledger', 'ledgerArchive', limits.contractLedgerEntries, 'contracts');
		if (isObject(simulation.transport)) compacted += compactArray(simulation.transport, 'ledger', 'ledgerArchive', limits.transportLedgerEntries, 'transport');
		if (isObject(simulation.diplomacy)) compacted += compactArray(simulation.diplomacy, 'history', 'historyArchive', limits.diplomacyEvents, 'diplomacy');
		if (isObject(simulation.politics)) {
			compacted += compactArray(simulation.politics, 'history', 'historyArchive', limits.politicsEvents, 'politics');
			compacted += compactRecordHistories(simulation.politics.treaties, limits.perRecordHistory);
			compacted += compactRecordHistories(simulation.politics.sanctions, limits.perRecordHistory);
			compacted += compactRecordHistories(simulation.politics.wars, limits.perRecordHistory);
		}
		if (isObject(simulation.turnCoordinator)) compacted += compactArray(simulation.turnCoordinator, 'journal', 'journalArchive', limits.turnJournal, 'turn-journal');
		var liveHistoryBudget = compactLiveEconomyHistory(sector); compacted += liveHistoryBudget.compacted;
		var archiveBudget = pruneDetailedArchive(sector);
		return {compacted:compacted, limits:limits, liveEconomyHistory:liveHistoryBudget, archiveBudget:archiveBudget, chronicle:{retained:chronicle.events.length, archived:finiteInteger(chronicle.archive && chronicle.archive.archivedCount, 0, 0)}, factionTurnHistory:{retained:asArray(sector.factionTurnHistory).length, archived:finiteInteger(sector.factionTurnHistoryArchive && sector.factionTurnHistoryArchive.archivedCount, 0, 0)}};
	}

	function ensureChronicle(simulation) {
		simulation.chronicle = isObject(simulation.chronicle) ? simulation.chronicle : {};
		simulation.chronicle.events = asArray(simulation.chronicle.events);
		var maximumSequence = simulation.chronicle.events.reduce(function(maximum, event) {
			var sequence = Number(event && event.sequence);
			if (!Number.isFinite(sequence)) {
				var match = String(event && event.id || '').match(/(\d+)$/);
				sequence = match ? Number(match[1]) : 0;
			}
			return Math.max(maximum, Number.isFinite(sequence) ? Math.floor(sequence) : 0);
		}, 0);
		simulation.chronicle.nextSequence = Math.max(
			finiteInteger(simulation.chronicle.nextSequence, maximumSequence + 1, 1),
			maximumSequence + 1
		);
		return simulation.chronicle;
	}

	/*
	 * Idempotent migration. It does not call enrichSector(), generate content,
	 * recalculate markets, rewrite old turn history, or discard unknown fields.
	 * The legacy sector schemaVersion stays at 3 for compatibility; the new
	 * simulation has its own independent schemaVersion.
	 */
	API.migrateSector = function(sector, options) {
		if (!isObject(sector)) throw new TypeError('A sector object is required for 1.3 migration.');
		options = options || {};

		var simulation = isObject(sector.simulation) ? sector.simulation : null;
		if (!simulation) simulation = {};

		var existingVersion = finiteInteger(simulation.schemaVersion, 0, 0);
		if (existingVersion > SIMULATION_SCHEMA_VERSION) {
			throw new Error('This sector uses a newer simulation schema (' + existingVersion + ').');
		}

		// Keep the established factionTurn field authoritative until the legacy
		// faction engine is replaced by the new turn coordinator.
		var legacyTurn = finiteInteger(sector.factionTurn, 0, 0);
		simulation.schemaVersion = SIMULATION_SCHEMA_VERSION;
		simulation.engineVersion = ENGINE_VERSION;
		simulation.clock = isObject(simulation.clock) ? simulation.clock : {};
		simulation.clock.turn = legacyTurn;
		simulation.clock.lastAdvancedAtTurn = finiteInteger(simulation.clock.lastAdvancedAtTurn, legacyTurn, 0);

		simulation.random = isObject(simulation.random) ? simulation.random : {};
		var initialSeed = sectorSeed(sector);
		var seed = finiteInteger(simulation.random.seed, initialSeed, 0) >>> 0;
		if (!seed) seed = 0x6D2B79F5;
		// 1.3.1 used one mutable sector-wide stream. Retain its counters only as
		// migration diagnostics; keyed streams below never read or update them.
		if (simulation.random.state !== undefined && simulation.random.legacyState === undefined) {
			simulation.random.legacyState = finiteInteger(simulation.random.state, seed, 0) >>> 0;
		}
		if (simulation.random.draws !== undefined && simulation.random.legacyDraws === undefined) {
			simulation.random.legacyDraws = finiteInteger(simulation.random.draws, 0, 0);
		}
		delete simulation.random.state;
		delete simulation.random.draws;
		simulation.random.algorithm = 'xorshift32-keyed-v1';
		simulation.random.seed = seed;

		simulation.settings = isObject(simulation.settings) ? simulation.settings : {};
		ensureChronicle(simulation);
		simulation.derived = isObject(simulation.derived) ? simulation.derived : {};
		simulation.derived.schemaVersion = 1;
		simulation.derived.lastFingerprint = typeof simulation.derived.lastFingerprint === 'string' ? simulation.derived.lastFingerprint : '';

		simulation.migration = isObject(simulation.migration) ? simulation.migration : {};
		simulation.migration.version = SIMULATION_SCHEMA_VERSION;
		simulation.migration.sourceSectorSchemaVersion = finiteInteger(
			simulation.migration.sourceSectorSchemaVersion,
			finiteInteger(sector.schemaVersion, 0, 0),
			0
		);
		simulation.migration.sourceApplicationVersion = simulation.migration.sourceApplicationVersion || options.sourceApplicationVersion || 'unknown';
		sector.simulation = simulation;
		return sector;
	};

	API.syncLegacyTurn = function(sector) {
		if (!isObject(sector) || !isObject(sector.simulation)) return sector;
		var turn = finiteInteger(sector.factionTurn, 0, 0);
		sector.simulation.clock = isObject(sector.simulation.clock) ? sector.simulation.clock : {};
		sector.simulation.clock.turn = turn;
		sector.simulation.clock.lastAdvancedAtTurn = turn;
		return sector;
	};

	/*
	 * Campaign turn transaction. The legacy faction executor remains the
	 * authority for faction asset effects, combat, upkeep, and history, but the
	 * entire faction + economy + politics sequence runs against a private JSON
	 * checkpoint. The live sector is replaced only after every phase and
	 * invariant succeeds. A thrown error therefore leaves the saved campaign
	 * byte-for-byte unchanged and can be retried without double-applying a phase.
	 */
	API.advanceCampaignTurn = function(sector) {
		if (!isObject(sector)) throw new TypeError('A sector object is required to advance a campaign turn.');
		if (typeof CampaignTools === 'undefined' || typeof CampaignTools.advanceFactionTurn !== 'function') throw new Error('The legacy faction-turn executor is unavailable.');
		if (!isObject(sector.simulation)) API.migrateSector(sector, {sourceApplicationVersion:ENGINE_VERSION});
		var currentTurn = finiteInteger(sector.factionTurn, 0, 0);
		var targetTurn = currentTurn + 1;
		var staged;
		try { staged = cloneJSON(sector); }
		catch (error) { throw new Error('Campaign turn could not create a safe checkpoint: ' + error.message); }
		if (!isObject(staged)) throw new Error('Campaign turn checkpoint is invalid.');
		var phases = [], factionEvents, economyResult = null, politicsResult = null;
		try {
			factionEvents = CampaignTools.advanceFactionTurn(staged);
			if (finiteInteger(staged.factionTurn, 0, 0) !== targetTurn) throw new Error('Legacy faction executor advanced to an unexpected turn.');
			phases.push({id:'legacy-faction',status:'complete',events:asArray(factionEvents).length});
			API.syncLegacyTurn(staged);
			API.recordEvent(staged, {category:'faction',type:'legacy-turn-advanced',source:'campaign-tools',summary:'Faction turn ' + targetTurn + ' completed with ' + asArray(factionEvents).length + ' recorded events.',eventCount:asArray(factionEvents).length,legacyRecordId:'FACTION-TURN-' + String(targetTurn).padStart(4, '0')});
			API.refreshDerivedState(staged);
			phases.push({id:'derived-state',status:'complete'});
			var economyActive = typeof SectorEconomy !== 'undefined' && SectorEconomy.isInitialized && SectorEconomy.isInitialized(staged);
			if (economyActive) {
				economyResult = SectorEconomy.advanceTurn(staged, targetTurn);
				if (!economyResult || economyResult.ok !== true || economyResult.skipped) throw new Error('Economic coordinator did not commit the expected new turn.');
				phases.push({id:'economy-logistics-settlement-diplomacy-strategy-politics',status:'complete',markets:economyResult.markets,shipments:economyResult.logistics && economyResult.logistics.dispatch && economyResult.logistics.dispatch.dispatched || 0});
			} else if (typeof SectorPolitics !== 'undefined' && SectorPolitics.advanceTurn) {
				politicsResult = SectorPolitics.advanceTurn(staged, targetTurn);
				phases.push({id:'formal-politics',status:'complete'});
			}
			API.syncLegacyTurn(staged);
			staged.simulation.turnCoordinator = isObject(staged.simulation.turnCoordinator) ? staged.simulation.turnCoordinator : {};
			var coordinator = staged.simulation.turnCoordinator;
			coordinator.schemaVersion = 1;
			coordinator.lastCommittedTurn = targetTurn;
			coordinator.lastCommittedTurnId = 'CAMPAIGN-TURN-' + String(targetTurn).padStart(7, '0');
			coordinator.lastCommittedPhases = cloneJSON(phases);
			coordinator.journal = asArray(coordinator.journal);
			coordinator.journal.push({turn:targetTurn,turnId:coordinator.lastCommittedTurnId,status:'committed',phases:cloneJSON(phases),factionEventCount:asArray(factionEvents).length});
			API.recordEvent(staged, {category:'campaign',type:'campaign-turn-committed',source:'campaign-turn-coordinator',summary:'Campaign turn ' + targetTurn + ' committed across ' + phases.length + ' phases.',turnId:coordinator.lastCommittedTurnId,phases:cloneJSON(phases)});
			var retentionResult = API.compactHistory(staged);
			var checks = [];
			if (API.validateSector) checks.push(['sector',API.validateSector(staged)]);
			if (API.validateTurnCoordinator) checks.push(['turn-coordinator',API.validateTurnCoordinator(staged)]);
			if (typeof SectorEconomy !== 'undefined' && SectorEconomy.validate) checks.push(['economy',SectorEconomy.validate(staged)]);
			if (typeof SectorLogistics !== 'undefined' && SectorLogistics.validate && economyActive) checks.push(['logistics',SectorLogistics.validate(staged)]);
			if (typeof SectorSettlement !== 'undefined' && SectorSettlement.validate && staged.simulation.economy && staged.simulation.economy.settlement) checks.push(['settlement',SectorSettlement.validate(staged)]);
			if (typeof SectorDiplomacy !== 'undefined' && SectorDiplomacy.validate) checks.push(['diplomacy',SectorDiplomacy.validate(staged)]);
			if (typeof SectorPolitics !== 'undefined' && SectorPolitics.validate) checks.push(['politics',SectorPolitics.validate(staged)]);
			if (typeof SectorStrategic !== 'undefined' && SectorStrategic.validate && staged.simulation.strategy) checks.push(['strategy',SectorStrategic.validate(staged)]);
			if (typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.validate && staged.simulation.economy && staged.simulation.economy.contracts) checks.push(['contracts',SectorTradeContracts.validate(staged)]);
			if (typeof SectorTransport !== 'undefined' && SectorTransport.validate && staged.simulation.transport) checks.push(['transport',SectorTransport.validate(staged)]);
			checks.forEach(function(pair) { if (pair[1] && pair[1].ok === false) throw new Error('Pre-commit ' + pair[0] + ' validation failed: ' + asArray(pair[1].errors).join('; ')); });
			// Commit into the existing root object so App.currentSector stays valid.
			Object.keys(sector).forEach(function(key) { delete sector[key]; });
			Object.keys(staged).forEach(function(key) { sector[key] = staged[key]; });
			return {ok:true,turn:targetTurn,factionEvents:asArray(factionEvents),economy:economyResult,politics:politicsResult,phases:phases,retention:retentionResult,validation:checks.map(function(x){return {engine:x[0],ok:!x[1]||x[1].ok!==false};})};
		} catch (error) {
			var failure = new Error('Campaign turn ' + targetTurn + ' was not committed. The previous sector state has been preserved. ' + error.message);
			failure.cause = error;
			throw failure;
		}
	};

	API.validateTurnCoordinator = function(sector) {
		var coordinator = sector && sector.simulation && sector.simulation.turnCoordinator;
		var errors = [];
		if (!coordinator) return {ok:true,errors:errors,warnings:['No coordinated campaign turn has been committed yet.']};
		var turn = finiteInteger(coordinator.lastCommittedTurn,0,0);
		if (turn > finiteInteger(sector.factionTurn,0,0)) errors.push('Turn coordinator is ahead of the legacy faction clock.');
		if (turn !== finiteInteger(sector.simulation.clock && sector.simulation.clock.turn,0,0)) errors.push('Turn coordinator and simulation clocks disagree.');
		var ids = new Set(), previousTurn = null;
		asArray(coordinator.journal).forEach(function(entry) {
			var entryTurn = finiteInteger(entry && entry.turn, -1, -1);
			if (!entry || !entry.turnId || ids.has(entry.turnId)) errors.push('Turn coordinator journal contains a missing or duplicate turn ID.');
			if (entry) ids.add(entry.turnId);
			if (!entry || entry.status !== 'committed') errors.push('Turn coordinator journal contains an uncommitted visible entry.');
			if (previousTurn !== null && entryTurn <= previousTurn) errors.push('Turn coordinator journal is not in strictly increasing turn order.');
			if (entry && entry.turnId !== 'CAMPAIGN-TURN-' + String(entryTurn).padStart(7, '0')) errors.push('Turn coordinator journal contains an ID that does not match its turn.');
			previousTurn = entryTurn;
		});
		var latest = asArray(coordinator.journal).slice(-1)[0];
		if (turn > 0 && latest && finiteInteger(latest.turn, 0, 0) !== turn) errors.push('Latest turn journal entry does not match the committed turn.');
		if (turn > 0 && coordinator.lastCommittedTurnId !== 'CAMPAIGN-TURN-' + String(turn).padStart(7, '0')) errors.push('Last committed turn ID does not match the committed turn.');
		return {ok:errors.length===0,errors:errors,journalEntries:asArray(coordinator.journal).length,lastCommittedTurn:turn};
	};

	API.getProvenance = function(entity) {
		if (!isObject(entity)) return 'unknown';
		if (entity.manualOverride === true || entity.isManual === true || entity.source === 'manual') return 'manual';
		if (entity.importedFromSWN || entity.sourceEntityId || entity.sourceEntityType || entity.imported === true) return 'imported';
		if (entity.source === 'simulated' || entity.simulationGenerated === true) return 'simulated';
		if (entity.source === 'generated' || entity.generatedBy === 'sector-forge' || entity.isGeneratedWorld === true) return 'generated';
		return 'legacy';
	};

	function ensureFieldOverrides(entity) {
		var canonical = isObject(entity.fieldOverrides) ? entity.fieldOverrides : {};
		var legacy = isObject(entity.manualOverrides) ? entity.manualOverrides : {};
		Object.keys(legacy).forEach(function(field) {
			if (legacy[field] === true && !Object.prototype.hasOwnProperty.call(canonical, field)) canonical[field] = true;
		});
		delete entity.manualOverrides;
		if (isObject(entity.fieldOverrides) || Object.keys(canonical).length) entity.fieldOverrides = canonical;
		return canonical;
	}

	API.isFieldOverridden = function(entity, field) {
		if (!isObject(entity) || !field) return false;
		if (entity.manualOverride === true || entity.isManual === true || entity.source === 'manual') return true;
		return ensureFieldOverrides(entity)[field] === true;
	};

	API.setFieldOverride = function(entity, field, value) {
		if (!isObject(entity) || typeof field !== 'string' || !field) throw new TypeError('A valid entity and field are required.');
		entity[field] = value;
		var overrides = ensureFieldOverrides(entity);
		entity.fieldOverrides = overrides;
		overrides[field] = true;
		return entity;
	};

	API.clearFieldOverride = function(entity, field) {
		if (!isObject(entity) || typeof field !== 'string' || !field) return entity;
		var overrides = ensureFieldOverrides(entity);
		delete overrides[field];
		if (!Object.keys(overrides).length) delete entity.fieldOverrides;
		return entity;
	};

	/*
	 * Random streams are derived from immutable sector seed + turn + phase + scope.
	 * A stream is an ephemeral local object. Its draws cannot shift another phase,
	 * faction, or later campaign turn, and no global sequence is persisted.
	 */
	/* Stable per-campaign identity for browser recovery. A sector loaded from a shared/player snapshot without an identity receives a fresh fork ID, even when its visible contents match another campaign. Once written into the GM sector, the ID survives ordinary edits and save/load. */
	API.ensureRecoveryIdentity = function(sector) {
		if (!isObject(sector)) throw new TypeError('A sector is required for recovery identity.');
		if (!isObject(sector.simulation)) API.migrateSector(sector, {sourceApplicationVersion:ENGINE_VERSION});
		var recovery = isObject(sector.simulation.recovery) ? sector.simulation.recovery : (sector.simulation.recovery = {});
		var existing = String(recovery.campaignId || '').trim();
		if (/^[A-Za-z0-9_-]{8,96}$/.test(existing)) return existing;
		var systems = asArray(sector.systems).map(function(system) {
			return [String(system && system.id || ''), String(system && system.x != null ? system.x : ''), String(system && system.y != null ? system.y : '')];
		}).sort(function(a,b) { return a[0].localeCompare(b[0]); });
		var seed = finiteInteger(sector.simulation.random && sector.simulation.random.seed, sectorSeed(sector), 0) >>> 0;
		var signature = JSON.stringify({name:String(sector.name || 'Unnamed Sector'),seed:seed,created:String(sector.createdAt || sector.generatedAt || ''),systems:systems});
		recoveryIdentitySequence++;
		var forkNonce = String(Date.now()) + '|' + String(recoveryIdentitySequence);
		recovery.campaignId = 'SF-CAMPAIGN-' + hashString(signature + '|' + forkNonce).toString(36) + '-' + recoveryIdentitySequence.toString(36);
		recovery.schemaVersion = 1;
		return recovery.campaignId;
	};

	API.createRandomStream = function(sector, options) {
		if (!isObject(sector) || !isObject(sector.simulation) || !isObject(sector.simulation.random)) {
			throw new Error('Migrate the sector before requesting simulation randomness.');
		}
		options = options || {};
		var random = sector.simulation.random;
		var turn = finiteInteger(options.turn, finiteInteger(sector.simulation.clock && sector.simulation.clock.turn, 0, 0), 0);
		var phase = String(options.phase || 'general');
		var scope = String(options.scope || 'sector');
		var seed = hashString([String(random.seed >>> 0), String(turn), phase, scope].join('|')) >>> 0;
		if (!seed) seed = 0x6D2B79F5;
		return {algorithm:'xorshift32-keyed-v1', seed:seed, state:seed, turn:turn, phase:phase, scope:scope, draws:0};
	};

	API.nextRandom = function(stream) {
		if (!isObject(stream) || stream.algorithm !== 'xorshift32-keyed-v1' || !Number.isFinite(Number(stream.state))) {
			throw new TypeError('A keyed simulation random stream is required.');
		}
		var state = Number(stream.state) >>> 0;
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		if (!state) state = 0x6D2B79F5;
		stream.state = state;
		stream.draws = finiteInteger(stream.draws, 0, 0) + 1;
		return state / UINT32_RANGE;
	};

	API.randomInteger = function(stream, minimum, maximum) {
		minimum = Math.ceil(Number(minimum));
		maximum = Math.floor(Number(maximum));
		if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
			throw new RangeError('Invalid simulation random integer range.');
		}
		return minimum + Math.floor(API.nextRandom(stream) * (maximum - minimum + 1));
	};

	API.recordEvent = function(sector, event) {
		if (!isObject(sector) || !isObject(sector.simulation)) throw new Error('Migrate the sector before recording simulation events.');
		if (!isObject(event)) throw new TypeError('A simulation event object is required.');
		var chronicle = ensureChronicle(sector.simulation);
		var sequence = chronicle.nextSequence++;
		var record = Object.assign({
			id:'SIM-EVENT-' + String(sequence).padStart(7, '0'),
			sequence:sequence,
			turn:finiteInteger(sector.simulation.clock && sector.simulation.clock.turn, 0, 0),
			category:'general',
			type:'event',
			source:'simulation',
			visibility:'gm',
			actorIds:[],
			affectedEntityIds:[],
			locationSystemIds:[],
			causes:[],
			effects:[],
			summary:''
		}, cloneJSON(event));
		// Normalize Chronicle graph fields without discarding event-specific data.
		['actorIds','affectedEntityIds','locationSystemIds','causes','effects'].forEach(function(field) {
			if (!Array.isArray(record[field])) record[field] = [];
		});
		if (record.visibility !== 'gm' && record.visibility !== 'public') record.visibility = 'gm';
		// Identity and timeline fields are engine-owned and cannot be overridden
		// by arbitrary event payload fields.
		record.id = 'SIM-EVENT-' + String(sequence).padStart(7, '0');
		record.sequence = sequence;
		record.turn = finiteInteger(sector.simulation.clock && sector.simulation.clock.turn, 0, 0);
		chronicle.events.push(record);
		var eventLimit = retentionPolicy(sector).chronicleEvents;
		if (chronicle.events.length > eventLimit) compactArray(chronicle, 'events', 'archive', eventLimit, 'chronicle');
		return record;
	};

	API.isTradeRouteOperational = TradeRouteRules.isOperational;

	function fingerprint(value) {
		return 'fnv1a-' + hashString(JSON.stringify(value)).toString(16).padStart(8, '0');
	}

	/*
	 * Pure derived graph calculation. It reads sector records but never changes
	 * them. Hops describe connectivity only; weighted shipping cost, time,
	 * capacity, and tariffs are intentionally deferred to the logistics stage.
	 */
	API.calculateDerivedState = function(sector) {
		sector = isObject(sector) ? sector : {};
		var systems = asArray(sector.systems).filter(function(system) { return system && system.id; }).slice();
		systems.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
		var systemIds = new Set(systems.map(function(system) { return String(system.id); }));
		var adjacency = new Map();
		systems.forEach(function(system) { adjacency.set(String(system.id), []); });

		var allRoutes = asArray(sector.tradeRoutes).filter(function(route) { return route && route.fromSystemId && route.toSystemId; }).slice();
		allRoutes.sort(function(a, b) { return String(a.id || '').localeCompare(String(b.id || '')); });
		var validRoutes = [];
		var invalidRoutes = [];
		allRoutes.forEach(function(route) {
			var from = String(route.fromSystemId), to = String(route.toSystemId);
			if (!systemIds.has(from) || !systemIds.has(to) || from === to) {
				invalidRoutes.push(String(route.id || from + '->' + to));
				return;
			}
			if (!API.isTradeRouteOperational(route)) return;
			validRoutes.push(route);
			adjacency.get(from).push({systemId:to, routeId:String(route.id || ''), distance:finiteInteger(route.distance, 1, 1)});
			adjacency.get(to).push({systemId:from, routeId:String(route.id || ''), distance:finiteInteger(route.distance, 1, 1)});
		});
		adjacency.forEach(function(edges) {
			edges.sort(function(a, b) { return a.systemId.localeCompare(b.systemId) || a.routeId.localeCompare(b.routeId); });
		});

		var visited = new Set();
		var components = [];
		 systems.forEach(function(system) {
			var root = String(system.id);
			if (visited.has(root)) return;
			var queue = [root], members = [];
			visited.add(root);
			for (var cursor = 0; cursor < queue.length; cursor++) {
				var current = queue[cursor];
				members.push(current);
				(adjacency.get(current) || []).forEach(function(edge) {
					if (!visited.has(edge.systemId)) { visited.add(edge.systemId); queue.push(edge.systemId); }
				});
			}
			members.sort();
			components.push({id:'COMP-' + String(components.length + 1).padStart(4, '0'), systemIds:members});
		});

		var marketRecords = asArray(sector.markets).filter(function(market) { return market && market.id; }).slice();
		marketRecords.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
		var marketsBySystem = new Map();
		marketRecords.forEach(function(market) {
			var systemId = String(market.systemId || '');
			if (!marketsBySystem.has(systemId)) marketsBySystem.set(systemId, []);
			marketsBySystem.get(systemId).push(String(market.id));
		});
		var marketAccess = {};
		marketRecords.forEach(function(market) {
			var start = String(market.systemId || ''), distances = {}, queue = [];
			if (adjacency.has(start)) {
				distances[start] = 0;
				queue.push(start);
				for (var cursor = 0; cursor < queue.length; cursor++) {
					var current = queue[cursor];
					(adjacency.get(current) || []).forEach(function(edge) {
						if (distances[edge.systemId] === undefined) {
							distances[edge.systemId] = distances[current] + 1;
							queue.push(edge.systemId);
						}
					});
				}
			}
			var reachable = [];
			Object.keys(distances).forEach(function(systemId) {
				(asArray(marketsBySystem.get(systemId))).forEach(function(otherMarketId) {
					if (otherMarketId !== String(market.id)) reachable.push({marketId:otherMarketId, hops:distances[systemId]});
				});
			});
			reachable.sort(function(a, b) { return a.hops - b.hops || a.marketId.localeCompare(b.marketId); });
			var directRoutes = (adjacency.get(start) || []).length;
			marketAccess[String(market.id)] = {
				marketId:String(market.id),
				systemId:start,
				directOperationalTradeRoutes:directRoutes,
				reachableMarkets:reachable
			};
		});

		var graph = {
			systems:systems.map(function(system) { return {systemId:String(system.id), neighbours:(adjacency.get(String(system.id)) || []).map(function(edge) { return {systemId:edge.systemId, routeId:edge.routeId, distance:edge.distance}; })}; }),
			edges:validRoutes.map(function(route) { return {routeId:String(route.id || ''), fromSystemId:String(route.fromSystemId), toSystemId:String(route.toSystemId), distance:finiteInteger(route.distance, 1, 1)}; }),
			components:components,
			invalidRouteIds:invalidRoutes.sort()
		};
		var fingerprintInput = {
			systems:systems.map(function(system) { return {id:String(system.id), x:Number.isFinite(Number(system.x)) ? Number(system.x) : null, y:Number.isFinite(Number(system.y)) ? Number(system.y) : null}; }),
			routes:allRoutes.map(function(route) { return {id:String(route.id || ''), from:String(route.fromSystemId), to:String(route.toSystemId), distance:Number.isFinite(Number(route.distance)) ? Number(route.distance) : null, kind:String(route.kind || ''), status:String(route.status || ''), topologyStatus:String(route.topologyStatus || '')}; }),
			markets:marketRecords.map(function(market) { return {id:String(market.id), systemId:String(market.systemId || '')}; })
		};
		return {
			schemaVersion:1,
			fingerprint:fingerprint(fingerprintInput),
			topology:graph,
				marketAccess:marketAccess
		};
	};

	// Persist only the compact fingerprint; the graph remains a derived value and
	// is rebuilt on demand rather than duplicated inside every save/share payload.
	API.refreshDerivedState = function(sector) {
		if (!isObject(sector)) throw new TypeError('A sector object is required.');
		if (!isObject(sector.simulation)) API.migrateSector(sector);
		var derived = API.calculateDerivedState(sector);
		sector.simulation.derived = isObject(sector.simulation.derived) ? sector.simulation.derived : {};
		sector.simulation.derived.schemaVersion = derived.schemaVersion;
		sector.simulation.derived.lastFingerprint = derived.fingerprint;
		return derived;
	};

	API.validateSector = function(sector) {
		sector = isObject(sector) ? sector : {};
		var errors = [], warnings = [];
		var systems = asArray(sector.systems), factions = asArray(sector.factions), markets = asArray(sector.markets);
		var systemIds = new Set(), factionIds = new Set(), marketIds = new Set(), planetIds = new Set();
		var coordinates = new Set();
		systems.forEach(function(system, index) {
			if (!system || !system.id) { errors.push('System at index ' + index + ' has no stable ID.'); return; }
			if (systemIds.has(String(system.id))) errors.push('Duplicate system ID: ' + system.id);
			systemIds.add(String(system.id));
			if (Number.isFinite(Number(system.x)) && Number.isFinite(Number(system.y))) {
				var coordinate = Number(system.x) + ',' + Number(system.y);
				if (coordinates.has(coordinate)) warnings.push('Duplicate system coordinate: ' + coordinate + '. Imported or manually edited systems share a hex; review their positions.');
				coordinates.add(coordinate);
			}
			asArray(system.planets).forEach(function(planet) {
				if (!planet || !planet.id) warnings.push('A world in system ' + system.id + ' has no stable ID.');
				else if (planetIds.has(String(planet.id))) errors.push('Duplicate world ID: ' + planet.id);
				else planetIds.add(String(planet.id));
			});
		});
		factions.forEach(function(faction, index) {
			if (!faction || !faction.id) { errors.push('Faction at index ' + index + ' has no stable ID.'); return; }
			if (factionIds.has(String(faction.id))) errors.push('Duplicate faction ID: ' + faction.id);
			factionIds.add(String(faction.id));
		});
		var polityIds = new Set();
		asArray(sector.polities).forEach(function(polity, index) {
			if (!polity || !polity.id) { errors.push('Polity at index ' + index + ' has no stable ID.'); return; }
			if (polityIds.has(String(polity.id))) errors.push('Duplicate polity ID: ' + polity.id);
			polityIds.add(String(polity.id));
		});
		markets.forEach(function(market, index) {
			if (!market || !market.id) { errors.push('Market at index ' + index + ' has no stable ID.'); return; }
			if (marketIds.has(String(market.id))) errors.push('Duplicate market ID: ' + market.id);
			marketIds.add(String(market.id));
			if (market.systemId && !systemIds.has(String(market.systemId))) errors.push('Market ' + market.id + ' references missing system ' + market.systemId + '.');
			if (market.planetId && !planetIds.has(String(market.planetId))) warnings.push('Market ' + market.id + ' references missing world ' + market.planetId + '.');
		});
		var routePairs = new Set();
		asArray(sector.tradeRoutes).forEach(function(route) {
			if (!route) { errors.push('A trade route record is empty.'); return; }
			if (!systemIds.has(String(route.fromSystemId || ''))) errors.push('Route ' + (route.id || '(unnamed)') + ' has a missing origin system.');
			if (!systemIds.has(String(route.toSystemId || ''))) errors.push('Route ' + (route.id || '(unnamed)') + ' has a missing destination system.');
			var pair = [String(route.fromSystemId || ''), String(route.toSystemId || '')].sort().join('|');
			if (routePairs.has(pair)) warnings.push('Duplicate route corridor: ' + pair);
			routePairs.add(pair);
		});
		systems.forEach(function(system) {
			if (system && system.polityId && !polityIds.has(String(system.polityId))) warnings.push('System ' + system.id + ' references missing polity ' + system.polityId + '.');
		});
		asArray(sector.polities).forEach(function(polity) {
			if (polity && polity.capitalSystemId && !systemIds.has(String(polity.capitalSystemId))) warnings.push('Polity ' + polity.id + ' references missing capital system ' + polity.capitalSystemId + '.');
			asArray(polity && polity.memberSystemIds).forEach(function(systemId) {
				if (!systemIds.has(String(systemId))) warnings.push('Polity ' + polity.id + ' references missing member system ' + systemId + '.');
			});
			asArray(polity && polity.relations).forEach(function(relation) {
				if (!polityIds.has(String(relation && relation.polityId || ''))) warnings.push('Polity ' + polity.id + ' references missing polity ' + (relation && relation.polityId || '(unnamed)') + '.');
			});
		});
		var relationPairs = new Set();
		asArray(sector.diplomacy).forEach(function(relation) {
			if (!relation) { errors.push('A diplomatic relationship record is empty.'); return; }
			if (!factionIds.has(String(relation.factionAId || '')) || !factionIds.has(String(relation.factionBId || ''))) errors.push('Diplomacy ' + (relation.id || '(unnamed)') + ' references a missing faction.');
			var pair = [String(relation.factionAId || ''), String(relation.factionBId || '')].sort().join('|');
			if (relationPairs.has(pair)) warnings.push('Duplicate diplomatic relationship: ' + pair);
			relationPairs.add(pair);
		});
		if (sector.simulation && sector.simulation.clock && !Number.isFinite(Number(sector.simulation.clock.turn))) errors.push('Simulation clock turn is not numeric.');
		return {ok:errors.length === 0, errors:errors, warnings:warnings, counts:{systems:systems.length, factions:factions.length, markets:markets.length, routes:asArray(sector.tradeRoutes).length, diplomaticRelationships:asArray(sector.diplomacy).length}};
	};

	API.getHistoryRetentionPolicy = function(sector) { return retentionPolicy(sector); };
	API.setHistoryRetentionPolicy = function(sector, updates) {
		if (!isObject(sector) || !isObject(sector.simulation)) throw new Error('Migrate the sector before configuring history retention.');
		var current = retentionPolicy(sector), input = isObject(updates) ? updates : {};
		Object.keys(DEFAULT_HISTORY_RETENTION).forEach(function(key) { if (input[key] != null && Number.isFinite(Number(input[key]))) current[key] = Math.max(4, Math.min(100000, Math.floor(Number(input[key])))); });
		sector.simulation.settings = isObject(sector.simulation.settings) ? sector.simulation.settings : {};
		sector.simulation.settings.historyRetention = current;
		if (updates && updates.archiveDetailBudgetBytes != null && Number.isFinite(Number(updates.archiveDetailBudgetBytes))) sector.simulation.settings.archiveDetailBudgetBytes = Math.max(64*1024,Math.min(10*1024*1024,Math.floor(Number(updates.archiveDetailBudgetBytes))));
		if (updates && updates.liveEconomyHistoryBudgetBytes != null && Number.isFinite(Number(updates.liveEconomyHistoryBudgetBytes))) sector.simulation.settings.liveEconomyHistoryBudgetBytes = Math.max(128*1024,Math.min(16*1024*1024,Math.floor(Number(updates.liveEconomyHistoryBudgetBytes))));
		compactHistoryInternal(sector);
		return cloneJSON(current);
	};
	API.compactHistory = function(sector) { return compactHistoryInternal(sector); };
	API.getRetentionSummary = function(sector) {
		var simulation = sector && sector.simulation || {}, economy = simulation.economy || {}, chronicle = simulation.chronicle || {}, settlement = economy.settlement || {}, chronicleArchive = chronicle.archive || {}, turnArchive = sector && sector.factionTurnHistoryArchive || {};
		var liveEntries=collectLiveEconomyHistoryEntries(sector),liveBytes=liveEntries.reduce(function(total,entry){return total+jsonByteLength(entry.record);},0);
		return {policy:retentionPolicy(sector),archivePolicy:'bounded-gm-detail-v3',archiveDetail:measureDetailedArchive(sector),liveEconomyHistory:{bytes:liveBytes,budgetBytes:liveEconomyHistoryBudget(sector),retainedRecords:liveEntries.length,overBudget:liveBytes>liveEconomyHistoryBudget(sector)},chronicle:{retained:asArray(chronicle.events).length,archived:finiteInteger(chronicleArchive.archivedCount,0,0),detailedArchived:asArray(chronicleArchive.records).length,pruned:finiteInteger(chronicleArchive.detailedRecordsPruned,0,0)},factionTurnHistory:{retained:asArray(sector && sector.factionTurnHistory).length,archived:finiteInteger(turnArchive.archivedCount,0,0),detailedArchived:asArray(turnArchive.records).length,archivedNotes:Object.keys(turnArchive.notesByTurn || {}).length,pruned:finiteInteger(turnArchive.detailedRecordsPruned,0,0)},economy:{retained:asArray(economy.ledger).length,archived:finiteInteger(economy.ledgerArchive && economy.ledgerArchive.archivedCount,0,0),detailedArchived:asArray(economy.ledgerArchive && economy.ledgerArchive.records).length},settlement:{retained:asArray(settlement.ledger).length,archived:finiteInteger(settlement.archive && settlement.archive.archivedCount,0,0),detailedArchived:asArray(settlement.archive && settlement.archive.records).length},logistics:{retained:asArray(economy.logistics && economy.logistics.ledger).length,archived:finiteInteger(economy.logistics && economy.logistics.ledgerArchive && economy.logistics.ledgerArchive.archivedCount,0,0),detailedArchived:asArray(economy.logistics && economy.logistics.ledgerArchive && economy.logistics.ledgerArchive.records).length,marketLedgers:asArray(economy.marketStates).reduce(function(n,state){return n+asArray(state.logisticsLedger).length;},0)},shipments:{retained:asArray(economy.logistics && economy.logistics.shipments).length,archived:finiteInteger(economy.logistics && economy.logistics.shipmentArchive && economy.logistics.shipmentArchive.archivedCount,0,0),detailedArchived:Object.keys(economy.logistics && economy.logistics.shipmentArchive && economy.logistics.shipmentArchive.shipments || {}).filter(function(key){return !(economy.logistics.shipmentArchive.shipments[key]||{})._detailPruned;}).length,detailPruned:finiteInteger(economy.logistics && economy.logistics.shipmentArchive && economy.logistics.shipmentArchive.detailedRecordsPruned,0,0)}};
	};

	API.getSchemaInfo = function() {
		return {simulationSchemaVersion:SIMULATION_SCHEMA_VERSION, engineVersion:ENGINE_VERSION, legacySectorSchemaVersion:3};
	};

	return API;
})();
