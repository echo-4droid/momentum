import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fetchSecretBlob, fetchSecretStatus } from './api';
import { bytesFromBase64, decodeLinkKey } from './base64';
import { asBufferSource, decrypt, type FilePayload, type Payload } from './crypto';
import {
  colors,
  CopyLink,
  FileBadge,
  formatBytes,
  styles as u,
} from './ui';

/** Ключ из hash ссылки: fromHash — режим «ключ в ссылке», поле фразы не показывается. */
interface LinkKeyState {
  fromHash: boolean;
  key: Uint8Array | null;
}

function readLinkKey(): LinkKeyState {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (hash.length < 2) {
    return { fromHash: false, key: null };
  }
  // Ключ изъят из URL сразу: дальше его не должно быть в адресе, истории и на экране.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    return { fromHash: true, key: decodeLinkKey(hash.slice(1)) };
  } catch {
    // Битый ключ: блоб не запрашиваем — GET сгорел бы зря.
    return { fromHash: true, key: null };
  }
}

export default function ReadScreen({ id }: { id: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [linkKey] = useState<LinkKeyState>(readLinkKey);
  // Таймеры показа из view: остаток до скрытия, фазы «скрыто шумом» и «удалено».
  const [hideLeft, setHideLeft] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [destroyed, setDestroyed] = useState(false);
  // Занавес: растворение перед возвратом содержимого.
  const [closing, setClosing] = useState(false);
  // Предварительная проверка доступности: секрет уже прочитан или истёк — открыть нечего.
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    // Битый фрагмент ссылки: статус не нужен — блоб и так не запрашивается.
    if (linkKey.fromHash && !linkKey.key) {
      return;
    }
    let cancelled = false;
    fetchSecretStatus(id)
      .then((ok) => {
        if (!cancelled) {
          setUnavailable(!ok);
        }
      })
      .catch(() => {
        // Сервер недоступен — решит нажатие «Открыть», раньше времени ничего не утверждаем.
      });
    return () => {
      cancelled = true;
    };
  }, [id, linkKey]);

  // Таймеры создателя секрета: удаление — абсолютный дедлайн (необратимо), скрытие —
  // перезапускается при повторном показе по клику.
  const destroyAtRef = useRef<number | null>(null);
  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    if (!payload) {
      return;
    }
    const destroyMin = payload.view?.destroyAfterMinutes ?? 0;
    destroyAtRef.current = destroyMin > 0 ? Date.now() + destroyMin * 60_000 : null;
    setDestroyed(false);
    setRevealCount(0);
  }, [payload]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    const hideSec = payload.view?.hideAfterSeconds ?? 0;
    const hideAt = hideSec > 0 ? Date.now() + hideSec * 1000 : null;
    setHidden(false);
    setHideLeft(hideSec);
    const timer = setInterval(() => {
      const now = Date.now();
      if (destroyAtRef.current !== null && now >= destroyAtRef.current) {
        // «Уничтожение»: содержимое и его состояние стираются со страницы.
        setPayload(null);
        setDestroyed(true);
        return;
      }
      if (hideAt !== null && now >= hideAt) {
        setHidden(true);
      }
      setHideLeft(hideAt === null ? null : Math.max(0, Math.ceil((hideAt - now) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [payload, revealCount]);

  // Блоб (и сгорание one-time) запрашивается только по нажатию «Открыть».
  async function runDecrypt(input: string | Uint8Array): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const blob = await fetchSecretBlob(id);
      // Деталей ошибки не раскрываем: неверная фраза/ключ и битый конверт выглядят одинаково.
      setPayload(await decrypt(blob, input));
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'NOT_FOUND'
          ? 'Секрет не найден: он уже прочитан или срок его действия истёк.'
          : 'Не удалось расшифровать. Неверная фраза или данные повреждены.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(): Promise<void> {
    if (linkKey.key) {
      await runDecrypt(linkKey.key);
      return;
    }
    if (!passphrase.trim()) {
      setError('Введите фразу.');
      return;
    }
    await runDecrypt(passphrase);
  }

  const openButton = (
    <Pressable style={[u.primary, busy && u.primaryDisabled]} onPress={handleOpen} disabled={busy}>
      <Text style={u.primaryText}>{busy ? 'Открываем…' : 'Открыть'}</Text>
    </Pressable>
  );

  // Подсказка соответствует реальному поведению: скрытие обратимо, удаление — нет.
  const view = payload?.view;
  const showHint = (() => {
    const hideOn = (view?.hideAfterSeconds ?? 0) > 0;
    const destroyMin = view?.destroyAfterMinutes ?? 0;
    const parts: string[] = [];
    if (hideOn) {
      parts.push(
        hideLeft !== null && hideLeft > 0
          ? `Через ${hideLeft} с содержимое скроется — кнопка на занавесе вернёт его.`
          : 'Содержимое скрыто — кнопка на занавесе вернёт его.',
      );
    }
    if (destroyMin > 0) {
      parts.push(`Через ${destroyMin} мин оно будет удалено со страницы — необратимо.`);
    }
    if (parts.length === 0) {
      parts.push('Сохраните нужное перед закрытием страницы.');
    }
    return parts.join(' ');
  })();
  const burnWarning = (
    <Text style={s.burnWarning}>Одноразовый секрет удалится при открытии.</Text>
  );

  return (
    <View style={u.root}>
      <View style={u.content}>
        <Text style={u.logo}>momentum</Text>
        <Text style={u.h1}>{payload || destroyed ? 'Секрет' : 'Открыть секрет'}</Text>

        {destroyed ? (
          <FadeIn duration={350}>
            <View style={[u.card, s.goneCard]}>
              <Text style={s.goneTitle}>Содержимое удалено со страницы</Text>
              <Text style={u.hint}>
                Время показа истекло. Обновите страницу, чтобы открыть секрет повторно, — если он
                ещё хранится на сервере.
              </Text>
            </View>
          </FadeIn>
        ) : payload ? (
          hidden ? (
            <NoiseVeil
              closing={closing}
              onRequestClose={() => setClosing(true)}
              onClosed={() => {
                setClosing(false);
                setRevealCount((c) => c + 1);
              }}
            />
          ) : (
            <FadeIn duration={300}>
              {payload.text !== undefined ? (
                <View style={s.block}>
                  <Text style={s.message}>{payload.text}</Text>
                  <CopyLink value={payload.text} />
                </View>
              ) : null}
              {payload.file ? <FileCard file={payload.file} /> : null}
              <Text style={[u.hint, s.section]}>{showHint}</Text>
            </FadeIn>
          )
        ) : unavailable ? (
          <Text style={u.error}>
            Секрет недоступен: он уже прочитан или срок его действия истёк. Открывать нечего —
            создатель мог передать ссылку повторно или время вышло.
          </Text>
        ) : linkKey.fromHash && !linkKey.key ? (
          // Битый фрагмент: даже не пробуем — GET сжёг бы одноразовый секрет впустую.
          <Text style={u.error}>Ссылка неполная: в ней нет ключа расшифровки.</Text>
        ) : linkKey.fromHash ? (
          <>
            {burnWarning}
            {openButton}
            {error ? <Text style={u.error}>{error}</Text> : null}
          </>
        ) : (
          <>
            <Text style={u.label}>Фраза</Text>
            <TextInput
              style={[u.field, u.mono]}
              value={passphrase}
              onChangeText={(value) => {
                setPassphrase(value);
                setError(null);
              }}
              placeholder="Введите фразу"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleOpen}
            />
            {burnWarning}
            {openButton}
            {error ? <Text style={u.error}>{error}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

/** Базовое направление дрейфа зерна; слои отклоняются от него не более чем на ±5°. */
const NOISE_BASE_ANGLE = Math.PI / 9; // 20°

/** Слои зерна: каждая группа точек — свой размер и скорость, направление почти общее. */
const NOISE_LAYERS = [
  { count: 700, size: 1.0, speed: 5, alpha: 0.22, angleDeg: 0 },
  { count: 520, size: 1.3, speed: 8, alpha: 0.32, angleDeg: -3 },
  { count: 380, size: 1.7, speed: 12, alpha: 0.45, angleDeg: 4 },
  { count: 250, size: 2.2, speed: 17, alpha: 0.6, angleDeg: -5 },
  { count: 160, size: 2.8, speed: 23, alpha: 0.75, angleDeg: 2 },
];

/** Плавное появление: opacity 0→1 за duration мс. */
function FadeIn({ duration = 300, children }: { duration?: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [opacity, duration]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/**
 * Занавес: canvas-зерно из пяти слоёв точек (параллакс), поверх — кнопка показа.
 * Закрывается плавно: `closing` запускает растворение, по завершении — `onClosed`.
 */
function NoiseVeil({
  closing,
  onRequestClose,
  onClosed,
}: {
  closing: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  // Плавное появление занавеса.
  useEffect(() => {
    const anim = Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  // Плавное растворение перед возвратом содержимого.
  useEffect(() => {
    if (!closing) {
      return;
    }
    const anim = Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: false });
    anim.start(({ finished }) => {
      if (finished) {
        onClosed();
      }
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Зерно: точки движутся независимо, слой за слоем; перерисовка через rAF.
  useEffect(() => {
    const host = document.getElementById('momo-noise-host');
    if (!host) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const layers = NOISE_LAYERS.map((layer) => {
      const angle = NOISE_BASE_ANGLE + (layer.angleDeg * Math.PI) / 180;
      return {
        alpha: layer.alpha,
        vx: Math.cos(angle) * layer.speed,
        vy: Math.sin(angle) * layer.speed,
        dots: Array.from({ length: layer.count }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          size: layer.size * (0.8 + Math.random() * 0.5),
        })),
      };
    });

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (const layer of layers) {
        ctx.fillStyle = `rgba(23, 23, 28, ${layer.alpha})`;
        for (const dot of layer.dots) {
          dot.x += layer.vx * dt;
          dot.y += layer.vy * dt;
          if (dot.x < 0) dot.x += width;
          else if (dot.x >= width) dot.x -= width;
          if (dot.y < 0) dot.y += height;
          else if (dot.y >= height) dot.y -= height;
          ctx.fillRect(dot.x, dot.y, dot.size, dot.size);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.remove();
    };
  }, []);

  return (
    <Animated.View style={[u.card, s.veil, { opacity }]}>
      <View style={s.noiseWrap}>
        <View nativeID="momo-noise-host" style={s.noiseHost} />
      </View>
      <View style={s.veilText}>
        <Pressable
          style={[u.primary, s.veilButton]}
          onPress={onRequestClose}
          disabled={closing}
          accessibilityLabel="Показать содержимое"
        >
          <Text style={u.primaryText}>Показать содержимое</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** Вложение рядом со своими данными: бейдж, имя, размер и «Скачать» в одной карточке. */
function FileCard({ file }: { file: FilePayload }) {
  const size = Math.round((file.data.length * 3) / 4);
  return (
    <View style={[u.card, s.fileCard]}>
      <FileBadge name={file.name} />
      <View style={u.fileMeta}>
        <Text style={u.fileName} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={u.fileSize}>{formatBytes(size)}</Text>
      </View>
      <Pressable
        onPress={() => {
          const bytes = bytesFromBase64(file.data);
          const url = URL.createObjectURL(
            new Blob([asBufferSource(bytes)], { type: file.mime || 'application/octet-stream' }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = file.name;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }}
      >
        <Text style={u.link}>Скачать</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    gap: 10,
  },
  message: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  burnWarning: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: 16,
  },
  section: {
    marginTop: 20,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginTop: 20,
  },
  veil: {
    height: 200,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  noiseWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  noiseHost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  veilText: {
    position: 'relative',
    alignItems: 'center',
  },
  veilButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  goneCard: {
    marginTop: 20,
    padding: 20,
    gap: 8,
  },
  goneTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
});
