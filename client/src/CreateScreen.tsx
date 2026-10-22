import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createSecret } from './api';
import { BASE_PATH } from './config';
import { bytesToBase64, encodeLinkKey } from './base64';
import {
  CryptoError,
  encrypt,
  generateLinkKey,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  type Payload,
} from './crypto';
import {
  defaultSettings,
  MODE_LABEL,
  SettingsModal,
  TTL_OPTIONS,
  type Settings,
} from './SettingsModal';
import { colors, CopyLink, FileBadge, formatBytes, styles as u } from './ui';

interface PickedFile {
  name: string;
  mime: string;
  data: string;
  size: number;
}

interface CreatedSecret {
  link: string;
  /** null в режиме «ключ в ссылке»: ключ уже внутри ссылки. */
  passphrase: string | null;
}

export default function CreateScreen() {
  const [text, setText] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSecret | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pickFile(domFile: File): void {
    if (domFile.size > MAX_FILE_BYTES) {
      setError('Файл больше 5 МБ.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFile({
        name: domFile.name,
        mime: domFile.type || 'application/octet-stream',
        data: bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)),
        size: domFile.size,
      });
      setError(null);
    };
    reader.onerror = () => setError('Не удалось прочитать файл.');
    reader.readAsArrayBuffer(domFile);
  }

  function openFilePicker(): void {
    // react-native-web не имеет файлового пикера — открываем DOM-инпут.
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.onchange = () => {
        const picked = input.files?.[0];
        if (picked) {
          pickFile(picked);
        }
        input.remove();
      };
      inputRef.current = input;
      document.body.appendChild(input);
    }
    inputRef.current.click();
  }

  async function handleCreate(): Promise<void> {
    setError(null);
    if (!text.trim() && !file) {
      setError('Введите сообщение или прикрепите файл.');
      return;
    }
    setBusy(true);
    try {
      const payload: Payload = {};
      if (text.trim()) {
        payload.text = text;
      }
      if (file) {
        payload.file = { name: file.name, mime: file.mime, data: file.data };
      }
      payload.view = {
        hideAfterSeconds: settings.hideSeconds,
        destroyAfterMinutes: settings.destroyMinutes,
      };

      // Фраза или ключ генерируются локально и никуда не отправляются.
      let passphrase: string | null = null;
      let secret: string | Uint8Array;
      if (settings.mode === 'link') {
        secret = generateLinkKey();
      } else {
        passphrase = settings.passphrase;
        secret = passphrase;
      }
      const blob = await encrypt(payload, secret);
      const id = await createSecret(blob, settings.ttlMinutes, settings.oneTime);
      const link =
        secret instanceof Uint8Array
          ? `${window.location.origin}${BASE_PATH}/s/${id}#${encodeLinkKey(secret)}`
          : `${window.location.origin}${BASE_PATH}/s/${id}`;
      setCreated({ link, passphrase });
    } catch (e) {
      setError(e instanceof CryptoError ? cryptoErrorMessage(e) : 'Не удалось создать секрет. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  function handleReset(): void {
    // «Создать ещё» — чистая форма; настройки пересоздаются с новой фразой.
    setText('');
    setFile(null);
    setCreated(null);
    setError(null);
    setSettings(defaultSettings());
  }

  if (created) {
    return (
      <View style={u.root}>
        <View style={u.content}>
          <Text style={u.logo}>momentum</Text>
          <Text style={u.h1}>Ссылка готова</Text>

          <Text style={u.label}>Ссылка</Text>
          <View style={s.copyField}>
            <Text style={[u.mono, s.copyValue]} numberOfLines={1}>
              {created.link.replace(/^https?:\/\//, '')}
            </Text>
            <View style={s.copyDivider} />
            <CopyLink value={created.link} />
          </View>

          {created.passphrase ? (
            <>
              <Text style={[u.label, s.section]}>Фраза</Text>
              <View style={s.copyField}>
                <Text style={[u.mono, s.copyValue]} numberOfLines={1}>
                  {created.passphrase}
                </Text>
                <View style={s.copyDivider} />
                <CopyLink value={created.passphrase} />
              </View>
              <Text style={[u.hint, s.section]}>
                Передайте фразу другим каналом — не вместе со ссылкой.
              </Text>
            </>
          ) : (
            <Text style={[u.hint, s.section]}>
              Ключ встроен в ссылку: секрет прочитает любой, у кого она окажется, — включая
              мессенджер, облачную синхронизацию и буфер обмена.
            </Text>
          )}

          <Pressable style={s.more} onPress={handleReset} hitSlop={8}>
            <Text style={u.link}>Создать ещё</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const ttlLabel = TTL_OPTIONS.find((o) => o.minutes === settings.ttlMinutes)?.label ?? '';

  return (
    <ScrollView style={u.root} contentContainerStyle={u.content} keyboardShouldPersistTaps="handled">
      <Text style={u.logo}>momentum</Text>
      <Text style={u.h1}>Создать секрет</Text>

      <View style={u.card}>
        <TextInput
          style={s.textarea}
          multiline
          value={text}
          maxLength={MAX_TEXT_CHARS}
          onChangeText={setText}
          placeholder="Сообщение"
          placeholderTextColor={colors.faint}
        />
        {file ? (
          <View style={s.fileRow}>
            <FileBadge name={file.name} />
            <View style={u.fileMeta}>
              <Text style={u.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={u.fileSize}>{formatBytes(file.size)}</Text>
            </View>
            <Pressable onPress={() => setFile(null)} hitSlop={8}>
              <Text style={s.remove}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={s.fileRow} onPress={openFilePicker}>
            <Text style={u.link}>Прикрепить файл</Text>
            <Text style={[u.hint, s.attachHint]}>до 5 МБ, необязательно</Text>
          </Pressable>
        )}
      </View>

      <View style={s.summary}>
        <Text style={u.hint}>{ttlLabel}</Text>
        <Text style={s.dot}>•</Text>
        <Text style={u.hint}>{settings.oneTime ? 'Одно чтение' : 'Несколько чтений'}</Text>
        <Text style={s.dot}>•</Text>
        <Text style={u.hint}>{MODE_LABEL[settings.mode]}</Text>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={6}>
          <Text style={u.link}>Изменить</Text>
        </Pressable>
      </View>

      <Pressable
        style={[u.primary, s.submit, busy && u.primaryDisabled]}
        onPress={handleCreate}
        disabled={busy}
      >
        <Text style={u.primaryText}>{busy ? 'Шифруем…' : 'Создать секрет'}</Text>
      </Pressable>
      {error ? <Text style={u.error}>{error}</Text> : null}

      {settingsOpen ? (
        <SettingsModal
          initial={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            setSettings(next);
            setSettingsOpen(false);
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function cryptoErrorMessage(e: CryptoError): string {
  switch (e.message) {
    case 'TEXT_TOO_LONG':
      return 'Текст длиннее 10 000 символов.';
    case 'FILE_TOO_LARGE':
      return 'Файл больше 5 МБ.';
    case 'BLOB_TOO_LARGE':
      return 'Секрет слишком большой.';
    case 'EMPTY_PAYLOAD':
      return 'Введите сообщение или прикрепите файл.';
    default:
      return 'Не удалось создать секрет. Попробуйте ещё раз.';
  }
}

const s = StyleSheet.create({
  textarea: {
    minHeight: 120,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    textAlignVertical: 'top',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: '#fafafb',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  attachHint: {
    fontSize: 13,
  },
  remove: {
    fontSize: 16,
    color: colors.muted,
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 24,
  },
  dot: {
    fontSize: 14,
    color: colors.faint,
  },
  submit: {
    marginTop: 0,
  },
  section: {
    marginTop: 20,
  },
  copyField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.white,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 14,
    gap: 12,
  },
  copyValue: {
    fontSize: 14,
    color: colors.text,
    flexShrink: 1,
    flexGrow: 1,
  },
  copyDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
  },
  more: {
    marginTop: 28,
    alignSelf: 'flex-start',
  },
});
