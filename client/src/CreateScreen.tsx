import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createSecret } from './api';
import { bytesToBase64, encodeLinkKey } from './base64';
import { t } from './l10n';
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
import { colors, CopyLink, FadeIn, FileBadge, formatBytes, pressed, styles as u } from './ui';

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
  // Плавное появление/скрытие строки вложения и вспышка при её добавлении.
  const fileOpacity = useRef(new Animated.Value(1)).current;
  const [fileFlash, setFileFlash] = useState(false);
  // Подсветка карточки, пока над страницей тащат файл.
  const [dragOver, setDragOver] = useState(false);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Вспышка поля, из которого только что скопировали данные.
  const [copiedField, setCopiedField] = useState<'link' | 'pass' | null>(null);

  function showFile(next: PickedFile): void {
    setFile(next);
    setFileFlash(true);
    setTimeout(() => setFileFlash(false), 1200);
    fileOpacity.setValue(0);
    Animated.timing(fileOpacity, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  }

  function hideFile(): void {
    Animated.timing(fileOpacity, { toValue: 0, duration: 150, useNativeDriver: false }).start(
      ({ finished }) => {
        if (finished) {
          setFile(null);
          fileOpacity.setValue(0);
          Animated.timing(fileOpacity, { toValue: 1, duration: 200, useNativeDriver: false }).start();
        }
      },
    );
  }

  function flashCopy(which: 'link' | 'pass'): void {
    setCopiedField(which);
    setTimeout(() => setCopiedField(null), 1200);
  }

  function pickFile(domFile: File): void {
    if (domFile.size > MAX_FILE_BYTES) {
      setError(t.create.errors.fileTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      showFile({
        name: domFile.name,
        mime: domFile.type || 'application/octet-stream',
        data: bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)),
        size: domFile.size,
      });
      setError(null);
    };
    reader.onerror = () => setError(t.create.errors.fileReadFailed);
    reader.readAsArrayBuffer(domFile);
  }

  // Ctrl+V и drag-and-drop файла в любое место страницы. pickFile читает только
  // аргумент и сеттеры — пересоздание подписки нужно лишь для экрана «ссылка готова».
  useEffect(() => {
    if (created) return;
    const takeFiles = (list: FileList | null | undefined): boolean => {
      const domFile = list?.[0];
      if (!domFile) return false;
      pickFile(domFile);
      return true;
    };
    const onPaste = (e: ClipboardEvent) => {
      if (takeFiles(e.clipboardData?.files)) e.preventDefault();
    };
    const onDragOver = (e: DragEvent) => {
      // types в старых Safari — DOMStringList без includes.
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      setDragOver(true);
      if (dragTimer.current) clearTimeout(dragTimer.current);
      // dragleave шумит на дочерних элементах — гасим подсветку по таймауту.
      dragTimer.current = setTimeout(() => setDragOver(false), 400);
    };
    const onDrop = (e: DragEvent) => {
      if (dragTimer.current) clearTimeout(dragTimer.current);
      setDragOver(false);
      if (takeFiles(e.dataTransfer?.files)) e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [created]);

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
      setError(t.create.errors.empty);
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
          ? `${window.location.origin}/s/${id}#${encodeLinkKey(secret)}`
          : `${window.location.origin}/s/${id}`;
      setCreated({ link, passphrase });
    } catch (e) {
      setError(e instanceof CryptoError ? cryptoErrorMessage(e) : t.create.errors.generic);
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
        <FadeIn>
          <View style={u.content}>
          <Text style={u.logo}>momentum</Text>
          <Text style={u.h1}>{t.create.ready}</Text>

          <Text style={u.label}>{t.create.link}</Text>
          <View style={[s.copyField, copiedField === 'link' && s.flashField]}>
            <Text style={[u.mono, s.copyValue]} numberOfLines={1}>
              {created.link.replace(/^https?:\/\//, '')}
            </Text>
            <View style={s.copyDivider} />
            <CopyLink value={created.link} onCopied={() => flashCopy('link')} />
          </View>

          {created.passphrase ? (
            <>
              <Text style={[u.label, s.section]}>{t.common.passphrase}</Text>
              <View style={[s.copyField, copiedField === 'pass' && s.flashField]}>
                <Text style={[u.mono, s.copyValue]} numberOfLines={1}>
                  {created.passphrase}
                </Text>
                <View style={s.copyDivider} />
                <CopyLink value={created.passphrase} onCopied={() => flashCopy('pass')} />
              </View>
              <Text style={[u.hint, s.section]}>{t.create.passphraseHint}</Text>
            </>
          ) : (
            <Text style={[u.hint, s.section]}>{t.create.linkKeyHint}</Text>
          )}

          <Pressable style={pressed(s.more)} onPress={handleReset} hitSlop={8}>
            <Text style={u.link}>{t.create.createMore}</Text>
          </Pressable>
        </View>
        </FadeIn>
      </View>
    );
  }

  const ttlLabel = TTL_OPTIONS.find((o) => o.minutes === settings.ttlMinutes)?.label ?? '';

  return (
    <ScrollView style={u.root} contentContainerStyle={u.content} keyboardShouldPersistTaps="handled">
      <Text style={u.logo}>momentum</Text>
      <Text style={u.h1}>{t.create.title}</Text>

      <View style={[u.card, dragOver && s.dragOverCard]}>
        <TextInput
          style={s.textarea}
          multiline
          value={text}
          maxLength={MAX_TEXT_CHARS}
          onChangeText={setText}
          placeholder={t.create.messagePlaceholder}
          placeholderTextColor={colors.faint}
        />
        <Animated.View style={{ opacity: fileOpacity }}>
          {file ? (
            <View style={[s.fileRow, fileFlash && s.flashRow]}>
              <FileBadge name={file.name} />
              <View style={u.fileMeta}>
                <Text style={u.fileName} numberOfLines={1}>
                  {file.name}
                </Text>
                <Text style={u.fileSize}>{formatBytes(file.size)}</Text>
              </View>
              <Pressable onPress={hideFile} hitSlop={8} style={pressed()}>
                <Text style={s.remove}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={pressed(s.fileRow)} onPress={openFilePicker}>
              <Text style={u.link}>{t.create.attach}</Text>
              <Text style={[u.hint, s.attachHint]}>{t.create.attachHint}</Text>
            </Pressable>
          )}
        </Animated.View>
      </View>

      <View style={s.summary}>
        <Text style={u.hint}>{ttlLabel}</Text>
        <Text style={s.dot}>•</Text>
        <Text style={u.hint}>{settings.oneTime ? t.create.oneTime : t.create.multiRead}</Text>
        <Text style={s.dot}>•</Text>
        <Text style={u.hint}>{MODE_LABEL[settings.mode]}</Text>
        <Pressable style={pressed()} onPress={() => setSettingsOpen(true)} hitSlop={6}>
          <Text style={u.link}>{t.create.change}</Text>
        </Pressable>
      </View>

      <Pressable
        style={pressed([u.primary, s.submit, busy && u.primaryDisabled])}
        onPress={handleCreate}
        disabled={busy}
      >
        <View style={s.submitInner}>
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : null}
          <Text style={u.primaryText}>{busy ? t.create.submitting : t.create.submit}</Text>
        </View>
      </Pressable>
      {error ? (
        <FadeIn duration={150} dy={8}>
          <Text style={u.error}>{error}</Text>
        </FadeIn>
      ) : null}

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
      return t.create.errors.textTooLong;
    case 'FILE_TOO_LARGE':
      return t.create.errors.fileTooLarge;
    case 'BLOB_TOO_LARGE':
      return t.create.errors.blobTooLarge;
    case 'EMPTY_PAYLOAD':
      return t.create.errors.empty;
    default:
      return t.create.errors.generic;
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
  submitInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  dragOverCard: {
    borderColor: colors.blue,
  },
  flashField: {
    borderColor: colors.blue,
    backgroundColor: '#eef4fe',
  },
  flashRow: {
    borderTopColor: colors.blue,
    backgroundColor: '#eef4fe',
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
