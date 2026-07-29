const bcrypt = require('bcryptjs');
const db = require('../config/database');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (?, ?, 'Beheerder', 'admin')
  `).run(ADMIN_EMAIL, hash);
  console.log(`Admin-account aangemaakt: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('Pas dit wachtwoord direct aan na de eerste keer inloggen.');
} else {
  console.log('Er bestaat al een admin-account, seed overgeslagen.');
}

console.log('Seed voltooid.');
process.exit(0);
