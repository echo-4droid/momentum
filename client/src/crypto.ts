/**
 * Криптомодуль v1 — по побайтовой таблице конверта из idea.md (раздел 4).
 *
 * Конверт (все целые little-endian, заголовок до шифротекста — 42 байта):
 *   magic "MOMO" (4) | version=0x01 | alg_id (1)
 *   | m_kib u32 LE | t | p | salt_len = 16 | nonce_len = 12
 *   | salt (16) | nonce (12) | ciphertext ‖ GCM-тег (16)
 *
 * Зарегистрированные режимы (alg_id), форма заголовка у обоих одинаковая —
 * режим не различим по форме блоба:
 *   0x01 — парольная фраза: Argon2id m = 65536 КиБ, t = 3, p = 1;
 *   0x02 — ключ в ссылке, без KDF: m = t = p = 0, salt — 16 случайных
 *   не используемых байт; ключ 32 байта идёт в AES-256-GCM как есть.
 *
 * AAD = весь заголовок (42 байта). KDF — Argon2id (hash-wasm),
 * шифр — AES-256-GCM (нативный WebCrypto). Фраза и ключ в конверт не входят.
 */

import { argon2id } from 'hash-wasm';

import { base64DecodedLength } from './base64';
import { EFF_LARGE_WORDLIST } from './wordlist';

const HEADER_BYTES = 42;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const GCM_TAG_BITS = 128;

const MAGIC = new Uint8Array([0x4d, 0x4f, 0x4d, 0x4f]); // ASCII "MOMO"

const V1_VERSION = 0x01;

/** Режимы передачи ключа: фраза + Argon2id или готовый ключ в ссылке без KDF. */
const ALG_PHRASE = 0x01; // AES-256-GCM поверх ключа из Argon2id
const ALG_LINK_KEY = 0x02; // AES-256-GCM поверх ключа как есть

interface KdfParams {
  mKib: number;
  t: number;
  p: number;
}

/** Зарегистрированные наборы параметров v1; парсер принимает только эти значения. */
const PHRASE_PARAMS: KdfParams = { mKib: 65536, t: 3, p: 1 };
const LINK_KEY_PARAMS: KdfParams = { mKib: 0, t: 0, p: 0 };
const PARAMS_BY_ALG = new Map<number, KdfParams>([
  [ALG_PHRASE, PHRASE_PARAMS],
  [ALG_LINK_KEY, LINK_KEY_PARAMS],
]);

export const MAX_TEXT_CHARS = 10_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Лимит шифроблоба на сервере (idea.md, раздел 5). */
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

const WORDS_PER_PHRASE = 8;
const WORD_SEPARATOR = '-';

export interface FilePayload {
  name: string;
  mime: string;
  /** содержимое файла в base64 */
  data: string;
}

/** Таймеры показа у получателя; задаются создателем, шифруются вместе с содержимым. */
export interface ViewSettings {
  /** Скрыть содержимое через N секунд после расшифровки; 0 — выключено. */
  hideAfterSeconds: number;
  /** Удалить содержимое со страницы через N минут; 0 — выключено. */
  destroyAfterMinutes: number;
}

export interface Payload {
  text?: string;
  file?: FilePayload;
  /** Отсутствует — таймеры выключены. */
  view?: ViewSettings;
}

const MAX_HIDE_SECONDS = 3600;
const MAX_DESTROY_MINUTES = 7 * 24 * 60;

function isCounter(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * WebCrypto и Blob типизированы под ArrayBuffer-бэкед массивы; в рантайме
 * Uint8Array подходит как есть — функция только выравнивает типы без копий.
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as Uint8Array<ArrayBuffer>;
}

/** Все ошибки криптомодуля; наружу отдаются без деталей. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/** Нормализация ввода перед KDF: trim → NFKC (idea.md, раздел 4). */
export function normalizePassphrase(phrase: string): string {
  return phrase.trim().normalize('NFKC');
}

const WORD_ENTROPY_BITS = Math.log2(EFF_LARGE_WORDLIST.length); // ≈ 12.9 бита за слово из списка
const EFF_WORD_SET = new Set(EFF_LARGE_WORDLIST);

/**
 * Грубая оценка энтропии фразы в битах — для предупреждения при ослаблении.
 * Фраза из ≥2 слов (дефисы/пробелы): слово из EFF-списка даёт ~12.9 бита,
 * прочее — длина × 6.5 бита; без разделителей — перебор по классам символов.
 * Прогоны ≥3 одинаковых символов схлопываются до одного («aaaa…» не длиннее «a»).
 * Оценка эвристическая, занижать не обязана; алфавитные последовательности
 * («abcdefgh…») остаются слепым пятном.
 */
export function estimatePhraseEntropy(phrase: string): number {
  const normalized = normalizePassphrase(phrase).replace(/(.)\1{2,}/g, '$1');
  if (normalized.length === 0) {
    return 0;
  }
  const words = normalized.split(/[-\s]+/).filter(Boolean);
  if (words.length >= 2) {
    return words.reduce((sum, w) => sum + (EFF_WORD_SET.has(w) ? WORD_ENTROPY_BITS : w.length * 6.5), 0);
  }
  let pool = 0;
  if (/[a-z]/.test(normalized)) pool += 26;
  if (/[A-Z]/.test(normalized)) pool += 26;
  if (/[0-9]/.test(normalized)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(normalized)) pool += 33;
  return normalized.length * Math.log2(pool);
}

/** 8 слов EFF large wordlist через CSPRNG с reject-семплированием. */
export function generatePassphrase(): string {
  const count = EFF_LARGE_WORDLIST.length;
  const limit = Math.floor(65536 / count) * count; // кратная граница против смещения
  const buf = new Uint16Array(1);
  const words: string[] = [];
  for (let i = 0; i < WORDS_PER_PHRASE; i++) {
    let index: number;
    do {
      crypto.getRandomValues(buf);
      index = buf[0] as number;
    } while (index >= limit);
    words.push(EFF_LARGE_WORDLIST[index % count] as string);
  }
  return words.join(WORD_SEPARATOR);
}

/** 32 случайных байта для режима «ключ в ссылке» (alg_id 0x02, без KDF). */
export function generateLinkKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export async function encrypt(payload: Payload, phraseOrKey: string | Uint8Array): Promise<Uint8Array> {
  validatePayloadLimits(payload);

  if (!(typeof phraseOrKey === 'string' || phraseOrKey instanceof Uint8Array)) {
    throw new CryptoError('BAD_KEY');
  }
  const usePhrase = typeof phraseOrKey === 'string';
  if (!usePhrase && phraseOrKey.length !== KEY_BYTES) {
    throw new CryptoError('BAD_KEY');
  }

  const algId = usePhrase ? ALG_PHRASE : ALG_LINK_KEY;
  const salt = randomBytes(SALT_BYTES); // в режиме 0x02 лежит в заголовке, но не используется
  const nonce = randomBytes(NONCE_BYTES);
  const header = buildHeader(algId, salt, nonce);

  const key = usePhrase ? await deriveKey(phraseOrKey, salt) : (phraseOrKey as Uint8Array);
  const cryptoKey = await crypto.subtle.importKey('raw', asBufferSource(key), 'AES-GCM', false, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(header),
        tagLength: GCM_TAG_BITS,
      },
      cryptoKey,
      asBufferSource(plaintext),
    ),
  );

  const blob = new Uint8Array(HEADER_BYTES + ciphertext.length);
  blob.set(header, 0);
  blob.set(ciphertext, HEADER_BYTES);
  if (blob.length > MAX_BLOB_BYTES) {
    throw new CryptoError('BLOB_TOO_LARGE');
  }
  return blob;
}

export async function decrypt(blob: Uint8Array, phraseOrKey: string | Uint8Array): Promise<Payload> {
  if (blob.length < HEADER_BYTES + TAG_BYTES) {
    throw new CryptoError('BAD_LENGTH');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new CryptoError('BAD_MAGIC');
    }
  }
  // Значения сверяются с зарегистрированными наборами v1: произвольные не принимаются.
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const header = {
    version: blob[4] as number,
    algId: blob[5] as number,
    mKib: view.getUint32(6, true),
    t: blob[10] as number,
    p: blob[11] as number,
    saltLen: blob[12] as number,
    nonceLen: blob[13] as number,
  };
  const params = PARAMS_BY_ALG.get(header.algId);
  if (
    header.version !== V1_VERSION ||
    params === undefined ||
    header.mKib !== params.mKib ||
    header.t !== params.t ||
    header.p !== params.p ||
    header.saltLen !== SALT_BYTES ||
    header.nonceLen !== NONCE_BYTES
  ) {
    throw new CryptoError('UNSUPPORTED_PARAMS');
  }

  const salt = blob.slice(14, 30);
  const nonce = blob.slice(30, HEADER_BYTES);
  // Режим берётся из alg_id заголовка; тип входа обязан ему соответствовать.
  let key: Uint8Array;
  if (header.algId === ALG_PHRASE) {
    if (typeof phraseOrKey !== 'string') {
      throw new CryptoError('BAD_KEY');
    }
    key = await deriveKey(phraseOrKey, salt);
  } else {
    // Режим 0x02: ключ из ссылки используется как есть, KDF нет.
    if (!(phraseOrKey instanceof Uint8Array) || phraseOrKey.length !== KEY_BYTES) {
      throw new CryptoError('BAD_KEY');
    }
    key = phraseOrKey;
  }
  const cryptoKey = await crypto.subtle.importKey('raw', asBufferSource(key), 'AES-GCM', false, ['decrypt']);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(blob.slice(0, HEADER_BYTES)),
        tagLength: GCM_TAG_BITS,
      },
      cryptoKey,
      asBufferSource(blob.subarray(HEADER_BYTES)),
    );
  } catch {
    // Неверная фраза или повреждённые данные — наружу деталей не отдаём.
    throw new CryptoError('DECRYPT_FAILED');
  }

  try {
    return parsePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new CryptoError('BAD_PAYLOAD');
  }
}

function buildHeader(algId: number, salt: Uint8Array, nonce: Uint8Array): Uint8Array {
  const params = PARAMS_BY_ALG.get(algId);
  if (params === undefined) {
    throw new CryptoError('UNSUPPORTED_PARAMS');
  }
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[4] = V1_VERSION;
  header[5] = algId;
  new DataView(header.buffer).setUint32(6, params.mKib, true);
  header[10] = params.t;
  header[11] = params.p;
  header[12] = SALT_BYTES;
  header[13] = NONCE_BYTES;
  header.set(salt, 14);
  header.set(nonce, 30);
  return header;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const password = new TextEncoder().encode(normalizePassphrase(passphrase));
  if (password.length === 0) {
    throw new CryptoError('EMPTY_PASSPHRASE');
  }
  return (await argon2id({
    password,
    salt,
    parallelism: PHRASE_PARAMS.p,
    iterations: PHRASE_PARAMS.t,
    memorySize: PHRASE_PARAMS.mKib,
    hashLength: KEY_BYTES,
    outputType: 'binary',
  })) as Uint8Array;
}

function parsePayload(raw: unknown): Payload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CryptoError('BAD_PAYLOAD');
  }
  const source = raw as Record<string, unknown>;
  const payload: Payload = {};
  if (source.text !== undefined) {
    if (typeof source.text !== 'string') {
      throw new CryptoError('BAD_PAYLOAD');
    }
    payload.text = source.text;
  }
  if (source.file !== undefined) {
    const file = source.file as Record<string, unknown> | null;
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.name !== 'string' ||
      typeof file.mime !== 'string' ||
      typeof file.data !== 'string'
    ) {
      throw new CryptoError('BAD_PAYLOAD');
    }
    payload.file = { name: file.name, mime: file.mime, data: file.data };
  }
  if (source.view !== undefined) {
    const view = source.view as Record<string, unknown> | null;
    if (
      typeof view !== 'object' ||
      view === null ||
      !isCounter(view.hideAfterSeconds, MAX_HIDE_SECONDS) ||
      !isCounter(view.destroyAfterMinutes, MAX_DESTROY_MINUTES)
    ) {
      throw new CryptoError('BAD_PAYLOAD');
    }
    payload.view = {
      hideAfterSeconds: view.hideAfterSeconds as number,
      destroyAfterMinutes: view.destroyAfterMinutes as number,
    };
  }
  if (payload.text === undefined && payload.file === undefined) {
    throw new CryptoError('BAD_PAYLOAD');
  }
  return payload;
}

function validatePayloadLimits(payload: Payload): void {
  if (payload.text !== undefined && payload.text.length > MAX_TEXT_CHARS) {
    throw new CryptoError('TEXT_TOO_LONG');
  }
  if (payload.file && base64DecodedLength(payload.file.data) > MAX_FILE_BYTES) {
    throw new CryptoError('FILE_TOO_LARGE');
  }
  if (payload.view !== undefined) {
    const { hideAfterSeconds, destroyAfterMinutes } = payload.view;
    if (!isCounter(hideAfterSeconds, MAX_HIDE_SECONDS) || !isCounter(destroyAfterMinutes, MAX_DESTROY_MINUTES)) {
      throw new CryptoError('BAD_PAYLOAD');
    }
  }
  if (payload.text === undefined && payload.file === undefined) {
    throw new CryptoError('EMPTY_PAYLOAD');
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
