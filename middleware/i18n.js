const fs = require('fs');
const path = require('path');

// Vertalingen zijn platte JSON-dictionaries in locales/*.json — geen
// vertaal-CMS, nieuwe teksten/talen worden als code-wijziging toegevoegd.
// Alleen bezoeker- en gebruiker/adverteerder-gerichte views gebruiken dit;
// Beheer blijft Nederlands-only.
//
// SUPPORTED_LOCALES dient twee doelen die bewust van elkaar losstaan:
// 1. Bezoekers (geen account): taal volgt puur de /en-URL-prefix hieronder,
//    hardcoded op 'en' — nooit uitgebreid met es/pt/ru, bezoekers blijven
//    NL/EN.
// 2. Ingelogde gebruikers: taal is een opgeslagen accountvoorkeur
//    (users.preferred_language, zie routes/account.js), die alle 5 talen
//    mag zijn. Deze lijst valideert die voorkeur en bepaalt welke
//    dictionaries hieronder geladen worden.
const SUPPORTED_LOCALES = ['nl', 'en', 'es', 'pt', 'ru'];
const DEFAULT_LOCALE = 'nl';

const dictionaries = {};
SUPPORTED_LOCALES.forEach((locale) => {
  dictionaries[locale] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${locale}.json`), 'utf8'));
});

// Ontbrekende key? Val terug op nl, en anders toon de key zelf zodat een
// vergeten vertaling opvalt in plaats van een lege/kapotte pagina te geven.
// Losstaand van de request/sessie zodat achtergrondprocessen (sms/WhatsApp/
// e-mail, admin-acties, de lazy verification-failure-sweep) ook kunnen
// vertalen op basis van de opgeslagen taalvoorkeur van de ontvanger, niet
// van de sessie van wie de actie toevallig triggert.
function translate(locale, key, vars) {
  const useLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const raw = (dictionaries[useLocale] && dictionaries[useLocale][key]) || dictionaries[DEFAULT_LOCALE][key] || key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (match, k) => (vars[k] != null ? vars[k] : ''));
}

// Taal volgt puur uit een URL-prefix (/en/...), geen sessie/cookie/
// Accept-Language-detectie meer — Google raadt auto-redirect op browsertaal
// expliciet af bij een hreflang-opzet, dat kan het crawlen van de andere
// taalvariant verstoren. Nederlands is de standaard (geen prefix).
//
// Het /en-prefix wordt hier van req.url gestript zodat de routers erna
// (server.js) precies hetzelfde pad zien als een normaal Nederlands verzoek —
// geen routes dubbel hoeven te definiëren. res.locals.localePath is het
// taal-vrije pad, gebruikt door header.ejs om de hreflang- en
// taalwisselaar-links naar de andere taalversie op te bouwen.
function loadLocale(req, res, next) {
  const originalPath = req.path;
  let locale = DEFAULT_LOCALE;
  let localePath = originalPath;

  if (originalPath === '/en' || originalPath.startsWith('/en/')) {
    locale = 'en';
    localePath = originalPath.slice(3) || '/';
    req.url = req.url.slice(3) || '/';
  }

  res.locals.locale = locale;
  res.locals.localePath = localePath;
  res.locals.t = function (key, vars) {
    return translate(locale, key, vars);
  };

  next();
}

// Voor de ingelogde-gebruikersomgeving (dashboard, account, credits, eigen
// listing plaatsen/bewerken): taal komt van de opgeslagen accountvoorkeur
// (users.preferred_language), niet van de /en-URL-prefix. Wordt per router/
// route ná loadUser gemount — alleen op routes die we als "gebruikers-
// omgeving" behandelen, dus NOT globaal, anders zouden publieke pagina's die
// een ingelogde gebruiker toevallig bezoekt ook meeveranderen (die moeten
// juist bezoeker-NL/EN blijven). res.locals.usingAccountLocale laat views
// (footer.ejs) weten dat de nl/en-URL-taalwisselaar hier niet van toepassing
// is.
function useAccountLocale(req, res, next) {
  if (req.user) {
    const locale = SUPPORTED_LOCALES.includes(req.user.preferred_language) ? req.user.preferred_language : DEFAULT_LOCALE;
    res.locals.locale = locale;
    res.locals.usingAccountLocale = true;
    res.locals.t = function (key, vars) {
      return translate(locale, key, vars);
    };
  }
  next();
}

// Login/registreren: bezoeker (nog geen account), maar met een eigen
// taalkeuze los van de generieke NL/EN-URL-regel hierboven — deze twee
// pagina's tonen standaard Engels, ook vanaf een Nederlandse pagina, met een
// eigen 5-talige dropdown erop. ?lang=xx (dropdown-wijziging) wordt meteen
// onthouden in de sessie, zodat een volgend bezoek aan deze pagina's dezelfde
// taal teruggeeft — geen aparte cookie nodig, de bestaande sessiecookie
// (30 dagen, saveUninitialized:false) doet dit al net als bv. ageConfirmed.
// res.locals.usingAccountLocale = true onderdrukt de generieke nl/en-
// footerwisselaar (footer.ejs): deze pagina's hebben hun eigen dropdown, dus
// een tweede taalwisselaar zou verwarrend zijn.
function useAuthLocale(req, res, next) {
  const requested = req.query.lang;
  if (SUPPORTED_LOCALES.includes(requested)) {
    req.session.authLocale = requested;
  }
  const locale = SUPPORTED_LOCALES.includes(req.session.authLocale) ? req.session.authLocale : 'en';
  res.locals.locale = locale;
  res.locals.usingAccountLocale = true;
  res.locals.t = function (key, vars) {
    return translate(locale, key, vars);
  };
  next();
}

module.exports = { loadLocale, translate, useAccountLocale, useAuthLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE };
