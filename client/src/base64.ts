/**
 * Кодировки блоба при передаче: base64 (файл внутри payload),
 * base64url без паддинга (ключ в ссылке).
 */

export class Base64Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base64Error';
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out +=
      ALPHABET[b0 >> 2] +
      ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)] +
      (b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]) +
      (b2 === undefined ? '=' : ALPHABET[b2 & 0x3f]);
  }
  return out;
}

const REVERSE = (() => {
  const table = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function bytesFromBase64(base64: string): Uint8Array {
  const compact = base64.replace(/\s+/g, '');
  const out = new Uint8Array(Math.floor((compact.length * 3) / 4));
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < compact.length; i++) {
    const code = compact.charCodeAt(i);
    if (code === 0x3d /* = */) {
      // '=' допустим только одним-двумя последними символами.
      if (compact.length - i > 2) {
        throw new Base64Error('BAD_BASE64');
      }
      for (let j = i + 1; j < compact.length; j++) {
        if (compact.charCodeAt(j) !== 0x3d) {
          throw new Base64Error('BAD_BASE64');
        }
      }
      break;
    }
    if (code > 127 || REVERSE[code] === 0xff) {
      throw new Base64Error('BAD_BASE64');
    }
    buffer = (buffer << 6) | REVERSE[code];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** Длина base64-строки в декодированных байтах (для проверки лимита без декодирования). */
export function base64DecodedLength(base64: string): number {
  const compact = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return (compact.length * 3) / 4 - padding;
}

const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Ключ для ссылки: 32 байта → 43 символа base64url без паддинга. */
export function encodeLinkKey(key: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < key.length; i += 3) {
    const b0 = key[i] as number;
    const b1 = key[i + 1];
    const b2 = key[i + 2];
    out += alphabet[b0 >> 2] + alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) {
      out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    }
    if (b2 !== undefined) {
      out += alphabet[b2 & 0x3f];
    }
  }
  return out;
}

/** Строгий разбор ключа из ссылки; 43 валидных символа base64url дают ровно 32 байта. */
export function decodeLinkKey(text: string): Uint8Array {
  if (!BASE64URL_KEY_PATTERN.test(text)) {
    throw new Base64Error('BAD_BASE64');
  }
  return bytesFromBase64(`${text.replace(/-/g, '+').replace(/_/g, '/')}=`);
}
