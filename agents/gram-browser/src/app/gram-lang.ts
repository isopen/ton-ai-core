import { getLogger } from '@ton-ai/gram-debug';
import { setStrings, TLG_KEYS, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { TelegramUI } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbKeys } from '@/utils/db';
import { LANG_CODE_MAP, REVERSE_LANG_CODE_MAP, LANG_CACHE_VERSION } from './gram-constants';

const log = getLogger('gram-browser');

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
  if (!svc) { log.info('[lang] no service'); return null; }
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

const LANG_OPTIONS_CACHE = 'langOptions_' + LANG_CACHE_VERSION;
const COUNTRIES_CACHE = 'countries_' + LANG_CACHE_VERSION;

export interface CountryInfo {
  iso2: string;
  defaultName: string;
  name: string;
  phoneCode: string;
  patterns?: string[];
}

export async function fetchCachedCountries(
  deps: LangDeps
): Promise<CountryInfo[]> {
  try {
    const cached = await dbGet<CountryInfo[]>(COUNTRIES_CACHE);
    if (cached && cached.length > 0) return cached;
  } catch {}
  const svc = deps.tgService.current;
  if (!svc) return [];
  try {
    const result = await svc.callRpc('help.getCountriesList', { lang_code: 'en', hash: 0 });
    let countries: any[] = [];
    if (Array.isArray(result)) countries = result;
    else if (result?.countries) countries = result.countries;
    const mapped = countries.map((c: any) => ({
      iso2: c.iso2 || '',
      defaultName: c.default_name || '',
      name: c.name || '',
      phoneCode: String(c.country_codes?.[0]?.country_code || ''),
      patterns: c.country_codes?.[0]?.patterns
        ? c.country_codes[0].patterns.map((p: any) => p.pattern)
        : undefined,
    })).filter((c: any) => c.iso2 && c.phoneCode);
    mapped.sort((a: any, b: any) => a.defaultName.localeCompare(b.defaultName));
    try { await dbSet(COUNTRIES_CACHE, mapped); } catch {}
    return mapped;
  } catch (e: any) {
    log.info('[lang] getCountries error:', e?.message);
    return [];
  }
}

export async function fetchLangOptions(
  deps: LangDeps
): Promise<Array<{ code: string; label: string }>> {
  try {
    const cached = await dbGet<Array<{ code: string; label: string }>>(LANG_OPTIONS_CACHE);
    if (cached && cached.length > 0) return cached;
  } catch {}
  const svc = deps.tgService.current;
  if (!svc) return [];
  try {
    const raw = await svc.callRpc('langpack.getLanguages', { lang_pack: 'tdesktop' });
    const langs: any[] = Array.isArray(raw) ? raw : raw?.items || raw?.result?.items || [];
    const seen = new Set<string>();
    const result: Array<{ code: string; label: string }> = [];
    for (const l of langs) {
      const code = REVERSE_LANG_CODE_MAP[l.lang_code] || l.lang_code;
      if (!code || seen.has(code)) continue;
      seen.add(code);
      result.push({ code, label: l.native_name || l.name || l.lang_code });
    }
    try { await dbSet(LANG_OPTIONS_CACHE, result); } catch {}
    return result;
  } catch (e: any) {
    log.info('[lang] getLanguages error:', e?.message);
    return [];
  }
}

export async function loadStrings(
  deps: LangDeps,
  overrideLangCode?: string
): Promise<void> {
  const langCode = overrideLangCode || await getLangCode();
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
