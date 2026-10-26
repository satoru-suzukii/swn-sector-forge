let App = {};

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
	App.bindCampaignControls();
	
	// ---------------------------------------------------------------------- //
	// set up 'load json file' button
	
	let fileInputElement = document.getElementById('file-input');
	fileInputElement.addEventListener('change', function(event) {	
		let reader = new FileReader();
		reader.onload = function(e) {
			generatorContainerElement.classList.add('hide-section');
			
			try {
				let data = e.target.result;
				let sector = JSON.parse(data);
				App.displaySector(sector);
				tabs.setVisibleTab(1); // set the visible tab to the galaxy generator
				viewerContainerElement.classList.remove('hide-section');
				App.setURL(sector);
			} catch (error) {
				window.alert('Error loading sector from file: ' + error);
				console.warn(error.stack);
				viewerContainerElement.classList.add('hide-section');
				
				generatorContainerElement.classList.remove('hide-section');				
			}
		}
		reader.readAsText(fileInputElement.files[0]);
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
		
		App.setURL(sector);
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
	
	let generationModeElement = document.getElementById('world-generation-mode');
	let worldGenerationMode = generationModeElement && generationModeElement.value === 'expanded' ? 'expanded' : 'core';
	let systemDensityElement = document.getElementById('system-density');
	let worldDensityElement = document.getElementById('world-density');
	let systemDensity = systemDensityElement && ['default','empty','scarce','normal','crowded'].includes(systemDensityElement.value) ? systemDensityElement.value : 'default';
	let worldDensity = worldDensityElement && ['default','empty','scarce','normal','crowded'].includes(worldDensityElement.value) ? worldDensityElement.value : 'default';
	sector.worldGenerationMode = worldGenerationMode;
	sector.generationSettings = {systemDensity:systemDensity, worldDensity:worldDensity};
	sector.systems = WorldGenerator.generate({worldGenerationMode:worldGenerationMode, systemDensity:systemDensity, worldDensity:worldDensity});
	sector.corporations = CorporationGenerator.generate();
	sector.religions = ReligionGenerator.generate();
	sector.politicalGroups = PoliticalGroupGenerator.generate();
	sector.aliens = AlienGenerator.generate();
	sector.regions = [];
	CampaignTools.enrichSector(sector, false);
	
	return sector;
}

App.generateSectorName = function() {
	let name = GenUtil.pickRandom(App.legendaryNames) + " " + GenUtil.pickRandom(App.greekLetters);
	name = GenUtil.capitalize(name);
	return name;
}

App.censorSector = function(sector) {
	let newSector = {};
	
	newSector.name = sector.name;
	newSector.gmMode = false;
	newSector.schemaVersion = sector.schemaVersion || 3;
	newSector.worldGenerationMode = sector.worldGenerationMode || 'core';
	newSector.tradeRoutes = JSON.parse(JSON.stringify(sector.tradeRoutes || []));
	newSector.polities = (sector.polities || []).map(function(polity) { return App.censorObject(polity, ['relations', 'policy']); });
	newSector.markets = (sector.markets || []).map(function(market) { return App.censorObject(market, ['friction', 'traits']); });
	
	newSector.systems = App.censorObjects(sector.systems, ['pointsOfInterest', 'bodies', 'factionInfluence', 'controllingFactionId', 'controllingFactionName', 'controllingFactionColor', 'manualControllerFactionId', 'isContested']);
	newSector.regions = JSON.parse(JSON.stringify(sector.regions || []));
	for (let i = 0; i < newSector.systems.length; i++) {
		let system = newSector.systems[i];
		system.planets = App.censorObjects(system.planets, ['privateNotes', 'tag1', 'tag2', 'tagCandidate3', 'terrain']);
		system.planets.forEach(function(planet) {
			// Descriptions contain GM-facing tag names; rebuild a player-safe summary.
			planet.description = WorldGenerator.describePlanet(planet, {hideTags:true});
		});
		system.summary = system.planets.length ? system.planets[0].description : 'An uninhabited system with unexplored orbital bodies and uncertain prospects.';
	}
	
	newSector.corporations = App.censorObjects(sector.corporations, ['markets', 'strategy', 'valuation']);
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
	
	for (let i = 0; i < objects.length; i++) {
		newObjects.push(App.censorObject(objects[i], attributes));
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
	table.enableEditing({}, function() { App.setURL(sector); App.createDownloadLink(sector); });
	table.addRows(sector.corporations || []);
	table.sort(0);
};

App.displaySector = function(sector) {
	CampaignTools.enrichSector(sector, true);
	App.currentSector = sector;
	// set up edit mode
	if (sector.gmMode) {
		document.body.classList.remove('no-edit');
	} else {
		document.body.classList.add('no-edit');
	}
	
	// display sector name
	App.displaySectorName(sector);
	
	// set up the export tab
	App.createDownloadLink(sector);
	
	// display the sector hexmap
	App.displayHexmap(sector);
	
	// display the worlds table
	App.displayWorlds(sector);
	
	// Corporation directory is refreshed from live corporate-market relationships below.

	// create religions table
	let religionsOutput = document.getElementById('religions-output');
	religionsOutput.innerHTML = '';
	let religionsTable = new DynTable([
		DynTable.basicColumn('Religion', 'name'),
		DynTable.basicColumn('Leadership', 'leadership'),
		DynTable.basicColumn('Doctrine', 'doctrine'),
	]);
	religionsOutput.appendChild(religionsTable.getElement());
	religionsTable.enableEditing(
		{},
		function() {
			App.setURL(sector);
			App.createDownloadLink(sector);
		}
	);
	
	religionsTable.addRows(sector.religions);
	religionsTable.sort(0);
	
	// create political groups table
	let politicalGroupsOutput = document.getElementById('political-groups-output');
	politicalGroupsOutput.innerHTML = '';
	let politicalGroupsTable = new DynTable([
		DynTable.basicColumn('Political Group', 'name'),
		DynTable.basicColumn('Leadership', 'leadership')
	]);
	politicalGroupsOutput.appendChild(politicalGroupsTable.getElement());
	politicalGroupsTable.enableEditing(
		PoliticalGroupGenerator.template,
		function() {
			App.setURL(sector);
			App.createDownloadLink(sector);
		}
	);	
	
	politicalGroupsTable.addRows(sector.politicalGroups);
	politicalGroupsTable.sort(0);
	
	// create aliens table
	let aliensOutput = document.getElementById('aliens-output');
	aliensOutput.innerHTML = '';
	let aliensTable = new DynTable([
		DynTable.basicColumn('Alien', 'name'),
		DynTable.basicColumn('Type', 'type'),
		DynTable.basicColumn('Body', 'body'),
		DynTable.basicColumn('Lenses', 'lenses'),
		DynTable.basicColumn('Government', 'government'),
	]);
	aliensTable.enableEditing(
		AlienGenerator.template,
		function() {
			App.setURL(sector);
			App.createDownloadLink(sector);
		}
	);	
	aliensOutput.appendChild(aliensTable.getElement());
	
	aliensTable.addRows(sector.aliens);
	aliensTable.sort(0);
	App.renderCampaignPanels(sector);
	App.populateSupplementTargets(sector);
}

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
				App.setURL(sector);
				App.createDownloadLink(sector);
				
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
	gridStat.innerHTML = '<strong>08 × 10</strong> grid';
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

App.createSystemAtHex = function(sector, x, y) {
	if (!sector || !Hexmap._editMode) return null;
	x = Number(x); y = Number(y);
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 9) return null;
	if ((sector.systems || []).some(function(item) { return Number(item.x) === x && Number(item.y) === y; })) {
		window.alert('That hex is already occupied. Choose an empty hex instead.'); return null;
	}
	sector.systems = Array.isArray(sector.systems) ? sector.systems : [];
	var id = App.makeUniqueId(sector.systems, 'SYS-', 2);
	var system = {id:id, x:x, y:y, name:WorldGenerator.generateSystemName(), planets:[], pointsOfInterest:[], bodies:StarSystemGenerator.generate([], {contentDensity:'empty'}), summary:'A newly charted stellar system. Its worlds and installations have not yet been catalogued.'};
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
		return existing;
	}
	var generated = CampaignTools.generateMarkets({systems:[{id:system.id, name:system.name, planets:[planet]}]})[0];
	if (!generated) return null;
	generated.id = App.makeUniqueId(sector.markets, 'MARKET-', 3);
	sector.markets.push(generated);
	return generated;
};

App.syncSystemBodies = function(system) {
	if (!system) return;
	var oldBodies = Array.isArray(system.bodies) ? system.bodies : [];
	var stars = oldBodies.filter(function(body) { return body && body.bodyClass === 'S'; });
	var extras = oldBodies.filter(function(body) { return body && body.bodyClass !== 'S' && body.bodyClass !== 'P' && !body.planetId && !body.worldName && !body.isGeneratedWorld; });
	var worlds = (system.planets || []).map(function(planet, index) {
		planet.id = planet.id || system.id + '-W' + String(index + 1).padStart(2,'0');
		planet.systemId = system.id;
		return {type:'World · TL ' + (planet.techLevel || '?') + ' · ' + (planet.population || 'unknown population'), name:planet.name || ('World ' + (index + 1)), worldName:planet.name || ('World ' + (index + 1)), planetId:planet.id, bodyClass:'P', isGeneratedWorld:true};
	});
	if (!stars.length) stars = StarSystemGenerator.generate([], {contentDensity:'empty'}).filter(function(body) { return body.bodyClass === 'S'; });
	system.bodies = stars.concat(worlds, extras);
};

App.makeUniqueId = function(items, prefix, padLength) {
	var used = new Set((items || []).map(function(item) { return item && item.id; }).filter(Boolean));
	var serial = 1, id; do { id = prefix + String(serial++).padStart(padLength || 2, '0'); } while (used.has(id));
	return id;
};

App.displayWorlds = function(sector) {
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
		DynTable.basicColumn('Tag candidate', 'planet.tagCandidate3'),
		DynTable.basicColumn('Population estimate', 'planet.populationEstimate'),
		DynTable.basicColumn('Terrain', 'planet.terrain'),
	]);
	worldTable.enableEditing(
		WorldGenerator.planetTemplate,
		function() {
			worlds.forEach(function(entry) { entry.planet.description = WorldGenerator.describePlanet(entry.planet); });
			App.displayHexmap(sector);
			App.setURL(sector);
			App.createDownloadLink(sector);
		},
		'planet'
	);
	worldOutput.appendChild(worldTable.getElement());
		
	worldTable.addRows(worlds);
	worldTable.sort(0);	
}

// -------------------------------------------------------------------------- //
// Extended campaign workspaces

App.persistSector = function(sector) {
	if (!sector) return;
	App.setURL(sector);
	App.createDownloadLink(sector);
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
	App.switchToTab('Trade & Routes');
	var card = Array.from(document.querySelectorAll('#markets-output .market-card')).find(function(item) { return item.dataset.marketId === marketId; });
	if (!card) return false;
	card.open = true;
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
	container.innerHTML = '';
	if (!rows || !rows.length) {
		App.appendElement(container, 'p', 'No entries yet. Generate or import a sector with suitable records.', 'empty-note');
		return;
	}
	var table = App.appendElement(container, 'table', null, 'dyntable campaign-table');
	var thead = App.appendElement(table, 'thead');
	var hr = App.appendElement(thead, 'tr');
	headers.forEach(function(header) { App.appendElement(hr, 'th', header); });
	if (action) App.appendElement(hr, 'th', 'Actions');
	var tbody = App.appendElement(table, 'tbody');
	rows.forEach(function(row) {
		var tr = App.appendElement(tbody, 'tr');
		row.values.forEach(function(value) { App.appendElement(tr, 'td', value == null ? '—' : value); });
		if (action) {
			var td = App.appendElement(tr, 'td', null, 'campaign-row-actions');
			var btn = App.appendElement(td, 'button', action.label || 'Edit', 'textbutton campaign-action');
			btn.type = 'button';
			btn.addEventListener('click', function() { action.callback(row.item); });
			if (typeof action.extraButtons === 'function') action.extraButtons(row.item, td, row);
		}
	});
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

App.editCampaignObject = function(title, object, hide, afterSave, lists) {
	var template = {hide:(hide || []), lists:(lists || {})};
	DynEdit.edit(title, object, template, function(saved) {
		if (saved) {
			if (afterSave) afterSave();
			if (App.currentSector) App.persistSector(App.currentSector);
		}
	});
};

App.renderCampaignPanels = function(sector) {
	if (window.CampaignTools) { CampaignTools.recalculateInfluence(sector); CampaignTools.linkCampaignRecords(sector); }
	App.displayCorporationDirectory(sector);
	var status = document.getElementById('faction-turn-status');
	if (status) status.textContent = 'Faction turn ' + (sector.factionTurn || 0) + ' · ' + (sector.factions || []).length + ' active factions';
	App.renderSimpleTable(document.getElementById('factions-output'),
		['Faction','Type','Scale','Force','Cunning','Wealth','HP','FacCreds','Goal','Homeworld','Assets'],
		(sector.factions || []).map(function(f) { return {item:f, values:[f.name, f.type, f.scale, f.force, f.cunning, f.wealth, f.hitPoints + '/' + f.maxHitPoints, f.factionCredits, f.goal, f.homeworld, (f.assets || []).length]}; }),
		{label:'Edit', callback:function(f) { App.editCampaignObject('Edit faction: ' + f.name, f, ['id','assets','rivals','turnLog','lastAction','maxHitPoints','schemaVersion'], function() { App.renderCampaignPanels(sector); }); }});
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

	CampaignTools.ensureDiplomacy(sector);
	App.renderSimpleTable(document.getElementById('diplomacy-output'), ['Faction A','Relationship','Faction B','Trust','Tension','Latest development'], (sector.diplomacy || []).map(function(rel) {
		var a=(sector.factions||[]).find(function(f){return f.id===rel.factionAId;})||{};
		var b=(sector.factions||[]).find(function(f){return f.id===rel.factionBId;})||{};
		return {item:rel,values:[a.name||rel.factionAId,rel.state,b.name||rel.factionBId,rel.trust,rel.tension,rel.lastEvent||'No recent change']};
	}), {label:'Change posture',callback:function(rel){CampaignTools.cycleDiplomacy(sector,rel);CampaignTools.updateMarkets(sector,sector.factionTurn||0);App.renderCampaignPanels(sector);App.displayHexmap(sector);App.persistSector(sector);}});

	CampaignTools.recalculateInfluence(sector);
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
	App.renderSimpleTable(document.getElementById('routes-output'), ['Route','From','To','Hexes','Type','Status'], (sector.tradeRoutes || []).map(function(route) {
		var from = (sector.systems || []).find(function(s) { return s.id === route.fromSystemId; }) || {};
		var to = (sector.systems || []).find(function(s) { return s.id === route.toSystemId; }) || {};
		return {item:route, values:[route.id, from.name || route.fromSystemId, to.name || route.toSystemId, route.distance, route.kind, route.status]};
	}), {label:'Edit', callback:function(route) { App.editCampaignObject('Edit route: ' + route.id, route, ['id','distance'], function() { var from=(sector.systems||[]).find(function(s){return s.id===route.fromSystemId;}), to=(sector.systems||[]).find(function(s){return s.id===route.toSystemId;}); if(from&&to)route.distance=CampaignTools.hexDistance(from,to); CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector,sector.factionTurn||0); App.renderCampaignPanels(sector); App.displayHexmap(sector); }, {fromSystemId:(sector.systems||[]).map(function(s){return s.id;}),toSystemId:(sector.systems||[]).map(function(s){return s.id;})}); }});

	var routeStatus = document.getElementById('route-status');
	if (routeStatus) routeStatus.textContent = (sector.tradeRoutes || []).length + ' links · maximum 3-hex normal drill';
	var marketContainer = document.getElementById('markets-output');
	marketContainer.innerHTML = '';
	(sector.markets || []).forEach(function(market) {
		var details = App.appendElement(marketContainer, 'details', null, 'market-card');
		details.dataset.marketId = market.id;
		var summary = App.appendElement(details, 'summary', null, 'market-summary');
		App.appendElement(summary, 'span', market.planetName, 'market-world');
		App.appendElement(summary, 'span', market.profile + ' · ' + market.goods.length + ' goods', 'market-meta');
		var corps=(market.linkedCorporationIds||[]).map(function(id){var c=(sector.corporations||[]).find(function(corp){return corp.id===id;});return c?c.name:'';}).filter(Boolean);
		var tagLine = App.appendElement(details, 'p', 'System: ' + market.systemName + ' · TL ' + market.techLevel + ' · ' + market.population + ' · Control: ' + (market.controlFactionName||'Independent') + ' · Routes: ' + Number(market.routeAccess||0) + ' · ' + (market.stability||'Unsimulated'), 'market-context');
		if (corps.length) tagLine.appendChild(document.createTextNode(' · Corporate links: ' + corps.join(', ')));
		if (market.traits && market.traits.length) tagLine.appendChild(document.createTextNode(' · Tags: ' + market.traits.join(', ')));
		var marketActions = App.appendElement(details, 'div', null, 'story-controls');
		var marketEdit = App.appendElement(marketActions, 'button', 'Edit market', 'textbutton campaign-action');
		marketEdit.type = 'button'; marketEdit.addEventListener('click', function() {
			var planetOptions = [];
			(sector.systems || []).forEach(function(sys) { (sys.planets || []).forEach(function(p) { planetOptions.push(p.id); }); });
			App.editCampaignObject('Edit market: ' + market.planetName, market, ['id','systemId','goods','traits'], function() { CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector, sector.factionTurn || 0); App.renderCampaignPanels(sector); }, {planetId:planetOptions});
		});
		var viewSystem = App.appendElement(marketActions, 'button', 'View system', 'textbutton campaign-action');
		viewSystem.type = 'button'; viewSystem.addEventListener('click', function() { App.focusSystem(market.systemId); });
		var viewWorld = App.appendElement(marketActions, 'button', 'Locate world', 'textbutton campaign-action');
		viewWorld.type = 'button'; viewWorld.addEventListener('click', function() { if (!App.focusWorld(market.planetId, market.systemId)) App.focusSystem(market.systemId); });
		var marketTableWrap = App.appendElement(details, 'div', null, 'table-output market-table-wrap');
		App.renderSimpleTable(marketTableWrap, ['Good','Category','Supply','Index','Local price','Market note'], market.goods.map(function(g) { return {item:g, values:[g.name, g.category, g.supply, g.priceIndex + '%', g.localPrice.toLocaleString() + ' cr', g.note]}; }), {label:'Edit', callback:function(good) { App.editCampaignObject('Edit market good: ' + good.name, good, [], function() { App.renderCampaignPanels(sector); App.persistSector(sector); }); }});
	});
	if (!(sector.markets || []).length) App.appendElement(marketContainer, 'p', 'No markets generated for this sector.', 'empty-note');

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

App.bindCampaignControls = function() {
	if (App.campaignControlsBound) return;
	App.campaignControlsBound = true;
	function on(id, callback) { var el = document.getElementById(id); if (el) el.addEventListener('click', function() { if (App.currentSector) callback(App.currentSector); }); }
	on('factions-reroll', function(sector) { sector.factions = CampaignTools.generateFactions(sector); sector.factionTurn = 0; sector.factionNews = []; App.renderCampaignPanels(sector); App.persistSector(sector); });
	on('faction-turn-button', function(sector) { CampaignTools.advanceFactionTurn(sector); App.renderCampaignPanels(sector); App.displayHexmap(sector); App.persistSector(sector); });
	on('routes-reroll', function(sector) { sector.tradeRoutes = CampaignTools.generateTradeRoutes(sector); sector.polities = CampaignTools.generatePolities(sector); CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector,sector.factionTurn||0); App.renderCampaignPanels(sector); App.displayHexmap(sector); App.persistSector(sector); });
	on('markets-reroll', function(sector) { sector.markets = CampaignTools.generateMarkets(sector); sector.corporationMarketLinks = null; CampaignTools.linkCampaignRecords(sector); CampaignTools.updateMarkets(sector, sector.factionTurn||0); App.renderCampaignPanels(sector); App.persistSector(sector); });
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
	simpleAppend(systemHeader, 'span', system.name + ' System ', 'inspector-system-name');
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
				if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 9 || collision) {
					system.x = originalX; system.y = originalY;
					window.alert(collision ? 'That hex is already occupied. The system location was restored.' : 'Hex coordinates must be within the map: X 0–7 and Y 0–9. The system location was restored.');
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
		DynEdit.edit(title, planet, WorldGenerator.planetTemplate, function(saved) {
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
		DynEdit.edit('Add orbital survey object to ' + system.name, body, {hide:['bodyClass','isGeneratedWorld']}, function(saved) {
			if (!saved) return;
			body.type = String(body.type || 'Unclassified object').trim() || 'Unclassified object';
			body.name = String(body.name || 'Unnamed object').trim() || 'Unnamed object';
			body.bodyClass = 'N'; body.isGeneratedWorld = false; body.id = App.makeUniqueId(system.bodies || [], system.id + '-B', 2);
			system.bodies = Array.isArray(system.bodies) ? system.bodies : []; system.bodies.push(body);
			App.refreshSectorAfterMapEdit(sector, system);
		});
	});
	appendText(systemEditContainer, ' | ');
	let addPoiLink = simpleAppend(systemEditContainer, 'span', 'add point of interest', 'textbutton');
	addPoiLink.addEventListener('click', function() {
		let point = {name:'Uncatalogued site', type:'Ruins', occupants:'Unspecified', situation:'An unexplored site awaits investigation.'};
		DynEdit.edit('Add point of interest to ' + system.name, point, {}, function(saved) {
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
				DynEdit.edit(title, planet, WorldGenerator.planetTemplate, function(saved) {
					if (!saved) return;
					planet.description = WorldGenerator.describePlanet(planet);
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
		
		if ('tag1' in planet) {
			let tag = WorldGenerator.tagDictionary.get(planet.tag1);
			createTagSpoiler(planetBodyElement, tag);
		}
		
		if ('tag2' in planet) {
			let tag = WorldGenerator.tagDictionary.get(planet.tag2);
			createTagSpoiler(planetBodyElement, tag);
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
			editPoint.addEventListener('click', function() { DynEdit.edit('Editing point of interest: ' + point.name, point, {}, function(saved) { if (saved) App.refreshSectorAfterMapEdit(sector, system); }); });
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
			system.bodies = StarSystemGenerator.generate(Array.isArray(system.planets) ? system.planets : [], {contentDensity:(sector.generationSettings && sector.generationSettings.worldDensity) || 'default'});
			App.setURL(sector);
			App.createDownloadLink(sector);
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
			let row = appendRow(bodyTableBody, [String(body.type || 'Unclassified body'), name]);
			row.className = 'system-survey-row';
			row.cells[0].className = 'system-survey-type';
			row.cells[1].className = 'system-survey-name';
			row.setAttribute('data-body-class', String(body.bodyClass || 'N'));
			if (!body.isGeneratedWorld && body.bodyClass !== 'S' && !body.planetId && !body.worldName) {
				let actions = simpleAppend(row.cells[1], 'span', '', 'edit-zone survey-row-actions');
				appendText(actions, ' ');
				let editBody = simpleAppend(actions, 'span', 'edit', 'textbutton');
				editBody.addEventListener('click', function() { DynEdit.edit('Editing survey object: ' + (body.name || body.type), body, {hide:['bodyClass','isGeneratedWorld','planetId','worldName','id']}, function(saved) { if (saved) { body.bodyClass='N'; body.isGeneratedWorld=false; App.refreshSectorAfterMapEdit(sector,system); } }); });
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

App.createDownloadLink = function(sector) {
	let data = JSON.stringify(sector, null, ' ');
	
	let exportJsonGmElement = document.getElementById('export-json-gm');
	exportJsonGmElement.href = window.URL.createObjectURL(new Blob([data], {type: 'text/plain'}));
	exportJsonGmElement.download = ('Sector'+sector.name).replace(/ /g, '')+'_GM.json';
	
	let censoredSector = App.censorSector(sector)
	data = JSON.stringify(censoredSector, null, ' ');

	let exportJsonPlayerElement = document.getElementById('export-json-player');
	exportJsonPlayerElement.href = window.URL.createObjectURL(new Blob([data], {type: 'text/plain'}));
	exportJsonPlayerElement.download = ('Sector'+sector.name).replace(/ /g, '')+'_Player.json';
	
	let exportURLGMElement = document.getElementById('export-url-gm');
	exportURLGMElement.value = URLParam.createURL({data:App.compressSector(sector)});
	
	let exportURLPlayerElement = document.getElementById('export-url-player');
	exportURLPlayerElement.value = URLParam.createURL({data:App.compressSector(censoredSector)});	
}