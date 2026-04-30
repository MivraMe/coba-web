const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY doit être une chaîne hexadécimale de 64 caractères (openssl rand -hex 32)');
  }
  return Buffer.from(keyHex, 'hex');
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decrypt(ciphertext) {
  const key = getKey();
  const colonIdx = ciphertext.indexOf(':');
  const iv = Buffer.from(ciphertext.slice(0, colonIdx), 'hex');
  const encrypted = ciphertext.slice(colonIdx + 1);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
