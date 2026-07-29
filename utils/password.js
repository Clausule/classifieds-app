const bcrypt = require('bcryptjs');
const db = require('../config/database');

// Gedeeld door /account/settings/password en /admin/instellingen/password —
// zelfde regels als bij registreren (minimaal 8 tekens, zie routes/auth.js).
function changePassword(userId, currentPassword, newPassword, confirmPassword) {
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return { ok: false, error: 'incorrect_current' };
  }
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: 'too_short' };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'mismatch' };
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), userId);
  return { ok: true };
}

module.exports = { changePassword };
