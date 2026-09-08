import { setStrings, TLG_KEYS } from '@ton-ai/gram-lang';
import type { TelegramUI } from '@ton-ai/gram-ui';
import { createStandaloneGramLang, getBuiltinStrings, normalizeLangCode } from '@ton-ai/gram-lang';
import type { LangOption, RpcProvider } from '@ton-ai/gram-lang';
import { dbGet, dbSet, dbDel, dbKeys } from '@/utils/db';
import { LANG_CACHE_VERSION } from './gram-constants';

export interface CountryInfo {
  iso2: string;
  defaultName: string;
  name: string;
  phoneCode: string;
  patterns?: string[];
}

export interface LangDeps {
  tgui: { current: TelegramUI | null };
  tgService: { current: { callRpc: (method: string, params: any) => Promise<any> } | null };
}

const COUNTRIES_CACHE = 'countries_' + LANG_CACHE_VERSION;

const langSkills = createStandaloneGramLang(
  {
    get: (key: string) => dbGet(key),
    set: (key: string, value: any) => dbSet(key, value),
    del: (key: string) => dbDel(key),
    keys: (prefix: string) => dbKeys(prefix),
  },
  { cacheVersion: LANG_CACHE_VERSION }
);

function rpcOf(deps: LangDeps): () => RpcProvider | null {
  return () => {
    const svc = deps.tgService.current;
    if (!svc) return null;
    return { callRpc: (method: string, params: any) => svc.callRpc(method, params) };
  };
}

function builtinEn(): Record<string, string> {
  return getBuiltinStrings('en') || {};
}

export async function getLangCode(): Promise<string> {
  const stored = await dbGet<string>('langCode');
  if (stored) return normalizeLangCode(stored);
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return normalizeLangCode(nav || 'en');
}

export async function fetchCachedCountries(
  deps: LangDeps
): Promise<CountryInfo[]> {
  try {
    const cached = await dbGet<CountryInfo[]>(COUNTRIES_CACHE);
    if (cached && cached.length > 0 && cached.some(c => c && c.iso2 && c.phoneCode)) return cached;
  } catch {}
  const getRpc = rpcOf(deps);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (getRpc()) break;
    await new Promise(r => setTimeout(r, 300));
  }
  const rpc = getRpc();
  if (!rpc) return [];
  let result: any = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await rpc.callRpc('help.getCountriesList', { lang_code: 'en', hash: 0 });
        break;
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (msg.includes('not connected') && attempt < 2) {
          await new Promise(r => setTimeout(r, 600 + attempt * 400));
          continue;
        }
        throw e;
      }
    }
    if (!result) return [];
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
  } catch {
    return [];
  }
}

export async function fetchLangOptions(
  deps: LangDeps
): Promise<LangOption[]> {
  return langSkills.getLanguages(rpcOf(deps));
}

export async function loadStrings(
  deps: LangDeps,
  overrideLangCode?: string
): Promise<void> {
  const langCode = overrideLangCode || await getLangCode();
  const ourKeys = Object.keys(TLG_KEYS).filter(k => TLG_KEYS[k]);
  const tlgKeys = ourKeys.map(k => TLG_KEYS[k]!);
  try {
    const raw = await langSkills.getStrings(rpcOf(deps), langCode, tlgKeys);
    const extra = builtinEn();
    if (raw) {
      const mapped: Record<string, string> = {};
      for (const key of ourKeys) {
        const tlgKey = TLG_KEYS[key]!;
        if (raw[tlgKey] !== undefined) mapped[key] = raw[tlgKey];
      }
      if (Object.keys(mapped).length > 0) {
        try {
          const cacheKey = langSkills.stringsKey(langCode);
          const oldKeys = await dbKeys('langStrings_');
          for (const ok of oldKeys) {
            if (ok !== cacheKey) { try { await dbDel(ok); } catch {} }
          }
        } catch {}
        setStrings({ ...extra, ...mapped });
        deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
        return;
      }
    }
    setStrings(extra);
    deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
    return;
  } catch {}
  if (langCode !== 'en') {
    try {
      const fallback = await langSkills.getStrings(rpcOf(deps), 'en', tlgKeys);
      if (fallback) setStrings(fallback);
      const extra = builtinEn();
      if (Object.keys(extra).length > 0) {
        setStrings({ ...(fallback || {}), ...extra });
      }
    } catch {}
  }
  deps.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
}
