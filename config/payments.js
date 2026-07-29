// Premium listing pricing. Change these two constants to adjust price/duration everywhere.
const PREMIUM_PRICE_EUR = 5.95;
const PREMIUM_DURATION_HOURS = 24;

// PAYMENT_PROVIDER=mock   -> no Mollie account needed, simulates the same payment
//                            statuses Mollie's own test mode offers (paid/failed/expired/canceled).
// PAYMENT_PROVIDER=mollie -> real Mollie Test or Live API key from .env (MOLLIE_API_KEY).
const PROVIDER = process.env.PAYMENT_PROVIDER || 'mock';

// Creates a payment with the configured provider and returns a checkoutUrl to redirect the
// advertiser to. For 'mock' this is an internal page; for 'mollie' this is Mollie's hosted
// checkout page. `mockPath` lets callers other than the listing-premium flow (e.g. credit
// purchases) point the mock provider at their own local checkout page instead of the default.
async function createCheckout({ paymentId, amount, description, returnUrl, webhookUrl, mockPath }) {
  if (PROVIDER === 'mollie') {
    return createMollieCheckout({ paymentId, amount, description, returnUrl, webhookUrl });
  }
  // Mock provider: no external call, no account needed.
  return { checkoutUrl: mockPath || `/checkout/${paymentId}`, providerPaymentId: null };
}

async function createMollieCheckout({ amount, description, returnUrl, webhookUrl }) {
  const apiKey = process.env.MOLLIE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'MOLLIE_API_KEY ontbreekt in .env. Maak een gratis Mollie-account, kopieer je Test API key, en zet PAYMENT_PROVIDER=mollie.'
    );
  }

  const res = await fetch('https://api.mollie.com/v2/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: { currency: 'EUR', value: amount.toFixed(2) },
      description,
      redirectUrl: returnUrl,
      webhookUrl,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Mollie API fout (${res.status}): ${errBody}`);
  }

  const payment = await res.json();
  return { checkoutUrl: payment._links.checkout.href, providerPaymentId: payment.id };
}

// Used by the webhook / return route to ask Mollie for the current status of a payment.
async function fetchMolliePaymentStatus(providerPaymentId) {
  const apiKey = process.env.MOLLIE_API_KEY;
  const res = await fetch(`https://api.mollie.com/v2/payments/${providerPaymentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Mollie API fout (${res.status})`);
  const payment = await res.json();
  return payment.status; // open, paid, failed, expired, canceled, ...
}

module.exports = {
  PREMIUM_PRICE_EUR,
  PREMIUM_DURATION_HOURS,
  PROVIDER,
  createCheckout,
  fetchMolliePaymentStatus,
};
