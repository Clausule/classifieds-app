const express = require('express');
const legalPages = require('../data/legalPages');
const { canonicalUrl } = require('../utils/seo');

const router = express.Router();

// Deze pagina's zijn publiek en blijven dat ook voor ingelogde gebruikers:
// altijd NL/EN via de /en-URL-prefix, zoals de rest van de frontend — de
// ingelogde omgeving (5 talen, accountvoorkeur) is hier bewust niet van
// toepassing.
legalPages.forEach((page) => {
  router.get(`/${page.slug}`, (req, res) => {
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
