import { getLogger } from '@ton-ai/gram-debug';
import { getGramDb } from '@ton-ai/gram-db';

const log = getLogger('gram-ui:wallpaper');

const DEFAULT_WALLPAPER_KEY = 'tg-default-wallpaper';

let memDefaultWallpaper: any | null | undefined;

async function readDbDefault(): Promise<any | null> {
  try {
    const db = getGramDb();
    if (db?.get) {
      const v = await db.get(DEFAULT_WALLPAPER_KEY);
      if (v && typeof v === 'object') return thawWallpaper(v);
      if (v == null) return null;
    }
  } catch {}
  return null;
}

async function writeDbDefault(value: any | null): Promise<void> {
  try {
    const db = getGramDb();
    if (db?.set) await db.set(DEFAULT_WALLPAPER_KEY, value);
  } catch (err: any) {
    log.warn('[wallpaper-store] default save failed: ' + (err?.message || String(err)));
  }
}

export function freezeWallpaper(value: any): any {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? { $bigint: String(v) } : v)));
}

export function thawWallpaper(value: any): any {
    if (!value || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value), (_k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).$bigint === 'string' && Object.keys(v).length === 1) {
            try { return BigInt((v as any).$bigint); } catch { return v; }
        }
        return v;
    });
}

export async function loadDefaultWallpaper(): Promise<any | null> {
    if (memDefaultWallpaper !== undefined) return memDefaultWallpaper;
    const fromDb = await readDbDefault();
    memDefaultWallpaper = fromDb;
    return fromDb;
}

export async function saveDefaultWallpaper(value: any | null): Promise<void> {
    memDefaultWallpaper = value ?? null;
    await writeDbDefault(memDefaultWallpaper === null ? null : freezeWallpaper(memDefaultWallpaper));
}

export function resetDefaultWallpaperCache(): void {
  memDefaultWallpaper = undefined;
}
