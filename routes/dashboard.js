const express = require('express');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { useAccountLocale } = require('../middleware/i18n');
const { processAutoRenewals } = require('./credits');
const { processDueNotifications } = require('../utils/verificationFailures');
const { withLocale } = require('../utils/seo');

const router = express.Router();
router.use('/dashboard', useAccountLocale);

router.get('/dashboard', requireAuth, (req, res) => {
  processAutoRenewals();
  processDueNotifications();

  const listings = db
    .prepare(`
      SELECT l.*,
             (CASE WHEN l.premium_until IS NOT NULL AND l.premium_until > datetime('now') THEN 1 ELSE 0 END) AS is_premium_active,
             (SELECT filename FROM listing_images WHERE listing_id = l.id ORDER BY sort_order LIMIT 1) AS thumbnail
      FROM listings l
      WHERE l.user_id = ? AND l.status != 'deleted'
      ORDER BY l.created_at DESC
    `)
    .all(req.user.id);

  const unreadCount = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND sender = 'admin' AND is_read = 0")
    .get(req.user.id).n;

  res.render('dashboard', {
    title: 'dashboard.title',
    listings,
    unreadCount,
    creditBalance: req.user.credit_balance,
    flash: req.query,
  });
});

router.get('/dashboard/messages', requireAuth, (req, res) => {
  db.prepare("UPDATE messages SET is_read = 1 WHERE user_id = ? AND sender = 'admin'").run(req.user.id);

  const messages = db
    .prepare(`
      SELECT m.*, l.doll_name AS listing_title, l.slug AS listing_slug
      FROM messages m
      LEFT JOIN listings l ON l.id = m.listing_id
      WHERE m.user_id = ?
      ORDER BY m.created_at ASC
    `)
    .all(req.user.id);

  const listings = db.prepare('SELECT id, doll_name FROM listings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  res.render('messages', { title: 'messages.title', messages, listings, isAdmin: false });
});

router.post('/dashboard/messages', requireAuth, (req, res) => {
  const { body, listing_id } = req.body;
  if (!body || !body.trim()) return res.redirect(withLocale(res, '/dashboard/messages'));

  db.prepare(`
    INSERT INTO messages (user_id, listing_id, sender, body)
    VALUES (?, ?, 'user', ?)
  `).run(req.user.id, listing_id || null, body.trim());

  res.redirect(withLocale(res, '/dashboard/messages'));
});

module.exports = router;
