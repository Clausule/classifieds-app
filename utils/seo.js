// Canonical/OG/JSON-LD/hreflang-URL's moeten altijd het echte productie-domein
// gebruiken, ook tijdens lokaal draaien — vandaar een vaste env-waarde i.p.v.
// req.headers.host.
const SITE_URL = (process.env.SITE_URL || 'https://quickie.nu').replace(/\/$/, '');

// Nog geen eigen logo/banner-asset aangeleverd — placeholder-pad, wordt later
// vervangen zodra dat bestand er is.
const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og-default.jpg`;

// Marktplaats staat live vóór operationeel — zolang deze op false staat,
// zenden listing- en stadspagina's noindex,follow uit (zie CLAUDE.md).
const MARKETPLACE_OPERATIONAL = process.env.MARKETPLACE_OPERATIONAL === 'true';

function absoluteUrl(path) {
  return `${SITE_URL}${path}`;
}

// Relatief pad met /en-prefix zodra de huidige request Engels is, zodat
// interne links (kaarten, breadcrumb) een Engelse bezoeker niet stilletjes
// terugsturen naar de Nederlandse variant van diezelfde pagina.
function withLocale(res, path) {
  return res.locals.locale === 'en' ? `/en${path}` : path;
}

// Voor pagina-canonicals/og:url specifiek: Engelse pagina's canonicaliseren
// naar hun eigen /en/...-URL, niet terug naar Nederlands (res.locals.locale
// komt uit de locale-prefix-middleware in middleware/i18n.js).
function canonicalUrl(res, path) {
  return absoluteUrl(withLocale(res, path));
}

module.exports = { SITE_URL, DEFAULT_OG_IMAGE, MARKETPLACE_OPERATIONAL, absoluteUrl, canonicalUrl, withLocale };
