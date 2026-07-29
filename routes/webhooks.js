const express = require('express');
const db = require('../config/database');
const messaging = require('../config/messaging');
const { extendPremium } = require('../utils/premium');
const { phoneE164 } = require('../utils/phone');
const { translate } = require('../middleware/i18n');
const { getUserLanguage } = require('../utils/userLanguage');
const credits = require('./credits');

const router = express.Router();

function normalizeDigits(raw) {
  return (raw || '').replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
}

function findProfileByPhoneDigits(digits) {
  return db
    .prepare(`
      SELECT * FROM advertiser_profiles
      WHERE (phone_code || phone_number) = ?
    `)
    .get(digits);
}

function logMessage(userId, sender, body, { listingId, channel = 'whatsapp' } = {}) {
  db.prepare(`
    INSERT INTO messages (user_id, listing_id, sender, body, channel)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, listingId || null, sender, body, channel);
}

async function replyWhatsApp(profile, body, listingId) {
  logMessage(profile.user_id, 'admin', body, { listingId });
  try {
    await messaging.sendWhatsApp(phoneE164(profile), body);
  } catch (err) {
    console.error('WhatsApp-antwoord versturen mislukt:', err.message);
  }
}

async function handleStopCommand(profile) {
  const lang = getUserLanguage(profile.user_id);
  const listings = db
    .prepare("SELECT * FROM listings WHERE user_id = ? AND auto_renew = 1 AND status = 'active'")
    .all(profile.user_id);

  if (listings.length === 0) {
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_no_auto_renew'));
  } else if (listings.length === 1) {
    db.prepare('UPDATE listings SET auto_renew = 0 WHERE id = ?').run(listings[0].id);
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_auto_renew_stopped', { name: listings[0].doll_name }), listings[0].id);
  } else {
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_multiple_auto_renew'));
  }
}

async function handleExtendCommand(profile) {
  const lang = getUserLanguage(profile.user_id);
  const listings = db.prepare("SELECT * FROM listings WHERE user_id = ? AND status = 'active'").all(profile.user_id);
  const balance = db.prepare('SELECT credit_balance FROM users WHERE id = ?').get(profile.user_id).credit_balance;

  if (listings.length === 0) {
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_no_active_listings'));
  } else if (balance < 1) {
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_no_credits'));
  } else if (listings.length === 1) {
    credits.spendCredit(profile.user_id, 'premium_extend', { listingId: listings[0].id });
    extendPremium(listings[0].id, credits.CREDIT_HOURS);
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_extended', { name: listings[0].doll_name }), listings[0].id);
  } else {
    await replyWhatsApp(profile, translate(lang, 'messages.whatsapp_multiple_active_listings'));
  }
}

// Shared by the real Twilio webhook and the mock inbound-simulator (see
// routes/admin.js) so both paths log/react identically.
async function handleInboundWhatsApp(profile, body) {
  logMessage(profile.user_id, 'user', body || '(leeg bericht)');

  const command = body.trim().toUpperCase();
  if (command === 'STOP') {
    await handleStopCommand(profile);
  } else if (command === 'VERLENG') {
    await handleExtendCommand(profile);
  }
}

// Twilio calls this on every inbound WhatsApp message (form-urlencoded: From,
// To, Body). No signature verification yet — fine for MESSAGING_PROVIDER=mock,
// should be added (X-Twilio-Signature) before switching to a real account.
router.post('/webhooks/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
  const digits = normalizeDigits(req.body.From);
  const body = (req.body.Body || '').trim();
  const profile = digits ? findProfileByPhoneDigits(digits) : null;

  if (profile) {
    await handleInboundWhatsApp(profile, body);
  }

  res.sendStatus(200);
});

module.exports = router;
module.exports.handleInboundWhatsApp = handleInboundWhatsApp;
module.exports.findProfileByPhoneDigits = findProfileByPhoneDigits;
