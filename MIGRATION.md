# VPS-migratie — stappenplan

Hosting is Vimexx. Bestaande hosting kan niet geüpgraded worden naar een VPS
(bevestigd door support: "2 compleet verschillende producten") — dit is dus
een verse VPS-opzet, geen in-place upgrade.

Dit is de **technische** migratie: de app draaiend en bereikbaar krijgen op
de nieuwe VPS. Dit betekent nog niet dat de site publiek/operationeel is —
zolang `MARKETPLACE_OPERATIONAL=false` staat, blijft alles `noindex, follow`.
Zie [GO-LIVE.md](GO-LIVE.md) voor die volgende, losse stap.

## Voorwaarden, gelden voor zowel live zetten als operationeel

Drie taken die niet in één specifieke fase passen — ze moeten al staan zodra
de site technisch live is (bezoekers/zoekers zien 'm dan als "live", ook al
is dat voor ons nog niet "operationeel"), en blijven ook relevant tot de
vlag omgaat:

1. **Ingelogde omgeving op slot vóór operationeel — gebouwd en getest.**
   Registreren/inloggen werkt gewoon, maar zolang `MARKETPLACE_OPERATIONAL=false`
   staat, ziet elke niet-admin gebruiker in plaats van hun dashboard een
   "We zijn nog niet live"-melding met een knop om te bevestigen dat ze een
   e-mail willen zodra het zover is (`launch_notify_confirmed_at` op
   `users`). Admins zijn uitgezonderd — beheer kan deze gebruikers gewoon
   inzien/beheren via Admin → Gebruikers. Zodra de vlag op `true` gaat, is
   dit meteen de lijst voor de aankondigingsmail:
   `SELECT email FROM users WHERE launch_notify_confirmed_at IS NOT NULL`.
   Lokaal staat de vlag weer op `true` gezet (na bouwen/testen) zodat de
   ontwikkelomgeving toegang houdt tot de gebruikersomgeving — pas 'm pas
   naar `false` op de VPS zelf, bij het echte live zetten.
2. **Fictieve advertenties vóór live — gebouwd.** 30 stuks staan al klaar
   (zie stap 3, "Data overzetten"), duidelijk gemarkeerd als fictief
   (DEMO-badge), zodat bezoekers alvast een indruk krijgen vóór er echte
   advertenties zijn.
3. **Leeftijdspoort — gebouwd en getest, hangt aan dezelfde vlag.** Zolang
   `MARKETPLACE_OPERATIONAL=false` staat, slaat `requireAgeConfirmed`
   (`middleware/ageGate.js`) zichzelf over — logisch, want zolang er alleen
   fictieve placeholder-advertenties staan is er nog geen echte 18+-content.
   Zodra de vlag op `true` gaat, schakelt de poort vanzelf mee aan, geen
   aparte actie nodig. Geldt alleen voor de Node-app zelf — de bestaande
   statische artikelpagina's (`public_html/*.html`) lopen niet door deze
   Express-routes en zijn hier sowieso nooit door geraakt.

## 1. VPS bestellen & basis inrichten

- VPS Entry S bestellen bij Vimexx — configuratie: **Ubuntu** (nieuwste
  LTS-versie), 1 core, 2 GB RAM, 50 GB schijfruimte, onbeperkt dataverkeer
  (Budget), unmanaged (geen paneel). ~€8,46/maand incl. btw. Ubuntu omdat
  het al standaard geselecteerd staat bij Vimexx én de meeste/beste
  documentatie heeft voor dit soort Node.js-VPS-installaties
  (apt-gebaseerd) — Debian is een prima alternatief, CentOS 9/AlmaLinux
  (yum/dnf, RHEL-familie) heeft geen voordeel voor deze stack.
- SSH-key aanmaken op je Mac als je die nog niet hebt (er staat nu nog geen
  `.pub`-bestand in `~/.ssh`) — `ssh-keygen -t ed25519`, en de public key
  toevoegen bij het bestellen/instellen van de VPS bij Vimexx
- SSH-toegang testen, systeem updaten (`apt update && apt upgrade`)
- Node.js installeren via NodeSource's officiële apt-repo (huidige LTS) —
  niet Ubuntu's eigen, vaak verouderde apt-versie. `package.json` vereist
  alleen `node >=18.0.0`, dus elke recente LTS is prima.
- `build-essential` en `python3` installeren — vangnet voor `node-gyp
  rebuild` van `better-sqlite3`/`sqlite3` als er geen prebuilt binary voor
  dit platform beschikbaar is (dezelfde install-scripts die lokaal ook de
  `allow-scripts`-waarschuwing gaven bij `npm install`)
- Evt. een niet-root deploy-user aanmaken

## 2. App deployen

- Project naar de VPS syncen met **rsync over SSH** (geen git — bewust
  gekozen voor eenvoud), bv.
  ```
  rsync -avz \
    --exclude node_modules --exclude .env \
    --exclude 'db/*.db' --exclude 'db/*.db-wal' --exclude 'db/*.db-shm' \
    --exclude sessions.db --exclude 'sessions.db-wal' --exclude 'sessions.db-shm' \
    --exclude public/uploads --exclude private-uploads \
    ./ vps:/pad/naar/app
  ```
  **Quote elk `--exclude`-patroon met een `*` erin** (`'db/*.db'`, niet
  `db/*.db`) — anders expandeert de lokale shell het glob vóórdat rsync het
  ziet, en werkt de exclude alleen nog "toevallig" als er precies één lokaal
  bestand matcht. Sloeg eerder mis: `db/*.db` matchte lokaal zowel
  `db/classifieds.db` als `db/sessions.db`, waardoor `db/sessions.db` als los
  (niet-geëxclude) positioneel argument in het rsync-commando belandde en
  gewoon meesynchte.
  **WAL/SHM en de live sessions.db expliciet uitsluiten**: `db/*.db` dekt
  alleen het hoofdbestand `classifieds.db`, niet de WAL-mode-bijlagen
  (`.db-wal`/`.db-shm`) — die bevatten net-geschreven, nog niet
  gecheckpointte transacties terwijl de VPS-app al draait. Ze overschrijven
  met lokale dev-versies terwijl het proces nog open staat riskeert
  dataverlies op productie. `sessions.db` staat op app-root
  (`server.js`: `dir: path.join(__dirname, 'db')` in een oudere versie kon
  dit ook `db/sessions.db` zijn — controleer bij twijfel met
  `pm2 describe quickie` welk pad de draaiende app daadwerkelijk gebruikt)
  en moet om dezelfde reden met rust gelaten worden.
  Dezelfde uitsluitingen gelden bij élke volgende deploy: code syncen, data
  en geheimen op de server met rust laten.
- `npm install --production` op de VPS
- `.env` **los, handmatig** aanmaken op de VPS — nooit kopiëren vanaf lokaal
  of vanuit `.env.example` (dat overschrijft juist de echte waarden, zoals
  eerder per ongeluk lokaal is gebeurd). Inclusief:
  - `PAYMENT_PROVIDER` (mock of mollie + evt. echte Mollie API-key)
  - `IMAGE_CONVERT_WEBP=true` zetten (staat nu uit, hoort bij migratie)
  - `MARKETPLACE_OPERATIONAL` — blijft `false` tot je echt live gaat (zie GO-LIVE.md)
  - Eigen `GOOGLE_MAPS_API_KEY` / `GEMINI_API_KEY` / etc. — niet dezelfde
    lokale testkeys hergebruiken voor productie

## 3. Data overzetten

Beslissing: schone start, geen testaccounts mee. De lokale ontwikkel-database
staat vol test-troep (testme@gmail.com, stacy@gmail.com, en nog 6 andere
test-achtige accounts) naast de 30 fictieve advertenties die wél bedoeld zijn
om te blijven staan als pre-launch-content. Die twee dingen zitten in
dezelfde `db/classifieds.db` door elkaar — niet zomaar 1-op-1 kopiëren dus.

> **Let op — admin-account is al aangemaakt, buiten de volgorde om.** Tijdens
> de boot-test aan het eind van stap 2 stond er nog geen echte data op de VPS,
> dus is toen meteen `admin@quickie.nu` aangemaakt (op verzoek) via
> `ADMIN_EMAIL='admin@quickie.nu' ADMIN_PASSWORD='...' node db/seed.js`
> rechtstreeks op de VPS — wachtwoord staat in de password manager van de
> gebruiker, bewust niet hier of ergens anders in de repo. Dit stond op de
> **tijdelijke, lege testdatabase** die tijdens de boot-test is ontstaan.
> Zodra hieronder de verse db (met de 30 fictieve advertenties) wordt
> overgezet, overschrijft dat `db/classifieds.db` en is dit account weg —
> **run daarna dezelfde `node db/seed.js`-regel nog een keer op de VPS** om
> `admin@quickie.nu` opnieuw aan te maken op de nieuwe db (`seed.js` slaat
> zichzelf vanzelf over als er al een admin bestaat, dus dit is veilig te
> herhalen).

- **Niet** `db/classifieds.db` direct overzetten.
- Lokaal, los van je huidige ontwikkel-db: een verse/lege db laten aanmaken
  (schema draait vanzelf via `config/database.js`), en daar éénmalig
  `node db/seed-fictional-user.js` + `node db/seed-fictional-listings.js`
  tegenaan draaien — dat zet het systeemaccount + de 30 fictieve
  advertenties neer, inclusief de bijbehorende foto's in `public/uploads/`.
  - Let op: `seed-fictional-listings.js` kopieert brondata vanaf een lokaal
    pad búiten de repo (`~/Desktop/Desktop/test adv/draw things/Finished
    batch v2/...`) — dat pad bestaat niet op de VPS, dus dit script moet
    lokaal draaien, niet op de server.
- Die verse db + de bijbehorende `public/uploads/` en `private-uploads/`
  (placeholder-id-documenten van het systeemaccount) naar de VPS syncen.
- Daarna op de VPS `ADMIN_EMAIL='admin@quickie.nu' ADMIN_PASSWORD='...' node
  db/seed.js` opnieuw draaien om het admin-account (zie kader hierboven)
  terug te zetten op de nieuwe db.
- App eenmaal booten zodat `config/database.js` het schema opnieuw uitvoert
  (`CREATE TABLE IF NOT EXISTS`)

## 4. Process manager + reverse proxy

- PM2 instellen zodat de Node-app blijft draaien en herstart na een crash.
  Voor het overleven van een server-reboot zijn twee extra commando's nodig:
  `pm2 startup` (zet een systemd-service klaar) en `pm2 save` (onthoudt welk
  proces opnieuw gestart moet worden) — zonder die twee start de app niet
  vanzelf op na een reboot.
- Nginx als reverse proxy, met eigen server block voor quickie.nu. Twee
  dingen komen hier samen op één domein:
  - **De Node-app wordt eigenaar van "/"** — de marktplaats-homepage neemt
    bewust de Google-ranking over van de huidige statische homepage (al
    besproken/besloten). De statische `index.html` gaat dus niet mee, de
    rest van de statische site wel.
  - **De bestaande statische site** (artikelpagina's + de 5 stadspagina's
    die al live staan, incl. `sex-advertenties-<stad>.html` waar de nieuwe
    homepage al naar linkt) blijft bereikbaar op zijn eigen bestandsnamen,
    door nginx direct als statische bestanden geserveerd. Haal hiervoor de
    **volledige huidige inhoud op van de bestaande Vimexx-hosting** (via
    FTP/bestandsbeheer) — de lokale kopie op
    `~/Desktop/Desktop/Quickie/public_html/` bleek incompleet (miste
    precies deze 5 stadspagina's).
  - Nginx-config: statische bestanden eerst proberen te serveren, val terug
    op een proxy naar de Node-poort voor de rest (of expliciet de
    Node-paden zoals `/listings`, `/login`, `/dashboard`, `/admin`,
    `/account`, `/uploads` naar Node routeren en de rest statisch — beide
    patronen werken, verder uit te werken bij het schrijven van de config).
  - HTTPS + non-www forceren in nginx — vervangt de huidige
    `.htaccess`-regels (`RewriteCond %{HTTPS} !=on` + www-strip) 1-op-1.
    Nginx leest `.htaccess` niet (dat is Apache-only), dus dit bestand wordt
    niet meegekopieerd/gebruikt, alleen de 2 regels erin worden vertaald
    naar nginx-syntax. Lokale kopie is geverifieerd identiek aan de
    aangeleverde versie, dus geen discrepantie om over te twijfelen.
  - Geen padconflicten tussen statische site en Node-app: statische
    afbeeldingen (`public_html/images/`, incl. de `steden/<stad>/`-submappen)
    zijn los van de Node-app zijn `public/uploads/`; statische `style.css`
    zit op `/style.css` tegenover de Node-app zijn `/css/style.css`. Beide
    dus gewoon naast elkaar serveerbaar, geen hernoemen nodig.
  - **Sitemaps** (`sitemap.xml`, `sitemap-images.xml`) hoeven voor déze
    (technische) fase grotendeels niet aangepast te worden — alle 12 URL's
    erin zijn statische pagina's, altijd indexeerbaar, ongeacht
    `MARKETPLACE_OPERATIONAL`. Die vlag beïnvloedt alleen de Node-app zijn
    eigen `/listings/*`-pagina's, die sowieso niet in deze sitemaps staan.
    Eén uitzondering: de `<image:image>` in de `/`-entry van
    `sitemap-images.xml` (nu `images/3637733239.png`, de oude
    homepage-hero) klopt niet meer — die afbeelding staat nergens meer op de
    nieuwe Node-homepage. Dat `<image:image>`-blok bij de `/`-entry
    verwijderen (niet vervangen door een fictieve-listing-foto — zelfde
    reden als de uitgestelde `ItemList`-structured-data in GO-LIVE.md: geen
    demo-content als echt laten indexeren zolang niet operationeel). Voor de
    rest gewoon meekopiëren zoals ze zijn. Zodra later (GO-LIVE.md) de vlag
    omgaat komt er een aparte, nieuwe `sitemap-listings.xml` bij met echte
    advertentiefoto's — deze twee blijven staan voor de legacy-pagina's.
  - **robots.txt**: de lokaal al aangepaste versie meenemen (heeft de
    Node-paden-`Disallow`-regels al), niet een eventueel andere versie
    vanaf de server.
  - **Favicon/head-code** consistent maken met de Node-app: exact dit
    blok in de `<head>` van elke statische pagina zetten (dezelfde
    bestanden als de Node-app gebruikt, root-relative dus werken ze op elke
    pagina hetzelfde):
    ```html
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">
    <meta name="theme-color" content="#0097be">
    ```
- SSL via certbot/Let's Encrypt (HTTPS verplicht, zeker gezien de aard van de
  site) — certbot's nginx-plugin regelt vernieuwing automatisch. **Gedaan**,
  zie stap 6 hieronder (moest wachten tot de DNS-cutover, want Let's
  Encrypt's http-01-validatie heeft nodig dat het domein al naar dit IP
  wijst).

## 5. Back-ups instellen

Vóór de DNS-cutover al werkend hebben, niet erna.

**Status: gedaan (2026-07-28).** `/root/backup.sh` op de VPS maakt een
gedateerde snapshot in `/root/backups/`, versleutelt db + `private-uploads/`
met `gpg --symmetric` (wachtwoord in `/root/.backup-password`, root-only),
ruimt snapshots ouder dan 14 dagen op, en synced (`rclone sync`) naar de
`gdrive:quickie-backups`-remote. Cron: dagelijks 03:00
(`0 3 * * * /root/backup.sh >> /var/log/quickie-backup-cron.log 2>&1`).
Eén keer handmatig getest: snapshot + Drive-sync + decryptie kloppen.
Back-up-wachtwoord is gegenereerd (niet hergebruikt van het admin-account) en
moet nog van het tijdelijke lokale bestand naar de password manager verhuizen.
**Aandachtspunt**: rclone gebruikt nu zijn gedeelde Google-`client_id`, die in
2026 wordt uitgefaseerd — op termijn een eigen `client_id` aanmaken via
Google Cloud Console (https://rclone.org/drive/#making-your-own-client-id).

- Nachtelijke cron-job op de VPS die een volledige kopie maakt van
  `db/classifieds.db`, `db/sessions.db`, `public/uploads/` en
  `private-uploads/` (id-documenten/selfies) naar een gedateerde map, en
  kopieën ouder dan 14 dagen zelf opruimt.
- `private-uploads/` en de database (bevat ook telefoonnummers/e-mails)
  worden vóór het wegschrijven versleuteld met een wachtwoord (bv.
  `gpg --symmetric` of `openssl enc`) — dat wachtwoord bewaar je apart in een
  password manager, nooit in dezelfde back-up. Listing-foto's (niet
  privacygevoelig) hoeven niet versleuteld.
- Aansluitend `rclone sync` (niet `copy`) van die lokale back-upmap naar een
  Google Drive-account — `sync` verwijdert op Google Drive automatisch ook wat
  lokaal net is opgeruimd, dus dezelfde 14-dagen-vensters aan beide kanten
  zonder aparte logica. Google Drive's eigen prullenbak bewaart verwijderde
  bestanden zelf ook nog 30 dagen als extra vangnet.
- Verwachte omvang: nu ~15 MB per snapshot (testdata), realistisch
  ~100-150 MB per snapshot bij een bescheiden hoeveelheid echte
  advertenties — 14 volledige kopieën blijft dan ruim binnen de gratis
  Google-laag (15 GB, gedeeld met Gmail/Foto's).
- Nog te doen zodra "verwijder id-document na 12 maanden" gebouwd wordt
  (zie CLAUDE.md): back-up-rotatie moet dan ook oude versleutelde kopieën
  meenemen, anders blijft er alsnog ergens een kopie bestaan.

## 6. DNS-cutover

**Status: gedaan (2026-07-28).** TTL stond al op 600s (10 min), geen aparte
verlaging nodig. Getest via tijdelijke `/etc/hosts`-override vóór de
cutover (nu weer verwijderd).

**Extra stap die niet in de oorspronkelijke planning stond**: het domein
bleek bij Vimexx "gekoppeld" aan het oude shared-hostingpakket
(WooCommerce hosting Basic, #87373) — DNS werd daardoor automatisch door
dat pakket beheerd. Eerst ontkoppeld ("Domein ontkoppelen", **zonder** de
"Ontkoppel en reset DNS"-checkbox, om de bestaande records als
uitgangspunt te behouden — geen e-mail op dit domein dus dat risico gold
toch al niet), pas daarna waren de A/AAAA-records handmatig aanpasbaar.
Voor toekomstige domeinmigraties bij Vimexx: check dit "Koppelen"-blok in
het domeinbeheer vóóraf.

- A-record (`@` én `www`) omgezet naar het nieuwe VPS-IP (`149.210.181.243`),
  AAAA-record (`@` én `www`) naar het VPS's IPv6-adres
  (`2a01:7c8:aab5:1a2:5054:ff:feeb:843c`) — de VPS bleek IPv6 te hebben, dus
  bewust niet verwijderd maar meegenomen. MX/smtp/pop/mail/ftp/sandbox-records
  en de nameservers ongemoeid gelaten (geen e-mail op dit domein, dus niet
  relevant voor deze migratie).
- Propagatie geverifieerd op meerdere resolvers (lokaal, Google 8.8.8.8,
  Cloudflare 1.1.1.1, Quad9 9.9.9.9, OpenDNS) — allemaal correct.
- **HTTPS**: certbot (nginx-plugin) geïnstalleerd en gedraaid zodra DNS
  wereldwijd klopte (`certbot --nginx -d quickie.nu -d www.quickie.nu`,
  Let's Encrypt-account op rudibeynen@hotmail.com). Certificaat geldig tot
  2026-10-26, auto-renewal door certbot's eigen scheduled task al actief.
  `http://` → `https://` en `www` → non-www redirecten allebei bevestigd
  werkend, geen mixed-content-warnings in de browserconsole.
- **Openstaand, niet blokkerend**: VPS heeft een pending kernel-update
  (huidige kernel 6.8.0-134, verwacht 6.8.0-136) die een reboot vereist —
  op een rustig moment inplannen, niet urgent.

## Vervolgdeploys (na de eerste migratie)

Nieuwe features/fixes bouw je lokaal zoals nu (Claude Code, lokale
dev-server, browser-preview testen) — daar verandert niets aan. Live zetten
is dan steeds: hetzelfde rsync-commando uit stap 2 opnieuw draaien, en op de
VPS `pm2 reload` (herstart zonder downtime). Schema-wijzigingen zijn veilig
(`CREATE TABLE IF NOT EXISTS`), maar maak vlak vóór zo'n deploy voor de
zekerheid een extra back-up-snapshot.

**Welke versie staat live?** Sinds 2026-07-29 heeft dit project lokaal git
(zie CLAUDE.md) — puur lokaal versiebeheer, de VPS zelf blijft bewust
git-vrij (rsync, geen `git pull` op de server, zie hierboven). Om toch te
weten welke commit er precies live staat: zet ná elke geslaagde rsync-deploy
lokaal de tag `deployed` op de zojuist gesyncte commit:
```
git tag -f deployed
```
(`-f` verplaatst de tag als hij al bestaat — er is maar één "huidige
live-versie"). `git diff deployed main` laat dan altijd zien wat er sinds de
laatste deploy lokaal is veranderd maar nog niet live staat; `git show
deployed` laat zien welke commit precies live staat. Dit is pure discipline
— git detecteert de rsync zelf niet, dus vergeet de tag niet te verzetten na
elke deploy.

## Klaar? → volgende stap

Zodra de VPS draait en de site technisch bereikbaar is (maar nog `noindex`),
is de technische migratie afgerond. Wanneer je de site ook echt publiek/
operationeel wilt maken, zie [GO-LIVE.md](GO-LIVE.md) — dat kan meteen
aansluitend, of pas veel later.
