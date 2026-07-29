const fs = require('fs/promises');
const path = require('path');
const convert = require('heic-convert');
const sharp = require('sharp');

const HEIC_EXTENSIONS = ['.heic', '.heif'];
const WEBP_SOURCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function isHeic(filename) {
  return HEIC_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

function isConvertibleToWebp(filename) {
  return WEBP_SOURCE_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

// iPhones save photos as HEIC by default, which most browsers (and admins not
// on Safari/macOS) can't display in an <img> tag. Converts the file on disk
// to JPEG in place and returns the new filename; deletes the HEIC original.
// Throws on a corrupt/unreadable file — callers should catch and show a
// normal validation error rather than letting it become a hard 500.
async function convertHeicToJpeg(dir, filename) {
  const inputPath = path.join(dir, filename);
  const inputBuffer = await fs.readFile(inputPath);
  const outputBuffer = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
  const newFilename = filename.replace(/\.(heic|heif)$/i, '.jpg');
  await fs.writeFile(path.join(dir, newFilename), outputBuffer);
  await fs.unlink(inputPath);
  return newFilename;
}

// Comprimeert en verkleint een al op disk staand plaatje naar .webp, en
// verwijdert het origineel. Bestaat al als .webp? Dan alleen comprimeren.
// PDF's en al-geconverteerde HEIC's (die na convertHeicToJpeg als .jpg
// binnenkomen) vallen hier ook onder dankzij isConvertibleToWebp.
async function convertToWebp(dir, filename, { width, quality }) {
  const inputPath = path.join(dir, filename);
  const outputBuffer = await sharp(inputPath)
    .rotate() // respecteert EXIF-orientatie voor sharp 'm strip
    .resize({ width, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  const newFilename = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '.webp');
  await fs.writeFile(path.join(dir, newFilename), outputBuffer);
  if (newFilename !== filename) await fs.unlink(inputPath);
  return newFilename;
}

module.exports = { isHeic, isConvertibleToWebp, convertHeicToJpeg, convertToWebp, HEIC_EXTENSIONS };
