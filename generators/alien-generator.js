var AlienGenerator = {};

AlienGenerator.insectBodyParts = [
	"Sucking Mouthparts",
	"Chewing Mouthparts",
	"Jewel-Colored Chitin",
	"2d4 pairs of limbs",
	"Membranous Wings",
	"Deposits eggs in live prey",
	"Has \"silk\" spinnerettes",
	"Has a chysalis life stage",
	"No Mouth, adult form lives only to reproduce",
	"1d4 pairs of eyes of eyespots",
	"Sluglike body",
	"Color-changing exoskeleton",
	"Always encountered in groups",
	"Hums or buzzes in intricate patterns",
	"Lives in hives led by a queen",
	"Killing one causes others nearby to go berserk",
	"Emits powerful pheromones",
	"Hides itself to ambush prey",
	"Prefers subterranean environments",
	"Emits noxious or poisonous stench when killed"
];

AlienGenerator.reptileBodyParts = [
	"Sharp-edged scales",
	"1d4 pairs of eyes",
	"Extremely long tail",
	"Bellowing vocalization",
	"Burrowing foreclaws",
	"Hide is damp and slimy",
	"Eyeless",
	"Strong swimmer",
	"Spits venom",
	"Lies in ambush in bodies of water",
	"Brilliantly-hued scales or hide",
	"Horns or body spikes",
	"Large membranous frills",
	"Hibernates in caves and undisturbed nooks",
	"Glowing body parts",
	"Body is patterned with both scales and hide",
	"Springs on prey from elevated places",
	"Warm-blooded",
	"Furred",
	"Limbless body"
];

AlienGenerator.mammalBodyParts = [
	"Quill-like fur",
	"Prehensile tail",
	"Eyes or eyespots on body",
	"Membranous wings",
	"Stench glands",
	"Peculiar vocalization",
	"Marsupial pouch",
	"Patterned fur or hide",
	"Expands or inflates when threatened",
	"Strictly nocturnal",
	"1d6+1 limbs, including any tail",
	"Mottled or mangy fur",
	"Fires darts or quills",
	"Animal is cold-blooded",
	"Horns or body spikes",
	"Superb scent tracker",
	"Burrowing creature",
	"Creature lacks a sense- hearing, sight, or smell",
	"Creature is abnormally clever for an animal"
];

AlienGenerator.avianBodyParts = [
	"Sharp feathers",
	"1d3 pairs of wings",
	"Long, sinuous neck",
	"Brilliant coloration",
	"Membranous wings",
	"Can hover",
	"Beautiful song",
	"Flightless",
	"Fights prey on the ground",
	"Launches secretions at prey",
	"Lifts and drops prey",
	"Exhales flame or other toxic substance",
	"Always appears in groups",
	"Long prehensile tail",
	"Animal is cold-blooded",
	"Fur instead of feathers",
	"Scales instead of feathers",
	"Toothed beak",
	"Has valuable or delicious eggs",
	"Flies by means of lighter-than-air gas"
];

AlienGenerator.exoticBodyParts = [
	"Rocklike body",
	"1d4 pairs of eyestalks",
	"Rolls on wheels",
	"Chainsaw-like mouthparts or claws",
	"Metallic hide",
	"Natural laser emitters",
	"Launches chemically-powered darts",
	"Amoeba-like body",
	"Crystalline tissues",
	"Gas-sack body",
	"2d10 tentacles",
	"Gelatinous liquid body",
	"Radioactive flesh",
	"Uses sonic attacks to stun prey",
	"Colony entity made up of numerous small animals",
	"Controlled by neural symbiont",
	"Absorbs electromagnetic energy",
	"Precious mineral carapace or exoskeleton",
	"Double damage from a particular type of injury",
	"Mobile plant life"
];

AlienGenerator.aquaticBodyParts = [
	"Swims by means of water-jet propulsion",
	"Can generate a strong electric current",
	"Radially symmetric",
	"Needs to surface to breath",
	"Protected by a spiralling shell",
	"Deep sea organism, cannot safely reach the surface",
	"Bioluminscent spots",
	"Massive crushing claws",
	"Reflective silvery scales",
	"Flat, wing-like body",
	"Amphibious",
	"When threatened, exudes slippery mucus",
	"Sessile, spends majority of life anchored to sea floor",
	"Travels in massive schools",
	"Sonorous call can be heard from vast distances",
	"Hides self in sand on sea floor",
	"Skin can change color to blend in with environment",
	"Swims by beating millions of tiny cillia",
	"Feeds by filtering water for tiny oceanic organisms",
	"Mouthparts clamp on to prey organism"
];

AlienGenerator.types = [
	{name:"insectile", parts:AlienGenerator.insectBodyParts},
	{name:"reptilian", parts:AlienGenerator.reptileBodyParts},
	{name:"mammalian", parts:AlienGenerator.mammalBodyParts},
	{name:"avian", parts:AlienGenerator.avianBodyParts},
	{name:"aquatic", parts:AlienGenerator.aquaticBodyParts},
	{name:"exotic", parts:AlienGenerator.exoticBodyParts},
];

AlienGenerator.lenses = [
	"Collectivity",
	"Journeying",
	"Curiosity",
	"Joy",
	"Despair",
	"Pacifism",
	"Domination",
	"Pride",
	"Faith",
	"Sagacity",
	"Fear",
	"Subtlety",
	"Gluttony",
	"Tradition",
	"Greed",
	"Treachery",
	"Hate",
	"Tribalism",
	"Honor",
	"Wrath"
];

AlienGenerator.generateName = function() {
	let lengths = GenUtil.probArray([
		[2,1],
		[5,2],
		[2,3],
		[1,4]
	]);
	var name = '';
	if (Math.random() < 0.5) {
		name = NameGen.generate(GenUtil.pickRandom(lengths), NameGen.LANGUAGE_ALIEN);
	} else {
		name = NameGen.generate(GenUtil.pickRandom(lengths), NameGen.LANGUAGE_ENGLISH);
	}
	
	if (Math.random() < 0.25) {
		name += AlienGenerator.generateSuffix();
	}
	
	name = GenUtil.capitalize(name);
	return name;
}

AlienGenerator.generateSuffix = function() {
	let suffixes = [
		'ian',
		'ian',
		'ian',
		'an',
		'an',
		'oid',
		'loid',
		'ean',
		'ite',
		'ar',
		'morph',
		'ling',
		'on'
	];
	
	return GenUtil.pickRandom(suffixes);
}

AlienGenerator.generate = function() {
	var alienCount = 3 + Math.floor(Math.random() * 6);;



	var aliens = [];
	
	for (var i = 0; i < alienCount; i++) {
		let name = AlienGenerator.generateName();
		var type = GenUtil.pickRandom(this.types);
		var type2 = type;
		var typeName = type.name;
		if (Math.random() < 0.5) {
			var type2 = GenUtil.pickRandom(this.types);
			if (type != type2) {
				typeName = type.name + "/" + type2.name;
			}
		}
		var part1 = GenUtil.pickRandom(type.parts);
		var part2 = GenUtil.pickRandom(type2.parts);
		var lens1 = GenUtil.pickRandom(this.lenses);
		if (Math.random() < 0.5) {
			lens1 += ' & ' + GenUtil.pickRandom(this.lenses);
		}
		
		var governmentRoll = GenUtil.randInt(1, 8);
		var governments = ['Democratic', 'Monarchic', 'Tribal', 'Oligarchic', 'Multipolar competitive', 'Multipolar competitive', 'Multipolar cooperative', 'Multipolar cooperative'];
		var government = governments[governmentRoll - 1];
		var motivations = ['secure a new homeworld', 'prevent persecution of a diaspora', 'recover ancestral territory', 'control a rare ecological resource', 'contain a dangerous internal schism', 'establish recognition as a peer civilization', 'protect a sacred migration route', 'understand an alien technology'];
		var humanRelations = ['ordinary citizens on some worlds, distrusted elsewhere', 'careful trade partners with strict local protocols', 'openly hostile after a recent atrocity', 'poorly understood and routinely misrepresented', 'protected by a treaty that is close to collapse', 'dependent on human infrastructure but politically separate', 'welcomed by frontier settlements, opposed by core authorities'];
		aliens.push({
			name:name,
			type:typeName,
			body:part1 + "; " + part2,
			lenses:lens1,
			government:government,
			motivation:GenUtil.pickRandom(motivations),
			humanRelations:GenUtil.pickRandom(humanRelations),
			techLevel:GenUtil.pickRandom(['TL3 equivalent', 'TL4 equivalent', 'TL4 with narrow specialties', 'TL5 relic capability']),
			firstContact:GenUtil.pickRandom(['formal embassy', 'frontier enclave', 'mobile fleet', 'sealed habitat', 'remote homeworld', 'small diaspora communities'])
		});
	}
	
	return aliens;
}

AlienGenerator.template = {
	lists:{
		
	},
	generators:{
		name:() => AlienGenerator.generateName()
	}
}