let StarSystemGenerator = {};

StarSystemGenerator.STAR_CLASSES = [
	{name:"Black Hole", masses:[0,1,2,3,4]},
	{name:"blue supergiant", masses:[4]},
	{name:"blue giant", masses:[3]},
	{name:"brown dwarf", masses:[0]},
	{name:"red dwarf", masses:[1]},
	{name:"yellow dwarf", masses:[2]},
	{name:"yellow dwarf", masses:[2]},
	{name:"red giant", masses:[1,2,3]},
	{name:"red supergiant", masses:[4]},
	{name:"white dwarf", masses:[1,2]},
	{name:"neutron star", masses:[2,3]},
];

StarSystemGenerator.BODIES = [
	{type:"construct", bodyClass:'N'},
	{type:"asteroid belt", bodyClass:'N'},
	{type:"asteroid belt", bodyClass:'N'},
	{type:"debris field", bodyClass:'N'},
	{type:"comet cloud", bodyClass:'N'},
	{type:"ancient installation", bodyClass:'N'},
	{type:"orbital wreckage", bodyClass:'N'},
	{type:"survey beacon", bodyClass:'N'},
	{type:"anomaly", bodyClass:'N'}
];

// Optional-density systems can include more orbital settlements and facilities.
// Keeping this table separate preserves the previous Default random distribution.
StarSystemGenerator.EXTENDED_BODIES = [
	{type:"orbital station", bodyClass:'N'}, {type:"mining platform", bodyClass:'N'},
	{type:"orbital shipyard", bodyClass:'N'}, {type:"research station", bodyClass:'N'},
	{type:"derelict station", bodyClass:'N'}, {type:"ancient ruins", bodyClass:'N'},
	{type:"pretech installation", bodyClass:'N'}, {type:"automated refinery", bodyClass:'N'},
	{type:"military listening post", bodyClass:'N'}, {type:"habitat cylinder", bodyClass:'N'}
];

StarSystemGenerator.generate = function(worldsOrCount=[], options={}) {
	// The system survey now includes the actual world records generated for the
	// system. Older callers may still pass a count; make clearly-labelled generic
	// survey records in that compatibility case.
	var worlds = Array.isArray(worldsOrCount) ? worldsOrCount : [];
	if (!Array.isArray(worldsOrCount)) {
		var requested = Math.max(0, Math.min(20, Number(worldsOrCount) || 0));
		for (var g = 0; g < requested; g++) worlds.push({name:'Uncatalogued World ' + this.romanize(g + 1), techLevel:'?', population:'unknown population'});
	}
	var bodies = [];
	var primaryStar = this.pickRandom2d6(this.STAR_CLASSES);
	var primaryMass = GenUtil.pickRandom(primaryStar.masses);
	bodies.push({type:'Primary star (' + primaryStar.name + ')', name:' A', bodyClass:'S', starClass:primaryStar.name, mass:primaryMass});

	// A subset of systems are binary/multiple-star systems.
	var companionCount = Math.random() < 0.22 ? 1 : (Math.random() < 0.035 ? 2 : 0);
	var starLetters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
	for (var c = 0; c < companionCount; c++) {
		var companion = this.pickRandom2d6(this.STAR_CLASSES);
		bodies.push({type:'Companion star (' + companion.name + ')', name:' ' + starLetters[c], bodyClass:'S', starClass:companion.name, mass:GenUtil.pickRandom(companion.masses)});
	}

	// These records are linked by planetId to the matching world directory entry.
	worlds.forEach(function(world, index) {
		var descriptor = 'World';
		if (world.techLevel != null) descriptor += ' · TL ' + world.techLevel;
		if (world.population) descriptor += ' · ' + world.population;
		bodies.push({type:descriptor, name:world.name || ('World ' + (index + 1)), worldName:world.name || ('World ' + (index + 1)), planetId:world.id || '', bodyClass:'P', isGeneratedWorld:true});
	});

	// Generate additional orbital objects without pretending they are full world
	// records in the sector's world directory.
	var density = options && ['default','empty','scarce','normal','crowded'].indexOf(options.contentDensity) >= 0 ? options.contentDensity : 'default';
	var extraCount = density === 'empty' ? 0 : density === 'scarce' ? GenUtil.randInt(0, 2) : density === 'normal' ? GenUtil.randInt(3, 6) : density === 'crowded' ? GenUtil.randInt(6, 12) : GenUtil.randInt(2, 6);
	var extraTypes = this.BODIES.filter(function(body) { return body.bodyClass === 'N'; });
	if (density === 'scarce' || density === 'normal' || density === 'crowded') extraTypes = extraTypes.concat(this.EXTENDED_BODIES);
	var worldNumber = worlds.length;
	for (var i = 0; i < extraCount; i++) {
		var body = GenUtil.pickRandom(extraTypes);
		var type = body.type;
		var name = '*';
		var moonCount = 0;
		if (type === 'gas giant' && Math.random() < 0.8) moonCount = Math.floor(Math.pow(Math.random(), 2) * 12) + 1;
		else if (type === 'planet' && Math.random() < 0.5) moonCount = Math.floor(Math.pow(Math.random(), 2) * 8) + 1;
		else if (type === 'planetoid' && Math.random() < 0.25) moonCount = Math.floor(Math.pow(Math.random(), 2) * 6) + 1;
		if (moonCount > 0) type += ', ' + moonCount + ' moon' + (moonCount > 1 ? 's' : '');
		if (body.bodyClass === 'P') {
			worldNumber++;
			name = ' ' + this.romanize(worldNumber);
		}
		bodies.push({type:type, name:name, bodyClass:body.bodyClass || 'N', isGeneratedWorld:false});
	}
	return bodies;
};

StarSystemGenerator.pickRandom2d6 = function(array) {
	var random = Math.floor(6*Math.random()) + Math.floor(6*Math.random());
	return array[random];
}

StarSystemGenerator.romanize = function(num) {
  var lookup = {M:1000,CM:900,D:500,CD:400,C:100,XC:90,L:50,XL:40,X:10,IX:9,V:5,IV:4,I:1},roman = '',i;
  for ( i in lookup ) {
    while ( num >= lookup[i] ) {
      roman += i;
      num -= lookup[i];
    }
  }
  return roman;
}