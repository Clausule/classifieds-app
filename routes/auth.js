const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const messaging = require('../config/messaging');
const { phoneE164 } = require('../utils/phone');
const { translate, useFormLocale, SUPPORTED_LOCALES } = require('../middleware/i18n');
const { logNotification } = require('../utils/notificationLog');
const { withLocale } = require('../utils/seo');

const router = express.Router();

const TWO_FACTOR_CODE_TTL_MS = 10 * 60 * 1000;

function completeLogin(req, res, user) {
  req.session.userId = user.id;
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(returnTo || withLocale(res, user.role === 'admin' ? '/admin' : '/dashboard'));
}

router.get('/register', useFormLocale, (req, res) => {
  if (req.user) return res.redirect(withLocale(res, '/dashboard'));
  // noindex: /register stond geïndexeerd en verscheen als sitelink onder de
  // merkzoekopdracht. Zelfde meta-tag-methode als de listingpagina's (zie
  // header.ejs), niet de X-Robots-header — één methode voor de hele site.
  res.render('register', { title: 'auth.register.title', error: null, form: {}, noindex: true });
});

router.post('/register', useFormLocale, (req, res) => {
  const { email, password } = req.body;
  // De taal die op het formulier stond bij het versturen (verborgen veld,
  // gevoed door de dropdown) bepaalt eenmalig de accountvoorkeur — niet
  // res.locals.formLocale, want die volgt bij een POST de sessie/query van
  // vóór dit request, terwijl form_lang exact weergeeft wat de gebruiker zag.
  const submittedFormLocale = SUPPORTED_LOCALES.includes(req.body.form_lang) ? req.body.form_lang : res.locals.formLocale;
  // tForm werd door useFormLocale al gebonden aan de oude sessie/query-taal,
  // vóórdat we hier submittedFormLocale (uit het verborgen formulierveld,
  // dus exact wat de gebruiker zag) kennen — opnieuw binden zodat een
  // foutmelding in dezelfde taal verschijnt als het formulier dat verstuurd werd.
  res.locals.formLocale = submittedFormLocale;
  res.locals.tForm = function (key, vars) {
    return translate(submittedFormLocale, key, vars);
  };

  if (!email || !password) {
    return res.status(400).render('register', {
      title: 'auth.register.title',
      error: 'auth.register.error.required',
      form: req.body,
    });
  }
  if (password.length < 8) {
    return res.status(400).render('register', {
      title: 'auth.register.title',
      error: 'auth.register.error.password_length',
      form: req.body,
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(400).render('register', {
      title: 'auth.register.title',
      error: 'auth.register.error.email_taken',
      form: req.body,
    });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  // Registreren is alleen e-mail + wachtwoord — echte naam/telefoon worden pas
  // bij de adverteerdersverificatie verzameld (roepnaam/voornaam/achternaam,
  // telefoonnummers). users.name is enkel nog een interne fallback-label voor
  // vóór er een profiel is, dus afgeleid van het e-mailadres.
  const fallbackName = normalizedEmail.split('@')[0];
  const result = db
    .prepare('INSERT INTO users (email, password_hash, name, preferred_language) VALUES (?, ?, ?, ?)')
    .run(normalizedEmail, passwordHash, fallbackName, submittedFormLocale);

  req.session.userId = result.lastInsertRowid;
  res.redirect(withLocale(res, '/dashboard'));
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(withLocale(res, '/dashboard'));
  res.render('login', { title: 'auth.login.title', error: null, email: '', noindex: true });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(400).render('login', {
      title: 'auth.login.title',
      error: 'auth.login.error.invalid_credentials',
      email,
    });
  }
  if (!user.is_active) {
    return res.status(403).render('login', {
      title: 'auth.login.title',
      error: 'auth.login.error.deactivated',
      email,
    });
  }

  if (user.two_factor_enabled) {
    const profile = db.prepare('SELECT * FROM advertiser_profiles WHERE user_id = ?').get(user.id);
    if (profile && profile.phone_verified_at) {
      const code = String(Math.floor(100000 + Math.random() * 900000));

      // Wait for the actual send result — if it fails, let them try again
      // instead of stranding them on a "check your phone" screen.
      try {
        const smsBody = translate(user.preferred_language, 'messages.login_code', { code });
        await messaging.sendSms(phoneE164(profile), smsBody);
        logNotification(user.id, 'sms', smsBody);
      } catch (err) {
        console.error('SMS-inlogcode versturen mislukt:', err.message);
        return res.status(500).render('login', {
          title: 'auth.login.title',
          error: 'auth.login.error.sms_failed',
          email,
        });
      }

      req.session.twoFactor = { userId: user.id, code, expiresAt: Date.now() + TWO_FACTOR_CODE_TTL_MS };
      return res.render('login-2fa', {
        title: 'auth.login2fa.title',
        error: null,
        mockCode: messaging.MESSAGING_PROVIDER === 'mock' ? code : null,
      });
    }
  }

  completeLogin(req, res, user);
});

router.get('/login/2fa', (req, res) => {
  if (!req.session.twoFactor) return res.redirect(withLocale(res, '/login'));
  res.render('login-2fa', { title: 'auth.login2fa.title', error: null, mockCode: null });
});

router.post('/login/2fa', (req, res) => {
  const pending = req.session.twoFactor;
  if (!pending) return res.redirect(withLocale(res, '/login'));

  const code = (req.body.code || '').trim();
  if (code !== pending.code || Date.now() > pending.expiresAt) {
    return res.status(400).render('login-2fa', {
      title: 'auth.login2fa.title',
      error: 'auth.login2fa.error.invalid_code',
      mockCode: null,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(pending.userId);
  delete req.session.twoFactor;
  if (!user) return res.redirect(withLocale(res, '/login'));

  completeLogin(req, res, user);
});

// Bewust zonder requireAuth: dit is de bevestigingsknop ÓP de "nog niet
// live"-melding die requireAuth zelf toont, dus die gate zou deze route
// blokkeren voordat hij ooit kan draaien.
router.post('/launch-notify', (req, res) => {
  if (!req.user) return res.redirect(withLocale(res, '/login'));
  db.prepare("UPDATE users SET launch_notify_confirmed_at = datetime('now') WHERE id = ?").run(req.user.id);
  res.redirect(withLocale(res, '/dashboard'));
});

router.post('/logout', (req, res) => {
  // Frontend blijft onafhankelijk van de accountvoorkeur (zie useAccountLocale
  // in middleware/i18n.js) — na uitloggen dus terug naar de nl/en-frontendtaal
  // die tijdens dít bezoek al actief was (res.locals.locale), niet naar
  // user.preferred_language.
  const redirectTo = withLocale(res, '/');

  // Bewust geen req.session.destroy() — dat gooide ook ageConfirmed weg,
  // waardoor de leeftijdscontrole na iedere logout weer verscheen. Alleen de
  // inlog-gerelateerde sessievelden opruimen; loadUser behandelt het
  // ontbreken van session.userId al als uitgelogd.
  delete req.session.userId;
  delete req.session.twoFactor;
  delete req.session.returnTo;
  res.redirect(redirectTo);
});

module.exports = router;
