import crypto from 'crypto';

// Encrypts Google Ads refresh tokens before they touch the database.
// A refresh token is effectively a standing key to someone's ad account —
// treat it with the same care as a password, never log it, never store it
// in plaintext.
//
// Requires TOKEN_ENCRYPTION_KEY: a 32-byte hex string.
// Generate one with: openssl rand -hex 32

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be set to a 32-byte hex string (64 hex chars). ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, base64-encoded
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
