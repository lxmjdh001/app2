const crypto = require('crypto');

function looksHashed(value) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeAndHashPII(value) {
  if (!value) return undefined;
  if (looksHashed(value)) return value.toLowerCase();
  return sha256(normalizeText(value));
}

function normalizeAndHashPhone(value) {
  if (!value) return undefined;
  if (looksHashed(value)) return value.toLowerCase();
  const cleaned = String(value).replace(/[^\d]/g, '');
  if (!cleaned) return undefined;
  return sha256(cleaned);
}

module.exports = {
  normalizeAndHashPII,
  normalizeAndHashPhone
};
