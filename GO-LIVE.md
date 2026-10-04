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
- Niet automatisch meenemen, maar wel afwegen: `<main>` staat nu om het
  SEO-blok en niet om de advertentielijst. Strikt genomen is die lijst straks
  de hoofdcontent van de pagina.

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
