// functions/_shared/totp.js

export function generateTOTPSecret() {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

/**
 * Real RFC 6238 TOTP verification using Web Crypto (HMAC-SHA1).
 * Accepts codes from the previous, current, and next 30-second window.
 */
export async function verifyTOTP(token, secret) {
  if (!token || !secret) return false;
  if (!/^\d{6}$/.test(token)) return false;

  const counter = Math.floor(Date.now() / 30000);
  // Allow ±1 window to handle clock skew
  for (let delta = -1; delta <= 1; delta++) {
    if (await hotp(secret, counter + delta) === token) return true;
  }
  return false;
}

// ── Internals ──────────────────────────────────────────────────────────────

async function hotp(secret, counter) {
  let keyBytes;
  try {
    keyBytes = base32Decode(secret);
  } catch {
    return null;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  // Counter as big-endian 8-byte integer
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  // JS numbers are safe up to 2^53, counter fits in the low 32 bits for decades
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = sig[19] & 0x0f;
  const code =
    (((sig[offset] & 0x7f) << 24) |
      (sig[offset + 1] << 16) |
      (sig[offset + 2] << 8) |
      sig[offset + 3]) %
    1_000_000;

  return code.toString().padStart(6, '0');
}

function base32Encode(buf) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alpha[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alpha[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const c of s) {
    const idx = alpha.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 char: ${c}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes).buffer;
}
