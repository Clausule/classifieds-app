// EMAIL_PROVIDER=mock  -> geen account nodig, logt de e-mail naar de console (standaard).
// EMAIL_PROVIDER=brevo -> echte Brevo API key uit .env (BREVO_API_KEY, BREVO_FROM_EMAIL).
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'mock';

async function sendEmail(to, subject, body) {
  if (EMAIL_PROVIDER === 'brevo') return sendBrevo(to, subject, body);
  return mockSend(to, subject, body);
}

function mockSend(to, subject, body) {
  console.log(`[mock email] naar ${to}: ${subject} — ${body}`);
  return { messageId: null, mocked: true };
}

async function sendBrevo(to, subject, body) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error(
      'BREVO_API_KEY / BREVO_FROM_EMAIL ontbreken in .env. Zet EMAIL_PROVIDER=mock om zonder Brevo-account te testen.'
    );
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: fromEmail },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Brevo API fout (${res.status}): ${errBody}`);
  }

  const result = await res.json();
  return { messageId: result.messageId, mocked: false };
}

module.exports = { EMAIL_PROVIDER, sendEmail };
