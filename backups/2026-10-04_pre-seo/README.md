# Snapshot 2026-10-04 — vóór de SEO-aanpassingen aan de homepage

Vastgelegd vlak voordat we titel/H1/SEO-blok van de homepage gingen wijzigen en
demo-advertenties gingen verminderen. Git-tag: `backup-pre-seo-20261004`.

## In deze map (in git)
- `homepage-live.html` — de live gerenderde homepage zoals Google hem op dit
  moment ziet (incl. titel, meta description, H1 in de dichtgeklapte `details`).
- `demo-listings.json` — volledige export van `listings` (30, alle `active`,
  6 per stad: Amsterdam, Den Haag, Eindhoven, Rotterdam, Utrecht) en
  `listing_images` (120). Hiermee zijn verwijderde demo-advertenties terug te
  zetten; de bijbehorende bestanden staan in de uploads-tarball hieronder.

## Buiten git
Te groot/gevoelig voor de repo. Server: `/root/backups/manual_2026-10-04_pre-seo/`,
lokaal gespiegeld in `~/Desktop/quickie-backups/2026-10-04_pre-seo/`:
- `classifieds.db` — consistente kopie via `VACUUM INTO` (geen WAL-risico)
- `uploads.tar.gz` — `public/uploads` + `private-uploads`
- `app-views-locales-data.tar.gz` — `views/`, `locales/`, `data/`, `public/css`
- `quickie-static.tar.gz` — `/var/www/quickie-static` (statische SEO-site)

De broncode zelf zit in git op tag `backup-pre-seo-20261004`; de lokale
bestanden waren op dat moment byte-identiek aan de server (gecontroleerd met
`cmp` op index.ejs, seo-content.ejs, nl.json, faq.js, relatedLinks.js, style.css).

## Terugzetten
```
# code
git checkout backup-pre-seo-20261004 -- views locales data public/css
# database (app eerst stoppen)
ssh quickie-vps 'pm2 stop quickie && cp /root/backups/manual_2026-10-04_pre-seo/classifieds.db /root/app/db/classifieds.db && pm2 start quickie'
# statische site
ssh quickie-vps 'tar xzf /root/backups/manual_2026-10-04_pre-seo/quickie-static.tar.gz -C /var/www'
```
