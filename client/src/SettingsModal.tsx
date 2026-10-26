/**
 * Модалка «Настройки секрета»: правит черновик; «Сохранить» применяет,
 * «Отмена» и крестик закрывают без изменений.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEFAULT_WORDS, generatePassphrase, MAX_WORDS, MIN_WORDS, WORD_ENTROPY_BITS } from './crypto';
import { colors, Segmented, styles as u,
  pressed,
} from './ui';

export type TransferMode = 'phrase' | 'link';

/** Настройки секрета: живут в форме, правятся в модалке, применяются по «Сохранить». */
export interface Settings {
  ttlMinutes: number;
  oneTime: boolean;
  mode: TransferMode;
  /** Сгенерированная фраза режима «фраза отдельно»; свободный ввод отсутствует. */
  passphrase: string;
  /** Число слов последней генерации; смена значения порождает новую фразу. */
  passphraseWords: number;
  /** Скрыть содержимое у получателя через N секунд; 0 — выключено. */
  hideSeconds: number;
  /** Удалить содержимое со страницы получателя через N минут; 0 — выключено. */
  destroyMinutes: number;
}

export const TTL_OPTIONS = [
  { label: '1 час', minutes: 60 },
  { label: '24 часа', minutes: 1440 },
  { label: '7 дней', minutes: 10080 },
] as const;

export const HIDE_OPTIONS = [
  { label: 'Выкл', seconds: 0 },
  { label: '15 с', seconds: 15 },
  { label: '30 с', seconds: 30 },
  { label: '60 с', seconds: 60 },
] as const;

export const DESTROY_OPTIONS = [
  { label: 'Выкл', minutes: 0 },
  { label: '5 мин', minutes: 5 },
  { label: '10 мин', minutes: 10 },
  { label: '30 мин', minutes: 30 },
] as const;

const MODE_OPTIONS = [
  { value: 'phrase' as const, label: 'Фраза отдельно' },
  { value: 'link' as const, label: 'Ключ в ссылке' },
];

export const MODE_LABEL: Record<TransferMode, string> = {
  phrase: 'Фраза отдельно',
  link: 'Ключ в ссылке',
};

const WORD_COUNTS = Array.from(
  { length: MAX_WORDS - MIN_WORDS + 1 },
  (_, i) => MIN_WORDS + i,
);

/** Фраза генерируется сразу и не редактируется; в режиме «ключ в ссылке» не используется. */
export function defaultSettings(): Settings {
  return {
    ttlMinutes: TTL_OPTIONS[1].minutes,
    oneTime: true,
    mode: 'link',
    passphrase: generatePassphrase(),
    passphraseWords: DEFAULT_WORDS,
    hideSeconds: HIDE_OPTIONS[2].seconds,
    destroyMinutes: DESTROY_OPTIONS[2].minutes,
  };
}

export function SettingsModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(initial);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.panel}>
          <ScrollView style={s.panelBody} bounces={false} contentContainerStyle={s.panelContent}>
            <View style={s.panelHead}>
              <Text style={s.panelTitle}>Настройки секрета</Text>
              <Pressable style={pressed()} onPress={onClose} hitSlop={8}>
                <Text style={s.remove}>✕</Text>
              </Pressable>
            </View>

          <Text style={u.label}>Срок хранения</Text>
          <Segmented
            options={TTL_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))}
            value={draft.ttlMinutes}
            onChange={(ttlMinutes) => setDraft({ ...draft, ttlMinutes })}
          />

          <Pressable style={pressed(s.checkRow)} onPress={() => setDraft({ ...draft, oneTime: !draft.oneTime })}>
            <View style={[s.checkbox, draft.oneTime && s.checkboxOn]}>
              {draft.oneTime ? <Text style={s.checkMark}>✓</Text> : null}
            </View>
            <Text style={s.checkLabel}>Удалить после первого открытия</Text>
          </Pressable>

          <Text style={[u.label, s.section]}>Скрыть содержимое через</Text>
          <Segmented
            options={HIDE_OPTIONS.map((o) => ({ value: o.seconds, label: o.label }))}
            value={draft.hideSeconds}
            onChange={(hideSeconds) => setDraft({ ...draft, hideSeconds })}
          />

          <Text style={[u.label, s.section]}>Удалить со страницы через</Text>
          <Segmented
            options={DESTROY_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))}
            value={draft.destroyMinutes}
            onChange={(destroyMinutes) => setDraft({ ...draft, destroyMinutes })}
          />
          <Text style={[u.hint, s.timerHint]}>
            Оба таймера запускаются у получателя после расшифровки: скрытие прячет содержимое
            шумом, удаление убирает его с этой страницы.
          </Text>

          <Text style={[u.label, s.section]}>Передача ключа</Text>
          <Segmented options={MODE_OPTIONS} value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })} />

          {draft.mode === 'phrase' ? (
            <>
              <Text style={[u.label, s.section]}>Фраза</Text>
              <View style={[u.field, s.phraseBox]}>
                <Text style={[u.mono, s.phraseText]}>{draft.passphrase}</Text>
              </View>
              <Text style={[u.label, s.section]}>Слов во фразе</Text>
              <Segmented
                options={WORD_COUNTS.map((n) => ({ value: n, label: String(n) }))}
                value={draft.passphraseWords}
                onChange={(passphraseWords) =>
                  setDraft({ ...draft, passphraseWords, passphrase: generatePassphrase(passphraseWords) })
                }
              />
              <View style={s.phraseRow}>
                <Pressable
                  style={pressed()}
                  onPress={() => setDraft({ ...draft, passphrase: generatePassphrase(draft.passphraseWords) })}
                  hitSlop={6}
                >
                  <Text style={u.link}>Новая фраза</Text>
                </Pressable>
                <Text style={u.hint}>≈ {Math.round(draft.passphraseWords * WORD_ENTROPY_BITS)} бит</Text>
              </View>
            </>
          ) : null}
          </ScrollView>

          <View style={s.panelFooter}>
            <Pressable style={pressed()} onPress={onClose} hitSlop={8}>
              <Text style={s.cancelText}>Отмена</Text>
            </Pressable>
            <Pressable style={pressed([u.primary, s.saveButton])} onPress={() => onSave(draft)}>
              <Text style={u.primaryText}>Сохранить</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  remove: {
    fontSize: 16,
    color: colors.muted,
  },
  section: {
    marginTop: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 23, 28, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.white,
    borderRadius: 14,
    // Панель не выше 90% экрана: содержимое скроллится, футер с «Сохранить» виден всегда.
    maxHeight: '90%',
  },
  panelBody: {
    flexShrink: 1,
  },
  panelContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  checkMark: {
    fontSize: 13,
    lineHeight: 15,
    color: colors.white,
    fontWeight: '700',
  },
  checkLabel: {
    fontSize: 14,
    color: colors.text,
  },
  timerHint: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  phraseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  phraseBox: {
    minHeight: 60,
    justifyContent: 'center',
  },
  phraseText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  panelFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  cancelText: {
    fontSize: 15,
    color: colors.muted,
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'auto',
  },
});
