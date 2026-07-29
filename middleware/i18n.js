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

  // frontendLocale/tFrontend zijn een losse, nooit-overschreven verwijzing
  // naar deze nl/en-frontendtaal — res.locals.locale/t zelf worden verderop
  // (useAccountLocale, de eigen-listingpagina) overschreven met de 5-talige
  // accountvoorkeur voor de páginainhoud, maar header.ejs/footer.ejs (notice
  // bar, nav, footer) horen altijd deze frontendtaal te tonen, ook op
  // pagina's binnen de ingelogde omgeving.
  res.locals.frontendLocale = locale;
  res.locals.tFrontend = function (key, vars) {
    return translate(locale, key, vars);
  };

  // Onthoudt alleen de laatst-actieve frontend-taal (nl/en) voor een volgend
  // bezoek — bewust geen redirect die hierop leest: Google raadt auto-redirect
  // op cookie/taalvoorkeur af bij een hreflang-opzet, dat kan het crawlen van
  // de andere taalvariant verstoren. De cookie is dus puur "onthouden", geen
  // sturing van welke pagina getoond wordt.
  res.cookie('frontend_lang', locale, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  next();
}

// Voor de ingelogde-gebruikersomgeving (dashboard, account, credits, eigen
// listing plaatsen/bewerken): taal komt van de opgeslagen accountvoorkeur
// (users.preferred_language), niet van de /en-URL-prefix. Wordt per router/
// route ná loadUser gemount — alleen op routes die we als "gebruikers-
// omgeving" behandelen, dus NOT globaal, anders zouden publieke pagina's die
// een ingelogde gebruiker toevallig bezoekt ook meeveranderen (die moeten
// juist bezoeker-NL/EN blijven). Overschrijft alleen res.locals.locale/t (de
// páginainhoud van déze specifieke route) — res.locals.frontendLocale/
// tFrontend (notice bar/footer) en res.locals.accountLocale/tAccount (de
// ingelogde-nav in header.ejs) komen los van hier vandaan (zie loadAccountLocale
// hieronder) en blijven dus overal consistent, ook buiten deze routes.
function useAccountLocale(req, res, next) {
  if (req.user) {
    const locale = SUPPORTED_LOCALES.includes(req.user.preferred_language) ? req.user.preferred_language : DEFAULT_LOCALE;
    res.locals.locale = locale;
    res.locals.t = function (key, vars) {
      return translate(locale, key, vars);
    };
  }
  next();
}

// De ingelogde-navigatiebalk (header.ejs) is zichtbaar op élke pagina zolang
// je bent ingelogd — ook op frontend-pagina's (home, footer/legal-pagina's,
// eigen-listingpagina) die zelf hun eigen t()/locale voor de páginainhoud
// gebruiken (frontend-nl/en of de vereenvoudigde nl/en-mapping). De nav zelf
// hoort daar los van te staan en altijd de volledige (5-talige)
// accountvoorkeur te tonen, dus dit draait globaal, ná loadUser, niet
// gescoped tot specifieke routes.
function loadAccountLocale(req, res, next) {
  if (req.user) {
    const locale = SUPPORTED_LOCALES.includes(req.user.preferred_language) ? req.user.preferred_language : DEFAULT_LOCALE;
    res.locals.accountLocale = locale;
    res.locals.tAccount = function (key, vars) {
      return translate(locale, key, vars);
    };
  }
  next();
}

// Registreren: het formulier zelf (labels/hints/knop/foutmeldingen) kan in
// alle 5 talen, los van de frontend-chrome (header/footer/notice bar) die
// gewoon de actieve nl/en-frontendtaal blijft tonen — geen aparte URL/redirect
// hiervoor, alleen het formulier vertaalt mee. ?formlang=xx (dropdown-
// wijziging, ín het formulierblok) wordt onthouden in de sessie zodat een
// volgend bezoek aan /register dezelfde formuliertaal teruggeeft. Standaard
// volgt de formuliertaal de actieve frontendtaal (nl of en).
function useFormLocale(req, res, next) {
  const requested = req.query.formlang;
  if (SUPPORTED_LOCALES.includes(requested)) {
    req.session.registerFormLocale = requested;
  }
  const formLocale = SUPPORTED_LOCALES.includes(req.session.registerFormLocale)
    ? req.session.registerFormLocale
    : res.locals.locale;
  res.locals.formLocale = formLocale;
  res.locals.tForm = function (key, vars) {
    return translate(formLocale, key, vars);
  };
  next();
}

module.exports = { loadLocale, translate, useAccountLocale, loadAccountLocale, useFormLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE };
