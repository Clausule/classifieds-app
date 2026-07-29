// Normalizes a phone number typed in any common notation (00<code>, +<code>,
// or a local 0-prefixed number) down to a bare national significant number,
// given the dial code the user picked from the country dropdown. Returns null
// if the result doesn't look like a plausible phone number.
//
// This is a lightweight sanity check (digit-count range), not a full
// per-country validation table like libphonenumber — good enough to catch
// typos/garbage without needing an external dependency.
function parsePhoneNumber(dialCode, raw) {
  if (!dialCode || !raw) return null;

  let value = raw.trim().replace(/[\s\-().]/g, '');

  if (value.startsWith('00' + dialCode)) {
    value = value.slice(2 + dialCode.length);
  } else if (value.startsWith('+' + dialCode)) {
    value = value.slice(1 + dialCode.length);
  } else if (value.startsWith('+') || value.startsWith('00')) {
    // Number already carries a different country code than the selected one.
    return null;
  }

  value = value.replace(/^0+/, ''); // drop a local trunk prefix (0X... -> X...)

  return /^\d{6,14}$/.test(value) ? value : null;
}

function formatE164(dialCode, nationalNumber) {
  return `+${dialCode}${nationalNumber}`;
}

// The advertiser only has one phone number — used for every sms/WhatsApp
// feature (verification, support, premium-commands) alike.
function phoneE164(profile) {
  return formatE164(profile.phone_code, profile.phone_number);
}

module.exports = { parsePhoneNumber, formatE164, phoneE164 };
