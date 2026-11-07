let ReligionGenerator = {};

ReligionGenerator.evolutions = [
	"New Book",
	"New Prophet",
	"Syncretic",
	"Neofundamentalist",
	"Quietist",
	"Sacrificial",
	"Schism",
	"Holy Family"
];

ReligionGenerator.origins = [
	"Paganism",
	"Roman Catholicism",
	"Eastern Orthodoxy",
	"Protestantism",
	"Buddism",
	"Judaism",
	"Islam",
	"Taoism",
	"Hinduism",
	"Zoroasterism",
	"Confucanism",
	"Ideology"
];

ReligionGenerator.leaderships = [
	"Patriarchy/Matriarchy",
	"Patriarchy/Matriarchy",
	"Council",
	"Council",
	"Democracy",
	"Regional"
];

ReligionGenerator.doctrines = [
	"gender",
	"age",
	"psionics",
	"diet",
	"clothing",
	"wealth",
	"prayer",
	"meditation",
	"knowledge",
	"the afterlife",
	"eschatology",
	"symbolism",
	"purification",
	"violence",
	"marriage",
	"missionary work",
	"aliens",
	"work",
	"charity",
	"technology",
	"icons",
	"relics",
	"art",
	"music",
	"rituals",
	"nature",
	"death",
	"places of worship",
	"nonbelievers",
	"ancestors",
	"pilgrammage",
	"scripture"
];

ReligionGenerator.generate = function() {
	let count = GenUtil.randInt(8,16);
	let religions = [];
	
	let originShuffle = new GenUtil.Shuffler(this.origins.concat(this.origins));

	for (let i = 0; i < count; i++) {
		let evolution = GenUtil.pickRandom(ReligionGenerator.evolutions);
		let origin = originShuffle.next();
		
		if (evolution == "Syncretic") {
			origin += "/"+originShuffle.next();
		}
		
		let name = evolution + " " + origin;
		
		let leadership = GenUtil.pickRandom(ReligionGenerator.leaderships);
		
		if (leadership == "Regional") {
			let leadership2 = GenUtil.pickRandom(ReligionGenerator.leaderships);
			
			if (leadership2 == leadership) {
				leadership = "No Hierarchy"
			} else {
				leadership += " " + GenUtil.pluralize(leadership2);
			}
		}
		
		let doctrineShuffle = new GenUtil.Shuffler(this.doctrines);
		let doctrine = doctrineShuffle.next() + " & " + doctrineShuffle.next();
		
		religions.push({
			name:name,
			leadership:leadership,
			doctrine:doctrine
		});
	}

	return religions;
}

ReligionGenerator.generateRandomName = function() {
	let evolution = GenUtil.pickRandom(this.evolutions);
	let origins = GenUtil.shuffle(this.origins.slice());
	let origin = origins[0];
	if (evolution === "Syncretic") origin += "/" + (origins[1] || GenUtil.pickRandom(this.origins));
	return evolution + " " + origin;
};
ReligionGenerator.generateRandomLeadership = function() {
	let leadership = GenUtil.pickRandom(this.leaderships);
	if (leadership === "Regional") {
		let second = GenUtil.pickRandom(this.leaderships);
		leadership = second === leadership ? "No Hierarchy" : leadership + " " + GenUtil.pluralize(second);
	}
	return leadership;
};
ReligionGenerator.generateRandomDoctrine = function() {
	let doctrines = GenUtil.shuffle(this.doctrines.slice());
	return doctrines[0] + " & " + doctrines[1];
};
ReligionGenerator.template = {
	lists:{},
	generators:{
		name:function() { return ReligionGenerator.generateRandomName(); },
		leadership:function() { return ReligionGenerator.generateRandomLeadership(); },
		doctrine:function() { return ReligionGenerator.generateRandomDoctrine(); }
	}
};
