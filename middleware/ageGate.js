const { MARKETPLACE_OPERATIONAL } = require('../utils/seo');
const legalPages = require('../data/legalPages');

// Bekende crawler-/preview-/AI-bots mogen door zonder klik — die kunnen niet
// klikken en ook wettelijk geen leeftijd bevestigen, en anders kan Google (of
// een gedeelde-link-preview) de site nooit meer crawlen. Dat zou al het
// SEO-werk (noindex-vlag, structured data, hreflang) zinloos maken. Naast de
// generieke "bot/crawl/spider"-namen ook expliciet de LLM-fetchers die geen
// van die woorden in hun user-agent voeren, met name de "-User"-varianten
// die een AI-assistent gebruikt als die live een pagina ophaalt namens een
// gebruiker (bv. ChatGPT-User, Claude-User, Perplexity-User). Ook expliciet
// "inspectiontool" — dat is Google-InspectionTool, de user-agent achter
// Search Console's "URL inspectie/live test", bevat zelf geen "bot" en zou
// anders de poort te zien krijgen in plaats van de echte pagina.
const BOT_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|chatgpt|claude|perplexity|anthropic|openai|meta-external|google-extended|cohere|ccbot|diffbot|youbot|ai2bot|omgili|timpi|inspectiontool/i;

// Server-naar-server calls (betaalprovider-webhooks) hebben nooit een sessie
// en mogen nooit achter de poort blijven hangen. /age-gate/confirm is de
// bevestigknop van de poort zelf — die route zou zichzelf blokkeren als hij
// niet is uitgezonderd (hij draait immers vóórdat de sessie ageConfirmed=true
// heeft staan).
// Beleids-/informatiepagina's (privacybeleid, verificatiebeleid, enz.) bevatten
// zelf geen 18+-content — geen reden om die achter de poort te houden, en
// toezichthouders/bezoekers moeten er altijd zonder klik bij kunnen.
const LEGAL_PAGE_PATHS = legalPages.map((page) => `/${page.slug}`);

const EXEMPT_PATHS = [
  '/webhooks/whatsapp',
  '/age-gate/confirm',
  /^\/credits-checkout\/\d+\/webhook$/,
  ...LEGAL_PAGE_PATHS,
];

function isExempt(path) {
  return EXEMPT_PATHS.some((p) => (typeof p === 'string' ? p === path : p.test(path)));
}

// De browser haalt naast de eigenlijke pagina ook los favicon.ico op (en soms
// apple-touch-icon.png e.d.) — dat request loopt óók door deze middleware
// (bestaat niet in public/, dus geen match in express.static) en overschreef
// zonder deze check ageGateReturnTo mét zichzelf. Bevestigen stuurde je dan
// naar /favicon.ico, een niet-bestaande pagina. Sec-Fetch-Dest: document
// onderscheidt een echte paginanavigatie van zo'n side-effect-request; sturen
// alle moderne browsers mee. Ontbreekt de header (oude browser, curl e.d.),
// dan gaan we uit van een navigatie — dat is de veiligere kant.
function isNavigationRequest(req) {
  const dest = req.get('sec-fetch-dest');
  return !dest || dest === 'document';
}

// Zolang de marktplaats nog niet operationeel is, staan er alleen fictieve
// placeholder-advertenties (zie GO-LIVE.md) — geen echte 18+-content, dus
// geen poort nodig. Zodra de vlag om gaat, schakelt deze gate automatisch
// mee aan, net als de noindex-vlag en de "nog niet live"-dashboardgate.
function requireAgeConfirmed(req, res, next) {
  if (!MARKETPLACE_OPERATIONAL) return next();
  if (isExempt(req.path) || BOT_USER_AGENT.test(req.get('user-agent') || '')) return next();
  if (req.session && req.session.ageConfirmed) return next();

  if (isNavigationRequest(req)) {
    req.session.ageGateReturnTo = req.originalUrl;
  }
  res.render('age-gate', { title: 'age_gate.title' });
}

module.exports = { requireAgeConfirmed };
