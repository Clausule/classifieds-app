// Fictieve advertenties voor de "live" (pre-operationele) fase — gevuld met
// profielen/foto's die al op de bestaande statische stedenpagina's staan
// (topsteden: Amsterdam, Rotterdam, Den Haag, Utrecht, Eindhoven). Elke
// listing wordt gemarkeerd met is_fictional=1 en toegewezen aan het losse
// systeemaccount (zie db/seed-fictional-user.js), zodat beide in één keer
// verwijderd kunnen worden zodra MARKETPLACE_OPERATIONAL=true gaat.
// Idempotent: als er al fictieve listings bestaan, doet dit script niets.
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { uniqueSlug } = require('../utils/slugify');

const FICTIONAL_EMAIL = 'fictieve-listings@quickie.internal';
const SOURCE_ROOT = '/Users/rudibeijnen/Desktop/Desktop/test adv/draw things/Finished batch v2';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const existingCount = db.prepare('SELECT COUNT(*) AS n FROM listings WHERE is_fictional = 1').get().n;
if (existingCount > 0) {
  console.log(`Er bestaan al ${existingCount} fictieve listings, seed overgeslagen.`);
  process.exit(0);
}

const owner = db.prepare('SELECT id FROM users WHERE email = ?').get(FICTIONAL_EMAIL);
if (!owner) {
  console.error('Fictief systeemaccount niet gevonden — run eerst: node db/seed-fictional-user.js');
  process.exit(1);
}

// city: brondirectory-naam onder SOURCE_ROOT/<city>/webp/
// photoPrefix: eerste cijfer van foto-N1..N4.webp voor dit profiel
const PROFILES = [
  // ---- Amsterdam ----
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 1, doll_name: 'Valentina', price: 60, neighborhood: 'De Pijp', age: 24, length_cm: 168, weight_kg: 57, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Spaans', 'Engels'], description: 'Hi, ik ben Valentina! Ik ben een vrolijk en openhartig meisje uit Colombia dat dol is op dansen en muziek. Ik spreek Spaans en Engels en ik vind het leuk om nieuwe mensen te ontmoeten. Ik zorg ervoor dat je je meteen op je gemak voelt. Kom me bezoeken in De Pijp – je zult er geen spijt van krijgen!' },
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 2, doll_name: 'Natasha', price: 70, neighborhood: 'Oud-West', age: 28, length_cm: 172, weight_kg: 61, origin_region: 'Russisch', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Blond', languages: ['Engels', 'Russisch'], description: 'Hallo, ik ben Natasha. Drie jaar geleden ben ik vanuit Moskou naar Amsterdam verhuisd en ik voel me hier helemaal thuis. Ik spreek Engels en Russisch. Ik ben elegant, intelligent en heb gevoel voor humor. Zoek je prettig gezelschap met een stijlvolle uitstraling? Dan maak ik graag kennis met je.' },
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 3, doll_name: 'Milena', price: 70, neighborhood: 'Jordaan', age: 26, length_cm: 165, weight_kg: 55, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Zwart', languages: ['Engels', 'Duits'], description: 'Hoi, ik ben Milena uit Belgrado! Ik spreek Engels en een beetje Duits. Ik ben spontaan, avontuurlijk en houd van een goed gesprek. Reizen en nieuwe mensen ontmoeten doe ik met veel plezier. Je bent van harte welkom in de Jordaan!' },
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 4, doll_name: 'Sofia', price: 80, neighborhood: 'Bos en Lommer', age: 22, length_cm: 170, weight_kg: 59, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Portugees', 'Engels'], description: 'Olá, ik ben Sofia! Ik kom uit Brazilië en geniet volop van het leven. Ik spreek Portugees en Engels. Ik ben spontaan, warm en zit vol positieve energie. Een bezoek aan mij voelt als een klein stukje vakantie. Ik kijk ernaar uit je te ontmoeten!' },
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 5, doll_name: 'Kasia', price: 80, neighborhood: 'Noord', age: 31, length_cm: 166, weight_kg: 60, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Gemiddeld', hair_color: 'Rood', languages: ['Engels', 'Pools'], description: 'Hoi, ik ben Kasia, een afkorting van Katarzyna! Ik kom uit Krakau en woon inmiddels vijf jaar in Nederland. Ik spreek Engels en Pools. Ik ben rustig, zorgzaam en gemakkelijk in de omgang. Ik houd van boeken, de natuur en oprechte gesprekken. Ik hoop je snel te ontmoeten!' },
  { city: 'amsterdam', location: 'Amsterdam', photoPrefix: 6, doll_name: 'Lucia', price: 90, neighborhood: 'Oost', age: 38, length_cm: 169, weight_kg: 63, origin_region: 'Zuid-Europees', skin_tone: 'Getint', body_type: 'Mollig', hair_color: 'Brunette', languages: ['Spaans', 'Engels', 'Nederlands'], description: 'Hola, ik ben Lucia uit Madrid! Ik spreek Spaans, Engels en een beetje Nederlands. Ik ben zelfverzekerd, charmant en zorg ervoor dat je je snel op je gemak voelt. De warme Spaanse sfeer neem ik overal mee naartoe. Ervaren, stijlvol en altijd met een glimlach. Ik kijk uit naar onze kennismaking!' },

  // ---- Rotterdam ----
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 1, doll_name: 'Camila', price: 60, neighborhood: 'Kralingen', age: 23, length_cm: 164, weight_kg: 54, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Slank', hair_color: 'Brunette', languages: ['Spaans', 'Engels'], description: 'Hi, ik ben Camila! Ik ben drie jaar geleden uit Venezuela gekomen en ik ben mijn glimlach nooit verloren. Ik spreek Spaans en een beetje Engels. Ik ben warm, zorgzaam en vol energie. Ik hou van mensen en vind het heerlijk om ze gelukkig te maken. Kom me opzoeken in Kralingen — ik beloof je een geweldige tijd!' },
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 2, doll_name: 'Ivana', price: 60, neighborhood: 'Hillegersberg', age: 27, length_cm: 171, weight_kg: 62, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Engels', 'Duits'], description: 'Hey, ik ben Ivana uit Zagreb! Ik werk als grafisch ontwerper en ik hou van deze creatieve stad. Ik spreek vloeiend Engels en Duits. Ik ben creatief, een tikkeltje eigenwijs op een leuke manier, en ik heb een flinke portie humor. Rotterdam past perfect bij mij — net zoals ik perfect bij jou zal passen!' },
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 3, doll_name: 'Daniela', price: 70, neighborhood: 'Delfshaven', age: 25, length_cm: 167, weight_kg: 57, origin_region: 'Latijns-Amerikaans', skin_tone: 'Donker', body_type: 'Gemiddeld', hair_color: 'Zwart', languages: ['Spaans', 'Engels'], description: 'Hallo! Ik ben Daniela, een levendige Colombiaanse meid met een aanstekelijke lach. Ik spreek Spaans en een klein beetje Engels. Ik hou van salsa, zonneschijn en gezellig gezelschap. Ik ben altijd in een goed humeur en zit vol energie. Kom me opzoeken in Delfshaven — ik garandeer je dat je met een glimlach weer weggaat!' },
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 4, doll_name: 'Olena', price: 70, neighborhood: 'Centrum', age: 29, length_cm: 168, weight_kg: 59, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Blond', languages: ['Engels', 'Russisch'], description: 'Hi, ik ben Olena. Ik ben twee jaar geleden vanuit Kyiv naar Rotterdam verhuisd en dit voelt inmiddels echt als mijn thuis. Ik spreek Engels en Russisch. Ik ben zorgzaam, attent en hecht veel waarde aan een echte klik. In het begin lijk ik misschien wat rustig, maar ik weet precies wat ik wil. Discreet en betrouwbaar — altijd.' },
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 5, doll_name: 'Mariana', price: 70, neighborhood: 'Feijenoord', age: 33, length_cm: 163, weight_kg: 56, origin_region: 'Latijns-Amerikaans', skin_tone: 'Donker', body_type: 'Mollig', hair_color: 'Brunette', languages: ['Portugees', 'Engels'], description: 'Oi! Ik ben Mariana, een zelfverzekerde Braziliaanse vrouw die er enorm van houdt om mensen te verwennen. Ik spreek Portugees en Engels. Ik geniet van koken, carnaval en goede energie. Ik heb jarenlange ervaring en een hart van goud. Bij mij zul je je altijd helemaal thuis voelen. Kom gezellig langs en ontdek het zelf!' },
  { city: 'rotterdam', location: 'Rotterdam', photoPrefix: 6, doll_name: 'Agnie', price: 80, neighborhood: 'Noord', age: 30, length_cm: 170, weight_kg: 61, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Atletisch', hair_color: 'Blond', languages: ['Engels', 'Pools', 'Nederlands'], description: 'Hi, ik ben Agnie! Ik woon nu zes jaar in Nederland en ik vind het hier geweldig. Ik spreek Engels, Pools en een klein beetje Nederlands. Ik ben recht door zee, grappig en lekker actief — ik hou van sporten en buiten zijn. Geen onzin, gewoon een goede sfeer en een fantastische tijd. Kom gezellig kennismaken!' },

  // ---- Den Haag ----
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 1, doll_name: 'Alejandra', price: 60, neighborhood: 'Scheveningen', age: 26, length_cm: 166, weight_kg: 56, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Spaans', 'Engels'], description: 'Hola! Ik ben Alejandra uit Buenos Aires. Ik spreek Spaans en Engels en ik ben gepassioneerd door het leven, het strand en nieuwe avonturen. Scheveningen voelt voor mij als thuis. Ik ben spontaan, een tikkeltje pittig en altijd eerlijk. Kom gezellig langs — Argentinië ontmoet de zee!' },
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 2, doll_name: 'Teodora', price: 60, neighborhood: 'Centrum', age: 24, length_cm: 169, weight_kg: 58, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Zwart', languages: ['Engels', 'Duits'], description: 'Hallo, ik ben Teodora. Ik studeer internationaal recht in Den Haag en ben op zoek naar fijn gezelschap. Ik spreek vloeiend Engels en Duits. Ik ben intelligent, nieuwsgierig en heb een droog gevoel voor humor. Ik waardeer oprechte mannen die een goed gesprek kunnen voeren. Discreet en stijlvol.' },
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 3, doll_name: 'Isabela', price: 60, neighborhood: 'Laak', age: 21, length_cm: 162, weight_kg: 52, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Slank', hair_color: 'Brunette', languages: ['Portugees', 'Engels'], description: 'Hoi, ik ben Isabela! Ik ben jong, speels en in het begin een beetje verlegen — maar ik kom snel los, dat beloof ik je! Ik spreek Portugees en een beetje Engels. Ik hou van muziek en mode. Als je geduldig en lief bent, zul je een meid ontdekken die je echt weet te verrassen!' },
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 4, doll_name: 'Nina', price: 70, neighborhood: 'Benoordenhout', age: 34, length_cm: 167, weight_kg: 60, origin_region: 'West-Europees', skin_tone: 'Blank', body_type: 'Mollig', hair_color: 'Blond', languages: ['Nederlands', 'Engels'], description: 'Hoi, ik ben Nina — een echte Haagse meid! Ik spreek Nederlands en Engels. Ik ben direct, zelfverzekerd en ik weet wat ik wil. Geen spelletjes, geen drama. Ik hou van goede gesprekken, het stadsleven en eerlijk contact. Als je een no-nonsense vrouw zoekt die waarmaakt wat ze belooft, kom dan gezellig langs!' },
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 5, doll_name: 'Paulina', price: 70, neighborhood: 'Segbroek', age: 28, length_cm: 165, weight_kg: 57, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Gemiddeld', hair_color: 'Rood', languages: ['Engels', 'Pools'], description: 'Hey, ik ben Paulina! Ik werk in de horeca en hou oprecht van mensen. Ik spreek Engels en Pools. Ik ben warm, grappig en altijd ontspannen. Ik geniet van koken, films en lange avonden met goed gezelschap. Elk bezoek bij mij is anders — en altijd speciaal. Kom het zelf ervaren!' },
  { city: 'den-haag', location: 'Den Haag', photoPrefix: 6, doll_name: 'Roxana', price: 80, neighborhood: 'Escamp', age: 32, length_cm: 171, weight_kg: 63, origin_region: 'Oost-Europees', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Engels', 'Duits'], description: 'Hallo, ik ben Roxana uit Boekarest. Ik woon nu vier jaar in Nederland en ik vind het hier geweldig. Ik spreek Engels en een beetje Duits. Ik ben onafhankelijk, stijlvol en ik weet precies hoe ik een fijne sfeer moet creëren. Ik hou van mode, reizen en nieuwe ervaringen. Kom gezellig langs en ontdek het zelf!' },

  // ---- Utrecht ----
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 1, doll_name: 'Valeria', price: 60, neighborhood: 'Lombok', age: 25, length_cm: 165, weight_kg: 55, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Spaans', 'Engels'], description: 'Hoi! Ik ben Valeria uit Colombia en ik verken de wereld vanuit Utrecht. Ik spreek Spaans en Engels. Ik ben nieuwsgierig, sociaal en altijd in voor iets nieuws. Ik lach veel en vind het heerlijk om de mensen om me heen een goed gevoel te geven. Kom gezellig bij me langs in Lombok — laten we samen plezier maken!' },
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 2, doll_name: 'Veronika', price: 60, neighborhood: 'Wittevrouwen', age: 29, length_cm: 168, weight_kg: 60, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Blond', languages: ['Engels', 'Duits'], description: 'Hallo, ik ben Veronika uit Praag! Ik hou enorm van fietsen en Utrecht is daar echt perfect voor. Ik spreek Engels en Duits. Ik ben rustig, lief en heb een zachte uitstraling. Ik geniet van yoga, de natuur en goede, diepgaande gesprekken. Ik ben betrouwbaar en altijd op tijd. Ik kijk ernaar uit om je te ontmoeten!' },
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 3, doll_name: 'Gabriela', price: 60, neighborhood: 'Kanaleneiland', age: 22, length_cm: 163, weight_kg: 53, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Slank', hair_color: 'Zwart', languages: ['Spaans', 'Engels'], description: 'Hoi, ik ben Gabriela uit Quito! Ik spreek Spaans en een klein beetje Engels. In het begin ben ik misschien wat verlegen als we elkaar ontmoeten, maar ik kom al snel los — dat beloof ik je! Ik hou van muziek, lekker eten en gezellige avonden. Ik ben lief, zorgzaam en attent. Geef me een kans en ik ga je heel gelukkig maken!' },
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 4, doll_name: 'Marta', price: 70, neighborhood: 'Tuinwijk', age: 36, length_cm: 167, weight_kg: 62, origin_region: 'Zuid-Europees', skin_tone: 'Getint', body_type: 'Mollig', hair_color: 'Brunette', languages: ['Italiaans', 'Engels', 'Spaans'], description: 'Ciao! Ik ben Marta uit Bologna. Ik spreek Italiaans, Engels en een beetje Spaans. Ik ben gepassioneerd, direct en hou van lekker eten en goede wijn. Ik breng Italiaanse warmte en stijl in alles wat ik doe. Als je een echte vrouw met persoonlijkheid kunt waarderen, kom dan zeker kennismaken!' },
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 5, doll_name: 'Monika', price: 70, neighborhood: 'Overvecht', age: 27, length_cm: 166, weight_kg: 58, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Gemiddeld', hair_color: 'Brunette', languages: ['Engels', 'Pools'], description: 'Hoi, ik ben Monika! Ik werk in de gezondheidszorg en ben van nature een geduldig en empathisch persoon. Ik spreek Engels en Pools. Ik hou van wandelen, lezen en echt naar mensen luisteren. Bij mij zul je je gehoord en meteen op je gemak voelen. Kom gezellig langs — ik zal goed voor je zorgen!' },
  { city: 'utrecht', location: 'Utrecht', photoPrefix: 6, doll_name: 'Andreea', price: 80, neighborhood: 'Centrum', age: 31, length_cm: 170, weight_kg: 61, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Brunette', languages: ['Engels', 'Duits'], description: 'Hallo, ik ben Andreea uit Cluj! Ik woon al een tijdje in Utrecht en ik hou echt van de sfeer hier. Ik spreek Engels en een beetje Duits. Ik ben zelfverzekerd, grappig en ik weet precies hoe ik een avond speciaal moet maken. Ik geniet van theater en muziek. Kom langs en laat je betoveren!' },

  // ---- Eindhoven ----
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 1, doll_name: 'Paola', price: 60, neighborhood: 'Woensel', age: 24, length_cm: 164, weight_kg: 55, origin_region: 'Latijns-Amerikaans', skin_tone: 'Getint', body_type: 'Gemiddeld', hair_color: 'Zwart', languages: ['Spaans', 'Engels'], description: 'Hoi, ik ben Paola uit Lima! Ik spreek Spaans en Engels. Ik ben vrolijk, warm en hou van dansen en koken. Ik breng Peruaanse energie overal waar ik ga. Je voelt je welkom vanaf het moment dat je binnenstapt. Kom gezellig langs in Woensel — laten we samen een geweldige tijd hebben!' },
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 2, doll_name: 'Bojana', price: 60, neighborhood: 'Stratum', age: 27, length_cm: 170, weight_kg: 61, origin_region: 'Oost-Europees', skin_tone: 'Getint', body_type: 'Atletisch', hair_color: 'Brunette', languages: ['Engels', 'Duits'], description: 'Hey, ik ben Bojana uit Sarajevo! Ik woon nu drie jaar in Nederland. Ik spreek Engels en Duits. Ik ben recht door zee, eerlijk en ik heb een droog gevoel voor humor. Ik hou van sporten en de buitenlucht. Ik weet wat ik wil en ik zeg het gewoon. Geen spelletjes — gewoon echt en gezellig!' },
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 3, doll_name: 'Fernanda', price: 60, neighborhood: 'Tongelre', age: 23, length_cm: 162, weight_kg: 52, origin_region: 'Latijns-Amerikaans', skin_tone: 'Donker', body_type: 'Mollig', hair_color: 'Brunette', languages: ['Portugees', 'Engels'], description: 'Oi! Ik ben Fernanda, een jonge Braziliaanse meid met een enorme liefde voor het leven. Ik spreek Portugees en een beetje Engels. Ik ben speels, lief en hou van mode en muziek. Ik ben altijd positief en vol energie. Een bezoek aan mij tovert gegarandeerd een glimlach op je gezicht!' },
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 4, doll_name: 'Katerina', price: 70, neighborhood: 'Gestel', age: 30, length_cm: 168, weight_kg: 59, origin_region: 'Zuid-Europees', skin_tone: 'Getint', body_type: 'Mollig', hair_color: 'Zwart', languages: ['Engels'], description: 'Yia sas! Ik ben Katerina uit Thessaloniki. Ik spreek Engels en Grieks. Ik ben gepassioneerd, gastvrij en hou van lekker eten en het goede leven. Ik ben direct in het contact, maar altijd respectvol. Ik breng mediterrane warmte in alles wat ik doe. Kom langs en ervaar het zelf!' },
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 5, doll_name: 'Karolina', price: 70, neighborhood: 'Centrum', age: 26, length_cm: 166, weight_kg: 57, origin_region: 'Oost-Europees', skin_tone: 'Blank', body_type: 'Slank', hair_color: 'Blond', languages: ['Engels', 'Pools'], description: 'Hoi, ik ben Karolina! Ik werk bij een designbureau hier in Eindhoven en pas helemaal thuis in deze creatieve stad. Ik spreek Engels en Pools. Ik ben creatief, rustig en attent. Ik hou van design, fotografie en goede gesprekken. Slim en gezellig — de beste combinatie!' },
  { city: 'eindhoven', location: 'Eindhoven', photoPrefix: 6, doll_name: 'Elena', price: 80, neighborhood: 'Woensel-Noord', age: 40, length_cm: 169, weight_kg: 64, origin_region: 'Russisch', skin_tone: 'Blank', body_type: 'Mollig', hair_color: 'Brunette', languages: ['Engels', 'Russisch'], description: 'Hallo, ik ben Elena uit Sint-Petersburg. Ik woon inmiddels tien jaar in Nederland. Ik spreek Engels en Russisch. Ik ben rustig, zelfverzekerd en ervaren. Ik weet precies wat mannen nodig hebben en bied dat met veel klasse aan. Elegant, discreet en absoluut onvergetelijk. Kom gezellig kennismaken.' },
];

const insertListing = db.prepare(`
  INSERT INTO listings (
    user_id, slug, description, price, location, neighborhood,
    doll_name, age, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color, languages,
    status, is_fictional, activated_at
  ) VALUES (
    @user_id, @slug, @description, @price, @location, @neighborhood,
    @doll_name, @age, @length_cm, @weight_kg, @body_type, @origin_region, @skin_tone, @hair_color, @languages,
    'active', 1, datetime('now')
  )
`);
const insertImage = db.prepare('INSERT INTO listing_images (listing_id, filename, sort_order) VALUES (?, ?, ?)');

let listingCount = 0;
let photoCount = 0;

PROFILES.forEach((profile, i) => {
  const slug = uniqueSlug(profile.doll_name);
  const result = insertListing.run({
    user_id: owner.id,
    slug,
    description: profile.description,
    price: profile.price,
    location: profile.location,
    neighborhood: profile.neighborhood,
    doll_name: profile.doll_name,
    age: profile.age,
    length_cm: profile.length_cm,
    weight_kg: profile.weight_kg,
    body_type: profile.body_type,
    origin_region: profile.origin_region,
    skin_tone: profile.skin_tone,
    hair_color: profile.hair_color,
    languages: profile.languages.join(','),
  });
  const listingId = result.lastInsertRowid;
  listingCount += 1;

  const sourceDir = path.join(SOURCE_ROOT, profile.city, 'webp');
  for (let photoIndex = 1; photoIndex <= 4; photoIndex += 1) {
    const sourceFile = path.join(sourceDir, `foto-${profile.photoPrefix}${photoIndex}.webp`);
    if (!fs.existsSync(sourceFile)) {
      console.error(`Ontbrekende foto: ${sourceFile}`);
      process.exit(1);
    }
    const destFilename = `${Date.now()}-${Math.random().toString(16).slice(2, 14)}.webp`;
    fs.copyFileSync(sourceFile, path.join(UPLOAD_DIR, destFilename));
    insertImage.run(listingId, destFilename, photoIndex - 1);
    photoCount += 1;
  }

  console.log(`[${i + 1}/${PROFILES.length}] ${profile.doll_name} (${profile.location}) — listing ${listingId}, 4 foto's`);
});

console.log(`\nKlaar: ${listingCount} fictieve listings, ${photoCount} foto's geïmporteerd.`);
process.exit(0);
