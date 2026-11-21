let App = {};
App.VERSION = '1.4.1';

App.legendaryNames = null;
TextLoad.load('generators/data/legends.txt', function(data) { App.legendaryNames = data; });

App.greekLetters = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'];

App.start = function() {
	document.getElementById('export-url-gm').addEventListener('click', function(event) { this.select(); });
	document.getElementById('export-url-player').addEventListener('click', function(event) { this.select(); });
	
	let modal = DynModal.show();
	let loadingElement = document.createElement('p');
	loadingElement.innerHTML = 'Loading, please wait...';
	modal.container.appendChild(loadingElement);
	
	let generatorContainerElement = document.getElementById('generator-container');
	
	TextLoad.onAllLoad(function() {
		DynModal.hide(modal);
		
		generatorContainerElement.classList.remove('hide-section');
		
		App.initialize();
	});
}

App.initialize = function() {
	let viewerContainerElement = document.getElementById('viewer-container');
	let generatorContainerElement = document.getElementById('generator-container');
	
	let tabElement = document.getElementById('viewer-tabs');
	let tabs = new DynTab(tabElement);
	tabs.setVisibleTab(1); // set the visible tab to the galaxy generator

	// Remember the referee's chosen world-generation profile on this device.
	// Storage is optional: private browsing/file contexts may deny access.
	var worldModeSelect = document.getElementById('world-generation-mode');
	if (worldModeSelect) {
		var worldModePreferenceKey = 'sectorForge.worldGenerationMode';
		try {
			var savedWorldMode = window.localStorage.getItem(worldModePreferenceKey);
			if (savedWorldMode === 'core' || savedWorldMode === 'expanded') worldModeSelect.value = savedWorldMode;
		} catch (storageError) {}
		worldModeSelect.addEventListener('change', function() {
			if (worldModeSelect.value !== 'core' && worldModeSelect.value !== 'expanded') return;
			try { window.localStorage.setItem(worldModePreferenceKey, worldModeSelect.value); } catch (storageError) {}
		});
	}

	App.bindCampaignControls();
	App.bindLocalRecoveryControls();
	
	// ---------------------------------------------------------------------- //
	// set up 'load json file' button
	
	let fileInputElement = document.getElementById('file-input');
	fileInputElement.addEventListener('change', function(event) {
		var file = fileInputElement.files && fileInputElement.files[0];
		if (!file) return;
		var previousSector = App.currentSector || null;
		var reader = new FileReader();
		reader.onload = function(e) {
			try {
				var text = String(e.target.result || '');
				var modeElement = document.getElementById('swn-import-mode');
				var importMode = modeElement && modeElement.value === 'enrich' ? 'enrich' : 'preserve';
				var sector;
				if (/\.csv$/i.test(file.name) || (/^\s*Name,Entity Type,Location,/i.test(text))) {
					sector = SwnImport.fromCSV(text, file.name, importMode);
				} else {
					var data = JSON.parse(text);
					sector = SwnImport.isNativeExport(data) ? SwnImport.fromJSON(data, file.name, importMode) : data;
				}
				if (!sector || !Array.isArray(sector.systems)) throw new Error('The file did not contain a recognizable Sector Forge sector or Sectors Without Number export.');
				generatorContainerElement.classList.add('hide-section');
				App.displaySector(sector);
				tabs.setVisibleTab(1);
				viewerContainerElement.classList.remove('hide-section');
				if (sector.importMetadata && sector.importMetadata.warnings && sector.importMetadata.warnings.length) {
					window.alert('Import complete with notes:\n\n' + sector.importMetadata.warnings.slice(0, 8).join('\n') + (sector.importMetadata.warnings.length > 8 ? '\n…and ' + (sector.importMetadata.warnings.length - 8) + ' more.' : ''));
				} else if (sector.swnImport) {
					window.alert('Import complete: ' + sector.name + '\n' + sector.systems.length + ' systems mapped to the sector grid. ' + sector.swnImport.records.length + ' source records preserved.');
				}
			} catch (error) {
				App.currentSector = previousSector;
				viewerContainerElement.classList.add('hide-section');
				generatorContainerElement.classList.remove('hide-section');
				try { tabs.setVisibleTab(1); } catch (tabError) {}
				window.alert('Error loading sector file: ' + (error.message || error) + '\n\nThe previous campaign was not replaced. The generator screen has been restored.');
				console.warn(error.stack || error);
			}
			fileInputElement.value = '';
		};
		reader.onerror = function() {
			App.currentSector = previousSector;
			viewerContainerElement.classList.add('hide-section');
			generatorContainerElement.classList.remove('hide-section');
			try { tabs.setVisibleTab(1); } catch (tabError) {}
			window.alert('Error reading sector file: ' + ((reader.error && reader.error.message) || 'The browser could not read the selected file.') + '\n\nThe generator screen has been restored.');
			fileInputElement.value = '';
		};
		reader.onabort = function() {
			App.currentSector = previousSector;
			viewerContainerElement.classList.add('hide-section');
			generatorContainerElement.classList.remove('hide-section');
			try { tabs.setVisibleTab(1); } catch (tabError) {}
			fileInputElement.value = '';
		};
		reader.readAsText(file);
	});
	
	// ---------------------------------------------------------------------- //
	// set up 'generate sector' button
	
	let generateButtonElement = document.getElementById('generate-button');
	generateButtonElement.addEventListener('click', function(event) {
		generatorContainerElement.classList.add('hide-section');
		
		let sector = App.generateSector();
		App.displaySector(sector);
		tabs.setVisibleTab(1); // set the visible tab to the galaxy generator
		
		viewerContainerElement.classList.remove('hide-section');
		
	});
	
	// ---------------------------------------------------------------------- //
	// set up 'back to generator' button
	
	let backLinkElement = document.getElementById('back-button');
	backLinkElement.addEventListener('click', function(event) {
		viewerContainerElement.classList.add('hide-section');
		
		URLParam.clear();
		
		generatorContainerElement.classList.remove('hide-section');	
	});

	let homeBrandElement = document.getElementById('home-brand');
	if (homeBrandElement) {
		homeBrandElement.addEventListener('click', function(event) {
			event.preventDefault();
			backLinkElement.click();
		});
	}
	
	// ------------------------------------------------------------------------ //
	// check url parameters

	decodeURL();
	
	URLParam.onChange = function() {
		decodeURL();
	}
	
	function decodeURL() {
		let params = URLParam.decode();
		
		if (params.hasOwnProperty('data')) {
			generatorContainerElement.classList.add('hide-section');
			
			try {
				let sector = App.decompressSector(params.data);
				App.displaySector(sector);
				
				tabs.setVisibleTab(1); // set the visible tab to the galaxy generator
				
				viewerContainerElement.classList.remove('hide-section');
			} catch (error) {
				window.alert('Error loading sector via URL: ' + error.message);
				console.trace();
				
				viewerContainerElement.classList.add('hide-section');
				generatorContainerElement.classList.remove('hide-section');
			}		
		}	
	}
}

// ************************************************************************** //

App.compressSector = function(sector) {
	urlString = LZString.compressToEncodedURIComponent(JSON.stringify(sector));
	
	return urlString;
}

App.decompressSector = function(data) {
	let sector = JSON.parse(LZString.decompressFromEncodedURIComponent(data));
	
	return sector;
}

App.setURL = function(sector) {
	URLParam.encode({data:App.compressSector(sector)});
}

// ************************************************************************** //

App.generateSector = function() {
	let sector = {};
	
	let sectorName = App.generateSectorName();
	
	sector.name = sectorName;
	sector.gmMode = true;
	sector.grid = {columns:SectorGrid.DEFAULT_COLUMNS, rows:SectorGrid.DEFAULT_ROWS};
	
	let generationModeElement = document.getElementById('world-generation-mode');
	let worldGenerationMode = generationModeElement && generationModeElement.value === 'expanded' ? 'expanded' : 'core';
	let systemDensityElement = document.getElementById('system-density');
	let worldDensityElement = document.getElementById('world-density');
	let systemDensity = systemDensityElement && ['default','empty','scarce','normal','crowded'].includes(systemDensityElement.value) ? systemDensityElement.value : 'default';
	let worldDensity = worldDensityElement && ['default','empty','scarce','normal','crowded'].includes(worldDensityElement.value) ? worldDensityElement.value : 'default';
	sector.worldGenerationMode = worldGenerationMode;
	sector.generationSettings = {systemDensity:systemDensity, worldDensity:worldDensity};
	sector.systems = WorldGenerator.generate({worldGenerationMode:worldGenerationMode, systemDensity:systemDensity, worldDensity:worldDensity, columns:sector.grid.columns, rows:sector.grid.rows});
	sector.corporations = CorporationGenerator.generate();
	sector.religions = ReligionGenerator.generate();
	sector.politicalGroups = PoliticalGroupGenerator.generate();
	sector.aliens = AlienGenerator.generate();
	sector.regions = [];
	CampaignTools.enrichSector(sector, false);
	if (typeof SectorSimulation !== 'undefined' && SectorSimulation.migrateSector) {
		SectorSimulation.migrateSector(sector, {sourceApplicationVersion:App.VERSION});
		if (typeof SectorPolitics !== 'undefined') SectorPolitics.initialize(sector);
		SectorSimulation.refreshDerivedState(sector);
	}
	// Newly generated sectors receive an explicit starting inventory baseline.
	// Legacy/imported sectors are never silently assigned stock quantities;
	// their GM initializes the local economy from the Markets workspace.
	if (typeof SectorEconomy !== 'undefined' && SectorEconomy.initializeSector) {
		SectorEconomy.initializeSector(sector);
	}
	
	return sector;
}

App.generateSectorName = function() {
	let name = GenUtil.pickRandom(App.legendaryNames) + " " + GenUtil.pickRandom(App.greekLetters);
	name = GenUtil.capitalize(name);
	return name;
}

App.getHiddenSwnEntityIds = function(sector) {
	let records = sector && sector.swnImport && Array.isArray(sector.swnImport.records) ? sector.swnImport.records.slice() : [];
	// Some imported child records are also stored on their parent system/planet.
	// Include those copies as a fallback for older saves without a complete source
	// record table, so hidden ancestry is still understood during player export.
	function collectNested(entities) {
		(entities || []).forEach(function(entity) {
			if (!entity || typeof entity !== 'object') return;
			records.push(entity);
			collectNested(entity.importedEntities);
		});
	}
	(sector && sector.systems || []).forEach(function(system) {
		collectNested(system.importedEntities);
		(system.planets || []).forEach(function(planet) { collectNested(planet.importedEntities); });
	});
	let hidden = new Set(records.filter(function(record) {
		return record && (record.isHidden || record.sourceIsHidden || (record.raw && record.raw.isHidden));
	}).map(function(record) { return String(record.id || record.sourceId || ''); }).filter(Boolean));
	let changed = true;
	while (changed) {
		changed = false;
		records.forEach(function(record) {
			let id = String(record && (record.id || record.sourceId) || '');
			let parentId = String(record && (record.parentId || record.parent || (record.raw && record.raw.parent)) || '');
			if (id && parentId && hidden.has(parentId) && !hidden.has(id)) { hidden.add(id); changed = true; }
		});
	}
	return hidden;
}

App.censorImportedEntities = function(entities, hiddenSwnEntityIds) {
	return (entities || []).filter(function(entity) {
		if (!entity || typeof entity !== 'object') return false;
		let id = String(entity.id || entity.sourceId || '');
		let parentId = String(entity.parentId || entity.parent || (entity.raw && entity.raw.parent) || '');
		let explicitlyHidden = !!(entity.isHidden || entity.sourceIsHidden || (entity.raw && entity.raw.isHidden));
		return !explicitlyHidden && !hiddenSwnEntityIds.has(id) && !hiddenSwnEntityIds.has(parentId);
	}).map(function(entity) {
		let safeEntity = JSON.parse(JSON.stringify(entity));
		if (Array.isArray(safeEntity.importedEntities)) {
			safeEntity.importedEntities = App.censorImportedEntities(safeEntity.importedEntities, hiddenSwnEntityIds);
		}
		return safeEntity;
	});
}

// Player-safe route copies omit referee-only records and recursively strip
// private/GM metadata without mutating the live referee campaign.
App.censorPlayerRouteValue = function(value) {
	if (Array.isArray(value)) {
		return value.map(function(item) { return App.censorPlayerRouteValue(item); }).filter(function(item) { return item !== undefined; });
	}
	if (!value || typeof value !== 'object') return value;
	var visibility = String(value.visibility || '').trim().toLowerCase();
	if (value.gmOnly === true || value.gmPrivate === true || value.refereeOnly === true || value.isHidden === true || value.isSecret === true || value.secret === true || value.private === true || ['gm','referee','private','secret'].indexOf(visibility) >= 0) return undefined;
	var safe = {};
	Object.keys(value).forEach(function(key) {
		var normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
		if (/^(gm|gamemaster|referee|private|secret)/.test(normalized) || /^is(gm|gamemaster|referee|private|secret|hidden)/.test(normalized) || normalized === 'visibility') return;
		var child = App.censorPlayerRouteValue(value[key]);
		if (child !== undefined) safe[key] = child;
	});
	return safe;
};

App.censorTradeRoutes = function(routes) {
	return (Array.isArray(routes) ? routes : []).map(function(route) {
		return App.censorPlayerRouteValue(route);
	}).filter(function(route) { return route !== undefined; });
};

App.censorSector = function(sector) {
	sector = sector && typeof sector === 'object' ? sector : {};
	let newSector = {};
	let hiddenSwnEntityIds = App.getHiddenSwnEntityIds(sector);
	
	newSector.name = sector.name;
	newSector.gmMode = false;
	newSector.grid = sector.grid || {columns:SectorGrid.DEFAULT_COLUMNS, rows:SectorGrid.DEFAULT_ROWS};
	newSector.schemaVersion = sector.schemaVersion || 3;
	newSector.worldGenerationMode = sector.worldGenerationMode || 'core';
	newSector.tradeRoutes = App.censorTradeRoutes(sector.tradeRoutes);
	newSector.polities = (sector.polities || []).map(function(polity) { return App.censorObject(polity, ['relations', 'policy']); });
	newSector.markets = (sector.markets || []).map(function(market) { return App.censorObject(market, ['friction', 'traits', 'controlFactionId', 'controlFactionName']); });
	
	// SWN marks referee-only entities with isHidden. Keep them in the GM sector,
	// but exclude them from player-safe exports after mapping into Forge objects.
	newSector.systems = App.censorObjects((sector.systems || []).filter(function(system) { return !system.sourceIsHidden && !hiddenSwnEntityIds.has(String(system.sourceId || '')); }), ['pointsOfInterest', 'factionInfluence', 'controllingFactionId', 'controllingFactionName', 'controllingFactionColor', 'manualControllerFactionId', 'isContested']);
	// Imported SWN layers/regions can be referee-only. Do not leak those overlays
	// into player-safe archives; the complete source payload stays in the GM archive.
	newSector.regions = JSON.parse(JSON.stringify((sector.regions || []).filter(function(region) { return !region.sourceHidden && !region.sourceLayerHidden; })));
	for (let i = 0; i < newSector.systems.length; i++) {
		let system = newSector.systems[i];
		system.importedEntities = App.censorImportedEntities(system.importedEntities, hiddenSwnEntityIds);
		system.planets = App.censorObjects((system.planets || []).filter(function(planet) { return !planet.sourceIsHidden && !hiddenSwnEntityIds.has(String(planet.sourceId || '')); }), ['privateNotes', 'tag1', 'tag2', 'tagCandidate3', 'terrain']);
		system.planets.forEach(function(planet) {
			// Parent-level source entities can contain referee-only details too.
			planet.importedEntities = App.censorImportedEntities(planet.importedEntities, hiddenSwnEntityIds);
			// Descriptions contain GM-facing tag names; rebuild a player-safe summary.
			planet.description = WorldGenerator.describePlanet(planet, {hideTags:true});
		});
		// Keep public imported survey entities in player exports. Hidden entities and
		// every descendant of a hidden source entity are removed before serialization.
		let visibleImportedBodies = (system.bodies || []).filter(function(body) {
			if (!body || !body.importedFromSWN) return false;
			if (body.sourceIsHidden || hiddenSwnEntityIds.has(String(body.sourceEntityId || ''))) return false;
			return !body.sourceParent || !hiddenSwnEntityIds.has(String(body.sourceParent));
		});
		system.bodies = App.censorObjects(visibleImportedBodies, ['sourceAttributes','sourceEntityId','sourceEntityType','importedFromSWN','sourceParent','sourceParentEntity','sourceIsHidden','generatedFields']);
		system.summary = system.planets.length ? system.planets[0].description : 'An uninhabited system with unexplored orbital bodies and uncertain prospects.';
	}
	
	newSector.corporations = App.censorObjects(sector.corporations, ['markets', 'strategy', 'valuation', 'lastStrategicAction', 'lastStrategicActionTurn', 'lastStrategicActionReason', 'marketOutlook', 'marketOutlookTurn']);
	newSector.aliens = App.censorObjects(sector.aliens, ['lenses', 'government', 'body']);
	newSector.religions = App.censorObjects(sector.religions, ['doctrine']);
	newSector.politicalGroups = App.censorObjects(sector.politicalGroups, ['leadership']);
	
	return newSector;
}

// create a clone of the given object, removing the given attributes
App.censorObject = function(object, attributes) {
	let newObject = {};
	
	for (let attribute in object) {
		if (attributes.indexOf(attribute) < 0) {
			newObject[attribute] = object[attribute];
		}
	}
	
	return newObject;
}

App.censorObjects = function(objects, attributes) {
	let newObjects = [];
	objects = Array.isArray(objects) ? objects : [];
	attributes = Array.isArray(attributes) ? attributes : [];
	
	for (let i = 0; i < objects.length; i++) {
		if (objects[i] && typeof objects[i] === 'object') newObjects.push(App.censorObject(objects[i], attributes));
	}
	
	return newObjects;
}

// ************************************************************************** //

App.displayCorporationDirectory = function(sector) {
	var output = document.getElementById('corporations-output');
	if (!output) return;
	output.innerHTML = '';
	var table = new DynTable([
		DynTable.basicColumn('Corporation', 'name'),
		DynTable.basicColumn('Sector interests', 'markets'),
		{
			name:'Direct market links',
			get:function(corporation) {
				var names = (corporation.linkedMarketIds || []).map(function(id) { var market = (sector.markets || []).find(function(item) { return item.id === id; }); return market && market.planetName; }).filter(Boolean);
				return names.length ? names.length + ' linked · ' + names.slice(0,2).join(', ') + (names.length > 2 ? ' …' : '') : 'No linked markets';
			},
			set:function() {},
			validate:function() { return true; }
		},
		DynTable.basicColumn('Ownership', 'ownership'),
		DynTable.basicColumn('Strategy', 'strategy'),
		DynTable.basicColumn('Valuation', 'valuation')
	]);
	output.appendChild(table.getElement());
	table.enableEditing(CorporationGenerator.template, function() { App.persistSector(sector); });
	table.addRows(sector.corporations || []);
	table.sort(0);
};


App.displayReligionDirectory = function(sector) {
	var output = document.getElementById('religions-output');
	if (!output) return;
	output.innerHTML = '';
	var table = new DynTable([
		DynTable.basicColumn('Religion', 'name'),
		DynTable.basicColumn('Leadership', 'leadership'),
		DynTable.basicColumn('Doctrine', 'doctrine')
	]);
	output.appendChild(table.getElement());
	table.enableEditing(ReligionGenerator.template, function() { App.persistSector(sector); });
	table.addRows(Array.isArray(sector.religions) ? sector.religions : []);
	table.sort(0);
};

App.displayPoliticalGroupDirectory = function(sector) {
	var output = document.getElementById('political-groups-output');
	if (!output) return;
	output.innerHTML = '';
	var table = new DynTable([
		DynTable.basicColumn('Political Group', 'name'),
		DynTable.basicColumn('Leadership', 'leadership')
	]);
	output.appendChild(table.getElement());
	table.enableEditing(PoliticalGroupGenerator.template, function() { App.persistSector(sector); });
	table.addRows(Array.isArray(sector.politicalGroups) ? sector.politicalGroups : []);
	table.sort(0);
};

App.displaySector = function(sector) {
	sector = sector || {};
	sector.grid = sector.grid || {columns:SectorGrid.DEFAULT_COLUMNS, rows:SectorGrid.DEFAULT_ROWS};
	var preserveImported = !!(sector.importMetadata && sector.importMetadata.mode === 'preserve');
	if (preserveImported) {
		// As-is imports must not be silently populated with Forge-generated campaign content.
		sector.systems = Array.isArray(sector.systems) ? sector.systems : [];
		sector.systems.forEach(function(system) {
			system.planets = Array.isArray(system.planets) ? system.planets : [];
			system.pointsOfInterest = Array.isArray(system.pointsOfInterest) ? system.pointsOfInterest : [];
			system.bodies = Array.isArray(system.bodies) ? system.bodies : [];
		});
		['corporations','religions','politicalGroups','aliens','regions','tradeRoutes','polities','markets','factions','adventures','threats','people','supplementContent','corporationMarketLinks','diplomacy','factionNews','factionTurnHistory'].forEach(function(key) {
			if (!Array.isArray(sector[key])) sector[key] = [];
		});
	} else {
		if (sector.importMetadata && sector.importMetadata.mode === 'enrich' && sector.swnImport) {
			// Imported source data does not contain Forge's distinct campaign layer.
			// Only this explicit opt-in creates that layer; existing imported fields stay intact.
			if (!Array.isArray(sector.corporations) || !sector.corporations.length) sector.corporations = CorporationGenerator.generate();
			if (!Array.isArray(sector.religions) || !sector.religions.length) sector.religions = ReligionGenerator.generate();
			if (!Array.isArray(sector.politicalGroups) || !sector.politicalGroups.length) sector.politicalGroups = PoliticalGroupGenerator.generate();
			if (!Array.isArray(sector.aliens) || !sector.aliens.length) sector.aliens = AlienGenerator.generate();
		}
		CampaignTools.enrichSector(sector, true);
	}
	// The 1.3 simulation envelope is migrated independently from campaign
	// enrichment. This is safe for preserve-mode imports and never generates
	// missing markets, factions, routes, or other campaign content.
	if (typeof SectorSimulation !== 'undefined' && SectorSimulation.migrateSector) {
		// Unversioned native Sector Forge saves predate the 1.3 envelope and are
		// treated as 1.2; imported SWN sectors retain an explicit unknown source.
		var sourceVersion = sector.createdWithVersion || sector.applicationVersion || (sector.swnImport ? 'unknown' : '1.2');
		SectorSimulation.migrateSector(sector, {sourceApplicationVersion:sourceVersion});
		if (typeof SectorPolitics !== 'undefined') SectorPolitics.initialize(sector);
		SectorSimulation.refreshDerivedState(sector);
	}
	// Reconciliation is an explicit load-time operation. Rendering campaign
	// panels below is read-only with respect to canonical sector records.
	if (!preserveImported && window.CampaignTools) {
		CampaignTools.ensureDiplomacy(sector);
		CampaignTools.recalculateInfluence(sector);
		CampaignTools.linkCampaignRecords(sector);
		(sector.diplomacy || []).forEach(function(rel) {
			if (rel.tradeAccess == null) rel.tradeAccess = 'automatic';
			if (rel.tradeTariffPercent == null) rel.tradeTariffPercent = -1;
			if (rel.tradeTransitRights == null) rel.tradeTransitRights = true;
			if (rel.embargoCommodityIds == null) rel.embargoCommodityIds = '';
		});
		if (!Array.isArray(sector.factionTurnHistory)) sector.factionTurnHistory = [];
		if (!sector.factionTurnHistory.length && Number(sector.factionTurn || 0) > 0 && Array.isArray(sector.factionNews) && sector.factionNews.length) CampaignTools.recordFactionTurn(sector, sector.factionTurn, sector.factionNews);
	}
	if (typeof SectorLogistics !== 'undefined' && SectorEconomy && SectorEconomy.isInitialized && SectorEconomy.isInitialized(sector)) {
		SectorLogistics.initialize(sector);
		if (typeof SectorSettlement !== 'undefined' && SectorSettlement.initialize) SectorSettlement.initialize(sector);
		if (typeof SectorTradeContracts !== 'undefined' && SectorTradeContracts.initialize) SectorTradeContracts.initialize(sector);
		if (typeof SectorTransport !== 'undefined' && sector.simulation.transport && SectorTransport.initialize) SectorTransport.initialize(sector);
	}
	if (typeof SectorSimulation !== 'undefined' && SectorSimulation.ensureRecoveryIdentity) SectorSimulation.ensureRecoveryIdentity(sector);
	App.currentSector = sector;
	if (App.updateLocalRecoveryStatus) App.updateLocalRecoveryStatus();
	// set up edit mode
	if (sector.gmMode) {
		document.body.classList.remove('no-edit');
	} else {
		document.body.classList.add('no-edit');
	}
	
	// display sector name
	App.displaySectorName(sector);
	
	// set up the export tab
	App.persistSector(sector, {skipRecoverySnapshot:true});
	
	// display the sector hexmap
	App.displayHexmap(sector);
	
	// display the worlds table
	App.displayWorlds(sector);
	
	// Corporation directory is refreshed from live corporate-market relationships below.

	App.displayReligionDirectory(sector);
	App.displayPoliticalGroupDirectory(sector);
	App.displayAliens(sector);
	App.renderCampaignPanels(sector);
	App.renderSourceData(sector);
	App.populateSupplementTargets(sector);
}

App.displayAliens = function(sector) {
	sector = sector || {};
	var aliens = Array.isArray(sector.aliens) ? sector.aliens : [];
	var aliensOutput = document.getElementById('aliens-output');
	if (!aliensOutput) return;
	aliensOutput.innerHTML = '';
	var aliensTable = new DynTable([
		DynTable.basicColumn('Alien', 'name'),
		DynTable.basicColumn('Type', 'type'),
		DynTable.basicColumn('Body', 'body'),
		DynTable.basicColumn('Lenses', 'lenses'),
		DynTable.basicColumn('Government', 'government'),
	]);
	aliensTable.enableEditing(AlienGenerator.template, function() { App.persistSector(sector); });
	aliensOutput.appendChild(aliensTable.getElement());
	aliensTable.addRows(aliens);
	aliensTable.sort(0);
	var countStatus = document.getElementById('alien-catalog-status');
	if (countStatus) {
		if (aliens.length) countStatus.textContent = aliens.length + ' alien ' + (aliens.length === 1 ? 'entry' : 'entries') + ' in this sector. Newly generated sectors roll 3–8 entries; the count varies between new sectors. Saved and imported catalogs are displayed without rerolling.';
		else countStatus.textContent = 'No alien entries are recorded in this sector. Newly generated sectors roll 3–8 entries; an empty imported catalog is left unchanged.';
	}
};

App.displaySectorName = function(sector) {
	let nameElem = document.createElement('span')
	nameElem.className = 'sector-name';
	nameElem.innerText = "Sector " + sector.name;
	
	let editButtonContainer = document.createElement('span');
	editButtonContainer.className = 'edit-zone';
	
	let editButtonElem = document.createElement('span');
	editButtonElem.innerText = 'edit';
	editButtonElem.className = 'textbutton';
	
	let sectorNameContainer = document.getElementById('sector-name-container')
	sectorNameContainer.innerHTML = '';
	sectorNameContainer.appendChild(nameElem);
	sectorNameContainer.appendChild(editButtonContainer);
	editButtonContainer.appendChild(document.createTextNode(' '));
	editButtonContainer.appendChild(editButtonElem);
	
	editButtonElem.addEventListener('click', function() {
		let title = 'Editing: Sector ' + sector.name;		
		DynEdit.edit(
			title,
			sector,
			{lists:{},generators:{name:() => App.generateSectorName()},hide:['gmMode']},
			function() {
				App.persistSector(sector);
				
				App.displaySectorName(sector);
			}
		);
	});
}

App.displayHexmap = function(sector, selectedSystem=null) {
	// Rebuild the map workspace while keeping the existing sector engine intact.
	let mapContainerElement = document.getElementById('map-container');
	mapContainerElement.innerHTML = '';

	let worldCount = 0;
	for (let system of sector.systems) worldCount += (system.planets || []).length;

	let toolbar = document.createElement('div');
	toolbar.className = 'map-toolbar';
	let toolbarCopy = document.createElement('div');
	toolbarCopy.className = 'map-toolbar-copy';
	let kicker = document.createElement('div');
	kicker.className = 'map-kicker';
	kicker.innerText = 'SECTOR CARTOGRAPHY / LIVE MAP';
	let subtitle = document.createElement('div');
	subtitle.className = 'map-subtitle';
	subtitle.innerText = 'Select a populated hex to inspect its system, worlds, and points of interest.';
	toolbarCopy.appendChild(kicker);
	toolbarCopy.appendChild(subtitle);
	toolbar.appendChild(toolbarCopy);

	let stats = document.createElement('div');
	stats.className = 'map-stats';
	let systemStat = document.createElement('span');
	systemStat.className = 'map-stat';
	systemStat.innerHTML = '<strong>' + sector.systems.length + '</strong> systems';
	let worldStat = document.createElement('span');
	worldStat.className = 'map-stat';
	worldStat.innerHTML = '<strong>' + worldCount + '</strong> worlds';
	let gridStat = document.createElement('span');
	gridStat.className = 'map-stat';
	var gridSize = SectorGrid.dimensions(sector);
	gridStat.innerHTML = '<strong>' + gridSize.columns + ' × ' + gridSize.rows + '</strong> grid';
	stats.appendChild(systemStat);
	stats.appendChild(worldStat);
	stats.appendChild(gridStat);
	toolbar.appendChild(stats);
	mapContainerElement.appendChild(toolbar);

	let mapLayout = document.createElement('div');
	mapLayout.className = 'map-layout';
	mapContainerElement.appendChild(mapLayout);

	let hexmapInspectorElement = document.createElement('aside');
	hexmapInspectorElement.id = 'inspector';
	hexmapInspectorElement.setAttribute('aria-label', 'Selected star system details');
	mapLayout.appendChild(hexmapInspectorElement);

	let mapVisual = document.createElement('div');
	mapVisual.className = 'map-visual';
	mapLayout.appendChild(mapVisual);
	let visualHeader = document.createElement('div');
	visualHeader.className = 'map-visual-header';
	let visualTitle = document.createElement('strong');
	visualTitle.innerText = 'SECTOR GRID';
	let visualMeta = document.createElement('span');
	visualMeta.innerText = 'SELECTABLE SYSTEMS · FIXED VIEWPORT · EDITABLE REGIONS';
	visualHeader.appendChild(visualTitle);
	visualHeader.appendChild(visualMeta);
	mapVisual.appendChild(visualHeader);

	let mapControls = document.createElement('div');
	mapControls.className = 'map-controlbar';
	mapControls.innerHTML = '<button type="button" class="map-tool-button map-toggle-button" id="map-edit-toggle" aria-pressed="false">Edit mode: OFF</button><button type="button" class="map-tool-button map-toggle-button" id="map-domination-toggle" aria-pressed="true">Faction domination: ON</button><span class="map-hint" id="map-interaction-status" role="status" aria-live="polite">Editing is off. Select a system to inspect it, or turn editing on to move systems and manage regions.</span>';
	mapVisual.appendChild(mapControls);

	// Editing controls are deliberately grouped and hidden unless Edit mode is enabled.
	let mapEditTools = document.createElement('div');
	mapEditTools.className = 'map-edit-tools';
	mapEditTools.id = 'map-edit-tools';
	mapEditTools.hidden = !Hexmap._editMode;
	let mapEditActions = document.createElement('div');
	mapEditActions.className = 'map-edit-actionbar';
	mapEditActions.innerHTML = '<button type="button" class="map-tool-button map-tool-accent" id="map-move-selected">Move selected system</button><button type="button" class="map-tool-button" id="map-cancel-move" hidden>Cancel move</button><span class="map-hint">Move a selected system by choosing this action, then selecting an empty hex. The map itself never drags or pans.</span>';
	mapEditTools.appendChild(mapEditActions);

	let regionTools = document.createElement('div');
	regionTools.className = 'map-region-tools';
	regionTools.innerHTML = '<label for="map-region-select">Region editor</label><select id="map-region-select" aria-label="Select region to edit"><option value="">No region selected</option></select><input id="map-region-name" type="text" maxlength="48" placeholder="Name a new region" aria-label="New region name"><button type="button" id="map-region-create" class="map-tool-button map-tool-accent">Create region</button><button type="button" id="map-region-delete" class="map-tool-button" disabled>Delete selected</button>';
	mapEditTools.appendChild(regionTools);
	mapVisual.appendChild(mapEditTools);

	let canvasScroll = document.createElement('div');
	canvasScroll.className = 'map-canvas-scroll';
	mapVisual.appendChild(canvasScroll);
	let hexmapCanvasElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	hexmapCanvasElement.id = 'hexmap';
	hexmapCanvasElement.classList.add('hexmap-svg');
	hexmapCanvasElement.setAttribute('role', 'group');
	hexmapCanvasElement.setAttribute('aria-label', 'Static vector hex map. Select systems and hexes; use explicit controls to edit positions and regions.');
	canvasScroll.appendChild(hexmapCanvasElement);

	let legend = document.createElement('div');
	legend.className = 'map-legend';
	mapVisual.appendChild(legend);
	function refreshMapLegend() {
		legend.innerHTML = '<span class="legend-item"><i class="legend-dot"></i> Star system</span><span class="legend-item"><i class="legend-ring"></i> Selected system</span><span class="legend-item"><i class="legend-route"></i> Trade route</span><span class="legend-item"><i class="legend-route scout"></i> Scout route</span><span class="legend-item"><i class="legend-hex"></i> Empty hex</span>';
		if (!Hexmap._showFactionDomination) return;
		var controlledFactionIds = new Set((sector.systems || []).map(function(sys) { return sys.controllingFactionId; }).filter(Boolean));
		(sector.factions || []).forEach(function(faction) {
			if (!controlledFactionIds.has(faction.id)) return;
			var item = document.createElement('span'); item.className = 'legend-item';
			var swatch = document.createElement('i'); swatch.className = 'legend-faction-swatch'; swatch.style.backgroundColor = faction.color || '#70e0cf';
			item.appendChild(swatch); item.appendChild(document.createTextNode(faction.name || 'Unnamed faction')); legend.appendChild(item);
		});
		if ((sector.systems || []).some(function(sys) { return sys.isContested; })) {
			var contested = document.createElement('span'); contested.className = 'legend-item';
			var contestedSwatch = document.createElement('i'); contestedSwatch.className = 'legend-faction-swatch contested'; contested.appendChild(contestedSwatch);
			contested.appendChild(document.createTextNode('Contested system')); legend.appendChild(contested);
		}
	}
	refreshMapLegend();

	// Draw vector cartography and connect its editing events to sector persistence.
	if (selectedSystem == null) selectedSystem = sector.systems[0] || null;
	Hexmap.draw(hexmapCanvasElement, sector, selectedSystem);
	App.displaySystemInspector(hexmapInspectorElement, selectedSystem, sector);
	Hexmap.onClickHex(hexmapCanvasElement, sector, function(system, hex) {
		if (system) App.displaySystemInspector(hexmapInspectorElement, system, sector);
		else if (hex) App.displayEmptyHexInspector(hexmapInspectorElement, hex, sector);
	});

	var regionSelect = document.getElementById('map-region-select');
	function refreshRegionSelect(selectedId) {
		if (!regionSelect) return;
		regionSelect.innerHTML = '';
		var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No region selected'; regionSelect.appendChild(empty);
		(sector.regions || []).forEach(function(region) {
			var option = document.createElement('option'); option.value = region.id; option.textContent = region.name + ' (' + (region.hexes || []).length + ' hexes)'; regionSelect.appendChild(option);
		});
		regionSelect.value = selectedId || '';
		var del = document.getElementById('map-region-delete'); if (del) del.disabled = !regionSelect.value;
		Hexmap.setActiveRegion(regionSelect.value);
	}
	refreshRegionSelect(Hexmap._editMode && Hexmap._activeRegionId && (sector.regions || []).some(function(r) { return r.id === Hexmap._activeRegionId; }) ? Hexmap._activeRegionId : '');
	App._refreshMapRegionSelect = function(selectedId) {
		if (!regionSelect || !regionSelect.isConnected) return;
		regionSelect.innerHTML = '';
		var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No region selected'; regionSelect.appendChild(empty);
		(sector.regions || []).forEach(function(region) {
			var option = document.createElement('option'); option.value = region.id; option.textContent = region.name + ' (' + (region.hexes || []).length + ' hexes)'; regionSelect.appendChild(option);
		});
		regionSelect.value = selectedId || '';
		var del = document.getElementById('map-region-delete'); if (del) del.disabled = !regionSelect.value;
	};
	document.getElementById('map-edit-toggle').addEventListener('click', function() {
		Hexmap.setEditMode(!Hexmap._editMode);
	});
	document.getElementById('map-domination-toggle').addEventListener('click', function() {
		Hexmap.setFactionDomination(!Hexmap._showFactionDomination);
		refreshMapLegend();
	});
	regionSelect.addEventListener('change', function() {
		if (!Hexmap._editMode) { regionSelect.value = ''; return; }
		if (Hexmap._moveMode) Hexmap.cancelMoveSelected();
		refreshRegionSelect(regionSelect.value);
	});
	document.getElementById('map-move-selected').addEventListener('click', function() {
		if (Hexmap._moveMode) { Hexmap.cancelMoveSelected(); return; }
		Hexmap.startMoveSelected();
	});
	document.getElementById('map-cancel-move').addEventListener('click', function() { Hexmap.cancelMoveSelected(); });
	document.getElementById('map-region-create').addEventListener('click', function() {
		if (!Hexmap._editMode) return;
		var input = document.getElementById('map-region-name');
		var name = (input.value || '').trim();
		if (!name) { input.focus(); input.setCustomValidity('Enter a name for this region.'); input.reportValidity(); return; }
		input.setCustomValidity('');
		sector.regions = Array.isArray(sector.regions) ? sector.regions : [];
		var id = 'REGION-' + String(sector.regions.length + 1).padStart(2, '0');
		while (sector.regions.some(function(r) { return r.id === id; })) id = 'REGION-' + Math.random().toString(36).slice(2, 7).toUpperCase();
		var color = Hexmap._palette[(sector.regions.length) % Hexmap._palette.length];
		sector.regions.push({id:id, name:name, color:color, hexes:[]});
		input.value = ''; refreshRegionSelect(id); App.persistSector(sector);
	});
	document.getElementById('map-region-delete').addEventListener('click', function() {
		if (!Hexmap._editMode) return;
		var id = regionSelect.value; if (!id) return;
		sector.regions = (sector.regions || []).filter(function(r) { return r.id !== id; });
		if (Hexmap._activeRegionId === id) Hexmap._activeRegionId = '';
		refreshRegionSelect(''); App.persistSector(sector);
	});
	Hexmap._syncMoveButton();
	Hexmap._status(Hexmap._editMode
		? 'Edit mode is ON. Move systems or select a region to edit its hex membership.'
		: 'Editing is off. Select systems to inspect them; turn editing on to move systems or manage regions.');

}

// Show a deliberate create action after the GM selects an empty map hex.
App.displayEmptyHexInspector = function(inspectorElement, hex, sector) {
	inspectorElement.innerHTML = '';
	var state = document.createElement('div'); state.className = 'inspector-empty-state';
	var mark = document.createElement('div'); mark.className = 'inspector-empty-mark'; mark.textContent = '＋'; state.appendChild(mark);
	var title = document.createElement('h3'); title.textContent = 'Empty hex ' + String(hex.x).padStart(2,'0') + String(hex.y).padStart(2,'0'); state.appendChild(title);
	var copy = document.createElement('p'); copy.textContent = Hexmap._editMode ? 'Create a star system here, then add any worlds, orbital stations, mines, ruins, points of interest, or other custom records.' : 'This hex has no star system. Turn Edit mode on to create one here.'; state.appendChild(copy);
	if (Hexmap._editMode) {
		var create = document.createElement('button'); create.type = 'button'; create.className = 'map-tool-button map-tool-accent'; create.id = 'map-create-system-button'; create.textContent = 'Create system here';
		create.addEventListener('click', function() { App.createSystemAtHex(sector, hex.x, hex.y); }); state.appendChild(create);
	}
	inspectorElement.appendChild(state);
};

App.getSurveyObjectEditTemplate = function(extraHide) {
	return {
		hide:['bodyClass','isGeneratedWorld'].concat(extraHide || []),
		lists:{type:['Orbital station','Mining installation','Mining platform','Research outpost','Shipyard','Derelict vessel','Communications array','Military installation','Habitat','Pretech facility','Unknown structure']},
		generators:{
			type:function() { return GenUtil.pickRandom(['Orbital station','Mining installation','Mining platform','Research outpost','Shipyard','Derelict vessel','Communications array','Military installation','Habitat','Pretech facility','Unknown structure']); },
			name:function() { return SWNNameGen.getName() + ' ' + GenUtil.pickRandom(['Station','Array','Platform','Works','Habitat','Installation']); },
			description:function() { return GenUtil.pickRandom(['A quiet installation with intermittent power and no reliable registry.','An automated facility whose original operators are no longer present.','A guarded site built around an unusual industrial or scientific purpose.','A damaged structure whose surviving systems still broadcast a repeating signal.','A sealed complex with unknown occupants and a narrow active communications band.']); },
			notes:function() { return GenUtil.pickRandom(['','Its current operator is unknown.','Approach protocols have not been verified.','The facility may contain valuable salvage.']); }
		}
	};
};

App.getPointOfInterestEditTemplate = function() {
	var types=['Ruins','Ancient ruins','Settlement','Ancient site','Anomaly','Wilderness','Industrial site','Religious site','Military site','Alien structure','Scientific installation'];
	return {
		lists:{type:types},
		generators:{
			name:function() { return GenUtil.pickRandom(['The Silent Observatory','Broken Crown','Glass Meridian','The Hollow','Old Landing','The Red Vault','Far Lantern','The Drowned Archive',"Pilgrim's Rest",'The Last Garden']); },
			type:function() { return GenUtil.pickRandom(types); },
			occupants:function() { return GenUtil.pickRandom(['Unspecified','Abandoned','Local settlers','Scavengers','Religious adherents','Automated defenses','Hostile survivors','Alien presence','Official garrison']); },
			situation:function() { return GenUtil.pickRandom(['A recent arrival has disturbed something that was meant to remain sealed.','Two local groups claim the site and neither will negotiate first.','A repeating signal is drawing people toward the location.','The site offers a valuable resource but is difficult to reach safely.','Someone has erased the records of the last expedition.','The location appears abandoned, though its defenses remain active.']); }
		}
	};
};

App.createSystemAtHex = function(sector, x, y) {
	if (!sector || !Hexmap._editMode) return null;
	x = Number(x); y = Number(y);
	if (!SectorGrid.validCoordinates(sector, x, y)) return null;
	if ((sector.systems || []).some(function(item) { return Number(item.x) === x && Number(item.y) === y; })) {
		window.alert('That hex is already occupied. Choose an empty hex instead.'); return null;
	}
	sector.systems = Array.isArray(sector.systems) ? sector.systems : [];
	var id = App.makeUniqueId(sector.systems, 'SYS-', 2);
	var initialBodies = StarSystemGenerator.generate([], {contentDensity:'empty'});
	var system = {id:id, x:x, y:y, name:WorldGenerator.generateSystemName(), planets:[], pointsOfInterest:[], bodies:initialBodies, systemType:initialBodies.some(function(body) { return body.bodyClass === 'B'; }) ? 'blackHole' : 'star', summary:'A newly charted stellar system. Its worlds and installations have not yet been catalogued.'};
	sector.systems.push(system);
	App.refreshSectorAfterMapEdit(sector, system);
	return system;
};

App.refreshSectorAfterMapEdit = function(sector, selectedSystem) {
	if (!sector) return;
	sector.systems = Array.isArray(sector.systems) ? sector.systems : [];
	sector.systems.forEach(function(system) { App.syncSystemBodies(system); });
	sector.tradeRoutes = CampaignTools.generateTradeRoutes(sector);
	CampaignTools.recalculateInfluence(sector);
	CampaignTools.linkCampaignRecords(sector);
	CampaignTools.updateMarkets(sector, sector.factionTurn || 0);
	if (typeof SectorSimulation !== 'undefined' && SectorSimulation.refreshDerivedState) SectorSimulation.refreshDerivedState(sector);
	App.displayHexmap(sector, selectedSystem || null);
	App.displayWorlds(sector);
	if (typeof App.renderCampaignPanels === 'function') App.renderCampaignPanels(sector);
	App.persistSector(sector);
};

// Keep markets one-to-one with worlds when users add worlds after initial generation.
// Existing markets are preserved so their edited prices, goods, and notes are not lost.
App.ensureMarketForPlanet = function(sector, system, planet) {
	if (!sector || !system || !planet || !planet.id || typeof CampaignTools === 'undefined' || typeof CampaignTools.generateMarkets !== 'function') return null;
	sector.markets = Array.isArray(sector.markets) ? sector.markets : [];
	var existing = sector.markets.find(function(market) { return market.planetId === planet.id; });
	if (existing) {
		existing.systemId = system.id; existing.systemName = system.name; existing.planetName = planet.name;
		existing.techLevel = planet.techLevel; existing.population = planet.population;
		if (typeof SectorSimulation === 'undefined' || !SectorSimulation.isFieldOverridden || !SectorSimulation.isFieldOverridden(existing, 'traits')) existing.traits = [planet.tag1, planet.tag2].filter(Boolean);
		if (typeof SectorEconomy !== 'undefined' && SectorEconomy.refreshMarketDrivers) SectorEconomy.refreshMarketDrivers(sector, existing);
		return existing;
	}
	var generated = CampaignTools.generateMarkets({systems:[{id:system.id, name:system.name, planets:[planet]}]})[0];
	if (!generated) return null;
	generated.id = App.makeUniqueId(sector.markets, 'MARKET-', 3);
	sector.markets.push(generated);
	// Once a local economy exists, newly created worlds must receive an account
	// immediately; initializeSector is additive and preserves every old account.
	if (typeof SectorEconomy !== 'undefined' && SectorEconomy.isInitialized && SectorEconomy.isInitialized(sector)) SectorEconomy.initializeSector(sector);
	return generated;
};

App.rerollSystemSurvey = function(system, sector) {
	if (!system) return [];
	var previous = Array.isArray(system.bodies) ? system.bodies : [];
	var preserved = previous.filter(function(body) {
		if (!body) return false;
		var provenance = typeof SectorSimulation !== 'undefined' && SectorSimulation.getProvenance ? SectorSimulation.getProvenance(body) : 'legacy';
		if (provenance === 'imported' || provenance === 'manual') return true;
		// Pre-provenance installations with stable IDs are still protected.
		return provenance === 'legacy' && !!body.id && body.bodyClass !== 'S' && body.bodyClass !== 'B' && body.bodyClass !== 'P' && !body.isGeneratedWorld;
	});
	var generated = StarSystemGenerator.generate(Array.isArray(system.planets) ? system.planets : [], {
		contentDensity:(sector && sector.generationSettings && sector.generationSettings.worldDensity) || 'default'
	});
	generated.forEach(function(body) { if (body && !body.source) body.source = 'generated'; });
	system.bodies = generated.concat(preserved);
	return system.bodies;
};

App.syncSystemBodies = function(system) {
	if (!system) return;
	var oldBodies = Array.isArray(system.bodies) ? system.bodies : [];
	var isBlackHole = system.sourceEntityType === 'blackHole' || system.systemType === 'blackHole';
	var stars = oldBodies.filter(function(body) { return body && (isBlackHole ? body.bodyClass === 'B' : (body.bodyClass === 'S' || body.bodyClass === 'B')); });
	var extras = oldBodies.filter(function(body) { return body && body.bodyClass !== 'S' && body.bodyClass !== 'B' && body.bodyClass !== 'P' && !body.planetId && (!body.worldName || body.importedFromSWN) && !body.isGeneratedWorld; });
	var worlds = (system.planets || []).map(function(planet, index) {
		planet.id = planet.id || system.id + '-W' + String(index + 1).padStart(2,'0');
		planet.systemId = system.id;
		return {type:'World · TL ' + (planet.techLevel || '?') + ' · ' + (planet.population || 'unknown population'), name:planet.name || ('World ' + (index + 1)), worldName:planet.name || ('World ' + (index + 1)), planetId:planet.id, bodyClass:'P', isGeneratedWorld:true};
	});
	if (!stars.length) {
		var generatedPrimaries = StarSystemGenerator.generate([], {contentDensity:'empty', primaryType:isBlackHole ? 'blackHole' : undefined}).filter(function(body) { return body.bodyClass === 'S' || body.bodyClass === 'B'; });
		stars = generatedPrimaries;
	}
	if (isBlackHole) system.systemType = 'blackHole';
	else if (stars.some(function(body) { return body.bodyClass === 'B'; })) system.systemType = 'blackHole';
	else if (system.systemType === 'blackHole') system.systemType = 'star';
	system.bodies = stars.concat(worlds, extras);
};

App.makeUniqueId = function(items, prefix, padLength) {
	var used = new Set((items || []).map(function(item) { return item && item.id; }).filter(Boolean));
	var serial = 1, id; do { id = prefix + String(serial++).padStart(padLength || 2, '0'); } while (used.has(id));
	return id;
};

// Apply a World Directory edit to the single affected world and its linked market.
// Imported descriptions remain source-authored; generated descriptions are refreshed.
App.applyWorldDirectoryEdit = function(sector, entry) {
	if (!sector || !entry) return null;
	var planet = entry.planet || entry;
	var system = entry.system || (sector.systems || []).find(function(item) {
		return (item.planets || []).some(function(candidate) { return candidate === planet || (planet.id && candidate.id === planet.id); });
	});
	if (!system || !planet) return null;
	var importedDescription = typeof SectorSimulation !== 'undefined' && SectorSimulation.getProvenance && SectorSimulation.getProvenance(planet) === 'imported';
	var lockedDescription = typeof SectorSimulation !== 'undefined' && SectorSimulation.isFieldOverridden && SectorSimulation.isFieldOverridden(planet, 'description');
	if (!importedDescription && !lockedDescription && !planet.sourceEntityType && !planet.sourceId && !planet.importedFromSWN) {
		planet.description = WorldGenerator.describePlanet(planet);
	}
	App.ensureMarketForPlanet(sector, system, planet);
	CampaignTools.recalculateInfluence(sector);
	CampaignTools.linkCampaignRecords(sector);
	CampaignTools.updateMarkets(sector, sector.factionTurn || 0);
	return {system:system, planet:planet};
};

App.getPlanetEditTemplate = function(planet) {
	var base = WorldGenerator.planetTemplate || {};
	var template = Object.assign({}, base, {
		hide:(base.hide || []).slice(),
		lists:Object.assign({}, base.lists || {}),
		generators:Object.assign({}, base.generators || {})
	});
	if (planet && planet.generationMode !== 'expanded') {
		['tagCandidate3','populationEstimate'].forEach(function(field) {
			if (template.hide.indexOf(field) < 0) template.hide.push(field);
		});
		delete template.generators.tagCandidate3;
	}
	return template;
};

App.displayWorlds = function(sector) {
	sector = sector || {};
	var profileStatus = document.getElementById('world-generation-profile-status');
	if (profileStatus) {
		var recordedMode = sector.worldGenerationMode;
		if (recordedMode === 'expanded') {
			profileStatus.textContent = 'World generation profile: Expanded. Tag candidate and population estimate are generated for newly generated worlds. Existing worlds are not rerolled when the profile changes.';
		} else if (recordedMode === 'core') {
			profileStatus.textContent = 'World generation profile: Revised Edition Core. The third tag candidate and population estimate are not part of this profile; the table marks them as “Not generated (Core)”. Choose Expanded before generating a new sector to include them.';
		} else {
			profileStatus.textContent = 'World generation profile: not recorded. Blank supplemental fields are shown as “Not recorded”; imported world data is not silently rerolled.';
		}
	}
	function supplementaryWorldColumn(name, key) {
		return {
			name:name,
			get:function(world) {
				var value = DynTable.getAttributeByString(world.planet, key);
				if (value !== undefined && value !== null && String(value).trim() !== '') return value;
				var mode = world.planet.generationMode || sector.worldGenerationMode;
				if (mode === 'core') return 'Not generated (Core)';
				if (mode === 'expanded') return 'Missing expanded data';
				return 'Not recorded';
			},
			set:function(world, value) { DynTable.setAttributeByString(world.planet, key, value); },
			validate:function(world) { return !!world && !!world.planet; }
		};
	}
	// unroll list of systems into list of worlds;
	let worlds = [];
	for (let i = 0; i < sector.systems.length; i++) {
		let system = sector.systems[i];
		for (let j = 0; j < system.planets.length; j++) {
			let planet = system.planets[j];
			worlds.push({system:system, planet:planet});
		}
	}
	
	// create world table
	let worldOutput = document.getElementById('worlds-output');
	worldOutput.innerHTML = '';
	let worldTable = new DynTable([
		{
			name:'XXYY',
			get:function(world) { return String(world.system.x).padStart(2, '0') + String(world.system.y).padStart(2, '0'); },
			set:function(world, value) { world.system.x = 0; world.system.y = 0; },
			validate:function(world) { return DynTable.validateHasAttribute(world, 'system.x') && DynTable.validateHasAttribute(world, 'system.y'); }
		},
		DynTable.basicColumn('System', 'system.name'),
		DynTable.basicColumn('World', 'planet.name'),
		DynTable.basicColumn('Atmosphere', 'planet.atmosphere'),
		DynTable.basicColumn('Gravity', 'planet.gravity'),
		DynTable.basicColumn('Temperature', 'planet.temperature'),
		DynTable.basicColumn('Biosphere', 'planet.biosphere'),
		DynTable.basicColumn('Population', 'planet.population'),
		DynTable.basicColumn('Tech Level', 'planet.techLevel'),
		DynTable.basicColumn('Tag', 'planet.tag1'),
		DynTable.basicColumn('Tag', 'planet.tag2'),
		supplementaryWorldColumn('Tag candidate', 'tagCandidate3'),
		supplementaryWorldColumn('Population estimate', 'populationEstimate'),
		DynTable.basicColumn('Terrain', 'planet.terrain'),
	]);
	worldTable.enableEditing(
		WorldGenerator.planetTemplate,
		function(entry, editInfo) {
			if (editInfo && editInfo.editedObject) App.markManualFieldChanges(editInfo.editedObject, editInfo.before);
			var changed = App.applyWorldDirectoryEdit(sector, entry);
			if (!changed) return;
			App.displayHexmap(sector, changed.system);
			if (typeof App.renderCampaignPanels === 'function') App.renderCampaignPanels(sector);
			App.persistSector(sector);
		},
		'planet'
	);
	worldOutput.appendChild(worldTable.getElement());
		
	worldTable.addRows(worlds);
	worldTable.sort(0);	
}

// -------------------------------------------------------------------------- //
// Extended campaign workspaces

App.RECOVERY_DB_NAME = 'sector-forge-local-recovery';
App.RECOVERY_DB_VERSION = 1;
App.RECOVERY_STORE_NAME = 'snapshots';
App._recoveryDbPromise = null;
App._recoveryDbInstance = null;
App._recoverySequence = 0;
App._recoveryTimer = null;
App._recoveryPendingSector = null;

App.checksumLocalRecoveryJSON = function(value) {
	var hash = 2166136261, input = String(value || '');
	for (var i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
	return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
};

App.resetRecoveryDatabaseConnection = function(database) {
	if (!database || App._recoveryDbInstance === database) {
		App._recoveryDbPromise = null;
		App._recoveryDbInstance = null;
	}
};

App.recoveryTransaction = function(database, mode) {
	try {
		return database.transaction([App.RECOVERY_STORE_NAME], mode || 'readonly');
	} catch (error) {
		if (error && (error.name === 'InvalidStateError' || error.name === 'NotFoundError')) App.resetRecoveryDatabaseConnection(database);
		throw error;
	}
};

App.openRecoveryDatabase = function() {
	if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local recovery storage.'));
	if (App._recoveryDbPromise) {
		return App._recoveryDbPromise.then(function(database) {
			try {
				// A cached IDBDatabase can become unusable after a browser-managed close.
				// Probe it before reuse and transparently reopen if its connection is stale.
				database.transaction([App.RECOVERY_STORE_NAME], 'readonly');
				return database;
			} catch (error) {
				App.resetRecoveryDatabaseConnection(database);
				return App.openRecoveryDatabase();
			}
		});
	}
	App._recoveryDbPromise = new Promise(function(resolve, reject) {
		var request;
		try { request = window.indexedDB.open(App.RECOVERY_DB_NAME, App.RECOVERY_DB_VERSION); }
		catch (error) { reject(error); return; }
		request.onupgradeneeded = function() {
			var database = request.result;
			if (!database.objectStoreNames.contains(App.RECOVERY_STORE_NAME)) database.createObjectStore(App.RECOVERY_STORE_NAME, {keyPath:'id'});
		};
		request.onsuccess = function() {
			var database = request.result;
			App._recoveryDbInstance = database;
			database.onversionchange = function() {
				try { database.close(); } catch (error) {}
				App.resetRecoveryDatabaseConnection(database);
			};
			database.onclose = function() { App.resetRecoveryDatabaseConnection(database); };
			resolve(database);
		};
		request.onerror = function() { reject(request.error || new Error('Could not open local recovery storage.')); };
		request.onblocked = function() { reject(new Error('Local recovery storage is blocked by another open Sector Forge tab.')); };
	}).catch(function(error) { App.resetRecoveryDatabaseConnection(); throw error; });
	return App._recoveryDbPromise;
};

App.getRecoveryCampaignId = function(sector) {
	if (!sector) return '';
	if (typeof SectorSimulation !== 'undefined' && SectorSimulation.ensureRecoveryIdentity) return SectorSimulation.ensureRecoveryIdentity(sector);
	return String(sector.simulation && sector.simulation.recovery && sector.simulation.recovery.campaignId || '');
};

App.recoverySnapshotKey = function(campaignId) {
	return 'campaign:' + String(campaignId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
};

App.recoverySectorFingerprint = function(sector) {
	if (!sector || !Array.isArray(sector.systems)) return '';
	var systems = sector.systems.map(function(system) {
		return [String(system && system.id || ''), String(system && system.name || ''), Number.isFinite(Number(system && system.x)) ? Number(system.x) : null, Number.isFinite(Number(system && system.y)) ? Number(system.y) : null];
	}).sort(function(a, b) { return String(a[0]).localeCompare(String(b[0])); });
	return JSON.stringify({name:String(sector.name || 'Unnamed Sector'),grid:{columns:Number(sector.grid && sector.grid.columns || 0),rows:Number(sector.grid && sector.grid.rows || 0)},systems:systems});
};

App.findLegacyRecoverySnapshot = function(database, sector) {
	var fingerprint = App.recoverySectorFingerprint(sector);
	if (!fingerprint) return Promise.resolve(null);
	return new Promise(function(resolve, reject) {
		var transaction;
		try { transaction = App.recoveryTransaction(database, 'readonly'); }
		catch (error) { reject(error); return; }
		var request = transaction.objectStore(App.RECOVERY_STORE_NAME).getAll();
		request.onsuccess = function() {
			var matches = (request.result || []).filter(function(record) {
				var embeddedId = record && record.sector && record.sector.simulation && record.sector.simulation.recovery && record.sector.simulation.recovery.campaignId;
				var storedId = record && String(record.campaignId || embeddedId || '').trim();
				return record && record.sector && !storedId && App.recoverySectorFingerprint(record.sector) === fingerprint;
			}).sort(function(a, b) { return Number(b.sequence || 0) - Number(a.sequence || 0) || String(b.savedAt || '').localeCompare(String(a.savedAt || '')); });
			resolve(matches[0] || null);
		};
		request.onerror = function() { reject(request.error || new Error('Could not inspect older local recovery snapshots.')); };
		transaction.onerror = function() { reject(transaction.error || new Error('Could not search older local recovery snapshots.')); };
	});
};

App.getLocalRecoverySnapshot = function(sectorOrId) {
	var sectorForMatch = sectorOrId && typeof sectorOrId === 'object' ? sectorOrId : null;
	var campaignId = typeof sectorOrId === 'string' ? sectorOrId : App.getRecoveryCampaignId(sectorOrId);
	return App.openRecoveryDatabase().then(function(database) {
		return new Promise(function(resolve, reject) {
			var transaction;
			try { transaction = App.recoveryTransaction(database, 'readonly'); }
			catch (error) { reject(error); return; }
			var store = transaction.objectStore(App.RECOVERY_STORE_NAME), settled = false;
			function finish(record) { if (settled) return; settled = true; resolve(record || null); }
			function fallback() {
				if (!sectorForMatch) {
					var legacy = store.get('latest');
					legacy.onsuccess = function() {
						var record = legacy.result;
						if (record && record.targetId) {
							if (campaignId && String(record.campaignId || '') !== String(campaignId)) { finish(null); return; }
							var target = store.get(record.targetId);
							target.onsuccess = function() { finish(target.result || null); };
							target.onerror = function() { reject(target.error || new Error('Could not read the latest campaign snapshot.')); };
						} else if (record && record.sector) {
							var matches = !campaignId || String(record.campaignId || '') === String(campaignId);
							finish(matches ? record : null);
						} else finish(null);
					};
					legacy.onerror = function() { reject(legacy.error || new Error('Could not read the legacy recovery snapshot.')); };
					return;
				}
				// Fingerprint recovery is strictly a legacy migration path. A record
				// that has its own campaign identity must never be considered here.
				App.findLegacyRecoverySnapshot(database, sectorForMatch).then(finish, reject);
			}
			if (campaignId) {
				var request = store.get(App.recoverySnapshotKey(campaignId));
				request.onsuccess = function() { if (request.result) finish(request.result); else fallback(); };
				request.onerror = function() { reject(request.error || new Error('Could not read the campaign recovery snapshot.')); };
			} else fallback();
			transaction.onerror = function() { reject(transaction.error || new Error('Could not read local recovery storage.')); };
		});
	});
};

App.saveLocalRecoverySnapshot = function(sector, reason) {
	if (!sector || !Array.isArray(sector.systems)) return Promise.resolve({ok:false, reason:'There is no valid sector to snapshot.'});
	if (sector.gmMode === false) return Promise.resolve({ok:false, reason:'Local recovery snapshots are available only for referee-edition sectors.'});
	var campaignId = App.getRecoveryCampaignId(sector);
	if (!campaignId) return Promise.resolve({ok:false, reason:'The campaign has no stable local recovery identity.'});
	var serialized;
	try { serialized = JSON.stringify(sector); }
	catch (error) { return Promise.resolve({ok:false, reason:'The sector could not be serialized: ' + (error.message || error)}); }
	if (!serialized) return Promise.resolve({ok:false, reason:'The sector snapshot is empty.'});
	var sequence = Math.max(Date.now() * 1000, App._recoverySequence + 1);
	App._recoverySequence = sequence;
	var key = App.recoverySnapshotKey(campaignId);
	var record = {id:key,campaignId:campaignId,sequence:sequence,savedAt:new Date().toISOString(),appVersion:App.VERSION,sectorName:String(sector.name || 'Unnamed sector'),reason:String(reason || 'manual'),checksum:App.checksumLocalRecoveryJSON(serialized),sizeBytes:typeof Blob !== 'undefined' ? new Blob([serialized]).size : serialized.length,sector:JSON.parse(serialized)};
	return App.openRecoveryDatabase().then(function(database) {
		return new Promise(function(resolve, reject) {
			var transaction = App.recoveryTransaction(database, 'readwrite');
			var store = transaction.objectStore(App.RECOVERY_STORE_NAME);
			var existingSnapshot = null, latestPointer = null, reads = 0, wrote = false;
			function ready() {
				reads++;
				if (reads !== 2) return;
				if (existingSnapshot && Number(existingSnapshot.sequence || 0) > sequence) return;
				store.put(record); wrote = true;
				if (!latestPointer || Number(latestPointer.sequence || 0) <= sequence) {
					store.put({id:'latest',targetId:key,campaignId:campaignId,sequence:sequence,savedAt:record.savedAt,sectorName:record.sectorName});
				}
			}
			var snapshotRead = store.get(key), pointerRead = store.get('latest');
			snapshotRead.onsuccess = function() { existingSnapshot = snapshotRead.result || null; ready(); };
			pointerRead.onsuccess = function() { latestPointer = pointerRead.result || null; ready(); };
			snapshotRead.onerror = function() { reject(snapshotRead.error || new Error('Could not check the previous campaign snapshot.')); };
			pointerRead.onerror = function() { reject(pointerRead.error || new Error('Could not check the latest recovery pointer.')); };
			transaction.oncomplete = function() { resolve({ok:true,skipped:!wrote,record:record}); };
			transaction.onerror = function() { reject(transaction.error || new Error('Could not save the local recovery snapshot.')); };
			transaction.onabort = function() { reject(transaction.error || new Error('The local recovery snapshot transaction was aborted.')); };
		});
	}).then(function(result) {
		App.updateLocalRecoveryStatus();
		return result;
	}).catch(function(error) { return {ok:false,reason:(error && error.message) || String(error)}; });
};

App.clearLocalRecoverySnapshot = function(sectorOrId) {
	var sectorForMatch = sectorOrId && typeof sectorOrId === 'object' ? sectorOrId : null;
	var campaignId = typeof sectorOrId === 'string' ? sectorOrId : App.getRecoveryCampaignId(sectorOrId);
	return App.openRecoveryDatabase().then(function(database) {
		return new Promise(function(resolve, reject) {
			var transaction = App.recoveryTransaction(database, 'readwrite');
			var store = transaction.objectStore(App.RECOVERY_STORE_NAME);
			var all = store.getAll();
			all.onsuccess = function() {
				var records = all.result || [], pointer = records.find(function(item) { return item && item.id === 'latest'; });
				var targetId = '';
				if (campaignId) {
					var exactKey = App.recoverySnapshotKey(campaignId);
					var exact = records.find(function(item) { return item && item.id === exactKey; });
					if (exact) targetId = exactKey;
					else if (sectorForMatch) {
						var fingerprint = App.recoverySectorFingerprint(sectorForMatch);
						var legacy = records.filter(function(item) {
							var embeddedId = item && item.sector && item.sector.simulation && item.sector.simulation.recovery && item.sector.simulation.recovery.campaignId;
							return item && item.sector && !String(item.campaignId || embeddedId || '').trim() && App.recoverySectorFingerprint(item.sector) === fingerprint;
						}).sort(function(a,b) { return Number(b.sequence||0)-Number(a.sequence||0); });
						if (legacy.length) targetId = legacy[0].id;
					}
				} else if (sectorForMatch) {
					var noIdFingerprint = App.recoverySectorFingerprint(sectorForMatch);
					var noIdLegacy = records.filter(function(item) {
						var embeddedId = item && item.sector && item.sector.simulation && item.sector.simulation.recovery && item.sector.simulation.recovery.campaignId;
						return item && item.sector && !String(item.campaignId || embeddedId || '').trim() && App.recoverySectorFingerprint(item.sector) === noIdFingerprint;
					}).sort(function(a,b) { return Number(b.sequence||0)-Number(a.sequence||0); });
					if (noIdLegacy.length) targetId = noIdLegacy[0].id;
				} else targetId = pointer && pointer.targetId || (pointer && pointer.sector ? 'latest' : '');
				if (targetId) store.delete(targetId);
				if (targetId === 'latest') store.delete('latest');
				var remaining = records.filter(function(item) { return item && item.id !== 'latest' && item.id !== targetId && item.sector; }).sort(function(a,b) { return Number(b.sequence || 0) - Number(a.sequence || 0); });
				if (pointer && (pointer.targetId === targetId || targetId === 'latest')) {
					if (remaining.length) {
						var next = remaining[0];
						store.put({id:'latest',targetId:next.id,campaignId:next.campaignId || '',sequence:next.sequence,savedAt:next.savedAt,sectorName:next.sectorName});
					} else store.delete('latest');
				}
			};
			all.onerror = function() { reject(all.error || new Error('Could not inspect local recovery snapshots.')); };
			transaction.oncomplete = function() { resolve(true); };
			transaction.onerror = function() { reject(transaction.error || new Error('Could not delete the campaign recovery snapshot.')); };
			transaction.onabort = function() { reject(transaction.error || new Error('The campaign snapshot deletion was aborted.')); };
		});
	}).then(function(result) { App.updateLocalRecoveryStatus(); return result; });
};

// Integrity checks became mandatory for snapshots written by 1.3.9 and later.
// Compare numeric version components instead of matching only the 1.3.x series,
// so the rule continues to apply to future releases such as 1.5 and 2.0.
App.isLocalRecoveryChecksumRequired = function(appVersion) {
	var match = String(appVersion || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/);
	if (!match) return false;
	var actual = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
	var threshold = [1, 3, 9];
	for (var i = 0; i < threshold.length; i++) {
		if (actual[i] > threshold[i]) return true;
		if (actual[i] < threshold[i]) return false;
	}
	return true;
};

App.validateLocalRecoveryRecord = function(record) {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return {ok:false,reason:'The stored snapshot record is malformed.'};
	var sector = record.sector;
	if (!sector || typeof sector !== 'object' || Array.isArray(sector) || !Array.isArray(sector.systems)) return {ok:false,reason:'The snapshot does not contain a valid sector system list.'};
	if (sector.markets != null && !Array.isArray(sector.markets)) return {ok:false,reason:'The snapshot market data is malformed.'};
	if (sector.factions != null && !Array.isArray(sector.factions)) return {ok:false,reason:'The snapshot faction data is malformed.'};
	if (sector.systems.some(function(system) { return !system || typeof system !== 'object' || Array.isArray(system); })) return {ok:false,reason:'The snapshot contains a malformed system record.'};
	var serialized;
	try { serialized = JSON.stringify(sector); }
	catch (error) { return {ok:false,reason:'The snapshot cannot be serialized: ' + (error.message || error)}; }
	if (!serialized) return {ok:false,reason:'The snapshot is empty.'};
	if (record.checksum != null && record.checksum !== '') {
		if (!/^[a-f0-9]{8}$/i.test(String(record.checksum))) return {ok:false,reason:'The snapshot integrity value is malformed.'};
		if (App.checksumLocalRecoveryJSON(serialized) !== String(record.checksum).toLowerCase()) return {ok:false,reason:'The snapshot failed its integrity check.'};
	} else if (App.isLocalRecoveryChecksumRequired(record.appVersion)) {
		return {ok:false,reason:'The snapshot is missing its required integrity value.'};
	}
	return {ok:true,sector:sector,legacyChecksum:!record.checksum};
};

App.setLocalRecoveryStatus = function(message) {
	var status = document.getElementById('recovery-status');
	if (status) status.textContent = String(message || '');
};

App.updateLocalRecoveryStatus = function() {
	var restore = document.getElementById('recovery-restore-button');
	var clear = document.getElementById('recovery-clear-button');
	if (!restore || !clear) return Promise.resolve(false);
	return App.getLocalRecoverySnapshot(App.currentSector || undefined).then(function(record) {
		restore.disabled = !record;
		clear.disabled = !record;
		if (record) {
			var date = new Date(record.savedAt);
			App.setLocalRecoveryStatus('Latest snapshot: ' + record.sectorName + ' · ' + (Number.isNaN(date.getTime()) ? record.savedAt : date.toLocaleString()) + ' · ' + Math.max(1, Math.round(Number(record.sizeBytes || 0) / 1024)) + ' KB');
		} else App.setLocalRecoveryStatus('No local snapshot exists on this device.');
		return !!record;
	}).catch(function(error) {
		restore.disabled = true; clear.disabled = true;
		App.setLocalRecoveryStatus('Local recovery unavailable: ' + ((error && error.message) || error));
		return false;
	});
};

App.isAutomaticRecoveryEnabled = function() {
	try { return window.localStorage.getItem('sectorForge.localRecovery.enabled') === 'true'; }
	catch (error) { return false; }
};

App.bindLocalRecoveryControls = function() {
	var toggle = document.getElementById('recovery-auto-enable');
	var save = document.getElementById('recovery-save-button');
	var restore = document.getElementById('recovery-restore-button');
	var clear = document.getElementById('recovery-clear-button');
	if (!toggle || toggle.dataset.bound === 'true') return;
	toggle.dataset.bound = 'true';
	toggle.checked = App.isAutomaticRecoveryEnabled();
	toggle.addEventListener('change', function() {
		try { window.localStorage.setItem('sectorForge.localRecovery.enabled', toggle.checked ? 'true' : 'false'); }
		catch (error) { toggle.checked = false; App.setLocalRecoveryStatus('Could not save this preference: ' + (error.message || error)); return; }
		if (toggle.checked) {
			if (App.currentSector) App.saveLocalRecoverySnapshot(App.currentSector, 'automatic-recovery-enabled').then(function(result) { App.setLocalRecoveryStatus(result.ok ? 'Automatic recovery is enabled. A local GM snapshot was saved.' : 'Automatic recovery could not start: ' + result.reason); });
		} else App.setLocalRecoveryStatus('Automatic recovery is off. Any existing local snapshot is kept until you delete it.');
	});
	save.addEventListener('click', function() {
		if (!App.currentSector) { App.setLocalRecoveryStatus('Load a sector before saving a snapshot.'); return; }
		save.disabled = true;
		App.saveLocalRecoverySnapshot(App.currentSector, 'manual').then(function(result) {
			save.disabled = false;
			App.setLocalRecoveryStatus(result.ok ? 'Local recovery snapshot saved.' : 'Snapshot failed: ' + result.reason);
		});
	});
	restore.addEventListener('click', function() {
		App.getLocalRecoverySnapshot(App.currentSector || undefined).then(function(record) {
			var validation = App.validateLocalRecoveryRecord(record);
			if (!validation.ok) { App.setLocalRecoveryStatus('The local recovery snapshot was not restored: ' + validation.reason); return; }
			if (!window.confirm('Restore the local snapshot for “' + String(record.sectorName || 'Unnamed sector') + '”? The sector currently open will be replaced.')) return;
			var sector = JSON.parse(JSON.stringify(validation.sector));
			document.getElementById('generator-container').classList.add('hide-section');
			document.getElementById('viewer-container').classList.remove('hide-section');
			App.displaySector(sector);
			App.setLocalRecoveryStatus('Restored local snapshot saved ' + new Date(record.savedAt).toLocaleString() + '.');
		}).catch(function(error) { App.setLocalRecoveryStatus('Restore failed: ' + ((error && error.message) || error)); });
	});
	clear.addEventListener('click', function() {
		if (!window.confirm('Permanently delete the local recovery snapshot for the currently open campaign?')) return;
		App.clearLocalRecoverySnapshot(App.currentSector || undefined).then(function() { App.setLocalRecoveryStatus('Local recovery snapshot deleted for this campaign.'); }).catch(function(error) { App.setLocalRecoveryStatus('Delete failed: ' + ((error && error.message) || error)); });
	});
	App.updateLocalRecoveryStatus();
};

App.scheduleLocalRecoverySnapshot = function(sector) {
	if (!sector || !App.isAutomaticRecoveryEnabled()) return false;
	App._recoveryPendingSector = sector;
	if (App._recoveryTimer) window.clearTimeout(App._recoveryTimer);
	App._recoveryTimer = window.setTimeout(function() {
		var pending = App._recoveryPendingSector;
		App._recoveryTimer = null;
		App._recoveryPendingSector = null;
		if (!pending) return;
		App.saveLocalRecoverySnapshot(pending, 'automatic-edit').then(function(result) {
			if (!result.ok && App.currentSector && App.getRecoveryCampaignId(App.currentSector) === App.getRecoveryCampaignId(pending)) {
				App.setLocalRecoveryStatus('Automatic recovery snapshot failed: ' + result.reason);
			}
		});
	}, 900);
	return true;
};

App.persistSector = function(sector, options) {
	if (!sector) return Promise.resolve(false);
	options = options || {};
	if (typeof SectorLogistics !== 'undefined' && SectorLogistics.invalidatePathCache) SectorLogistics.invalidatePathCache(sector);
	// Loading/restoring a sector refreshes exports but must not replace the
	// user's latest automatic recovery snapshot. Snapshots are scheduled by
	// actual edits (or an explicit recovery action) only.
	if (options.skipRecoverySnapshot !== true) App.scheduleLocalRecoverySnapshot(sector);
	return App.createDownloadLink(sector);
};

App.appendElement = function(parent, tagName, text, className) {
	var element = document.createElement(tagName || 'div');
	if (text !== undefined && text !== null) element.textContent = String(text);
	if (className) element.className = className;
	parent.appendChild(element);
	return element;
};


// Cross-record navigation: campaign objects use stable IDs, never display-name matching,
// for system/world/market/corporation relationships.
App.switchToTab = function(title) {
	var buttons = Array.from(document.querySelectorAll('#viewer-tabs .dyntab-header [role="tab"]'));
	var button = buttons.find(function(item) { return item.textContent.trim() === title; });
	if (button) button.click();
	return !!button;
};

App.highlightTableRow = function(container, predicate) {
	if (!container) return false;
	container.querySelectorAll('.linked-highlight-row').forEach(function(row) { row.classList.remove('linked-highlight-row'); });
	var row = Array.from(container.querySelectorAll('tbody tr')).find(predicate);
	if (!row) return false;
	row.classList.add('linked-highlight-row');
	row.scrollIntoView({block:'center', inline:'nearest'});
	return true;
};

App.focusSystem = function(systemId) {
	var sector = App.currentSector;
	var system = sector && (sector.systems || []).find(function(item) { return item.id === systemId; });
	if (!system) return false;
	App.displayHexmap(sector, system);
	App.switchToTab('Sector Map');
	var node = Array.from(document.querySelectorAll('#hexmap .system-node')).find(function(item) { return item.dataset.systemId === system.id; });
	if (node) { node.classList.add('is-linked-focus'); node.focus(); }
	return true;
};

App.focusWorld = function(planetId, systemId) {
	var sector = App.currentSector;
	if (!sector) return false;
	var system = (sector.systems || []).find(function(item) { return item.id === systemId; });
	var planet = system && (system.planets || []).find(function(item) { return item.id === planetId; });
	if (!planet) {
		for (var i=0; i<(sector.systems||[]).length && !planet; i++) {
			var candidate = (sector.systems[i].planets || []).find(function(item) { return item.id === planetId; });
			if (candidate) { system = sector.systems[i]; planet = candidate; }
		}
	}
	if (!planet || !system) return false;
	App.switchToTab('Worlds');
	return App.highlightTableRow(document.getElementById('worlds-output'), function(row) {
		var value = row.textContent || '';
		return value.indexOf(system.name) >= 0 && value.indexOf(planet.name) >= 0;
	});
};

App.focusMarket = function(marketId) {
	var sector = App.currentSector;
	if (!sector) return false;
	var market = (sector.markets || []).find(function(item) { return String(item.id) === String(marketId); });
	if (!market) return false;
	App.switchToTab('Trade & Routes');
	var search = document.getElementById('market-search');
	if (search) search.value = String(market.id || market.planetName || '');
	App.marketDirectoryState = App.marketDirectoryState || {page:0,pageSize:12};
	App.marketDirectoryState.page = 0;
	App.renderMarketDirectory(sector);
	var card = Array.from(document.querySelectorAll('#markets-output .market-card')).find(function(item) { return String(item.dataset.marketId) === String(marketId); });
	if (!card) return false;
	card.open = true;
	App.renderMarketDetail(sector, market, card);
	card.classList.add('linked-highlight-card');
	card.scrollIntoView({block:'center', inline:'nearest'});
	return true;
};

App.focusCorporation = function(corporationId) {
	var sector = App.currentSector;
	var corporation = sector && (sector.corporations || []).find(function(item) { return item.id === corporationId; });
	if (!corporation) return false;
	App.switchToTab('Corporations');
	return App.highlightTableRow(document.getElementById('corporations-output'), function(row) {
		return (row.textContent || '').indexOf(corporation.name) >= 0;
	});
};

App.renderSimpleTable = function(container, headers, rows, action) {
	if (!container) return;
	rows = Array.isArray(rows) ? rows : [];
	var state = container.__sfTableBrowseState || (container.__sfTableBrowseState = {query:'',page:0,pageSize:15,owner:null});
	var owner = App.currentSector || null;
	if (state.owner && owner && state.owner !== owner) { state.query=''; state.page=0; }
	state.owner = owner;
	state.rows = rows; state.headers = headers || []; state.action = action || null;
	var browseThreshold = 20, pageSize = Math.max(5, Number(state.pageSize || 15));
	function textValue(value) {
		if (value == null) return '';
		return typeof App.formatArchiveText === 'function' ? App.formatArchiveText(value) : String(value);
	}
	function draw() {
		container.innerHTML = '';
		var query = String(state.query || '').trim().toLowerCase();
		var searchable = rows.length > browseThreshold;
		var matches = query ? rows.filter(function(row) { return (row.values || []).map(textValue).join(' ').toLowerCase().indexOf(query) >= 0; }) : rows;
		var pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
		state.page = Math.max(0, Math.min(Number(state.page || 0), pageCount - 1));
		var visible = matches.slice(state.page * pageSize, (state.page + 1) * pageSize);
		if (searchable) {
			var toolbar = App.appendElement(container, 'div', null, 'archive-toolbar data-table-toolbar');
			var search = App.appendElement(toolbar, 'input'); search.type='search'; search.value=String(state.query || '');
			search.placeholder='Search '+rows.length+' records…'; search.setAttribute('aria-label','Search '+(container.getAttribute('aria-label') || container.id || 'table')+' records');
			var pageStatus = App.appendElement(toolbar, 'span', null, 'tool-status'); pageStatus.setAttribute('role','status'); pageStatus.textContent = matches.length ? 'Showing '+(state.page*pageSize+1)+'–'+Math.min(matches.length,(state.page+1)*pageSize)+' of '+matches.length+' matches · '+rows.length+' total' : '0 matches · '+rows.length+' total';
			var previous = App.appendElement(toolbar, 'button', 'Previous', 'button button-secondary'); previous.type='button'; previous.disabled=state.page<=0;
			var next = App.appendElement(toolbar, 'button', 'Next', 'button button-secondary'); next.type='button'; next.disabled=state.page>=pageCount-1;
			search.addEventListener('input', function() { state.query=search.value; state.page=0; draw(); var current=container.querySelector('.data-table-toolbar input'); if(current){current.focus();current.setSelectionRange(current.value.length,current.value.length);} });
			previous.addEventListener('click', function() { state.page=Math.max(0,state.page-1); draw(); });
			next.addEventListener('click', function() { state.page=Math.min(pageCount-1,state.page+1); draw(); });
		}
		if (!matches.length) {
			App.appendElement(container, 'p', searchable && query ? 'No records match this search.' : 'No entries yet. Generate or import a sector with suitable records.', 'empty-note');
			return;
		}
		var wrap = searchable ? App.appendElement(container, 'div', null, 'data-table-scroll') : container;
		var table = App.appendElement(wrap, 'table', null, 'dyntable campaign-table');
		var thead = App.appendElement(table, 'thead');
		var hr = App.appendElement(thead, 'tr');
		state.headers.forEach(function(header) { App.appendElement(hr, 'th', header); });
		if (state.action) App.appendElement(hr, 'th', 'Actions');
		var tbody = App.appendElement(table, 'tbody');
		visible.forEach(function(row) {
			var tr = App.appendElement(tbody, 'tr');
			(row.values || []).forEach(function(value) {
				var full = textValue(value), display = full.length > 800 ? full.slice(0,797)+'…' : (full || '—');
				var cell = App.appendElement(tr, 'td', display, 'data-table-cell');
				if (full.length > 800) cell.title = full;
			});
			if (state.action) {
				var td = App.appendElement(tr, 'td', null, 'campaign-row-actions');
				var btn = App.appendElement(td, 'button', state.action.label || 'Edit', 'textbutton campaign-action');
				btn.type = 'button';
				btn.addEventListener('click', function() { state.action.callback(row.item); });
				if (typeof state.action.extraButtons === 'function') state.action.extraButtons(row.item, td, row);
			}
		});
	}
	draw();
};

App.renderSourceData = function(sector) {
	var summary = document.getElementById('source-data-summary');
	var output = document.getElementById('source-data-output');
	if (!summary || !output) return;
	var imported = sector && sector.swnImport;
	if (!imported) {
		summary.textContent = 'No external source data is attached to this sector. When you import a Sectors Without Number export, its source records will be listed here.';
		output.innerHTML = '';
		return;
	}
	var records = Array.isArray(imported.records) ? imported.records : [];
	var mode = sector.importMetadata && sector.importMetadata.mode === 'enrich' ? 'Import + generate missing details' : 'Import as-is';
	var sourcePayload = imported.sourceData || {};
	var auxiliary = ['routes','layers','factions'].map(function(key) { var value = sourcePayload[key]; var count = Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0); return count ? key + ' (' + count + ')' : ''; }).filter(Boolean);
	summary.textContent = imported.source + ' · ' + String(imported.format || 'file').toUpperCase() + ' · ' + records.length + ' source records preserved · ' + sector.systems.length + ' systems mapped · ' + mode + (auxiliary.length ? ' · source-only data retained: ' + auxiliary.join(', ') : '') + '. Unsupported and source-specific entities remain in this archive and are not discarded.';
	var rows = records.map(function(record) {
		var coordinate = record.x !== '' && record.x != null && record.y !== '' && record.y != null
			? String(record.x).padStart(2, '0') + String(record.y).padStart(2, '0') : '—';
		var tags = Array.isArray(record.tags) ? record.tags.join(', ') : String(record.tags || '');
		return {item:record, values:[record.type || '—', record.name || '—', coordinate, record.parent || '—', record.occupation || '—', record.situation || '—', tags || '—']};
	});
	App.renderSimpleTable(output, ['Entity type','Name','Hex','Parent','Occupation','Situation','Tags'], rows, null);
	var auxiliaryOutput = document.getElementById('source-data-auxiliary-output');
	if (auxiliaryOutput) {
		auxiliaryOutput.innerHTML = '';
		var auxiliaryRows = [];
		(imported.navigationRoutes || []).forEach(function(route) {
			auxiliaryRows.push({item:route, values:['Navigation route', route.name || route.id, (route.hexes || []).length + ' hex points', (route.style || 'solid') + ' · ' + (route.width || 'normal') + ' · ' + (route.isHidden ? 'hidden' : 'visible'), route.color || '—']});
		});
		(imported.layers || []).forEach(function(layer) {
			auxiliaryRows.push({item:layer, values:['Map layer', layer.name || layer.id, (layer.regionCount || 0) + ' regions / ' + (layer.hexCount || 0) + ' mapped hexes', layer.isHidden ? 'hidden' : 'visible', '—']});
		});
		(imported.factions || []).forEach(function(faction) {
			var stats = 'Force ' + (faction.force === '' ? '—' : faction.force) + ' · Cunning ' + (faction.cunning === '' ? '—' : faction.cunning) + ' · Wealth ' + (faction.wealth === '' ? '—' : faction.wealth);
			auxiliaryRows.push({item:faction, values:['SWN faction (source record)', faction.name || faction.id, stats, (faction.assetCount || 0) + ' assets · ' + (faction.goal || 'no goal exported'), faction.relationship || '—']});
		});
		if (auxiliaryRows.length) {
			App.appendElement(auxiliaryOutput, 'h3', 'Additional SWN data');
			App.appendElement(auxiliaryOutput, 'p', 'Navigation routes are drawn on the map when their path is supported. Layer regions are converted to Forge map regions where possible. Imported SWN factions remain source records rather than being silently converted into Forge’s different faction-turn model.', 'panel-description');
			App.renderSimpleTable(auxiliaryOutput, ['Source data type','Name','Contents','Status / details','Color / relationship'], auxiliaryRows, null);
		}
	}
};

App.renderStoryCards = function(container, items, config) {
	container.innerHTML = '';
	if (!items || !items.length) {
		App.appendElement(container, 'p', 'No records are available yet.', 'empty-note');
		return;
	}
	items.forEach(function(item) {
		var card = App.appendElement(container, 'article', null, 'story-card');
		if (config && config.kicker) App.appendElement(card, 'p', typeof config.kicker === 'function' ? config.kicker(item) : item[config.kicker], 'story-kicker');
		App.appendElement(card, 'h3', (config && config.title ? item[config.title] : (item.title || item.name || 'Untitled record')) || 'Untitled record');
		if (config && config.summary) App.appendElement(card, 'p', typeof config.summary === 'function' ? config.summary(item) : item[config.summary], 'story-summary');
		var fields = config && config.fields ? config.fields : [];
		fields.forEach(function(field) {
			var value = typeof field.value === 'function' ? field.value(item) : item[field.key];
			if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
			var line = App.appendElement(card, 'div', null, 'story-field');
			App.appendElement(line, 'strong', field.label + ': ');
			var valueNode = App.appendElement(line, Array.isArray(value) && value.length > 2 ? 'ul' : 'span');
			if (Array.isArray(value) && value.length > 2) value.forEach(function(entry) { App.appendElement(valueNode, 'li', entry); });
			else valueNode.textContent = Array.isArray(value) ? value.join(' · ') : String(value);
		});
		if (config && config.status && item.status) App.appendElement(card, 'span', item.status, 'story-status');
		var controls = App.appendElement(card, 'div', null, 'story-controls');
		if (config && config.edit) {
			var edit = App.appendElement(controls, 'button', 'Edit', 'textbutton campaign-action');
			edit.type = 'button';
			edit.addEventListener('click', function() { config.edit(item); });
		}
		if (config && config.extraAction) config.extraAction(item, controls, card);
	});
};

App.buildCampaignEditTemplate = function(title, object, hide, lists) {
	var template = {hide:(hide || []), lists:(lists || {}), generators:{}};
	var generators = template.generators;
	var has = function(key) { return Object.prototype.hasOwnProperty.call(object || {}, key) && (typeof object[key] === 'string' || typeof object[key] === 'number' || typeof object[key] === 'boolean'); };
	var pick = function(items) { return items[Math.floor(Math.random() * items.length)]; };
	var int = function(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); };
	var set = function(key, fn) { if (has(key)) generators[key] = fn; };
	var sector = App.currentSector || {};
	var factionTypes = ['Planetary government','Trade combine','Intelligence service','Mercenary league','Religious movement','Frontier coalition','Research directorate','Free-trader network','Colonial authority','Veteran diaspora','Independent power'];
	var factionGoals = ['Expand influence along a trade corridor','Remove a rival from a strategic world','Gain control of a vital resource','Protect a threatened client system','Expose a concealed conspiracy','Secure recognition as a legitimate government','Recover an abandoned pretech facility','Prevent a neighboring power from expanding'];
	var factionTags = ['ambitious','secretive','warlike','plutocratic','zealous','technically adept','fragmented','reluctant','pragmatic','reformist'];
	var isFaction = Array.isArray(object && object.assets) && has('force') && has('cunning') && has('wealth') && has('primaryRating');
	var isAsset = has('ownerFactionId') && has('rating') && has('maintenance') && has('type');
	var isCorporation = has('ownership') && has('valuation') && has('strategy') && has('markets');
	var isPolity = Array.isArray(object && object.memberSystemIds) && has('government') && has('stability');
	var isMarketGood = has('priceIndex') && has('localPrice') && has('supply') && has('category');

	if (isFaction) {
		set('name', function() { var names=(sector.politicalGroups||[]).concat(sector.corporations||[],sector.religions||[]).map(function(item){return item.name;}).filter(Boolean); return names.length && Math.random()<0.6 ? pick(names) : SWNNameGen.getName() + ' ' + pick(['Authority','Compact','League','Combine','Movement']); });
		set('type', function() { return pick(factionTypes); });
		set('scale', function() { return pick(['Minor power','Established power','Regional hegemon']); });
		set('force', function() { return int(0,8); });
		set('cunning', function() { return int(0,8); });
		set('wealth', function() { return int(0,8); });
		set('primaryRating', function() { return pick(['force','cunning','wealth']); });
		set('goal', function() { return pick(factionGoals); });
		set('tag', function() { return pick(factionTags); });
		set('homeworldSystemId', function() { var options=template.lists.homeworldSystemId || []; return options.length ? pick(options) : ''; });
		set('maxHitPoints', function() { return int(8,50); });
		set('hitPoints', function(draft) { return int(0,Math.max(1,Number(draft.maxHitPoints)||10)); });
		set('factionCredits', function() { return int(0,12); });
		set('experience', function() { return int(0,15); });
		set('progress', function() { return int(0,6); });
		set('tension', function() { return int(1,6); });
		set('color', function() { return pick((window.CampaignTools && CampaignTools.FACTION_COLORS) || ['#70e0cf','#e6bd83','#b39bff','#ef8294']); });
	} else if (isAsset) {
		var assetCatalog = (window.CampaignTools && CampaignTools.ASSET_CATALOG) || [];
		set('type', function() { return pick(assetCatalog).type; });
		set('name', function(draft) { var current=assetCatalog.filter(function(item){return !draft.type || item.type===draft.type;}); return pick(current.length?current:assetCatalog).name; });
		set('stat', function() { return pick(['force','cunning','wealth']); });
		set('rating', function() { return int(0,8); });
		set('minimumRating', function() { return int(0,5); });
		set('hp', function() { return int(1,20); });
		set('maintenance', function() { return int(0,4); });
		set('cost', function() { return int(1,12); });
		set('income', function() { return int(0,5); });
		set('active', function(draft) { return !draft.active; });
		set('stealthed', function(draft) { return !draft.stealthed; });
	} else if (isPolity) {
		set('name', function() { return SWNNameGen.getName() + ' ' + pick(['Compact','League','Protectorate','Assembly','Mandate']); });
		set('government', function() { return pick(['Federated republic','Dynastic compact','Corporate protectorate','Loose trade league','Military directorate','Theocratic concord','Mutual-defense pact','Client-state network','Confederated worlds']); });
		set('policy', function() { return pick(['secure a jump corridor','preserve a fragile peace','control a rare resource','contain a rival ideology','restore an old mandate claim','open a new market','protect a frontier from raiders','keep outsiders away']); });
		set('stability', function() { return int(1,6); });
	} else if (isMarketGood) {
		set('supply', function() { return pick(['Abundant','Common','Available','Scarce','Very scarce','Unavailable']); });
		set('priceIndex', function() { return int(60,180); });
		set('localPrice', function(draft) { return Math.max(1,Math.round(Number(draft.basePrice || object.basePrice || 100) * Number(draft.priceIndex || 100) / 100)); });
		set('note', function() { return pick(['Reliable local supply','Prices fluctuate with shipping delays','A powerful local buyer dominates supply','Recent shortages have raised prices','Surplus stock is available','Imports are tightly controlled']); });
	}

	// Shared rerolls for common campaign fields. Fields without a safe, meaningful
	// domain-specific generator remain editable but are not given a misleading icon.
	set('status', function() { return pick(['Active','Unplayed','Played','Pending','Established','Surveyed','Disrupted']); });
	set('kind', function() { return pick(['trade','scout']); });
	set('trust', function() { return int(1,6); });
	set('tension', function() { return int(1,6); });
	set('stability', function() { return int(1,6); });
	set('stake', function() { return int(5,95); });
	set('name', generators.name || function() { return SWNNameGen.getName(); });
	set('title', function() { return pick(['A debt unpaid','The silent signal','A disputed inheritance','The broken alliance','A promise in ash','The last convoy']); });
	set('objective', function() { return pick(['Recover a missing cache','Negotiate a fragile truce','Expose a hidden patron','Escort a threatened convoy','Secure a derelict installation','Prevent a local succession crisis']); });
	set('motive', function() { return pick(['gain influence','conceal a dangerous secret','protect a family member','settle an old debt','escape a patron','secure forbidden knowledge']); });
	set('government', generators.government || function() { return pick(['Democratic','Monarchic','Tribal','Oligarchic','Military directorate','Corporate protectorate']); });
	set('policy', generators.policy || function() { return pick(['expand trade','preserve stability','secure a resource','contain a rival','avoid outside influence']); });
	set('priceIndex', generators.priceIndex || function() { return int(60,180); });
	set('localPrice', generators.localPrice || function() { return int(100,5000); });
	set('notes', function() { return pick(['','A local contact may know more.','Verify this information before acting.','The situation is changing rapidly.']); });
	return template;
};

App.markManualFieldChanges = function(object, before) {
	if (typeof SectorSimulation === 'undefined' || !SectorSimulation.setFieldOverride || !object || typeof object !== 'object') return object;
	before = before && typeof before === 'object' ? before : {};
	var internalFields = new Set(['fieldOverrides','manualOverrides','manualOverride','isManual','source','importedFromSWN','sourceEntityId','sourceEntityType','generatedBy','simulationGenerated']);
	Object.keys(object).forEach(function(field) {
		if (internalFields.has(field)) return;
		if (JSON.stringify(before[field]) !== JSON.stringify(object[field])) SectorSimulation.setFieldOverride(object, field, object[field]);
	});
	return object;
};

App.editCampaignObject = function(title, object, hide, afterSave, lists) {
	var template = App.buildCampaignEditTemplate(title, object, hide, lists);
	var before = JSON.parse(JSON.stringify(object || {}));
	DynEdit.edit(title, object, template, function(saved) {
		if (saved) {
			App.markManualFieldChanges(object, before);
			if (Array.isArray(object.assets) && object.maxHitPoints != null) {
				object.maxHitPoints = Math.max(1, Math.round(Number(object.maxHitPoints) || 10));
				object.hitPoints = Math.max(0, Math.min(object.maxHitPoints, Math.round(Number(object.hitPoints) || 0)));
				['force','cunning','wealth'].forEach(function(stat) { object[stat] = Math.max(0,Math.min(8,Math.round(Number(object[stat])||0))); });
			}
			if (afterSave) afterSave();
			if (App.currentSector) App.persistSector(App.currentSector);
		}
	});
};

App.formatArchiveText = function(value, depth) {
	depth = Number(depth || 0);
	if (value == null) return '';
	if (typeof value === 'string') {
		var candidate = value.trim();
		if (candidate.length <= 100000 && (candidate.charAt(0) === '{' || candidate.charAt(0) === '[')) {
			try { var parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object') return App.formatArchiveText(parsed, depth + 1); } catch (_) { /* Narrative text is preserved verbatim when it is not valid JSON. */ }
		}
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (depth > 2) return 'Additional structured detail';
	if (Array.isArray(value)) return value.slice(0, 10).map(function(item) { return App.formatArchiveText(item, depth + 1); }).filter(Boolean).join('; ');
	if (typeof value === 'object') {
		return Object.keys(value).slice(0, 10).map(function(key) {
			var label = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, function(c) { return c.toUpperCase(); });
			var content = App.formatArchiveText(value[key], depth + 1);
			return content ? label + ': ' + content : '';
		}).filter(Boolean).join(' · ');
	}
	return String(value);
};

App.renderFactionTurnHistory = function(sector) {
	var container = document.getElementById('faction-turn-history');
	if (!container) return;
	var retainedHistory = Array.isArray(sector.factionTurnHistory) ? sector.factionTurnHistory : [];
	var archive = sector.factionTurnHistoryArchive || {};
	var archivedRecords = Array.isArray(archive.records) ? archive.records : [];
	var archivedTurnIds = new Set(archivedRecords.map(function(record) { return String(record && (record.id || record.turn) || ''); }));
	var archivedNotes = Object.keys(archive.notesByTurn || {}).map(function(key) { return archive.notesByTurn[key]; }).filter(function(item) { return item && !archivedTurnIds.has(String(item.id || item.turn || '')); }).map(function(item) { return {id:item.id || 'FACTION-TURN-'+String(item.turn||0),turn:item.turn,gmNotes:item.notes,events:[],_notesOnly:true}; });
	var retentionStatus = document.getElementById('faction-history-retention-status');
	var detailedArchiveCount = archivedRecords.length, archivedCount = Number(archive.archivedCount || 0), legacySummaryCount = Math.max(0, archivedCount - detailedArchiveCount);
	if (retentionStatus) retentionStatus.textContent = archivedCount ? 'Archive retained: ' + archivedCount + ' turns (' + detailedArchiveCount + ' detailed); older details are budget-pruned automatically.' : 'Archive retained: ' + retainedHistory.length + ' recent faction turns.';
	var allHistory = archivedRecords.concat(retainedHistory, archivedNotes).sort(function(a, b) { return Number(b.turn || 0) - Number(a.turn || 0); });
	var search = document.getElementById('faction-history-search');
	var query = String(search && search.value || '').trim().toLowerCase();
	var matches = allHistory.filter(function(record) {
		if (!query) return true;
		var eventText = (Array.isArray(record.events) ? record.events : []).map(function(entry) { return [entry.factionName,entry.action,entry.result,entry.event,entry.systemName].map(function(value) { return App.formatArchiveText(value); }).join(' '); }).join(' ');
		return [record.turn,record.gmNotes,eventText].map(function(value) { return App.formatArchiveText(value); }).join(' ').toLowerCase().indexOf(query) >= 0;
	});
	var pageSize = 6, page = Math.max(0, Number(container.dataset.page || 0));
	var pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
	page = Math.min(page, pageCount - 1); container.dataset.page = String(page);
	var visible = matches.slice(page * pageSize, (page + 1) * pageSize);
	container.innerHTML = '';
	if (!visible.length) App.appendElement(container, 'p', query ? 'No campaign turns match this search.' : 'No faction turns have been archived yet. Advance a faction turn to start the campaign log.', 'empty-note');
	visible.forEach(function(record) {
		var isArchived = archivedRecords.indexOf(record) >= 0 || !!record._notesOnly;
		var events = Array.isArray(record.events) ? record.events : [];
		var card = App.appendElement(container, 'article', null, 'story-card faction-turn-log-card');
		App.appendElement(card, 'p', (isArchived ? 'ARCHIVED · ' : '') + 'TURN ' + Number(record.turn || 0) + ' / ' + events.length + ' EVENT' + (events.length === 1 ? '' : 'S'), 'story-kicker');
		App.appendElement(card, 'h3', 'Faction turn ' + Number(record.turn || 0) + (isArchived ? ' · archived' : ''));
		if (record.gmNotes) App.appendElement(card, 'p', record.gmNotes, 'story-summary faction-turn-gm-notes');
		else if (!record._notesOnly) App.appendElement(card, 'p', 'No referee notes added.', 'story-summary faction-turn-gm-notes empty-note');
		if (events.length) {
			var eventDetails = App.appendElement(card, 'details', null, 'archive-detail faction-turn-events-details');
			App.appendElement(eventDetails, 'summary', 'Show ' + events.length + ' faction events');
			var eventList = App.appendElement(eventDetails, 'ul', null, 'faction-turn-event-list');
			events.slice(0, 50).forEach(function(entry) {
				var summary = (entry.factionName || 'Unknown faction') + ' — ' + (entry.action || 'Action') + ': ' + (entry.event || entry.result || 'No details');
				App.appendElement(eventList, 'li', App.formatArchiveText(summary).slice(0, 520));
			});
			if (events.length > 50) App.appendElement(eventDetails, 'p', (events.length - 50) + ' older event details omitted from this turn view.', 'empty-note');
		} else App.appendElement(card, 'p', 'No faction events recorded for this turn.', 'empty-note');
		var controls = App.appendElement(card, 'div', null, 'story-controls');
		if (!record._notesOnly) {
			var editButton = App.appendElement(controls, 'button', 'Edit GM notes', 'textbutton campaign-action');
			editButton.type = 'button';
			editButton.addEventListener('click', function() {
				controls.innerHTML = '';
				var editor = App.appendElement(card, 'div', null, 'faction-turn-note-editor');
				var label = App.appendElement(editor, 'label', 'Referee notes for turn ' + Number(record.turn || 0), 'field-label');
				var note = App.appendElement(editor, 'textarea', null, 'text-input');
				note.rows = 4; note.value = String(record.gmNotes || ''); note.setAttribute('aria-label', 'Referee notes for turn ' + Number(record.turn || 0)); label.appendChild(note);
				var actions = App.appendElement(editor, 'div', null, 'story-controls');
				var save = App.appendElement(actions, 'button', 'Save notes', 'button button-primary'); save.type = 'button';
				save.addEventListener('click', function() { record.gmNotes = note.value; App.persistSector(sector); App.renderFactionTurnHistory(sector); });
				var cancel = App.appendElement(actions, 'button', 'Cancel', 'textbutton campaign-action'); cancel.type = 'button'; cancel.addEventListener('click', function() { App.renderFactionTurnHistory(sector); });
				note.focus();
			});
		}
	});
	var pageStatus = document.getElementById('faction-history-page-status');
	if (pageStatus) pageStatus.textContent = matches.length ? 'Showing ' + (page * pageSize + 1) + '–' + Math.min(matches.length, (page + 1) * pageSize) + ' of ' + matches.length + ' turns' : '0 turns';
	var previous = document.getElementById('faction-history-prev'), next = document.getElementById('faction-history-next');
	if (previous) { previous.disabled = page <= 0; if (!previous.dataset.bound) { previous.dataset.bound='true'; previous.addEventListener('click', function() { container.dataset.page=String(Math.max(0, Number(container.dataset.page||0)-1)); App.renderFactionTurnHistory(App.currentSector || sector); }); } }
	if (next) { next.disabled = page >= pageCount - 1; if (!next.dataset.bound) { next.dataset.bound='true'; next.addEventListener('click', function() { container.dataset.page=String(Number(container.dataset.page||0)+1); App.renderFactionTurnHistory(App.currentSector || sector); }); } }
	if (search && !search.dataset.bound) { search.dataset.bound='true'; search.addEventListener('input', function() { container.dataset.page='0'; App.renderFactionTurnHistory(App.currentSector || sector); }); }
};

App.renderChronicle = function(sector) {
	var output = document.getElementById('chronicle-output'); if (!output) return;
	output.innerHTML = '';
	var chronicle = sector && sector.simulation && sector.simulation.chronicle || {};
	var hotEvents = Array.isArray(chronicle.events) ? chronicle.events : [];
	var archive = chronicle.archive || {};
	var archivedEvents = Array.isArray(archive.records) ? archive.records : [];
	var events = archivedEvents.concat(hotEvents).slice().sort(function(a,b){return Number(b.sequence||0)-Number(a.sequence||0);});
	var retentionStatus = document.getElementById('chronicle-retention-status');
	if (retentionStatus) {
		var archived = Number(archive.archivedCount || 0), detailed = archivedEvents.length, legacySummary = Math.max(0, archived - detailed);
		retentionStatus.textContent = archived ? 'Archive retained: ' + archived + ' events (' + detailed + ' detailed); older details are budget-pruned automatically.' + (legacySummary ? ' ' + legacySummary + ' older events are summary counts only.' : '') : 'Archive retained: ' + hotEvents.length + ' recent Chronicle events.';
	}
	var filter = document.getElementById('chronicle-filter'), search = document.getElementById('chronicle-search');
	var category = filter ? filter.value : 'all', query = String(search && search.value || '').trim().toLowerCase();
	var matches = events.filter(function(e){
		if(category!=='all'&&String(e.category||'general')!==category)return false;
		if(!query)return true;
		return [e.summary,e.type,e.category,e.source,(e.actorIds||[]).join(' '),(e.affectedEntityIds||[]).join(' '),(e.locationSystemIds||[]).join(' '),e.reason,e.gmNote,e.effects].map(function(value) { return App.formatArchiveText(value); }).join(' ').toLowerCase().indexOf(query)>=0;
	});
	var limit = Math.max(20, Math.min(200, Number(output.dataset.visibleLimit || 20)));
	var visible = matches.slice(0, limit);
	if(!visible.length){App.appendElement(output,'p','No Chronicle entries match this view.','empty-note');return;}
	visible.forEach(function(e){
		var card=App.appendElement(output,'article',null,'story-card chronicle-event-card');
		App.appendElement(card,'p','TURN '+Number(e.turn||0)+' · '+String(e.category||'general').toUpperCase()+' · '+String(e.type||'event'),'story-kicker');
		App.appendElement(card,'h3',App.formatArchiveText(e.summary||'Unlabeled campaign event').slice(0,360));
		var participants=(e.actorIds||[]).concat(e.affectedEntityIds||[]), hasDetail=participants.length||(e.locationSystemIds||[]).length||(e.causes||[]).length||e.reason||(e.effects||[]).length||e.gmNote||e.visibility==='gm'||e.type==='gm-note';
		if(hasDetail){
			var detail=App.appendElement(card,'details',null,'archive-detail chronicle-event-details');
			App.appendElement(detail,'summary','Details and consequences');
			if(participants.length)App.appendElement(detail,'p','Participants / affected records: '+participants.join(', '),'story-summary');
			if((e.locationSystemIds||[]).length)App.appendElement(detail,'p','Systems: '+e.locationSystemIds.join(', '),'story-summary');
			if((e.causes||[]).length)App.appendElement(detail,'p','Caused by: '+e.causes.join(', '),'story-summary');
			if(e.reason)App.appendElement(detail,'p','Reason: '+App.formatArchiveText(e.reason),'story-summary');
			if(e.effects&&e.effects.length){var list=App.appendElement(detail,'ul',null,'chronicle-effects');e.effects.slice(0,8).forEach(function(x){App.appendElement(list,'li',App.formatArchiveText(x).slice(0,520));});}
			if(e.gmNote)App.appendElement(detail,'p',App.formatArchiveText(e.gmNote),'story-summary faction-turn-gm-notes');
			if(e.visibility==='gm'||e.type==='gm-note')App.appendElement(detail,'p','REFEREE ONLY','story-kicker');
		}
	});
	if(matches.length>visible.length){
		var more=App.appendElement(output,'button','Load 20 older events','button button-secondary archive-load-more');more.type='button';
		more.addEventListener('click',function(){output.dataset.visibleLimit=String(Math.min(200,limit+20));App.renderChronicle(App.currentSector||sector);});
	}
	var pageStatus=document.getElementById('chronicle-page-status');
	if(pageStatus)pageStatus.textContent='Showing '+visible.length+' of '+matches.length+' matching events';
};

App.renderPoliticsPanel = function(sector) {
	if(typeof SectorPolitics==='undefined')return;
	var state=sector&&sector.simulation&&sector.simulation.politics||{};
	var treaties=Array.isArray(state.treaties)?state.treaties:[], sanctions=Array.isArray(state.sanctions)?state.sanctions:[], wars=Array.isArray(state.wars)?state.wars:[];
	var summary={proposals:treaties.filter(function(t){return t.status==='proposed';}).length,activeTreaties:treaties.filter(function(t){return t.status==='active';}).length,activeSanctions:sanctions.filter(function(x){return x.status==='active';}).length,activeWars:wars.filter(function(w){return w.status==='active'||(w.status==='peace-pending'&&w.prePeaceStatus==='active');}).length,ceasefires:wars.filter(function(w){return w.status==='ceasefire'||(w.status==='peace-pending'&&w.prePeaceStatus==='ceasefire');}).length,pendingPeace:wars.filter(function(w){return w.status==='peace-pending';}).length};
	var status=document.getElementById('politics-status');
	if(status)status.textContent=summary.proposals+' proposals · '+summary.activeTreaties+' active treaties · '+summary.activeSanctions+' sanctions · '+summary.activeWars+' active wars · '+summary.ceasefires+' ceasefires · '+summary.pendingPeace+' peace settlements pending';
	var partyName=function(p){var entity=p.type==='faction'?(sector.factions||[]).find(function(x){return x.id===p.id;}):(sector.polities||[]).find(function(x){return x.id===p.id;});return (entity&&entity.name||p.id)+' ('+p.type+')';};
	App.renderSimpleTable(document.getElementById('politics-treaties-output'),['Treaty','Parties','Status','Terms','Effective turns'],treaties.slice().sort(function(a,b){return String(b.id).localeCompare(String(a.id));}).map(function(t){return {item:t,values:[t.name||t.id,t.parties.map(partyName).join(' ↔ '),t.status,(t.terms.tradeAccess||'open')+' · '+Number(t.terms.tariffPercent||0)+'% tariff'+(t.terms.transitRights===false?' · no transit':''),t.startTurn?(t.startTurn+'–'+(t.endTurn||'ongoing')):'Pending response']};}),{label:'Manage',callback:function(t){if(t.status==='proposed')SectorPolitics.respondToTreaty(sector,t.id,'accept');else if(t.status==='active')SectorPolitics.terminateTreaty(sector,t.id,'Terminated by the referee');App.renderCampaignPanels(sector);App.persistSector(sector);},extraButtons:function(t,cell){if(t.status==='proposed'){var b=App.appendElement(cell,'button','Reject','textbutton campaign-action');b.type='button';b.addEventListener('click',function(){SectorPolitics.respondToTreaty(sector,t.id,'reject');App.renderCampaignPanels(sector);App.persistSector(sector);});}else if(t.status==='active'){var b2=App.appendElement(cell,'button','Terminate','textbutton campaign-action');b2.type='button';b2.addEventListener('click',function(){SectorPolitics.terminateTreaty(sector,t.id,'Terminated by the referee');App.renderCampaignPanels(sector);App.persistSector(sector);});var renew=App.appendElement(cell,'button','Renew +5 turns','textbutton campaign-action');renew.type='button';renew.addEventListener('click',function(){var end=Math.max(Number(sector.factionTurn||0)+5,Number(t.endTurn||0)+5);try{SectorPolitics.renewTreaty(sector,t.id,end,'Renewed by the referee');App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}});t.parties.forEach(function(p){var breach=App.appendElement(cell,'button','Breach '+p.id,'textbutton campaign-action');breach.type='button';breach.addEventListener('click',function(){var reason=window.prompt('Record the treaty breach by '+p.id+':','Violation of treaty terms');if(reason===null)return;try{SectorPolitics.breachTreaty(sector,t.id,{type:p.type,id:p.id},reason);App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}});});}}});
	App.renderSimpleTable(document.getElementById('politics-sanctions-output'),['Sanction','Issuer → Target','Kind','Scope','Status / expiry'],sanctions.slice().sort(function(a,b){return String(b.id).localeCompare(String(a.id));}).map(function(x){return {item:x,values:[x.name||x.id,partyName(x.issuer)+' → '+partyName(x.target),x.kind,x.commodityIds.length?x.commodityIds.join(', '):'All trade',x.status+' · '+(x.endTurn?'through turn '+x.endTurn:'indefinite')]};}),{label:'Lift',callback:function(x){SectorPolitics.liftSanction(sector,x.id);App.renderCampaignPanels(sector);App.persistSector(sector);}});
	App.renderSimpleTable(document.getElementById('politics-wars-output'),['War','Parties','Status','Declared','Ceasefire until'],wars.slice().sort(function(a,b){return String(b.id).localeCompare(String(a.id));}).map(function(w){return {item:w,values:[w.id,w.parties.map(partyName).join(' ↔ '),w.status,w.declaredTurn,w.ceasefireUntilTurn||'—']};}),{label:'Ceasefire',callback:function(w){if(w.status!=='active')return;SectorPolitics.declareCeasefire(sector,w.id,{untilTurn:Number(sector.factionTurn||0)+4});App.renderCampaignPanels(sector);App.persistSector(sector);},extraButtons:function(w,cell){if(w.status==='active'||w.status==='ceasefire'){var b=App.appendElement(cell,'button','Make peace','textbutton campaign-action');b.type='button';b.addEventListener('click',function(){SectorPolitics.makePeace(sector,w.id,{settlement:'Referee-recorded peace'});App.renderCampaignPanels(sector);App.persistSector(sector);});}}});
};

App.marketDirectoryState = App.marketDirectoryState || {page:0,pageSize:12};

App.renderMarketDetail = function(sector, market, card) {
	if (!sector || !market || !card) return;
	var body = card.querySelector('.market-detail-content');
	if (!body || card.dataset.rendered === 'true') return;
	body.innerHTML = '';
	var corps=(market.linkedCorporationIds||[]).map(function(id){var c=(sector.corporations||[]).find(function(corp){return corp.id===id;});return c?c.name:'';}).filter(Boolean);
	var tagLine = App.appendElement(body, 'p', 'System: ' + market.systemName + ' · TL ' + market.techLevel + ' · ' + market.population + ' · Control: ' + (market.controlFactionName||'Independent') + ' · Routes: ' + Number(market.routeAccess||0) + ' · ' + (market.stability||'Unsimulated'), 'market-context');
	if (corps.length) tagLine.appendChild(document.createTextNode(' · Corporate links: ' + corps.join(', ')));
	if (market.traits && market.traits.length) tagLine.appendChild(document.createTextNode(' · Tags: ' + market.traits.join(', ')));
	var marketActions = App.appendElement(body, 'div', null, 'story-controls');
	var marketEdit = App.appendElement(marketActions, 'button', 'Edit market', 'textbutton campaign-action');
	marketEdit.type = 'button'; marketEdit.addEventListener('click', function() {
		var planetOptions = [];
		(sector.systems || []).forEach(function(sys) { (sys.planets || []).forEach(function(p) { planetOptions.push(p.id); }); });
		App.editCampaignObject('Edit market: ' + market.planetName, market, ['id','systemId','goods','traits'], function() { CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector, sector.factionTurn || 0); App.renderCampaignPanels(sector); App.persistSector(sector); }, {planetId:planetOptions});
	});
	var viewSystem = App.appendElement(marketActions, 'button', 'View system', 'textbutton campaign-action');
	viewSystem.type = 'button'; viewSystem.addEventListener('click', function() { App.focusSystem(market.systemId); });
	var viewWorld = App.appendElement(marketActions, 'button', 'Locate world', 'textbutton campaign-action');
	viewWorld.type = 'button'; viewWorld.addEventListener('click', function() { if (!App.focusWorld(market.planetId, market.systemId)) App.focusSystem(market.systemId); });
	var marketTableWrap = App.appendElement(body, 'div', null, 'table-output market-table-wrap');
	var economicState = typeof SectorEconomy !== 'undefined' ? SectorEconomy.getMarketState(sector, market.id) : null;
	function economicValues(good) {
		if (!economicState) return ['—','—','—','Not initialized'];
		var commodityId = String(good.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		var stock = (economicState.inventory || []).find(function(item) { return item.commodityId === commodityId; });
		var production = (economicState.production || []).find(function(item) { return item.commodityId === commodityId; });
		var consumption = (economicState.consumption || []).find(function(item) { return item.commodityId === commodityId; });
		if (!stock) return ['—','—','—','No account'];
		var available = Math.max(0, Number(stock.onHand || 0) - Number(stock.reserved || 0));
		return [available.toFixed(2) + ' / ' + Number(stock.targetStock || 0).toFixed(2), Number(production && production.quantityPerTurn || 0).toFixed(2), Number(consumption && consumption.quantityPerTurn || 0).toFixed(2), available < Number(stock.targetStock || 0) * 0.3 ? 'Critical' : available < Number(stock.targetStock || 0) ? 'Below target' : available > Number(stock.targetStock || 0) * 1.5 ? 'Surplus' : 'Adequate'];
	}
	App.renderSimpleTable(marketTableWrap, ['Good','Category','Supply','Index','Local price','Stock / target','Produced / turn','Consumed / turn','Note'], (market.goods || []).map(function(g) {
		var economy = economicValues(g);
		return {item:g, values:[g.name, g.category, g.supply, g.priceIndex + '%', Number(g.localPrice || 0).toLocaleString() + ' cr', economy[0], economy[1], economy[2], App.formatArchiveText(g.note) + (economicState ? ' · ' + economy[3] : '')]};
	}), {label:'Edit', callback:function(good) { App.editCampaignObject('Edit market good: ' + good.name, good, ['basePriceIndex','marketStructuralModifier','previousPriceIndex'], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); }, extraButtons:function(good, cell) {
		if (!economicState) return;
		var commodityId = String(good.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		var stock = (economicState.inventory || []).find(function(item) { return item.commodityId === commodityId; });
		var production = (economicState.production || []).find(function(item) { return item.commodityId === commodityId; });
		var consumption = (economicState.consumption || []).find(function(item) { return item.commodityId === commodityId; });
		function operation(label, title, callback) { var button = App.appendElement(cell, 'button', label, 'textbutton campaign-action'); button.type = 'button'; button.title = title; button.addEventListener('click', callback); }
		if (stock) operation('Stock', 'Set local stock, target stock, and storage capacity', function() { App.editCampaignObject('Edit stock: ' + good.name + ' · ' + market.planetName, stock, ['commodityId','reserved','source','lastTurn','fieldOverrides'], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); });
		operation(production ? 'Output' : 'Set output', 'Set local production per turn', function() { if (!production) { production = {commodityId:commodityId, quantityPerTurn:0, generatedQuantityPerTurn:0, source:'manual', reason:'GM-authored production schedule'}; economicState.production.push(production); } App.editCampaignObject('Edit production: ' + good.name + ' · ' + market.planetName, production, ['commodityId','source','reason','fieldOverrides'], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); });
		operation(consumption ? 'Demand' : 'Set demand', 'Set local consumption per turn', function() { if (!consumption) { consumption = {commodityId:commodityId, quantityPerTurn:0, generatedQuantityPerTurn:0, source:'manual', reason:'GM-authored consumption schedule'}; economicState.consumption.push(consumption); } App.editCampaignObject('Edit demand: ' + good.name + ' · ' + market.planetName, consumption, ['commodityId','source','reason','fieldOverrides'], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); });
		operation('Auto', 'Release this commodity back to automatic market pricing and stock flow', function() {
			if (typeof SectorSimulation !== 'undefined') {
				if (stock) SectorSimulation.clearFieldOverride(stock, 'onHand');
				SectorSimulation.clearFieldOverride(good, 'priceIndex'); SectorSimulation.clearFieldOverride(good, 'localPrice');
				if (production) { production.quantityPerTurn = Number(production.generatedQuantityPerTurn || 0); SectorSimulation.clearFieldOverride(production, 'quantityPerTurn'); }
				if (consumption) { consumption.quantityPerTurn = Number(consumption.generatedQuantityPerTurn || 0); SectorSimulation.clearFieldOverride(consumption, 'quantityPerTurn'); }
			}
			App.renderCampaignPanels(sector); App.persistSector(sector);
		});
	}});
	card.dataset.rendered = 'true';
};

App.renderMarketDirectory = function(sector) {
	var container = document.getElementById('markets-output');
	if (!container) return;
	var state = App.marketDirectoryState || (App.marketDirectoryState = {page:0,pageSize:12});
	var search = document.getElementById('market-search');
	var query = String(search && search.value || '').trim().toLowerCase();
	var previousOpen = container.querySelector('.market-card[open]');
	var previousOpenId = previousOpen ? String(previousOpen.dataset.marketId || '') : '';
	var allMarkets = Array.isArray(sector.markets) ? sector.markets : [];
	var matches = allMarkets.filter(function(market) {
		if (!query) return true;
		var goodNames = (market.goods || []).map(function(g) { return [g.name,g.category,g.supply,g.note].map(function(value) { return App.formatArchiveText(value); }).join(' '); }).join(' ');
		return [market.id,market.planetName,market.systemName,market.profile,market.population,market.techLevel,market.controlFactionName,(market.traits||[]).join(' '),goodNames].map(function(value) { return App.formatArchiveText(value); }).join(' ').toLowerCase().indexOf(query) >= 0;
	});
	var pageSize = Math.max(1, Number(state.pageSize || 12)), pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
	state.page = Math.max(0, Math.min(Number(state.page || 0), pageCount - 1));
	var visible = matches.slice(state.page * pageSize, (state.page + 1) * pageSize);
	container.innerHTML = '';
	visible.forEach(function(market) {
		var details = App.appendElement(container, 'details', null, 'market-card');
		details.dataset.marketId = market.id; details.name = 'sector-forge-market-detail';
		var summary = App.appendElement(details, 'summary', null, 'market-summary');
		App.appendElement(summary, 'span', market.planetName || market.id, 'market-world');
		App.appendElement(summary, 'span', (market.profile || 'Market') + ' · ' + (market.goods || []).length + ' goods', 'market-meta');
		App.appendElement(details, 'p', [market.systemName, 'TL ' + (market.techLevel || '—'), market.population || 'Population unknown', 'Control: ' + (market.controlFactionName || 'Independent'), 'Routes: ' + Number(market.routeAccess || 0)].join(' · '), 'market-card-preview');
		var body = App.appendElement(details, 'div', null, 'market-detail-content');
		details.addEventListener('toggle', function() {
			if (details.open) {
				Array.from(container.querySelectorAll('.market-card[open]')).forEach(function(other) { if (other !== details) other.open = false; });
				App.renderMarketDetail(sector, market, details);
			} else if (body) { body.innerHTML = ''; delete details.dataset.rendered; }
		});
		if (String(market.id) === previousOpenId) { details.open = true; App.renderMarketDetail(sector, market, details); }
	});
	if (!visible.length) App.appendElement(container, 'p', query ? 'No markets match this search.' : 'No markets generated for this sector.', 'empty-note');
	var status = document.getElementById('market-browser-status');
	if (status) status.textContent = matches.length ? 'Showing ' + (state.page * pageSize + 1) + '–' + Math.min(matches.length, (state.page + 1) * pageSize) + ' of ' + matches.length + ' markets · ' + allMarkets.length + ' total' : '0 matching markets · ' + allMarkets.length + ' total';
	var previous = document.getElementById('market-page-prev'), next = document.getElementById('market-page-next');
	if (previous) { previous.disabled = state.page <= 0; if (!previous.dataset.bound) { previous.dataset.bound='true'; previous.addEventListener('click', function() { state.page=Math.max(0,state.page-1); App.renderMarketDirectory(App.currentSector || sector); }); } }
	if (next) { next.disabled = state.page >= pageCount - 1; if (!next.dataset.bound) { next.dataset.bound='true'; next.addEventListener('click', function() { state.page=Math.min(pageCount-1,state.page+1); App.renderMarketDirectory(App.currentSector || sector); }); } }
	if (search && !search.dataset.bound) { search.dataset.bound='true'; search.addEventListener('input', function() { state.page=0; App.renderMarketDirectory(App.currentSector || sector); }); }
};

App.renderCampaignPanels = function(sector) {
	App.displayCorporationDirectory(sector);
	var status = document.getElementById('faction-turn-status');
	if (status) status.textContent = 'Faction turn ' + (sector.factionTurn || 0) + ' · ' + (sector.factions || []).length + ' active factions';
	App.renderSimpleTable(document.getElementById('factions-output'),
		['Faction','Type','Scale','Force','Cunning','Wealth','HP','FacCreds','Goal','Homeworld','Assets'],
		(sector.factions || []).map(function(f) { return {item:f, values:[f.name, f.type, f.scale, f.force, f.cunning, f.wealth, f.hitPoints + '/' + f.maxHitPoints, f.factionCredits, f.goal, f.homeworld, (f.assets || []).length]}; }),
		{label:'Edit', callback:function(f) {
			var homeworldOptions = [''].concat((sector.systems || []).map(function(system) { return system.id; }));
			App.editCampaignObject('Edit faction: ' + f.name, f, ['id','assets','rivals','turnLog','lastAction','schemaVersion'], function() {
				var home = (sector.systems || []).find(function(system) { return system.id === f.homeworldSystemId; });
				f.homeworld = home ? home.name : 'Unplaced';
				(f.assets || []).filter(function(asset) { return asset.isBase || asset.type === 'Base of Influence'; }).forEach(function(asset) { asset.locationSystemId = home ? home.id : ''; asset.location = home ? home.name : 'Unplaced'; });
				CampaignTools.recalculateInfluence(sector); CampaignTools.ensureDiplomacy(sector);
				App.renderCampaignPanels(sector); App.displayHexmap(sector);
			}, {homeworldSystemId:homeworldOptions});
		}});
	var assets = [];
	(sector.factions || []).forEach(function(faction) {
		(faction.assets || []).forEach(function(asset) {
			assets.push({item:asset, owner:faction, values:[faction.name, asset.name, asset.type, asset.stat || '—', asset.rating != null && typeof asset.rating === 'number' ? asset.rating : (faction[asset.stat] || '—'), asset.hp + '/' + (asset.maxHp || asset.hp), asset.maintenance || 0, Number(asset.readyOnTurn || 0) > Number(sector.factionTurn || 0) ? 'Commissioning' : (asset.active === false ? 'Inactive' : 'Active'), asset.location || 'Unplaced']});
		});
	});
	App.renderSimpleTable(document.getElementById('assets-output'), ['Owner','Asset','Class','Primary stat','Rating','HP','Upkeep','Readiness','Location'], assets.map(function(row) { return {item:row.item, owner:row.owner, values:row.values}; }), {label:'Edit', callback:function(asset) {
		var owner = (sector.factions || []).find(function(faction) { return (faction.assets || []).some(function(candidate) { return candidate.id === asset.id; }); });
		var systemNames = (sector.systems || []).map(function(system) { return system.name; });
		App.editCampaignObject('Edit asset: ' + asset.name, asset, ['id','ownerFactionId','locationSystemId','maxHp','readyOnTurn','missedMaintenance','isBase','schemaVersion'], function() {
			var destination = (sector.systems || []).find(function(system) { return system.name === asset.location; });
			if (destination) asset.locationSystemId = destination.id;
			if (owner && asset.rating != null && typeof asset.rating !== 'number') asset.rating = Number(owner[asset.stat] || 0);
			App.renderCampaignPanels(sector);
		}, {location:['Unplaced'].concat(systemNames)});
	}, extraButtons:function(asset, cell) {
		function addOp(label, title, callback) { var b=App.appendElement(cell, 'button', label, 'textbutton campaign-action asset-op'); b.type='button'; b.title=title; b.addEventListener('click', callback); }
		addOp('Move', 'Move this asset to the next system', function() {
			var systems=sector.systems||[]; if(!systems.length)return; var at=systems.findIndex(function(s){return s.id===asset.locationSystemId;}); var next=systems[(at+1+systems.length)%systems.length]; asset.locationSystemId=next.id;asset.location=next.name;CampaignTools.recalculateInfluence(sector);CampaignTools.linkCampaignRecords(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.displayHexmap(sector);App.persistSector(sector);
		});
		addOp(asset.active===false?'Activate':'Stand down', 'Toggle readiness of this asset', function() {
			if(Number(asset.readyOnTurn||0)>Number(sector.factionTurn||0)){window.alert('This asset is still commissioning and becomes ready on turn '+asset.readyOnTurn+'.');return;}
			asset.active=asset.active===false;CampaignTools.recalculateInfluence(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.displayHexmap(sector);App.persistSector(sector);
		});
		addOp('Repair', 'Spend 1 FacCred to repair up to 2 HP', function() {
			var owner=(sector.factions||[]).find(function(f){return f.id===asset.ownerFactionId;});if(!owner||Number(asset.hp)>=Number(asset.maxHp||asset.hp)){window.alert('This asset is already at full strength.');return;}if(Number(owner.factionCredits||0)<1){window.alert('The faction needs at least 1 FacCred to repair this asset.');return;}
			var healed=Math.min(2,Number(asset.maxHp||asset.hp)-Number(asset.hp));asset.hp=Number(asset.hp)+healed;owner.factionCredits=Number(owner.factionCredits)-1;if(asset.isBase)owner.hitPoints=Math.min(Number(owner.maxHitPoints||owner.hitPoints),Number(owner.hitPoints||0)+healed);CampaignTools.recalculateInfluence(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.persistSector(sector);
		});
	}});
	App.renderStoryCards(document.getElementById('faction-news'), (sector.factionNews || []).slice(0, 6), {
		kicker:function(e) { return 'TURN ' + e.turn + ' / ' + e.result.toUpperCase(); }, title:'factionName', summary:'event',
		fields:[{key:'systemName',label:'System'},{key:'action',label:'Action'},{key:'roll',label:'Roll'}]
	});
	var newsElem = document.getElementById('faction-news');
	if (!(sector.factionNews || []).length) newsElem.innerHTML = '<p class="empty-note">No faction turn has been advanced yet. Start one to generate sector news.</p>';
	App.renderFactionTurnHistory(sector);

	App.renderSimpleTable(document.getElementById('diplomacy-output'), ['Faction A','Relationship','Faction B','Trust','Tension','Latest development'], (sector.diplomacy || []).map(function(rel) {
		var a=(sector.factions||[]).find(function(f){return f.id===rel.factionAId;})||{};
		var b=(sector.factions||[]).find(function(f){return f.id===rel.factionBId;})||{};
		return {item:rel,values:[a.name||rel.factionAId,rel.state,b.name||rel.factionBId,rel.trust,rel.tension,rel.lastEvent||'No recent change']};
	}), {
		label:'Edit',
		callback:function(rel){
			var before={state:rel.state,trust:Number(rel.trust||0),tension:Number(rel.tension||0),lastEvent:rel.lastEvent||''};
			App.editCampaignObject('Edit diplomatic relationship',rel,['id','factionAId','factionBId'],function(){
				if(CampaignTools.DIPLOMACY_STATES.indexOf(rel.state)<0)rel.state='Neutral';
				rel.trust=Math.max(-6,Math.min(6,Math.round(Number(rel.trust)||0)));
				rel.tension=Math.max(0,Math.min(10,Math.round(Number(rel.tension)||0)));
				rel.tradeAccess=['automatic','preferred','open','restricted','embargoed'].indexOf(rel.tradeAccess)<0?'automatic':rel.tradeAccess;
				rel.tradeTariffPercent=Math.max(-1,Math.min(100,Number(rel.tradeTariffPercent)||0));
				rel.embargoCommodityIds=String(rel.embargoCommodityIds||'').trim();
				if((rel.state!==before.state||rel.trust!==before.trust||rel.tension!==before.tension)&&(!rel.lastEvent||rel.lastEvent===before.lastEvent))rel.lastEvent='Relationship manually adjusted by the referee';
				CampaignTools.syncDiplomacyRivals(sector,rel);
				CampaignTools.recalculateInfluence(sector);CampaignTools.linkCampaignRecords(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);
				App.renderCampaignPanels(sector);App.displayHexmap(sector);
			},{state:CampaignTools.DIPLOMACY_STATES.slice(),tradeAccess:['automatic','preferred','open','restricted','embargoed']});
		},
		extraButtons:function(rel,cell){
			var button=App.appendElement(cell,'button','Change posture','textbutton campaign-action diplomacy-shift-action');button.type='button';
			button.addEventListener('click',function(){CampaignTools.cycleDiplomacy(sector,rel);CampaignTools.recalculateInfluence(sector);CampaignTools.linkCampaignRecords(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.displayHexmap(sector);App.persistSector(sector);});
		}
	});

	App.renderSimpleTable(document.getElementById('influence-output'), ['System','Hex','Controller','Influence','Status','Trade links','Markets'], (sector.systems||[]).map(function(sys){
		var top=(sys.factionInfluence||[])[0];var routes=(sector.tradeRoutes||[]).filter(function(r){return r.fromSystemId===sys.id||r.toSystemId===sys.id;}).length;var markets=(sector.markets||[]).filter(function(m){return m.systemId===sys.id;}).length;
		return {item:sys,values:[sys.name,String(sys.x).padStart(2,'0')+String(sys.y).padStart(2,'0'),sys.controllingFactionName||'Independent',top?top.score:'—',sys.isContested?'Contested':(sys.controllingFactionId?'Controlled':'Open'),routes,markets]};
	}), {label:'Change control',callback:function(sys){
		var factions=sector.factions||[];var current=sys.manualControllerFactionId||'';var index=factions.findIndex(function(f){return f.id===current;});sys.manualControllerFactionId=index<0?(factions[0]?factions[0].id:''):((index+1)<factions.length?factions[index+1].id:'');
		if(!sys.manualControllerFactionId)delete sys.manualControllerFactionId;CampaignTools.recalculateInfluence(sector);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.displayHexmap(sector);App.persistSector(sector);
	}});
	App.renderStoryCards(document.getElementById('polities-output'), sector.polities || [], {
		kicker:'government', title:'name', summary:function(p) { return 'Capital: ' + ((sector.systems || []).find(function(s) { return s.id === p.capitalSystemId; }) || {name:'Unknown'}).name + ' · ' + (p.memberSystemIds || []).length + ' claimed systems'; },
		fields:[{key:'policy',label:'Strategic priority'},{key:'stability',label:'Stability'},{value:function(p) { return (p.relations || []).map(function(r) { return r.type; }); },label:'Relations'}],
		edit:function(polity) { App.editCampaignObject('Edit polity: ' + polity.name, polity, ['id','memberSystemIds','capitalSystemId','relations'], function() { App.renderCampaignPanels(sector); }); }
	});
	App.renderPoliticsPanel(sector);
	App.renderChronicle(sector);
	App.renderSimpleTable(document.getElementById('routes-output'), ['Route','From','To','Hexes','Type','Status','Cargo capacity / turn','Transit','Freight / cargo unit','Toll / cargo unit','Operating cost / cargo unit','Risk'], (sector.tradeRoutes || []).map(function(route) {
		var from = (sector.systems || []).find(function(s) { return s.id === route.fromSystemId; }) || {};
		var to = (sector.systems || []).find(function(s) { return s.id === route.toSystemId; }) || {};
		var profile = typeof SectorLogistics !== 'undefined' ? SectorLogistics.getRouteProfile(route, sector) : {capacityPerTurn:'—',transitTurns:'—',freightCostPerUnit:'—',tollPerUnit:'—',operatingCostPerUnit:'—',riskPercent:'—'};
		return {item:route, values:[route.id, from.name || route.fromSystemId, to.name || route.toSystemId, route.distance, route.kind, route.topologyStatus === 'Overextended' ? 'Overextended · ' + route.status : route.status, profile.capacityPerTurn, profile.transitTurns + ' turns', profile.freightCostPerUnit, profile.tollPerUnit, profile.operatingCostPerUnit, profile.riskPercent + '%']};
	}), {label:'Configure', callback:function(route) {
		var profile = SectorLogistics.getRouteProfile(route, sector);
		var draft = Object.assign({}, route, {capacityPerTurn:profile.capacityPerTurn, transitTurns:profile.transitTurns, freightCostPerUnit:profile.freightCostPerUnit, tollPerUnit:profile.tollPerUnit, operatingCostPerUnit:profile.operatingCostPerUnit, riskPercent:profile.riskPercent, direction:profile.direction});
		App.editCampaignObject('Configure logistics: ' + route.id, draft, ['id','distance','source','manualOverride','isManual','topologyStatus'], function() {
			['fromSystemId','toSystemId','capacityPerTurn','transitTurns','freightCostPerUnit','tollPerUnit','operatingCostPerUnit','riskPercent','direction','ownerFactionId','operatorFactionId','ownerCorporationId','operatorCorporationId'].forEach(function(field) { route[field]=draft[field]; if (draft[field] === '' || draft[field] == null) { delete route[field]; if (typeof SectorSimulation !== 'undefined') SectorSimulation.clearFieldOverride(route, field); } else if (typeof SectorSimulation !== 'undefined') SectorSimulation.setFieldOverride(route, field, draft[field]); });
			var from=(sector.systems||[]).find(function(s){return s.id===route.fromSystemId;}), to=(sector.systems||[]).find(function(s){return s.id===route.toSystemId;}); if(from&&to)route.distance=CampaignTools.hexDistance(from,to); route.source='manual'; route.manualOverride=true;
			CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector,sector.factionTurn||0); if (typeof SectorSimulation !== 'undefined') SectorSimulation.refreshDerivedState(sector); App.renderCampaignPanels(sector); App.displayHexmap(sector);
		}, {fromSystemId:(sector.systems||[]).map(function(s){return s.id;}),toSystemId:(sector.systems||[]).map(function(s){return s.id;}),direction:['both','forward','reverse'],ownerFactionId:[''].concat((sector.factions||[]).map(function(f){return f.id;})),operatorFactionId:[''].concat((sector.factions||[]).map(function(f){return f.id;})),ownerCorporationId:[''].concat((sector.corporations||[]).map(function(c){return c.id;})),operatorCorporationId:[''].concat((sector.corporations||[]).map(function(c){return c.id;}))});
	}});

	var routeStatus = document.getElementById('route-status');
	if (routeStatus) routeStatus.textContent = (sector.tradeRoutes || []).length + ' links · maximum 3-hex normal drill';
	var economyStatus = document.getElementById('economy-status');
	if (economyStatus && typeof SectorEconomy !== 'undefined') {
		var economySummary = SectorEconomy.getSummary(sector);
		economyStatus.textContent = economySummary.initialized ? ('Turn ' + economySummary.turn + ' · ' + economySummary.marketCount + ' markets · ' + economySummary.commodityAccounts + ' commodity accounts · ' + economySummary.severeShortages + ' critical shortages') : 'Local economy not initialized';
	}
	var logisticsStatus = document.getElementById('logistics-status');
	var shipmentsOutput = document.getElementById('shipments-output');
	if (typeof SectorLogistics !== 'undefined' && SectorEconomy && SectorEconomy.isInitialized && SectorEconomy.isInitialized(sector)) {
		var logisticsSummary = SectorLogistics.getSummary(sector);
		if (logisticsStatus) logisticsStatus.textContent = 'Turn ' + logisticsSummary.turn + ' · ' + logisticsSummary.inTransit + ' in transit · ' + logisticsSummary.awaitingCapacity + ' awaiting capacity · ' + logisticsSummary.awaitingStorage + ' awaiting storage · ' + logisticsSummary.delivered + ' delivered · ' + (logisticsSummary.archived || 0) + ' archived shipment summaries';
		var marketNames = new Map((sector.markets||[]).map(function(m) { return [String(m.id),m.planetName||m.id]; }));
		var shipmentRows = SectorLogistics.getShipments(sector).slice().sort(function(a,b) { return String(b.id).localeCompare(String(a.id)); }).slice(0,100).map(function(shipment) {
			var routeLabel = (shipment.routeIds||[]).join(' → ') || 'No route';
			var progress = (shipment.legs||[]).filter(function(leg) { return leg.status === 'arrived'; }).length + ' / ' + (shipment.routeIds||[]).length + ' legs';
			return {item:shipment, values:[shipment.id, shipment.commodityId, marketNames.get(String(shipment.originMarketId))||shipment.originMarketId, marketNames.get(String(shipment.destinationMarketId))||shipment.destinationMarketId, Number(shipment.quantity||0).toFixed(2), Number(shipment.cargoUnits||0).toFixed(2), shipment.status, progress, shipment.estimatedArrivalTurn == null ? '—' : 'Turn ' + shipment.estimatedArrivalTurn, Number(shipment.saleUnitPriceCr||0).toFixed(2) + ' Cr/lot', Number(shipment.commodityPaidCr||0).toFixed(2) + ' Cr', (Number(shipment.freightCost||0)+Number(shipment.tollCost||0)+Number(shipment.tariffCost||0)).toFixed(2) + ' Cr', Number(shipment.operatingCost||0).toFixed(2) + ' Cr', shipment.contractId || 'Spot trade', shipment.delayReason||'—']};
		});
		App.renderSimpleTable(shipmentsOutput, ['Shipment','Commodity','Origin','Destination','Lots','Cargo units','Status','Progress','ETA','Sale price / lot','Goods paid','Freight + toll + tariff','Route operating cost','Contract','Notes'], shipmentRows, null);
	} else {
		if (logisticsStatus) logisticsStatus.textContent = 'Initialize the local economy to enable automatic interstellar shipments.';
		if (shipmentsOutput) shipmentsOutput.innerHTML = '<p class="empty-note">No logistics simulation yet.</p>';
	}

	var financeOutput = document.getElementById('finance-output');
	var financeStatus = document.getElementById('finance-status');
	if (typeof SectorSettlement !== 'undefined' && SectorEconomy && SectorEconomy.isInitialized && SectorEconomy.isInitialized(sector)) {
		var finSummary = SectorSettlement.getSummary(sector);
		if (financeStatus) { var commodityPurchases = SectorSettlement.getLedger(sector).filter(function(tx) { return tx.type === 'commodity-purchase'; }).reduce(function(n,tx) { return n + Number(tx.amount||0); },0); financeStatus.textContent = finSummary.accounts + ' accounts · ' + finSummary.transactions + ' settlements (' + (finSummary.archivedTransactions || 0) + ' archived) · ' + finSummary.totalCreditsTransferred.toLocaleString() + ' Cr transferred · ' + commodityPurchases.toLocaleString() + ' Cr retained-ledger commodity purchases · ' + finSummary.debtAccounts + ' accounts in deficit'; }
		App.renderSimpleTable(financeOutput, ['Account','Type','Balance (Cr)','Overdraft warning (Cr)','Source'], SectorSettlement.getAccounts(sector).map(function(account) { return {item:account, values:[account.name,account.ownerType,Number(account.balance||0).toLocaleString(),Number(account.creditLimit||0).toLocaleString(),account.source]}; }), {label:'Edit', callback:function(account) { App.editCampaignObject('Edit financial account: ' + account.name, account, ['id','ownerType','ownerId','currency','openingBalance','source','createdAtTurn','lastTransactionTurn','balance','creditLimit','active'], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); }});
	} else { if (financeStatus) financeStatus.textContent = 'Initialize the local economy to enable commercial settlement.'; if (financeOutput) financeOutput.innerHTML = '<p class="empty-note">No financial accounts yet.</p>'; }
	var strategicOutput = document.getElementById('strategic-output');
	var strategicStatus = document.getElementById('strategic-status');
	if (typeof SectorStrategic !== 'undefined' && sector.simulation && sector.simulation.strategy) {
		var strategicRows = SectorStrategic.getFactionReports(sector).map(function(report) { var decision=report.decision||{};return {item:report, values:[report.factionName,'Faction · '+report.priority,report.controlledMarkets,report.criticalShortages,report.otherShortages,report.surplusAccounts,decision.action||'Awaiting decision',decision.reason||report.directive,report.summary]}; });
		SectorStrategic.getCorporateReports(sector).forEach(function(report) { var decision=report.decision||{};strategicRows.push({item:report, values:[report.corporationName,'Corporate · '+report.outlook,report.linkedMarkets,report.criticalShortages,report.otherShortages,report.surplusAccounts,decision.action||'Hold capital',decision.reason||report.summary,report.summary]}); });
		App.renderSimpleTable(strategicOutput, ['Organization','Priority / outlook','Markets','Critical','Other shortage','Surplus','Latest action','Decision rationale','Assessment'], strategicRows, null);
		if(strategicStatus){var aiSettings=sector.simulation&&sector.simulation.settings&&sector.simulation.settings.strategicAI||{factionAutonomy:true,factionPoliticalAutonomy:true,corporateAutonomy:true,decisionNoise:0.16};strategicStatus.textContent=(aiSettings.factionAutonomy?'Faction AI on':'Faction AI off')+' · '+(aiSettings.factionPoliticalAutonomy!==false?'Political AI on':'Political AI off')+' · '+(aiSettings.corporateAutonomy?'Corporate AI on':'Corporate AI off')+' · uncertainty '+Math.round(Number(aiSettings.decisionNoise||0)*100)+'%';}
	} else {if (strategicOutput) strategicOutput.innerHTML = '<p class="empty-note">Strategic assessments appear after the next economy-enabled campaign turn.</p>';if(strategicStatus)strategicStatus.textContent='Actor decisions begin when the local economy is initialized.';}
	var strategicSettingsButton=document.getElementById('strategic-settings-edit');
	if(strategicSettingsButton&&!strategicSettingsButton.dataset.bound){strategicSettingsButton.dataset.bound='true';strategicSettingsButton.addEventListener('click',function(){var activeSector=App.currentSector||sector;if(typeof SectorStrategic==='undefined'||!activeSector)return;var draft=Object.assign({},SectorStrategic.getSettings(activeSector));App.editCampaignObject('Configure strategic actor autonomy',draft,[],function(){SectorStrategic.setSettings(activeSector,draft);App.renderCampaignPanels(activeSector);App.persistSector(activeSector);},{ });});}

	var transportStatus=document.getElementById('transport-status');
	var transportPortsOutput=document.getElementById('transport-ports-output');
	var transportFleetsOutput=document.getElementById('transport-fleets-output');
	if(typeof SectorTransport!=='undefined'&&sector.simulation&&sector.simulation.transport){
		var transportSummary=SectorTransport.getSummary(sector),portRows=SectorTransport.getPorts(sector).map(function(port){var sys=(sector.systems||[]).find(function(x){return String(x.id)===String(port.systemId);})||{};return {item:port,values:[port.name,sys.name||port.systemId,port.level,Number(port.handlingCapacityPerTurn||0).toFixed(1),Number(port.warehouseCapacity||0).toFixed(0),Number(port.condition||0)+'%',port.status,port.ownerType==='faction'?((sector.factions||[]).find(function(f){return f.id===port.ownerId;})||{}).name||port.ownerId:port.ownerType==='corporation'?((sector.corporations||[]).find(function(c){return c.id===port.ownerId;})||{}).name||port.ownerId:(port.ownerType||'independent')]};});
		App.renderSimpleTable(transportPortsOutput,['Port','System','Level','Handling / turn','Warehouse','Condition','Status','Operator'],portRows,{label:'Configure',callback:function(port){var draft=Object.assign({},port);App.editCampaignObject('Configure spaceport: '+port.name,draft,['id','systemId','source','createdTurn','lastMaintenanceTurn'],function(){port.name=String(draft.name||port.name);port.level=Math.max(1,Math.min(5,Math.round(Number(draft.level)||1)));port.handlingCapacityPerTurn=Math.max(0,Number(draft.handlingCapacityPerTurn)||0);port.warehouseCapacity=Math.max(0,Number(draft.warehouseCapacity)||0);port.condition=Math.max(0,Math.min(100,Number(draft.condition)||0));port.status=draft.status==='closed'?'closed':'operational';port.ownerType=draft.ownerType||'independent';port.ownerId=String(draft.ownerId||'');port.maintenanceCrPerTurn=Math.max(0,Number(draft.maintenanceCrPerTurn)||0);if(typeof SectorSimulation!=='undefined')['level','handlingCapacityPerTurn','warehouseCapacity','condition','status','ownerType','ownerId','maintenanceCrPerTurn'].forEach(function(k){SectorSimulation.setFieldOverride(port,k,port[k]);});App.renderCampaignPanels(sector);App.persistSector(sector);},{status:['operational','closed'],ownerType:['independent','faction','corporation','service'],ownerId:['','INTERSTELLAR-GUILD','INTERSTELLAR-INFRASTRUCTURE','CUSTOMS-AUTHORITY','INDEPENDENT-PORTS'].concat((sector.factions||[]).map(function(f){return f.id;}),(sector.corporations||[]).map(function(c){return c.id;}))});}});
		var fleetRows=SectorTransport.getFleets(sector).map(function(fleet){var owner=fleet.ownerType==='faction'?((sector.factions||[]).find(function(x){return x.id===fleet.ownerId;})||{}).name:fleet.ownerType==='corporation'?((sector.corporations||[]).find(function(x){return x.id===fleet.ownerId;})||{}).name:fleet.ownerId;var assigned=(fleet.assignments||[]).map(function(a){return a.routeId+' ('+a.allocationPercent+'%)';}).join(', ')||'Unassigned';return {item:fleet,values:[fleet.name,owner||fleet.ownerId,fleet.type,Number(fleet.capacityPerTurn||0).toFixed(1),Number(fleet.speed||1).toFixed(2)+'×',Number(fleet.reliability||0)+'%',Number(fleet.condition||0)+'%',assigned,fleet.status,Number(fleet.operatingCostCrPerTurn||0).toLocaleString()+' Cr / turn']};});
		App.renderSimpleTable(transportFleetsOutput,['Fleet','Owner','Type','Capacity','Speed','Reliability','Condition','Route assignments','Status','Operating cost'],fleetRows,{label:'Edit',callback:function(fleet){var draft=Object.assign({},fleet);App.editCampaignObject('Edit transport fleet: '+fleet.name,draft,['id','assignments','createdTurn','source','missedMaintenance','lastMaintenanceTurn','lastMaintenanceTransactionId'],function(){var result=SectorTransport.updateFleet(sector,fleet.id,draft);if(!result.ok)window.alert(result.reason);App.renderCampaignPanels(sector);App.persistSector(sector);},{ownerType:['faction','corporation','service','independent'],ownerId:['','INTERSTELLAR-GUILD','INTERSTELLAR-INFRASTRUCTURE','CUSTOMS-AUTHORITY','INDEPENDENT-FLEET'].concat((sector.factions||[]).map(function(f){return f.id;}),(sector.corporations||[]).map(function(c){return c.id;})),homeSystemId:[''].concat((sector.systems||[]).map(function(s){return s.id;})),status:['operational','financially-stressed','retired']});},extraButtons:function(fleet,cell){var assign=App.appendElement(cell,'button','Assign route','textbutton campaign-action');assign.type='button';assign.addEventListener('click',function(){var routeList=(sector.tradeRoutes||[]).map(function(r){return r.id;});if(!routeList.length)return;var chosen=window.prompt('Enter route ID for '+fleet.name+':\n'+routeList.join(', '),routeList[0]);if(!chosen)return;var result=SectorTransport.assignFleetToRoute(sector,fleet.id,chosen,100);if(!result.ok)window.alert(result.reason);App.renderCampaignPanels(sector);App.persistSector(sector);});var retire=App.appendElement(cell,'button',fleet.status==='retired'?'Retired':'Retire','textbutton campaign-action');retire.type='button';retire.disabled=fleet.status==='retired';retire.addEventListener('click',function(){if(!window.confirm('Retire '+fleet.name+'?'))return;SectorTransport.retireFleet(sector,fleet.id);App.renderCampaignPanels(sector);App.persistSector(sector);});}});
		if(transportStatus)transportStatus.textContent=transportSummary.ports+' ports · '+transportSummary.operationalPorts+' operational · '+transportSummary.fleets+' fleets · '+transportSummary.activeFleets+' active · '+transportSummary.assignedFleets+' assigned · turn '+transportSummary.turn;
	}else{if(transportStatus)transportStatus.textContent='Initialize the local economy to commission and manage transport infrastructure.';if(transportPortsOutput)transportPortsOutput.innerHTML='<p class="empty-note">Spaceports appear when the local economy is initialized.</p>';if(transportFleetsOutput)transportFleetsOutput.innerHTML='<p class="empty-note">No commissioned fleets yet.</p>';}
	var addFleetButton=document.getElementById('transport-fleet-add');
	if(addFleetButton&&!addFleetButton.dataset.bound){addFleetButton.dataset.bound='true';addFleetButton.addEventListener('click',function(){var activeSector=App.currentSector||sector;if(typeof SectorTransport==='undefined'||!activeSector||!activeSector.simulation||!activeSector.simulation.transport){window.alert('Initialize the local economy first.');return;}var ownerOptions=['','INTERSTELLAR-GUILD','INTERSTELLAR-INFRASTRUCTURE','CUSTOMS-AUTHORITY','INDEPENDENT-FLEET'].concat((activeSector.factions||[]).map(function(f){return f.id;}),(activeSector.corporations||[]).map(function(c){return c.id;}));var draft={name:'New Merchant Flotilla',type:'Merchant flotilla',ownerType:'corporation',ownerId:(activeSector.corporations||[])[0]&&(activeSector.corporations||[])[0].id||'',homeSystemId:'',capacityPerTurn:16,speed:1,reliability:90,condition:100,operatingCostCrPerTurn:200,variableCostPerCargoUnit:0.03,status:'operational',readyOnTurn:Number(activeSector.factionTurn||0),notes:''};App.editCampaignObject('Commission transport fleet',draft,[],function(){var result=SectorTransport.createFleet(activeSector,draft,Number(activeSector.factionTurn||0),{source:'manual'});if(!result.ok){window.alert(result.reason);return;}App.renderCampaignPanels(activeSector);App.persistSector(activeSector);},{ownerType:['faction','corporation','service','independent'],ownerId:ownerOptions,homeSystemId:[''].concat((activeSector.systems||[]).map(function(s){return s.id;})),status:['operational','financially-stressed']});});}

	var contractsOutput = document.getElementById('contracts-output');
	var contractsStatus = document.getElementById('contracts-status');
	var commodityFreightOutput = document.getElementById('commodity-freight-output');
	if (typeof SectorTradeContracts !== 'undefined' && SectorEconomy && SectorEconomy.isInitialized && SectorEconomy.isInitialized(sector)) {
		var contractSummary = SectorTradeContracts.getSummary(sector);
		if (contractsStatus) contractsStatus.textContent = contractSummary.active + ' active · ' + contractSummary.paused + ' paused · ' + contractSummary.expired + ' expired · ' + contractSummary.shippedThisTurn.toFixed(2) + ' lots committed this turn';
		var contractMarkets = (sector.markets || []).map(function(m) { return m.id; });
		var contractGoods = SectorEconomy.getCommodityCatalogue(sector).map(function(c) { return c.id; });
		App.renderSimpleTable(contractsOutput, ['Contract','Origin','Destination','Commodity','Lots / turn','Price / lot','Priority','Status','Shipped / delivered / lost this turn'], SectorTradeContracts.getContracts(sector).map(function(contract) {
			var origin = (sector.markets||[]).find(function(m) { return String(m.id) === String(contract.originMarketId); }) || {};
			var destination = (sector.markets||[]).find(function(m) { return String(m.id) === String(contract.destinationMarketId); }) || {};
			return {item:contract, values:[contract.name, origin.planetName || contract.originMarketId, destination.planetName || contract.destinationMarketId, contract.commodityId, contract.quantityPerTurn, Number(contract.unitPriceCr||0) > 0 ? Number(contract.unitPriceCr).toFixed(2) + ' Cr' : 'Negotiated', contract.priority, contract.status, Number(contract.shippedThisTurn||0).toFixed(2) + ' / ' + Number(contract.deliveredThisTurn||0).toFixed(2) + ' / ' + Number(contract.lostThisTurn||0).toFixed(2)]};
		}), {label:'Edit', callback:function(contract) {
			var before = JSON.parse(JSON.stringify(contract));
			App.editCampaignObject('Edit supply contract: ' + contract.name, contract, ['id','createdTurn','source','history','shippedThisTurn','deliveredThisTurn','lostThisTurn','lastPreparedTurn'], function() {
				var validation = SectorTradeContracts.validate(sector);
				if (!validation.ok) { Object.keys(contract).forEach(function(k) { delete contract[k]; }); Object.assign(contract, before); window.alert(validation.errors.join('\n')); }
				App.renderCampaignPanels(sector); App.persistSector(sector);
			}, {originMarketId:contractMarkets,destinationMarketId:contractMarkets,commodityId:contractGoods,priority:['critical','high','standard','low'],status:['active','paused','cancelled']});
		}, extraButtons:function(contract, cell) {
			var toggle = App.appendElement(cell, 'button', contract.status === 'active' ? 'Pause' : 'Resume', 'textbutton campaign-action'); toggle.type = 'button';
			toggle.addEventListener('click', function() { var previous = contract.status; contract.status = contract.status === 'active' ? 'paused' : 'active'; var validation = SectorTradeContracts.validate(sector); if (!validation.ok) { contract.status = previous; window.alert(validation.errors.join('\n')); } else if (typeof SectorSimulation !== 'undefined') SectorSimulation.setFieldOverride(contract, 'status', contract.status); App.renderCampaignPanels(sector); App.persistSector(sector); });
		}});
		App.renderSimpleTable(commodityFreightOutput, ['Commodity','Category','Freight units / lot','Handling class','Origin'], SectorEconomy.getCommodityCatalogue(sector).map(function(commodity) { return {item:commodity, values:[commodity.name,commodity.category,Number(commodity.freightUnitsPerLot||1).toFixed(2),commodity.storageClass,commodity.provenance || commodity.source || 'catalogue']}; }), {label:'Configure', callback:function(commodity) {
			App.editCampaignObject('Configure cargo profile: ' + commodity.name, commodity, ['id','name','category','unit','basePrice','canBeProduced','canBeConsumed','source','provenance'], function() {
				if (typeof SectorSimulation !== 'undefined') { SectorSimulation.setFieldOverride(commodity, 'freightUnitsPerLot', commodity.freightUnitsPerLot); SectorSimulation.setFieldOverride(commodity, 'storageClass', commodity.storageClass); }
				if (!Number.isFinite(Number(commodity.freightUnitsPerLot)) || Number(commodity.freightUnitsPerLot) <= 0) commodity.freightUnitsPerLot = 1;
				App.renderCampaignPanels(sector); App.persistSector(sector);
			}, {storageClass:['bulk','controlled','fragile','hazardous','perishable','secure','standard']});
		}});
	} else {
		if (contractsStatus) contractsStatus.textContent = 'Initialize the local economy to create commercial contracts.';
		if (contractsOutput) contractsOutput.innerHTML = '<p class="empty-note">No supply contracts yet.</p>';
		if (commodityFreightOutput) commodityFreightOutput.innerHTML = '<p class="empty-note">Commodity freight profiles appear after economy initialization.</p>';
	}

	App.renderMarketDirectory(sector);

	App.renderSimpleTable(document.getElementById('corp-market-links-output'), ['Corporation','Market / World','System','Relationship','Stake'], (sector.corporationMarketLinks || []).map(function(link) {
		var corp = (sector.corporations || []).find(function(item) { return item.id === link.corporationId; }) || {};
		var market = (sector.markets || []).find(function(item) { return item.id === link.marketId; }) || {};
		var system = (sector.systems || []).find(function(item) { return item.id === (market.systemId || link.systemId); }) || {};
		return {item:link, values:[corp.name || link.corporationId, market.planetName || link.marketId, system.name || link.systemId, link.relationship || 'Commercial presence', link.stake == null ? '—' : link.stake]};
	}), {label:'Edit link', callback:function(link) {
		App.editCampaignObject('Edit corporate market link', link, ['id','systemId','planetId'], function() { CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector, sector.factionTurn || 0); App.renderCampaignPanels(sector); }, {corporationId:(sector.corporations || []).map(function(c) { return c.id; }), marketId:(sector.markets || []).map(function(m) { return m.id; })});
	}, extraButtons:function(link, cell) {
		var market = (sector.markets || []).find(function(item) { return item.id === link.marketId; });
		var corp = (sector.corporations || []).find(function(item) { return item.id === link.corporationId; });
		var systemId = market ? market.systemId : link.systemId;
		function addLink(label, title, action) { var button = App.appendElement(cell, 'button', label, 'textbutton campaign-action'); button.type = 'button'; button.title = title; button.addEventListener('click', action); }
		if (market) addLink('Open market', 'Open the linked world market', function() { App.focusMarket(market.id); });
		if (systemId) addLink('Open system', 'Inspect the market system on the hex map', function() { App.focusSystem(systemId); });
		if (corp) addLink('Open corporation', 'Locate this corporation in the directory', function() { App.focusCorporation(corp.id); });
	}});

	App.renderStoryCards(document.getElementById('adventures-output'), sector.adventures || [], {
		kicker:function(a) { return a.type + ' / ' + a.systemName; }, title:'title', summary:'hook', status:true,
		fields:[{key:'planetName',label:'World'},{key:'patron',label:'Patron'},{key:'opposition',label:'Opposition'},{key:'complication',label:'Complication'},{key:'keyPlace',label:'Key place'},{key:'objective',label:'Objective'},{key:'stakes',label:'Stakes'},{key:'twist',label:'Twist'},{key:'reward',label:'Reward'}],
		extraAction:function(item, controls) {
			var button = App.appendElement(controls, 'button', item.status === 'Played' ? 'Mark unplayed' : 'Mark played', 'textbutton campaign-action');
			button.type = 'button'; button.addEventListener('click', function() { item.status = item.status === 'Played' ? 'Unplayed' : 'Played'; App.renderCampaignPanels(sector); App.persistSector(sector); });
		}
	});

	App.renderSimpleTable(document.getElementById('threats-output'), ['Name','Kind','Role','Location','HD','HP','AC','Atk','Damage','Move','ML','Skill','Save','Behavior'], (sector.threats || []).map(function(t) {
		return {item:t, values:[t.name, t.kind, t.role, t.location, t.hd, t.hp, t.ac, t.attackBonus, t.damage, t.move, t.morale, t.skillBonus, t.save, t.behavior]};
	}), {label:'Edit', callback:function(t) { App.editCampaignObject('Edit threat: ' + t.name, t, ['id','locationSystemId','notes','schemaVersion'], function() { App.renderCampaignPanels(sector); }); }});
	App.renderStoryCards(document.getElementById('people-output'), sector.people || [], {
		kicker:'role', title:'name', summary:function(p) { return p.location + ' · HD ' + p.hd + ' · ' + p.hp + ' HP · AC ' + p.ac; },
		fields:[{key:'motive',label:'Motive'},{key:'mannerism',label:'Mannerism'},{key:'secret',label:'Secret'},{key:'save',label:'Save'}],
		edit:function(person) { App.editCampaignObject('Edit person: ' + person.name, person, ['id','locationSystemId','notes','privateNotes'], function() { App.renderCampaignPanels(sector); }); }
	});

	App.renderStoryCards(document.getElementById('supplement-output'), sector.supplementContent || [], {
		kicker:function(item) { return item.module + ' / ' + item.system; }, title:'title', summary:'summary',
		fields:[{key:'target',label:'Anchor'},{value:function(item) { return Object.keys(item.details || {}).map(function(key) { return key.replace(/([A-Z])/g, ' $1').replace(/^./, function(c) { return c.toUpperCase(); }) + ': ' + item.details[key]; }); },label:'Details'}],
		extraAction:function(item, controls) { var btn = App.appendElement(controls, 'button', 'Remove', 'textbutton campaign-action'); btn.type='button'; btn.addEventListener('click', function() { sector.supplementContent = sector.supplementContent.filter(function(x) { return x.id !== item.id; }); App.renderCampaignPanels(sector); App.persistSector(sector); }); }
	});
};

App.populateSupplementTargets = function(sector) {
	var targetSelect = document.getElementById('supplement-target');
	if (!targetSelect) return;
	targetSelect.innerHTML = '';
	var randomOption = document.createElement('option'); randomOption.value = ''; randomOption.textContent = 'Random suitable location'; targetSelect.appendChild(randomOption);
	(sector.systems || []).forEach(function(system) {
		if (system.planets && system.planets.length) system.planets.forEach(function(planet) {
			var option = document.createElement('option'); option.value = planet.id; option.textContent = planet.name + ' — ' + system.name; targetSelect.appendChild(option);
		});
		else { var option = document.createElement('option'); option.value = system.id; option.textContent = system.name + ' — uninhabited system'; targetSelect.appendChild(option); }
	});
};

App.rerollFactions = function(sector) {
	if (!sector) return [];
	sector.factions = CampaignTools.generateFactions(sector);
	// Rerolling the roster does not rewind the campaign. All coordinator and
	// simulation clocks remain on the same committed turn.
	if (typeof SectorSimulation !== 'undefined') SectorSimulation.syncLegacyTurn(sector);
	sector.factionNews = [];
	return sector.factions;
};

App.openDirectoryCreateEditor = function(sector, config) {
	if (!sector || !config || !config.collection) return false;
	sector[config.collection] = Array.isArray(sector[config.collection]) ? sector[config.collection] : [];
	var draft = config.createDraft();
	DynEdit.edit(config.title, draft, config.template, function(saved) {
		if (!saved) return;
		draft.name = String(draft.name || '').trim() || config.fallbackName || 'Unnamed entry';
		if (typeof config.normalize === 'function') config.normalize(draft, sector);
		sector[config.collection].push(draft);
		if (typeof config.afterAdd === 'function') config.afterAdd(draft, sector);
		if (typeof config.render === 'function') config.render(sector);
		var status = document.getElementById(config.statusId || '');
		if (status) status.textContent = 'Added ' + draft.name + '. ' + sector[config.collection].length + ' entr' + (sector[config.collection].length === 1 ? 'y' : 'ies') + ' recorded.';
		App.persistSector(sector);
	});
	return true;
};

App.bindCampaignControls = function() {
	if (App.campaignControlsBound) return;
	App.campaignControlsBound = true;
	function on(id, callback) { var el = document.getElementById(id); if (el) el.addEventListener('click', function() { if (App.currentSector) callback(App.currentSector); }); }
	on('politics-treaty-add', function(sector) {
		var factionIds=(sector.factions||[]).map(function(x){return x.id;}),polityIds=(sector.polities||[]).map(function(x){return x.id;}),ids=factionIds.concat(polityIds);if(ids.length<2){window.alert('At least two factions or polities are required.');return;}var pair=factionIds.length>=2?{aType:'faction',a:factionIds[0],bType:'faction',b:factionIds[1]}:polityIds.length>=2?{aType:'polity',a:polityIds[0],bType:'polity',b:polityIds[1]}:{aType:'faction',a:factionIds[0],bType:'polity',b:polityIds[0]};
		var d={name:'New diplomatic agreement',type:'trade pact',partyAType:pair.aType,partyAId:pair.a,partyBType:pair.bType,partyBId:pair.b,tradeAccess:'preferred',tariffPercent:2,transitRights:true,mutualDefense:false,endTurn:0,embargoCommodityIds:'',notes:''};
		App.editCampaignObject('Propose diplomatic treaty',d,[],function(){try{SectorPolitics.proposeTreaty(sector,{name:d.name,type:d.type,parties:[{type:d.partyAType,id:d.partyAId},{type:d.partyBType,id:d.partyBId}],terms:{tradeAccess:d.tradeAccess,tariffPercent:d.tariffPercent,transitRights:d.transitRights,mutualDefense:d.mutualDefense,embargoCommodityIds:String(d.embargoCommodityIds||'').split(/[\\s,;]+/).filter(Boolean)},endTurn:d.endTurn,notes:d.notes});App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}},{type:SectorPolitics.constants.treatyTypes.slice(),partyAType:['faction','polity'],partyBType:['faction','polity'],partyAId:ids,partyBId:ids,tradeAccess:['preferred','open','restricted','embargoed']});
	});
	on('politics-sanction-add', function(sector) {
		var factionIds=(sector.factions||[]).map(function(x){return x.id;}),polityIds=(sector.polities||[]).map(function(x){return x.id;}),ids=factionIds.concat(polityIds);if(ids.length<2){window.alert('At least two factions or polities are required.');return;}var pair=factionIds.length>=2?{aType:'faction',a:factionIds[0],bType:'faction',b:factionIds[1]}:polityIds.length>=2?{aType:'polity',a:polityIds[0],bType:'polity',b:polityIds[1]}:{aType:'faction',a:factionIds[0],bType:'polity',b:polityIds[0]};
		var d={name:'New sanction',issuerType:pair.aType,issuerId:pair.a,targetType:pair.bType,targetId:pair.b,kind:'trade embargo',direction:'both',commodityIds:'',tariffPercent:20,endTurn:0,notes:''};
		App.editCampaignObject('Impose political sanction',d,[],function(){try{SectorPolitics.imposeSanction(sector,{name:d.name,issuerType:d.issuerType,issuerId:d.issuerId,targetType:d.targetType,targetId:d.targetId,kind:d.kind,direction:d.direction,commodityIds:String(d.commodityIds||'').split(/[\\s,;]+/).filter(Boolean),tariffPercent:d.tariffPercent,endTurn:d.endTurn,notes:d.notes});App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}},{issuerType:['faction','polity'],targetType:['faction','polity'],issuerId:ids,targetId:ids,kind:SectorPolitics.constants.sanctionTypes.slice(),direction:['outbound','both']});
	});
	on('politics-war-add', function(sector) {
		var factionIds=(sector.factions||[]).map(function(x){return x.id;}),polityIds=(sector.polities||[]).map(function(x){return x.id;}),ids=factionIds.concat(polityIds);if(ids.length<2){window.alert('At least two factions or polities are required.');return;}var pair=factionIds.length>=2?{aType:'faction',a:factionIds[0],bType:'faction',b:factionIds[1]}:polityIds.length>=2?{aType:'polity',a:polityIds[0],bType:'polity',b:polityIds[1]}:{aType:'faction',a:factionIds[0],bType:'polity',b:polityIds[0]};
		var d={partyAType:pair.aType,partyAId:pair.a,partyBType:pair.bType,partyBId:pair.b,humanitarianCommodityIds:'medical-compounds food',notes:''};
		App.editCampaignObject('Declare war',d,[],function(){try{SectorPolitics.declareWar(sector,{type:d.partyAType,id:d.partyAId},{type:d.partyBType,id:d.partyBId},{humanitarianCommodityIds:String(d.humanitarianCommodityIds||'').split(/[\\s,;]+/).filter(Boolean),notes:d.notes});App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}},{partyAType:['faction','polity'],partyBType:['faction','polity'],partyAId:ids,partyBId:ids});
	});
	on('polity-relation-add', function(sector) {
		var polities=sector.polities||[];if(polities.length<2){window.alert('At least two polities are required.');return;}var d={fromPolityId:polities[0].id,toPolityId:polities[1].id,type:'trade pact'};
		App.editCampaignObject('Record directed polity relationship',d,[],function(){try{SectorPolitics.setPolityRelation(sector,d.fromPolityId,d.toPolityId,d.type);App.renderCampaignPanels(sector);App.persistSector(sector);}catch(e){window.alert(e.message);}},{fromPolityId:polities.map(function(x){return x.id;}),toPolityId:polities.map(function(x){return x.id;}),type:SectorPolitics.constants.polityRelations.slice()});
	});
	on('chronicle-note-add', function(sector) {
		var input=document.getElementById('chronicle-note-text'),note=String(input&&input.value||'').trim();if(!note){window.alert('Write a referee note before adding it to the Chronicle.');return;}SectorSimulation.recordEvent(sector,{category:'gm-note',type:'gm-note',source:'referee',visibility:'gm',gmNote:note,summary:note});if(input)input.value='';App.renderChronicle(sector);App.persistSector(sector);
	});
	['chronicle-filter','chronicle-search'].forEach(function(id){var control=document.getElementById(id);if(control)control.addEventListener(id==='chronicle-filter'?'change':'input',function(){var output=document.getElementById('chronicle-output');if(output)output.dataset.visibleLimit='20';if(App.currentSector)App.renderChronicle(App.currentSector);});});
	on('factions-add', function(sector) {
		sector.factions = Array.isArray(sector.factions) ? sector.factions : [];
		var faction = CampaignTools.createCustomFaction(sector);
		var systemOptions = [''].concat((sector.systems || []).map(function(system) { return system.id; }));
		var factionTemplate = App.buildCampaignEditTemplate('Create custom faction', faction, ['id','assets','rivals','turnLog','lastAction','schemaVersion'], {homeworldSystemId:systemOptions});
		DynEdit.edit('Create custom faction', faction, factionTemplate, function(saved) {
			if (!saved) return;
			faction.name = String(faction.name || '').trim() || 'Unnamed faction';
			var home = (sector.systems || []).find(function(system) { return system.id === faction.homeworldSystemId; });
			faction.homeworld = home ? home.name : 'Unplaced';
			(faction.assets || []).filter(function(asset) { return asset.isBase || asset.type === 'Base of Influence'; }).forEach(function(asset) { asset.locationSystemId = home ? home.id : ''; asset.location = home ? home.name : 'Unplaced'; });
			['force','cunning','wealth'].forEach(function(stat) { faction[stat] = Math.max(0, Math.min(8, Math.round(Number(faction[stat]) || 0))); });
			faction.maxHitPoints = Math.max(1, Math.round(Number(faction.maxHitPoints) || 10));
			faction.hitPoints = Math.max(0, Math.min(faction.maxHitPoints, Math.round(Number(faction.hitPoints) || faction.maxHitPoints)));
			faction.factionCredits = Math.max(0, Math.round(Number(faction.factionCredits) || 0));
			sector.factions.push(faction);
			CampaignTools.ensureDiplomacy(sector); CampaignTools.recalculateInfluence(sector);
			App.renderCampaignPanels(sector); App.displayHexmap(sector); App.persistSector(sector);
		});
	});
	on('corporations-add', function(sector) {
		App.openDirectoryCreateEditor(sector, {
			title:'Create corporation', collection:'corporations', fallbackName:'Unnamed corporation', statusId:'corporations-status',
			createDraft:function() { return {name:'New corporation',markets:'Sector interests not specified',ownership:'Unspecified',strategy:'Undecided',valuation:'Unrated'}; },
			template:CorporationGenerator.template,
			normalize:function(corp, activeSector) { corp.markets=String(corp.markets||'').trim(); corp.linkedMarketIds=[]; corp.id=App.makeUniqueId(activeSector.corporations, 'CORP-CUSTOM-', 3); },
			afterAdd:function(corp, activeSector) { var settlement=activeSector.simulation&&activeSector.simulation.economy&&activeSector.simulation.economy.settlement; if(settlement&&settlement.initialized&&typeof SectorSettlement!=='undefined') SectorSettlement.initialize(activeSector); },
			render:function(activeSector) { App.displayCorporationDirectory(activeSector); }
		});
	});
	on('religions-add', function(sector) {
		App.openDirectoryCreateEditor(sector, {
			title:'Create religion or faith', collection:'religions', fallbackName:'Unnamed faith', statusId:'religions-status',
			createDraft:function() { return {name:'New faith',leadership:'Unspecified',doctrine:'Unrecorded doctrine'}; },
			template:ReligionGenerator.template,
			render:function(activeSector) { App.displayReligionDirectory(activeSector); }
		});
	});
	on('political-groups-add', function(sector) {
		App.openDirectoryCreateEditor(sector, {
			title:'Create political group', collection:'politicalGroups', fallbackName:'Unnamed political group', statusId:'political-groups-status',
			createDraft:function() { return {name:'New political group',leadership:'Unspecified'}; },
			template:PoliticalGroupGenerator.template,
			render:function(activeSector) { App.displayPoliticalGroupDirectory(activeSector); }
		});
	});
	on('aliens-add', function(sector) {
		App.openDirectoryCreateEditor(sector, {
			title:'Create alien species', collection:'aliens', fallbackName:'Unnamed species', statusId:'alien-catalog-status',
			createDraft:function() { return {name:'New species',type:'Unclassified',body:'Unrecorded anatomy',lenses:'Unrecorded cultural lens',government:'Unrecorded',motivation:'Unrecorded',humanRelations:'Unrecorded',techLevel:'Unrecorded',firstContact:'Unrecorded'}; },
			template:AlienGenerator.template,
			normalize:function(alien) { ['type','body','lenses','government','motivation','humanRelations','techLevel','firstContact'].forEach(function(key) { alien[key]=String(alien[key]||'').trim(); }); },
			render:function(activeSector) { App.displayAliens(activeSector); }
		});
	});
	on('factions-reroll', function(sector) { App.rerollFactions(sector); App.renderCampaignPanels(sector); App.persistSector(sector); });
	on('faction-turn-button', function(sector) {
		var button = document.getElementById('faction-turn-button');
		var turnStatus = document.getElementById('faction-turn-status');
		if (button && button.disabled) return;
		if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Processing campaign turn…'; }
		if (turnStatus) turnStatus.textContent = 'Resolving economy, logistics, factions and politics…';
		// Give Chromium/Firefox a frame to paint the busy state before the
		// synchronous transaction starts. The calculation remains synchronous,
		// but the user now receives immediate, visible feedback.
		window.setTimeout(function() {
			try {
				var transaction = SectorSimulation.advanceCampaignTurn(sector);
				App.persistSector(sector); App.renderCampaignPanels(sector); App.displayHexmap(sector);
				var economyResult = transaction.economy;
				if (turnStatus && economyResult) {
					var shipped = economyResult.logistics && economyResult.logistics.dispatch && economyResult.logistics.dispatch.dispatched || 0;
					var arrived = economyResult.logistics && economyResult.logistics.arrivals && economyResult.logistics.arrivals.delivered || 0;
					var political = economyResult.politics || {};
					turnStatus.textContent = 'Turn ' + transaction.turn + ' committed · ' + economyResult.markets + ' markets · ' + shipped + ' shipments · ' + Number(arrived).toFixed(2) + ' lots delivered · ' + Number(political.expiredTreaties||0) + ' treaty expirations';
				} else if (turnStatus) turnStatus.textContent = 'Campaign turn ' + transaction.turn + ' committed · ' + transaction.factionEvents.length + ' faction events';
			} catch (error) {
				if (turnStatus) turnStatus.textContent = 'Turn failed: ' + error.message;
				window.alert(error.message);
			} finally {
				if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'Advance campaign turn ↗'; }
			}
		}, 0);
	});
	on('routes-reroll', function(sector) { sector.tradeRoutes = CampaignTools.generateTradeRoutes(sector); CampaignTools.recalculateInfluence(sector); CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector,sector.factionTurn||0); if (typeof SectorSimulation !== 'undefined') SectorSimulation.refreshDerivedState(sector); App.renderCampaignPanels(sector); App.displayHexmap(sector); App.persistSector(sector); });
	on('trade-contract-add', function(sector) {
		if (typeof SectorTradeContracts === 'undefined' || !SectorEconomy.isInitialized(sector)) return;
		var markets = sector.markets || [], goods = SectorEconomy.getCommodityCatalogue(sector);
		if (markets.length < 2) { window.alert('At least two markets are required for a supply contract.'); return; }
		var draft = {id:'', name:'New supply contract', originMarketId:markets[0].id, destinationMarketId:(markets.find(function(m) { return String(m.systemId) !== String(markets[0].systemId); }) || markets[1]).id, commodityId:goods[0] ? goods[0].id : '', quantityPerTurn:10, unitPriceCr:0, startTurn:Number(sector.factionTurn||0)+1, endTurn:0, priority:'standard', status:'active', notes:''};
		App.editCampaignObject('Create recurring supply contract', draft, ['id'], function() {
			var result = SectorTradeContracts.create(sector, draft, Number(sector.factionTurn||0));
			if (!result.ok) window.alert(result.reason);
			App.renderCampaignPanels(sector); App.persistSector(sector);
		}, {originMarketId:markets.map(function(m) { return m.id; }),destinationMarketId:markets.map(function(m) { return m.id; }),commodityId:goods.map(function(c) { return c.id; }),priority:['critical','high','standard','low'],status:['active','paused']});
	});
	on('markets-initialize-economy', function(sector) {
		var result = SectorEconomy.initializeSector(sector);
		var status = document.getElementById('economy-status');
		if (status) status.textContent = result.initializedMarkets + ' new market accounts initialized · ' + result.preservedMarkets + ' existing accounts preserved';
		App.renderCampaignPanels(sector); App.persistSector(sector);
	});
	on('markets-reroll', function(sector) {
		sector.markets = CampaignTools.generateMarkets(sector);
		sector.corporationMarketLinks = null;
		CampaignTools.linkCampaignRecords(sector);
		CampaignTools.updateMarkets(sector,sector.factionTurn||0);
		if (typeof SectorEconomy !== 'undefined' && SectorEconomy.isInitialized(sector)) SectorEconomy.initializeSector(sector);
		App.renderCampaignPanels(sector); App.persistSector(sector);
	});
	on('adventures-reroll', function(sector) { sector.adventures = CampaignTools.generateAdventureSeeds(sector, 8); App.renderCampaignPanels(sector); App.persistSector(sector); });
	on('threats-reroll', function(sector) { sector.threats = CampaignTools.generateThreats(sector, 12); App.renderCampaignPanels(sector); App.persistSector(sector); });
	on('people-reroll', function(sector) { sector.people = CampaignTools.generatePeople(sector, 10); App.renderCampaignPanels(sector); App.persistSector(sector); });
	on('supplement-generate', function(sector) {
		var moduleSelect = document.getElementById('supplement-module');
		var targetSelect = document.getElementById('supplement-target');
		var item = CampaignTools.generateSupplement(moduleSelect ? moduleSelect.value : 'site', sector, targetSelect ? targetSelect.value : '');
		sector.supplementContent = Array.isArray(sector.supplementContent) ? sector.supplementContent : [];
		sector.supplementContent.unshift(item); sector.supplementContent = sector.supplementContent.slice(0, 24);
		App.renderCampaignPanels(sector); App.persistSector(sector);
	});
};

App.showConfirmation = function(title, callback) {
	let modal = DynModal.show();
	
	let titleNode = document.createElement('p');
	titleNode.innerText = title;
	
	let buttonRowNode = document.createElement('p');
	
	let okButtonNode = document.createElement('span');
	okButtonNode.className = 'textbutton';
	okButtonNode.innerText = 'OK'
	
	let cancelButtonNode = document.createElement('span');
	cancelButtonNode.className = 'textbutton';
	cancelButtonNode.innerText = 'Cancel'
	
	modal.container.appendChild(titleNode);
	modal.container.appendChild(buttonRowNode);
	buttonRowNode.appendChild(okButtonNode);
	buttonRowNode.appendChild(document.createTextNode(' | '));
	buttonRowNode.appendChild(cancelButtonNode);
	
	okButtonNode.addEventListener('click', function(event) {
		DynModal.hide(modal);
		callback(true);
	});
	
	cancelButtonNode.addEventListener('click', function(event) {
		DynModal.hide(modal);
		callback(false);
	});
}

App.displaySystemInspector = function(inspectorElement, system, sector) {
	inspectorElement.innerHTML = '';

	if (!system) {
		let emptyState = simpleAppend(inspectorElement, 'div', '', 'inspector-empty-state');
		simpleAppend(emptyState, 'div', '∅', 'inspector-empty-mark');
		simpleAppend(emptyState, 'h3', 'No system selected');
		simpleAppend(emptyState, 'p', 'This sector currently has no star systems. Generate a new sector or load a saved archive to begin exploring.');
		return;
	}
	
	let systemHeader = simpleAppend(inspectorElement, 'p');
	var isBlackHole = system.sourceEntityType === 'blackHole' || system.systemType === 'blackHole';
	simpleAppend(systemHeader, 'span', system.name + (isBlackHole ? ' Black Hole' : ' System'), 'inspector-system-name' + (isBlackHole ? ' inspector-black-hole-label' : ' '));
	simpleAppend(systemHeader, 'span', '(' + String(system.x).padStart(2, '0') + String(system.y).padStart(2, '0') + ')', 'secondary');
	
	let systemEditContainer = simpleAppend(inspectorElement, 'span', '', 'edit-zone');
	appendText(systemEditContainer, ' ');
	let editSystemLink = simpleAppend(systemEditContainer, 'span', 'edit', 'edit-link textbutton');
	(function(system) {
		editSystemLink.addEventListener('click', function() {
			let title = 'Editing: ' + system.name;
			let originalX = Number(system.x), originalY = Number(system.y);
			DynEdit.edit(title, system, WorldGenerator.systemTemplate, function(saved) {
				if (!saved) return;
				var x = Number(system.x), y = Number(system.y);
				var collision = (sector.systems || []).some(function(other) { return other.id !== system.id && Number(other.x) === x && Number(other.y) === y; });
				if (!SectorGrid.validCoordinates(sector, x, y) || collision) {
					system.x = originalX; system.y = originalY;
					window.alert(collision ? 'That hex is already occupied. The system location was restored.' : 'Hex coordinates must be within the map: X 00–' + String(SectorGrid.dimensions(sector).columns - 1).padStart(2,'0') + ' and Y 00–' + String(SectorGrid.dimensions(sector).rows - 1).padStart(2,'0') + '. The system location was restored.');
				}
				App.refreshSectorAfterMapEdit(sector, system);
			});
		});
	}) (system);
	
	appendText(systemEditContainer, ' | ');
	let deleteSystemLink = simpleAppend(systemEditContainer, 'span', 'delete', 'textbutton');
	deleteSystemLink.addEventListener('click', function() {
		App.showConfirmation('Delete system ' + system.name + '?', function(confirmed) {
			if (!confirmed) { return; }
			
			sector.systems.splice(sector.systems.indexOf(system), 1);
			var removedPlanetIds = new Set((system.planets || []).map(function(p) { return p.id; }));
			var removedMarketIds = new Set((sector.markets || []).filter(function(m) { return m.systemId === system.id || removedPlanetIds.has(m.planetId); }).map(function(m) { return m.id; }));
			sector.markets = (sector.markets || []).filter(function(m) { return !removedMarketIds.has(m.id); });
			sector.corporationMarketLinks = (sector.corporationMarketLinks || []).filter(function(link) { return !removedMarketIds.has(link.marketId); });
			(sector.factions || []).forEach(function(f) { (f.assets || []).forEach(function(a) { if (a.locationSystemId === system.id) { a.locationSystemId = ''; a.location = 'Unplaced'; } }); if (f.homeworldSystemId === system.id) { f.homeworldSystemId = ''; f.homeworld = 'Unplaced'; } });
			(sector.polities || []).forEach(function(p) { p.memberSystemIds = (p.memberSystemIds || []).filter(function(id) { return id !== system.id; }); if (p.capitalSystemId === system.id) p.capitalSystemId = p.memberSystemIds[0] || ''; });
			App.refreshSectorAfterMapEdit(sector, null);					
		});
	});
	
	appendText(systemEditContainer, ' | ');
	let addPlanetLink = simpleAppend(systemEditContainer, 'span', 'add planet', 'textbutton');
	addPlanetLink.addEventListener('click', function() {
		let planet = WorldGenerator.generatePlanet(sector.worldGenerationMode || 'core');
		planet.id = App.makeUniqueId((sector.systems || []).flatMap(function(s) { return s.planets || []; }), system.id + '-W', 2);
		planet.systemId = system.id;
		let title = 'Adding planet to the ' + system.name + ' system';
		DynEdit.edit(title, planet, App.getPlanetEditTemplate(planet), function(saved) {
			if (!saved) return;
			planet.description = WorldGenerator.describePlanet(planet);
			system.planets.push(planet);
			App.ensureMarketForPlanet(sector, system, planet);
			App.refreshSectorAfterMapEdit(sector, system);
		});			
	});
	appendText(systemEditContainer, ' | ');
	let addSurveyObjectLink = simpleAppend(systemEditContainer, 'span', 'add survey object', 'textbutton');
	addSurveyObjectLink.addEventListener('click', function() {
		let body = {type:'Orbital station', name:'Unnamed installation', bodyClass:'N', description:'', notes:'', isGeneratedWorld:false};
		DynEdit.edit('Add orbital survey object to ' + system.name, body, App.getSurveyObjectEditTemplate(), function(saved) {
			if (!saved) return;
			body.type = String(body.type || 'Unclassified object').trim() || 'Unclassified object';
			body.name = String(body.name || 'Unnamed object').trim() || 'Unnamed object';
			body.bodyClass = 'N'; body.isGeneratedWorld = false; body.source = 'manual'; body.manualOverride = true; body.id = App.makeUniqueId(system.bodies || [], system.id + '-B', 2);
			system.bodies = Array.isArray(system.bodies) ? system.bodies : []; system.bodies.push(body);
			App.refreshSectorAfterMapEdit(sector, system);
		});
	});
	appendText(systemEditContainer, ' | ');
	let addPoiLink = simpleAppend(systemEditContainer, 'span', 'add point of interest', 'textbutton');
	addPoiLink.addEventListener('click', function() {
		let point = {name:'Uncatalogued site', type:'Ruins', occupants:'Unspecified', situation:'An unexplored site awaits investigation.'};
		DynEdit.edit('Add point of interest to ' + system.name, point, App.getPointOfInterestEditTemplate(), function(saved) {
			if (!saved) return;
			point.name = String(point.name || 'Uncatalogued site').trim() || 'Uncatalogued site';
			point.type = String(point.type || 'Unclassified site').trim() || 'Unclassified site';
			system.pointsOfInterest = Array.isArray(system.pointsOfInterest) ? system.pointsOfInterest : []; system.pointsOfInterest.push(point);
			App.refreshSectorAfterMapEdit(sector, system);
		});
	});
	
	if (system.planets.length > 0) {
		simpleAppend(inspectorElement, 'hr');
		simpleAppend(inspectorElement, 'hr');
		simpleAppend(inspectorElement, 'hr');
	}
	
	for (let i = 0; i < system.planets.length; i++) {
		let planet = system.planets[i];
		
		if (i != 0) {
			simpleAppend(inspectorElement, 'hr');
		}
		
		let planetHeaderElement = simpleAppend(inspectorElement, 'p', '', 'inspector-object-header');
		simpleAppend(planetHeaderElement,'span', planet.name + ' ', 'inspector-object-name');
		if ('tag1' in planet && 'tag2' in planet) { simpleAppend(planetHeaderElement,'span', '(' + planet.tag1 + ', ' + planet.tag2 + ')', 'secondary') };
		appendText(planetHeaderElement, ' ');
		
		let editPlanetContainer = simpleAppend(planetHeaderElement, 'span', '', 'edit-zone');
		
		let editPlanetLink = simpleAppend(editPlanetContainer, 'span', 'edit', 'edit-link textbutton');
		(function(planet) {
			editPlanetLink.addEventListener('click', function() {
				let title = 'Editing: ' + planet.name + ', ' + system.name + ' system';
				DynEdit.edit(title, planet, App.getPlanetEditTemplate(planet), function(saved) {
					if (!saved) return;
					if (!planet.sourceEntityType) planet.description = WorldGenerator.describePlanet(planet);
					App.ensureMarketForPlanet(sector, system, planet);
					App.refreshSectorAfterMapEdit(sector, system);
				});
			});
		}) (planet);
		
		appendText(editPlanetContainer, ' | ');
		
		let deletePlanetLink = simpleAppend(editPlanetContainer, 'span', 'delete', 'textbutton');
		(function(system, planet) {
			deletePlanetLink.addEventListener('click', function() {
				App.showConfirmation('Delete planet ' + planet.name + '?', function(confirmed) {
					if (!confirmed) { return; }
					
					system.planets.splice(system.planets.indexOf(planet), 1);
					var removedMarketIds = new Set((sector.markets || []).filter(function(m) { return m.planetId === planet.id; }).map(function(m) { return m.id; }));
					sector.markets = (sector.markets || []).filter(function(m) { return !removedMarketIds.has(m.id); });
					sector.corporationMarketLinks = (sector.corporationMarketLinks || []).filter(function(link) { return !removedMarketIds.has(link.marketId); });
					App.refreshSectorAfterMapEdit(sector, system);					
				});
			});
		}) (system, planet);
		
		let planetBodyElement = simpleAppend(inspectorElement, 'div');
		
		let tableElem = simpleAppend(planetBodyElement, 'table');
		if ('atmosphere' in planet) { appendRow(tableElem, ['Atmosphere', planet.atmosphere]); }
		if ('gravity' in planet) { appendRow(tableElem, ['Gravity', planet.gravity]); }
		if ('temperature' in planet) { appendRow(tableElem, ['Temperature', planet.temperature]); }
		if ('biosphere' in planet) { appendRow(tableElem, ['Biosphere', planet.biosphere]); }
		if ('population' in planet) { appendRow(tableElem, ['Population', planet.population]); }
		if ('techLevel' in planet) { appendRow(tableElem, ['Tech Level', planet.techLevel]); }
		if ('terrain' in planet) { appendRow(tableElem, ['Terrain', planet.terrain]); }
		
		if ('description' in planet && planet.description) {
			simpleAppend(planetBodyElement, 'p', planet.description, 'world-description');
		}
		if ('notes' in planet) {
			simpleAppend(planetBodyElement, 'p', planet.notes, 'secondary');
		}
		if ('privateNotes' in planet) {
			simpleAppend(planetBodyElement, 'p', planet.privateNotes, 'secondary');
		}
		
		if (planet.tag1) {
			let tag = WorldGenerator.tagDictionary.get(planet.tag1);
			if (tag) createTagSpoiler(planetBodyElement, tag); // Unknown source tags remain visible by name without a generator lookup.
		}
		
		if (planet.tag2) {
			let tag = WorldGenerator.tagDictionary.get(planet.tag2);
			if (tag) createTagSpoiler(planetBodyElement, tag);
		}
	}
	
	if ('pointsOfInterest' in system) {
		if (system.pointsOfInterest.length > 0) {
			simpleAppend(inspectorElement, 'hr');
			simpleAppend(inspectorElement, 'hr');
			simpleAppend(inspectorElement, 'hr');
		}
		
		for (let i = 0; i < system.pointsOfInterest.length; i++) {
			if (i != 0) {
				simpleAppend(inspectorElement, 'hr');
			}
		
			let poiHeader = simpleAppend(inspectorElement, 'p', '', 'inspector-object-header');
			let poiBody = simpleAppend(inspectorElement, 'div', '', 'inspector-poi-body');
			
			let point = system.pointsOfInterest[i];
			
			simpleAppend(poiHeader, 'span', point.name + ' ', 'inspector-object-name');
			simpleAppend(poiHeader, 'span', '(' + point.type + ')', 'secondary');
			let pointActions = simpleAppend(poiHeader, 'span', '', 'edit-zone');
			appendText(pointActions, ' ');
			let editPoint = simpleAppend(pointActions, 'span', 'edit', 'textbutton');
			editPoint.addEventListener('click', function() { DynEdit.edit('Editing point of interest: ' + point.name, point, App.getPointOfInterestEditTemplate(), function(saved) { if (saved) App.refreshSectorAfterMapEdit(sector, system); }); });
			appendText(pointActions, ' | ');
			let deletePoint = simpleAppend(pointActions, 'span', 'delete', 'textbutton');
			deletePoint.addEventListener('click', function() { App.showConfirmation('Delete point of interest ' + point.name + '?', function(confirmed) { if (!confirmed) return; system.pointsOfInterest.splice(system.pointsOfInterest.indexOf(point),1); App.refreshSectorAfterMapEdit(sector,system); }); });
			
			let tableElem = simpleAppend(poiBody, 'table', '', 'inspector-poi-table');
			let poiTableBody = simpleAppend(tableElem, 'tbody');
			appendRow(poiTableBody, ['Occupants:', point.occupants || 'Unspecified']);
			appendRow(poiTableBody, ['Situation:', point.situation || 'Unspecified']);
		}
	}
	
	if ('bodies' in system) {
		simpleAppend(inspectorElement, 'hr');
		
		let surveySection = simpleAppend(inspectorElement, 'section', '', 'system-survey');
		let systemHeader = simpleAppend(surveySection, 'p', '', 'inspector-object-header system-survey-heading');
		simpleAppend(systemHeader, 'span', 'System Survey', 'inspector-object-name');
		let editBodyContainer = simpleAppend(systemHeader, 'span', '', 'edit-zone');
		let addSurveyBodyLink = simpleAppend(editBodyContainer, 'span', 'Add object', 'textbutton');
		addSurveyBodyLink.addEventListener('click', function() { addSurveyObjectLink.click(); });
		appendText(editBodyContainer, ' | ');
		let rerollBodiesButton = simpleAppend(editBodyContainer, 'span', 'Reroll survey', 'textbutton');
		rerollBodiesButton.setAttribute('role', 'button');
		rerollBodiesButton.setAttribute('tabindex', '0');
		rerollBodiesButton.setAttribute('aria-label', 'Reroll system survey');
		
		function rerollSurvey() {
			App.rerollSystemSurvey(system, sector);
			App.persistSector(sector);
			App.displayHexmap(sector, system);
			App.displayWorlds(sector);
		}
		rerollBodiesButton.addEventListener('click', rerollSurvey);
		rerollBodiesButton.addEventListener('keydown', function(event) {
			if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); rerollSurvey(); }
		});
		
		let bodyTable = simpleAppend(surveySection, 'table', '', 'system-survey-table');
		let bodyTableBody = simpleAppend(bodyTable, 'tbody');
		for (let i = 0; i < system.bodies.length; i++) {
			let body = system.bodies[i] || {};
			let name = body.worldName || body.name;
			if (!body.worldName) {
				if (body.name != null && body.name !== '*') name = String(system.name || 'System') + String(body.name);
				else name = '';
			}
			name = String(name == null ? '' : name).trim() || '—';
			let detailParts = [];
			if (body.occupation) detailParts.push('Occupation: ' + body.occupation);
			if (body.situation) detailParts.push('Situation: ' + body.situation);
			if (body.description) detailParts.push('Description: ' + body.description);
			if (body.tags && body.tags.length) detailParts.push('Tags: ' + body.tags.join(', '));
			if (body.sourceParentName) detailParts.push('Parent: ' + body.sourceParentName);
			if (body.generatedFields && body.generatedFields.length) detailParts.push('Forge-filled: ' + body.generatedFields.join(', '));
			if (body.importedFromSWN && !body.occupation && !body.situation && !body.description && !(body.tags && body.tags.length)) {
				detailParts.push('No additional details were included in the SWN export.');
			}
			let row = appendRow(bodyTableBody, [String(body.type || 'Unclassified body'), name, detailParts.join(' · ') || '—']);
			row.className = 'system-survey-row';
			row.cells[0].className = 'system-survey-type';
			row.cells[1].className = 'system-survey-name';
			row.cells[2].className = 'system-survey-details';
			row.setAttribute('data-body-class', String(body.bodyClass || 'N'));
			if (!body.isGeneratedWorld && body.bodyClass !== 'S' && body.bodyClass !== 'B' && !body.planetId && (!body.worldName || body.importedFromSWN)) {
				let actions = simpleAppend(row.cells[1], 'span', '', 'edit-zone survey-row-actions');
				appendText(actions, ' ');
				let editBody = simpleAppend(actions, 'span', 'edit', 'textbutton');
				editBody.addEventListener('click', function() { DynEdit.edit('Editing survey object: ' + (body.name || body.type), body, App.getSurveyObjectEditTemplate(['bodyClass','isGeneratedWorld','planetId','worldName','id','sourceEntityId','sourceEntityType','importedFromSWN','sourceParent','sourceParentName','sourceParentEntity','sourceAttributes','generatedFields']), function(saved) { if (saved) { body.bodyClass='N'; body.isGeneratedWorld=false; if (!body.importedFromSWN) { body.source='manual'; body.manualOverride=true; } if (body.importedFromSWN) body.worldName=body.name; App.refreshSectorAfterMapEdit(sector,system); } }); });
				appendText(actions, ' | ');
				let deleteBody = simpleAppend(actions, 'span', 'delete', 'textbutton');
				deleteBody.addEventListener('click', function() { App.showConfirmation('Delete survey object ' + (body.name || body.type) + '?', function(confirmed) { if (!confirmed) return; system.bodies.splice(system.bodies.indexOf(body),1); App.refreshSectorAfterMapEdit(sector,system); }); });
			}
		}
	}
	
	function appendRow(tableElem, rows) {
		let rowElem = simpleAppend(tableElem, 'tr');
		
		
		for (let i = 0; i < rows.length; i++) {
			if (typeof rows[i] == 'string') {
				simpleAppend(rowElem, 'td', rows[i]);
			} else {
				let cellElem = simpleAppend(rowElem, 'td');
				cellElem.appendChild(rows[i]);
			}
		}
		
		return rowElem;
	}
	
	function simpleAppend(parent, tag, text='', classes='') {
		let element = document.createElement(tag);
		element.innerText = text;
		element.className = classes;
		
		parent.appendChild(element);
		
		return element;
	}
	
	function appendText(parentElem, content) {
		var textElem = document.createTextNode(content);
		parentElem.appendChild(textElem);
	}
	
	function createTagSpoiler(parentElem, tag) {
		let tagHeader = simpleAppend(parentElem, 'p', tag.name.toUpperCase());
		let tagBody = simpleAppend(parentElem, 'div', '', 'inspector-tag-body');
		
		simpleAppend(tagBody, 'p', tag.description, 'secondary');
		
		simpleAppend(tagBody, 'p', 'Enemies');
		simpleAppend(tagBody, 'div', '•' + tag.enemies.join('  •'), 'secondary');
		
		simpleAppend(tagBody, 'p', 'Friends');
		simpleAppend(tagBody, 'div', '•' + tag.friends.join('  •'), 'secondary');
		
		simpleAppend(tagBody, 'p', 'Complications');
		simpleAppend(tagBody, 'div', '•' + tag.complications.join('  •'), 'secondary');
		
		simpleAppend(tagBody, 'p', 'Things');
		simpleAppend(tagBody, 'div', '•' + tag.things.join('  •'), 'secondary');
		
		simpleAppend(tagBody, 'p', 'Places');
		simpleAppend(tagBody, 'div', '•' + tag.places.join('  •'), 'secondary');
		
		DynSpoiler.create(tagHeader, tagBody);
	}
}

// ************************************************************************** //

App._exportObjectUrls = App._exportObjectUrls || {gm:'', player:''};
App._exportSequence = App._exportSequence || 0;
App._exportWorkerAttempted = false;
App._exportWorker = null;
App._exportWorkerBusy = false;
App._queuedExport = null;
App._exportWaiters = [];

// Shared handlers keep worker completion semantics identical across the real
// Worker and deterministic test/fallback adapters.
App._handleExportWorkerMessage = function(event) {
	var payload = App._activeExport;
	App._exportWorkerBusy = false;
	if (payload && payload.seq === App._exportSequence) {
		try {
			if (!event.data || event.data.seq !== payload.seq) throw new Error('The export worker returned a mismatched sequence number.');
			App._applyExportCompression(payload, event.data);
			App._resolveExportWaiters(payload.seq, true);
		} catch (error) {
			console.warn('Export worker result was unusable; retrying in the page thread:', error);
			try {
				App._applyExportCompression(payload, App._buildExportPayload(payload));
				App._resolveExportWaiters(payload.seq, true);
			} catch (fallbackError) {
				console.error('Export fallback failed:', fallbackError);
				App._resolveExportWaiters(payload.seq, false);
			}
		}
	}
	App._activeExport = null;
	App._dispatchExportCompression();
};

App._handleExportWorkerError = function(event) {
	if (App._exportWorker) App._exportWorker.terminate();
	App._exportWorker = null;
	App._exportWorkerBusy = false;
	App._exportWorkerAttempted = true;
	var payload = App._queuedExport || App._activeExport;
	App._queuedExport = null;
	App._activeExport = null;
	if (payload && payload.seq === App._exportSequence) {
		try {
			App._applyExportCompression(payload, App._buildExportPayload(payload));
			App._resolveExportWaiters(payload.seq, true);
		} catch (error) {
			console.error('Synchronous export fallback failed:', error);
			App._resolveExportWaiters(payload.seq, false);
		}
	}
	if (event && event.message) console.warn('Export worker unavailable; used synchronous fallback:', event.message);
	// A newer save may have arrived while the failed worker was busy.
	// Dispatch it now through the synchronous fallback rather than leaving
	// its completion promise pending forever.
	App._dispatchExportCompression();
};

App.waitForExports = function() {
	if (!App._exportPromise) return Promise.resolve(true);
	return App._exportPromise;
};

App._resolveExportWaiters = function(sequence, result) {
	var remaining = [];
	App._exportWaiters.forEach(function(waiter) {
		if (waiter.sequence <= sequence) waiter.resolve(result);
		else remaining.push(waiter);
	});
	App._exportWaiters = remaining;
};

App._applyExportCompression = function(payload, result) {
	if (!payload || payload.seq !== App._exportSequence || !result) return false;
	if (result.error) throw new Error(result.error);
	if (!result.gmBlob || !result.playerBlob || typeof result.gmCompressed !== 'string' || typeof result.playerCompressed !== 'string') throw new Error('The export worker returned an incomplete result.');
	var gmLink = document.getElementById('export-json-gm');
	var playerLink = document.getElementById('export-json-player');
	if (result.gmBlob && result.playerBlob) {
		if (App._exportObjectUrls.gm) window.URL.revokeObjectURL(App._exportObjectUrls.gm);
		if (App._exportObjectUrls.player) window.URL.revokeObjectURL(App._exportObjectUrls.player);
		App._exportObjectUrls.gm = window.URL.createObjectURL(result.gmBlob);
		App._exportObjectUrls.player = window.URL.createObjectURL(result.playerBlob);
		gmLink.href = App._exportObjectUrls.gm;
		playerLink.href = App._exportObjectUrls.player;
		gmLink.download = ('Sector'+payload.sectorName).replace(/ /g, '')+'_GM.json';
		playerLink.download = ('Sector'+payload.sectorName).replace(/ /g, '')+'_Player.json';
		gmLink.removeAttribute('aria-disabled');
		playerLink.removeAttribute('aria-disabled');
	}
	if (result.gmCompressed && result.playerCompressed) {
		var gmUrl = document.getElementById('export-url-gm');
		var playerUrl = document.getElementById('export-url-player');
		gmUrl.value = URLParam.createURL({data:result.gmCompressed});
		playerUrl.value = URLParam.createURL({data:result.playerCompressed});
		URLParam.encode({data:result.gmCompressed});
	}
	var sizeStatus = document.getElementById('export-size-status');
	if (sizeStatus) {
		var gmUrlValue = document.getElementById('export-url-gm').value || '';
		var gmBytes = result.gmBlob && Number(result.gmBlob.size) || (result.gmJson ? new Blob([result.gmJson]).size : 0);
		var retention = typeof SectorSimulation !== 'undefined' && SectorSimulation.getRetentionSummary && App.currentSector ? SectorSimulation.getRetentionSummary(App.currentSector) : null;
		var detail = retention && retention.archiveDetail;
		var message = 'GM JSON: ' + (gmBytes ? (gmBytes / 1024 / 1024).toFixed(2) + ' MB' : 'size unavailable') + ' · GM share link: ' + gmUrlValue.length.toLocaleString() + ' characters';
		if (detail) message += ' · Detailed archive: ' + Math.round(detail.bytes / 1024) + ' / ' + Math.round(detail.budgetBytes / 1024) + ' KB';
		if (gmUrlValue.length > 400000 || gmBytes > 5 * 1024 * 1024) message += ' · Large export: use the downloaded GM JSON for backups; the share URL may be unreliable.';
		message += ' · Oldest archived detail is pruned when the configured detailed-history budget is reached; aggregate counters and settlement idempotency records remain.';
		sizeStatus.textContent = message;
	}
	return true;
};

App._ensureExportWorker = function() {
	if (App._exportWorkerAttempted) return App._exportWorker;
	App._exportWorkerAttempted = true;
	if (typeof Worker === 'undefined') return null;
	try {
		App._exportWorker = new Worker(new URL('export-worker.js', document.baseURI));
		App._exportWorker.onmessage = App._handleExportWorkerMessage;
		App._exportWorker.onerror = App._handleExportWorkerError;
	} catch (error) {
		App._exportWorker = null;
	}
	return App._exportWorker;
};

App._dispatchExportCompression = function() {
	if (App._exportWorkerBusy || !App._queuedExport) return;
	var payload = App._queuedExport;
	App._queuedExport = null;
	var worker = App._ensureExportWorker();
	if (worker) {
		App._activeExport = payload;
		App._exportWorkerBusy = true;
		try {
			worker.postMessage(payload);
			return;
		} catch (error) {
			if (worker) worker.terminate();
			App._exportWorker = null;
			App._exportWorkerBusy = false;
			App._activeExport = null;
			App._exportWorkerAttempted = true;
			console.warn('Export worker could not accept a save; used synchronous fallback:', error);
		}
	}
	// Inline/offline/file contexts may prohibit Worker construction. Keep the
	// original encoder as a deterministic fallback for those environments.
	try {
		var result = App._buildExportPayload(payload);
		App._applyExportCompression(payload, result);
		App._resolveExportWaiters(payload.seq, true);
	} catch (error) {
		console.error('Export preparation failed:', error);
		App._resolveExportWaiters(payload.seq, false);
	}
};

// Same deterministic export builder for offline browsers and worker failures.
// The normal hosted path builds these payloads inside export-worker.js instead.
App._buildExportPayload = function(payload) {
	var sector = payload.sector;
	var gmPretty = JSON.stringify(sector, null, ' ');
	var gmCompact = JSON.stringify(sector);
	var playerSector = App.censorSector(sector);
	var playerPretty = JSON.stringify(playerSector, null, ' ');
	var playerCompact = JSON.stringify(playerSector);
	return {
		gmBlob:new Blob([gmPretty], {type:'application/json'}),
		playerBlob:new Blob([playerPretty], {type:'application/json'}),
		gmCompressed:LZString.compressToEncodedURIComponent(gmCompact),
		playerCompressed:LZString.compressToEncodedURIComponent(playerCompact)
	};
};

App.createDownloadLink = function(sector) {
	if (!sector) return Promise.resolve(false);
	var gmLink = document.getElementById('export-json-gm');
	var playerLink = document.getElementById('export-json-player');
	// Disable stale downloads while a newer, worker-prepared snapshot is pending.
	gmLink.removeAttribute('href');
	playerLink.removeAttribute('href');
	gmLink.setAttribute('aria-disabled', 'true');
	playerLink.setAttribute('aria-disabled', 'true');
	// Clear previous share URLs as well; never leave a stale link looking current
	// while the worker prepares an updated sector snapshot.
	document.getElementById('export-url-gm').value = '';
	document.getElementById('export-url-player').value = '';
	var payload = {seq:++App._exportSequence,sector:sector,sectorName:sector.name || 'Unnamed'};
	App._queuedExport = payload; // coalesce rapid saves to the newest snapshot.
	App._exportPromise = new Promise(function(resolve) { App._exportWaiters.push({sequence:payload.seq,resolve:resolve}); });
	App._dispatchExportCompression();
	return App._exportPromise;
};
