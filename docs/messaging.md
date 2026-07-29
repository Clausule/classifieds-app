# Automatische sms-, e-mail- en WhatsApp-berichten

Overzicht van alle berichten die de app zelf verstuurt via `config/messaging.js`
(sms/WhatsApp — `MESSAGING_PROVIDER=mock` logt ze naar de server-console i.p.v.
echt te versturen; `MESSAGING_PROVIDER=twilio` gaat via een echt Twilio-account)
en `config/email.js` (e-mail — `EMAIL_PROVIDER=mock` logt naar de console,
`EMAIL_PROVIDER=brevo` gaat via een echt Brevo-account). Vrije tekst die een
beheerder zelf typt (support-antwoorden) staat niet in deze lijst — dat zijn geen
automatische berichten.

## Inzien in beheer

Elk bericht hieronder is terug te vinden per gebruiker in Admin → Gebruikers →
"Bericht sturen" (of Admin → Support inbox → gebruiker), op
`/admin/messages/:userId`. Die pagina toont één chronologische tijdlijn van
alles wat naar die gebruiker is gestuurd, met tabbladen om op kanaal te
filteren (Alle / Inbox / WhatsApp / Sms / E-mail).

- **Inbox- en WhatsApp-berichten** (het eigenlijke support-gesprek, incl. de
  STOP/VERLENG-botantwoorden hierboven) staan in de `messages`-tabel.
- **Sms en e-mail** (inlogcodes, verificatiecodes, e-mailbevestiging,
  kruis-kanaal-mislukt-meldingen) staan in de aparte `notification_log`-tabel
  — bewust gescheiden van `messages`, zodat deze codes niet in de eigen
  support-inbox van de gebruiker zelf verschijnen. Alleen zichtbaar voor
  beheer.
- Beide bronnen worden samengevoegd tot dezelfde tijdlijn in
  `routes/admin.js` (`GET /admin/messages/:userId`) en
  [views/admin/message-thread.ejs](../views/admin/message-thread.ejs).

## Taal

Elk bericht hieronder wordt verstuurd in de `preferred_language` van de
**ontvanger** (`users.preferred_language` — NL of EN, instelbaar via
Instellingen, bij registratie standaard de site-taal op dat moment). Niet de
taal van wie de send toevallig triggert (een admin-actie of webhook heeft geen
"bezoekerstaal"). De daadwerkelijke teksten staan onder de `messages.*`-sleutels
in [locales/nl.json](../locales/nl.json) / [locales/en.json](../locales/en.json)
— de Nederlandse tekst hieronder in de tabellen is ter referentie, de bron van
waarheid is de locale-file. Zie ook `translate()` in
[middleware/i18n.js](../middleware/i18n.js).

## Telefoonverificatie (sms)

| Trigger | Kanaal | Bericht (nl) | Locale-sleutel | Bron |
|---|---|---|---|---|
| Gebruiker klikt "Verificatiecode versturen via sms" op `/account/verify` of `/account/settings` | sms | `Je verificatiecode: {code} (10 minuten geldig)` | `messages.phone_verification_code` | [routes/account.js](../routes/account.js) — `POST /account/verify/phone/send` |

- Code is 6 cijfers, 10 minuten geldig, éénmalig te gebruiken.
- Bij een mislukte verzending (provider-fout) wordt de code direct weer gewist en
  ziet de gebruiker een foutmelding i.p.v. "code verstuurd" — geen stille aanname
  dat de sms is aangekomen.
- In testmodus (`MESSAGING_PROVIDER=mock`) wordt de code ook direct op de pagina
  getoond, zodat de flow te testen is zonder een echt telefoonnummer.

## Inloggen met tweestapsverificatie (sms)

| Trigger | Kanaal | Bericht (nl) | Locale-sleutel | Bron |
|---|---|---|---|---|
| Gebruiker met 2FA aan logt in met correct wachtwoord | sms | `Je inlogcode: {code}` | `messages.login_code` | [routes/auth.js](../routes/auth.js) — `POST /login` |

- Alleen actief als de gebruiker 2FA heeft aangezet in Instellingen (vereist een
  geverifieerd voorkeursnummer) — zie `users.two_factor_enabled`.
- Code is 6 cijfers, 10 minuten geldig.
- Mislukt de verzending, dan blijft de gebruiker uitgelogd en krijgt een
  foutmelding op het inlogscherm i.p.v. een code-invulscherm dat nooit een sms
  krijgt.

## Adverteerdersgegevens goedgekeurd/afgewezen (inbox, + sms/WhatsApp bij goedkeuring)

| Trigger | Kanaal | Bericht (nl) | Locale-sleutel | Bron |
|---|---|---|---|---|
| Beheerder keurt een profiel goed via Admin → Verificaties | inbox + sms + WhatsApp | `Je adverteerdersgegevens zijn goedgekeurd — je kunt nu listings plaatsen.` | `messages.advertiser_approved` | [routes/admin.js](../routes/admin.js) — `POST /admin/verificaties/:id/status` |
| Beheerder wijst een profiel af, met optionele reden | inbox | `Je adverteerdersgegevens zijn afgewezen{: reden}. Pas ze aan en dien opnieuw in.` | `messages.advertiser_rejected` | idem |

- De sms/WhatsApp-melding wordt alleen verstuurd als het voorkeursnummer van de
  adverteerder geverifieerd is (`phone_verified_at` gezet) — dat is ook het
  moment waarop WhatsApp "enabled" raakt, zoals eerder aan de gebruiker
  gecommuniceerd.
- De afwijzingsreden zelf is vrije tekst die de beheerder typt (Nederlands) en
  wordt ongewijzigd achter de vertaalde omkadering geplakt — niet vertaald.
- **Afwijzing** verstuurt op dit moment alleen een bericht in de support-inbox,
  geen sms/WhatsApp — bewuste keuze, geen technische beperking; makkelijk uit
  te breiden als dat ook gewenst is.

## WhatsApp-commando's (antwoord op inkomend bericht)

Deze berichten zijn reacties op wat een adverteerder zelf via WhatsApp stuurt
naar het supportnummer — zie [routes/webhooks.js](../routes/webhooks.js)
(`POST /webhooks/whatsapp`, gesimuleerd via `/admin/whatsapp-simulator` in
testmodus).

| Commando | Situatie | Antwoordbericht (nl) | Locale-sleutel |
|---|---|---|---|
| `STOP` | Geen listings met automatisch verlengen aan | `Je hebt geen listings met automatisch verlengen aan staan.` | `messages.whatsapp_no_auto_renew` |
| `STOP` | Precies 1 listing met automatisch verlengen aan | `Automatisch verlengen is gestopt voor "{doll_name}".` | `messages.whatsapp_auto_renew_stopped` |
| `STOP` | Meerdere listings met automatisch verlengen aan | `Je hebt meerdere listings met automatisch verlengen aan staan. Zet dit per listing uit via je dashboard op de website.` | `messages.whatsapp_multiple_auto_renew` |
| `VERLENG` | Geen actieve listings | `Je hebt geen actieve listings om te verlengen.` | `messages.whatsapp_no_active_listings` |
| `VERLENG` | Actieve listing(s), maar 0 credits | `Je hebt geen credits meer. Koop credits via Account -> Credits op de website.` | `messages.whatsapp_no_credits` |
| `VERLENG` | Precies 1 actieve listing, credits beschikbaar | `"{doll_name}" is verlengd met 24 uur premium (1 credit gebruikt).` | `messages.whatsapp_extended` |
| `VERLENG` | Meerdere actieve listings | `Je hebt meerdere actieve listings. Verleng de juiste via je dashboard op de website.` | `messages.whatsapp_multiple_active_listings` |

De commandowoorden zelf (`STOP`/`VERLENG`) blijven vaste Nederlandse trefwoorden
— alleen het antwoordbericht is taalafhankelijk.

Elk WhatsApp-bericht (inkomend én uitgaand) wordt ook gelogd in de
`messages`-tabel met `channel='whatsapp'`, zodat het in de support-inbox
zichtbaar blijft naast het gewone webverkeer.

## Support-antwoorden via WhatsApp

Wanneer een beheerder in Admin → Support inbox antwoordt op een gesprek waarvan
het laatste inkomende bericht via WhatsApp binnenkwam, wordt dat antwoord (vrije
tekst, door de beheerder zelf getypt) ook via WhatsApp verstuurd —
zie `POST /admin/messages/:userId` in [routes/admin.js](../routes/admin.js).
Dit is geen vaste sjabloontekst en staat daarom niet in de tabel hierboven.

## E-mailverificatie (e-mail)

| Trigger | Kanaal | Bericht (nl) | Locale-sleutel | Bron |
|---|---|---|---|---|
| Nieuw profiel ingediend, of e-mailadres gewijzigd via Instellingen | e-mail | Onderwerp: `Bevestig je e-mailadres` — inhoud: `Klik op deze link om je e-mailadres te bevestigen: {link}` | `messages.email_confirm_subject` / `messages.email_confirm_body` | [routes/account.js](../routes/account.js) — `issueVerificationEmail` |

- De link wordt ook altijd nog direct op de pagina getoond (naast de mail) —
  handig in testmodus, en als vangnet als de mail zelf niet aankomt.
- Mislukt de verzending, dan wordt dat gelogd en gaat de kruis-kanaal-escalatie
  hieronder lopen (mits het telefoonnummer al geverifieerd is).

## Kruis-kanaal-escalatie bij mislukte verificatie (sms ↔ e-mail)

Als het versturen van een verificatiecode/-link via het ene kanaal mislukt, en
het *andere* kanaal is al geverifieerd, meldt de app dat via dat andere kanaal —
zodat een gebruiker niet blijft hangen op een kanaal dat structureel niet
werkt (bijv. een verkeerd/onbereikbaar telefoonnummer terwijl het e-mailadres
al wel geverifieerd is, of andersom).

| Mislukt kanaal | Melding via | Voorwaarde | Bericht (nl) | Locale-sleutel |
|---|---|---|---|---|
| sms (telefoonverificatie) | e-mail | `users.email_verified_at` gezet | Onderwerp: `Telefoonverificatie mislukt` — `We konden je geen sms met verificatiecode bezorgen. Probeer het opnieuw via je account, of neem contact op met support.` | `messages.verification_failed_email_subject` / `messages.cross_channel_sms_failed` |
| e-mail (verificatiemail) | sms | `advertiser_profiles.phone_verified_at` gezet | `We konden je geen verificatiemail bezorgen. Probeer het opnieuw via je account, of neem contact op met support.` | `messages.cross_channel_email_failed` |

- **Timing:** direct op het moment van mislukken (t=0), en daarna nog twee keer:
  12 uur later (t=12u) en 24 uur later (t=24u) — 3 meldingen in totaal, tenzij de
  gebruiker het intussen zelf oplost.
- **Vroegtijdig stoppen:** zodra de gebruiker het betreffende kanaal alsnog
  succesvol verifieert, wordt de resterende escalatie direct geannuleerd — geen
  "dit is mislukt"-melding meer nadat het probleem al opgelost is.
- **Geen dubbele escalaties:** een nieuwe mislukte poging op hetzelfde kanaal
  terwijl er al een lopende escalatie is, start geen tweede parallelle reeks.
- **Techniek:** bijgehouden in de `verification_failures`-tabel. t=0 wordt
  direct vanuit de route verstuurd; t=12u/t=24u lopen via een "lazy sweep"
  (`processDueNotifications` in [utils/verificationFailures.js](../utils/verificationFailures.js))
  die meelift op de drukste pagina's (`/` en `/dashboard`) — er is geen cron in
  deze app, zelfde aanpak als bij het automatisch verlengen van premium.
