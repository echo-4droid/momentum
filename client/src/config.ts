/** Базовый путь деплоя ("/momentum" за nginx, '' — корень); инлайнится из EXPO_PUBLIC_BASE_PATH. */
export const BASE_PATH = (process.env.EXPO_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
