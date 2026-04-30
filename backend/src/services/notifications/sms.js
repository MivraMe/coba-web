// VoIP.ms SMS provider — messages sans accents (limitation API)
function removeAccents(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

async function sendSms(toPhone, message) {
  const username = process.env.VOIPMS_USERNAME;
  const password = process.env.VOIPMS_PASSWORD;
  const did = process.env.VOIPMS_DID;

  if (!username || !password || !did) {
    console.warn('VoIP.ms non configuré, SMS non envoyé');
    return;
  }

  // Normalize phone to 10 digits NANPA (strip non-digits, remove leading +1 or 1)
  const digits = toPhone.replace(/\D/g, '');
  const dst = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (dst.length !== 10) {
    console.warn(`Numéro invalide pour SMS: ${toPhone}`);
    return;
  }

  const safeMessage = removeAccents(message);
  const params = new URLSearchParams({
    api_username: username,
    api_password: password,
    method: 'sendSMS',
    did,
    dst,
    message: safeMessage,
  });

  const res = await fetch(`https://voip.ms/api/v1/rest.php?${params.toString()}`, {
    signal: AbortSignal.timeout(10000),
  });

  const body = await res.json();
  if (body.status !== 'success') {
    throw new Error(`VoIP.ms erreur: ${body.status}`);
  }
}

module.exports = { sendSms };
