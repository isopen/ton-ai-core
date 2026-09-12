import { getGramDb } from './gram-db';
import { getLogger } from '@ton-ai/gram-debug';

const g = () => getGramDb();

const dbLog = getLogger('gram-browser:db');

let writeFailures = 0;

export function dbWriteFailures(): number {
  return writeFailures;
}

function noteWriteError(op: string, key: string, err: any): void {
  writeFailures++;
  if (writeFailures === 1 || writeFailures % 100 === 0) {
    dbLog.warn('[db] write failed op=' + op + ' key=' + key + ' total=' + writeFailures + ' err=' + (err?.message || String(err)));
  }
}

async function write<T>(op: string, key: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    noteWriteError(op, key, e);
    throw e;
  }
}

export async function setEncryptionKey(sessionId: string | null): Promise<void> { return g().setEncryptionKey(sessionId); }

export async function dbGet<T = any>(key: string): Promise<T | undefined> { return g().get<T>(key); }
export async function dbSet(key: string, value: any): Promise<void> { return write('set', key, () => g().set(key, value)); }
export async function dbDel(key: string): Promise<void> { return write('del', key, () => g().del(key)); }
export async function dbGetMany<T = any>(keys: string[]): Promise<Record<string, T | undefined>> { return g().getMany<T>(keys); }
export async function dbKeys(prefix: string): Promise<string[]> { return g().keys(prefix); }
export async function dbListAvatars(): Promise<Array<{ opfsName: string; dataUri: string }>> { return g().listAvatars(); }
export async function dbDeleteAvatarByOpfsName(opfsName: string): Promise<void> { return g().deleteAvatarByOpfsName(opfsName); }
export async function dbCompact(): Promise<void> { return g().compact(); }
export async function dbClearCacheKeepSession(preserveKeys: string[] = []): Promise<void> { return write('clearKeepSession', '', () => g().clearCacheKeepSession(preserveKeys)); }
