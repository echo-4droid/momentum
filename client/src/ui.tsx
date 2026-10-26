/**
 * Общие токены и атомы дизайна (docs/design/INDEX.md):
 * цвета, типографика, кнопка, поле, карточка, бейдж файла, ссылка «Копировать».
 */
import { useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useEffect, useRef, type ReactNode } from 'react';

export const colors = {
  bg: '#f7f7f8',
  text: '#17171c',
  muted: '#6b6b76',
  faint: '#9a9aa2',
  border: '#e4e4ea',
  blue: '#2563eb',
  white: '#ffffff',
  danger: '#b42318',
  badge: '#5b5b66',
  badgePdf: '#e05252',
} as const;

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    padding: 16,
    paddingTop: 32,
    paddingBottom: 48,
  },
  logo: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 32,
  },
  h1: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  link: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.blue,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  primary: {
    backgroundColor: colors.blue,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.white,
  },
  mono: {
    fontFamily: 'monospace',
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
    marginTop: 12,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  fileMeta: {
    flexShrink: 1,
    flexGrow: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  fileSize: {
    fontSize: 13,
    color: colors.muted,
  },
});

/** Стиль-функция для Pressable: затемнение при нажатии поверх базовых стилей. */
export function pressed(base?: StyleProp<ViewStyle>, opacity = 0.6) {
  return (state: { pressed: boolean }) => [base, state.pressed && { opacity }];
}

/** Плавное появление: opacity 0→1, опционально с подъёмом на dy пикселей. */
export function FadeIn({
  duration = 300,
  dy = 0,
  children,
}: {
  duration?: number;
  dy?: number;
  children: ReactNode;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(dy)).current;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: 0, duration, useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [opacity, translateY, duration]);
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>
  );
}

/** Иконка вложения: скруглённый квадрат с расширением файла (PDF — красный, как в макете). */
export function FileBadge({ name }: { name: string }) {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  const isPdf = ext.toLowerCase() === 'pdf';
  return (
    <View style={[styles.badge, isPdf && { backgroundColor: colors.badgePdf }]}>
      <Text style={styles.badgeText} numberOfLines={1}>
        {(ext || 'file').slice(0, 4).toUpperCase()}
      </Text>
    </View>
  );
}

/** Текстовая ссылка «Копировать» рядом со своими данными; выполняет ровно одно копирование. */
export function CopyLink({
  value,
  label = 'Копировать',
  onCopied,
}: {
  value: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      hitSlop={8}
      style={pressed()}
      onPress={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          onCopied?.();
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Нет доступа к clipboard — остаётся ручное копирование.
        }
      }}
    >
      <Text style={styles.link}>{copied ? 'Скопировано' : label}</Text>
    </Pressable>
  );
}

/** Размер вложения в человекочитаемом виде («1,2 МБ»), как в макетах. */
export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} КБ`;
  }
  return `${size} Б`;
}

/** Сегментный переключатель макета: рамка-контейнер, активный сегмент залит синим. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.segmentWrap}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={pressed([s.segment, value === option.value && s.segmentActive], 0.5)}
          onPress={() => onChange(option.value)}
        >
          <Text
            style={[s.segmentText, value === option.value && s.segmentTextActive]}
            numberOfLines={1}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  segmentWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 3,
    gap: 3,
    backgroundColor: colors.white,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.blue,
  },
  segmentText: {
    fontSize: 14,
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
});
