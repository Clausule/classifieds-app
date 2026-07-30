// Statische informatie-/beleidspagina's, aangeleverd als los Word-document
// ("Over Quickie.docx") met 6 teksten. Eén bron hier, gerenderd via
// routes/pages.js + views/content-page.ejs en gelinkt vanuit de footer.
//
// Alle tekstvelden zijn i18n-keys (locales/nl.json + locales/en.json),
// vertaald via t() in content-page.ejs / routes/pages.js — niet de
// letterlijke tekst zelf, zodat /en/... pagina's ook echt Engels renderen.
//
// content-page.ejs verwacht per block: {type:'p', textKey}, {type:'h2', textKey},
// {type:'ul', itemKeys:[...]}, {type:'ul-links', items:[{labelKey,href}]} of
// {type:'lines', itemKeys:[...]} (losse regels binnen één blok, bv. een adres).
//
// footerGroup groepeert de footer-links in kolommen (partials/footer.ejs).

module.exports = [
  {
    slug: 'over-quickie',
    navLabelKey: 'legal.over_quickie.nav_label',
    footerGroup: 'Quickie.nu',
    metaTitleKey: 'legal.over_quickie.meta_title',
    metaDescriptionKey: 'legal.over_quickie.meta_description',
    blocks: [
      { type: 'p', textKey: 'legal.over_quickie.intro' },
      { type: 'h2', textKey: 'legal.over_quickie.h2_role' },
      { type: 'p', textKey: 'legal.over_quickie.role_p1' },
      { type: 'p', textKey: 'legal.over_quickie.role_p2' },
      { type: 'h2', textKey: 'legal.over_quickie.h2_more_info' },
      { type: 'p', textKey: 'legal.over_quickie.more_info_p' },
      {
        type: 'ul-links',
        items: [
          { labelKey: 'legal.privacybeleid.nav_label', href: '/privacybeleid' },
          { labelKey: 'legal.verificatiebeleid.nav_label', href: '/verificatiebeleid' },
          { labelKey: 'legal.meldprocedure.nav_label', href: '/meldprocedure' },
          { labelKey: 'legal.veilig_afspreken.nav_label', href: '/veilig-afspreken' },
        ],
      },
      // Placeholder-waarden — invullen zodra bekend, zie GO-LIVE.md ("vóór de
      // vlag omgaat").
      { type: 'h2', textKey: 'legal.over_quickie.h2_company' },
      {
        type: 'lines',
        itemKeys: [
          'legal.over_quickie.company_lines.brand',
          'legal.over_quickie.company_lines.kvk',
          'legal.over_quickie.company_lines.vat',
          'legal.over_quickie.company_lines.email',
        ],
      },
    ],
  },
  {
    slug: 'verificatiebeleid',
    navLabelKey: 'legal.verificatiebeleid.nav_label',
    footerGroup: 'Beleid',
    metaTitleKey: 'legal.verificatiebeleid.meta_title',
    metaDescriptionKey: 'legal.verificatiebeleid.meta_description',
    blocks: [
      { type: 'p', textKey: 'legal.verificatiebeleid.intro' },
      { type: 'h2', textKey: 'legal.verificatiebeleid.h2_what' },
      { type: 'p', textKey: 'legal.verificatiebeleid.what_intro' },
      {
        type: 'ul',
        itemKeys: [
          'legal.verificatiebeleid.item_identity',
          'legal.verificatiebeleid.item_age',
          'legal.verificatiebeleid.item_email',
          'legal.verificatiebeleid.item_phone',
        ],
      },
      { type: 'p', textKey: 'legal.verificatiebeleid.age_note' },
      { type: 'h2', textKey: 'legal.verificatiebeleid.h2_review' },
      { type: 'p', textKey: 'legal.verificatiebeleid.review_p' },
      { type: 'h2', textKey: 'legal.verificatiebeleid.h2_no_guarantee' },
      { type: 'p', textKey: 'legal.verificatiebeleid.no_guarantee_p1' },
      { type: 'p', textKey: 'legal.verificatiebeleid.no_guarantee_p2' },
    ],
  },
  {
    slug: 'privacybeleid',
    navLabelKey: 'legal.privacybeleid.nav_label',
    footerGroup: 'Beleid',
    metaTitleKey: 'legal.privacybeleid.meta_title',
    metaDescriptionKey: 'legal.privacybeleid.meta_description',
    blocks: [
      { type: 'h2', textKey: 'legal.privacybeleid.h2_privacy' },
      { type: 'p', textKey: 'legal.privacybeleid.privacy_p' },
      { type: 'h2', textKey: 'legal.privacybeleid.h2_what_data' },
      { type: 'p', textKey: 'legal.privacybeleid.what_data_intro' },
      {
        type: 'ul',
        itemKeys: [
          'legal.privacybeleid.data_name',
          'legal.privacybeleid.data_email',
          'legal.privacybeleid.data_phone',
          'legal.privacybeleid.data_dob',
          'legal.privacybeleid.data_id',
          'legal.privacybeleid.data_selfie',
          'legal.privacybeleid.data_payment',
          'legal.privacybeleid.data_ip',
        ],
      },
      { type: 'h2', textKey: 'legal.privacybeleid.h2_why' },
      { type: 'p', textKey: 'legal.privacybeleid.why_intro' },
      {
        type: 'ul',
        itemKeys: [
          'legal.privacybeleid.why_account',
          'legal.privacybeleid.why_verify',
          'legal.privacybeleid.why_publish',
          'legal.privacybeleid.why_abuse',
          'legal.privacybeleid.why_legal',
        ],
      },
      { type: 'h2', textKey: 'legal.privacybeleid.h2_retention' },
      { type: 'p', textKey: 'legal.privacybeleid.retention_p1' },
      { type: 'p', textKey: 'legal.privacybeleid.retention_p2' },
      { type: 'h2', textKey: 'legal.privacybeleid.h2_sharing' },
      { type: 'p', textKey: 'legal.privacybeleid.sharing_p1' },
      { type: 'p', textKey: 'legal.privacybeleid.sharing_p2' },
      { type: 'h2', textKey: 'legal.privacybeleid.h2_rights' },
      { type: 'p', textKey: 'legal.privacybeleid.rights_p' },
    ],
  },
  {
    slug: 'meldprocedure',
    navLabelKey: 'legal.meldprocedure.nav_label',
    footerGroup: 'Beleid',
    metaTitleKey: 'legal.meldprocedure.meta_title',
    metaDescriptionKey: 'legal.meldprocedure.meta_description',
    blocks: [
      { type: 'p', textKey: 'legal.meldprocedure.intro' },
      { type: 'h2', textKey: 'legal.meldprocedure.h2_report' },
      { type: 'p', textKey: 'legal.meldprocedure.report_p1' },
      { type: 'p', textKey: 'legal.meldprocedure.report_p2' },
      { type: 'h2', textKey: 'legal.meldprocedure.h2_what_we_do' },
      { type: 'p', textKey: 'legal.meldprocedure.what_we_do_p1' },
      { type: 'p', textKey: 'legal.meldprocedure.what_we_do_p2' },
      {
        type: 'ul',
        itemKeys: [
          'legal.meldprocedure.action_remove',
          'legal.meldprocedure.action_offline',
          'legal.meldprocedure.action_request_info',
        ],
      },
      { type: 'h2', textKey: 'legal.meldprocedure.h2_abuse' },
      { type: 'p', textKey: 'legal.meldprocedure.abuse_p' },
    ],
  },
  {
    slug: 'cookiebeleid',
    navLabelKey: 'legal.cookiebeleid.nav_label',
    footerGroup: 'Beleid',
    metaTitleKey: 'legal.cookiebeleid.meta_title',
    metaDescriptionKey: 'legal.cookiebeleid.meta_description',
    blocks: [
      { type: 'h2', textKey: 'legal.cookiebeleid.h2_cookies' },
      { type: 'p', textKey: 'legal.cookiebeleid.cookies_p' },
      { type: 'h2', textKey: 'legal.cookiebeleid.h2_which' },
      { type: 'p', textKey: 'legal.cookiebeleid.which_intro' },
      {
        type: 'ul',
        itemKeys: [
          'legal.cookiebeleid.cookie_necessary',
          'legal.cookiebeleid.cookie_analytics',
          'legal.cookiebeleid.cookie_functional',
        ],
      },
      { type: 'p', textKey: 'legal.cookiebeleid.consent_p' },
      { type: 'h2', textKey: 'legal.cookiebeleid.h2_delete' },
      { type: 'p', textKey: 'legal.cookiebeleid.delete_p' },
    ],
  },
  {
    slug: 'veilig-afspreken',
    navLabelKey: 'legal.veilig_afspreken.nav_label',
    footerGroup: 'Quickie.nu',
    metaTitleKey: 'legal.veilig_afspreken.meta_title',
    metaDescriptionKey: 'legal.veilig_afspreken.meta_description',
    blocks: [
      { type: 'p', textKey: 'legal.veilig_afspreken.intro' },
      { type: 'h2', textKey: 'legal.veilig_afspreken.h2_check_listing' },
      { type: 'p', textKey: 'legal.veilig_afspreken.check_listing_p' },
      { type: 'h2', textKey: 'legal.veilig_afspreken.h2_clear_agreements' },
      { type: 'p', textKey: 'legal.veilig_afspreken.clear_agreements_p' },
      { type: 'h2', textKey: 'legal.veilig_afspreken.h2_no_unnecessary_data' },
      { type: 'p', textKey: 'legal.veilig_afspreken.no_unnecessary_data_p' },
      { type: 'h2', textKey: 'legal.veilig_afspreken.h2_trust_gut' },
      { type: 'p', textKey: 'legal.veilig_afspreken.trust_gut_p' },
      { type: 'h2', textKey: 'legal.veilig_afspreken.h2_report_suspicious' },
      { type: 'p', textKey: 'legal.veilig_afspreken.report_suspicious_p' },
    ],
  },
];
