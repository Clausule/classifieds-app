const db = require('../config/database');

// Ontvangers-taal voor geautomatiseerde sms/WhatsApp/e-mail-berichten — de
// account.preferred_language van de ontvanger, niet de site-locale van wie de
// send toevallig triggert (admin-actie, webhook, lazy sweep zonder sessie).
function getUserLanguage(userId) {
  const row = db.prepare('SELECT preferred_language FROM users WHERE id = ?').get(userId);
  return (row && row.preferred_language) || 'nl';
}

module.exports = { getUserLanguage };
