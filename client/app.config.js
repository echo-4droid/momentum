/**
 * Базовый путь деплоя (например, "/momentum" за nginx) задаётся одним env:
 * EXPO_PUBLIC_BASE_PATH — инлайнится Metro в бандл (fetch'и, ссылки, pathname)
 * и здесь же становится experiments.baseUrl (префикс ассетов в index.html).
 * Пусто/не задано → деплой в корень, как раньше.
 */
const basePath = (process.env.EXPO_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export default {
  expo: {
    name: 'momentum',
    slug: 'momentum',
    version: '0.1.0',
    platforms: ['web'],
    web: { output: 'single', bundler: 'metro' },
    experiments: { baseUrl: basePath || undefined },
  },
};
