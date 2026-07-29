require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { loadUser } = require('./middleware/auth');
const { loadLocale } = require('./middleware/i18n');
const { requireAgeConfirmed } = require('./middleware/ageGate');
const { SITE_URL, DEFAULT_OG_IMAGE } = require('./utils/seo');
const legalPages = require('./data/legalPages');
const authRoutes = require('./routes/auth');
const ageGateRoutes = require('./routes/ageGate');
const pagesRoutes = require('./routes/pages');
const listingsRoutes = require('./routes/listings');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/payments');
const accountRoutes = require('./routes/account');
const creditsRoutes = require('./routes/credits');
const webhooksRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dagen
      httpOnly: true,
    },
  })
);

app.use(loadLocale);
app.use(loadUser);
app.use((req, res, next) => { res.locals.defaultOgImage = DEFAULT_OG_IMAGE; res.locals.siteUrl = SITE_URL; res.locals.legalPages = legalPages; res.locals.isAdminPage = req.path.startsWith('/admin'); next(); });
app.use('/', ageGateRoutes);
app.use(requireAgeConfirmed);

app.use('/', authRoutes);
app.use('/', pagesRoutes);
app.use('/', dashboardRoutes);
app.use('/', adminRoutes);
app.use('/', paymentsRoutes);
app.use('/', accountRoutes);
app.use('/', creditsRoutes);
app.use('/', webhooksRoutes);
app.use('/', listingsRoutes); // last: contains the /listings/:slug catch-all

// 404 fallback
app.use((req, res) => {
  res.status(404).render('not-found', { title: 'not_found.title' });
});

// Error handler (e.g. multer file-type errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'error.generic.title', message: err.message || 'error.generic.message' });
});

app.listen(PORT, () => {
  console.log(`Classifieds app draait op http://localhost:${PORT}`);
});
