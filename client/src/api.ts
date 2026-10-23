/** Запросы к momentum-серверу. Всё с того же origin, внешних запросов нет. */

import { asBufferSource } from './crypto';

export class ApiError extends Error {}

export async function createSecret(
  blob: Uint8Array,
  ttlMinutes: number,
  oneTime: boolean,
): Promise<string> {
  const response = await fetch(
    `/api/v1/secrets?ttl_minutes=${ttlMinutes}&one_time=${oneTime ? 'true' : 'false'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: asBufferSource(blob),
    },
  );
  if (!response.ok) {
    throw new ApiError(`SERVER_${response.status}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new ApiError('BAD_RESPONSE');
  }
  return body.id;
}

export async function fetchSecretBlob(id: string): Promise<Uint8Array> {
  const response = await fetch(`/api/v1/secrets/${encodeURIComponent(id)}`);
  if (response.status === 404) {
    throw new ApiError('NOT_FOUND');
  }
  if (!response.ok) {
    throw new ApiError(`SERVER_${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Доступен ли секрет: без передачи блоба и без сжигания one-time. */
export async function fetchSecretStatus(id: string): Promise<boolean> {
  const response = await fetch(`/api/v1/secrets/${encodeURIComponent(id)}/status`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new ApiError(`SERVER_${response.status}`);
  }
  return true;
}
