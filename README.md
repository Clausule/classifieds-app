# Classifieds App

Zelf te hosten classifieds/listings-platform met een eigen (custom) CMS. Gebouwd met
Node.js, Express, EJS en SQLite — geen build-stap nodig, dus eenvoudig op elke server
of VPS te draaien.

## Wat zit erin

- **Publieke site**: listings bladeren, zoeken en filteren (categorie, prijs, locatie), listing-detailpagina's.
- **Adverteerders**: account aanmaken, listings plaatsen/bewerken/verwijderen (met foto's), eigen dashboard.
- **Admin-CMS** (`/admin`): listings goedkeuren/afwijzen, categorieën beheren, gebruikers beheren, listings als **premium** markeren.
- **Support inbox**: eenvoudig berichtenverkeer tussen adverteerders en de beheerder (geen chat tussen gebruikers onderling — precies zoals gevraagd).
- **Premium listings**: datamodel en admin-toggle staan klaar (`is_premium`, `premium_until`). Er zit bewust nog **geen betaalprovider** aangesloten — dat bouwen we als laatste stap, zoals je aangaf. Nu kan een admin een listing handmatig als premium markeren; Stripe (of Mollie, populair in NL) kan later worden toegevoegd in `routes/listings.js` / `routes/admin.js`.

## Snel starten

```bash
cd classifieds-app
npm install
cp .env.example .env          # pas SESSION_SECRET en ADMIN_* aan
npm run seed                  # maakt admin-account + startcategorieën
npm run dev                   # start op http://localhost:3000
```

Log in op `/login` met het admin-account dat `npm run seed` aanmaakt (zie terminal-output
voor het gegenereerde wachtwoord, of stel het zelf in via `ADMIN_PASSWORD` in `.env`).

## Structuur

```
config/       database- en upload-configuratie
db/           schema.sql, seed script, SQLite databasebestand (aangemaakt bij eerste start)
middleware/   auth (ingelogde gebruiker laden, routes beveiligen)
routes/       auth, listings (publiek + adverteerder), dashboard, admin
views/        EJS templates + partials, views/admin voor het CMS
public/       CSS en geüploade listing-foto's
```

## Niche instellen

Je gaf aan dat de niche nog te bepalen is. De categorieën zijn expres generiek
(Algemeen, Elektronica, Auto & Vervoer, etc.) — pas ze aan via **Admin → Categorieën**
zodra je de niche kiest. De rest van het platform (velden, formulieren, zoekfilters)
is niche-onafhankelijk opgezet.

## Nog te doen / volgende stappen

1. **Betaalprovider koppelen** voor premium listings (Stripe/Mollie) — schema staat klaar.
2. **E-mailnotificaties** (bv. bij goedkeuring van een listing of nieuw support-bericht) — nu alleen zichtbaar in de UI.
3. Verplaatsen naar MySQL/Postgres als je meer schaal nodig hebt — het schema in `db/schema.sql` gebruikt bewust alleen portable SQL.
4. Rate limiting / CAPTCHA op registratie en berichten als het platform publiek live gaat.

## Belangrijk

Dit project is hier geschreven zonder actieve internetverbinding, dus de
dependencies zijn **niet** automatisch getest met `npm install` — de code is met
zorg geschreven en op syntax gecontroleerd, maar test lokaal even goed door na
`npm install`.
