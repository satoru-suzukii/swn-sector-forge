/* Prepare full GM/player exports and share-link compression away from the UI thread.
 * The page retains a synchronous, equivalent privacy/export fallback for browsers
 * that cannot construct a same-origin worker (for example file:// previews). */
importScripts('lzstring.min.js');

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function collectNested(records, entities) {
	(entities || []).forEach(function(entity) {
		if (!entity || typeof entity !== 'object') return;
		records.push(entity);
		collectNested(records, entity.importedEntities);
	});
}

function getHiddenEntityIds(sector) {
	var records = sector && sector.swnImport && Array.isArray(sector.swnImport.records) ? sector.swnImport.records.slice() : [];
	(sector && sector.systems || []).forEach(function(system) {
		collectNested(records, system.importedEntities);
		(system.planets || []).forEach(function(planet) { collectNested(records, planet.importedEntities); });
	});
	var hidden = new Set(records.filter(function(record) {
		return record && (record.isHidden || record.sourceIsHidden || (record.raw && record.raw.isHidden));
	}).map(function(record) { return String(record.id || record.sourceId || ''); }).filter(Boolean));
	var changed = true;
	while (changed) {
		changed = false;
		records.forEach(function(record) {
			var id = String(record && (record.id || record.sourceId) || '');
			var parentId = String(record && (record.parentId || record.parent || (record.raw && record.raw.parent)) || '');
			if (id && parentId && hidden.has(parentId) && !hidden.has(id)) { hidden.add(id); changed = true; }
		});
	}
	return hidden;
}

function omitFields(object, attributes) {
	var result = {};
	for (var key in object) if (Object.prototype.hasOwnProperty.call(object, key) && attributes.indexOf(key) < 0) result[key] = object[key];
	return result;
}

function omitFieldsFromList(items, attributes) {
	return (items || []).map(function(item) { return omitFields(item, attributes); });
}

function censorImportedEntities(entities, hiddenIds) {
	return (entities || []).filter(function(entity) {
		if (!entity || typeof entity !== 'object') return false;
		var id = String(entity.id || entity.sourceId || '');
		var parentId = String(entity.parentId || entity.parent || (entity.raw && entity.raw.parent) || '');
		var explicitlyHidden = !!(entity.isHidden || entity.sourceIsHidden || (entity.raw && entity.raw.isHidden));
		return !explicitlyHidden && !hiddenIds.has(id) && !hiddenIds.has(parentId);
	}).map(function(entity) {
		var safeEntity = cloneJson(entity);
		if (Array.isArray(safeEntity.importedEntities)) safeEntity.importedEntities = censorImportedEntities(safeEntity.importedEntities, hiddenIds);
		return safeEntity;
	});
}

function describePlayerPlanet(planet) {
	var population = String(planet.population || 'unknown population').toLowerCase();
	var tech = String(planet.techLevel || '?');
	var atmosphere = planet.atmosphere ? String(planet.atmosphere).toLowerCase() : 'unrecorded atmosphere';
	var temperature = planet.temperature ? String(planet.temperature).toLowerCase() : 'unrecorded climate';
	var biosphere = planet.biosphere ? String(planet.biosphere).toLowerCase() : 'unknown biosphere';
	var opening = (planet.name || 'This world') + ' is a ' + population + ' world at tech level ' + tech;
	var description = opening + '. Its ' + atmosphere + ' atmosphere, ' + temperature + ' climate, and ' + biosphere + ' shape daily life.';
	if (planet.populationEstimate) description += ' The local population is estimated at ' + String(planet.populationEstimate).replace(/\.$/, '') + '.';
	return description;
}

function censorSector(sector) {
	var safe = {};
	var hiddenIds = getHiddenEntityIds(sector);
	safe.name = sector.name;
	safe.gmMode = false;
	safe.grid = sector.grid || {columns:10, rows:12};
	safe.schemaVersion = sector.schemaVersion || 3;
	safe.worldGenerationMode = sector.worldGenerationMode || 'core';
	safe.tradeRoutes = cloneJson(sector.tradeRoutes || []);
	safe.polities = (sector.polities || []).map(function(item) { return omitFields(item, ['relations', 'policy']); });
	safe.markets = (sector.markets || []).map(function(item) { return omitFields(item, ['friction', 'traits']); });
	safe.systems = omitFieldsFromList((sector.systems || []).filter(function(system) {
		return !system.sourceIsHidden && !hiddenIds.has(String(system.sourceId || ''));
	}), ['pointsOfInterest','factionInfluence','controllingFactionId','controllingFactionName','controllingFactionColor','manualControllerFactionId','isContested']);
	safe.regions = cloneJson((sector.regions || []).filter(function(region) { return !region.sourceHidden && !region.sourceLayerHidden; }));
	for (var i = 0; i < safe.systems.length; i++) {
		var system = safe.systems[i];
		system.importedEntities = censorImportedEntities(system.importedEntities, hiddenIds);
		system.planets = omitFieldsFromList((system.planets || []).filter(function(planet) {
			return !planet.sourceIsHidden && !hiddenIds.has(String(planet.sourceId || ''));
		}), ['privateNotes','tag1','tag2','tagCandidate3','terrain']);
		system.planets.forEach(function(planet) {
			planet.importedEntities = censorImportedEntities(planet.importedEntities, hiddenIds);
			planet.description = describePlayerPlanet(planet);
		});
		var visibleBodies = (system.bodies || []).filter(function(body) {
			if (!body || !body.importedFromSWN) return false;
			if (body.sourceIsHidden || hiddenIds.has(String(body.sourceEntityId || ''))) return false;
			return !body.sourceParent || !hiddenIds.has(String(body.sourceParent));
		});
		system.bodies = omitFieldsFromList(visibleBodies, ['sourceAttributes','sourceEntityId','sourceEntityType','importedFromSWN','sourceParent','sourceParentEntity','sourceIsHidden','generatedFields']);
		system.summary = system.planets.length ? system.planets[0].description : 'An uninhabited system with unexplored orbital bodies and uncertain prospects.';
	}
	safe.corporations = omitFieldsFromList(sector.corporations, ['markets','strategy','valuation']);
	safe.aliens = omitFieldsFromList(sector.aliens, ['lenses','government','body']);
	safe.religions = omitFieldsFromList(sector.religions, ['doctrine']);
	safe.politicalGroups = omitFieldsFromList(sector.politicalGroups, ['leadership']);
	return safe;
}

self.onmessage = function(event) {
	var payload = event.data || {};
	try {
		var gmPretty = JSON.stringify(payload.sector, null, ' ');
		var gmCompact = JSON.stringify(payload.sector);
		var playerSector = censorSector(payload.sector);
		var playerPretty = JSON.stringify(playerSector, null, ' ');
		var playerCompact = JSON.stringify(playerSector);
		self.postMessage({
			seq:payload.seq,
			gmBlob:new Blob([gmPretty], {type:'application/json'}),
			playerBlob:new Blob([playerPretty], {type:'application/json'}),
			gmCompressed:LZString.compressToEncodedURIComponent(gmCompact),
			playerCompressed:LZString.compressToEncodedURIComponent(playerCompact)
		});
	} catch (error) {
		self.postMessage({seq:payload.seq, error:String(error && error.message || error)});
	}
};
