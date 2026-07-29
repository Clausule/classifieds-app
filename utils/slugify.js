function slugify(text) {
  return text
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Appends a short random suffix so slugs stay unique even for duplicate titles.
function uniqueSlug(text) {
  const base = slugify(text) || 'listing';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

// Stad-segment voor de publieke listing-URL — 'overig' als er (nog) geen
// locatie is, zodat de URL altijd geldig blijft (geen dubbele slash).
function locationSlug(location) {
  return slugify(location || '') || 'overig';
}

// Canonieke publieke URL van een listing — enige plek waar deze URL wordt
// opgebouwd, zodat route, kaart, breadcrumb, canonical-tag en sitemap altijd
// hetzelfde formaat gebruiken.
function listingPath(listing) {
  return `/listings/${locationSlug(listing.location)}/${listing.slug}`;
}

module.exports = { slugify, uniqueSlug, locationSlug, listingPath };
