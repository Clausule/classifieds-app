# Operationeel zetten — stappenplan

Los moment ná [MIGRATION.md](MIGRATION.md): de site draait dan al technisch
op de VPS, maar staat nog op `noindex, follow` (`MARKETPLACE_OPERATIONAL=false`
in `.env`). Dit stappenplan is voor het moment dat de marktplaats ook echt
publiek/operationeel wordt.

## Voorwaarden, gelden voor zowel live zetten als operationeel

Zie ook [MIGRATION.md](MIGRATION.md) — deze drie staan daar ook, want ze
gelden al zodra de site technisch live is, niet pas bij deze stap:

1. **Ingelogde omgeving op slot vóór operationeel — gebouwd en getest.** Zie
   MIGRATION.md voor details. Praktisch voor déze stap: zodra
   `MARKETPLACE_OPERATIONAL=true` gaat, valt de "nog niet live"-melding voor
   iedereen automatisch weg — geen aparte actie nodig. Trek dan wel de lijst
   (`SELECT email FROM users WHERE launch_notify_confirmed_at IS NOT NULL`)
   voor de aankondigingsmail.
2. **Fictieve advertenties vóór live — nog te doen.** Zie MIGRATION.md.
3. **Leeftijdspoort — gebouwd en getest.** Zie MIGRATION.md. Zodra de vlag op
   `true` gaat schakelt de poort automatisch mee aan voor bezoekers — geen
   aparte actie nodig. Geldt alleen voor de Node-app, niet voor de bestaande
   statische artikelpagina's.

## 1. Vóór de vlag omgaat

- Rate limiting/CAPTCHA op registratie en op het versturen van berichten
  regelen — nog niet gebouwd, moet af zijn voordat de site publiek live gaat
- Laatste content-check op listing- en stadspagina's (geen test-/dummydata
  meer zichtbaar)
- Placeholder-gegevens invullen op de statische informatiepagina's
  (`data/legalPages.js`):
  - `/over-quickie` — Bedrijfsgegevens onderaan (bedrijfsnaam, KvK, btw,
    e-mailadres)
  - `/meldprocedure` — `[e-mailadres]` voor wie liever mailt dan het
    meldformulier gebruikt

## 2. De vlag omzetten

- `MARKETPLACE_OPERATIONAL=true` zetten in `.env` en de app herstarten —
  schakelt `noindex, follow` overal uit (zie `utils/seo.js`)

## 3. Terugdraaien wat tijdelijk voor SEO is aangepast

Op 2026-10-04 is de homepage aangepast omdat hij flink gedaald was in Google na
het vervangen van de oude statische homepage. Deze punten zijn bewust tijdelijk
en horen terug zodra er echte advertenties staan:

- De `<details class="seo-details">`-toggle om het SEO-blok terugzetten
  (`views/partials/seo-content.ejs`, nu een gewone `div`) — het blok stond
  dichtgeklapt zodat de focus op de advertenties lag; dat klopt weer zodra de
  advertenties echt zijn. Let op: de eerste `h2` zit dan weer in een
  `<summary>`, en `public/css/style.css` selecteert nu op
  `.seo-details > h2:first-child`.
- `home.meta_title` en `home.meta_description` in `locales/nl.json` staan sinds
  2026-10-04 weer exact op de teksten van de oude statische homepage
  ("Informatie over sex advertenties en thuisontvangst" / "Hier vind je een
  compleet overzicht ..."), puur om de oude ranking terug te halen. Die zijn
  informatief, niet commercieel, en noemen het merk niet — zodra de marktplaats
  operationeel is horen daar weer titel en omschrijving te staan die de
  advertenties verkopen (zie de git-historie van dit bestand voor de vorige
  tekst, of `backups/2026-10-04_pre-seo/homepage-live.html`). `locales/en.json`
  is bewust ongewijzigd gebleven: de oude ranking is Nederlandstalig.
- De 302 van `/?page=N` (zonder filter) naar `/` weghalen in
  `routes/listings.js` — die hoort bij de 1-advertentie-per-stad-weergave en is
  overbodig zodra de homepage weer de volledige lijst toont. De `if` zit al
  achter `!MARKETPLACE_OPERATIONAL`, dus functioneel gaat het vanzelf goed; dit
  is alleen opruimen.
- De hero bovenaan de homepage (`h2` merkregel + `h3` slogan, `views/index.ejs`,
  `.home-hero` in `public/css/style.css`) weer naar beneden verhuizen, terug het
  SEO-blok in boven het article — daar stond hij tot 2026-10-04. Hij staat nu
  bovenaan omdat de zoekwoordregel daar zwaarder weegt; zodra er echte
  advertenties staan hoort de bovenkant van de pagina aan de advertenties.
- Niet automatisch meenemen, maar wel afwegen: `<main>` staat nu om het
  SEO-blok en niet om de advertentielijst. Strikt genomen is die lijst straks
  de hoofdcontent van de pagina.

Gaat vanzelf goed, alleen ter info: de kale homepage toont zolang de vlag
`false` is één advertentie per stad (`oneResultPerCity` in `routes/listings.js`).
Zodra de vlag op `true` staat vervalt dat vanzelf en toont de homepage weer de
volledige lijst — niets handmatig terug te draaien.

## 4. In dezelfde stap, hoort bij elkaar

- `sitemap-listings.xml` bouwen: dynamisch uit de DB, zelfde
  `SELECT DISTINCT location`-patroon als de stadspagina's
- `Sitemap:`-regel toevoegen aan de robots.txt van de bestaande (statische)
  site

De bestaande statische pagina's (`public_html/*.html`, `public_html/images/`)
en hun eigen robots.txt/sitemap.xml blijven ongewijzigd — de
`Disallow: /admin/ /account/ /dashboard/ /login /uploads/`-regels voor de
nieuwe Node-paden staan daar al in.

## 5. Optioneel, kan ook later

- Lichte `ItemList`-structured-data voor de listingkaarten op de homepage
  (alleen `url`+`name`+`position`, geen volledige `Service`-objecten) —
  heeft toch geen effect zolang de pagina `noindex` was, dus pas relevant nu
  de vlag om is
- Echte advertentiefoto toevoegen aan de `/`-entry in
  `sitemap-images.xml` (`<image:image>`) — bij de technische migratie is
  het oude `<image:image>`-blok daar juist verwijderd (verwees naar de oude
  homepage-hero, klopt niet meer met de Node-homepage), en bewust niet
  vervangen door een fictieve-listing-foto. Nu de vlag om is en er echte
  content is, kan dit erbij.

## Nog openstaand (niet blokkerend voor deze stap, maar wel voor volledige launch)

- Niche + categorieën definitief bepalen
- E-mailnotificaties (nu alleen zichtbaar in de UI)
- Echte Mollie-koppeling i.p.v. `PAYMENT_PROVIDER=mock`
