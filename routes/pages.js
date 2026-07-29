const express = require('express');
const legalPages = require('../data/legalPages');
const { canonicalUrl } = require('../utils/seo');
const { useAccountLocale } = require('../middleware/i18n');

const router = express.Router();

// Deze pagina's zijn publiek (bezoeker: NL/EN via de /en-URL-prefix, zoals
// overal), maar een ingelogde gebruiker die ze via de footer bezoekt krijgt
// ze in zijn eigen accountvoorkeur te zien (alle 5 talen) — useAccountLocale
// is een no-op zolang er geen req.user is, dus bezoekersgedrag blijft
// ongewijzigd.
legalPages.forEach((page) => {
  router.get(`/${page.slug}`, useAccountLocale, (req, res) => {
    const t = res.locals.t;
    res.render('content-page', {
      title: t(page.metaTitleKey),
      metaTitle: t(page.metaTitleKey) + ' — Quickie.nu',
      metaDescription: t(page.metaDescriptionKey),
      canonicalUrl: canonicalUrl(res, `/${page.slug}`),
      page,
    });
  });
});

module.exports = router;
