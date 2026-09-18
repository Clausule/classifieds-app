# classifieds-app — projectcontext

Zelf te hosten classifieds/listings-platform. Node.js + Express + EJS (server-rendered,
geen build-stap) + SQLite via `better-sqlite3`. Custom CMS, geen WordPress/Strapi.

## Status

Werkend MVP, lokaal getest. Niche is nog **niet bepaald** — categorieën in
`db/seed.js` zijn bewust generiek (Algemeen, Elektronica, Auto & Vervoer, etc.),
passen aan zodra de niche vaststaat.

## Architectuur

```
config/       database.js (SQLite-connectie + schema-init), upload.js (multer), payments.js
db/           schema.sql (bron van waarheid voor het datamodel), seed.js
middleware/   auth.js — loadUser (elke request), requireAuth, requireAdmin
routes/       auth, listings (publiek + adverteerder CRUD), dashboard, admin, payments
views/        EJS, views/admin/ voor het CMS, views/partials/ voor gedeelde stukken
public/       css/style.css (design tokens als CSS-variabelen), uploads/ (listing-foto's)
static-site/  kopie van de statische SEO-site (12 HTML-pagina's + images/, robots.txt,
              sitemaps) die nginx los serveert uit /var/www/quickie-static op de VPS
              — blijven permanent onderdeel van de site; vanuit de Node-app alleen
              bereikbaar via het SEO-contentblok op de homepage. Niet in public/
              zetten (duplicate content) en uitgesloten van de rsync-deploy.
```

`config/database.js` leest `db/schema.sql` en voert 'm bij **elke boot** opnieuw uit
(`CREATE TABLE IF NOT EXISTS`) — schema-wijzigingen komen dus vanzelf door bij een
herstart, geen aparte migratiestap nodig.

## Features die er zijn

- Publiek bladeren/zoeken/filteren (categorie, prijs, locatie)
- Adverteerders: account, listings plaatsen/bewerken (max 6 foto's, multi-select),
  eigen dashboard
- Admin-CMS (`/admin`): listings goedkeuren/afwijzen (met optionele reden die als
  bericht naar de adverteerder gaat), categorieën, gebruikers, premium-toggle
- Support inbox: doorlopend gesprek per gebruiker met admin (geen chat tussen
  gebruikers onderling). Admin kan zelf ook het eerste bericht sturen via
  Admin → Gebruikers → "Bericht sturen"
- Premium listings: €5,95 voor 24 uur, sortering nieuwste-eerst binnen premium,
  valt na 24u automatisch terug in de normale lijst. Betaalprovider is abstract
  gemaakt in `config/payments.js`: `PAYMENT_PROVIDER=mock` (standaard, geen account
  nodig, simuleert Mollie's testmodus-statussen) of `mollie` (echte Mollie
  Test/Live API key via `.env`, aangeroepen met plain `fetch`, geen SDK)

## Belangrijke conventies / bekende valkuilen

- **SQL string-literals altijd met enkele quotes**, nooit dubbele
  (`role = 'user'`, niet `role = "user"`). SQLite interpreteert dubbele quotes als
  kolomnaam, niet als string — leverde eerder een echte bug op
  ("no such column: user").
- **Publieke listing-URL's gebruiken de slug** (`/listings/:slug`), maar
  **beheer-routes gebruiken het numerieke id** (`/listings/:id/edit`,
  `/listings/:id/delete`, `/listings/:id/premium/checkout`). Links door elkaar
  halen (slug in een edit-link) gaf eerder een stille 404-bug.
- `is_premium` is een ruwe vlag; of een listing **nu echt premium is** wordt overal
  berekend uit `premium_until > datetime('now')` (zie `is_premium_active` in de
  queries). Gebruik nooit alleen de ruwe `is_premium`-kolom voor weergave/sortering.
- Admin-only middleware moet **gescoped** zijn aan `/admin`
  (`router.use('/admin', requireAuth, requireAdmin)`), niet ongescoped
  (`router.use(requireAuth, requireAdmin)`) — die laatste vorm blokkeerde eerder
  per ongeluk de hele site, omdat de router op app-root (`/`) gemount is.
- De listingdetailpagina moet ook zichtbaar zijn voor **admins die nog moeten
  beoordelen** (niet alleen voor de eigenaar of bij status `active`) — zie
  `isOwner`/`isAdmin`-check in `routes/listings.js`.
- De "actief"-badge op de listingkaart (`utils/activity.js`, `activityBucket`)
  wordt bepaald door `users.last_active_at` (ingelogde acties) en
  `messages.sender='user'` (WhatsApp + web-berichten). **Auto-renew
  (`credits.processAutoRenewals`) mag hier nooit aan meetellen** — dat verlengt
  premium volledig automatisch (getriggerd door bezoekers-pageviews, niet door
  de adverteerder), dus een premium listing kan best "langer geleden" of geen
  badge tonen terwijl er alleen credits worden afgeschreven. Dat is correct
  gedrag, geen bug.

## Openstaand / volgende stappen

- Niche + categorieën definitief bepalen
- Automatische verwijdering van ID-document/selfie 12 maanden na account-
  beëindiging of laatste listing-verwijdering, zoals het privacybeleid
  (`/privacybeleid`, zie `data/legalPages.js`) al belooft — nu nog puur een
  beleidstekst, geen job die dit daadwerkelijk uitvoert. Niet urgent/niet
  blokkerend voor operationeel gaan, gewoon nog te bouwen.
- E-mailnotificaties (nu alleen zichtbaar in de UI, geen mail bij nieuw bericht/goedkeuring)
- Migratie naar MySQL/Postgres bij meer schaal (schema.sql gebruikt bewust alleen
  portable SQL)
- Rate limiting/CAPTCHA op registratie en berichten voordat dit publiek live gaat
- Echte Mollie-koppeling: gratis account aanmaken, test-API-key in `.env`,
  `PAYMENT_PROVIDER=mollie` zetten — code roept dan automatisch de echte API aan
- Bij server-migratie: `IMAGE_CONVERT_WEBP=true` zetten en herstarten, verder geen
  actie nodig. Comprimeert geuploade listing-foto's en id-documenten/selfies naar
  `.webp` via `sharp` (zie `utils/imageConversion.js`). Staat nu uit omdat
  bestandsgrootte lokaal geen probleem is en alle testdata toch verwijderd wordt
  voor migratie.
- **SEO — marktplaats gaat live vóór operationeel** (grotendeels gebouwd, zie
  hieronder wat nog moet): listing- en stadsoverzichtpagina's zenden
  `noindex, follow` uit zolang `MARKETPLACE_OPERATIONAL=false` in `.env` staat
  (zelfde patroon als `IMAGE_CONVERT_WEBP`, zie `utils/seo.js`) — bewust
  `noindex, follow` i.p.v. een robots.txt-`Disallow`, zodat Google al blijft
  crawlen en de omzetting snel oppikt zodra de vlag op `true` gaat. **Nog te
  doen zodra de vlag op `true` gaat** (in dezelfde stap, hoort bij elkaar):
  `sitemap-listings.xml` bouwen (dynamisch, uit de DB, zelfde
  `SELECT DISTINCT location`-patroon als de stadspagina's) en als extra
  `Sitemap:`-regel toevoegen aan het robots.txt van de bestaande site. De
  bestaande statische pagina's/afbeeldingen (`public_html/*.html`,
  `public_html/images/`) en hun eigen `robots.txt` + `sitemap.xml` (lokale
  kopie: `static-site/` in dit project, oudere kopie in
  `~/Desktop/Desktop/Quickie/public_html/`) blijven ongewijzigd — daar
  is `Disallow: /admin/ /account/ /dashboard/ /login /uploads/` al aan
  toegevoegd voor de nieuwe Node-only paden.
- **Advertisers: frontend + legal-pagina's volgens accounttaal (spec vastgelegd
  2026-07-29, nog te bouwen)**: het huidige systeem heeft `frontendLocale`/
  `tFrontend` (altijd nl/en, URL-gedreven, los van account) en `accountLocale`/
  `tAccount` (altijd de volledige accountvoorkeur, nu alleen gebruikt voor de
  ingelogde-nav) — zie `middleware/i18n.js`. Besloten vervolg:
  - Voor **ingelogde gebruikers** volgt de hele frontend (homepage, notice bar,
    footer, footer/legal-pagina's) voortaan de accounttaal-mapping (nl → nl,
    elke andere accounttaal → en), **zonder** handmatige nl/en-taalwisselaar —
    die verdwijnt zodra je bent ingelogd (blijft ongewijzigd bestaan voor
    anonieme bezoekers).
  - Ingelogde gebruiker op een `/en/...`-URL die niet bij zijn accounttaal past
    (oude link/bookmark)? **302-redirecten** (geen 301 — sessie-afhankelijk,
    geen permanente URL-mapping) naar de juiste prefix volgens de mapping.
    Geen SEO-impact: dit is volledig gescoped op `req.user`, crawlers hebben
    nooit een sessie en zien dus altijd de pure URL-gedreven versie.
  - De bestaande `frontend_lang`-cookie wordt dan geen zelfstandige bron meer
    maar een sync-artefact: bij elke login expliciet bijgewerkt naar de
    accountmapping, zodat er na uitloggen geen afwijkende "onthouden" waarde
    kan bestaan die niet bij de laatst getoonde taal hoort (dit was eerder
    verworpen wegens precies dit soort afwijking — opgelost doordat er met de
    taalwisselaar weg ook geen concurrerende handmatige keuze meer is).
  - Advertisers hebben dit alleen nodig voor de **legal-pagina's**, niet voor
    marketingtekst/categorieën van de rest van de site. De content-kant
    (`locales/es/pt/ru.json` missen nu nog ~130 publieke/frontend-keys, en de
    legal-teksten moeten sowieso zorgvuldig/juridisch vertaald worden, niet
    zomaar machinaal) is apart werk, los van deze architectuurwijziging.
- **Optioneel, nog niet gebouwd**: lichte `ItemList`-structured-data (alleen
  `url`+`name`+`position` per zichtbare advertentie, geen volledige
  gedupliceerde `Service`-objecten) voor de listingkaarten op de homepage
  (`views/index.ejs`/`views/partials/header.ejs`). Bewust geen actie nu — heeft
  toch geen effect zolang `MARKETPLACE_OPERATIONAL=false` (structured data op
  een noindex-pagina wordt niet gebruikt), dus pas oppakken als het gewenst is
  rond het moment dat de vlag omgaat.

## Werkstijl

Beknopt en to-the-point antwoorden, geen overbodige uitleg. Direct de fix geven,
niet eerst een lange analyse. Bij twijfel over een aanname: kort benoemen en
doorgaan, niet blokkeren op een vraag tenzij het echt nodig is.
