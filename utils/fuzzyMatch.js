function normalize(text) {
  return text
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

// Dice's coefficient over character bigrams: 2 * |shared| / (|A| + |B|), 0..1.
// Handles near-matches (typos, "Oude Pijp" vs "De Pijp") better than a plain
// substring check, without needing an external fuzzy-matching dependency.
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigramsA = bigrams(na);
  const bigramsB = bigrams(nb);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let shared = 0;
  bigramsA.forEach((bg) => {
    if (bigramsB.has(bg)) shared += 1;
  });

  return (2 * shared) / (bigramsA.size + bigramsB.size);
}

// Picks whichever candidate's name is most similar to `query`, as long as it
// clears `threshold` (0..1). Returns null if nothing qualifies.
function bestMatch(query, candidates, getName, threshold = 0.5) {
  let best = null;
  let bestScore = 0;

  candidates.forEach((candidate) => {
    const name = getName(candidate);
    if (!name) return;
    const score = similarity(query, name);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return bestScore >= threshold ? best : null;
}

module.exports = { similarity, bestMatch };
