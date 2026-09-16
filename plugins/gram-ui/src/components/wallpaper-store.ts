import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:wallpaper');

const DEFAULT_WALLPAPER_KEY = 'tg-default-wallpaper';

let memDefaultWallpaper: any | null | undefined;

async function readDbDefault(): Promise<any | null> {
  try {
    const mod: any = await import('@ton-ai/gram-db');
    const db = mod.getGramDb?.();
    if (db?.get) {
      const v = await db.get(DEFAULT_WALLPAPER_KEY);
      if (v && typeof v === 'object') return v;
      if (v == null) return null;
    }
  } catch {}
  return null;
}

async function writeDbDefault(value: any | null): Promise<void> {
  try {
    const mod: any = await import('@ton-ai/gram-db');
    const db = mod.getGramDb?.();
    if (db?.set) await db.set(DEFAULT_WALLPAPER_KEY, value);
  } catch (err: any) {
    log.warn('[wallpaper-store] default save failed: ' + (err?.message || String(err)));
  }
}

export async function loadDefaultWallpaper(): Promise<any | null> {
  if (memDefaultWallpaper !== undefined) return memDefaultWallpaper;
  const fromDb = await readDbDefault();
  memDefaultWallpaper = fromDb;
  return fromDb;
}

export async function saveDefaultWallpaper(value: any | null): Promise<void> {
  memDefaultWallpaper = value ?? null;
  await writeDbDefault(memDefaultWallpaper);
}

export function resetDefaultWallpaperCache(): void {
  memDefaultWallpaper = undefined;
}
