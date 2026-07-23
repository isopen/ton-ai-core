import type { WorkerTelegramService } from '@/utils/worker-telegram-service';
import type { TelegramUI, PeerInfo, Dialog, Message } from '@ton-ai/gram-ui';

export interface GramState {
  sessionIdRef: { current: string };
  tgService: { current: WorkerTelegramService | null };
  tgui: { current: TelegramUI | null };
  loadStringsRef: { current: (code?: string) => Promise<void> };
  selectedPeerRef: { current: PeerInfo | null };
  messagesCache: { current: Map<string, Message[]> };
  dialogsRef: { current: Dialog[] };
  dialogsLoadedRef: { current: boolean };
  typingTimers: { current: Map<string, ReturnType<typeof setTimeout>> };
  typingMap: { current: Map<string, Map<string, { userId: string; userName: string; action: string; ts: number }>> };
  lastDialogTyping: { current: Map<string, string> };
  lastHeaderTyping: { current: string };
  userNameMap: { current: Map<string, string> };
  peerInfoMap: { current: Map<string, { firstName?: string; lastName?: string; username?: string; title?: string }> };
  readOutboxMap: { current: Map<string, number> };
  readInboxMap: { current: Map<string, number> };
  loadingHistoryRef: { current: Set<string> };
  historyInitRef: { current: Set<string> };
  maxFetchedIdRef: { current: Map<string, number> };
  dialogsFlushRef: { current: number | null };
  messageFlushRef: { current: number | null };
  readTimerRef: { current: ReturnType<typeof setTimeout> | null };
  scrollReadRef: { current: ReturnType<typeof setTimeout> | null };
  scrollReadAttached: { current: boolean };
  selfUserIdFetchedRef: { current: boolean };
  orphanedDialogsRef: { current: Map<string, Dialog> };
  loadStringsSeq: number;
  cleanupFns: (() => void)[];
  cancelDocumentDownloads: () => void;
}

export function createGramState(): GramState {
  return {
    sessionIdRef: { current: '' },
    tgService: { current: null },
    tgui: { current: null },
    loadStringsRef: { current: async () => {} },
    selectedPeerRef: { current: null },
    messagesCache: { current: new Map() },
    dialogsRef: { current: [] },
    dialogsLoadedRef: { current: false },
    typingTimers: { current: new Map() },
    typingMap: { current: new Map() },
    lastDialogTyping: { current: new Map() },
    lastHeaderTyping: { current: '' },
    userNameMap: { current: new Map() },
    peerInfoMap: { current: new Map() },
    readOutboxMap: { current: new Map() },
    readInboxMap: { current: new Map() },
    loadingHistoryRef: { current: new Set() },
    historyInitRef: { current: new Set() },
    maxFetchedIdRef: { current: new Map() },
    dialogsFlushRef: { current: null },
    messageFlushRef: { current: null },
    readTimerRef: { current: null },
    scrollReadRef: { current: null },
    scrollReadAttached: { current: false },
    selfUserIdFetchedRef: { current: false },
    orphanedDialogsRef: { current: new Map() },
    loadStringsSeq: 0,
    cleanupFns: [],
    cancelDocumentDownloads: () => {},
  };
}
