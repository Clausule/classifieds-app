const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const upload = require('../config/upload');
const { requireAuth, requireVerifiedAdvertiser } = require('../middleware/auth');
const { useAccountLocale } = require('../middleware/i18n');
const { uniqueSlug, slugify, locationSlug, listingPath } = require('../utils/slugify');
const { absoluteUrl, canonicalUrl, withLocale, MARKETPLACE_OPERATIONAL } = require('../utils/seo');
const { bestMatch } = require('../utils/fuzzyMatch');
const { processAutoRenewals } = require('./credits');
const { processDueNotifications } = require('../utils/verificationFailures');
const { isHeic, isConvertibleToWebp, convertHeicToJpeg, convertToWebp } = require('../utils/imageConversion');
const { haversineKm } = require('../utils/geo');
const { getSetting } = require('../utils/settings');
const { phoneE164 } = require('../utils/phone');
const { activityBucket } = require('../utils/activity');
const ai = require('../config/ai');
const faqItems = require('../data/faq');
const relatedLinks = require('../data/relatedLinks');

const router = express.Router();

const PAGE_SIZE = 12;
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Kaartafbeeldingen komen van de betaalde Google Static Maps API en kostten
// vóór deze cache één request per pageview — één SEO-crawler langs alle
// advertentiepagina's legde daarmee op 25-09-2026 het hele Maps-project plat.
// Nu haalt de server elke kaart hooguit één keer op. Buiten public/ zodat er
// geen tweede, rechtstreeks bereikbare URL voor hetzelfde plaatje ontstaat;
// de map staat in .gitignore en wordt niet meegesynct bij een deploy.
const MAP_CACHE_DIR = path.join(__dirname, '..', 'map-cache');
fs.mkdirSync(MAP_CACHE_DIR, { recursive: true });

// Sleutel op het adres, niet op het listing-id: twee advertenties in dezelfde
// buurt delen dezelfde kaart, en verhuist een advertentie naar een andere
// buurt dan mist hij vanzelf en wordt er een nieuwe opgehaald. Geen TTL —
// gemeentegrenzen veranderen niet, en een verlopen cache zou juist weer geld
// kosten. Opruimen kan altijd met `rm -rf map-cache`.
function mapCacheFile(address) {
  const hash = require('crypto').createHash('sha1').update(address).digest('hex');
  return path.join(MAP_CACHE_DIR, `${hash}.png`);
}
const CONVERT_TO_WEBP = process.env.IMAGE_CONVERT_WEBP === 'true';

// iPhone-foto's zijn vaak HEIC — zet die om naar JPEG zodat ze in elke browser
// zichtbaar zijn (niet alleen Safari/macOS), in place op de al geüploade
// bestanden. Gooit door als een bestand corrupt/onleesbaar is. Daarna
// optioneel (achter IMAGE_CONVERT_WEBP) comprimeren naar .webp om
// serverruimte/laadtijd te besparen — uit tot de migratie naar een echte
// server, want tot die tijd is bestandsgrootte geen probleem.
async function convertHeicUploads(files) {
  for (const file of files || []) {
    if (isHeic(file.filename)) {
      file.filename = await convertHeicToJpeg(UPLOAD_DIR, file.filename);
    }
    if (CONVERT_TO_WEBP && isConvertibleToWebp(file.filename)) {
      file.filename = await convertToWebp(UPLOAD_DIR, file.filename, { width: 1600, quality: 80 });
    }
  }
}

function getAdvertiserProfile(userId) {
  return db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(userId);
}

// Leesbare weergave ("+31 612345678") van hetzelfde nummer dat phoneE164
// gebruikt — voor tonen aan de adverteerder zelf op het listing-formulier,
// ongeacht verificatiestatus (dat is hun eigen gegeven).
function formatPhoneDisplay(profile) {
  if (!profile) return null;
  return `+${profile.phone_code} ${profile.phone_number}`;
}

// Voor de "Bel mij"-reveal op de publieke listingpagina: NL-nummers tonen we
// in het vertrouwde 06-formaat zonder landcode (de tel:-link gebruikt intussen
// gewoon phoneE164, dus bellen vanuit het buitenland blijft werken). Andere
// landcodes tonen we altijd volledig, want daar is geen lokale 0-vorm.
function formatSellerPhoneDisplay(profile) {
  if (!profile) return null;
  return profile.phone_code === '31' ? `0${profile.phone_number}` : `+${profile.phone_code} ${profile.phone_number}`;
}

// ---- Listing attribute options (modepoppen niche) ------------------------
const PRICE_OPTIONS = [50, 60, 70, 80];
const BODY_TYPES = ['Dun', 'Slank', 'Atletisch', 'Gemiddeld', 'Mollig'];
const ORIGIN_REGIONS = [
  'Noord-Europees', 'West-Europees', 'Zuid-Europees', 'Oost-Europees', 'Russisch',
  'Aziatisch', 'Midden-Oosters', 'Afrikaans', 'Latijns-Amerikaans', 'Noord-Amerikaans',
  'Oceanisch', 'Overig',
];
const SKIN_TONES = ['Blank', 'Getint', 'Donker', 'Zwart'];
const HAIR_COLORS = ['Blond', 'Brunette', 'Rood', 'Zwart', 'Grijs', 'Anders'];
const LANGUAGES = [
  'Nederlands', 'Engels', 'Duits', 'Frans', 'Spaans',
  'Portugees', 'Italiaans', 'Chinees', 'Pools', 'Russisch',
];

// Sfeer-vragen voor de AI-bio-prompt — nooit op de advertentie zelf getoond
// (zie listing-form.ejs: pas zichtbaar na klikken op "Genereer omschrijving"),
// alleen als merge-velden voor de prompt-template.
const FIRST_IMPRESSIONS = ['Lief', 'Spontaan', 'Elegant', 'Ondeugend', 'Rustig', 'Energiek', 'Stijlvol', 'Speels'];
const MEETING_ATMOSPHERES = ['Ontspannen', 'Romantisch', 'Gezellig', 'Luxe', 'Spontaan'];
const DESIRED_IMPRESSIONS = ['Elegant', 'Speels', 'Warm', 'Ondeugend', 'Luxe'];
const VISITOR_EXPECTATIONS = ['Ontspannen sfeer', 'Gezellig gesprek', 'Discretie', 'Persoonlijke aandacht'];

// ---- Public: browse + search/filter -------------------------------------
router.get('/', async (req, res) => {
  // No cron/background worker in this app — piggyback the (cheap, mostly-empty)
  // auto-renew sweep and the sms/e-mail cross-channel-escalation sweep on the
  // highest-traffic page so both stay fresh without dedicated infrastructure.
  processAutoRenewals();
  processDueNotifications();

  const { q, min_price, max_price, city, sort, neighborhood } = req.query;
  const radius = ['5', '10', '15', '30', '50'].includes(req.query.radius) ? Number(req.query.radius) : 0;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  // Alleen steden waar nu daadwerkelijk een actieve listing staat — geen zin
  // om heel Nederland te laten kiezen als negen van de tien steden leeg zijn.
  const activeCities = db
    .prepare("SELECT DISTINCT location FROM listings WHERE status = 'active' AND location IS NOT NULL ORDER BY location")
    .all()
    .map((row) => row.location);

  // Zelfde idee als activeCities, maar dan geschaald naar de gekozen stad —
  // de buurtfilter mag alleen buurten tonen waar ook echt iets staat.
  const cityNeighborhoods = city
    ? db
        .prepare("SELECT DISTINCT neighborhood FROM listings WHERE status = 'active' AND location = @city AND neighborhood IS NOT NULL ORDER BY neighborhood")
        .all({ city })
        .map((row) => row.neighborhood)
    : [];

  // "Gebruik mijn locatie" geeft de écht herkende stad/buurt door (GPS tegen
  // echte gemeente-/wijkgrenzen, zie /geocode/nearby-listings) — dat mag nooit
  // stilzwijgend leeg blijven staan alleen omdat er daar (nog) geen
  // advertenties staan. activeCities/cityNeighborhoods hierboven blijven puur
  // voor de handmatige stad/buurt-zoekvelden (die terecht wél beperkt zijn tot
  // steden/buurten met advertenties); deze twee vlaggen laten de view weten of
  // de gekozen stad/buurt daadwerkelijk advertenties heeft, zodat hij die
  // subtiel anders (lichtgrijs) kan tonen in plaats van te verbergen.
  const cityHasListings = !city || activeCities.includes(city);
  const neighborhoodHasListings = !neighborhood || cityNeighborhoods.includes(neighborhood);

  const where = ["l.status = 'active'"];
  const params = {};

  if (q) {
    where.push('(l.doll_name LIKE @q OR l.description LIKE @q)');
    params.q = `%${q}%`;
  }
  if (min_price) {
    where.push('l.price >= @min_price');
    params.min_price = Number(min_price);
  }
  if (max_price) {
    where.push('l.price <= @max_price');
    params.max_price = Number(max_price);
  }
  const selectedPrices = [].concat(req.query.price || []).map(Number).filter((p) => PRICE_OPTIONS.includes(p));
  if (selectedPrices.length) {
    const pricePlaceholders = selectedPrices.map((p, i) => {
      params[`price${i}`] = p;
      return `@price${i}`;
    });
    where.push(`l.price IN (${pricePlaceholders.join(', ')})`);
  }
  // Straal is relatief aan de buurt zodra die gekozen is (dichter bij wat de
  // bezoeker net heeft ingeperkt), anders relatief aan de stad. Nooit allebei
  // los toepassen — "binnen 10km van de stad" + "exact deze buurt" levert
  // altijd hetzelfde resultaat op als zonder straal, want de buurtnaam bestaat
  // toch nergens buiten die ene stad. De straal vergroot het zoekgebied
  // uitsluitend — de exacte selectie (stad of buurt) wordt altijd los
  // gegarandeerd (los OR-blok hieronder), de straal-vergelijking zelf gebeurt
  // rand-tot-rand tussen polygonen (zie minDistanceBetweenGeometriesKm), niet
  // via middelpunten, dus een advertentie binnen de gekozen stad/buurt kan
  // nooit uitvallen zodra er een straal bij komt.
  if (neighborhood && city && radius) {
    const exactClause = 'l.location = @city AND l.neighborhood = @neighborhood';
    params.city = city;
    params.neighborhood = neighborhood;
    let extraPairs = [];
    try {
      const wijken = await fetchGemeenteWijken(city);
      const origin = wijken.find((f) => f.properties.wijknaam === neighborhood);
      extraPairs = origin
        ? await listingsWithinRadiusOfBoundary(
            origin.geometry,
            radius,
            (c) => c.location.toLowerCase() === city.toLowerCase() && c.neighborhood === neighborhood
          )
        : [];
    } catch (err) {
      console.error('Straal-filter (buurt, PDOK) mislukt, val terug op exacte buurt:', err);
    }
    where.push(extraPairs.length ? `(${exactClause} OR ${radiusMatchClause(extraPairs, params)})` : exactClause);
  } else if (neighborhood && city) {
    where.push('l.location = @city AND l.neighborhood = @neighborhood');
    params.city = city;
    params.neighborhood = neighborhood;
  } else if (city && radius) {
    params.city = city;
    let extraPairs = [];
    try {
      const origin = await gemeenteGeometry(city);
      extraPairs = origin
        ? await listingsWithinRadiusOfBoundary(origin, radius, (c) => c.location.toLowerCase() === city.toLowerCase())
        : [];
    } catch (err) {
      console.error('Straal-filter (stad, PDOK) mislukt, val terug op exacte stad:', err);
    }
    where.push(extraPairs.length ? `(l.location = @city OR ${radiusMatchClause(extraPairs, params)})` : 'l.location = @city');
  } else if (city) {
    where.push('l.location = @city');
    params.city = city;
  } else if (neighborhood) {
    where.push('l.neighborhood = @neighborhood');
    params.neighborhood = neighborhood;
  }

  // Eén bron voor "de bezoeker heeft zelf iets ingesteld" — ook sorteren en
  // pagina 2 tellen mee, anders zou de 1-per-stad-weergave hieronder blijven
  // hangen op een URL waar de bezoeker juist méér verwacht te zien.
  const hasRealFilter = !!(
    q || city || neighborhood || radius || min_price || max_price ||
    selectedPrices.length || sort
  );
  const hasAnyFilter = hasRealFilter || page > 1;

  // Alleen een paginanummer, verder niets: dat hoort bij de volledige lijst, en
  // die bestaat niet zolang de kale homepage één advertentie per stad toont.
  // Zonder deze omleiding blijven /?page=2 en /?page=3 de verborgen
  // demo-advertenties tonen (Google kent die URL's nog van vóór die wijziging
  // en crawlt ze door) en geeft /?page=4 een lege 200 — een soft 404.
  // Bewust een 302: zodra de vlag op true gaat bestaan deze pagina's weer, dus
  // het is geen permanente URL-wijziging. Een actief filter paginereert gewoon
  // door (?city=Amsterdam&page=2 blijft werken), dus alle advertenties blijven
  // bereikbaar. Verwijderen bij operationeel (zie GO-LIVE.md).
  if (!MARKETPLACE_OPERATIONAL && page > 1 && !hasRealFilter) {
    return res.redirect(302, withLocale(res, '/'));
  }

  const orderBy =
    sort === 'price_asc' ? 'l.price ASC' :
    sort === 'price_desc' ? 'l.price DESC' :
    sort === 'oldest' ? 'l.created_at ASC' :
    "(CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 0 ELSE 1 END), l.created_at DESC";

  const whereClause = where.join(' AND ');

  // Zolang de marktplaats niet operationeel is staan er alleen fictieve
  // demo-advertenties (6 per stad). Die alle 30 op de kale homepage tonen
  // maakt het grootste, meest prominente deel van een geïndexeerde pagina
  // verzonnen content. Daarom op de ónbewerkte homepage één advertentie per
  // stad; alles blijft in de database staan en komt gewoon terug zodra de
  // bezoeker filtert (stad, buurt, straal, prijs, zoeken, sorteren,
  // paginering) — die takken draaien exact de query hieronder, ongewijzigd.
  // Verdwijnt vanzelf zodra MARKETPLACE_OPERATIONAL op true gaat.
  const oneResultPerCity = !MARKETPLACE_OPERATIONAL && !hasAnyFilter;

  const total = oneResultPerCity
    ? db.prepare(`SELECT COUNT(DISTINCT l.location) AS n FROM listings l WHERE ${whereClause}`).get(params).n
    : db.prepare(`SELECT COUNT(*) AS n FROM listings l WHERE ${whereClause}`).get(params).n;

  const baseSelect = `
      SELECT l.*,
             (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 1 ELSE 0 END) AS is_premium_active,
             (SELECT filename FROM listing_images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) AS thumbnail,
             u.last_active_at,
             (SELECT MAX(created_at) FROM messages WHERE user_id = l.user_id AND sender = 'user') AS last_message_at`;

  const listings = db
    .prepare(
      oneResultPerCity
        ? `
      SELECT * FROM (${baseSelect},
             ROW_NUMBER() OVER (PARTITION BY l.location ORDER BY l.created_at DESC) AS rn
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE ${whereClause}
      )
      WHERE rn = 1
      ORDER BY ${orderBy.replace(/\bl\./g, '')}
      LIMIT @limit OFFSET @offset
    `
        : `${baseSelect}
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `
    )
    .all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  listings.forEach((l) => {
    l.detailUrl = withLocale(res, listingPath(l));
    l.activityStatus = activityBucket(l.last_active_at, l.last_message_at);
    l.neighborhood = displayNeighborhood(l.neighborhood);
  });

  res.render('index', {
    title: 'index.title',
    metaTitle: res.locals.t('home.meta_title'),
    metaDescription: res.locals.t('home.meta_description'),
    canonicalUrl: canonicalUrl(res, '/'), // filters/paginering canonicaliseren naar de schone basis-URL
    listings,
    cities: activeCities,
    neighborhoods: cityNeighborhoods,
    cityHasListings,
    neighborhoodHasListings,
    query: req.query,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE) || 1,
    total,
    faqItems,
    relatedLinks,
  });
});

// ---- Advertiser: reverse geocode coordinates to a city name --------------
function extractCity(addressComponents) {
  const findType = (type) => addressComponents.find((c) => c.types.includes(type));
  const component =
    findType('locality') ||
    findType('postal_town') ||
    findType('administrative_area_level_2') ||
    findType('administrative_area_level_1');
  return component ? component.long_name : null;
}

// Gedeeld door /geocode/reverse (adverteerder, listing-formulier) en
// /geocode/nearby-listings (bezoeker, "in de buurt"-knop op de homepage).
// City komt uit Google's tekst (gematcht tegen de CBS-stedenlijst), buurt
// wordt bepaald door de échte coördinaten tegen echte wijkgrenzen te testen —
// Google's eigen neighborhood/sublocality-tekst is te grof (bv. heel
// "Amsterdam-Zuid" i.p.v. "De Pijp").
async function resolveCityNeighborhood(lat, lng, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' || !data.results.length) {
    console.error('Google Geocoding API error:', data.status, data.error_message);
    return { city: null, neighborhood: null };
  }

  const rawCity = extractCity(data.results[0].address_components) || data.results[0].formatted_address;

  let city = null;
  let neighborhood = null;

  try {
    const cities = await loadCities();
    city = bestMatch(rawCity, cities, (name) => name, 0.6) || null;
  } catch (err) {
    console.error('City match failed:', err);
  }

  if (city) {
    try {
      const wijken = await fetchGemeenteWijken(city);
      const match = wijken.find((f) => pointInGeometry(Number(lng), Number(lat), f.geometry));
      neighborhood = match ? match.properties.wijknaam : null;
    } catch (err) {
      console.error('Neighborhood lookup failed:', err);
    }
  }

  return { city, neighborhood };
}

router.get('/geocode/reverse', requireAuth, async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat en lng zijn verplicht.' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY ontbreekt in .env.' });
  }

  try {
    res.json(await resolveCityNeighborhood(lat, lng, apiKey));
  } catch (err) {
    res.status(502).json({ error: 'Geocoding-service niet bereikbaar.' });
  }
});

// ---- Bezoeker: "in de buurt" op de homepage — reverse-geocode + oplopend
// zoeken (exacte buurt, dan 5/10/15/30/50km) tot er ergens advertenties zijn.
// De straal wordt berekend vanaf de échte GPS-coördinaten van de bezoeker
// (niet vanaf de herkende buurt-/stad-centroid) — nauwkeuriger, en werkt ook
// door als de buurt zelf niet herkend kon worden (bv. punt buiten alle
// wijk-polygonen). Geen auth nodig, dit is een publieke homepage-actie.
router.get('/geocode/nearby-listings', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat en lng zijn verplicht.' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY ontbreekt in .env.' });
  }

  try {
    const { city, neighborhood } = await resolveCityNeighborhood(lat, lng, apiKey);
    if (!city) {
      return res.status(404).json({ error: 'Geen stad gevonden voor deze locatie.' });
    }

    if (neighborhood) {
      const exact = db
        .prepare("SELECT 1 FROM listings WHERE status = 'active' AND location = ? AND neighborhood = ? LIMIT 1")
        .get(city, neighborhood);
      if (exact) {
        return res.json({ city, neighborhood, radius: null });
      }
    }

    const origin = { lat: Number(lat), lng: Number(lng) };
    for (const r of [5, 10, 15, 30, 50]) {
      // eslint-disable-next-line no-await-in-loop -- bewust oplopend, stopt zodra er iets is
      const pairs = await listingsWithinRadiusOf(origin, r);
      if (pairs.length) {
        return res.json({ city, neighborhood: neighborhood || null, radius: r });
      }
    }

    res.json({ city, neighborhood: neighborhood || null, radius: 50, noResults: true });
  } catch (err) {
    console.error('Nearby-listings lookup mislukt:', err);
    res.status(502).json({ error: 'Geocoding-service niet bereikbaar.' });
  }
});

// ---- Advertiser: new listing ---------------------------------------------
function formOptions() {
  return {
    originRegions: ORIGIN_REGIONS,
    priceOptions: PRICE_OPTIONS,
    bodyTypes: BODY_TYPES,
    skinTones: SKIN_TONES,
    hairColors: HAIR_COLORS,
    languageOptions: LANGUAGES,
    firstImpressions: FIRST_IMPRESSIONS,
    meetingAtmospheres: MEETING_ATMOSPHERES,
    desiredImpressions: DESIRED_IMPRESSIONS,
    visitorExpectations: VISITOR_EXPECTATIONS,
  };
}

// Length/weight arrive as digit-only strings from the form's sanitizer; keep
// the server-side parse defensive in case JS was bypassed.
function parseDigits(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

// Sommige gemeentes (Den Haag, Utrecht, ...) prefixen hun officiële CBS-
// wijknaam met "Wijk 03 " e.d. — die prefix hoort de opgeslagen waarde te
// bevatten (nodig voor een exacte match bij de kaart-boundary-lookup), maar
// nooit getoond te worden aan bezoekers. Zelfde regex als bij het opbouwen
// van de buurt-dropdown in /geocode/neighborhoods.
function displayNeighborhood(name) {
  if (!name) return name;
  return name.replace(/^wijk\s*\d+\s*/i, '') || name;
}

// Checkbox groups arrive as a string (one checked), an array (multiple), or
// undefined (none) — normalize to an array and drop anything not in the list.
function parseLanguages(value) {
  return [].concat(value || []).filter((lang) => LANGUAGES.includes(lang));
}

// Vervangt {{veldnaam}} in de admin-beheerde prompt door de waarden die net
// in het formulier staan. Onbekende/lege merge-velden worden gewoon leeg.
function fillPromptTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (data[key] || ''));
}

// ---- Adverteerder: AI-omschrijving genereren op basis van de al ingevulde
// kenmerken — leest alleen wat er nu in de browser staat, slaat niets op. ---
router.post('/listings/generate-description', requireAuth, requireVerifiedAdvertiser, useAccountLocale, async (req, res) => {
  const {
    doll_name, age, length_cm, weight_kg, body_type, origin_region,
    skin_tone, hair_color, price, location, neighborhood,
    first_impression, meeting_atmosphere, desired_impression, visitor_expectation,
  } = req.body;
  const languages = parseLanguages(req.body.languages).join(', ');

  const template = getSetting('ai_description_prompt', '');
  if (!template) {
    return res.status(500).json({ error: res.locals.t('listing_form.error.ai_no_template') });
  }

  // De omschrijving moet altijd Engels zijn, ongeacht wat het (admin-
  // instelbare, vrij te bewerken) prompt-template hierboven zelf aangeeft —
  // vandaar hardcoded in code toegevoegd ná het invullen van het template,
  // niet als onderdeel van de admin-tekst zelf. Er is geen aparte taal-
  // parameter op de Gemini-call (config/ai.js stuurt gewoon platte tekst), dus
  // dit kan alleen via de prompt zelf.
  const prompt = fillPromptTemplate(template, {
    doll_name, age, length_cm, weight_kg, body_type, origin_region,
    skin_tone, hair_color, languages, price, location, neighborhood,
    first_impression, meeting_atmosphere, desired_impression, visitor_expectation,
  }) + '\n\nWrite the description in English, regardless of any other language instructed above.';

  try {
    const description = await ai.generateText(prompt);
    res.json({ description });
  } catch (err) {
    console.error('AI-omschrijving genereren mislukt:', err.message);
    res.status(502).json({ error: res.locals.t('listing_form.error.ai_failed') });
  }
});

router.get('/listings/new', requireAuth, requireVerifiedAdvertiser, useAccountLocale, (req, res) => {
  const phoneDisplay = formatPhoneDisplay(getAdvertiserProfile(req.user.id));
  res.render('listing-form', { title: 'listing_form.title_new', ...formOptions(), listing: {}, phoneDisplay, error: null });
});

router.post('/listings/new', requireAuth, requireVerifiedAdvertiser, useAccountLocale, upload.array('images', 10), async (req, res) => {
  const phoneDisplay = formatPhoneDisplay(getAdvertiserProfile(req.user.id));
  const fail = (message) => {
    (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(400).render('listing-form', {
      title: 'listing_form.title_new',
      ...formOptions(),
      listing: req.body,
      phoneDisplay,
      error: message,
    });
  };

  // Een niet-toegestaan bestandstype wordt door multer stilzwijgend
  // overgeslagen (zie config/upload.js) i.p.v. de hele request te laten
  // crashen — hier melden we dat alsnog, met behoud van ingevulde velden.
  if (req.rejectedFiles?.length) {
    return fail('listing_form.error.file_type');
  }

  const {
    description, price, location, neighborhood,
    doll_name, age, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color,
    first_impression, meeting_atmosphere, desired_impression, visitor_expectation,
  } = req.body;
  const languages = parseLanguages(req.body.languages);

  const priceValid = PRICE_OPTIONS.includes(Number(price));

  if (
    !description || !location || !neighborhood || !priceValid ||
    !doll_name || !age || !length_cm || !weight_kg || !body_type || !origin_region || !skin_tone || !hair_color ||
    languages.length === 0
  ) {
    return fail('listing_form.error.required');
  }

  if ((req.files || []).length < 4) {
    return fail('listing_form.error.photos_min');
  }

  try {
    await convertHeicUploads(req.files);
  } catch (err) {
    console.error('HEIC-conversie mislukt:', err.message);
    return fail('listing_form.error.heic_failed');
  }

  const slug = uniqueSlug(doll_name);
  const result = db
    .prepare(`
      INSERT INTO listings (
        user_id, slug, description, price, location, neighborhood,
        doll_name, age, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color, languages,
        first_impression, meeting_atmosphere, desired_impression, visitor_expectation, status
      )
      VALUES (
        @user_id, @slug, @description, @price, @location, @neighborhood,
        @doll_name, @age, @length_cm, @weight_kg, @body_type, @origin_region, @skin_tone, @hair_color, @languages,
        @first_impression, @meeting_atmosphere, @desired_impression, @visitor_expectation, 'pending'
      )
    `)
    .run({
      user_id: req.user.id,
      slug,
      description: description.trim(),
      price: Number(price),
      location: location.trim(),
      neighborhood: neighborhood.trim(),
      doll_name: doll_name.trim(),
      age: parseDigits(age),
      length_cm: parseDigits(length_cm),
      weight_kg: parseDigits(weight_kg),
      body_type,
      origin_region,
      skin_tone,
      hair_color,
      languages: languages.join(','),
      first_impression: first_impression || null,
      meeting_atmosphere: meeting_atmosphere || null,
      desired_impression: desired_impression || null,
      visitor_expectation: visitor_expectation || null,
    });

  const listingId = result.lastInsertRowid;
  (req.files || []).forEach((file, i) => {
    db.prepare('INSERT INTO listing_images (listing_id, filename, sort_order) VALUES (?, ?, ?)').run(
      listingId,
      file.filename,
      i
    );
  });

  res.redirect(withLocale(res, '/dashboard?created=1'));
});

// ---- Advertiser: edit own listing -----------------------------------------
router.get('/listings/:id/edit', requireAuth, useAccountLocale, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.user_id !== req.user.id || listing.status === 'deleted') {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.own_listing_message' });
  }
  const images = db.prepare('SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order').all(listing.id);
  const phoneDisplay = formatPhoneDisplay(getAdvertiserProfile(req.user.id));
  res.render('listing-form', { title: 'listing_form.title_edit', ...formOptions(), listing, images, phoneDisplay, error: null });
});

router.post('/listings/:id/edit', requireAuth, useAccountLocale, upload.array('images', 10), async (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.user_id !== req.user.id || listing.status === 'deleted') {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.own_listing_message' });
  }

  // Bestaande foto's kunnen (nog) niet verwijderd worden bij bewerken — nieuwe
  // uploads worden alleen toegevoegd — dus voor de min/max-telling tellen ze
  // gewoon mee met wat er al staat.
  const existingImages = db.prepare('SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order').all(listing.id);

  const phoneDisplay = formatPhoneDisplay(getAdvertiserProfile(req.user.id));
  const fail = (message) => {
    (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(400).render('listing-form', {
      title: 'listing_form.title_edit',
      ...formOptions(),
      listing: { ...listing, ...req.body },
      images: existingImages,
      phoneDisplay,
      error: message,
    });
  };

  // Een niet-toegestaan bestandstype wordt door multer stilzwijgend
  // overgeslagen (zie config/upload.js) i.p.v. de hele request te laten
  // crashen — hier melden we dat alsnog, met behoud van ingevulde velden.
  if (req.rejectedFiles?.length) {
    return fail('listing_form.error.file_type');
  }

  const {
    description, price, location, neighborhood,
    doll_name, age, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color,
    first_impression, meeting_atmosphere, desired_impression, visitor_expectation,
  } = req.body;
  const languages = parseLanguages(req.body.languages);

  const priceValid = PRICE_OPTIONS.includes(Number(price));

  if (
    !description || !location || !neighborhood || !priceValid ||
    !doll_name || !age || !length_cm || !weight_kg || !body_type || !origin_region || !skin_tone || !hair_color ||
    languages.length === 0
  ) {
    return fail('listing_form.error.required');
  }

  const totalPhotos = existingImages.length + (req.files || []).length;
  if (totalPhotos < 4) {
    return fail('listing_form.error.photos_min');
  }
  if (totalPhotos > 10) {
    return fail('listing_form.error.photos_max');
  }

  try {
    await convertHeicUploads(req.files);
  } catch (err) {
    console.error('HEIC-conversie mislukt:', err.message);
    return fail('listing_form.error.heic_failed');
  }

  db.prepare(`
    UPDATE listings SET description=@description, price=@price,
      location=@location, neighborhood=@neighborhood,
      doll_name=@doll_name, age=@age, length_cm=@length_cm, weight_kg=@weight_kg, body_type=@body_type,
      origin_region=@origin_region, skin_tone=@skin_tone, hair_color=@hair_color, languages=@languages,
      first_impression=@first_impression, meeting_atmosphere=@meeting_atmosphere,
      desired_impression=@desired_impression, visitor_expectation=@visitor_expectation,
      status='pending', updated_at=datetime('now')
    WHERE id=@id
  `).run({
    id: listing.id,
    description: description.trim(),
    price: Number(price),
    location: location.trim(),
    neighborhood: neighborhood.trim(),
    doll_name: doll_name.trim(),
    age: parseDigits(age),
    length_cm: parseDigits(length_cm),
    weight_kg: parseDigits(weight_kg),
    body_type,
    origin_region,
    skin_tone,
    hair_color,
    languages: languages.join(','),
    first_impression: first_impression || null,
    meeting_atmosphere: meeting_atmosphere || null,
    desired_impression: desired_impression || null,
    visitor_expectation: visitor_expectation || null,
  });

  (req.files || []).forEach((file, i) => {
    db.prepare('INSERT INTO listing_images (listing_id, filename, sort_order) VALUES (?, ?, ?)').run(
      listing.id,
      file.filename,
      i
    );
  });

  res.redirect(withLocale(res, '/dashboard?updated=1'));
});

router.post('/listings/:id/delete', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.user_id !== req.user.id || listing.status === 'deleted') {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.own_listing_message' });
  }
  db.prepare("UPDATE listings SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(listing.id);
  res.redirect(withLocale(res, '/dashboard?deleted=1'));
});

// ---- Public: real buurt/wijk boundaries via PDOK (CBS open data, NL only) --
const PDOK_WIJKENBUURTEN = 'https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1';

// PDOK filters on the exact official CBS gemeentenaam, which sometimes differs
// from the common city name we show in the UI. Extend this as more turn up.
const CBS_GEMEENTE_NAME_OVERRIDES = [
  ['Den Haag', "'s-Gravenhage"],
  ['Den Bosch', "'s-Hertogenbosch"],
];
const CBS_GEMEENTE_ALIASES = Object.fromEntries(
  CBS_GEMEENTE_NAME_OVERRIDES.map(([display, cbs]) => [display.toLowerCase(), cbs])
);
const REVERSE_CBS_GEMEENTE_ALIASES = Object.fromEntries(
  CBS_GEMEENTE_NAME_OVERRIDES.map(([display, cbs]) => [cbs.toLowerCase(), display])
);

function resolveCbsGemeenteName(city) {
  return CBS_GEMEENTE_ALIASES[city.trim().toLowerCase()] || city;
}

// ---- Straal-filter: gemeentegrenzen via PDOK ------------------------------
// Gemeentegrenzen veranderen vrijwel nooit, dus deze cache heeft geen TTL —
// éénmaal opgehaald blijft 'm goed voor de levensduur van het proces.
const gemeenteGeometryCache = new Map();

async function gemeenteGeometry(city) {
  const key = city.trim().toLowerCase();
  if (gemeenteGeometryCache.has(key)) return gemeenteGeometryCache.get(key);

  const gemeente = resolveCbsGemeenteName(city);
  const url = `${PDOK_WIJKENBUURTEN}/collections/gemeenten/items?f=json&limit=5&gemeentenaam=${encodeURIComponent(gemeente)}`;
  const response = await fetch(url);
  if (!response.ok) {
    gemeenteGeometryCache.set(key, null);
    return null;
  }
  const data = await response.json();
  const feature = (data.features || [])[0];
  const geometry = feature ? feature.geometry : null;

  gemeenteGeometryCache.set(key, geometry);
  return geometry;
}

// Bouwt de SQL OR-clause voor een lijst {location, neighborhood}-paren —
// neighborhood kan null zijn (advertentie zonder buurt, dan gematcht op de
// stad-polygoon, zie candidateGeometry). Lege lijst (niets binnen de straal)
// levert een altijd-onwaar clause op i.p.v. kapotte SQL.
function radiusMatchClause(pairs, params) {
  if (!pairs.length) return '1 = 0';
  const clauses = pairs.map((p, i) => {
    params[`loc${i}`] = p.location;
    if (p.neighborhood) {
      params[`nb${i}`] = p.neighborhood;
      return `(l.location = @loc${i} AND l.neighborhood = @nb${i})`;
    }
    return `(l.location = @loc${i} AND l.neighborhood IS NULL)`;
  });
  return `(${clauses.join(' OR ')})`;
}

// Fetches every non-water wijk for a gemeente (display name), used both for
// the Buurt dropdown and for the point-in-polygon lookup below. Zelfde
// "verandert vrijwel nooit"-redenering als gemeenteCentroidCache hierboven.
const gemeenteWijkenCache = new Map();
async function fetchGemeenteWijken(city) {
  const key = city.trim().toLowerCase();
  if (gemeenteWijkenCache.has(key)) return gemeenteWijkenCache.get(key);

  const gemeente = resolveCbsGemeenteName(city);
  const url = `${PDOK_WIJKENBUURTEN}/collections/wijken/items?f=json&limit=1000&gemeentenaam=${encodeURIComponent(gemeente)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  const seen = new Set();

  const wijken = (data.features || []).filter((f) => {
    const name = f.properties.wijknaam;
    if (!name || f.properties.water === 'JA' || seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  gemeenteWijkenCache.set(key, wijken);
  return wijken;
}

// Straal-filter t.o.v. een gegeven punt — gebruikt door de "in de buurt"-knop
// (/geocode/nearby-listings), waar het punt de échte GPS-coördinaten van de
// bezoeker zijn. Consistent met de STAD/BUURT-filter: een advertentie doet
// mee zodra de polygoon van haar eigen buurt (of stad, als ze geen buurt
// heeft) het punt raakt of erbinnen valt — gemeten vanaf de polygoon-rand,
// niet vanaf een middelpunt (zie minDistanceFromPointToGeometryKm hieronder,
// die dezelfde gedownsamplede randen gebruikt als minDistanceBetweenGeometriesKm
// voor de stad/buurt-variant). Blijft beperkt tot (stad, buurt)-combinaties
// die al advertenties hebben — geen zin om heel Nederlands buurtenbestand te
// doorzoeken.
async function listingsWithinRadiusOf(origin, radiusKm) {
  const candidates = db
    .prepare("SELECT DISTINCT location, neighborhood FROM listings WHERE status = 'active'")
    .all();

  const matches = [];
  for (const cand of candidates) {
    // eslint-disable-next-line no-await-in-loop -- klein aantal (stad,buurt)-paren, sequentieel is prima
    const geometry = await candidateGeometry(cand.location, cand.neighborhood);
    if (!geometry) continue;
    if (minDistanceFromPointToGeometryKm(origin.lat, origin.lng, geometry) <= radiusKm) {
      matches.push(cand);
    }
  }
  return matches;
}

// De polygoon die een advertentie's locatie het best representeert: de buurt
// zelf indien bekend en herkenbaar, anders de hele gemeente.
async function candidateGeometry(location, neighborhoodValue) {
  if (neighborhoodValue) {
    const wijken = await fetchGemeenteWijken(location);
    const feature = wijken.find((f) => f.properties.wijknaam === neighborhoodValue);
    if (feature) return feature.geometry;
  }
  return gemeenteGeometry(location);
}

// Alleen de buitenrand(en) van een polygoon, gedownsampled naar hooguit
// maxPoints punten per ring — CBS-polygonen kunnen duizenden punten hebben
// (vooral bij water/kustlijn: een gemeente als Amsterdam heeft er ~10.000),
// veel te veel om vertex-voor-vertex te vergelijken. "Goed genoeg om te
// vergelijken, niet voor iets preciezers" — gaten (meren e.d.) doen voor een
// rand-tot-rand-afstand niet ter zake, dus die worden hier bewust overgeslagen.
function sampledExteriorRings(geometry, maxPoints = 60) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.map(([exterior]) => {
    if (exterior.length <= maxPoints) return exterior;
    const stride = exterior.length / maxPoints;
    const sampled = [];
    for (let i = 0; i < maxPoints; i++) sampled.push(exterior[Math.floor(i * stride)]);
    return sampled;
  });
}

// Minimumafstand tussen twee polygonen: kleinste haversine-afstand tussen elk
// (gedownsampled) vertex-paar, met een overlap-kortsluiting (zodra een
// vertex van de ene polygoon binnen de andere valt — inclusief wanneer de
// ene de andere volledig omvat — is de afstand per definitie 0, oftewel
// "raakt of valt binnen"). Vertex-naar-vertex i.p.v. echte rand-naar-rand-
// afstand is een benadering, maar ruim nauwkeurig genoeg om te bepalen of een
// buurt de straal-cirkel raakt.
function minDistanceBetweenGeometriesKm(geomA, geomB) {
  const ringsA = sampledExteriorRings(geomA);
  const ringsB = sampledExteriorRings(geomB);

  for (const ring of ringsA) {
    for (const [lng, lat] of ring) {
      if (pointInGeometry(lng, lat, geomB)) return 0;
    }
  }
  for (const ring of ringsB) {
    for (const [lng, lat] of ring) {
      if (pointInGeometry(lng, lat, geomA)) return 0;
    }
  }

  let min = Infinity;
  for (const ringA of ringsA) {
    for (const [lngA, latA] of ringA) {
      for (const ringB of ringsB) {
        for (const [lngB, latB] of ringB) {
          const d = haversineKm(latA, lngA, latB, lngB);
          if (d < min) min = d;
        }
      }
    }
  }
  return min;
}

// Kortste afstand van een punt tot een polygoon: 0 zodra het punt binnen de
// polygoon valt, anders de kleinste haversine-afstand tot de (gedownsamplede)
// buitenrand — puntvariant van minDistanceBetweenGeometriesKm hierboven,
// gebruikt door listingsWithinRadiusOf (het GPS-punt van de "in de buurt"-knop
// is geen polygoon).
function minDistanceFromPointToGeometryKm(lat, lng, geometry) {
  if (pointInGeometry(lng, lat, geometry)) return 0;
  let min = Infinity;
  for (const ring of sampledExteriorRings(geometry)) {
    for (const [ringLng, ringLat] of ring) {
      const d = haversineKm(lat, lng, ringLat, ringLng);
      if (d < min) min = d;
    }
  }
  return min;
}

// Straal-filter vanaf de polygoon-grens van een gekozen stad of buurt — een
// advertentie doet mee zodra de polygoon van haar eigen buurt (of stad, als
// ze geen buurt heeft) de straal-cirkel vanaf `originGeometry` raakt of
// erbinnen valt. Retourneert alleen de extra treffers buiten de exacte
// selectie zelf — die garandeert de aanroeper er los bij (zie de WHERE-opbouw
// hierboven), zodat de straal het zoekgebied nooit kan verkleinen. `exclude`
// filtert de eigen (stad, buurt)-combinatie eruit, zodat die niet dubbel
// (en onnodig duur) opnieuw langs de polygon-vergelijking hoeft.
async function listingsWithinRadiusOfBoundary(originGeometry, radiusKm, exclude) {
  if (!originGeometry) return [];
  const candidates = db
    .prepare("SELECT DISTINCT location, neighborhood FROM listings WHERE status = 'active'")
    .all();

  const matches = [];
  for (const cand of candidates) {
    if (exclude && exclude(cand)) continue;
    // eslint-disable-next-line no-await-in-loop -- klein aantal (stad,buurt)-paren, sequentieel is prima
    const geometry = await candidateGeometry(cand.location, cand.neighborhood);
    if (!geometry) continue;
    if (minDistanceBetweenGeometriesKm(originGeometry, geometry) <= radiusKm) {
      matches.push(cand);
    }
  }
  return matches;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Standard ray-casting point-in-polygon test, geometry coordinates are
// [lng, lat] per GeoJSON. Handles MultiPolygon and interior rings (holes).
function pointInGeometry(lng, lat, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(([exterior, ...holes]) => {
    if (!pointInRing(lng, lat, exterior)) return false;
    return !holes.some((hole) => pointInRing(lng, lat, hole));
  });
}

// ---- City list for the "Stad" dropdown: CBS's own lightweight tabular open
// data (no geometry, ~35KB for all ~342 gemeenten) — the heavy PDOK geometry
// endpoint isn't usable here (fetching all gemeenten there is 80+MB).
const CBS_GEMEENTEN_ODATA = "https://opendata.cbs.nl/ODataApi/odata/86059NED/TypedDataSet?$select=Naam_2&$filter=startswith(RegioS,'GM')&$top=500";
const CITIES_CACHE_TTL = 24 * 60 * 60 * 1000;
let citiesCache = null;
let citiesCacheAt = 0;

async function loadCities() {
  const now = Date.now();
  if (citiesCache && now - citiesCacheAt < CITIES_CACHE_TTL) {
    return citiesCache;
  }

  const response = await fetch(CBS_GEMEENTEN_ODATA);
  const data = await response.json();
  const names = data.value
    .map((row) => row.Naam_2.trim())
    .map((cbsName) => REVERSE_CBS_GEMEENTE_ALIASES[cbsName.toLowerCase()] || cbsName)
    .sort((a, b) => a.localeCompare(b, 'nl'));

  citiesCache = names;
  citiesCacheAt = now;
  return names;
}

router.get('/geocode/cities', async (req, res) => {
  try {
    const cities = await loadCities();
    res.json({ cities });
  } catch (err) {
    console.error('CBS gemeenten fetch failed:', err);
    res.status(502).json({ error: 'Kon steden niet ophalen.' });
  }
});

router.get('/geocode/neighborhoods', async (req, res) => {
  const { city } = req.query;
  if (!city) {
    return res.status(400).json({ error: 'city is verplicht.' });
  }

  try {
    const wijken = await fetchGemeenteWijken(city);
    // Prefix (bv. "Wijk 07 ") blijft in de opgeslagen waarde voor een exacte
    // match bij de kaart-boundary-lookup, maar wordt nooit getoond — zie
    // displayNeighborhood().
    const neighborhoods = wijken
      .map((f) => {
        const name = f.properties.wijknaam;
        return { value: name, label: displayNeighborhood(name) };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'nl'));

    res.json({ neighborhoods });
  } catch (err) {
    console.error('PDOK wijken fetch failed:', err);
    res.status(502).json({ error: 'Kon buurten niet ophalen.' });
  }
});

async function findCbsBoundary(city, term) {
  const gemeente = resolveCbsGemeenteName(city);

  const tryLevel = async (collection, nameField) => {
    const url = `${PDOK_WIJKENBUURTEN}/collections/${collection}/items?f=json&limit=1000&gemeentenaam=${encodeURIComponent(gemeente)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const features = data.features || [];

    const match = bestMatch(term, features, (f) => f.properties[nameField]);
    return match ? match.geometry : null;
  };

  // CBS's official "buurt" is often a finer subdivision than the colloquial
  // neighborhood name (e.g. Amsterdam's "De Pijp" is officially split into
  // "Oude/Nieuwe/Zuid Pijp"), so fall back to the coarser "wijk" level too.
  return (await tryLevel('buurten', 'buurtnaam')) || (await tryLevel('wijken', 'wijknaam'));
}

// Keeps the Static Maps URL short: picks the largest ring of a Poly/MultiPolygon
// and thins out points beyond MAX_POINTS rather than sending the full shape.
function geometryToPathPoints(geometry) {
  const MAX_POINTS = 150;
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const largest = polygons.reduce((best, poly) => (poly[0].length > best[0].length ? poly : best), polygons[0]);
  let ring = largest[0];

  if (ring.length > MAX_POINTS) {
    const step = Math.ceil(ring.length / MAX_POINTS);
    ring = ring.filter((_, i) => i % step === 0);
  }

  return ring.map(([lng, lat]) => `${lat},${lng}`).join('%7C');
}

router.get('/listings/:id/map.png', async (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  const isOwner = !!listing && !!req.user && req.user.id === listing.user_id;
  const isAdmin = !!req.user && req.user.role === 'admin';
  const isVisible = !!listing && (isAdmin || listing.status === 'active' || (isOwner && listing.status !== 'deleted'));
  if (!isVisible) {
    return res.status(404).end();
  }

  const address = [listing.neighborhood, listing.location].filter(Boolean).join(', ');
  if (!address) {
    return res.status(404).end();
  }

  const cacheFile = mapCacheFile(address);
  if (fs.existsSync(cacheFile)) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(cacheFile);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).end();
  }

  try {
    let points = null;

    if (listing.neighborhood && listing.location) {
      try {
        const geometry = await findCbsBoundary(listing.location, listing.neighborhood);
        if (geometry) points = geometryToPathPoints(geometry);
      } catch (err) {
        console.error('PDOK boundary lookup failed, falling back to bounding box:', err);
      }
    }

    if (!points) {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();

      if (geoData.status !== 'OK' || !geoData.results.length) {
        console.error('Google Geocoding API error (map):', geoData.status, geoData.error_message);
        return res.status(404).end();
      }

      const geometry = geoData.results[0].geometry;
      const box = geometry.bounds || geometry.viewport;
      const { northeast: ne, southwest: sw } = box;
      points = [
        `${ne.lat},${sw.lng}`,
        `${ne.lat},${ne.lng}`,
        `${sw.lat},${ne.lng}`,
        `${sw.lat},${sw.lng}`,
        `${ne.lat},${sw.lng}`,
      ].join('%7C');
    }

    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x320&scale=2&path=fillcolor:0x2853e333%7Ccolor:0x2853e3ff%7Cweight:2%7C${points}&key=${apiKey}`;
    const mapRes = await fetch(mapUrl);

    if (!mapRes.ok) {
      console.error('Google Static Maps API error:', mapRes.status, await mapRes.text());
      return res.status(502).end();
    }

    const buffer = Buffer.from(await mapRes.arrayBuffer());
    // Mislukt het wegschrijven (volle schijf, rechten), dan is dat geen reden
    // om de bezoeker een kapotte kaart te tonen — hooguit haalt de volgende
    // bezoeker hem opnieuw op.
    try {
      fs.writeFileSync(cacheFile, buffer);
    } catch (err) {
      console.error('Kaart niet naar cache kunnen schrijven:', err);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Map proxy error:', err);
    res.status(502).end();
  }
});

// Telt hoe vaak de "Bel mij"-knop wordt ingedrukt (zichtbaar alleen in
// Beheer). De knop kan niet teruggezet worden zonder pagina-ververs, dus elke
// klik is een nieuwe telling — geen sessie/IP-deduplicatie nodig.
router.post('/listings/:id/call-click', (req, res) => {
  db.prepare("UPDATE listings SET call_clicks_count = call_clicks_count + 1 WHERE id = ? AND status = 'active'").run(req.params.id);
  res.status(204).end();
});

const REPORT_REASONS = ['illegal_content', 'safety_risk', 'fraud', 'inappropriate', 'other'];

// Notice & Action: laagdrempelige meldprocedure, geen account nodig. Drie
// lichte anti-spam-lagen (geen CAPTCHA — dat botst met "laagdrempelig"):
// honeypot-veld (bots vullen 'm in, mensen zien 'm niet), minimum-tijd tussen
// pagina-laden en versturen (bots submitten vrijwel direct), en rate-limits
// per IP. Honeypot/timing falen stil (net doen alsof het gelukt is, geen
// signaal aan de bot dat 'ie gedetecteerd is) — de rate-limits geven wel een
// echte melding terug, dat is geen geheime detectie maar een bewuste grens.
router.post('/listings/:id/report', (req, res) => {
  const listing = db.prepare('SELECT id, slug, location FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.listing_message' });

  const back = (query) => res.redirect(`${withLocale(res, listingPath(listing))}${query ? `?${query}` : ''}`);

  // Honeypot: 'website' is voor mensen onzichtbaar via CSS, alleen bots vullen 'm in.
  if (req.body.website && req.body.website.trim()) return back('reported=1');

  // Bots submitten vrijwel direct; een mens heeft op zijn minst een paar
  // seconden nodig om de reden te kiezen en een toelichting te typen.
  const renderedAt = Number(req.body.form_rendered_at);
  if (!renderedAt || Date.now() - renderedAt < 1500) return back('reported=1');

  const reason = req.body.reason;
  const description = (req.body.description || '').trim();
  const reporterEmail = (req.body.reporter_email || '').trim() || null;
  if (!REPORT_REASONS.includes(reason) || !description) return back('report_error=1');

  const ip = req.ip;
  const recentSameListing = db
    .prepare("SELECT COUNT(*) AS n FROM listing_reports WHERE listing_id = ? AND ip_address = ? AND created_at > datetime('now', '-1 hour')")
    .get(listing.id, ip).n;
  if (recentSameListing > 0) return back('report_duplicate=1');

  const recentTotal = db
    .prepare("SELECT COUNT(*) AS n FROM listing_reports WHERE ip_address = ? AND created_at > datetime('now', '-1 day')")
    .get(ip).n;
  if (recentTotal >= 5) return back('report_rate_limited=1');

  db.prepare(`
    INSERT INTO listing_reports (listing_id, reason, description, reporter_email, ip_address)
    VALUES (?, ?, ?, ?, ?)
  `).run(listing.id, reason, description, reporterEmail, ip);

  back('reported=1');
});

// ---- Public: oude (voor-migratie) listing-URL zonder stad-segment -------
// Blijft permanent bestaan als redirect (dashboard/beheer-links gebruiken 'm
// nog steeds) i.p.v. overal bijgewerkt te worden naar de canonieke URL.
router.get('/listings/:slug', (req, res, next) => {
  const listing = db.prepare('SELECT slug, location FROM listings WHERE slug = ?').get(req.params.slug);
  if (!listing) return next();
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(301, `${withLocale(res, listingPath(listing))}${qs ? `?${qs}` : ''}`);
});

// ---- Public: stadsoverzicht — alleen bereikbaar via het broodkruimelpad
// op een listingdetailpagina (niet gelinkt vanuit de hoofdnavigatie of het
// SEO-blok). Zelfde pad-vorm als de listing-redirect hierboven (één losse
// URL-segment); Express probeert deze handler pas als de vorige geen
// listing met die slug vond en `next()` aanriep.
router.get('/listings/:location', (req, res) => {
  const activeCities = db
    .prepare("SELECT DISTINCT location FROM listings WHERE status = 'active' AND location IS NOT NULL ORDER BY location")
    .all()
    .map((row) => row.location);
  const matchedLocation = activeCities.find((loc) => locationSlug(loc) === req.params.location);
  if (!matchedLocation) {
    return res.status(404).render('not-found', { title: 'not_found.title' });
  }

  const listings = db
    .prepare(`
      SELECT l.*,
             (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 1 ELSE 0 END) AS is_premium_active,
             (SELECT filename FROM listing_images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) AS thumbnail,
             u.last_active_at,
             (SELECT MAX(created_at) FROM messages WHERE user_id = l.user_id AND sender = 'user') AS last_message_at
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.status = 'active' AND l.location = @location
      ORDER BY (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 0 ELSE 1 END), l.created_at DESC
    `)
    .all({ location: matchedLocation });
  listings.forEach((l) => {
    l.detailUrl = withLocale(res, listingPath(l));
    l.activityStatus = activityBucket(l.last_active_at, l.last_message_at);
    l.neighborhood = displayNeighborhood(l.neighborhood);
  });

  res.render('listings-by-city', {
    title: res.locals.t('listing_city.heading', { location: matchedLocation }),
    metaTitle: res.locals.t('listing_city.heading', { location: matchedLocation }),
    metaDescription: res.locals.t('listing_city.meta_description', { location: matchedLocation, count: listings.length }),
    canonicalUrl: canonicalUrl(res, `/listings/${req.params.location}`),
    noindex: !MARKETPLACE_OPERATIONAL,
    location: matchedLocation,
    listings,
  });
});

// ---- Public: listing detail (keep last: catch-all slug route) -----------
router.get('/listings/:location/:slug', (req, res) => {
  const listing = db
    .prepare(`
      SELECT l.*, u.name AS seller_name, u.id AS seller_id, u.last_active_at,
             (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 1 ELSE 0 END) AS is_premium_active,
             (SELECT MAX(created_at) FROM messages WHERE user_id = l.user_id AND sender = 'user') AS last_message_at
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.slug = ?
    `)
    .get(req.params.slug);
  if (listing) {
    listing.activityStatus = activityBucket(listing.last_active_at, listing.last_message_at);
    listing.neighborhood = displayNeighborhood(listing.neighborhood);
  }

  const isOwner = !!listing && !!req.user && req.user.id === listing.user_id;
  const isAdmin = !!req.user && req.user.role === 'admin';
  const isVisible = !!listing && (isAdmin || listing.status === 'active' || (isOwner && listing.status !== 'deleted'));
  if (!isVisible) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.listing_message' });
  }

  // Eigenaar die zijn eigen advertentie bekijkt (vanuit dashboard > klik op
  // naam) zit in de gebruikersomgeving, maar deze pagina blijft in essentie
  // een publieke frontend-pagina — gewoon de actieve frontendtaal (res.locals.
  // t/locale, al gezet door loadLocale, hier bewust niet overschreven), geen
  // accountvoorkeur. De bio/omschrijving zelf wordt hier nooit door
  // aangeraakt (gewoon rauwe listing.description, geen t()) — die staat toch
  // altijd al in het Engels (zie de hardcoded taalinstructie bij AI-generatie
  // in /listings/generate-description hieronder).
  let editButtonLabel = null;
  if (isOwner && req.user) {
    // Uitzondering op de frontend-regel hierboven: de "Bewerken"-knop zelf
    // mag wél in de volledige accountvoorkeur (alle 5 talen, via tAccount).
    editButtonLabel = res.locals.tAccount('listing_detail.edit');
  }

  // Stad in de URL komt niet meer overeen met de huidige locatie van de
  // listing (bijv. na bewerking) — permanent doorverwijzen naar de kloppende
  // URL i.p.v. de verouderde stad stilletjes te tonen.
  const canonicalPath = listingPath(listing);
  if (req.path !== canonicalPath) {
    const qs = new URLSearchParams(req.query).toString();
    return res.redirect(301, `${withLocale(res, canonicalPath)}${qs ? `?${qs}` : ''}`);
  }

  if (listing.status === 'active') {
    db.prepare('UPDATE listings SET views_count = views_count + 1 WHERE id = ?').run(listing.id);
  }

  const images = db.prepare('SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order').all(listing.id);

  // Alleen tonen als het nummer ook echt geverifieerd is — een niet-geverifieerd
  // nummer hoort niet publiek zichtbaar te worden op een live advertentie.
  const sellerProfile = getAdvertiserProfile(listing.user_id);
  const sellerPhoneVerified = sellerProfile && sellerProfile.phone_verified_at;
  const sellerPhone = sellerPhoneVerified ? phoneE164(sellerProfile) : null;
  const sellerPhoneDisplay = sellerPhoneVerified ? formatSellerPhoneDisplay(sellerProfile) : null;
  // "Identiteit geverifieerd" = advertiser_profiles.status === 'approved',
  // live nagekeken i.p.v. aangenomen vanuit het bestaan van de listing — een
  // admin kan een eerder goedgekeurd profiel via /admin/verificaties alsnog
  // terugzetten naar 'pending'/'rejected' zonder dat de listing zelf wijzigt.
  // Bewust ontkoppeld van phone_verified_at: telefoonverificatie heeft al zijn
  // eigen zichtbare signaal (wel/geen "Bel mij"-knop hieronder), dus die telt
  // hier niet nogmaals mee — de twee losse statussen mogen prima naast elkaar
  // op de pagina staan (identiteit geverifieerd, telefoon nog niet).
  const identityVerified = !!sellerProfile && sellerProfile.status === 'approved';
  const cityUrl = listing.location ? withLocale(res, `/listings/${locationSlug(listing.location)}`) : null;
  const metaVars = { name: listing.doll_name, location: listing.location || '', price: listing.price != null ? listing.price : '' };

  res.render('listing-detail', {
    title: listing.doll_name,
    metaTitle: res.locals.t('listing_detail.meta_title', metaVars),
    metaDescription: res.locals.t('listing_detail.meta_description', metaVars),
    canonicalUrl: canonicalUrl(res, canonicalPath),
    noindex: !MARKETPLACE_OPERATIONAL,
    ogImage: images.length ? absoluteUrl(`/uploads/${images[0].filename}`) : undefined,
    listing, images, sellerPhone, sellerPhoneDisplay, identityVerified, cityUrl, flash: req.query, editButtonLabel,
  });
});

module.exports = router;
