// AI-omschrijvingen voor listings via Google Gemini. Plain fetch, geen SDK —
// zelfde stijl als Mollie/Twilio/Brevo elders in dit project.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

async function generateText(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY ontbreekt in .env.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API fout (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini gaf geen bruikbare tekst terug.');
  return text.trim();
}

module.exports = { generateText };
