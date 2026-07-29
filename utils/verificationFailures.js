const db = require('../config/database');
const email = require('../config/email');
const messaging = require('../config/messaging');
const { phoneE164 } = require('./phone');
const { translate } = require('../middleware/i18n');
const { logNotification } = require('./notificationLog');

const CROSS_CHANNEL_MESSAGE_KEYS = {
  sms: 'messages.cross_channel_sms_failed',
  email: 'messages.cross_channel_email_failed',
};

// Sends the "your {channel} verification failed" notice through the *other*
// channel, but only if that other channel is actually verified — there's
// nowhere else to reach them otherwise. Fire-and-forget, same as every other
// sms/WhatsApp send in this app.
function sendCrossChannelNotice(userId, failedChannel) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;

  const message = translate(user.preferred_language, CROSS_CHANNEL_MESSAGE_KEYS[failedChannel]);

  if (failedChannel === 'sms' && user.email_verified_at) {
    const subject = translate(user.preferred_language, 'messages.verification_failed_email_subject');
    email.sendEmail(user.email, subject, message)
      .then(() => logNotification(userId, 'email', message, subject))
      .catch((err) => {
        console.error('Kruis-kanaal-melding (sms mislukt -> e-mail) versturen mislukt:', err.message);
      });
  } else if (failedChannel === 'email') {
    const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(userId);
    if (profile && profile.phone_verified_at) {
      messaging.sendSms(phoneE164(profile), message)
        .then(() => logNotification(userId, 'sms', message))
        .catch((err) => {
          console.error('Kruis-kanaal-melding (e-mail mislukt -> sms) versturen mislukt:', err.message);
        });
    }
  }
}

// Called right when a verification send fails. Sends the t=0 notice
// immediately (if the fallback channel is verified) and schedules the lazy
// sweep to follow up at +12u and +24u. No-ops if the fallback channel isn't
// verified (nothing to notify through) or a failure is already being
// escalated for this user+channel (avoids duplicate/overlapping schedules).
function recordFailure(userId, channel, fallbackChannelVerified) {
  if (!fallbackChannelVerified) return;

  const existing = db
    .prepare('SELECT id FROM verification_failures WHERE user_id = ? AND channel = ? AND resolved_at IS NULL')
    .get(userId, channel);
  if (existing) return;

  const result = db
    .prepare(`
      INSERT INTO verification_failures (user_id, channel, notify_attempts, last_notified_at, next_notify_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now', '+12 hours'))
    `)
    .run(userId, channel);

  sendCrossChannelNotice(userId, channel);
  return result.lastInsertRowid;
}

// Cancels any pending escalation for this user+channel — called once they
// actually succeed at verifying, so they don't get a "this failed" notice
// hours after they already fixed it themselves.
function resolveFailures(userId, channel) {
  db.prepare(`
    UPDATE verification_failures SET resolved_at = datetime('now')
    WHERE user_id = ? AND channel = ? AND resolved_at IS NULL
  `).run(userId, channel);
}

// Lazy sweep for the +12u and +24u follow-ups — there's no cron in this app,
// so this runs opportunistically on high-traffic routes (see
// routes/listings.js and routes/dashboard.js), same pattern as
// credits.processAutoRenewals. Third send (t=24u) resolves the row.
function processDueNotifications() {
  const due = db
    .prepare("SELECT * FROM verification_failures WHERE resolved_at IS NULL AND next_notify_at <= datetime('now')")
    .all();

  due.forEach((failure) => {
    sendCrossChannelNotice(failure.user_id, failure.channel);

    const attempts = failure.notify_attempts + 1;
    if (attempts >= 3) {
      db.prepare(`
        UPDATE verification_failures
        SET notify_attempts = ?, last_notified_at = datetime('now'), resolved_at = datetime('now')
        WHERE id = ?
      `).run(attempts, failure.id);
    } else {
      db.prepare(`
        UPDATE verification_failures
        SET notify_attempts = ?, last_notified_at = datetime('now'), next_notify_at = datetime(created_at, '+24 hours')
        WHERE id = ?
      `).run(attempts, failure.id);
    }
  });
}

module.exports = { recordFailure, resolveFailures, processDueNotifications };
