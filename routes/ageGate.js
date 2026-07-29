const express = require('express');
const { withLocale } = require('../utils/seo');

const router = express.Router();

router.post('/age-gate/confirm', (req, res) => {
  req.session.ageConfirmed = true;
  const returnTo = req.session.ageGateReturnTo;
  delete req.session.ageGateReturnTo;
  res.redirect(returnTo || withLocale(res, '/'));
});

module.exports = router;
