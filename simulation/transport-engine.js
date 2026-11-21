/*
 * Sector Forge 1.3.7 — transport infrastructure.
 * Persistent ports, fleet ownership, route assignments, handling capacity,
 * voyage speed/reliability, and recurring fleet operating charges.
 * Legacy abstract routes remain usable when no fleet is assigned.
 */
var SectorTransport = (function() {
	'use strict';
	var API = {}, SCHEMA_VERSION = 1, ENGINE_VERSION = '1.3.12';
	function invalidatePathCache(sector) { if (typeof SectorLogistics !== 'undefined' && SectorLogistics.invalidatePathCache) SectorLogistics.invalidatePathCache(sector); }
	var systemIndexes = new WeakMap(), portIndexes = new WeakMap(), fleetIndexes = new WeakMap();
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
	function arr(v) { return Array.isArray(v) ? v : []; }
	function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
	function num(v, d, min) { var n = Number(v); return Number.isFinite(n) ? Math.max(min == null ? 0 : min, n) : d; }
	function int(v, d, min) { return Math.floor(num(v, d, min)); }
	function round(v) { return Math.round(num(v, 0, 0) * 100) / 100; }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function economy(sector) { return sector && sector.simulation && sector.simulation.economy || null; }
	function state(sector) {
		if (!sector || !sector.simulation) throw new Error('Migrate the sector before initializing transport infrastructure.');
		sector.simulation.transport = obj(sector.simulation.transport) ? sector.simulation.transport : {};
		var t = sector.simulation.transport;
		t.schemaVersion = SCHEMA_VERSION; t.engineVersion = ENGINE_VERSION;
		t.ports = arr(t.ports); t.fleets = arr(t.fleets); t.ledger = arr(t.ledger);
		t.nextFleetSequence = Math.max(1, int(t.nextFleetSequence, t.fleets.length + 1, 1));
		t.nextLedgerSequence = Math.max(1, int(t.nextLedgerSequence, t.ledger.length + 1, 1));
		t.clock = obj(t.clock) ? t.clock : {};
		var baseline = int(economy(sector) && economy(sector).clock && economy(sector).clock.lastAdvancedTurn, 0, 0);
		t.clock.lastProcessedTurn = Math.max(0, int(t.clock.lastProcessedTurn, baseline, 0));
		return t;
	}
	function system(sector, id) { return indexed(sector && sector.systems, systemIndexes, function(x) { return x && x.id; }).get(String(id)) || null; }
	function portFor(t, id) { return indexed(t && t.ports, portIndexes, function(p) { return p && p.systemId; }).get(String(id)) || null; }
	function fleetFor(t, id) { return indexed(t && t.fleets, fleetIndexes, function(f) { return f && f.id; }).get(String(id)) || null; }
	function controller(sector, id) { var s = system(sector, id); return s ? String(s.manualControllerFactionId || s.controllingFactionId || '') : ''; }
	function assignedFleets(t, routeId, turn) {
		var result = [];
		t.fleets.forEach(function(fleet) {
			if (fleet.status === 'retired' || fleet.active === false || Number(fleet.condition) <= 0 || Number(fleet.readyOnTurn || 0) > turn) return;
			arr(fleet.assignments).forEach(function(a) {
				if (String(a.routeId) === String(routeId) && Number(a.allocationPercent) > 0) result.push({fleet:fleet, allocationPercent:clamp(num(a.allocationPercent, 0, 0), 0, 100)});
			});
		});
		return result;
	}
	API.initialize = function(sector) {
		var t = state(sector), systems = arr(sector.systems), relevant = new Set();
		arr(sector.markets).forEach(function(m) { if (m && m.systemId) relevant.add(String(m.systemId)); });
		arr(sector.tradeRoutes).forEach(function(r) { if (r && r.fromSystemId) relevant.add(String(r.fromSystemId)); if (r && r.toSystemId) relevant.add(String(r.toSystemId)); });
		var created = 0;
		systems.forEach(function(s) {
			if (!s || !s.id || !relevant.has(String(s.id)) || portFor(t, s.id)) return;
			var marketCount = arr(sector.markets).filter(function(m) { return String(m.systemId) === String(s.id); }).length;
			var routeCount = arr(sector.tradeRoutes).filter(function(r) { return String(r.fromSystemId) === String(s.id) || String(r.toSystemId) === String(s.id); }).length;
			var level = clamp(1 + (marketCount > 2 ? 1 : 0) + (routeCount > 4 ? 1 : 0), 1, 3);
			var factionId = controller(sector, s.id);
			var legacyLaneCeiling = arr(sector.tradeRoutes).filter(function(r) { return String(r.fromSystemId) === String(s.id) || String(r.toSystemId) === String(s.id); }).reduce(function(max, r) { var distance = Math.max(1, Number(r.distance) || 1); var baseline = Number.isFinite(Number(r.capacityPerTurn)) ? Number(r.capacityPerTurn) : Math.round(32 / distance * 100) / 100; return Math.max(max, baseline); }, 0);
			var initialHandling = Math.max(96 * level, legacyLaneCeiling * 2);
			t.ports.push({id:'PORT-' + String(s.id), name:String(s.name || s.id) + ' Spaceport', systemId:String(s.id), level:level, handlingCapacityPerTurn:round(initialHandling), warehouseCapacity:round(240 * level), condition:100, status:'operational', ownerType:factionId ? 'faction' : 'independent', ownerId:factionId, maintenanceCrPerTurn:round(level * 40), source:'derived-initial', createdTurn:int(economy(sector) && economy(sector).clock && economy(sector).clock.lastAdvancedTurn, 0, 0)});
			created++;
		});
		if (created) invalidatePathCache(sector);
		return {ok:true, ports:t.ports.length, fleets:t.fleets.length, createdPorts:created};
	};
	API.getPorts = function(sector) { return arr(sector && sector.simulation && sector.simulation.transport && sector.simulation.transport.ports); };
	API.getFleets = function(sector) { return arr(sector && sector.simulation && sector.simulation.transport && sector.simulation.transport.fleets); };
	API.createFleet = function(sector, draft, turn, options) {
		var t = state(sector), d = obj(draft) ? draft : {}, opts = obj(options) ? options : {};
		var ownerType = String(d.ownerType || 'corporation'), ownerId = String(d.ownerId || '');
		if (['faction','corporation','service','independent'].indexOf(ownerType) < 0) return {ok:false, reason:'Fleet owner type is invalid.'};
		if (!ownerId) return {ok:false, reason:'A fleet owner is required.'};
		if (ownerType === 'faction' && !arr(sector.factions).some(function(x) { return String(x.id) === ownerId; })) return {ok:false, reason:'The selected fleet-owning faction does not exist.'};
		if (ownerType === 'corporation' && !arr(sector.corporations).some(function(x) { return String(x.id) === ownerId; })) return {ok:false, reason:'The selected fleet-owning corporation does not exist.'};
		var capacity = round(num(d.capacityPerTurn, 16, 0));
		if (capacity <= 0) return {ok:false, reason:'Fleet capacity must be greater than zero.'};
		var home = String(d.homeSystemId || '');
		if (home && !system(sector, home)) return {ok:false, reason:'Fleet home system does not exist.'};
		var cost = round(num(d.purchaseCostCr, 0, 0));
		var id = String(d.id || ('FLEET-' + String(t.nextFleetSequence++).padStart(4, '0')));
		if (t.fleets.some(function(f) { return String(f.id) === id; })) return {ok:false, reason:'A fleet with that ID already exists.'};
		if (cost > 0 && opts.chargePurchase !== false) {
			if (typeof SectorSettlement === 'undefined' || !SectorSettlement.transferCredits) return {ok:false, reason:'Financial settlement is unavailable.'};
			var tx = SectorSettlement.transferCredits(sector, {ownerType:ownerType, ownerId:ownerId}, {ownerType:'service', ownerId:'INTERSTELLAR-INFRASTRUCTURE'}, cost, {turn:int(turn, 0, 0), type:'fleet-purchase', externalKey:'fleet-purchase:' + id, memo:'Purchase and commissioning of fleet ' + String(d.name || id)});
			if (!tx || !tx.ok) return {ok:false, reason:tx && tx.reason || 'Fleet purchase could not be settled.'};
		}
		var fleet = {
			id:id, name:String(d.name || ('Commercial Fleet ' + id)), type:String(d.type || 'Merchant flotilla'), ownerType:ownerType, ownerId:ownerId,
			homeSystemId:home, capacityPerTurn:capacity, speed:clamp(num(d.speed, 1, 0.25), 0.25, 4),
			reliability:clamp(num(d.reliability, 90, 0), 0, 100), condition:clamp(num(d.condition, 100, 0), 0, 100),
			operatingCostCrPerTurn:round(num(d.operatingCostCrPerTurn, 250, 0)), variableCostPerCargoUnit:round(num(d.variableCostPerCargoUnit, 0.02, 0)),
			maintenanceCrPerTurn:round(num(d.maintenanceCrPerTurn, 0, 0)), status:String(d.status || 'operational'), active:d.active !== false,
			assignments:[], readyOnTurn:int(d.readyOnTurn, int(turn, 0, 0) + (opts.source === 'corporate-ai' ? 1 : 0), 0),
			createdTurn:int(turn, 0, 0), source:String(opts.source || d.source || 'manual'), notes:String(d.notes || ''), missedMaintenance:0, lastMaintenanceTurn:int(turn, 0, 0)
		};
		t.fleets.push(fleet);
		arr(d.assignments).forEach(function(a) { API.assignFleetToRoute(sector, fleet.id, a.routeId, a.allocationPercent, {allowPartial:true}); });
		if (typeof SectorSimulation !== 'undefined' && SectorSimulation.recordEvent) SectorSimulation.recordEvent(sector, {category:'transport', type:'fleet-commissioned', source:'transport-engine', actorIds:[ownerId], affectedEntityIds:[fleet.id], locationSystemIds:home ? [home] : [], summary:fleet.name + ' was commissioned with ' + capacity + ' cargo units of transport capacity.'});
		invalidatePathCache(sector); return {ok:true, fleet:fleet};
	};
	API.updateFleet = function(sector, fleetId, changes) {
		var t = state(sector), fleet = fleetFor(t, fleetId);
		if (!fleet) return {ok:false, reason:'Fleet not found.'};
		var d = obj(changes) ? changes : {};
		var ownerType = d.ownerType == null ? fleet.ownerType : String(d.ownerType);
		var ownerId = d.ownerId == null ? String(fleet.ownerId || '') : String(d.ownerId);
		var homeSystemId = d.homeSystemId == null ? String(fleet.homeSystemId || '') : String(d.homeSystemId);
		var status = d.status == null ? fleet.status : String(d.status);
		if (['faction','corporation','service','independent'].indexOf(ownerType) < 0 || !ownerId) return {ok:false, reason:'Fleet ownership is invalid.'};
		if (ownerType === 'faction' && !arr(sector.factions).some(function(x) { return String(x.id) === ownerId; })) return {ok:false, reason:'The selected fleet-owning faction does not exist.'};
		if (ownerType === 'corporation' && !arr(sector.corporations).some(function(x) { return String(x.id) === ownerId; })) return {ok:false, reason:'The selected fleet-owning corporation does not exist.'};
		if (homeSystemId && !system(sector, homeSystemId)) return {ok:false, reason:'Fleet home system does not exist.'};
		if (['operational','financially-stressed','retired'].indexOf(status) < 0) return {ok:false, reason:'Fleet operational status is invalid.'};
		if (d.capacityPerTurn != null && !(Number(d.capacityPerTurn) > 0)) return {ok:false, reason:'Fleet capacity must be greater than zero.'};
		fleet.ownerType=ownerType; fleet.ownerId=ownerId; fleet.homeSystemId=homeSystemId; fleet.status=status;
		['name','type','notes'].forEach(function(k) { if (d[k] != null) fleet[k] = String(d[k]); });
		if (d.capacityPerTurn != null) fleet.capacityPerTurn = round(num(d.capacityPerTurn, fleet.capacityPerTurn, 0));
		if (d.speed != null) fleet.speed = clamp(num(d.speed, fleet.speed, 0.25), 0.25, 4);
		if (d.reliability != null) fleet.reliability = clamp(num(d.reliability, fleet.reliability, 0), 0, 100);
		if (d.condition != null) fleet.condition = clamp(num(d.condition, fleet.condition, 0), 0, 100);
		if (d.operatingCostCrPerTurn != null) fleet.operatingCostCrPerTurn = round(num(d.operatingCostCrPerTurn, fleet.operatingCostCrPerTurn, 0));
		if (d.variableCostPerCargoUnit != null) fleet.variableCostPerCargoUnit = round(num(d.variableCostPerCargoUnit, fleet.variableCostPerCargoUnit, 0));
		if (d.readyOnTurn != null) fleet.readyOnTurn = int(d.readyOnTurn, fleet.readyOnTurn, 0);
		if (d.active != null) fleet.active = !!d.active;
		invalidatePathCache(sector); return {ok:true, fleet:fleet};
	};
	API.assignFleetToRoute = function(sector, fleetId, routeId, allocationPercent, options) {
		var t = state(sector), fleet = fleetFor(t, fleetId), route = arr(sector.tradeRoutes).find(function(r) { return String(r.id) === String(routeId); });
		if (!fleet || !route) return {ok:false, reason:'Select an existing fleet and route.'};
		var percent = clamp(num(allocationPercent, 100, 0), 0, 100);
		if (percent <= 0) return {ok:false, reason:'Allocation must be greater than zero.'};
		var existing = arr(fleet.assignments).find(function(a) { return String(a.routeId) === String(routeId); });
		var occupied = arr(fleet.assignments).filter(function(a) { return String(a.routeId) !== String(routeId); }).reduce(function(n, a) { return n + num(a.allocationPercent, 0, 0); }, 0);
		if (occupied + percent > 100.001 && !(options && options.allowPartial)) return {ok:false, reason:'A fleet cannot allocate more than 100% of its capacity across routes.'};
		if (existing) existing.allocationPercent = Math.min(percent, Math.max(0, 100 - occupied));
		else fleet.assignments.push({routeId:String(routeId), allocationPercent:Math.min(percent, Math.max(0, 100 - occupied))});
		invalidatePathCache(sector); return {ok:true, fleet:fleet, route:route};
	};
	API.removeFleetAssignment = function(sector, fleetId, routeId) {
		var t = state(sector), fleet = fleetFor(t, fleetId); if (!fleet) return {ok:false, reason:'Fleet not found.'};
		fleet.assignments = arr(fleet.assignments).filter(function(a) { return String(a.routeId) !== String(routeId); }); invalidatePathCache(sector); return {ok:true, fleet:fleet};
	};
	API.retireFleet = function(sector, fleetId) { var t = state(sector), f = fleetFor(t, fleetId); if (!f) return {ok:false, reason:'Fleet not found.'}; f.status='retired'; f.active=false; f.assignments=[]; f.retiredTurn=int(sector.factionTurn,0,0); invalidatePathCache(sector); return {ok:true,fleet:f}; };
	API.getRouteModifiers = function(sector, route, turn) {
		if (!sector || !route || !sector.simulation || !sector.simulation.transport) return null;
		var t = sector.simulation.transport, currentTurn = int(turn, sector.factionTurn || 0, 0);
		var from = portFor(t, route.fromSystemId), to = portFor(t, route.toSystemId);
		var portCaps = [from, to].filter(Boolean).map(function(p) { return p.status === 'closed' || Number(p.condition) <= 0 ? 0 : num(p.handlingCapacityPerTurn, 96, 0) * clamp(num(p.condition, 100, 0) / 100, 0, 1); });
		var portCapacity = portCaps.length ? Math.min.apply(Math, portCaps) : Infinity;
		var assigned = assignedFleets(t, route.id, currentTurn);
		var fleetCapacity = assigned.reduce(function(n, item) { return n + Number(item.fleet.capacityPerTurn || 0) * item.allocationPercent / 100 * clamp(Number(item.fleet.condition || 0) / 100, 0, 1); }, 0);
		var speedWeight = assigned.reduce(function(n, item) { return n + Number(item.fleet.speed || 1) * item.fleet.capacityPerTurn * item.allocationPercent / 100; }, 0);
		var capacityWeight = assigned.reduce(function(n, item) { return n + item.fleet.capacityPerTurn * item.allocationPercent / 100; }, 0);
		var reliabilityWeight = assigned.reduce(function(n, item) { return n + Number(item.fleet.reliability || 0) * item.fleet.capacityPerTurn * item.allocationPercent / 100; }, 0);
		var variableCost = assigned.reduce(function(n, item) { return n + Number(item.fleet.variableCostPerCargoUnit || 0) * item.fleet.capacityPerTurn * item.allocationPercent / 100; }, 0);
		var speed = assigned.length && capacityWeight > 0 ? speedWeight / capacityWeight : 1;
		var reliability = assigned.length && capacityWeight > 0 ? reliabilityWeight / capacityWeight : 90;
		var fleetCap = assigned.length ? fleetCapacity : Infinity;
		var baseCapacity = Math.max(0, num(route.capacityPerTurn, Math.round(32 / Math.max(1, Number(route.distance) || 1) * 100) / 100, 0));
		// Existing abstract route capacity remains available; commissioned fleets add
		// specialized throughput but cannot exceed the physical port handling ceiling.
		var capacity = Math.min(baseCapacity + (Number.isFinite(fleetCap) ? fleetCap : 0), portCapacity);
		if (!assigned.length) capacity = Math.min(baseCapacity, portCapacity);
		var fleetRiskDelta = assigned.length ? (90 - reliability) * 0.18 : 0;
		var transitBase = Math.max(1, int(route.transitTurns, Math.ceil(Math.max(1, Number(route.distance) || 1) / 2), 1));
		return {capacityPerTurn:round(Math.max(0, capacity)), transitTurns:Math.max(1, Math.ceil(transitBase / Math.max(0.25, speed))), riskModifier:round(fleetRiskDelta), variableCostPerCargoUnit:round(assigned.length ? variableCost / Math.max(1, capacityWeight) : 0), portCapacityPerTurn:Number.isFinite(portCapacity) ? round(portCapacity) : null, fleetCapacityPerTurn:round(fleetCapacity), assignedFleetCount:assigned.length, averageSpeed:round(speed), averageReliability:round(reliability), portIds:[from && from.id,to && to.id].filter(Boolean)};
	};
	API.advanceTurn = function(sector, turn) {
		var t = state(sector), current = int(turn, 0, 0);
		API.initialize(sector);
		if (current <= t.clock.lastProcessedTurn) return {ok:true, skipped:true, turn:current, charged:0, defaults:0};
		if (current !== t.clock.lastProcessedTurn + 1) throw new Error('Transport turns must advance one at a time. Expected ' + (t.clock.lastProcessedTurn + 1) + ', received ' + current + '.');
		var charged = 0, defaults = 0;
		function charge(ownerType, ownerId, amount, key, memo) {
			if (amount <= 0) return null;
			if (typeof SectorSettlement === 'undefined' || !SectorSettlement.transferCredits) return null;
			return SectorSettlement.transferCredits(sector, {ownerType:ownerType,ownerId:ownerId}, {ownerType:'service',ownerId:'INTERSTELLAR-INFRASTRUCTURE'}, amount, {turn:current,type:'transport-maintenance',externalKey:key,memo:memo});
		}
		t.fleets.forEach(function(fleet) {
			if (fleet.status === 'retired' || fleet.active === false || Number(fleet.readyOnTurn || 0) > current) return;
			var amount = round(num(fleet.operatingCostCrPerTurn,0,0) + num(fleet.maintenanceCrPerTurn,0,0));
			if (!amount || fleet.lastMaintenanceTurn === current) return;
			var tx = charge(fleet.ownerType, fleet.ownerId, amount, 'fleet-maintenance:' + current + ':' + fleet.id, 'Fleet operation and maintenance: ' + fleet.name);
			if (tx && tx.ok) {
				charged++; fleet.lastMaintenanceTurn=current; fleet.lastMaintenanceTransactionId=tx.transaction && tx.transaction.id || tx.id || '';
				if (tx.transaction && tx.transaction.creditLimitExceeded) { fleet.missedMaintenance=int(fleet.missedMaintenance,0,0)+1; fleet.condition=clamp(Number(fleet.condition||100)-2,0,100); if (fleet.missedMaintenance>=3) fleet.status='financially-stressed'; defaults++; }
				else { fleet.missedMaintenance=0; if (fleet.status==='financially-stressed') fleet.status='operational'; }
				t.ledger.push({id:'TRANSPORT-' + String(t.nextLedgerSequence++).padStart(7,'0'),turn:current,type:'fleet-maintenance',fleetId:fleet.id,amount:amount,transactionId:fleet.lastMaintenanceTransactionId,summary:fleet.name + ' incurred ' + amount + ' Cr in operating and maintenance costs.'});
			}
		});
		arr(t.ports).forEach(function(port) {
			var amount=round(num(port.maintenanceCrPerTurn,0,0)); if(!amount||port.status==='closed'||port.lastMaintenanceTurn===current)return;
			var tx=charge(port.ownerType||'service',port.ownerId||(port.ownerType==='service'?'INTERSTELLAR-INFRASTRUCTURE':'INDEPENDENT-PORTS'),amount,'port-maintenance:'+current+':'+port.id,'Port maintenance: '+port.name);
			if(tx&&tx.ok){port.lastMaintenanceTurn=current;charged++;if(tx.transaction&&tx.transaction.creditLimitExceeded){port.condition=clamp(Number(port.condition||100)-1,0,100);defaults++;}}
		});
		t.clock.lastProcessedTurn=current;
		if(typeof SectorSimulation!=='undefined'&&SectorSimulation.recordEvent&&charged)SectorSimulation.recordEvent(sector,{category:'transport',type:'transport-operating-costs',source:'transport-engine',summary:charged+' fleet or port operating charges settled for '+current+'.',turn:current,charged:charged,defaults:defaults});
		if (charged || defaults) invalidatePathCache(sector);
		return {ok:true,skipped:false,turn:current,charged:charged,defaults:defaults,fleets:t.fleets.length,ports:t.ports.length};
	};
	API.getSummary = function(sector) { var t=sector&&sector.simulation&&sector.simulation.transport,ports=arr(t&&t.ports),fleets=arr(t&&t.fleets);return {ports:ports.length,operationalPorts:ports.filter(function(p){return p.status!=='closed'&&Number(p.condition)>0;}).length,fleets:fleets.length,activeFleets:fleets.filter(function(f){return f.status!=='retired'&&f.active!==false&&Number(f.condition)>0;}).length,assignedFleets:fleets.filter(function(f){return arr(f.assignments).length>0;}).length,turn:int(t&&t.clock&&t.clock.lastProcessedTurn,0,0)}; };
	API.validate = function(sector) {
		var errors=[],warnings=[],t=sector&&sector.simulation&&sector.simulation.transport;if(!t)return {ok:true,errors:errors,warnings:['Transport infrastructure has not been initialized.']};
		var ids=new Set(),routeIds=new Set(arr(sector.tradeRoutes).map(function(r){return String(r.id);}));
		arr(t.ports).forEach(function(p){if(!p.id||ids.has(p.id))errors.push('Missing or duplicate port ID '+p.id+'.');ids.add(p.id);if(!system(sector,p.systemId))warnings.push('Port '+p.id+' references a missing system.');if(['faction','corporation','service','independent'].indexOf(String(p.ownerType||'independent'))<0)errors.push('Port '+p.id+' has an invalid owner type.');if(p.ownerType==='faction'&&!arr(sector.factions).some(function(x){return String(x.id)===String(p.ownerId);}))warnings.push('Port '+p.id+' references a missing faction owner.');if(p.ownerType==='corporation'&&!arr(sector.corporations).some(function(x){return String(x.id)===String(p.ownerId);}))warnings.push('Port '+p.id+' references a missing corporation owner.');if(!(Number(p.level)>=1&&Number(p.level)<=5))errors.push('Port '+p.id+' has an invalid level.');if(!Number.isFinite(Number(p.handlingCapacityPerTurn))||Number(p.handlingCapacityPerTurn)<0)errors.push('Port '+p.id+' has invalid handling capacity.');if(!Number.isFinite(Number(p.condition))||Number(p.condition)<0||Number(p.condition)>100)errors.push('Port '+p.id+' has invalid condition.');});
		var fleetIds=new Set();arr(t.fleets).forEach(function(f){if(!f.id||fleetIds.has(f.id))errors.push('Missing or duplicate fleet ID '+f.id+'.');fleetIds.add(f.id);if(['faction','corporation','service','independent'].indexOf(String(f.ownerType))<0||!f.ownerId)errors.push('Fleet '+f.id+' has invalid ownership.');if(f.ownerType==='faction'&&!arr(sector.factions).some(function(x){return String(x.id)===String(f.ownerId);}))warnings.push('Fleet '+f.id+' references a missing faction owner.');if(f.ownerType==='corporation'&&!arr(sector.corporations).some(function(x){return String(x.id)===String(f.ownerId);}))warnings.push('Fleet '+f.id+' references a missing corporation owner.');if(['operational','financially-stressed','retired'].indexOf(String(f.status))<0)errors.push('Fleet '+f.id+' has an invalid status.');if(!(Number(f.capacityPerTurn)>0))errors.push('Fleet '+f.id+' has invalid cargo capacity.');if(!(Number(f.speed)>=0.25&&Number(f.speed)<=4))errors.push('Fleet '+f.id+' has invalid speed.');if(!(Number(f.reliability)>=0&&Number(f.reliability)<=100))errors.push('Fleet '+f.id+' has invalid reliability.');var total=0;arr(f.assignments).forEach(function(a){if(!routeIds.has(String(a.routeId)))warnings.push('Fleet '+f.id+' is assigned to missing route '+a.routeId+'.');if(!(Number(a.allocationPercent)>0&&Number(a.allocationPercent)<=100))errors.push('Fleet '+f.id+' has an invalid route allocation.');total+=Number(a.allocationPercent||0);});if(total>100.001)errors.push('Fleet '+f.id+' allocates more than 100% of its capacity.');});
		return {ok:errors.length===0,errors:errors,warnings:warnings,counts:{ports:arr(t.ports).length,fleets:arr(t.fleets).length,ledger:arr(t.ledger).length}};
	};
	API.constants={schemaVersion:SCHEMA_VERSION,engineVersion:ENGINE_VERSION};return API;
})();
