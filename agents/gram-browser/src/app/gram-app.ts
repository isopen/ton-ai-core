import { WorkerTelegramService } from '@/utils/worker-telegram-service';
import { TelegramUI } from '@ton-ai/gram-ui';
import { setStrings, t, tpl, S } from '@ton-ai/gram-lang';
import { getBuiltinStrings } from '@ton-ai/gram-lang';
import type { AppState, TelegramUICallbacks } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbCompact, setEncryptionKey } from '@/utils/db';
import { ingestUrlApiCreds, preloadApiCreds } from '@/utils/api-creds';
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
import { setupEventListeners, warmupEmojiPipeline } from './gram-events';
import { getLogger } from '@ton-ai/gram-debug';

const bootLog = getLogger('gram-browser:history');

export class GramApp {
  private s: GramState;

  constructor() {
    this.s = createGramState();
  }

  async init(container: HTMLDivElement): Promise<void> {
    const s = this.s;

    try { ingestUrlApiCreds(); } catch {}
    try { container.style.visibility = 'hidden'; } catch {}
    setupEventListeners(s);
    const authCallbacks = createAuthCallbacks(s, () => s.tgService.current);
    let callbacks: TelegramUICallbacks;
    const appCallbacks = createCallbacks(s, () => callbacks);
    callbacks = { ...authCallbacks, ...appCallbacks } as TelegramUICallbacks;
    try {
      setStrings({ ...(getBuiltinStrings('en') || {}) });
    } catch {}
    try {
      import('@ton-ai/gram-ui').then(m => (m as any).scheduleQrPreload?.()).catch(() => {});
      if (typeof (globalThis as any).requestIdleCallback === 'function') {
        (globalThis as any).requestIdleCallback(() => {
          import('@ton-ai/gram-ui').then(m => (m as any).preloadQrModule?.().catch(() => {})).catch(() => {});
        }, { timeout: 2000 });
      }
    } catch {}

    let earlyService: WorkerTelegramService | null = (typeof window !== 'undefined' ? (window as any).__earlyGramService as WorkerTelegramService : null) || null;
    if (!earlyService) {
      let tmpSid = s.sessionIdRef.current;
      if (!tmpSid) {
        tmpSid = genId();
      }
      earlyService = new WorkerTelegramService(tmpSid, (msg) => addLog(s, msg), () => {});
      (window as any).__earlyGramService = earlyService;
      s.tgService.current = earlyService;
      earlyService.warmUp?.(2).catch(() => {});
    } else {
      s.tgService.current = earlyService;
    }

    const bgSetup = (async () => {
      await preloadApiCreds();
      const saved = await dbGet<string>('sessionId');
      if (saved) { s.sessionIdRef.current = saved; }
      else {
        s.sessionIdRef.current = genId();
        dbSet('sessionId', s.sessionIdRef.current).catch(() => {});
      }
      if (earlyService && s.sessionIdRef.current !== (earlyService as any).config?.sessionId) {
        (earlyService as any).config.sessionId = s.sessionIdRef.current;
      }

      earlyService!.connect(2).catch(() => {});
      await setEncryptionKey(s.sessionIdRef.current);
      let initialTheme: 'light' | 'dark' = 'light';
      try {
        const saved = await dbGet<string>('theme');
        if (saved === 'light' || saved === 'dark') initialTheme = saved as 'light' | 'dark';
      } catch {}
      let initialQuality: 'min' | 'medium' | 'max' = 'max';
      try {
        const q = await dbGet<string>('imageQuality');
        if (q === 'min' || q === 'medium' || q === 'max') initialQuality = q as 'min' | 'medium' | 'max';
      } catch {}
      let initialAnimations = true;
      try {
        const a = await dbGet<boolean>('animationsEnabled');
        if (typeof a === 'boolean') initialAnimations = a;
      } catch {}
      const [bootAuthenticated, bootInvalidated] = await Promise.all([
        dbGet<string>('authenticated'),
        dbGet<string>('authInvalidated'),
      ]);
      const bootDialogs = !!bootAuthenticated && !bootInvalidated;
      const tguiEarly = new TelegramUI(container, callbacks, {
        page: (bootDialogs ? 'dialogs' : 'auth') as AppState['page'],
        authStep: (bootDialogs ? 'loading' : 'phone') as AppState['authStep'],
        theme: initialTheme as AppState['theme'],
        imageQuality: initialQuality as AppState['imageQuality'],
        animationsEnabled: initialAnimations,
        dialogs: [],
        connectionStatus: 'connecting' as AppState['connectionStatus'],
      });
      s.tgui.current = tguiEarly;
      try { container.style.visibility = ''; } catch {}
      await Promise.allSettled([
        loadOrphanedDialogs(s),
        loadMessageCache(s),
        loadCachedDialogs(s),
      ]);
      setTimeout(() => dbCompact().catch(() => {}), 5000);
      const langCode = await getLangCode();
      const cacheKey = 'langStrings_' + LANG_CACHE_VERSION + '_' + langCode;
      try {
        let cached = await dbGet<Record<string, string>>(cacheKey);
        if (!cached || Object.keys(cached).length === 0) {
          const oldKey = 'langStrings_' + langCode;
          cached = await dbGet<Record<string, string>>(oldKey);
        }
        const extra = { ...(getBuiltinStrings('en') || {}) };
        setStrings({ ...extra, ...(cached || {}) });
        if (cached) s.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
      } catch {}
    })();

    await bgSetup.catch(() => {});
    const [savedLang2, savedId2, authInvalidated, wasAuthenticated] = await Promise.all([
      dbGet<string>('langCode'),
      dbGet<string>('sessionId'),
      dbGet<string>('authInvalidated'),
      dbGet<string>('authenticated'),
    ]);
    const savedLang = savedLang2;
    const savedId = savedId2 || s.sessionIdRef.current;
    const service = s.tgService.current as WorkerTelegramService;
    let bootAuthState: 'none' | 'code_sent' | 'password_needed' | 'authenticated' = 'none';
    try {
      bootAuthState = await service.getAuthState();
    } catch {}
    let liveAuthed = bootAuthState === 'authenticated';
    if (liveAuthed) service.authenticated = true;
    bootLog.info('[boot] wasAuthenticated=' + !!wasAuthenticated + ' authInvalidated=' + !!authInvalidated + ' liveAuthed=' + liveAuthed);
    if (savedLang) s.tgui.current!.dispatch({ type: 'SET_LANG_CODE', langCode: savedLang });
    if (liveAuthed && !authInvalidated) {
      s.tgui.current!.dispatch({ type: 'SET_PAGE', page: 'dialogs' as any });
      s.tgui.current!.dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' as any });
    }
    const handleUpdate = createHandleUpdate(s);
    (service as any).onUpdate = handleUpdate;
    try { (service as any).workerClient?.onUpdate?.((msg: any) => handleUpdate(msg.constructorId, msg.data)); } catch {}

    service.onAuthInvalidated = async () => {
      const prevPage = s.tgui.current?.state?.page;
      const curStep = s.tgui.current?.state?.authStep;
      const isAuthenticatedNow = await dbGet<string>('authenticated');
      const wasDialogs = prevPage === 'dialogs' || !!isAuthenticatedNow;
      s.tgui.current?.dispatch({ type: 'SET_DIALOGS', dialogs: [] });
      s.tgui.current?.setConnectionStatus('disconnected');
      s.tgui.current?.setPage('auth');

      if (curStep !== 'qr_login' && wasDialogs) {
        s.tgui.current?.setAuthStep('phone');
      }

      if (wasDialogs && curStep !== 'qr_login') {
        s.tgui.current?.setError('Session terminated from another device');
      } else if (!s.tgui.current?.state?.error) {
        s.tgui.current?.setError('');
      }
      await dbDel('authenticated').catch(() => {});
      await dbSet('authInvalidated', '1').catch(() => {});
    };
    await dbDel('authInvalidated').catch(() => {});

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);
    let connectDone = false;
    let bootRecovered = false;
    const doConnect = async () => {
      await service.connect(2, abortController.signal);
      connectDone = true;
      clearTimeout(timeoutId);
    };
    const recoverAuthAfterConnect = async () => {
      if (liveAuthed) return;
      try {
        const freshAuthState = await service.getAuthState();
        if (freshAuthState === 'authenticated') {
          liveAuthed = true;
          service.authenticated = true;
          bootRecovered = true;
          bootLog.info('[boot] recovered authenticated after connect');
          await dbSet('authenticated', '1').catch(() => {});
          await dbDel('authInvalidated').catch(() => {});
          if (!s.tgui.current) return;
          warmupEmojiPipeline(s);
          s.tgui.current.setConnectionStatus('connected');
          s.tgui.current.setPage('dialogs');
          try {
            await fetchSelfUserId(s);
            const dialogsResult = await service.fetchDialogs();
            if (dialogsResult) setDialogsFromServer(s, dialogsResult);
          } catch (e: any) {
            addLog(s, tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
          }
          warmupEmojiPipeline(s);
        }
      } catch {}
    };
    if (!wasAuthenticated) {
      doConnect().then(() => recoverAuthAfterConnect()).catch(async (e) => {
        clearTimeout(timeoutId);
        addLog(s, 'Connect error: ' + ((e as any)?.message || 'unknown'));
        await dbDel('authenticated').catch(() => {});
        if (s.tgui.current && s.tgui.current.state.authStep === 'phone') {
          s.tgui.current.setConnectionStatus('disconnected');
        }
      });
    } else {
      try {
        await doConnect();
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
    }
    if (wasAuthenticated && !connectDone) {
      try { await new Promise(r => setTimeout(r, 500)); } catch {}
      if (!connectDone) {
        try { await new Promise<void>((res, rej) => { const t = setInterval(() => { if (connectDone) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); rej(new Error('connect timeout')); }, 10000); }); } catch {}
      }
    }
    if (!liveAuthed && connectDone) {
      await recoverAuthAfterConnect();
    }

    const langDeps = { tgui: s.tgui, tgService: s.tgService };
    const loadStringsFn = (code?: string) => loadStrings(langDeps, code);
    s.loadStringsRef.current = loadStringsFn;

    s.tgui.current!.setSessionId(savedId);
    addLog(s, t(S.LOG_CONNECTED));

    (async () => {
      if (!s.tgui.current) return;
      try {
        await loadStringsFn();
      } catch {}
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

    if (liveAuthed) {
      await dbSet('authenticated', '1').catch(() => {});
      await dbDel('authInvalidated').catch(() => {});
      s.tgui.current!.setConnectionStatus('connected');
      s.tgui.current!.setPage('dialogs');
      if (bootRecovered) return;
      warmupEmojiPipeline(s);
      try {
        await fetchSelfUserId(s);
        const dialogsResult = await service.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
      } catch (e: any) {
        addLog(s, tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
      }
    } else {
      await dbDel('authenticated').catch(() => {});
      s.tgui.current!.setPage('auth');
      s.tgui.current!.dispatch({ type: 'SET_DIALOGS', dialogs: [] });
      try {
        try {
          bootAuthState = await service.getAuthState();
        } catch {}
        const state = bootAuthState;
        if (state === 'code_sent') {
          try {
            const [ph, hh] = await Promise.all([
              dbGet<string>('authPhone').catch(() => ''),
              dbGet<string>('authPhoneHash').catch(() => ''),
            ]);
            if (ph) s.tgui.current!.dispatch({ type: 'SET_PHONE', phone: ph });
            if (hh) s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: hh });
          } catch {}
          s.tgui.current!.setAuthStep('code');
        }
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
