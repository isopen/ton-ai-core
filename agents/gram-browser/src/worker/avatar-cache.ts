import { getLogger } from '@ton-ai/gram-debug';
import { getGramDb } from '../utils/gram-db';

const log = getLogger('gram-browser');

const wlog = (...args: any[]) => log.debug(...args);

export async function setAvatarEncryptionKey(sessionId: string | null): Promise<void> {
    const db = getGramDb();
    await db.getSessionId();
    return db.setAvatarEncryptionKey(sessionId);
}

export async function getAvatarFromCache(key: string): Promise<string | null> {
    try {
        const val = await getGramDb().getAvatar(key);
        return val;
    } catch (e: any) {
        log.error('[avatar-cache] GET error:', e?.message);
        return null;
    }
}

export async function needAvatar(key: string): Promise<boolean> {
    const db = getGramDb();
    if (!db) return true;
    const cached = await db.getAvatar(key);
    if (cached) {
        wlog('[avatar] HIT cache:', key);
        return false;
    }
    return true;
}

export async function saveAvatarToCache(key: string, dataUri: string): Promise<void> {
    try {
        await getGramDb().saveAvatar(key, dataUri);
    } catch (e: any) {
        log.error('[avatar-cache] SAVE error:', e?.message);
    }
}
