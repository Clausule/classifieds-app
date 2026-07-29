-- Classifieds platform database schema (SQLite)
-- Migrating to MySQL/Postgres later: this schema uses only portable types.

CREATE TABLE IF NOT EXISTS users (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  email                     TEXT NOT NULL UNIQUE,
  password_hash             TEXT NOT NULL,
  name                      TEXT NOT NULL,
  phone                     TEXT,
  role                      TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active                 INTEGER NOT NULL DEFAULT 1,
  email_verification_token  TEXT,
  email_verified_at         TEXT,
  credit_balance            INTEGER NOT NULL DEFAULT 0,
  two_factor_enabled        INTEGER NOT NULL DEFAULT 0,
  preferred_language        TEXT,
  launch_notify_confirmed_at TEXT,
  last_active_at            TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Advertiser identity/verification profile. One row per user, required
-- (status = 'approved') before that user may create a listing. Separate from
-- `users` since only advertisers need this and most fields are optional until
-- they actually try to place an ad.
CREATE TABLE IF NOT EXISTS advertiser_profiles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  id_document_type      TEXT NOT NULL CHECK (id_document_type IN ('identiteitskaart', 'rijbewijs', 'paspoort')),
  id_document_number    TEXT NOT NULL,
  id_document_front     TEXT NOT NULL,
  id_document_back      TEXT,
  selfie_photo          TEXT NOT NULL,
  phone_code            TEXT NOT NULL,
  phone_number          TEXT NOT NULL,
  phone_verified_at     TEXT,
  phone_verification_code    TEXT,
  phone_verification_expires TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason      TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,
  price         REAL,
  location      TEXT,
  neighborhood  TEXT,
  doll_name     TEXT,
  age           INTEGER,
  length_cm     INTEGER,
  weight_kg     INTEGER,
  body_type     TEXT,
  origin_region TEXT,
  skin_tone     TEXT,
  hair_color    TEXT,
  languages     TEXT,
  first_impression     TEXT,
  meeting_atmosphere   TEXT,
  desired_impression   TEXT,
  visitor_expectation  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'active', 'suspended', 'rejected', 'expired', 'deleted')),
  is_fictional  INTEGER NOT NULL DEFAULT 0,
  is_premium    INTEGER NOT NULL DEFAULT 0,
  premium_until TEXT,
  auto_renew    INTEGER NOT NULL DEFAULT 0,
  views_count   INTEGER NOT NULL DEFAULT 0,
  call_clicks_count INTEGER NOT NULL DEFAULT 0,
  activated_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT
);

CREATE TABLE IF NOT EXISTS listing_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Support thread between an advertiser and admin staff.
-- Optionally tied to a specific listing for context.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  sender      TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
  channel     TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  body        TEXT NOT NULL,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail for one-way automated sends that aren't part of the two-way
-- support conversation above (login/verificatiecodes, e-mailbevestiging,
-- kruis-kanaal-mislukt-meldingen). Losstaand van `messages` zodat deze codes
-- niet in de eigen inbox van de gebruiker verschijnen — alleen zichtbaar voor
-- beheer, in het per-gebruiker berichtenoverzicht.
CREATE TABLE IF NOT EXISTS notification_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  subject     TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id);

-- Notice & Action: laagdrempelige meldprocedure, iedere bezoeker mag melden
-- (geen account nodig). status volgt de melding zelf (open/afgewezen/
-- afgehandeld) los van listings.status — een melding "afhandelen" zegt niets
-- over wat er met de advertentie is gebeurd, dat blijft via de normale
-- listings-statuscontroles in Admin -> Listings lopen.
CREATE TABLE IF NOT EXISTS listing_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id     INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL CHECK (reason IN ('illegal_content', 'safety_risk', 'fraud', 'inappropriate', 'other')),
  description    TEXT NOT NULL,
  reporter_email TEXT,
  ip_address     TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_listing_reports_listing ON listing_reports(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listing_reports(status);

-- Premium-listing purchases. One row per checkout attempt.
-- provider is 'mock' (no account needed, simulates Mollie's test statuses)
-- or 'mollie' (real Mollie Test/Live API key, configured via .env).
CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id          INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount              REAL NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  duration_hours      INTEGER NOT NULL DEFAULT 24,
  provider            TEXT NOT NULL DEFAULT 'mock' CHECK (provider IN ('mock', 'mollie')),
  provider_payment_id TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'failed', 'expired', 'canceled')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at             TEXT
);

-- Credit purchases. One row per checkout attempt, mirrors `payments` but isn't
-- tied to a listing — except when bought via the "Maak premium" button with an
-- empty balance, in which case activate_listing_id marks which listing gets
-- premium activated automatically the moment this purchase is paid.
CREATE TABLE IF NOT EXISTS credit_purchases (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits             INTEGER NOT NULL,
  amount              REAL NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  provider            TEXT NOT NULL DEFAULT 'mock' CHECK (provider IN ('mock', 'mollie')),
  provider_payment_id TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'failed', 'expired', 'canceled')),
  activate_listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at             TEXT
);

-- Audit ledger for every credit_balance change (positive = credited, negative
-- = spent). users.credit_balance is a running total kept in sync alongside
-- each insert here rather than recomputed with SUM() on every read.
CREATE TABLE IF NOT EXISTS credit_transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount              INTEGER NOT NULL,
  reason              TEXT NOT NULL CHECK (reason IN ('purchase', 'premium_activate', 'premium_extend', 'auto_renew')),
  listing_id          INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  credit_purchase_id  INTEGER REFERENCES credit_purchases(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kruis-kanaal-escalatie: als sms-verificatie mislukt, melden we dat via
-- e-mail (en andersom) — mits dat andere kanaal al geverifieerd is. Eén rij
-- per lopende storing; notify_attempts/next_notify_at sturen de herhaling op
-- t=0 (direct), t=12u, t=24u. Er is geen cron in deze app — t=0 wordt direct
-- verstuurd vanuit de route zelf, t=12u/t=24u lopen via de lazy sweep op
-- drukke routes (zie processDueNotifications in utils/verificationFailures.js).
CREATE TABLE IF NOT EXISTS verification_failures (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  notify_attempts   INTEGER NOT NULL DEFAULT 0,
  last_notified_at  TEXT,
  next_notify_at    TEXT NOT NULL DEFAULT (datetime('now', '+12 hours')),
  resolved_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generieke sleutel/waarde-instellingen beheerd via Admin -> Instellingen —
-- nu alleen de AI-omschrijving-prompt, maar bewust generiek zodat er later
-- meer instellingen bij kunnen zonder weer een migratie.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_listing ON payments(listing_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_advertiser_profiles_status ON advertiser_profiles(status);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_failures_due ON verification_failures(resolved_at, next_notify_at);
-- idx_listings_auto_renew is created in config/database.js, after the guarded
-- ALTER TABLE that adds the column — see the comment there for why.

