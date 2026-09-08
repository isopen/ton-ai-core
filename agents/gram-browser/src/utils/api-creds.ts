import { dbGet, dbSet } from './db';

const API_ID_KEY = 'tgApiId';
const API_HASH_KEY = 'tgApiHash';
export const API_CREDS_PRESERVE_KEYS = [API_ID_KEY, API_HASH_KEY];

const RE_API_ID = /^\d+$/;
const RE_API_HASH = /^[0-9a-f]{32}$/i;

let memApiId: number | null = null;
let memApiHash: string | null = null;
let urlIngested = false;

function readUrlCreds(): { apiId: number; apiHash: string } | null {
  try {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('apiId');
    const hash = q.get('apiHash');
    if (id && RE_API_ID.test(id) && hash && RE_API_HASH.test(hash)) {
      return { apiId: parseInt(id, 10), apiHash: hash.toLowerCase() };
    }
  } catch {}
  return null;
}

function readEnvCreds(): { apiId: number; apiHash: string } {
  const envApiIdRaw = typeof process !== 'undefined' ? (process.env as any)?.TELEGRAM_API_ID : undefined;
  const envApiHashRaw = typeof process !== 'undefined' ? (process.env as any)?.TELEGRAM_API_HASH : undefined;
  const rawId = envApiIdRaw ?? '0';
  const rawHash = envApiHashRaw ?? '';
  const apiId = parseInt(String(rawId), 10);
  return { apiId: Number.isFinite(apiId) ? apiId : 0, apiHash: String(rawHash || '') };
}

export function ingestUrlApiCreds(): void {
  if (urlIngested) return;
  urlIngested = true;
  const creds = readUrlCreds();
  if (!creds) return;
  memApiId = creds.apiId;
  memApiHash = creds.apiHash;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('apiId');
    u.searchParams.delete('apiHash');
    window.history.replaceState({}, '', u.toString());
  } catch {}
  dbSet(API_ID_KEY, creds.apiId).catch(() => {});
  dbSet(API_HASH_KEY, creds.apiHash).catch(() => {});
}

export async function preloadApiCreds(): Promise<void> {
  if (memApiId && memApiHash) return;
  try {
    const [id, hash] = await Promise.all([
      dbGet<number | string>(API_ID_KEY),
      dbGet<string>(API_HASH_KEY),
    ]);
    const idNum = typeof id === 'number' && Number.isFinite(id)
      ? id
      : typeof id === 'string' && RE_API_ID.test(id) ? parseInt(id, 10) : 0;
    if (idNum && typeof hash === 'string' && RE_API_HASH.test(hash)) {
      memApiId = idNum;
      memApiHash = hash.toLowerCase();
    }
  } catch {}
}

export function getApiCredentials(): { apiId: number; apiHash: string } {
  const url = readUrlCreds();
  if (url) return url;
  if (memApiId && memApiHash) return { apiId: memApiId, apiHash: memApiHash };
  return readEnvCreds();
}
