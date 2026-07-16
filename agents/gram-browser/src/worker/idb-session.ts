import { getGramDb } from '../utils/gram-db';

export interface StoredSession {
    authKey: string;
    authKeyId: string;
    serverSalt: string;
    serverTimeOffset: number;
    dcId: number;
    authenticated: boolean;
    homeAuthKey?: string;
    homeAuthKeyId?: string;
    homeServerSalt?: string;
    homeDcId?: number;
    pendingCodeHash?: string;
    passwordPending?: boolean;
}

export async function saveSession(sessionId: string, data: StoredSession): Promise<void> {
    return getGramDb().saveSession(sessionId, data);
}

export async function loadSession(sessionId: string): Promise<StoredSession | null> {
    return getGramDb().loadSession(sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
    return getGramDb().deleteSession(sessionId);
}
