const express = require('express');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const credits = require('./credits');
const { extendPremium } = require('../utils/premium');
const { withLocale } = require('../utils/seo');

const router = express.Router();

// ---- Premium button: spend a credit if there's balance, otherwise send them
// to the credits page to buy some -------------------------------------------
router.post('/listings/:id/premium/checkout', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.own_listing_message' });
  }
  if (listing.status !== 'active') {
    return res.status(400).render('error', {
      title: 'error.not_yet_possible.title',
      message: 'error.not_yet_possible.premium_message',
    });
  }

  const balance = db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(req.user.id).credit_balance;

  if (balance >= 1) {
    credits.spendCredit(req.user.id, 'premium_activate', { listingId: listing.id });
    extendPremium(listing.id, credits.CREDIT_HOURS);
    return res.redirect(req.get('referer') || withLocale(res, '/dashboard'));
  }

  // No balance: send them to the credits page to buy some instead of
  // launching a checkout for exactly 1 credit on their behalf.
  res.redirect(withLocale(res, '/account/credits?no_credits=1'));
});

// ---- Auto-renew toggle: keeps spending 1 credit per 24u until turned off --
// or credits run out (see credits.processAutoRenewals).
router.post('/listings/:id/auto-renew', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.own_listing_message' });
  }
  db.prepare('UPDATE listings SET auto_renew = ? WHERE id = ?').run(listing.auto_renew ? 0 : 1, listing.id);
  res.redirect(req.get('referer') || withLocale(res, '/dashboard'));
});

module.exports = router;
