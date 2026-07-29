const db = require('../config/database');
const { MARKETPLACE_OPERATIONAL } = require('../utils/seo');
const { touchActivity } = require('../utils/activity');

// Makes the logged-in user (if any) available to every view as `currentUser`.
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db
      .prepare('SELECT id, email, name, phone, role, email_verified_at, credit_balance, two_factor_enabled, launch_notify_confirmed_at, preferred_language FROM users WHERE id = ? AND is_active = 1')
      .get(req.session.userId);
    req.user = user || null;
    // Drives the global "+ Listing plaatsen" header button — once someone has
    // a listing, the page-specific add-button (dashboard) is enough on its own.
    if (req.user && req.user.role !== 'admin') {
      req.user.hasListings = !!db
        .prepare("SELECT 1 FROM listings WHERE user_id = ? AND status != 'deleted' LIMIT 1")
        .get(req.user.id);
      touchActivity(req.user.id);
    }
  } else {
    req.user = null;
  }
  res.locals.currentUser = req.user;
  next();
}

// Vóór MARKETPLACE_OPERATIONAL mag iedereen wel registreren/inloggen, maar
// niet de ingelogde omgeving (dashboard, account, listings-CRUD, credits)
// gebruiken — die is voor bezoekers straks "live", ook al noemen wij dat
// intern "operationeel" (zie CLAUDE.md). Admins zijn uitgezonderd: beheer
// moet deze vooraf-geregistreerde gebruikers al kunnen inzien/beheren.
function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.role !== 'admin' && !MARKETPLACE_OPERATIONAL) {
    return res.render('coming-soon', { title: 'coming_soon.title' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Geen toegang',
      message: 'Je hebt geen rechten om deze pagina te bekijken.',
    });
  }
  next();
}

// A listing may only be created once the advertiser's identity profile is
// both e-mail-verified and approved by an admin — same gate the "+ Listing
// plaatsen" flow relies on. Admins bypass this (they're staff, not advertisers).
function requireVerifiedAdvertiser(req, res, next) {
  if (req.user.role === 'admin') return next();
  const profile = db.prepare('SELECT status FROM advertiser_profiles WHERE user_id = ?').get(req.user.id);
  const verified = !!req.user.email_verified_at && profile && profile.status === 'approved';
  if (!verified) return res.redirect('/account/verify');
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin, requireVerifiedAdvertiser };
