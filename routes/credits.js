const express = require('express');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { useAccountLocale } = require('../middleware/i18n');
const payments = require('../config/payments');
const { extendPremium } = require('../utils/premium');
const { withLocale } = require('../utils/seo');

const router = express.Router();
router.use(useAccountLocale);

// 1 credit = 1x the existing premium duration/price constants, so changing
// those two numbers in config/payments.js still adjusts credits everywhere.
const CREDIT_PRICE_EUR = payments.PREMIUM_PRICE_EUR;
const CREDIT_HOURS = payments.PREMIUM_DURATION_HOURS;
const PRESET_CREDIT_AMOUNTS = [1, 3, 5, 10];
const MAX_CREDITS_PER_PURCHASE = 999;

// Adds (or, with a negative amount, spends) credits and records the ledger
// entry in one place so users.credit_balance and credit_transactions never
// drift apart.
function addCredits(userId, amount, reason, { listingId, creditPurchaseId } = {}) {
  db.prepare('UPDATE users SET credit_balance = credit_balance + ? WHERE id = ?').run(amount, userId);
  db.prepare(`
    INSERT INTO credit_transactions (user_id, amount, reason, listing_id, credit_purchase_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, amount, reason, listingId || null, creditPurchaseId || null);
}

function spendCredit(userId, reason, extra) {
  addCredits(userId, -1, reason, extra);
}

// Credits the purchased amount, and — if this purchase came from the "Maak
// premium" button on a specific listing with an empty balance — immediately
// spends 1 of those credits to activate that listing.
function finalizeCreditPurchase(purchase) {
  addCredits(purchase.user_id, purchase.credits, 'purchase', { creditPurchaseId: purchase.id });
  if (purchase.activate_listing_id) {
    spendCredit(purchase.user_id, 'premium_activate', { listingId: purchase.activate_listing_id, creditPurchaseId: purchase.id });
    extendPremium(purchase.activate_listing_id, CREDIT_HOURS);
  }
}

// Lazily processes due auto-renewals — there's no cron/background worker in
// this app, so this runs opportunistically on high-traffic routes (see
// routes/listings.js and routes/dashboard.js) instead. Any listing with
// auto_renew on whose premium has lapsed gets extended for 1 credit; if the
// owner has no credits left, auto_renew switches itself back off.
// TODO: notify the owner via sms/WhatsApp when that happens, once that
// channel exists — see advertiser_profiles.phone_verified_at.
function processAutoRenewals() {
  const due = db
    .prepare(`
      SELECT l.* FROM listings l
      WHERE l.auto_renew = 1 AND l.status = 'active'
        AND l.premium_until IS NOT NULL AND l.premium_until <= datetime('now')
    `)
    .all();

  due.forEach((listing) => {
    const balance = db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(listing.user_id).credit_balance;
    if (balance >= 1) {
      spendCredit(listing.user_id, 'auto_renew', { listingId: listing.id });
      extendPremium(listing.id, CREDIT_HOURS);
    } else {
      db.prepare('UPDATE listings SET auto_renew = 0 WHERE id = ?').run(listing.id);
    }
  });
}

// Shared by the bulk "buy credits" form below and by the premium-checkout
// route (routes/payments.js) when an advertiser has no balance left.
async function startCreditCheckout(req, res, purchaseId, amount, description) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  try {
    const { checkoutUrl, providerPaymentId } = await payments.createCheckout({
      paymentId: purchaseId,
      amount,
      description,
      returnUrl: `${baseUrl}/credits-checkout/${purchaseId}/return`,
      webhookUrl: `${baseUrl}/credits-checkout/${purchaseId}/webhook`,
      mockPath: `/credits-checkout/${purchaseId}`,
    });
    if (providerPaymentId) {
      db.prepare('UPDATE credit_purchases SET provider_payment_id = ? WHERE id = ?').run(providerPaymentId, purchaseId);
    }
    // checkoutUrl is een relatief pad in mock-modus (moet de taalprefix
    // krijgen), maar een absolute externe Mollie-URL in echte modus (nooit
    // met withLocale aanraken, dat zou de externe URL corrumperen).
    res.redirect(checkoutUrl.startsWith('/') ? withLocale(res, checkoutUrl) : checkoutUrl);
  } catch (err) {
    db.prepare("UPDATE credit_purchases SET status = 'failed' WHERE id = ?").run(purchaseId);
    res.status(500).render('error', { title: 'error.payment_start_failed.title', message: err.message });
  }
}

function creditsPageData(userId, extra = {}) {
  return {
    title: 'credits.title',
    balance: db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(userId).credit_balance,
    history: db.prepare('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId),
    presets: PRESET_CREDIT_AMOUNTS,
    pricePerCredit: CREDIT_PRICE_EUR,
    error: null,
    noCredits: false,
    ...extra,
  };
}

// ---- Account page: balance + buy credits ----------------------------------
router.get('/account/credits', requireAuth, (req, res) => {
  res.render('account-credits', creditsPageData(req.user.id, { noCredits: req.query.no_credits === '1' }));
});

router.post('/account/credits/buy', requireAuth, async (req, res) => {
  const credits = parseInt(req.body.credits, 10);
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS_PER_PURCHASE) {
    return res.status(400).render('account-credits', creditsPageData(req.user.id, {
      error: res.locals.t('credits.error.invalid_amount', { max: MAX_CREDITS_PER_PURCHASE }),
    }));
  }

  const amount = Math.round(credits * CREDIT_PRICE_EUR * 100) / 100;
  const result = db.prepare(`
    INSERT INTO credit_purchases (user_id, credits, amount, provider, status)
    VALUES (?, ?, ?, ?, 'open')
  `).run(req.user.id, credits, amount, payments.PROVIDER);

  await startCreditCheckout(req, res, result.lastInsertRowid, amount, `${credits} credits`);
});

// ---- Mock checkout (mirrors routes/payments.js's listing-premium flow) ----
router.get('/credits-checkout/:id', requireAuth, (req, res) => {
  const purchase = db.prepare('SELECT * FROM credit_purchases WHERE id = ?').get(req.params.id);
  if (!purchase || purchase.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.payment_message' });
  }
  if (purchase.provider !== 'mock') return res.redirect(withLocale(res, `/credits-checkout/${purchase.id}/return`));
  if (purchase.status !== 'open') return res.redirect(withLocale(res, `/credits-checkout/${purchase.id}/result`));

  res.render('credits-checkout', { title: 'credits_checkout.title', purchase });
});

router.post('/credits-checkout/:id/simulate', requireAuth, (req, res) => {
  const purchase = db.prepare('SELECT * FROM credit_purchases WHERE id = ?').get(req.params.id);
  if (!purchase || purchase.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.payment_message' });
  }

  const allowed = ['paid', 'failed', 'expired', 'canceled'];
  const status = allowed.includes(req.body.status) ? req.body.status : 'failed';

  db.prepare(`
    UPDATE credit_purchases SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
    WHERE id = ?
  `).run(status, status, purchase.id);

  if (status === 'paid') finalizeCreditPurchase({ ...purchase, status: 'paid' });

  res.redirect(withLocale(res, `/credits-checkout/${purchase.id}/result`));
});

// ---- Real Mollie: webhook (server-to-server status push) -----------------
router.post('/credits-checkout/:id/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  const purchase = db.prepare('SELECT * FROM credit_purchases WHERE id = ?').get(req.params.id);
  if (!purchase || !purchase.provider_payment_id) return res.sendStatus(404);

  try {
    const status = await payments.fetchMolliePaymentStatus(purchase.provider_payment_id);
    const normalized = ['paid', 'failed', 'expired', 'canceled'].includes(status) ? status : purchase.status;

    db.prepare(`
      UPDATE credit_purchases SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
      WHERE id = ?
    `).run(normalized, normalized, purchase.id);

    if (normalized === 'paid') finalizeCreditPurchase({ ...purchase, status: 'paid' });
    res.sendStatus(200);
  } catch (err) {
    console.error('Mollie webhook error (credits):', err.message);
    res.sendStatus(500);
  }
});

// ---- Real Mollie: browser return after hosted checkout --------------------
router.get('/credits-checkout/:id/return', requireAuth, async (req, res) => {
  const purchase = db.prepare('SELECT * FROM credit_purchases WHERE id = ?').get(req.params.id);
  if (!purchase || purchase.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.payment_message' });
  }

  if (purchase.provider === 'mollie' && purchase.provider_payment_id && purchase.status === 'open') {
    try {
      const status = await payments.fetchMolliePaymentStatus(purchase.provider_payment_id);
      const normalized = ['paid', 'failed', 'expired', 'canceled'].includes(status) ? status : purchase.status;
      db.prepare(`
        UPDATE credit_purchases SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
        WHERE id = ?
      `).run(normalized, normalized, purchase.id);
      if (normalized === 'paid') finalizeCreditPurchase({ ...purchase, status: 'paid' });
    } catch (err) {
      console.error('Mollie return status check failed (credits):', err.message);
    }
  }

  res.redirect(withLocale(res, `/credits-checkout/${purchase.id}/result`));
});

// ---- Result page (shared by mock + real provider) -------------------------
router.get('/credits-checkout/:id/result', requireAuth, (req, res) => {
  const purchase = db
    .prepare(`
      SELECT cp.*, l.slug AS activated_listing_slug, l.doll_name AS activated_listing_name
      FROM credit_purchases cp
      LEFT JOIN listings l ON l.id = cp.activate_listing_id
      WHERE cp.id = ?
    `)
    .get(req.params.id);
  if (!purchase || purchase.user_id !== req.user.id) {
    return res.status(404).render('error', { title: 'error.not_found.title', message: 'error.not_found.payment_message' });
  }
  res.render('credits-checkout-result', { title: 'credits_result.title', purchase });
});

module.exports = router;
module.exports.addCredits = addCredits;
module.exports.spendCredit = spendCredit;
module.exports.startCreditCheckout = startCreditCheckout;
module.exports.processAutoRenewals = processAutoRenewals;
module.exports.CREDIT_PRICE_EUR = CREDIT_PRICE_EUR;
module.exports.CREDIT_HOURS = CREDIT_HOURS;
