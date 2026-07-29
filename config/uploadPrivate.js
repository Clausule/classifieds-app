const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// ID-bewijs foto's zijn gevoelig en mogen nooit publiek serveerbaar zijn —
// vandaar buiten public/ (zie routes/account.js voor de beveiligde serve-route).
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'private-uploads', 'id-documents'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

// .heic/.heif (standaardformaat van iPhone-foto's) worden geaccepteerd en
// daarna door routes/account.js omgezet naar JPEG — zie utils/imageConversion.js.
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.heic', '.heif'];

const uploadPrivate = multer({
  storage,
  // 3 = voorkant + achterkant + selfie (identiteitskaart/rijbewijs sturen alle
  // drie tegelijk) — met files:2 gaf dat een "too many files"-fout van multer.
  limits: { fileSize: 8 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      // cb(null, false) laat multer de rest van het formulier gewoon verder
      // parsen (in plaats van de hele request te laten crashen), zodat de
      // route de al ingevulde velden nog kan tonen bij het foutmelden.
      req.rejectedFiles = req.rejectedFiles || [];
      req.rejectedFiles.push(file.fieldname);
      return cb(null, false);
    }
    cb(null, true);
  },
});

module.exports = uploadPrivate;
