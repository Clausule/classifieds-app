const express = require('express');
const db = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const messaging = require('../config/messaging');
const { phoneE164 } = require('../utils/phone');
const { handleInboundWhatsApp } = require('./webhooks');
const { getSetting, setSetting } = require('../utils/settings');
const { translate } = require('../middleware/i18n');
const { getUserLanguage } = require('../utils/userLanguage');
const { logNotification } = require('../utils/notificationLog');
const { changePassword } = require('../utils/password');

const router = express.Router();

router.use('/admin', requireAuth, requireAdmin);

// Roepnaam (alias) bestaat niet meer — de weergavenaam van een adverteerder
// is voortaan voor- + achternaam, met e-mailadres als terugval als er nog
// geen (of geen volledig) profiel is. NULLIF(...,'') vangt het fictieve
// systeemaccount af (last_name is daar bewust leeg) en een lege combinatie
// in het algemeen.
const SELLER_NAME_SQL = "COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''), u.email)";

// ---- Overview --------------------------------------------------------
router.get('/admin', (req, res) => {
  const stats = {
    pending: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'pending'").get().n,
    active: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").get().n,
    premium: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE premium_until IS NOT NULL AND premium_until > datetime('now')").get().n,
    users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n,
    unreadMessages: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender = 'user' AND is_read = 0").get().n,
    openReports: db.prepare("SELECT COUNT(*) AS n FROM listing_reports WHERE status = 'open'").get().n,
  };
  const recentListings = db
    .prepare(`
      SELECT l.*, ${SELLER_NAME_SQL} AS seller_name, u.id AS seller_user_id, p.id AS seller_profile_id
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN advertiser_profiles p ON p.user_id = l.user_id
      ORDER BY l.created_at DESC LIMIT 8
    `)
    .all();

  res.render('admin/dashboard', { title: 'Admin overzicht', stats, recentListings });
});

// ---- Listings moderation ----------------------------------------------
router.get('/admin/listings', (req, res) => {
  const status = req.query.status || 'pending';
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const q = (req.query.q || '').trim();

  const where = [status === 'all' ? '1=1' : 'l.status = @status'];
  if (userId) where.push('l.user_id = @userId');

  // Advertentienummer wordt getoond als #0007 — laat gebruikers zoeken op "7",
  // "0007" of "#0007" en laat dat ook matchen op naam/roepnaam/e-mail.
  const qDigits = q.replace(/^#/, '').replace(/^0+(?=\d)/, '');
  if (q) {
    where.push(
      /^\d+$/.test(qDigits)
        ? '(l.id = @qId OR l.doll_name LIKE @qLike OR u.email LIKE @qLike OR p.first_name LIKE @qLike OR p.last_name LIKE @qLike)'
        : '(l.doll_name LIKE @qLike OR u.email LIKE @qLike OR p.first_name LIKE @qLike OR p.last_name LIKE @qLike)'
    );
  }

  const listings = db
    .prepare(`
      SELECT l.*, ${SELLER_NAME_SQL} AS seller_name, u.email AS seller_email,
             u.id AS seller_user_id, p.id AS seller_profile_id,
             (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 1 ELSE 0 END) AS is_premium_active
      FROM listings l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN advertiser_profiles p ON p.user_id = l.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.created_at DESC
    `)
    .all({ status, userId, qId: qDigits ? parseInt(qDigits, 10) : null, qLike: q ? `%${q}%` : null });

  const filteredUser = userId
    ? db
        .prepare(`
          SELECT u.id, ${SELLER_NAME_SQL} AS name
          FROM users u LEFT JOIN advertiser_profiles p ON p.user_id = u.id
          WHERE u.id = ?
        `)
        .get(userId)
    : null;

  res.render('admin/listings', { title: 'Listings beheren', listings, currentStatus: status, filteredUser, q });
});

router.post('/admin/listings/:id/status', (req, res) => {
  const { status, message } = req.body;
  const allowed = ['pending', 'active', 'suspended', 'rejected', 'expired', 'deleted'];
  if (!allowed.includes(status)) return res.redirect('/admin/listings');

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.redirect('/admin/listings');

  // activated_at wordt alleen de allereerste keer gezet (COALESCE) en blijft
  // daarna staan ongeacht latere statuswijzigingen — zo blijft zichtbaar dat
  // een pending/rejected listing ooit live heeft gestaan.
  if (status === 'active') {
    db.prepare("UPDATE listings SET status = ?, activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(status, listing.id);
  } else {
    db.prepare("UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, listing.id);
  }

  if (message && message.trim()) {
    db.prepare(`
      INSERT INTO messages (user_id, listing_id, sender, body)
      VALUES (?, ?, 'admin', ?)
    `).run(listing.user_id, listing.id, message.trim());
  }

  res.redirect(req.get('referer') || '/admin/listings');
});

router.post('/admin/listings/:id/premium', (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.redirect('/admin/listings');

  const isCurrentlyActive = listing.premium_until && new Date(listing.premium_until + 'Z') > new Date();
  if (isCurrentlyActive) {
    db.prepare('UPDATE listings SET is_premium = 0, premium_until = NULL WHERE id = ?').run(listing.id);
  } else {
    db.prepare("UPDATE listings SET is_premium = 1, premium_until = datetime('now', '+24 hours') WHERE id = ?").run(listing.id);
  }
  res.redirect(req.get('referer') || '/admin/listings');
});

router.post('/admin/listings/:id/delete', (req, res) => {
  db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
  res.redirect(req.get('referer') || '/admin/listings');
});


// ---- Advertiser verification ----------------------------------------------
router.get('/admin/verificaties', (req, res) => {
  const status = req.query.status || 'pending';
  const where = status === 'all' ? '1=1' : 'p.status = @status';

  const profiles = db
    .prepare(`
      SELECT p.*, u.name AS account_name, u.email, u.email_verified_at
      FROM advertiser_profiles p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY p.created_at DESC
    `)
    .all({ status });

  res.render('admin/verifications', { title: 'Adverteerders verifiëren', profiles, currentStatus: status });
});

router.get('/admin/verificaties/:id', (req, res) => {
  const profile = db
    .prepare(`
      SELECT p.*, u.name AS account_name, u.email, u.email_verified_at
      FROM advertiser_profiles p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
    `)
    .get(req.params.id);

  if (!profile) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Dit profiel bestaat niet.' });

  res.render('admin/verification-detail', { title: `Verificatie — ${profile.account_name}`, profile });
});

router.post('/admin/verificaties/:id/status', (req, res) => {
  const { status, reason } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.redirect('/admin/verificaties');

  const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.redirect('/admin/verificaties');

  db.prepare(`
    UPDATE advertiser_profiles SET status = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, status === 'rejected' ? (reason || null) : null, profile.id);

  const userLang = getUserLanguage(profile.user_id);
  const notice = status === 'approved'
    ? translate(userLang, 'messages.advertiser_approved')
    : status === 'rejected'
      ? translate(userLang, 'messages.advertiser_rejected', { reasonSuffix: reason ? `: ${reason}` : '' })
      : null;
  if (notice) {
    db.prepare(`INSERT INTO messages (user_id, sender, body) VALUES (?, 'admin', ?)`).run(profile.user_id, notice);
  }

  // Goedkeuring ook via sms + WhatsApp melden — WhatsApp is "enabled" zodra het
  // telefoonnummer geverifieerd is (zie account-verify.ejs-tekst hierover).
  if (status === 'approved' && profile.phone_verified_at) {
    const e164 = phoneE164(profile);
    messaging.sendSms(e164, notice)
      .then(() => logNotification(profile.user_id, 'sms', notice))
      .catch((err) => console.error('SMS-goedkeuringsbericht versturen mislukt:', err.message));
    messaging.sendWhatsApp(e164, notice)
      .then(() => db.prepare(`INSERT INTO messages (user_id, sender, body, channel) VALUES (?, 'admin', ?, 'whatsapp')`).run(profile.user_id, notice))
      .catch((err) => console.error('WhatsApp-goedkeuringsbericht versturen mislukt:', err.message));
  }

  res.redirect('/admin/verificaties');
});

// ---- Users ---------------------------------------------------------------
router.get('/admin/users', (req, res) => {
  const users = db
    .prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
             p.id AS profile_id, p.status AS profile_status,
             p.first_name AS profile_first_name, p.last_name AS profile_last_name
      FROM users u
      LEFT JOIN advertiser_profiles p ON p.user_id = u.id
      WHERE u.role = 'user'
      ORDER BY u.created_at DESC
    `)
    .all();
  res.render('admin/users', { title: 'Gebruikers beheren', users });
});

router.post('/admin/users/:id/toggle-active', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/admin/users');
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  res.redirect('/admin/users');
});

// ---- Support messages (admin side) ---------------------------------------
router.get('/admin/messages', (req, res) => {
  const threads = db
    .prepare(`
      SELECT u.id AS user_id, u.name, u.email,
             (SELECT body FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_at,
             (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND sender = 'user' AND is_read = 0) AS unread
      FROM users u
      WHERE u.id IN (SELECT DISTINCT user_id FROM messages)
      ORDER BY last_at DESC
    `)
    .all();
  res.render('admin/messages', { title: 'Support inbox', threads });
});

router.get('/admin/messages/:userId', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).render('error', { title: 'Niet gevonden', message: 'Gebruiker niet gevonden.' });

  db.prepare("UPDATE messages SET is_read = 1 WHERE user_id = ? AND sender = 'user'").run(user.id);

  // Twee bronnen: het echte support-gesprek (messages, kanaal web/whatsapp) en
  // de audit-trail van eenrichtings-sends (notification_log, kanaal sms/email)
  // — samengevoegd tot één chronologische tijdlijn, met tabbladen om op kanaal
  // te filteren.
  const conversationRows = db
    .prepare(`
      SELECT m.id, m.sender, m.channel, m.body, m.created_at,
             l.doll_name AS listing_title, l.slug AS listing_slug
      FROM messages m LEFT JOIN listings l ON l.id = m.listing_id
      WHERE m.user_id = ?
    `)
    .all(user.id)
    .map((m) => ({ ...m, source: 'messages', subject: null }));

  const notificationRows = db
    .prepare('SELECT id, channel, subject, body, created_at FROM notification_log WHERE user_id = ?')
    .all(user.id)
    .map((n) => ({ ...n, source: 'notification_log', sender: 'admin', listing_title: null, listing_slug: null }));

  const allRows = conversationRows.concat(notificationRows).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const channelCounts = { all: allRows.length, web: 0, whatsapp: 0, sms: 0, email: 0 };
  allRows.forEach((r) => { channelCounts[r.channel] = (channelCounts[r.channel] || 0) + 1; });

  const activeChannel = ['web', 'whatsapp', 'sms', 'email'].includes(req.query.channel) ? req.query.channel : 'all';
  const messages = activeChannel === 'all' ? allRows : allRows.filter((r) => r.channel === activeChannel);

  res.render('admin/message-thread', { title: `Berichten — ${user.name}`, threadUser: user, messages, activeChannel, channelCounts });
});

router.post('/admin/messages/:userId', (req, res) => {
  const { body, listing_id } = req.body;
  if (!body || !body.trim()) return res.redirect(`/admin/messages/${req.params.userId}`);

  // If the advertiser's last message came in via WhatsApp, keep replying on
  // that same channel instead of leaving them waiting on the website.
  const lastInbound = db
    .prepare("SELECT channel FROM messages WHERE user_id = ? AND sender = 'user' ORDER BY created_at DESC LIMIT 1")
    .get(req.params.userId);
  const viaWhatsApp = !!lastInbound && lastInbound.channel === 'whatsapp';

  db.prepare(`
    INSERT INTO messages (user_id, listing_id, sender, body, channel)
    VALUES (?, ?, 'admin', ?, ?)
  `).run(req.params.userId, listing_id || null, body.trim(), viaWhatsApp ? 'whatsapp' : 'web');

  if (viaWhatsApp) {
    const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(req.params.userId);
    if (profile) {
      messaging.sendWhatsApp(phoneE164(profile), body.trim()).catch((err) => {
        console.error('WhatsApp-antwoord versturen mislukt:', err.message);
      });
    }
  }

  res.redirect(`/admin/messages/${req.params.userId}`);
});

// ---- Notice & Action: meldingen op advertenties ---------------------------
router.get('/admin/reports', (req, res) => {
  const currentStatus = ['open', 'dismissed', 'resolved'].includes(req.query.status) ? req.query.status : 'open';
  const reports = db
    .prepare(`
      SELECT r.*, l.doll_name AS listing_title, l.slug AS listing_slug, l.status AS listing_status
      FROM listing_reports r
      LEFT JOIN listings l ON l.id = r.listing_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
    `)
    .all(currentStatus);

  res.render('admin/reports', { title: 'Meldingen', reports, currentStatus });
});

router.post('/admin/reports/:id/suspend', (req, res) => {
  const report = db.prepare('SELECT * FROM listing_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.redirect('/admin/reports');
  db.prepare("UPDATE listings SET status = 'suspended', updated_at = datetime('now') WHERE id = ?").run(report.listing_id);
  res.redirect(req.get('referer') || '/admin/reports');
});

router.post('/admin/reports/:id/dismiss', (req, res) => {
  db.prepare("UPDATE listing_reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.redirect(req.get('referer') || '/admin/reports');
});

router.post('/admin/reports/:id/resolve', (req, res) => {
  db.prepare("UPDATE listing_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.redirect(req.get('referer') || '/admin/reports');
});

// ---- WhatsApp inbound-simulator (alleen zichtbaar in mock-modus) ----------
router.get('/admin/whatsapp-simulator', (req, res) => {
  if (messaging.MESSAGING_PROVIDER !== 'mock') {
    return res.status(404).render('error', {
      title: 'Niet beschikbaar',
      message: 'De simulator is alleen beschikbaar met MESSAGING_PROVIDER=mock.',
    });
  }
  const profiles = db
    .prepare(`
      SELECT p.user_id, p.first_name, p.last_name, u.name, u.email
      FROM advertiser_profiles p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.phone_number IS NOT NULL
      ORDER BY p.created_at DESC
    `)
    .all();
  res.render('admin/whatsapp-simulator', { title: 'WhatsApp-simulator (testmodus)', profiles });
});

router.post('/admin/whatsapp-simulator', async (req, res) => {
  if (messaging.MESSAGING_PROVIDER !== 'mock') return res.redirect('/admin/whatsapp-simulator');

  const { user_id, body } = req.body;
  const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(user_id);
  if (profile && body && body.trim()) {
    await handleInboundWhatsApp(profile, body.trim());
  }

  res.redirect('/admin/whatsapp-simulator');
});

// ---- Instellingen: AI-omschrijving-prompt ---------------------------------
router.get('/admin/instellingen', (req, res) => {
  res.render('admin/settings', {
    title: 'Instellingen',
    prompt: getSetting('ai_description_prompt', ''),
    saved: false,
    passwordSaved: false,
    passwordError: null,
  });
});

router.post('/admin/instellingen', (req, res) => {
  setSetting('ai_description_prompt', (req.body.prompt || '').trim());
  res.render('admin/settings', {
    title: 'Instellingen',
    prompt: getSetting('ai_description_prompt', ''),
    saved: true,
    passwordSaved: false,
    passwordError: null,
  });
});

const ADMIN_PASSWORD_ERRORS = {
  incorrect_current: 'Huidig wachtwoord klopt niet.',
  too_short: 'Nieuw wachtwoord moet minimaal 8 tekens zijn.',
  mismatch: 'De wachtwoorden komen niet overeen.',
};

router.post('/admin/instellingen/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const result = changePassword(req.user.id, current_password, new_password, confirm_password);
  res.render('admin/settings', {
    title: 'Instellingen',
    prompt: getSetting('ai_description_prompt', ''),
    saved: false,
    passwordSaved: result.ok,
    passwordError: result.ok ? null : ADMIN_PASSWORD_ERRORS[result.error],
  });
});

module.exports = router;
