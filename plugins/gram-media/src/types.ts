export interface MediaTransport {
    callRpc(method: string, params?: Record<string, any>): Promise<any>;
    downloadFile(info: { document?: any; photo?: any }): Promise<{ bytes: string | ArrayBuffer | Uint8Array; type: string; cacheSource?: string } | null>;
    downloadFiles(docs: Array<{ document: any; priority?: number }>): Promise<Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>>;
    startPhotoDownload(photo: any, sizeType: string, messageId: number | string, onProgress: (pct: number) => void): Promise<any>;
    startVideoStream(document: any, onChunk: (data: ArrayBuffer | undefined, final: boolean, fileType: string) => void): Promise<{ cacheSource?: string }>;
    cancelPhotoDownloads(): Promise<void>;
    batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>>;
    batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>>;
}

export type MediaDispatch = (action: Record<string, any>) => void;

export interface SelectedPeer {
    type: string;
    id: string;
    accessHash?: any;
}

export interface MediaMessageLike {
    id: number;
    media?: any;
}

export interface MediaHost {
    tgService: { current: MediaTransport | null };
    dispatch: MediaDispatch;
    selectedPeerRef: { current: SelectedPeer | null };
    cleanupFns: (() => void)[];
    debug?: boolean;
}

export interface PhotoCacheProbeResult {
    messages: MediaMessageLike[];
    cachedIds: number[];
}

export type EmojiKind = 'tgs' | 'video' | 'img' | null;
