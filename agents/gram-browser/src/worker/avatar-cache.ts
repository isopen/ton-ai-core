import { getGramDb } from '../utils/gram-db';

export async function setAvatarEncryptionKey(sessionId: string | null): Promise<void> {
    const db = getGramDb();
    await db.getSessionId();
    return db.setAvatarEncryptionKey(sessionId);
}