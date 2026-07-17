import { setStrings, TLG_KEYS, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { TelegramUI } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbKeys } from '@/utils/db';
import { LANG_CODE_MAP, LANG_CACHE_VERSION } from './gram-constants';

export interface LangDeps {
  tgui: { current: TelegramUI | null };
  tgService: { current: { callRpc: (method: string, params: any) => Promise<any> } | null };
}

export async function getLangCode(): Promise<string> {
  const stored = await dbGet<string>('langCode');
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.split(/[-_]/)[0] || 'en';
}

export async function fetchLangStrings(
  langCode: string,
  deps: LangDeps
): Promise<Record<string, string> | null> {
  const svc = deps.tgService.current;
  if (!svc) { console.log('[lang] no service'); return null; }
  const cacheKey = 'langStrings_' + LANG_CACHE_VERSION + '_' + langCode;
  try {
    const cached = await dbGet<Record<string, string>>(cacheKey);
    if (cached && Object.keys(cached).length > 0) return cached;
  } catch {}
  const tlgCode = LANG_CODE_MAP[langCode] || langCode;
  const ourKeys = Object.keys(TLG_KEYS).filter(k => TLG_KEYS[k]);
  const tlgKeys = ourKeys.map(k => TLG_KEYS[k]!);
  const rawData = await svc.callRpc('langpack.getStrings', {
    lang_pack: 'tdesktop',
    lang_code: tlgCode,
    keys: tlgKeys,
  });
  const raw: Record<string, string> = {};
  const items: any[] = Array.isArray(rawData) ? rawData
    : rawData?.items ? rawData.items
    : rawData?.result?.items ? rawData.result.items
    : null;
  if (items) {
    for (const item of items) {
      if (item && item.key) {
        const val = item.value || item.other_value;
        if (val) raw[item.key] = val;
      }
    }
  }
  const mapped: Record<string, string> = {};
  for (const key of ourKeys) {
    const tlgKey = TLG_KEYS[key]!;
    if (raw[tlgKey] !== undefined) mapped[key] = raw[tlgKey];
  }
  if (Object.keys(mapped).length > 0) {
    try {
      const oldKeys = await dbKeys('langStrings_');
      for (const ok of oldKeys) {
        if (ok !== cacheKey) { try { await dbDel(ok); } catch {} }
      }
    } catch {}
    try { await dbSet(cacheKey, mapped); } catch {}
    return mapped;
  }
  return null;
}

export async function loadStrings(
  deps: LangDeps
): Promise<void> {
  const langCode = await getLangCode();
  try {
    const mapped = await fetchLangStrings(langCode, deps);
    const enExtra = LANG_FALLBACKS['en'] || {};
    const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
    if (mapped) {
      setStrings({ ...extra, ...mapped });
      deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
      return;
    }
    if (Object.keys(extra).length > 0) {
      setStrings(extra);
      deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
      return;
    }
  } catch {}
  if (langCode !== 'en') {
    try {
      const fallback = await fetchLangStrings('en', deps);
      if (fallback) setStrings(fallback);
      const enExtra = LANG_FALLBACKS['en'] || {};
      const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
      if (Object.keys(extra).length > 0) {
        setStrings({ ...(fallback || {}), ...extra });
      }
    } catch {}
  }
  deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
}
