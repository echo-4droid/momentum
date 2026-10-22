/**
 * Тесты криптомодуля v1 и base64-хелперов в Node (встроенный test runner):
 * hash-wasm и WebCrypto работают и вне браузера.
 * Запуск: npm test (в client/).
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  Base64Error,
  bytesFromBase64,
  bytesToBase64,
  decodeLinkKey,
  encodeLinkKey,
} from '../src/base64';
import {
  CryptoError,
  decrypt,
  encrypt,
  generateLinkKey,
  generatePassphrase,
  MAX_TEXT_CHARS,
  normalizePassphrase,
  type Payload,
} from '../src/crypto';
import { EFF_LARGE_WORDLIST } from '../src/wordlist';

const HEADER_BYTES = 42;
const TAG_BYTES = 16;

/** Ожидает CryptoError с конкретным кодом (модуль отдаёт наружу только коды). */
async function fails(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (e: unknown) => e instanceof CryptoError && e.message === code, code);
}

describe('generatePassphrase', () => {
  it('по умолчанию даёт 8 слов из EFF large wordlist через дефис', () => {
    const words = generatePassphrase().split('-');
    assert.equal(words.length, 8);
    assert.ok(words.every((w) => EFF_LARGE_WORDLIST.includes(w)));
  });

  it('выбранное число слов соблюдается на границах диапазона', () => {
    assert.equal(generatePassphrase(6).split('-').length, 6);
    assert.equal(generatePassphrase(10).split('-').length, 10);
  });

  it('число слов вне 6–10 отклоняется', () => {
    assert.throws(() => generatePassphrase(5), CryptoError);
    assert.throws(() => generatePassphrase(11), CryptoError);
    assert.throws(() => generatePassphrase(7.5), CryptoError);
  });
});

describe('base64-хелперы', () => {
  it('мусор отклоняется, пустой ввод даёт пустой вывод', () => {
    assert.throws(() => bytesFromBase64('!!'), Base64Error);
    assert.equal(bytesFromBase64('').length, 0);
  });
});

describe('конверт с фразой (alg_id 0x01)', () => {
  const phrase = generatePassphrase();
  const text = 'привет, momentum!';
  let blob!: Uint8Array;

  before(async () => {
    blob = await encrypt({ text }, phrase);
  });

  it('roundtrip текста', async () => {
    assert.equal((await decrypt(blob, phrase)).text, text);
  });

  it('заголовок побайтово: magic, версия, alg_id, параметры Argon2id', () => {
    assert.deepEqual([...blob.subarray(0, 4)], [0x4d, 0x4f, 0x4d, 0x4f]); // ASCII "MOMO"
    assert.equal(blob[4], 0x01); // version
    assert.equal(blob[5], 0x01); // alg_id = фраза + Argon2id
    assert.deepEqual([...blob.subarray(6, 10)], [0x00, 0x00, 0x01, 0x00]); // m_kib = 65536, u32 LE
    assert.equal(blob[10], 3); // t
    assert.equal(blob[11], 1); // p
    assert.equal(blob[12], 16); // salt_len
    assert.equal(blob[13], 12); // nonce_len
    assert.ok(blob.length > HEADER_BYTES + TAG_BYTES); // есть ciphertext ‖ тег
  });

  it('roundtrip текст + файл', async () => {
    const fileBytes = new Uint8Array(1024).map((_, i) => i & 0xff);
    const payload: Payload = await decrypt(
      await encrypt(
        {
          text: 'отчёт во вложении',
          file: { name: 'data.bin', mime: 'application/octet-stream', data: bytesToBase64(fileBytes) },
        },
        phrase,
      ),
      phrase,
    );
    assert.equal(payload.text, 'отчёт во вложении');
    assert.equal(payload.file?.name, 'data.bin');
    assert.equal(payload.file?.mime, 'application/octet-stream');
    assert.deepEqual(bytesFromBase64(payload.file?.data ?? ''), fileBytes);
  });

  it('неверная фраза → DECRYPT_FAILED без деталей', async () => {
    await fails(() => decrypt(blob, `${phrase}-лишнее`), 'DECRYPT_FAILED');
    await fails(() => decrypt(blob, 'совсем-другая-фраза-вообще-не-та'), 'DECRYPT_FAILED');
  });

  it('пустая фраза → EMPTY_PASSPHRASE', async () => {
    await fails(() => decrypt(blob, ''), 'EMPTY_PASSPHRASE');
  });

  it('подмена любого байта заголовка отклоняется (AAD/параметры)', async () => {
    const cases: Array<[number, string]> = [
      [0, 'BAD_MAGIC'],
      [3, 'BAD_MAGIC'],
      [4, 'UNSUPPORTED_PARAMS'], // version
      [5, 'UNSUPPORTED_PARAMS'], // alg_id
      [6, 'UNSUPPORTED_PARAMS'], // m_kib
      [9, 'UNSUPPORTED_PARAMS'], // m_kib
      [10, 'UNSUPPORTED_PARAMS'], // t
      [11, 'UNSUPPORTED_PARAMS'], // p
      [12, 'UNSUPPORTED_PARAMS'], // salt_len
      [13, 'UNSUPPORTED_PARAMS'], // nonce_len
      [14, 'DECRYPT_FAILED'], // соль
      [20, 'DECRYPT_FAILED'], // соль
      [41, 'DECRYPT_FAILED'], // nonce
    ];
    for (const [offset, code] of cases) {
      const tampered = Uint8Array.from(blob);
      tampered[offset] ^= 0x01;
      await fails(() => decrypt(tampered, phrase), code);
    }
  });

  it('произвольные параметры KDF не принимаются (t = 4)', async () => {
    const tampered = Uint8Array.from(blob);
    tampered[10] = 4;
    await fails(() => decrypt(tampered, phrase), 'UNSUPPORTED_PARAMS');
  });

  it('подмена шифротекста или тега → DECRYPT_FAILED (GCM)', async () => {
    const ct = Uint8Array.from(blob);
    ct[HEADER_BYTES] ^= 0x01;
    await fails(() => decrypt(ct, phrase), 'DECRYPT_FAILED');
    const tag = Uint8Array.from(blob);
    tag[tag.length - 1] ^= 0x01;
    await fails(() => decrypt(tag, phrase), 'DECRYPT_FAILED');
  });

  it('обрезанный конверт → BAD_LENGTH, чужой magic → BAD_MAGIC', async () => {
    await fails(() => decrypt(Uint8Array.from(blob.subarray(0, 40)), phrase), 'BAD_LENGTH');
    const noMagic = Uint8Array.from(blob);
    noMagic[0] = 0x58;
    await fails(() => decrypt(noMagic, phrase), 'BAD_MAGIC');
  });

  it('нормализация фразы: trim → NFKC, «грязная» и чистая эквивалентны', async () => {
    const dirty = '  ＭＯＭＥＮＴＵＭ-ｔｅｓｔ-ｐｈｒａｓｅ-ｆｕｌｌｗｉｄｔｈ  ';
    assert.equal(normalizePassphrase(dirty), 'MOMENTUM-test-phrase-fullwidth');
    const small = await encrypt({ text: 'нормализация' }, dirty);
    assert.equal((await decrypt(small, 'MOMENTUM-test-phrase-fullwidth')).text, 'нормализация');
    await fails(() => decrypt(small, `${dirty}x`), 'DECRYPT_FAILED');
  });
});

describe('лимиты payload', () => {
  const phrase = generatePassphrase();

  it('текст длиннее 10 000 символов → TEXT_TOO_LONG', async () => {
    await fails(() => encrypt({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) }, phrase), 'TEXT_TOO_LONG');
  });

  it('файл больше 5 МиБ → FILE_TOO_LARGE', async () => {
    await fails(
      () => encrypt({ file: { name: 'big.bin', mime: 'a/b', data: bytesToBase64(new Uint8Array(5 * 1024 * 1024 + 1)) } }, phrase),
      'FILE_TOO_LARGE',
    );
  });

  it('пустой payload → EMPTY_PAYLOAD', async () => {
    await fails(() => encrypt({}, phrase), 'EMPTY_PAYLOAD');
  });
});

describe('режим «ключ в ссылке» (alg_id 0x02)', () => {
  const linkKey = generateLinkKey();
  const text = 'ключ в ссылке';
  let blob!: Uint8Array;

  before(async () => {
    blob = await encrypt({ text }, linkKey);
  });

  it('ключ — 32 случайных байта', () => {
    assert.equal(linkKey.length, 32);
  });

  it('заголовок: alg_id 0x02 без KDF, salt/nonce тех же размеров', () => {
    assert.equal(blob[4], 0x01); // version
    assert.equal(blob[5], 0x02); // alg_id
    assert.deepEqual([...blob.subarray(6, 10)], [0, 0, 0, 0]); // m_kib = 0
    assert.equal(blob[10], 0); // t
    assert.equal(blob[11], 0); // p
    assert.equal(blob[12], 16); // salt_len (16 случайных байт, не используются)
    assert.equal(blob[13], 12); // nonce_len
  });

  it('roundtrip без KDF', async () => {
    assert.equal((await decrypt(blob, linkKey)).text, text);
  });

  it('ключ не 32 байта отклоняется на входе encrypt → BAD_KEY', async () => {
    await fails(() => encrypt({ text: 'x' }, linkKey.subarray(0, 31)), 'BAD_KEY');
  });
});

describe('base64url ключа ссылки', () => {
  const key = generateLinkKey();
  const encoded = encodeLinkKey(key);

  it('32 байта → 43 символа base64url без паддинга', () => {
    assert.equal(encoded.length, 43);
    assert.match(encoded, /^[A-Za-z0-9_-]{43}$/);
  });

  it('encode → decode roundtrip', () => {
    assert.deepEqual(decodeLinkKey(encoded), key);
  });

  it('мусор, короткая строка и паддинг отклоняются', () => {
    assert.throws(() => decodeLinkKey(`${encoded.slice(0, 42)}!`), Base64Error);
    assert.throws(() => decodeLinkKey(encoded.slice(0, 42)), Base64Error);
    assert.throws(() => decodeLinkKey(`${encoded}=`), Base64Error);
  });
});

describe('смешение режимов', () => {
  const phrase = generatePassphrase();
  const linkKey = generateLinkKey();
  const sameText = 'форма блоба не выдаёт режим';
  let phraseBlob!: Uint8Array;
  let linkBlob!: Uint8Array;

  before(async () => {
    phraseBlob = await encrypt({ text: sameText }, phrase);
    linkBlob = await encrypt({ text: sameText }, linkKey);
  });

  it('чужой 32-байтный ключ на блобе 0x02 → DECRYPT_FAILED', async () => {
    await fails(() => decrypt(linkBlob, generateLinkKey()), 'DECRYPT_FAILED');
  });

  it('строка на блобе 0x02 и ключ на блобе 0x01 → BAD_KEY', async () => {
    await fails(() => decrypt(linkBlob, 'строка-вместо-ключа'), 'BAD_KEY');
    await fails(() => decrypt(phraseBlob, linkKey), 'BAD_KEY');
  });

  it('блобы обоих режимов неразличимы по форме', () => {
    const headerLen = (b: Uint8Array): number => 14 + (b[12] as number) + (b[13] as number);
    assert.equal(phraseBlob.length, linkBlob.length);
    assert.equal(headerLen(phraseBlob), headerLen(linkBlob));
    assert.equal(headerLen(phraseBlob), HEADER_BYTES);
  });
});

describe('настройки показа (view)', () => {
  const phrase = generatePassphrase();

  it('roundtrip таймеров', async () => {
    const view = { hideAfterSeconds: 30, destroyAfterMinutes: 10 };
    const payload = await decrypt(await encrypt({ text: 'с таймерами', view }, phrase), phrase);
    assert.deepEqual(payload.view, view);
  });

  it('без view поле отсутствует', async () => {
    const payload = await decrypt(await encrypt({ text: 'без таймеров' }, phrase), phrase);
    assert.equal(payload.view, undefined);
  });

  it('некорректные значения отклоняются → BAD_PAYLOAD', async () => {
    await fails(
      () => encrypt({ text: 'x', view: { hideAfterSeconds: -1, destroyAfterMinutes: 10 } }, phrase),
      'BAD_PAYLOAD',
    );
    await fails(
      () => encrypt({ text: 'x', view: { hideAfterSeconds: 30, destroyAfterMinutes: 999999 } }, phrase),
      'BAD_PAYLOAD',
    );
    await fails(
      () => encrypt({ text: 'x', view: { hideAfterSeconds: 1.5, destroyAfterMinutes: 10 } }, phrase),
      'BAD_PAYLOAD',
    );
  });
});
