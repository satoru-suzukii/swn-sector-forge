/*
 * Sectors Without Number import adapter for Sector Forge.
 * Supports the upstream application's translated JSON export and the CSV format
 * used by its entity exports. Unknown/source-only data is retained in swnImport
 * so unsupported entities are not discarded by the import step.
 */
var SwnImport = (function() {
  var ENTITY_TYPES = new Set([
    'asteroidBase','asteroidBelt','blackHole','deepSpaceStation','gasGiantMine',
    'layer','moon','moonBase','navigation','note','orbitalRuin','planet',
    'refuelingStation','researchBase','sector','spaceStation','system','settings'
  ]);
  var TYPE_LABELS = {
    'system':'System','blackHole':'Black Hole','planet':'Planet','moon':'Moon',
    'asteroidBelt':'Asteroid Belt','asteroidBase':'Asteroid Base',
    'deepSpaceStation':'Deep Space Station','gasGiantMine':'Gas Giant Mine',
    'moonBase':'Moon Base','orbitalRuin':'Orbital Ruin','refuelingStation':'Refueling Station',
    'researchBase':'Research Base','spaceStation':'Space Station','note':'Note',
    'layer':'Layer','navigation':'Navigation','sector':'Sector','settings':'Settings'
  };
  var SURVEY_ENTITY_TYPES = new Set(['moon','asteroidBelt','asteroidBase','deepSpaceStation','gasGiantMine','moonBase','orbitalRuin','refuelingStation','researchBase','spaceStation']);

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
  function fileStem(filename) {
    return String(filename || 'Imported Sector').replace(/\\/g, '/').split('/').pop().replace(/\.(json|csv|txt)$/i, '').trim() || 'Imported Sector';
  }
  function safeId(value, prefix) {
    var text = String(value == null ? '' : value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return (prefix || 'SWN-') + (text || Math.random().toString(36).slice(2, 9));
  }
  function asArray(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return value == null ? '' : String(value); }
  function getAttrs(entity) { return entity && entity.attributes && typeof entity.attributes === 'object' ? entity.attributes : {}; }
  function labelTag(tag) {
    if (tag == null) return '';
    if (typeof tag === 'string') return tag;
    return text(tag.name || tag.label || tag.key || '');
  }
  function tagNames(attributes) {
    var value = attributes && attributes.tags;
    if (!Array.isArray(value)) return typeof value === 'string' ? value.split(/\s*,\s*/).filter(Boolean) : [];
    return value.map(labelTag).filter(Boolean);
  }
  function parseCoordinates(value) {
    var compact = text(value).trim().replace(/\s/g, '');
    var match = compact.match(/^(\d{2})(\d{2})$/);
    if (!match) return null;
    return {x:Number(match[1]), y:Number(match[2])};
  }
  function dimensionsFor(records) {
    var maxX = -1, maxY = -1;
    records.forEach(function(record) {
      var rawX = record.mapX !== undefined ? record.mapX : record.x;
      var rawY = record.mapY !== undefined ? record.mapY : record.y;
      var hasX = rawX !== null && rawX !== undefined && rawX !== '';
      var hasY = rawY !== null && rawY !== undefined && rawY !== '';
      var x = Number(rawX), y = Number(rawY);
      if (hasX && Number.isInteger(x) && x >= 0) maxX = Math.max(maxX, x);
      if (hasY && Number.isInteger(y) && y >= 0) maxY = Math.max(maxY, y);
    });
    return {
      columns: Math.max(10, Math.min(20, maxX + 1)),
      rows: Math.max(12, Math.min(20, maxY + 1))
    };
  }
  function baseSector(name, mode, format, sourceData, records, warnings) {
    return {
      name:name || 'Imported Sector', gmMode:true, schemaVersion:3,
      grid:dimensionsFor(records), worldGenerationMode:'core',
      systems:[], corporations:null, religions:null, politicalGroups:null, aliens:null,
      regions:[], tradeRoutes:null, polities:null, markets:null, factions:null, adventures:null,
      threats:null, people:null, supplementContent:[], corporationMarketLinks:null, diplomacy:null, factionNews:[],
      importMetadata:{source:'Sectors Without Number', format:format, mode:mode === 'enrich' ? 'enrich' : 'preserve', warnings:warnings || []},
      swnImport:{source:'Sectors Without Number', format:format, sourceFile:'', importedAt:new Date().toISOString(),
        records:records, sourceData:sourceData}
    };
  }
  function buildSystem(record, type, serial) {
    var attrs = record.attributes || record.sourceAttributes || {};
    var tags = tagNames(attrs);
    var sys = {
      id:safeId(record.sourceId || record.id || serial, 'SWN-SYS-'),
      sourceId:record.sourceId || record.id || '', sourceEntityType:type, sourceIsHidden:!!record.isHidden,
      x:Number(record.mapX !== undefined && record.mapX !== null ? record.mapX : record.x),
      y:Number(record.mapY !== undefined && record.mapY !== null ? record.mapY : record.y),
      name:record.name || ('Unnamed ' + (TYPE_LABELS[type] || type)),
      planets:[], pointsOfInterest:[], bodies:[], summary:text(attrs.description || ''),
      occupation:text(attrs.occupation || record.occupation || ''), situation:text(attrs.situation || record.situation || ''),
      neighbors:record.neighbors || '', tags:tags, sourceAttributes:clone(attrs)
    };
    sys.importedEntities = [];
    return sys;
  }
  function sourceTypeKey(record) {
    var raw = text(record && (record.entityType || record.type));
    if (TYPE_LABELS[raw]) return raw;
    var match = Object.keys(TYPE_LABELS).find(function(key) { return TYPE_LABELS[key].toLocaleLowerCase() === raw.toLocaleLowerCase(); });
    return match || raw;
  }
  function attachImportedSurveyBody(system, record) {
    if (!system || !SURVEY_ENTITY_TYPES.has(sourceTypeKey(record)) || !record.name) return;
    var sourceId = text(record.sourceId || record.id || '');
    if ((system.bodies || []).some(function(body) { return body.sourceEntityId && body.sourceEntityId === sourceId; })) return;
    var attrs = record.attributes || record.sourceAttributes || {};
    var type = sourceTypeKey(record);
    system.bodies.push({name:record.name, worldName:record.name, type:TYPE_LABELS[type] || text(record.type),
      bodyClass:'N', isGeneratedWorld:false, sourceEntityId:sourceId, sourceEntityType:type, importedFromSWN:true,
      occupation:text(attrs.occupation || record.occupation || ''), situation:text(attrs.situation || record.situation || ''),
      description:text(attrs.description || record.description || ''), tags:tagNames(attrs),
      sourceParent:text(record.parent || ''), sourceParentName:text(record.parentName || ''),
      sourceParentEntity:text(record.parentEntity || ''), sourceIsHidden:!!record.isHidden, sourceAttributes:clone(attrs)});
  }

  function enrichImportedDetails(sector) {
    if (!sector || !Array.isArray(sector.systems)) return;
    sector.systems.forEach(function(system) {
      (system.bodies || []).forEach(function(body) {
        if (!body || !body.importedFromSWN || !body.sourceEntityType || typeof SwnEntityEnrichment === 'undefined') return;
        var detailRecord = {type:body.sourceEntityType, occupation:body.occupation, situation:body.situation,
          generatedFields:body.generatedFields || []};
        SwnEntityEnrichment.fill(detailRecord);
        body.occupation = detailRecord.occupation;
        body.situation = detailRecord.situation;
        body.generatedFields = detailRecord.generatedFields;
      });
      (system.planets || []).forEach(function(planet) {
        if (!planet.gravity && typeof WorldGenerator !== 'undefined' && typeof WorldGenerator.generateGravityForPopulation === 'function') {
          planet.gravity = WorldGenerator.generateGravityForPopulation(planet.population, planet.populationNumber);
          planet.gravityGeneratedByForge = true;
        }
      });
    });
  }

  function buildPlanet(record, system) {
    var attrs = record.attributes || record.sourceAttributes || {};
    var tags = tagNames(attrs);
    if (!tags.length && record.tags) tags = Array.isArray(record.tags) ? record.tags : text(record.tags).split(/\s*,\s*/).filter(Boolean);
    var planet = {
      id:safeId(record.sourceId || record.id || record.name, system.id + '-SWN-'),
      sourceId:record.sourceId || record.id || '', systemId:system.id,
      name:record.name || 'Unnamed World',
      tag1:tags[0] || '', tag2:tags[1] || '', tagCandidate3:tags[2] || '', tags:tags,
      description:text(attrs.description || record.description || ''),
      atmosphere:text(attrs.atmosphere || ''), temperature:text(attrs.temperature || ''),
      biosphere:text(attrs.biosphere || ''), population:text(attrs.population || ''),
      techLevel:text(attrs.techLevel || attrs.tech_level || ''), gravity:text(attrs.gravity || ''),
      occupation:text(attrs.occupation || record.occupation || ''), situation:text(attrs.situation || record.situation || ''),
      sourceEntityType:'planet', sourceIsHidden:!!record.isHidden, sourceAttributes:clone(attrs), importedEntities:[]
    };
    return planet;
  }
  function addSourceTables(sector, records) {
    sector.swnImport.records = records.map(function(record) {
      var attrs = record.attributes || record.sourceAttributes || {};
      var tags = tagNames(attrs);
      if (!tags.length && record.tags) tags = Array.isArray(record.tags) ? record.tags : text(record.tags).split(/\s*,\s*/).filter(Boolean);
      return {
        id:text(record.id || record.sourceId || ''), type:text(record.type || record.entityType || ''),
        name:text(record.name || ''),
        x:(record.mapX !== undefined ? record.mapX : record.x) == null ? '' : (record.mapX !== undefined ? record.mapX : record.x),
        y:(record.mapY !== undefined ? record.mapY : record.y) == null ? '' : (record.mapY !== undefined ? record.mapY : record.y),
        parent:text(record.parentName || record.parent || ''), parentId:text(record.parent || ''), parentEntity:text(record.parentEntity || ''), isHidden:!!record.isHidden,
        occupation:text(attrs.occupation || record.occupation || ''), situation:text(attrs.situation || record.situation || ''),
        tags:tags, attributes:clone(attrs), raw:clone(record.raw || record)
      };
    });
  }

  function coordinateKeyToPoint(key) {
    var match = text(key).match(/^(\d{2})(\d{2})$/);
    return match ? {x:Number(match[1]), y:Number(match[2])} : null;
  }
  function safeColor(value, fallback) {
    var color = text(value || '').trim();
    return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : (fallback || '#70e0cf');
  }
  function importNavigationRoutes(data, sector) {
    var routes = data && data.routes && typeof data.routes === 'object' ? data.routes : {};
    sector.swnImport.navigationRoutes = Object.keys(routes).map(function(id) {
      var route = routes[id] || {};
      var rawPath = Array.isArray(route.route) ? route.route : (Array.isArray(route.hexes) ? route.hexes : []);
      var hexes = rawPath.map(coordinateKeyToPoint).filter(function(point) { return point && point.x >= 0 && point.y >= 0 && point.x < 20 && point.y < 20; });
      return {id:text(route.id || id), name:text(route.name || route.label || ('Navigation route ' + id)),
        hexes:hexes, color:safeColor(route.color, '#dbdbdb'), width:text(route.width || 'normal'),
        style:text(route.type || route.style || 'solid'), isHidden:!!route.isHidden, raw:clone(route)};
    }).filter(function(route) { return route.hexes.length > 1; });
  }
  function importLayerRegions(data, sector) {
    var layers = data && data.layers && typeof data.layers === 'object' ? data.layers : {};
    sector.swnImport.layers = [];
    Object.keys(layers).forEach(function(layerId, layerIndex) {
      var layer = layers[layerId] || {};
      var regions = layer.regions && typeof layer.regions === 'object' ? layer.regions : {};
      var hexes = layer.hexes && typeof layer.hexes === 'object' ? layer.hexes : {};
      var layerSummary = {id:text(layer.id || layerId), name:text(layer.name || ('Layer ' + (layerIndex + 1))), regionCount:Object.keys(regions).length, hexCount:Object.keys(hexes).length, isHidden:!!layer.isHidden};
      sector.swnImport.layers.push(layerSummary);
      Object.keys(regions).forEach(function(regionId, regionIndex) {
        var region = regions[regionId] || {};
        var membership = [];
        Object.keys(hexes).forEach(function(hexKey) {
          var point = coordinateKeyToPoint(hexKey), hex = hexes[hexKey] || {};
          var regionIds = Array.isArray(hex.regions) ? hex.regions : [];
          if (!point || regionIds.indexOf(regionId) < 0 || point.x >= sector.grid.columns || point.y >= sector.grid.rows) return;
          membership.push(point);
        });
        if (!membership.length) return;
        var id = safeId(layerId + '-' + regionId, 'SWN-REGION-');
        if (sector.regions.some(function(existing){return existing.id===id;})) id += '-' + (regionIndex + 1);
        sector.regions.push({id:id, name:(layerSummary.name ? layerSummary.name + ' / ' : '') + text(region.name || ('Region ' + (regionIndex + 1))),
          color:safeColor(region.color, '#70e0cf'), hexes:membership, importedFromSWN:true,
          sourceLayerId:text(layerId), sourceRegionId:text(regionId), sourceLayerHidden:!!layer.isHidden, sourceHidden:!!region.isHidden});
      });
    });
  }
  function summarizeSourceFactions(data, sector) {
    var factions = data && data.factions && typeof data.factions === 'object' ? data.factions : {};
    sector.swnImport.factions = Object.keys(factions).map(function(id) {
      var faction = factions[id] || {};
      var assets = faction.assets && typeof faction.assets === 'object' ? faction.assets : {};
      var goal = faction.goal;
      return {id:text(faction.id || id), name:text(faction.name || ('Faction ' + id)),
        force:faction.force == null ? '' : faction.force, cunning:faction.cunning == null ? '' : faction.cunning,
        wealth:faction.wealth == null ? '' : faction.wealth, hitPoints:faction.hitPoints == null ? '' : faction.hitPoints,
        goal:typeof goal === 'object' ? text(goal.name || goal.description || '') : text(goal),
        homeworld:text(faction.homeworld || ''), relationship:text(faction.relationship || ''),
        assetCount:Object.keys(assets).length, tags:clone(faction.tags || []), raw:clone(faction)};
    });
  }

  function isNativeExport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || Array.isArray(data.systems)) return false;
    var group = data.system;
    if (!group || typeof group !== 'object' || Array.isArray(group)) return false;
    return Object.keys(group).some(function(id) {
      var entity = group[id];
      return entity && typeof entity === 'object' && (entity.name || entity.attributes || entity.x != null || entity.parentEntity);
    });
  }

  function fromJSON(data, filename, mode) {
    if (!isNativeExport(data)) throw new Error('This JSON does not look like a Sectors Without Number native export.');
    var flat = [];
    Object.keys(data).forEach(function(groupName) {
      if (!ENTITY_TYPES.has(groupName)) return;
      var group = data[groupName];
      if (!group || typeof group !== 'object' || Array.isArray(group)) return;
      Object.keys(group).forEach(function(key) {
        var entity = group[key];
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return;
        var type = text(entity.type || groupName);
        var attrs = getAttrs(entity);
        var x = entity.x, y = entity.y;
        var coordinatesFromEntity = x != null && y != null;
        if (x == null || y == null) {
          var coord = parseCoordinates(entity.location || entity.coordinates || '');
          if (coord) { x = coord.x; y = coord.y; }
        }
        // SWN entity coordinates are one-based internally. Its route/layer hex keys
        // and Sector Forge coordinates are zero-based, so normalize only entity x/y.
        var mapX = x == null ? null : Number(x) - (coordinatesFromEntity ? 1 : 0);
        var mapY = y == null ? null : Number(y) - (coordinatesFromEntity ? 1 : 0);
        flat.push({id:text(entity.id || key), sourceId:text(entity.id || key), type:type,
          entityType:groupName, name:text(entity.name || ''), x:x == null ? null : Number(x),
          y:y == null ? null : Number(y), mapX:mapX, mapY:mapY, parent:text(entity.parent || ''),
          parentEntity:text(entity.parentEntity || ''), isHidden:!!entity.isHidden, attributes:clone(attrs), raw:clone(entity)});
      });
    });
    var sourceRecordsById = new Map(flat.map(function(record) { return [record.id, record]; }));
    flat.forEach(function(record) {
      var parentRecord = sourceRecordsById.get(record.parent);
      record.parentName = parentRecord && parentRecord.name ? parentRecord.name : record.parent;
    });
    // Never let JavaScript coerce a missing coordinate to zero. Imported child
    // entities often have no map location because their parent relationship is
    // the authoritative way to locate them in a sector.
    function hasUsableMapCoordinates(record) {
      if (!record) return false;
      var x = record.mapX, y = record.mapY;
      if (x === null || x === undefined || x === '' || y === null || y === undefined || y === '') return false;
      return Number.isInteger(Number(x)) && Number.isInteger(Number(y));
    }
    var warnings = [];
    var sectorEntity = (data.sector && Object.values(data.sector).find(function(x){return x&&typeof x==='object'&&x.name;})) || null;
    var name = sectorEntity && sectorEntity.name || fileStem(filename).replace(/\s*-\s*\d{4}.*$/, '');
    var sector = baseSector(name, mode, 'json', clone(data), flat, warnings);
    sector.swnImport.sourceFile = filename || '';
    var sourceToSystem = new Map(), sourceEntityToSystem = new Map(), nameToSystems = new Map();
    var top = flat.filter(function(rec) {
      return (rec.entityType === 'system' || rec.entityType === 'blackHole' || rec.type === 'system' || rec.type === 'blackHole') &&
        hasUsableMapCoordinates(rec);
    });
    top.forEach(function(rec, i) {
      if (Number(rec.mapX) < 0 || Number(rec.mapY) < 0 || Number(rec.mapX) >= 20 || Number(rec.mapY) >= 20) {
        warnings.push('System "' + rec.name + '" has coordinates outside the supported 20×20 safety limit and was not mapped.'); return;
      }
      var keyType = rec.entityType || rec.type;
      var sys = buildSystem(rec, keyType, i + 1);
      // Imported coordinates determine required dimensions; keep the standard 10×12 minimum.
      sector.systems.push(sys);
      sourceToSystem.set(rec.id, sys);
      sourceEntityToSystem.set(rec.id, sys);
      var nameKey = rec.name.toLocaleLowerCase();
      if (!nameToSystems.has(nameKey)) nameToSystems.set(nameKey, []);
      nameToSystems.get(nameKey).push(sys);
    });
    if (!sector.systems.length) warnings.push('No top-level systems with coordinates were found. The source data is retained in the archive, but the map will be empty.');

    var sourceToPlanet = new Map();
    flat.filter(function(rec){return (rec.entityType || rec.type) === 'planet';}).forEach(function(rec) {
      var parentSys = sourceToSystem.get(rec.parent);
      if (!parentSys && rec.parent) {
        var candidates = nameToSystems.get(rec.parent.toLocaleLowerCase()) || [];
        if (candidates.length === 1) parentSys = candidates[0];
      }
      if (!parentSys && hasUsableMapCoordinates(rec)) {
        parentSys = sector.systems.find(function(sys){return sys.x===Number(rec.mapX)&&sys.y===Number(rec.mapY);});
      }
      if (!parentSys) {
        warnings.push('World "' + (rec.name || rec.id) + '" has no unambiguous parent system; retained in source records only.'); return;
      }
      var planet = buildPlanet(rec, parentSys);
      parentSys.planets.push(planet);
      sourceToPlanet.set(rec.id, planet);
      sourceEntityToSystem.set(rec.id, parentSys);
      parentSys.bodies.push({name:planet.name, worldName:planet.name, planetId:planet.id, bodyClass:'P', isGeneratedWorld:false, type:'Imported SWN world', sourceEntityId:rec.id});
    });
    // Resolve each entity's owning system by walking its typed parent graph.
    // This is deliberately independent of JSON object/group order: for example,
    // SWN exports asteroidBase before asteroidBelt even though bases can belong
    // to belts, which in turn belong to systems.
    var resolvingSystems = new Set();
    function resolveSystemForRecord(rec) {
      if (!rec) return null;
      if (sourceEntityToSystem.has(rec.id)) return sourceEntityToSystem.get(rec.id);
      if (resolvingSystems.has(rec.id)) return null; // malformed/cyclic parent graph
      resolvingSystems.add(rec.id);
      var resolved = null;
      if (rec.parent) {
        resolved = sourceEntityToSystem.get(rec.parent) || null;
        if (!resolved) {
          var parentRecord = sourceRecordsById.get(rec.parent);
          if (parentRecord) resolved = resolveSystemForRecord(parentRecord);
          else {
            var namedParents = nameToSystems.get(text(rec.parent).toLocaleLowerCase()) || [];
            if (namedParents.length === 1) resolved = namedParents[0];
          }
        }
      }
      // Coordinates are only a last-resort fallback when both values really
      // exist. Null/blank coordinates must never resolve to hex (0,0).
      if (!resolved && hasUsableMapCoordinates(rec)) {
        resolved = sector.systems.find(function(sys) {
          return sys.x === Number(rec.mapX) && sys.y === Number(rec.mapY);
        }) || null;
      }
      resolvingSystems.delete(rec.id);
      if (resolved) sourceEntityToSystem.set(rec.id, resolved);
      return resolved;
    }
    flat.forEach(function(rec) {
      var type = rec.entityType || rec.type;
      if (type === 'sector' || type === 'system' || type === 'blackHole' || type === 'planet') return;
      var parent = sourceToSystem.get(rec.parent) || sourceToPlanet.get(rec.parent) || null;
      var parentSystem = resolveSystemForRecord(rec);
      if (parent && parent.systemId) {
        parentSystem = sector.systems.find(function(sys) { return sys.id === parent.systemId; }) || parentSystem;
      }
      var sourceRecord = {id:rec.id, type:type, name:rec.name, parent:rec.parent, parentName:rec.parentName,
        parentEntity:rec.parentEntity, isHidden:!!rec.isHidden, attributes:clone(rec.attributes), raw:clone(rec.raw)};
      if (parent && Array.isArray(parent.importedEntities)) parent.importedEntities.push(sourceRecord);
      else if (parentSystem) parentSystem.importedEntities.push(sourceRecord);
      if (parentSystem) {
        sourceEntityToSystem.set(rec.id, parentSystem);
        attachImportedSurveyBody(parentSystem, rec);
      } else if (SURVEY_ENTITY_TYPES.has(type)) {
        warnings.push('Imported ' + (TYPE_LABELS[type] || type) + ' "' + (rec.name || rec.id) + '" has no resolvable parent system; retained in source records only.');
      }
    });
    sector.grid = dimensionsFor(flat);
    addSourceTables(sector, flat);
    if (mode === 'enrich') enrichImportedDetails(sector);
    importNavigationRoutes(data, sector);
    importLayerRegions(data, sector);
    summarizeSourceFactions(data, sector);
    sector.importMetadata.warnings = warnings;
    sector.importMetadata.systemsMapped = sector.systems.length;
    sector.importMetadata.recordsPreserved = flat.length;
    return sector;
  }

  // RFC-4180 style CSV reader, including quoted commas, embedded newlines, and escaped quotes.
  function parseCSV(input) {
    var rows = [], row = [], field = '', quoted = false;
    input = String(input || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < input.length; i++) {
      var c = input[i], next = input[i + 1];
      if (quoted) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else {
        if (c === '"' && field === '') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && next === '\n') i++;
          row.push(field); field = '';
          if (row.some(function(v){return String(v).trim()!=='';})) rows.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); if (row.some(function(v){return String(v).trim()!=='';})) rows.push(row); }
    if (!rows.length) throw new Error('The CSV file is empty.');
    var headers = rows.shift().map(function(h){return h.trim();});
    return rows.map(function(values) {
      var result = {}; headers.forEach(function(header, index){ result[header] = text(values[index] || '').trim(); });
      return result;
    });
  }
  function fromCSV(csv, filename, mode) {
    var rows = parseCSV(csv);
    if (!rows.length || !rows[0].hasOwnProperty('Entity Type') || !rows[0].hasOwnProperty('Location')) {
      throw new Error('CSV must contain the Sectors Without Number columns Name, Entity Type, and Location.');
    }
    var warnings = [];
    var records = rows.map(function(row, i) {
      var coord = parseCoordinates(row.Location);
      if (!coord && row.Location) warnings.push('Row ' + (i + 2) + ' has an unrecognized location "' + row.Location + '".');
      return {id:'csv-' + (i + 1), sourceId:'csv-' + (i + 1), type:row['Entity Type'], entityType:row['Entity Type'],
        name:row.Name || '', x:coord ? coord.x : null, y:coord ? coord.y : null,
        mapX:coord ? coord.x : null, mapY:coord ? coord.y : null,
        parent:row.Parent || '', parentName:row.Parent || '', parentEntity:'', isHidden:false, neighbors:row.Neighbors || '',
        occupation:row.Occupation || '', situation:row.Situation || '', tags:row.Tags || '', raw:clone(row),
        attributes:{occupation:row.Occupation || '', situation:row.Situation || '', tags:(row.Tags || '').split(/\s*,\s*/).filter(Boolean)}};
    });
    var sectorName = fileStem(filename);
    var sector = baseSector(sectorName, mode, 'csv', clone(rows), records, warnings);
    sector.swnImport.sourceFile = filename || '';
    var topTypes = new Set(['System','Black Hole']);
    var systemByName = new Map(), systemRecords = [];
    records.forEach(function(rec, i) {
      if (!topTypes.has(rec.type)) return;
      if (rec.x === null || rec.x === undefined || rec.y === null || rec.y === undefined || !Number.isInteger(rec.x) || !Number.isInteger(rec.y) || rec.x < 0 || rec.y < 0) {
        warnings.push('Top-level entity "' + rec.name + '" has no usable hex location and was retained in source data only.'); return;
      }
      var sys = buildSystem(rec, rec.type === 'Black Hole' ? 'blackHole' : 'system', i + 1);
      sys.neighbors = rec.neighbors || '';
      sys.occupation = rec.occupation || '';
      sys.situation = rec.situation || '';
      sys.tags = rec.attributes.tags || [];
      sector.systems.push(sys);
      systemRecords.push({record:rec, system:sys});
      var key = rec.name.toLocaleLowerCase();
      if (!systemByName.has(key)) systemByName.set(key, []);
      systemByName.get(key).push(sys);
    });
    function resolveParent(name, x, y) {
      var candidates = systemByName.get(text(name).toLocaleLowerCase()) || [];
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        var same = candidates.find(function(sys){return sys.x===x&&sys.y===y;});
        if (same) return same;
      }
      if (Number.isInteger(x) && Number.isInteger(y)) {
        var at = sector.systems.find(function(sys){return sys.x===x&&sys.y===y;});
        if (at) return at;
      }
      return null;
    }
    records.forEach(function(rec) {
      if (rec.type !== 'Planet') return;
      var system = resolveParent(rec.parent, rec.x, rec.y);
      if (!system) {
        warnings.push('World "' + rec.name + '" could not be linked to a unique system; retained in source data only.'); return;
      }
      var planet = buildPlanet(rec, system);
      planet.occupation = rec.occupation || '';
      planet.situation = rec.situation || '';
      system.planets.push(planet);
      system.bodies.push({name:planet.name, worldName:planet.name, planetId:planet.id, bodyClass:'P', isGeneratedWorld:false, type:'Imported SWN world'});
    });
    // Keep every CSV entity discoverable, and link station/ruin/moon rows to a parent when possible.
    records.forEach(function(rec) {
      if (topTypes.has(rec.type) || rec.type === 'Planet') return;
      // Resolve the named parent before falling back to hex location so moons and
      // orbital facilities remain attached to their world when the CSV permits it.
      var parentPlanet = sector.systems.flatMap(function(sys){return sys.planets||[];}).find(function(planet){return planet.name.toLocaleLowerCase() === text(rec.parent).toLocaleLowerCase();});
      var parentSystem = parentPlanet ? sector.systems.find(function(sys) { return sys.id === parentPlanet.systemId; }) : resolveParent(rec.parent, rec.x, rec.y);
      var sourceRecord = {id:rec.id,type:rec.type,name:rec.name,occupation:rec.occupation,situation:rec.situation,tags:rec.tags,raw:clone(rec.raw)};
      if (parentPlanet) parentPlanet.importedEntities.push(sourceRecord);
      else if (parentSystem) parentSystem.importedEntities.push(sourceRecord);
      if (parentSystem) attachImportedSurveyBody(parentSystem, rec);
    });
    sector.grid = dimensionsFor(records);
    addSourceTables(sector, records);
    if (mode === 'enrich') enrichImportedDetails(sector);
    sector.importMetadata.warnings = warnings;
    sector.importMetadata.systemsMapped = sector.systems.length;
    sector.importMetadata.recordsPreserved = records.length;
    return sector;
  }

  return {isNativeExport:isNativeExport, fromJSON:fromJSON, fromCSV:fromCSV, parseCSV:parseCSV};
})();
