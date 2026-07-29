const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

// .heic/.heif (standaardformaat van iPhone-foto's) worden geaccepteerd en
// daarna door routes/listings.js omgezet naar JPEG — zie utils/imageConversion.js.
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
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

module.exports = upload;
