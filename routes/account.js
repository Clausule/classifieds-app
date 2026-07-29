const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../config/database');
const uploadPrivate = require('../config/uploadPrivate');
const { requireAuth } = require('../middleware/auth');
const { COUNTRIES } = require('../utils/countries');
const { parsePhoneNumber, phoneE164 } = require('../utils/phone');
const messaging = require('../config/messaging');
const email = require('../config/email');
const verificationFailures = require('../utils/verificationFailures');
const { isHeic, isConvertibleToWebp, convertHeicToJpeg, convertToWebp } = require('../utils/imageConversion');
const { SUPPORTED_LOCALES, translate, useAccountLocale } = require('../middleware/i18n');
const { getUserLanguage } = require('../utils/userLanguage');
const { logNotification } = require('../utils/notificationLog');
const { changePassword } = require('../utils/password');
const { withLocale } = require('../utils/seo');

const router = express.Router();
router.use('/account', useAccountLocale);

const ID_DOCUMENT_TYPES = ['identiteitskaart', 'rijbewijs', 'paspoort'];
const DOCUMENT_DIR = path.join(__dirname, '..', 'private-uploads', 'id-documents');
const CONVERT_TO_WEBP = process.env.IMAGE_CONVERT_WEBP === 'true';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE_FIELD_LABEL_KEYS = {
  id_document_front: 'account_verify.file_label.front',
  id_document_back: 'account_verify.file_label.back',
  selfie_photo: 'account_verify.file_label.selfie',
};

function getProfile(userId) {
  return db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(userId);
}

function issueVerificationEmail(req, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET email_verification_token = ?, email_verified_at = NULL WHERE id = ?').run(token, userId);
  const link = `${req.protocol}://${req.get('host')}/account/verify/email/${token}`;

  const targetEmail = db.prepare('SELECT email FROM users WHERE id = ?').get(userId).email;
  const userLang = getUserLanguage(userId);
  const emailSubject = translate(userLang, 'messages.email_confirm_subject');
  const emailBody = translate(userLang, 'messages.email_confirm_body', { link });
  email
    .sendEmail(targetEmail, emailSubject, emailBody)
    .then(() => logNotification(userId, 'email', emailBody, emailSubject))
    .catch((err) => {
      console.error('Verificatiemail versturen mislukt:', err.message);
      const profile = getProfile(userId);
      verificationFailures.recordFailure(userId, 'email', !!(profile && profile.phone_verified_at));
    });

  return link;
}

// Generates + sends a fresh sms verification code for the given profile
// (profile only needs user_id + the phone_* fields — a plain advertiser_profiles
// row or the `data`/`phoneData` shape used before those are written both work).
// Throws on send failure after clearing the half-set code, same as the
// explicit /account/verify/phone/send route — callers decide how to surface that.
async function sendPhoneVerificationCode(profile) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare(`
    UPDATE advertiser_profiles
    SET phone_verification_code = ?, phone_verification_expires = datetime('now', '+10 minutes')
    WHERE user_id = ?
  `).run(code, profile.user_id);

  try {
    const smsBody = translate(getUserLanguage(profile.user_id), 'messages.phone_verification_code', { code });
    await messaging.sendSms(phoneE164(profile), smsBody);
    logNotification(profile.user_id, 'sms', smsBody);
  } catch (err) {
    db.prepare('UPDATE advertiser_profiles SET phone_verification_code = NULL, phone_verification_expires = NULL WHERE user_id = ?').run(profile.user_id);
    throw err;
  }
  return code;
}

// True if the phone number differs from what's stored — used to decide
// whether a save should reset phone_verified_at, since a verified stamp on a
// number that's no longer theirs would be meaningless.
function phoneChanged(existing, data) {
  if (!existing) return false;
  return existing.phone_code !== data.phone_code || existing.phone_number !== data.phone_number;
}

// ---- Profile form: view + submit ------------------------------------------
router.get('/account/verify', requireAuth, (req, res) => {
  const profile = getProfile(req.user.id);
  res.render('account-verify', {
    title: 'account_verify.title',
    countries: COUNTRIES,
    profile: profile || {},
    locked: !!profile && profile.status === 'approved',
    error: null,
    query: req.query,
  });
});

router.post(
  '/account/verify',
  requireAuth,
  uploadPrivate.fields([
    { name: 'id_document_front', maxCount: 1 },
    { name: 'id_document_back', maxCount: 1 },
    { name: 'selfie_photo', maxCount: 1 },
  ]),
  async (req, res) => {
    const existing = getProfile(req.user.id);
    const b = req.body;
    const allUploaded = [...(req.files?.id_document_front || []), ...(req.files?.id_document_back || []), ...(req.files?.selfie_photo || [])];

    // Identity data is locked once a profile has been approved — resubmission
    // only happens via a rejection, never on top of an approved profile.
    if (existing && existing.status === 'approved') {
      allUploaded.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(403).render('error', {
        title: 'error.not_possible.title',
        message: 'error.not_possible.identity_locked',
      });
    }

    const fail = (message) => {
      allUploaded.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).render('account-verify', {
        title: 'account_verify.title',
        countries: COUNTRIES,
        profile: { ...existing, ...b },
        locked: false,
        error: message,
      });
    };

    // Een niet-toegestaan bestandstype wordt door multer stilzwijgend
    // overgeslagen (zie config/uploadPrivate.js) i.p.v. de hele request te
    // laten crashen — hier melden we dat alsnog, met behoud van ingevulde velden.
    if (req.rejectedFiles?.length) {
      const labelKey = FILE_FIELD_LABEL_KEYS[req.rejectedFiles[0]];
      const label = labelKey ? res.locals.t(labelKey) : res.locals.t('account_verify.file_label.selfie');
      return fail(`${res.locals.t('account_verify.error.file_type_prefix')} ${label}. ${res.locals.t('account_verify.error.file_type_suffix')}`);
    }

    const requiredFields = [
      'first_name', 'last_name', 'id_document_type', 'id_document_number',
      'phone_code', 'phone_number',
    ];
    if (requiredFields.some((f) => !b[f] || !String(b[f]).trim())) {
      return fail('account_verify.error.required');
    }
    if (!ID_DOCUMENT_TYPES.includes(b.id_document_type)) {
      return fail('account_verify.error.invalid_document_type');
    }

    const needsBack = b.id_document_type !== 'paspoort';
    const frontFile = req.files?.id_document_front?.[0];
    const backFile = req.files?.id_document_back?.[0];
    const selfieFile = req.files?.selfie_photo?.[0];

    if (!frontFile && !existing?.id_document_front) {
      return fail(needsBack ? 'account_verify.error.upload_front' : 'account_verify.error.upload_passport');
    }
    if (needsBack && !backFile && !existing?.id_document_back) {
      return fail('account_verify.error.upload_back');
    }
    if (!selfieFile && !existing?.selfie_photo) {
      return fail('account_verify.error.upload_selfie');
    }

    // iPhone-foto's zijn vaak HEIC — zet die om naar JPEG zodat beheerders
    // (niet allemaal op Safari/macOS) ze straks ook echt kunnen bekijken.
    try {
      for (const file of [frontFile, backFile, selfieFile]) {
        if (file && isHeic(file.filename)) {
          file.filename = await convertHeicToJpeg(DOCUMENT_DIR, file.filename);
        }
        // Hogere resolutie/kwaliteit dan listing-foto's — leesbaarheid van
        // het document weegt hier zwaarder dan bestandsgrootte.
        if (file && CONVERT_TO_WEBP && isConvertibleToWebp(file.filename)) {
          file.filename = await convertToWebp(DOCUMENT_DIR, file.filename, { width: 2000, quality: 85 });
        }
      }
    } catch (err) {
      console.error('HEIC-conversie mislukt:', err.message);
      return fail('account_verify.error.heic_failed');
    }

    const phoneNumber = parsePhoneNumber(b.phone_code, b.phone_number);
    if (!phoneNumber) return fail('account_verify.error.invalid_phone');

    const data = {
      user_id: req.user.id,
      first_name: b.first_name.trim(),
      last_name: b.last_name.trim(),
      id_document_type: b.id_document_type,
      id_document_number: b.id_document_number.trim(),
      id_document_front: frontFile ? frontFile.filename : existing.id_document_front,
      id_document_back: needsBack ? (backFile ? backFile.filename : existing.id_document_back) : null,
      selfie_photo: selfieFile ? selfieFile.filename : existing.selfie_photo,
      phone_code: b.phone_code,
      phone_number: phoneNumber,
    };
    data.phone_verified_at = phoneChanged(existing, data) ? null : (existing ? existing.phone_verified_at : null);

    // Resubmitting after a rejection replaces old files if a new one was uploaded.
    if (existing && frontFile && existing.id_document_front) fs.unlink(path.join(DOCUMENT_DIR, existing.id_document_front), () => {});
    if (existing && backFile && existing.id_document_back) fs.unlink(path.join(DOCUMENT_DIR, existing.id_document_back), () => {});
    if (existing && selfieFile && existing.selfie_photo) fs.unlink(path.join(DOCUMENT_DIR, existing.selfie_photo), () => {});

    if (existing) {
      db.prepare(`
        UPDATE advertiser_profiles SET
          first_name=@first_name, last_name=@last_name,
          id_document_type=@id_document_type, id_document_number=@id_document_number,
          id_document_front=@id_document_front, id_document_back=@id_document_back, selfie_photo=@selfie_photo,
          phone_code=@phone_code, phone_number=@phone_number, phone_verified_at=@phone_verified_at,
          status='pending', rejection_reason=NULL, updated_at=datetime('now')
        WHERE user_id=@user_id
      `).run(data);
    } else {
      db.prepare(`
        INSERT INTO advertiser_profiles (
          user_id, first_name, last_name, id_document_type, id_document_number,
          id_document_front, id_document_back, selfie_photo,
          phone_code, phone_number
        ) VALUES (
          @user_id, @first_name, @last_name, @id_document_type, @id_document_number,
          @id_document_front, @id_document_back, @selfie_photo,
          @phone_code, @phone_number
        )
      `).run(data);
    }

    // E-mailverificatie: token genereren, mail versturen (mock/echt, zie config/email.js) én
    // de link ook tonen — handig in testmodus, en als vangnet als de mail zelf niet aankomt.
    const verificationLink = req.user.email_verified_at ? null : issueVerificationEmail(req, req.user.id);

    // Sms-verificatie automatisch starten, net als e-mail — alleen als het
    // nummer nog niet geverifieerd is (data.phone_verified_at is dan null,
    // zowel bij een nieuw profiel als na een nummerwijziging bij opnieuw indienen).
    let phoneCodeSent = false;
    let phoneMockCode = null;
    if (!data.phone_verified_at) {
      try {
        const code = await sendPhoneVerificationCode(getProfile(req.user.id));
        phoneCodeSent = true;
        if (messaging.MESSAGING_PROVIDER === 'mock') phoneMockCode = code;
      } catch (err) {
        console.error('SMS-verificatiecode (automatisch) versturen mislukt:', err.message);
        verificationFailures.recordFailure(req.user.id, 'sms', !!req.user.email_verified_at);
      }
    }

    res.render('account-verify-submitted', { title: 'account_verify_submitted.title', verificationLink, phoneCodeSent, phoneMockCode });
  }
);

// ---- E-mailverificatie (mail + link tonen als vangnet, zie issueVerificationEmail) --
router.get('/account/verify/email/:token', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND email_verification_token = ?').get(req.user.id, req.params.token);
  if (!user) {
    return res.status(400).render('error', { title: 'error.invalid_link.title', message: 'error.invalid_link.message' });
  }
  db.prepare("UPDATE users SET email_verified_at = datetime('now'), email_verification_token = NULL WHERE id = ?").run(user.id);
  verificationFailures.resolveFailures(user.id, 'email');
  res.redirect(withLocale(res, '/account/verify?email_verified=1'));
});

// ---- E-mailverificatie handmatig opnieuw versturen (net als bij sms) --------
router.post('/account/verify/email/resend', requireAuth, (req, res) => {
  const back = (req.get('referer') || withLocale(res, '/account/verify')).split('?')[0];
  if (req.user.email_verified_at) return res.redirect(back);

  const verificationLink = issueVerificationEmail(req, req.user.id);
  res.render('account-verify-submitted', {
    title: 'account_verify_submitted.resend_title',
    verificationLink,
    phoneCodeSent: false,
    phoneMockCode: null,
  });
});

// ---- Beveiligde weergave van ID-bewijs/selfie foto's (alleen eigenaar of admin) --
router.get('/account/verify/document/:profileId/:field', requireAuth, (req, res) => {
  const { profileId, field } = req.params;
  if (!['front', 'back', 'selfie'].includes(field)) return res.status(404).end();

  const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE id = ?').get(profileId);
  const isOwner = profile && profile.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!profile || (!isOwner && !isAdmin)) return res.status(404).end();

  const filename = { front: profile.id_document_front, back: profile.id_document_back, selfie: profile.selfie_photo }[field];
  if (!filename) return res.status(404).end();

  res.sendFile(path.join(DOCUMENT_DIR, filename));
});

// ---- Instellingen: e-mail, telefoonnummers + voorkeur later aanpasbaar ----
// (SMS/WhatsApp-koppeling zelf komt later; dit slaat alleen de voorkeur op.)
// Net geregistreerd, nog geen (of nog niet goedgekeurd) adverteerdersprofiel
// ingediend? Dan alsnog toegang tot Instellingen, maar met beperkte
// functionaliteit (alleen e-mailadres + taal — geen telefoonnummer/2FA, dat
// bestaat pas na het invullen van het adverteerdersgegevens-formulier). Enkel
// een reeds ingediend-maar-nog-niet-goedgekeurd profiel (pending/rejected)
// stuurt nog door naar /account/verify, zoals al het geval was.
router.get('/account/settings', requireAuth, (req, res) => {
  const profile = getProfile(req.user.id);
  if (profile && profile.status !== 'approved') {
    return res.redirect(withLocale(res, '/account/verify'));
  }
  res.render('account-settings', {
    title: 'account_settings.title', countries: COUNTRIES, profile, email: req.user.email,
    twoFactorEnabled: !!req.user.two_factor_enabled,
    error: null, saved: false, verificationLink: null, phoneCodeSent: false, phoneMockCode: null, query: req.query,
    passwordSaved: req.query.password_saved === '1', passwordError: null,
    languageSaved: req.query.language_saved === '1',
  });
});

// Los van de grote instellingen-POST hieronder (die e-mail/telefoon opnieuw
// valideert) — de taalkeuze heeft daar niets mee te maken en moet meteen
// zichtbaar zijn in de nieuw gekozen taal. Vandaar een redirect (geen
// render): de daaropvolgende GET leest de net opgeslagen voorkeur vers uit de
// database via useAccountLocale, dus de pagina (incl. "Opgeslagen.") komt
// meteen in de juiste taal terug — een render binnen dezelfde request zou nog
// de oude taal tonen, omdat res.locals.t al aan het begin van de request is
// vastgezet.
router.post('/account/settings/language', requireAuth, (req, res) => {
  const preferredLanguage = SUPPORTED_LOCALES.includes(req.body.preferred_language) ? req.body.preferred_language : req.user.preferred_language;
  db.prepare('UPDATE users SET preferred_language = ? WHERE id = ?').run(preferredLanguage, req.user.id);
  res.redirect('/account/settings?language_saved=1');
});

router.post('/account/settings/password', requireAuth, (req, res) => {
  const profile = getProfile(req.user.id);
  if (profile && profile.status !== 'approved') {
    return res.redirect(withLocale(res, '/account/verify'));
  }

  const { current_password, new_password, confirm_password } = req.body;
  const result = changePassword(req.user.id, current_password, new_password, confirm_password);
  if (!result.ok) {
    return res.status(400).render('account-settings', {
      title: 'account_settings.title', countries: COUNTRIES, profile, email: req.user.email,
      twoFactorEnabled: !!req.user.two_factor_enabled,
      error: null, saved: false, verificationLink: null, phoneCodeSent: false, phoneMockCode: null, query: {},
      passwordSaved: false, passwordError: `account_settings.password.error.${result.error}`,
    });
  }

  res.redirect(withLocale(res, '/account/settings?password_saved=1'));
});

router.post('/account/settings', requireAuth, async (req, res) => {
  const profile = getProfile(req.user.id);
  if (profile && profile.status !== 'approved') {
    return res.redirect(withLocale(res, '/account/verify'));
  }

  const b = req.body;
  const fail = (message) => res.status(400).render('account-settings', {
    title: 'account_settings.title', countries: COUNTRIES, profile: profile ? { ...profile, ...b } : null, email: b.email || req.user.email,
    twoFactorEnabled: !!req.user.two_factor_enabled,
    error: message, saved: false, verificationLink: null, phoneCodeSent: false, phoneMockCode: null, query: {},
  });

  const newEmail = (b.email || '').toLowerCase().trim();
  if (!newEmail || !EMAIL_RE.test(newEmail)) return fail('account_settings.error.invalid_email');
  if (newEmail !== req.user.email) {
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.user.id);
    if (taken) return fail('account_settings.error.email_taken');
  }

  const emailChanged = newEmail !== req.user.email;
  let verificationLink = null;
  if (emailChanged) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(newEmail, req.user.id);
    verificationLink = issueVerificationEmail(req, req.user.id);
  }

  // Telefoon/2FA bestaan pas na het adverteerdersgegevens-formulier (dat is
  // waar advertiser_profiles ontstaat) — een net geregistreerde gebruiker
  // zonder profiel heeft hier dus simpelweg niets in te vullen/wijzigen.
  let phoneCodeSent = false;
  let phoneMockCode = null;
  let twoFactorEnabled = req.user.two_factor_enabled ? 1 : 0;

  if (profile) {
    const phoneNumber = parsePhoneNumber(b.phone_code, b.phone_number);
    if (!phoneNumber) return fail('account_settings.error.invalid_phone');

    const phoneData = {
      user_id: req.user.id,
      phone_code: b.phone_code,
      phone_number: phoneNumber,
    };
    const numberChanged = phoneChanged(profile, phoneData);
    phoneData.phone_verified_at = numberChanged ? null : profile.phone_verified_at;

    db.prepare(`
      UPDATE advertiser_profiles SET
        phone_code=@phone_code, phone_number=@phone_number,
        phone_verified_at=@phone_verified_at, updated_at=datetime('now')
      WHERE user_id=@user_id
    `).run(phoneData);

    // Nummer gewijzigd -> automatisch een nieuwe verificatiecode sturen naar het
    // nieuwe nummer, net als bij een e-mailwijziging hierboven.
    if (numberChanged) {
      try {
        const code = await sendPhoneVerificationCode(phoneData);
        phoneCodeSent = true;
        if (messaging.MESSAGING_PROVIDER === 'mock') phoneMockCode = code;
      } catch (err) {
        console.error('SMS-verificatiecode (automatisch) versturen mislukt:', err.message);
        verificationFailures.recordFailure(req.user.id, 'sms', !!req.user.email_verified_at);
      }
    }

    // Only the dedicated toggle form (marked via settings_form) is allowed to
    // change two_factor_enabled — the main save form has no checkbox for it at
    // all, and an *unchecked* checkbox is simply absent from form data, so
    // without this marker every main-form save would read as "turn 2FA off".
    // If the number just changed above, phone_verified_at is NULL, which always
    // forces 2FA back off until they re-verify, regardless of which form posted.
    if (!phoneData.phone_verified_at) {
      twoFactorEnabled = 0;
    } else if (req.body.settings_form === 'toggle-2fa') {
      twoFactorEnabled = req.body.two_factor_enabled === 'on' ? 1 : 0;
    }
    db.prepare('UPDATE users SET two_factor_enabled = ? WHERE id = ?').run(twoFactorEnabled, req.user.id);
  }

  res.render('account-settings', {
    title: 'account_settings.title', countries: COUNTRIES, profile: getProfile(req.user.id), email: newEmail,
    twoFactorEnabled: !!twoFactorEnabled,
    error: null, saved: true, verificationLink, phoneCodeSent, phoneMockCode, query: {},
  });
});

// ---- Telefoon-OTP: code versturen / bevestigen (gebruikt door zowel de
// verificatiepagina als instellingen — redirect terug naar waar 'm vandaan kwam) --
router.post('/account/verify/phone/send', requireAuth, async (req, res) => {
  const profile = getProfile(req.user.id);
  const back = (req.get('referer') || withLocale(res, '/account/verify')).split('?')[0];
  if (!profile) return res.redirect(back);

  // Wait for the actual send result instead of firing-and-forgetting — a
  // failed send must not show "code sent, check your phone" to the user.
  let code;
  try {
    code = await sendPhoneVerificationCode(profile);
  } catch (err) {
    console.error('SMS-verificatiecode versturen mislukt:', err.message);
    verificationFailures.recordFailure(req.user.id, 'sms', !!req.user.email_verified_at);
    return res.redirect(`${back}?phone_send_failed=1`);
  }

  const mockParam = messaging.MESSAGING_PROVIDER === 'mock' ? `&mock_code=${code}` : '';
  res.redirect(`${back}?phone_code_sent=1${mockParam}`);
});

router.post('/account/verify/phone/confirm', requireAuth, (req, res) => {
  const profile = getProfile(req.user.id);
  const back = (req.get('referer') || withLocale(res, '/account/verify')).split('?')[0];
  if (!profile) return res.redirect(back);

  const code = (req.body.code || '').trim();
  const valid =
    profile.phone_verification_code &&
    code === profile.phone_verification_code &&
    profile.phone_verification_expires &&
    new Date(`${profile.phone_verification_expires}Z`) > new Date();

  if (!valid) return res.redirect(`${back}?phone_code_invalid=1`);

  db.prepare(`
    UPDATE advertiser_profiles
    SET phone_verified_at = datetime('now'), phone_verification_code = NULL, phone_verification_expires = NULL
    WHERE user_id = ?
  `).run(req.user.id);
  verificationFailures.resolveFailures(req.user.id, 'sms');

  res.redirect(`${back}?phone_verified=1`);
});

module.exports = router;
