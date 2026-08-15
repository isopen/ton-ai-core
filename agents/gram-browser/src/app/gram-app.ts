import { WorkerTelegramService } from '@/utils/worker-telegram-service';
import { TelegramUI, setStrings, t, tpl, S, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { AppState, TelegramUICallbacks } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbCompact, migrateFromLocalStorage, setEncryptionKey } from '@/utils/db';
import { genId, LANG_CACHE_VERSION } from './gram-constants';
import type { GramState } from './gram-state';
import { createGramState } from './gram-state';
import {
  addLog, loadMessageCache,
  setDialogsFromServer, loadCachedDialogs,
  fetchSelfUserId,
  loadOrphanedDialogs,
} from './gram-utils';
import { loadStrings, fetchLangOptions, fetchCachedCountries } from './gram-lang';
import { createHandleUpdate } from './gram-updates';
import { createAuthCallbacks } from './gram-auth';
import { createCallbacks } from './gram-callbacks';
import { setupEventListeners } from './gram-events';

export class GramApp {
  private s: GramState;

  constructor() {
    this.s = createGramState();
  }

  async init(container: HTMLDivElement): Promise<void> {
    const s = this.s;

    await migrateFromLocalStorage();
    const saved = await dbGet<string>('sessionId');
    if (saved) { s.sessionIdRef.current = saved; }
    else {
      s.sessionIdRef.current = genId();
      await dbSet('sessionId', s.sessionIdRef.current);
    }
    await setEncryptionKey(s.sessionIdRef.current);
    await loadOrphanedDialogs(s);
    await loadMessageCache(s);
    await loadCachedDialogs(s);
    setTimeout(() => dbCompact().catch(() => {}), 5000);

    const savedTheme = await dbGet<string>('theme')
      || (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' as const : 'dark' as const);

    setupEventListeners(s);

    const authCallbacks = createAuthCallbacks(s, () => s.tgService.current);
    let callbacks: TelegramUICallbacks;
    const appCallbacks = createCallbacks(s, () => callbacks);
    callbacks = { ...authCallbacks, ...appCallbacks } as TelegramUICallbacks;

    const langCode = await getLangCode();
    const cacheKey = 'langStrings_' + LANG_CACHE_VERSION + '_' + langCode;
    try {
      let cached = await dbGet<Record<string, string>>(cacheKey);
      if (!cached || Object.keys(cached).length === 0) {
        const oldKey = 'langStrings_' + langCode;
        cached = await dbGet<Record<string, string>>(oldKey);
      }
      const enExtra = LANG_FALLBACKS['en'] || {};
      const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
      setStrings({ ...extra, ...(cached || {}) });
    } catch {}

    const savedLang = await dbGet<string>('langCode');
    const savedId = (await dbGet<string>('sessionId')) || s.sessionIdRef.current;
    const authInvalidated = await dbGet<string>('authInvalidated');
    const wasAuthenticated = await dbGet<string>('authenticated');
    await dbDel('authInvalidated').catch(() => {});

    const tguiInit = {
      page: (wasAuthenticated && !authInvalidated ? 'dialogs' : 'auth') as AppState['page'],
      authStep: 'loading' as AppState['authStep'],
      theme: savedTheme as AppState['theme'],
      dialogs: [],
      connectionStatus: 'connecting' as AppState['connectionStatus'],
    };

    s.tgui.current = new TelegramUI(container, callbacks, tguiInit);

    if (savedLang) {
      s.tgui.current!.dispatch({ type: 'SET_LANG_CODE', langCode: savedLang });
    }

    const handleUpdate = createHandleUpdate(s);

    const service = new WorkerTelegramService(savedId, (msg) => addLog(s, msg), handleUpdate);
    s.tgService.current = service;

    service.onAuthInvalidated = async () => {
      s.tgui.current?.dispatch({ type: 'SET_DIALOGS', dialogs: [] });
      s.tgui.current?.setConnectionStatus('disconnected');
      s.tgui.current?.setPage('auth');
      s.tgui.current?.setAuthStep('phone');
      s.tgui.current?.setError('Session terminated from another device');
      await dbDel('authenticated').catch(() => {});
      await dbSet('authInvalidated', '1').catch(() => {});
    };

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 30000);
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await service.connect(2, abortController.signal);
    } catch (e) {
      clearTimeout(timeoutId);
      addLog(s, 'Connect error: ' + ((e as any)?.message || 'unknown'));
      await dbDel('authenticated').catch(() => {});
      if (s.tgui.current) {
        s.tgui.current.setConnectionStatus('disconnected');
        s.tgui.current.setPage('auth');
        s.tgui.current.setAuthStep('phone');
        s.tgui.current.setError('Connection failed');
      }
      return;
    }

    const langDeps = { tgui: s.tgui, tgService: s.tgService };
    const loadStringsFn = (code?: string) => loadStrings(langDeps, code);
    s.loadStringsRef.current = loadStringsFn;
    await loadStringsFn();

    s.tgui.current!.setSessionId(savedId);
    addLog(s, t(S.LOG_CONNECTED));

    (async () => {
      if (!s.tgui.current) return;
      try {
        const countries = await fetchCachedCountries(langDeps);
        if (countries.length > 0) {
          s.tgui.current?.dispatch({ type: 'SET_COUNTRIES', countries });
          const browserLang = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0].toLowerCase();
          const preferred = countries.find(c => c.iso2 === browserLang.toUpperCase())
            || countries.find(c => c.phoneCode === '1')
            || countries[0];
          s.tgui.current?.dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: preferred.iso2 });
        }
      } catch {}
      try {
        const opts = await fetchLangOptions(langDeps);
        if (opts.length > 0) {
          s.tgui.current?.setLangOptions(opts);
        }
      } catch {}
    })();

    if (service.authenticated) {
      await dbSet('authenticated', '1').catch(() => {});
      await dbDel('authInvalidated').catch(() => {});
      s.tgui.current!.setConnectionStatus('connected');
      try {
        const dialogsResult = await service.fetchDialogs();
        s.tgui.current!.setPage('dialogs');
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
        await fetchSelfUserId(s);
      } catch (e: any) {
        addLog(s, tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
        s.tgui.current!.setPage('auth');
        s.tgui.current!.setAuthStep('phone');
        s.tgui.current!.setError('Session error. Please log in again.');
      }
    } else {
      await dbDel('authenticated').catch(() => {});
      s.tgui.current!.setPage('auth');
      s.tgui.current!.dispatch({ type: 'SET_DIALOGS', dialogs: [] });
      try {
        const state = await service.getAuthState();
        if (state === 'code_sent') s.tgui.current!.setAuthStep('code');
        else if (state === 'password_needed') s.tgui.current!.setAuthStep('password');
        else s.tgui.current!.setAuthStep('phone');
      } catch {
        s.tgui.current!.setAuthStep('phone');
      }
    }
  }

  destroy(): void {
    const s = this.s;
    s.tgui.current?.destroy();
    s.tgui.current = null;
    for (const fn of s.cleanupFns) fn();
    s.cleanupFns = [];
  }
}

async function getLangCode(): Promise<string> {
  const stored = await dbGet<string>('langCode');
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.split(/[-_]/)[0] || 'en';
}
