/*
 * Optional missing-detail enrichment for imported Sectors Without Number entities.
 * The English facility occupation/situation entries are adapted from the MIT-licensed
 * Sectors Without Number project by Mitchel Pigsley:
 * https://github.com/mpigsley/sectors-without-number
 * Original imported values always take precedence; this module only fills blank fields.
 */
var SwnEntityEnrichment = (function() {
  var TABLES = {
    asteroidBase: {
      occupation: ['Zealous religious sectarians','Failed rebels from another world','Wage-slave corporate miners','Independent asteroid prospectors','Pirates masquerading as otherwise'],
      situation: ['Life support is threatened','Base needs a new asteroid','Dug out something nasty','Fighting another asteroid','Hit a priceless vein of ore']
    },
    asteroidBelt: {
      occupation: ['Grizzled belter mine laborers','Ancient automated guardian drones','Survivors of destroyed asteroid base','Pirates hiding out among the rocks','Lonely military patrol base staff'],
      situation: ['Ruptured rock released a peril','Foreign spy ships hide there','Gold rush for new materials','Ancient ruins dot the rocks','War between rival rocks']
    },
    deepSpaceStation: {
      occupation: ['Dangerously odd humans','Freeze-dried ancient corpses','Secretive military observers','Eccentric oligarch and minions','Deranged but brilliant scientist'],
      situation: ['Systems breaking down','Foreign sabotage attempt','Black market for the elite','Vault for dangerous pretech','Supply base for pirates']
    },
    gasGiantMine: {
      occupation: ['Miserable gas-miner slaves or serfs','Strange robots and their overseers','Scientists studying the alien life','Scrappers in the ruined old mine','Impoverished separatists group'],
      situation: ['Things are emerging below','They need vital supplies','The workers are in revolt','Pirates secretly fuel there','Alien remnants were found']
    },
    moonBase: {
      occupation: ['Unlucky corporate researchers','Reclusive hermit genius','Remnants of a failed colony','Military listening post','Lonely overseers and robot miners'],
      situation: ['Something dark has awoken','Criminals trying to take over','Moon plague breaking out','Desperate for vital supplies','Rich but badly-protected']
    },
    orbitalRuin: {
      occupation: ['Robots of dubious sentience','Trigger-happy scavengers','Government researchers','Military quarantine enforcers','Heirs of the original builders'],
      situation: ['Trying to stop it awakening','Meddling with strange tech','Impending tech calamity','A terrible secret is unearthed','Fighting outside interlopers']
    },
    refuelingStation: {
      occupation: ['Half-crazed hermit caretaker','Sordid purveyors of decadent fun','Extortionate corporate minions','Religious missionaries to travelers','Brainless automated vendors'],
      situation: ['A ship is in severe distress','Pirates have taken over','Has corrupt customs agents','Foreign saboteurs are active','Deep-space alien signal']
    },
    researchBase: {
      occupation: ['Experiments that have gotten loose','Scientists from a major local corp','Black-ops governmental researchers','Secret employees of a foreign power','Alien studying the human locals'],
      situation: ['Perilous research underway','Hideously immoral research','Held hostage by outsiders','Science monsters run amok','Selling black-market tech']
    },
    spaceStation: {
      occupation: ['Dangerously odd humans','Freeze-dried ancient corpses','Secretive military observers','Eccentric oligarch and minions','Deranged but brilliant scientist'],
      situation: ['Systems breaking down','Foreign sabotage attempt','Black market for the elite','Vault for dangerous pretech','Supply base for pirates']
    }
  };

  function pick(values, random) {
    return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  }

  function fill(record, random) {
    if (!record || !TABLES[record.type]) return {changed:[], detailsPresent:!!(record && (record.occupation || record.situation))};
    random = typeof random === 'function' ? random : Math.random;
    var table = TABLES[record.type];
    var changed = [];
    if (!String(record.occupation || '').trim()) {
      record.occupation = pick(table.occupation, random);
      changed.push('occupation');
    }
    if (!String(record.situation || '').trim()) {
      record.situation = pick(table.situation, random);
      changed.push('situation');
    }
    record.generatedFields = Array.from(new Set((record.generatedFields || []).concat(changed)));
    return {changed:changed, detailsPresent:!!(record.occupation || record.situation)};
  }

  return {fill:fill, supports:function(type){return !!TABLES[type];}, supportedTypes:Object.keys(TABLES)};
})();
