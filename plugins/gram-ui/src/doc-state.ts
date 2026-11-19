// External, subscribable view over the document-related slices of the app state
// (documentSources / documentProgress / documentUrls). Lets leaf components
// (VideoMessage, EmojiText, ...) read and subscribe to exactly what they need by
// message/doc id instead of threading those maps through prop chains.
import { useSyncExternalStore, type SelectorStore } from '@ton-ai/atom/hooks';

export interface DocStateSnap {
  documentSources: Record<string, string>;
  documentProgress: Record<string, number>;
  documentUrls: Record<string, string>;
}

const EMPTY: DocStateSnap = {
  documentSources: {},
  documentProgress: {},
  documentUrls: {},
};

let snap: DocStateSnap = EMPTY;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((l) => { try { l(); } catch { } }); };

/**
 * Keep the external snapshot in sync with the app state. Called by telegram-ui:
 * once per render (initial state) and after every reducer run. Detects changes
 * by reference — state.ts replaces these maps on every relevant update.
 */
export function syncDocState(state: any): void {
  if (!state || typeof state !== 'object') return;
  const next: DocStateSnap = {
    documentSources: (state.documentSources || EMPTY.documentSources) as Record<string, string>,
    documentProgress: (state.documentProgress || EMPTY.documentProgress) as Record<string, number>,
    documentUrls: (state.documentUrls || EMPTY.documentUrls) as Record<string, string>,
  };
  if (
    next.documentSources === snap.documentSources &&
    next.documentProgress === snap.documentProgress &&
    next.documentUrls === snap.documentUrls
  ) return;
  snap = next;
  notify();
}

export const docStateStore: SelectorStore<DocStateSnap> = {
  subscribe: (onChange: () => void) => {
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  },
  getState: () => snap,
};

/** Source label (memory/persisted/home-server/cdn-server/...) for a doc/message key. */
export function getDocSource(id: number | string): string | undefined {
  const v = snap.documentSources[String(id)];
  return v == null ? undefined : String(v);
}

/** Download progress for a doc/message key, -1 when not downloading. */
export function getDocProgress(id: number | string): number {
  const v = snap.documentProgress[String(id)];
  return typeof v === 'number' ? v : -1;
}

export function useDocSource(id: number | string): string | undefined {
  return useSyncExternalStore(docStateStore.subscribe, () => getDocSource(id));
}

export function useDocProgress(id: number | string): number {
  return useSyncExternalStore(docStateStore.subscribe, () => getDocProgress(id));
}

/** Whole documentSources map — for components that resolve many ids (captions, emoji text). */
export function useDocSourcesMap(): Record<string, string> {
  return useSyncExternalStore(docStateStore.subscribe, () => snap.documentSources);
}
