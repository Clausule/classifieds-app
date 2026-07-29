// MESSAGING_PROVIDER=mock   -> geen Twilio-account nodig, logt verzonden berichten naar de
//                               console. Inkomende WhatsApp-berichten worden gesimuleerd via
//                               Admin -> Support inbox -> WhatsApp-simulator.
// MESSAGING_PROVIDER=twilio -> echte Twilio SMS + WhatsApp Business API (TWILIO_* in .env).
const MESSAGING_PROVIDER = process.env.MESSAGING_PROVIDER || 'mock';

async function sendSms(toE164, body) {
  if (MESSAGING_PROVIDER === 'twilio') return sendTwilio('sms', toE164, body);
  return mockSend('sms', toE164, body);
}

async function sendWhatsApp(toE164, body) {
  if (MESSAGING_PROVIDER === 'twilio') return sendTwilio('whatsapp', toE164, body);
  return mockSend('whatsapp', toE164, body);
}

function mockSend(channel, toE164, body) {
  console.log(`[mock ${channel}] naar ${toE164}: ${body}`);
  return { sid: null, mocked: true };
}

async function sendTwilio(channel, toE164, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = channel === 'whatsapp' ? process.env.TWILIO_WHATSAPP_NUMBER : process.env.TWILIO_SMS_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER / TWILIO_SMS_NUMBER ontbreken in .env. Zet MESSAGING_PROVIDER=mock om zonder Twilio-account te testen.'
    );
  }

  const from = channel === 'whatsapp' ? `whatsapp:${fromNumber}` : fromNumber;
  const to = channel === 'whatsapp' ? `whatsapp:${toE164}` : toE164;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Twilio API fout (${res.status}): ${errBody}`);
  }

  const message = await res.json();
  return { sid: message.sid, mocked: false };
}

module.exports = { MESSAGING_PROVIDER, sendSms, sendWhatsApp };
