const db = require('../config/database');

// Audit trail voor sms/e-mail-sends die geen onderdeel zijn van het support-
// gesprek in `messages` (codes, bevestigingen) — alleen zichtbaar voor beheer,
// zie routes/admin.js GET /admin/messages/:userId.
function logNotification(userId, channel, body, subject) {
  db.prepare(`
    INSERT INTO notification_log (user_id, channel, subject, body)
    VALUES (?, ?, ?, ?)
  `).run(userId, channel, subject || null, body);
}

module.exports = { logNotification };
