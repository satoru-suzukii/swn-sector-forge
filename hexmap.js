/* Sector Forge 2.5 — static, selectable and explicitly editable hex cartography.
 * The SVG viewport is immutable: there is no drag, pan, wheel zoom or marker-following
 * behavior. System relocation is an explicit select -> move mode -> click-empty-hex action.
 */
var Hexmap = {
  _STYLE: null,
  _activeRegionId: '',
  _moveMode: false,
  _editMode: false,
  _showFactionDomination: true,
  _selectedHex: null,
  _state: null,
  _palette: ['#70e0cf', '#e6bd83', '#a7a7ff', '#e78eab', '#8bb4ef', '#b4db85', '#d6a4f2', '#f0a878'],
  _width: 530,
  _height: 745,
  _radius: 39,
  getStyle: function(name) {
    if (!this._STYLE) this._STYLE = window.getComputedStyle(document.body);
    return this._STYLE.getPropertyValue(name) || '';
  },
  _center: function(x, y) {
    return {x: 48 + Number(x) * 58.5, y: 40 + (Number(y) + .5 * (Number(x) % 2)) * 67.55};
  },
  _hexPoints: function(x, y, r) {
    var c = this._center(x, y), p = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 3 * i;
      p.push((c.x + Math.cos(a) * r).toFixed(2) + ',' + (c.y + Math.sin(a) * r).toFixed(2));
    }
    return p.join(' ');
  },
  _escape: function(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  },
  _status: function(message) {
    var status = document.getElementById('map-interaction-status');
    if (status) status.textContent = message || 'Map is static. Select a system or hex; nothing moves unless you choose an edit action.';
  },
  _syncMoveButton: function() {
    var move = document.getElementById('map-move-selected');
    var cancel = document.getElementById('map-cancel-move');
    var editToggle = document.getElementById('map-edit-toggle');
    var dominationToggle = document.getElementById('map-domination-toggle');
    var editTools = document.getElementById('map-edit-tools');
    if (editToggle) {
      editToggle.textContent = 'Edit mode: ' + (this._editMode ? 'ON' : 'OFF');
      editToggle.setAttribute('aria-pressed', this._editMode ? 'true' : 'false');
    }
    if (dominationToggle) {
      dominationToggle.textContent = 'Faction domination: ' + (this._showFactionDomination ? 'ON' : 'OFF');
      dominationToggle.setAttribute('aria-pressed', this._showFactionDomination ? 'true' : 'false');
    }
    if (editTools) editTools.hidden = !this._editMode;
    if (document.body && document.body.classList) document.body.classList.toggle('map-edit-mode-off', !this._editMode);
    if (move) {
      move.disabled = !this._editMode || !(this._state && this._state.selectedSystem);
      move.textContent = this._moveMode ? 'Choose an empty hex…' : 'Move selected system';
      move.setAttribute('aria-pressed', this._moveMode ? 'true' : 'false');
    }
    if (cancel) cancel.hidden = !this._editMode || !this._moveMode;
  },
  setEditMode: function(enabled) {
    this._editMode = !!enabled;
    if (!this._editMode) {
      this._moveMode = false;
      this._activeRegionId = '';
      var regionSelect = document.getElementById('map-region-select');
      if (regionSelect) regionSelect.value = '';
      var regionDelete = document.getElementById('map-region-delete');
      if (regionDelete) regionDelete.disabled = true;
    }
    if (this._state) this.render(this._state.svg, this._state.sector, this._state.selectedSystem);
    this._syncMoveButton();
    this._status(this._editMode
      ? 'Edit mode is ON. Move systems or select a region to edit its hex membership.'
      : 'Editing is off. Select systems to inspect them; turn editing on to move systems or manage regions.');
    return this._editMode;
  },
  setFactionDomination: function(enabled) {
    this._showFactionDomination = !!enabled;
    if (this._state) this.render(this._state.svg, this._state.sector, this._state.selectedSystem);
    this._syncMoveButton();
    this._status(this._showFactionDomination
      ? 'Faction domination is shown by hex color and system rings.'
      : 'Faction domination colors and control rings are hidden; routes and system markers remain visible.');
    return this._showFactionDomination;
  },
  setActiveRegion: function(id) {
    this._activeRegionId = this._editMode ? (id || '') : '';
    if (this._activeRegionId && this._moveMode) this.cancelMoveSelected();
    var regionSelect = document.getElementById('map-region-select');
    if (regionSelect && regionSelect.value !== this._activeRegionId) regionSelect.value = this._activeRegionId;
    var regionDelete = document.getElementById('map-region-delete');
    if (regionDelete) regionDelete.disabled = !this._activeRegionId;
    if (this._state) this.render(this._state.svg, this._state.sector, this._state.selectedSystem);
    this._status(this._activeRegionId ? 'Region edit mode: click hexes to add or remove them from the selected region.' : null);
  },
  startMoveSelected: function() {
    if (!this._editMode) {
      this._status('Turn Edit mode on before moving a system.');
      return false;
    }
    if (!this._state || !this._state.selectedSystem) {
      this._status('Select a system first, then choose Move selected system.');
      return false;
    }
    this._activeRegionId = '';
    this._moveMode = true;
    var regionSelect = document.getElementById('map-region-select');
    if (regionSelect) regionSelect.value = '';
    var regionDelete = document.getElementById('map-region-delete');
    if (regionDelete) regionDelete.disabled = true;
    this.render(this._state.svg, this._state.sector, this._state.selectedSystem);
    this._syncMoveButton();
    this._status('Move mode armed for ' + this._state.selectedSystem.name + '. Click an outlined empty hex to move it; occupied hexes are ignored.');
    return true;
  },
  cancelMoveSelected: function() {
    this._moveMode = false;
    if (this._state) this.render(this._state.svg, this._state.sector, this._state.selectedSystem);
    this._syncMoveButton();
    this._status('Move cancelled. The map remains fixed; select a system or edit a region.');
  },
  draw: function(svg, sector, selectedSystem) {
    if (!svg || !svg.ownerDocument || !sector) return;
    if (svg.tagName.toLowerCase() !== 'svg') {
      var replacement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      replacement.id = svg.id;
      replacement.setAttribute('class', 'hexmap-svg');
      replacement.setAttribute('role', 'group');
      replacement.setAttribute('aria-label', 'Static sector hex map; select systems and hexes, use buttons for edits.');
      svg.replaceWith(replacement);
      svg = replacement;
    }
    var old = this._state;
    var sameSvg = !!(old && old.svg === svg);
    // A rebuilt map workspace always starts neutral; an armed move mode must never leak
    // into a replacement SVG and silently move a system after an unrelated rerender.
    if (!sameSvg) this._moveMode = false;
    var state = sameSvg ? old : {svg:svg, sector:sector, selectedSystem:selectedSystem || null, callback:null, onChange:null};
    state.svg = svg;
    state.sector = sector;
    if (selectedSystem !== undefined) state.selectedSystem = selectedSystem || null;
    this._state = state;
    if (!this._selectedHex && state.selectedSystem) this._selectedHex = {x:Number(state.selectedSystem.x),y:Number(state.selectedSystem.y)};
    this.render(svg, sector, state.selectedSystem);
    svg.setAttribute('viewBox', '0 0 ' + this._width + ' ' + this._height);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this._bind(svg);
    this._syncMoveButton();
  },
  render: function(svg, sector, selectedSystem) {
    var self = this, s = this._state;
    if (!s || !svg || !sector) return;
    s.svg = svg;
    s.sector = sector;
    if (selectedSystem !== undefined) s.selectedSystem = selectedSystem || null;
    var W = this._width, H = this._height, R = this._radius;
    var center = function(x,y) { return self._center(x,y); };
    var esc = function(v) { return self._escape(v); };
    var hexPoints = function(x,y,r) { return self._hexPoints(x,y,r); };
    function getRegionFor(x,y) {
      return (sector.regions||[]).find(function(r) { return (r.hexes||[]).some(function(h){return Number(h.x)===x && Number(h.y)===y;}); }) || null;
    }
    var systemsList = sector.systems || [];
    var systemAt = new Map(systemsList.map(function(sys){return [String(sys.x)+','+String(sys.y),sys];}));
    var routes = (sector.tradeRoutes||[]).map(function(route){
      var a=systemsList.find(function(x){return x.id===route.fromSystemId;}), b=systemsList.find(function(x){return x.id===route.toSystemId;});
      if(!a||!b)return '';
      var ca=center(a.x,a.y), cb=center(b.x,b.y);
      return '<line class="route-line '+(route.kind==='trade'?'route-trade':'route-scout')+'" data-route-id="'+esc(route.id)+'" x1="'+ca.x+'" y1="'+ca.y+'" x2="'+cb.x+'" y2="'+cb.y+'"><title>'+esc(route.kind+' route: '+a.name+' — '+b.name+' ('+route.distance+' hexes)')+'</title></line>';
    }).join('');
    var claims = this._showFactionDomination ? systemsList.map(function(sys){
      if (!sys.controllingFactionId) return '';
      var c=center(sys.x,sys.y), col=sys.controllingFactionColor||'#70e0cf';
      return '<circle class="territory-ring" data-system-id="'+esc(sys.id)+'" cx="'+c.x+'" cy="'+c.y+'" r="21" stroke="'+esc(col)+'"/><circle class="territory-ring-soft" data-system-id="'+esc(sys.id)+'" cx="'+c.x+'" cy="'+c.y+'" r="24" fill="none" stroke="'+esc(col)+'" stroke-opacity=".22" stroke-width="4"/>';
    }).join('') : '';
    var grid = '';
    for (var x=0;x<8;x++) for(var y=0;y<10;y++) {
      var c=center(x,y), region=getRegionFor(x,y), occupiedSystem=systemAt.get(x+','+y), occupied=!!occupiedSystem;
      var selectedHex = !!(self._selectedHex && Number(self._selectedHex.x)===x && Number(self._selectedHex.y)===y);
      var moveTarget = self._moveMode && !occupied;
      var dominated = this._showFactionDomination && occupiedSystem && occupiedSystem.controllingFactionId;
      var contested = this._showFactionDomination && occupiedSystem && occupiedSystem.isContested;
      var fill = dominated ? (occupiedSystem.controllingFactionColor || '#70e0cf') : (contested ? '#e6bd83' : (region ? region.color || '#70e0cf' : '#0d1725'));
      var alpha = dominated || contested ? '.32' : (region ? '.24' : '.72');
      var outline = region ? (region.color || '#70e0cf') : (dominated ? (occupiedSystem.controllingFactionColor || '#70e0cf') : (contested ? '#e6bd83' : '#2b415a'));
      var outlineAlpha = region ? '.9' : (dominated || contested ? '.85' : '.95');
      var regionText = region && !occupied ? '<text class="region-mark" x="'+c.x+'" y="'+(c.y+R*.58)+'">'+esc(String(region.name||'').slice(0,8).toUpperCase())+'</text>' : '';
      grid += '<g class="hex-cell '+(region?'hex-region ':'')+(selectedHex?'is-hex-selected ':'')+(moveTarget?'hex-move-target':'')+'" data-hex-x="'+x+'" data-hex-y="'+y+'" tabindex="0" role="button" aria-label="Hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+(occupied?', occupied':'')+(region?', region '+esc(region.name):'')+'">'+
        '<polygon points="'+hexPoints(x,y,R)+'" fill="'+esc(fill)+'" fill-opacity="'+alpha+'" stroke="'+esc(outline)+'" stroke-opacity="'+outlineAlpha+'" stroke-width="'+(region?'1.45':(dominated||contested?'1.3':'1.05'))+'"/>'+
        '<text class="hex-coordinate" x="'+c.x+'" y="'+(c.y-R*.62)+'">'+String(x).padStart(2,'0')+String(y).padStart(2,'0')+'</text>'+regionText+'</g>';
    }
    var systems = systemsList.map(function(sys){
      var c=center(sys.x,sys.y), sel=s.selectedSystem&&s.selectedSystem.id===sys.id;
      var fill = self._showFactionDomination ? (sys.controllingFactionColor || '#70e0cf') : '#70e0cf';
      var planets = sys.planets || [];
      var name=String(sys.name||'System');
      var shortName = name.length > 9 ? name.slice(0,8)+'…' : name;
      var planetDots = planets.length ? '<g class="system-world-count"><rect x="-10" y="9" width="20" height="11" rx="5.5"/><text x="0" y="17">'+Math.min(planets.length,99)+'W</text></g>' : '';
      return '<g class="system-node '+(sel?'is-selected':'')+'" data-system-id="'+esc(sys.id)+'" tabindex="0" role="button" aria-label="Select system '+esc(sys.name)+' at hex '+String(sys.x).padStart(2,'0')+String(sys.y).padStart(2,'0')+'" transform="translate('+c.x+' '+c.y+')">'+
        '<circle class="system-hit-area" r="19" fill="transparent"/>'+
        (self._showFactionDomination && sys.controllingFactionId?'<circle class="system-control" r="17" stroke="'+esc(fill)+'"/>':'')+
        '<circle class="system-halo" r="'+(sel?13:10)+'"/>'+
        '<circle class="system-core" r="'+(sel?5.3:4.1)+'" fill="'+esc(fill)+'"/>'+
        '<circle class="system-core-ring" r="'+(sel?8.3:6.7)+'" stroke="'+esc(fill)+'"/>'+planetDots+
        '<text class="system-label" x="0" y="-13" textLength="'+Math.min(shortName.length*5.2,49)+'" lengthAdjust="spacingAndGlyphs">'+esc(shortName)+'</text>'+
      '</g>';
    }).join('');
    svg.innerHTML = '<defs><radialGradient id="map-glow"><stop offset="0" stop-color="#163044" stop-opacity=".7"/><stop offset="1" stop-color="#07101b" stop-opacity="0"/></radialGradient><pattern id="star-dots" width="73" height="67" patternUnits="userSpaceOnUse"><circle cx="11" cy="9" r=".8" fill="#8baac5" fill-opacity=".3"/><circle cx="52" cy="41" r=".6" fill="#8baac5" fill-opacity=".24"/><circle cx="34" cy="61" r=".45" fill="#8baac5" fill-opacity=".18"/></pattern></defs>'+
      '<rect class="map-background" x="0" y="0" width="'+W+'" height="'+H+'" fill="#08111d"/>'+
      '<rect class="map-background" x="0" y="0" width="'+W+'" height="'+H+'" fill="url(#map-glow)"/>'+
      '<rect class="map-background" x="0" y="0" width="'+W+'" height="'+H+'" fill="url(#star-dots)"/>'+
      '<g class="map-grid">'+grid+'</g><g class="map-routes">'+routes+'</g><g class="map-claims">'+claims+'</g><g class="map-systems">'+systems+'</g>'+
      '<text x="18" y="736" class="map-stamp" pointer-events="none">SECTOR FORGE / FIXED GRID 08 × 10</text>';
    // Immutable viewBox: render calls cannot inherit zoom or pan state from prior interactions.
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this._syncMoveButton();
  },
  _bind: function(svg) {
    var self=this;
    if (svg.dataset.hexmapBound==='true') return;
    svg.dataset.hexmapBound='true';
    function current() { return self._state && self._state.svg===svg ? self._state : null; }
    function selectSystem(s, sys) {
      self._moveMode = false;
      s.selectedSystem = sys;
      self._selectedHex = {x:Number(sys.x),y:Number(sys.y)};
      self.render(svg,s.sector,sys);
      self._syncMoveButton();
      self._status('Selected '+sys.name+' at hex '+String(sys.x).padStart(2,'0')+String(sys.y).padStart(2,'0')+'. Choose Move selected system to reposition it without dragging the map.');
      if (s.callback) s.callback(sys, {x:Number(sys.x),y:Number(sys.y)});
    }
    function occupied(sector,x,y,exceptId) {
      return (sector.systems||[]).some(function(sys){return sys.id!==exceptId&&Number(sys.x)===x&&Number(sys.y)===y;});
    }
    function relocate(s, x, y) {
      var sys=s.selectedSystem;
      if (!sys) { self.cancelMoveSelected(); return; }
      if (occupied(s.sector,x,y,sys.id)) {
        self._status('Hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+' is occupied. Choose an empty hex.');
        return;
      }
      if (Number(sys.x)===x && Number(sys.y)===y) {
        self._moveMode=false;
        self.render(svg,s.sector,sys); self._syncMoveButton();
        self._status(sys.name+' remains at hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+'. No changes made.');
        return;
      }
      sys.x=x; sys.y=y;
      if (window.CampaignTools && typeof CampaignTools.generateTradeRoutes==='function') {
        s.sector.tradeRoutes=CampaignTools.generateTradeRoutes(s.sector);
      } else {
        (s.sector.tradeRoutes||[]).forEach(function(route){
          var a=s.sector.systems.find(function(it){return it.id===route.fromSystemId;}), b=s.sector.systems.find(function(it){return it.id===route.toSystemId;});
          if(a&&b)route.distance=Math.max(Math.abs(Number(a.x)-Number(b.x)),Math.abs(Number(a.y)-Number(b.y)));
        });
      }
      self._moveMode=false;
      self._selectedHex={x:x,y:y};
      self.render(svg,s.sector,sys); self._syncMoveButton();
      self._status('Moved '+sys.name+' to hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+'. Routes and linked campaign records are being refreshed.');
      if (s.onChange) s.onChange('move',sys);
      if (s.callback) s.callback(sys);
    }
    function activateHex(s,cell) {
      var x=Number(cell.getAttribute('data-hex-x')), y=Number(cell.getAttribute('data-hex-y'));
      self._selectedHex={x:x,y:y};
      if (self._editMode && self._moveMode) { relocate(s,x,y); return; }
      if (self._editMode && self._activeRegionId) {
        self._toggleRegionHex(s.sector,self._activeRegionId,x,y);
        self.render(svg,s.sector,s.selectedSystem);
        self._status('Updated region membership for hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+'.');
        if (typeof App!=='undefined' && typeof App._refreshMapRegionSelect==='function') App._refreshMapRegionSelect(self._activeRegionId);
        if (s.onChange) s.onChange('region',null);
        return;
      }
      self.render(svg,s.sector,s.selectedSystem);
      var occupancy=(s.sector.systems||[]).find(function(item){return Number(item.x)===x&&Number(item.y)===y;});
      self._status(occupancy ? 'Hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+' contains '+occupancy.name+'.' : (self._editMode ? 'Empty hex selected. Use Create system here in the inspector to add a new system.' : 'Selected empty hex '+String(x).padStart(2,'0')+String(y).padStart(2,'0')+'. Turn Edit mode on to create a system here.'));
      if (!occupancy && self._editMode && s.callback) s.callback(null, {x:x,y:y});
    }
    // Click/keyboard only. No pointer gestures, drag handlers, wheel handler, or pan/zoom state.
    svg.addEventListener('click',function(event){
      var s=current(); if(!s) return;
      var target=event.target;
      var sysNode=target.closest&&target.closest('.system-node');
      if(sysNode){
        var sys=(s.sector.systems||[]).find(function(it){return it.id===sysNode.getAttribute('data-system-id');});
        // In region-edit mode, clicking a system edits its occupied hex as well; outside
        // that mode the exact same click selects the system for inspection.
        if(sys && self._editMode && self._activeRegionId && !self._moveMode){
          var occupiedCell=svg.querySelector('.hex-cell[data-hex-x="'+Number(sys.x)+'"][data-hex-y="'+Number(sys.y)+'"]');
          if(occupiedCell){activateHex(s,occupiedCell);return;}
        }
        if(sys)selectSystem(s,sys);
        return;
      }
      var cell=target.closest&&target.closest('.hex-cell');
      if(cell)activateHex(s,cell);
    });
    svg.addEventListener('keydown',function(event){
      if(event.key!=='Enter'&&event.key!==' ')return;
      var s=current(); if(!s)return;
      var target=event.target;
      var cell=target.closest&&target.closest('.hex-cell');
      if(cell){event.preventDefault();activateHex(s,cell);return;}
      var node=target.closest&&target.closest('.system-node');
      if(node){event.preventDefault();var sys=(s.sector.systems||[]).find(function(it){return it.id===node.dataset.systemId;});if(sys)selectSystem(s,sys);}
    });
  },
  _toggleRegionHex: function(sector,id,x,y) {
    var region=(sector.regions||[]).find(function(r){return r.id===id;}); if(!region)return;
    region.hexes=Array.isArray(region.hexes)?region.hexes:[];
    var i=region.hexes.findIndex(function(h){return Number(h.x)===x&&Number(h.y)===y;});
    if(i>=0) region.hexes.splice(i,1);
    else {
      // A hex belongs to at most one named region, keeping region highlighting unambiguous.
      (sector.regions||[]).forEach(function(other){if(other.id!==id&&Array.isArray(other.hexes))other.hexes=other.hexes.filter(function(h){return Number(h.x)!==x||Number(h.y)!==y;});});
      region.hexes.push({x:x,y:y});
    }
  },
  onClickHex: function(svg, sector, callback) {
    if(!this._state||this._state.svg!==svg)this.draw(svg,sector,sector.systems&&sector.systems[0]);
    this._state.callback=callback;
    this._state.onChange=function(type,system){
      if(type==='move'&&system&&typeof App!=='undefined'&&App.currentSector){
        CampaignTools.recalculateInfluence(App.currentSector);
        CampaignTools.linkCampaignRecords(App.currentSector);
        CampaignTools.updateMarkets(App.currentSector,App.currentSector.factionTurn||0);
        App.renderCampaignPanels(App.currentSector);
        App.displayWorlds(App.currentSector);
        App.persistSector(App.currentSector);
      } else if(type==='region'&&typeof App!=='undefined'&&App.currentSector) App.persistSector(App.currentSector);
    };
  }
};
