const db = require('../config/database');

// Onthoudt wanneer een adverteerder voor het laatst iets deed op het platform
// (ingelogde paginabezoeken) — één van de twee bronnen achter de "actief"-
// badge op de listingkaart, samen met messages.sender='user' (zie
// activityBucket hieronder). Throttled tot eens per 5 minuten per gebruiker
// om niet op elke request een write te doen.
function touchActivity(userId) {
  db.prepare(`
    UPDATE users SET last_active_at = datetime('now')
    WHERE id = ? AND (last_active_at IS NULL OR last_active_at < datetime('now', '-5 minutes'))
  `).run(userId);
}

// BELANGRIJK: auto-renew (credits.processAutoRenewals) verlengt premium_until
// volledig automatisch, getriggerd door bezoekers-pageviews — niet door de
// adverteerder zelf. Dat mag daarom NOOIT last_active_at bijwerken of anders
// meetellen als activiteit, anders suggereert de badge onterecht dat een
// adverteerder recent iets deed terwijl alleen een creditsaldo werd afgeschreven.
// Zie ook CLAUDE.md.
function activityBucket(lastActiveAt, lastMessageAt) {
  const timestamps = [lastActiveAt, lastMessageAt].filter(Boolean);
  if (!timestamps.length) return null;

  const mostRecent = timestamps.reduce((a, b) => (a > b ? a : b));
  const ageMs = Date.now() - new Date(`${mostRecent.replace(' ', 'T')}Z`).getTime();
  const MINUTE = 60 * 1000;

  if (ageMs < 15 * MINUTE) return 'now';
  if (ageMs < 24 * 60 * MINUTE) return 'today';
  if (ageMs < 7 * 24 * 60 * MINUTE) return 'week';
  return null;
}

module.exports = { touchActivity, activityBucket };
