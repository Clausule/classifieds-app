// Eenmalig, apart systeemaccount dat eigenaar wordt van alle fictieve
// advertenties in de "live" (pre-operationele) fase. Bewust een los account
// i.p.v. de admin zelf, zodat het samen met zijn listings in één keer
// verwijderd kan worden zodra MARKETPLACE_OPERATIONAL=true gaat (zie
// GO-LIVE.md). Idempotent: opnieuw draaien op een DB die het account al
// heeft, doet niets.
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../config/database');

const FICTIONAL_EMAIL = 'fictieve-listings@quickie.internal';
const DOCUMENT_DIR = path.join(__dirname, '..', 'private-uploads', 'id-documents');

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(FICTIONAL_EMAIL);
if (existing) {
  console.log('Fictief systeemaccount bestaat al, seed overgeslagen.');
  process.exit(0);
}

fs.mkdirSync(DOCUMENT_DIR, { recursive: true });

async function main() {
  // Onbruikbaar wachtwoord — niemand hoeft ooit op dit account in te loggen.
  const passwordHash = bcrypt.hashSync(require('crypto').randomBytes(32).toString('hex'), 10);

  const userId = db
    .prepare(`
      INSERT INTO users (email, password_hash, name, role, is_active, email_verified_at)
      VALUES (?, ?, 'Quickie.nu (fictieve listings)', 'user', 1, datetime('now'))
    `)
    .run(FICTIONAL_EMAIL, passwordHash).lastInsertRowid;

  // Herkenbaar placeholder-beeld i.p.v. een echt ID-bewijs/selfie — dit
  // account stelt geen echt persoon voor.
  const placeholder = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 230, g: 230, b: 230 } },
  })
    .jpeg()
    .toBuffer();
  const frontFilename = 'fictional-system-placeholder-front.jpg';
  const selfieFilename = 'fictional-system-placeholder-selfie.jpg';
  fs.writeFileSync(path.join(DOCUMENT_DIR, frontFilename), placeholder);
  fs.writeFileSync(path.join(DOCUMENT_DIR, selfieFilename), placeholder);

  // first_name = 'Quickie.nu', last_name leeg — seller_name (COALESCE van
  // first_name+last_name) op fictieve listings toont zo nog steeds gewoon
  // "Quickie.nu", net als vroeger via de inmiddels verwijderde alias-kolom.
  db.prepare(`
    INSERT INTO advertiser_profiles (
      user_id, first_name, last_name,
      id_document_type, id_document_number, id_document_front, selfie_photo,
      phone_code, phone_number,
      status
    ) VALUES (
      @user_id, 'Quickie.nu', '',
      'identiteitskaart', 'FICTIEF-000000000', @front, @selfie,
      '31', '600000000',
      'approved'
    )
  `).run({ user_id: userId, front: frontFilename, selfie: selfieFilename });

  console.log(`Fictief systeemaccount aangemaakt: ${FICTIONAL_EMAIL} (user_id ${userId}), advertiser_profiles.status = approved.`);
  console.log('Geen geverifieerd telefoonnummer ingesteld, dus geen "Bel mij"-knop op fictieve listings.');
  console.log('Bij operationeel gaan: dit account + al zijn listings (is_fictional=1) verwijderen.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
