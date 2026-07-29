const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'db', 'classifieds.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

const dbExists = fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Always (re)apply schema — CREATE TABLE IF NOT EXISTS makes this safe on every boot.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Advertiser email verification — simple guarded ADD COLUMN, no constraint
// changes involved so no table rebuild needed here.
[
  ['email_verification_token', 'TEXT'],
  ['email_verified_at', 'TEXT'],
  ['preferred_language', 'TEXT'],
].forEach(([name, type]) => {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  } catch (err) {
    if (!/duplicate column name/.test(err.message)) throw err;
  }
});

// selfie_photo added to advertiser_profiles after the table already existed —
// guarded ADD COLUMN (nullable here; required is enforced at the app layer,
// same pattern as other listing fields that predate their own NOT NULL move).
try {
  db.exec('ALTER TABLE advertiser_profiles ADD COLUMN selfie_photo TEXT');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// phone_verified_at: placeholder for future sms/WhatsApp verification —
// always NULL until that's built, but the UI status label needs it now.
try {
  db.exec('ALTER TABLE advertiser_profiles ADD COLUMN phone_verified_at TEXT');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// Credit system: simple guarded ADD COLUMNs, no constraint changes so no
// table rebuild needed. credit_purchases/credit_transactions are brand new
// tables, already created fresh by the CREATE TABLE IF NOT EXISTS above.
try {
  db.exec('ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}
try {
  db.exec('ALTER TABLE listings ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}
// Only safe to index auto_renew after the column above is guaranteed to exist
// — schema.sql's own CREATE INDEX runs before this on pre-existing databases.
db.exec('CREATE INDEX IF NOT EXISTS idx_listings_auto_renew ON listings(auto_renew)');

// origin_country (full country list) became origin_region (broader regional/
// ethnic classification) — rename first so existing data survives; on a
// database that never had origin_country this is a no-op (caught below).
try {
  db.exec('ALTER TABLE listings RENAME COLUMN origin_country TO origin_region');
} catch (err) {
  if (!/no such column/.test(err.message)) throw err;
}

// CREATE TABLE IF NOT EXISTS doesn't add columns to tables that already exist, so
// columns added to schema.sql after the first boot need a guarded ALTER TABLE here.
const newListingColumns = [
  ['neighborhood', 'TEXT'],
  ['doll_name', 'TEXT'],
  ['length_cm', 'INTEGER'],
  ['weight_kg', 'INTEGER'],
  ['body_type', 'TEXT'],
  ['origin_region', 'TEXT'],
  ['skin_tone', 'TEXT'],
  ['hair_color', 'TEXT'],
  ['languages', 'TEXT'],
  ['call_clicks_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['activated_at', 'TEXT'],
];
newListingColumns.forEach(([name, type]) => {
  try {
    db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
  } catch (err) {
    if (!/duplicate column name/.test(err.message)) throw err;
  }
});

// Categories are gone (replaced by a city filter) — drop the index before the
// column (SQLite refuses to drop a column an index still references), then
// the column itself, then the now-empty table.
try {
  db.exec('DROP INDEX idx_listings_category');
} catch (err) {
  if (!/no such index/.test(err.message)) throw err;
}

// price_type (fixed/negotiable/free/on_request) is gone now that price is a
// fixed 60/70/80/90 dropdown, title is gone now that "Naam" (doll_name) is
// the listing's headline, and category_id is gone with the category feature —
// drop all three from databases created before this.
['price_type', 'title', 'category_id'].forEach((column) => {
  try {
    db.exec(`ALTER TABLE listings DROP COLUMN ${column}`);
  } catch (err) {
    if (!/no such column/.test(err.message)) throw err;
  }
});

db.exec('DROP TABLE IF EXISTS categories');

// status enum changed ('sold' removed, 'deleted' added for soft-deleted
// listings) — SQLite can't alter a CHECK constraint in place, so rebuild the
// table: rename it out of the way, let schema.sql's CREATE TABLE (already
// run above) create a fresh one, copy the data across (translating the now-
// invalid 'sold' status), then drop the old copy. By this point every other
// column migration above has already run, so listings_old's columns line up
// exactly with the fresh table.
// legacy_alter_table=ON stops SQLite from "helpfully" rewriting the FK text
// inside listing_images/messages/payments/listing_reports (anything that
// REFERENCES listings) to point at the temporary listings_old name during
// the rename below — without it, those tables end up permanently pointing
// at listings_old, which no longer exists once it's dropped at the end.
const listingsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='listings'").get();
if (listingsTable && listingsTable.sql.includes("'sold'")) {
  db.pragma('legacy_alter_table = ON');
  db.transaction(() => {
    db.exec('ALTER TABLE listings RENAME TO listings_old');
    db.exec(schema);
    db.exec(`
      INSERT INTO listings (
        id, user_id, slug, description, price, location, neighborhood,
        doll_name, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color, languages,
        status, is_premium, premium_until, views_count, created_at, updated_at, expires_at
      )
      SELECT
        id, user_id, slug, description, price, location, neighborhood,
        doll_name, length_cm, weight_kg, body_type, origin_region, skin_tone, hair_color, languages,
        CASE WHEN status = 'sold' THEN 'expired' ELSE status END,
        is_premium, premium_until, views_count, created_at, updated_at, expires_at
      FROM listings_old
    `);
    db.exec('DROP TABLE listings_old');
  })();
  db.pragma('legacy_alter_table = OFF');
}

// status enum gained 'suspended' (Notice & Action: advertentie direct offline
// bij een lopende melding) — zelfde rebuild-aanpak als hierboven. Herbouwt
// ook idx_listings_auto_renew, want DROP TABLE listings_old neemt de index
// van de hernoemde tabel mee, en schema.sql's eigen CREATE TABLE definieert
// 'm niet (die wordt normaal pas hieronder bij regel 64 aangemaakt, wat op
// een verse boot vóór deze migratie draait).
const listingsTableV2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='listings'").get();
if (listingsTableV2 && !listingsTableV2.sql.includes("'suspended'")) {
  db.pragma('legacy_alter_table = ON');
  db.transaction(() => {
    db.exec('ALTER TABLE listings RENAME TO listings_old');
    db.exec(schema);
    db.exec('INSERT INTO listings SELECT * FROM listings_old');
    db.exec('DROP TABLE listings_old');
    db.exec('CREATE INDEX IF NOT EXISTS idx_listings_auto_renew ON listings(auto_renew)');
  })();
  db.pragma('legacy_alter_table = OFF');
}

// WhatsApp support channel: tracks whether a message came in/out via the
// website or via WhatsApp, so admin replies know where to route back to.
try {
  db.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'web'");
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// Phone OTP (sms) verification + 2FA login: simple guarded ADD COLUMNs.
[
  ['phone_verification_code', 'TEXT'],
  ['phone_verification_expires', 'TEXT'],
].forEach(([name, type]) => {
  try {
    db.exec(`ALTER TABLE advertiser_profiles ADD COLUMN ${name} ${type}`);
  } catch (err) {
    if (!/duplicate column name/.test(err.message)) throw err;
  }
});
try {
  db.exec('ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// Pre-launch waitlist: users mogen al registreren terwijl MARKETPLACE_OPERATIONAL
// nog false staat, maar zien dan een "nog niet live"-melding i.p.v. hun dashboard
// (zie requireAuth in middleware/auth.js). Deze kolom onthoudt wie op "mail me"
// heeft geklikt, voor de lijst zodra de vlag om gaat.
try {
  db.exec('ALTER TABLE users ADD COLUMN launch_notify_confirmed_at TEXT');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// "Actief"-badge op de listingkaart: onthoudt wanneer een adverteerder voor
// het laatst een ingelogde actie deed (zie utils/activity.js — gecombineerd
// met messages.sender='user' voor WhatsApp-activiteit).
try {
  db.exec('ALTER TABLE users ADD COLUMN last_active_at TEXT');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// Leeftijd: kolom toegevoegd na eerste release, dus guarded ADD COLUMN voor
// bestaande databases (nieuwe databases krijgen 'm al via schema.sql hierboven).
try {
  db.exec('ALTER TABLE listings ADD COLUMN age INTEGER');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}

// is_fictional: markeert placeholder-advertenties die de "live" (pre-operationele)
// fase vullen totdat er echte adverteerders zijn — moet vóór operationeel gaan
// samen met hun systeemaccount bulk verwijderd worden, anders raken ze mee
// geïndexeerd zodra MARKETPLACE_OPERATIONAL=true de noindex-bescherming opheft.
try {
  db.exec('ALTER TABLE listings ADD COLUMN is_fictional INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  if (!/duplicate column name/.test(err.message)) throw err;
}
db.exec('CREATE INDEX IF NOT EXISTS idx_listings_is_fictional ON listings(is_fictional)');

// Sfeer-vragen voor de AI-bio-prompt: nooit op de advertentie zelf getoond,
// alleen als merge-velden beschikbaar voor de prompt-template (Admin ->
// Instellingen). Optioneel, dus geen NOT NULL/CHECK-constraint nodig.
const newVibeColumns = [
  ['first_impression', 'TEXT'],
  ['meeting_atmosphere', 'TEXT'],
  ['desired_impression', 'TEXT'],
  ['visitor_expectation', 'TEXT'],
];
newVibeColumns.forEach(([name, type]) => {
  try {
    db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
  } catch (err) {
    if (!/duplicate column name/.test(err.message)) throw err;
  }
});

// Eén telefoonnummer per adverteerder in plaats van privé/zakelijk + voorkeur
// — dat nummer is voortaan altijd het nummer dat geverifieerd wordt. RENAME
// COLUMN (zelfde aanpak als origin_country -> origin_region hierboven) zodat
// bestaande nummers niet verloren gaan; de nu overbodige zakelijk/voorkeur-
// kolommen worden daarna gedropt (zelfde DROP COLUMN-aanpak als price_type/
// title/category_id hierboven — werkt ook met de CHECK-constraint op
// phone_preference, SQLite verwijdert die constraint gewoon mee).
try {
  db.exec('ALTER TABLE advertiser_profiles RENAME COLUMN phone_private_code TO phone_code');
  db.exec('ALTER TABLE advertiser_profiles RENAME COLUMN phone_private_number TO phone_number');
} catch (err) {
  if (!/no such column/.test(err.message)) throw err;
}
['phone_business_code', 'phone_business_number', 'phone_preference'].forEach((column) => {
  try {
    db.exec(`ALTER TABLE advertiser_profiles DROP COLUMN ${column}`);
  } catch (err) {
    if (!/no such column/.test(err.message)) throw err;
  }
});

// Adverteerdersgegevens-formulier vereenvoudigd naar naam + identiteitsbewijs
// + telefoon — roepnaam (alias) en het losse woonadres/herkomst-blok vroegen
// meer gegevens dan we voor verificatie nodig hebben. Zelfde DROP COLUMN-
// aanpak als hierboven (werkt ook al deze kolommen geen CHECK-constraint
// hebben, SQLite verwijdert gewoon de kolom).
['alias', 'address_street', 'address_number', 'address_postal_code', 'address_city', 'address_country', 'origin_city', 'origin_country'].forEach((column) => {
  try {
    db.exec(`ALTER TABLE advertiser_profiles DROP COLUMN ${column}`);
  } catch (err) {
    if (!/no such column/.test(err.message)) throw err;
  }
});

// Standaard AI-omschrijving-prompt — alleen ingevuld als er nog geen (eigen)
// versie is opgeslagen, zodat een admin-aanpassing nooit wordt overschreven.
const DEFAULT_AI_PROMPT = `Schrijf een aantrekkelijke, eerlijke advertentietekst in het Nederlands voor een tweedehands modepop die te koop wordt aangeboden. Schrijf in de ik-vorm vanuit de verkoper, maximaal 4 zinnen, geen opsomming, geen markdown.

Naam: {{doll_name}}
Lengte: {{length_cm}} cm
Gewicht: {{weight_kg}} kg
Lichaamstype: {{body_type}}
Huidskleur: {{skin_tone}}
Haarkleur: {{hair_color}}
Herkomst: {{origin_region}}
Talen: {{languages}}
Prijs: €{{price}}
Locatie: {{location}}, {{neighborhood}}`;

db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)').run('ai_description_prompt', DEFAULT_AI_PROMPT);

if (!dbExists) {
  console.log('Nieuwe database aangemaakt op', DB_PATH);
  console.log('Run "npm run seed" om een admin-account en voorbeelddata toe te voegen.');
}

module.exports = db;
