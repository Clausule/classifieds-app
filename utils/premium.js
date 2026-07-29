const db = require('../config/database');

// Extends a listing's premium window by `hours`. If it's still currently
// premium, the hours stack onto the existing premium_until instead of
// resetting from now — so clicking "extend" on an already-active listing
// doesn't lose the remaining time.
function extendPremium(listingId, hours) {
  db.prepare(`
    UPDATE listings SET is_premium = 1,
      premium_until = datetime(
        CASE WHEN premium_until IS NOT NULL AND premium_until > datetime('now') THEN premium_until ELSE datetime('now') END,
        '+' || ? || ' hours'
      )
    WHERE id = ?
  `).run(hours, listingId);
}

module.exports = { extendPremium };
