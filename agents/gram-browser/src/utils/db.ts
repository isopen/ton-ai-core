import { getGramDb } from './gram-db';

const g = () => getGramDb();

export async function dbInit(): Promise<void> { return g().init(); }
export async function migrateFromLocalStorage(): Promise<void> { return g().migrateFromLocalStorage(); }
export async function setEncryptionKey(sessionId: string | null): Promise<void> { return g().setEncryptionKey(sessionId); }

export async function dbGet<T = any>(key: string): Promise<T | undefined> { return g().get<T>(key); }
export async function dbSet(key: string, value: any): Promise<void> { return g().set(key, value); }
export async function dbDel(key: string): Promise<void> { return g().del(key); }
export async function dbGetMany<T = any>(keys: string[]): Promise<Record<string, T | undefined>> { return g().getMany<T>(keys); }
export async function dbKeys(prefix: string): Promise<string[]> { return g().keys(prefix); }
export async function dbDelMany(keys: string[]): Promise<void> { return g().delMany(keys); }
export async function dbGetAvatar(key: string): Promise<string | null> { return g().getAvatar(key); }
export async function dbSaveAvatar(key: string, dataUri: string): Promise<void> { return g().saveAvatar(key, dataUri); }
export async function dbClearCacheKeepSession(): Promise<void> { return g().clearCacheKeepSession(); }
