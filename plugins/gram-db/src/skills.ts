import { crypton } from '@ton-ai/core';
import { getLogger } from '@ton-ai/gram-debug';
import { GramDbComponents, KeyManager, EncryptedStore, StorageEngine, DbVersion, currentDbVersion } from './components';
import type { StoredSession } from './types';
import { Buffer } from 'buffer';

const dbLog = getLogger('gram-db');

const KEY_INDEX_KEY = '__key_index';
const SESSION_ID_KEY = '__g';
const SALT_KEY = '__mk_salt';
const KEY_VERIFY_KEY = '__mk_verify';
const VERSION_KEY = '__ver';

export class GramDbSkills {
  private components: GramDbComponents;
  private ready = false;

  private _sessionId: string | null = null;
  private _masterKey: Buffer | null = null;
  private _keyIndex: string[] | null = null;
  private _opQueue: Promise<void> = Promise.resolve();

  constructor(components: GramDbComponents) {
    this.components = components;
  }

  isReady(): boolean { return this.ready; }
  get engine(): StorageEngine { return this.components.engine; }

  private _serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this._opQueue.then(fn, () => fn());
    this._opQueue = p.then(() => {}, () => {});
    return p;
  }

  private _indexLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks: any = (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined);
    if (locks?.request) {
      try {
        return locks.request('gram-db-key-index', async () => fn());
      } catch {
        return fn();
      }
    }
    return fn();
  }

  private async _withSaltLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks: any = (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined);
    if (locks?.request) {
      try {
        return await locks.request('gram-db-salt-lock', async () => fn());
      } catch {
        return fn();
      }
    }
    return fn();
  }

  private scrubMasterKey(): void {
    if (this._masterKey) this._masterKey.fill(0);
  }

  private async encKey(key: string): Promise<string> {
    if (key === 'sessionId') return SESSION_ID_KEY;
    if (!this._sessionId) return key;
    return KeyManager.hash(this._sessionId, key);
  }

  private async encryptValue(val: any): Promise<string> {
    return EncryptedStore.encryptToBase64(this._masterKey!,
      typeof val === 'string' ? val : JSON.stringify(val));
  }

  async setEncryptionKey(sessionId: string | null): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();

      return this._withSaltLock(async () => {
      this.scrubMasterKey();
      this._sessionId = sessionId;
      if (sessionId) {
        const rawSalt = await this.engine.getItem(SALT_KEY);
        if (rawSalt) {
          this._masterKey = await KeyManager.deriveKey(sessionId, Buffer.from(rawSalt, 'base64'));
          const storedHash = await this.engine.getItem(KEY_VERIFY_KEY);
          if (storedHash) {
            const computedHash = await KeyManager.createKeyHash(this._masterKey);
            if (!crypton.constantTimeEqual(computedHash, Buffer.from(storedHash, 'base64'))) {
              this.scrubMasterKey();
              this._masterKey = null;
              await this.engine.setItem(SALT_KEY, '');
              await this.engine.setItem(KEY_VERIFY_KEY, '');
              this._keyIndex = null;
            }
          }
        }
        if (!this._masterKey) {
          const salt = await KeyManager.generateSalt();
          this._masterKey = await KeyManager.deriveKey(sessionId, salt);
          const keyHash = await KeyManager.createKeyHash(this._masterKey);
          await this.engine.setItem(SALT_KEY, salt.toString('base64'));
          await this.engine.setItem(KEY_VERIFY_KEY, keyHash.toString('base64'));
          salt.fill(0);
        }
      } else {
        this._masterKey = null;
      }
      this._keyIndex = null;
      this.ready = true;
      });
    });
  }

  dispose(): void {
    this.scrubMasterKey();
    this._masterKey = null;
    this._sessionId = null;
    this._keyIndex = null;
    this.ready = false;
  }

  private async ensureEngine(): Promise<void> {
    if (!this.components.initialized) {
      await this.components.initialize();
    }
  }

  async getSessionId(): Promise<string | null> {
    return this._serial(async () => {
      await this.ensureEngine();
      return this.engine.getItem(SESSION_ID_KEY);
    });
  }

  async setSessionId(sid: string): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      await this.engine.setItem(SESSION_ID_KEY, sid);
    });
  }

  private async _getInternal<T = any>(key: string): Promise<T | undefined> {
    if (key === 'sessionId') {
      const raw = await this.engine.getItem(SESSION_ID_KEY);
      return raw as unknown as T | undefined;
    }
    const hk = await this.encKey(key);
    let raw = await this.engine.getItem(hk);
    let isFallback = false;
    if (!raw && hk !== key) {
      raw = await this.engine.getItem(key);
      if (raw) isFallback = true;
    }
    if (!raw) return undefined;
    if (!this._masterKey) {
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
    if (isFallback) {
      try {
        const s = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
        let result: T;
        try { result = JSON.parse(s) as T; } catch { result = s as unknown as T; }
        return result;
      } catch {}
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
    try {
      const s = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
      let result: T;
      try { result = JSON.parse(s) as T; } catch { result = s as unknown as T; }
      return result;
    } catch {
      if (hk !== key) {
        const fallbackRaw = await this.engine.getItem(key);
        if (fallbackRaw) {
          try {
            const s2 = await EncryptedStore.decryptFromBase64(this._masterKey, fallbackRaw);
            let r2: T;
            try { r2 = JSON.parse(s2) as T; } catch { r2 = s2 as unknown as T; }
            return r2;
          } catch {}
          try { return JSON.parse(fallbackRaw) as T; } catch { return fallbackRaw as unknown as T; }
        }
      }
      return undefined;
    }
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    return this._serial(async () => {
      await this.ensureEngine();
      return this._getInternal<T>(key);
    });
  }

  private async _setInternal(key: string, value: any): Promise<void> {
    if (key === 'sessionId') {
      await this.engine.setItem(SESSION_ID_KEY, String(value));
      return;
    }
    const hk = await this.encKey(key);
    const encVal = this._masterKey
      ? await this.encryptValue(value)
      : (typeof value === 'string' ? value : JSON.stringify(value));
    await this.engine.setItem(hk, encVal as string);
    if (this._sessionId) {
      await this._indexLock(async () => {
        this._keyIndex = null;
        const idx = await this._loadKeyIndexInternal();
        if (!idx.includes(key)) {
          idx.push(key);
          this._keyIndex = idx;
          await this._saveKeyIndexInternal();
        }
      });
    }
  }

  async set(key: string, value: any): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      return this._setInternal(key, value);
    });
  }

  private async _delInternal(key: string): Promise<void> {
    if (key === 'sessionId') {
      await this.engine.removeItem(SESSION_ID_KEY);
      return;
    }
    const hk = await this.encKey(key);
    await this.engine.removeItem(hk);
    if (this._sessionId) {
      await this._indexLock(async () => {
        this._keyIndex = null;
        const idx = await this._loadKeyIndexInternal();
        this._keyIndex = idx.filter(k => k !== key);
        await this._saveKeyIndexInternal();
      });
    }
  }

  async del(key: string): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      return this._delInternal(key);
    });
  }

  async getMany<T = any>(keys: string[]): Promise<Record<string, T | undefined>> {
    return this._serial(async () => {
      await this.ensureEngine();
      const result: Record<string, T | undefined> = {};
      for (const key of keys) {
        result[key] = await this._getInternal<T>(key);
      }
      return result;
    });
  }

  async keys(prefix: string): Promise<string[]> {
    return this._serial(async () => {
      await this.ensureEngine();
      this._keyIndex = null;
      const index = await this._loadKeyIndexInternal();
      const filtered = index.filter(k => k.startsWith(prefix));
      if (filtered.length === 0) {
        dbLog.warn('[gram-db] keys empty for prefix=' + prefix + ' (index lost or no data)');
      }
      return filtered;
    });
  }

  async delMany(keys: string[]): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      for (const key of keys) {
        await this._delInternal(key);
      }
    });
  }

  private async _loadKeyIndexInternal(): Promise<string[]> {
    if (this._keyIndex) return this._keyIndex;
    const hk = await this.encKey(KEY_INDEX_KEY);
    let raw = await this.engine.getItem(hk);
    if (!raw && hk !== KEY_INDEX_KEY) {
      raw = await this.engine.getItem(KEY_INDEX_KEY);
      if (raw) {
        try {
          if (this._masterKey) {
            try {
              const s = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
              JSON.parse(s);
              await this.engine.setItem(hk, raw);
            } catch {
              await this.engine.setItem(hk, await EncryptedStore.encryptToBase64(this._masterKey!, raw));
            }
          } else {
            await this.engine.setItem(hk, raw);
          }
          await this.engine.removeItem(KEY_INDEX_KEY);
        } catch {}
      }
    }
    if (!raw) { this._keyIndex = []; return this._keyIndex; }
    if (!this._masterKey) {
      try { this._keyIndex = JSON.parse(raw); } catch { this._keyIndex = []; }
      if (!Array.isArray(this._keyIndex)) this._keyIndex = [];
      return this._keyIndex;
    }
    try {
      const s = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
      this._keyIndex = JSON.parse(s);
      if (!Array.isArray(this._keyIndex)) this._keyIndex = [];
    } catch {
      try { this._keyIndex = JSON.parse(raw); } catch { this._keyIndex = []; }
      if (!Array.isArray(this._keyIndex)) this._keyIndex = [];
    }
    return this._keyIndex;
  }

  private async loadKeyIndex(): Promise<string[]> {
    return this._loadKeyIndexInternal();
  }

  private async _saveKeyIndexInternal(): Promise<void> {
    if (!this._sessionId || !this._keyIndex) return;
    const hk = await this.encKey(KEY_INDEX_KEY);
    await this.engine.setItem(hk,
      await EncryptedStore.encryptToBase64(this._masterKey!, JSON.stringify(this._keyIndex)));
  }

  private async saveKeyIndex(): Promise<void> {
    return this._saveKeyIndexInternal();
  }

  async init(): Promise<void> {
    await this.components.initialize();
    await this.migrateIfNeeded();
  }

  private async migrateIfNeeded(): Promise<void> {
    const rawVer = await this.engine.getItem(VERSION_KEY);
    const ver = rawVer !== null ? parseInt(rawVer, 10) : DbVersion.Initial;
    if (ver >= currentDbVersion()) return;
    await this.engine.setItem(VERSION_KEY, String(currentDbVersion()));
  }

  async saveSession(sessionId: string, data: StoredSession): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      const mk = await this.ensureMasterKey(sessionId);
      const hk = await this.encKey('session:' + sessionId);
      await this.engine.setItem(hk,
        await EncryptedStore.encryptToBase64(mk, JSON.stringify(data)));
    });
  }

  async loadSession(sessionId: string): Promise<StoredSession | null> {
    return this._serial(async () => {
      await this.ensureEngine();
      const mk = await this.ensureMasterKey(sessionId);
      const hk = await this.encKey('session:' + sessionId);
      const raw = await this.engine.getItem(hk);
      if (!raw) return null;
      try {
        const s = await EncryptedStore.decryptFromBase64(mk, raw);
        return JSON.parse(s);
      } catch {
        return null;
      }
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      const hk = await this.encKey('session:' + sessionId);
      await this.engine.removeItem(hk);
    });
  }

  async setAvatarEncryptionKey(sessionId: string | null): Promise<void> {
    await this.setEncryptionKey(sessionId);
  }

  async getAvatar(key: string): Promise<string | null> {
    return this._serial(async () => {
      if (!this._masterKey) return null;
      await this.ensureEngine();
      const hk = await this.encKey('avatar:' + key);
      const raw = await this.engine.getItem(hk);
      if (!raw) return null;
      try {
        const val = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
        return val.startsWith('data:') ? val : null;
      } catch {
        return null;
      }
    });
  }

  async saveAvatar(key: string, dataUri: string): Promise<void> {
    return this._serial(async () => {
      if (!this._masterKey) return;
      await this.ensureEngine();
      const hk = await this.encKey('avatar:' + key);
      await this.engine.setItem(hk,
        await EncryptedStore.encryptToBase64(this._masterKey, dataUri));
      if (this._sessionId) {
        const avatarUserKey = 'avatar:' + key;
        await this._indexLock(async () => {
          this._keyIndex = null;
          const idx = await this._loadKeyIndexInternal();
          if (!idx.includes(avatarUserKey)) {
            idx.push(avatarUserKey);
            this._keyIndex = idx;
            await this._saveKeyIndexInternal();
          }
        });
      }
    });
  }

  async getTgsJson(key: string): Promise<string | null> {
    return this._serial(async () => {
      if (!this._masterKey) return null;
      await this.ensureEngine();
      const hk = await this.encKey('tgs:' + key);
      const raw = await this.engine.getItem(hk);
      if (!raw) return null;
      try { return await EncryptedStore.decryptFromBase64(this._masterKey, raw); } catch { return null; }
    });
  }

  async saveTgsJson(key: string, json: string): Promise<void> {
    return this._serial(async () => {
      if (!this._masterKey) return;
      await this.ensureEngine();
      const hk = await this.encKey('tgs:' + key);
      await this.engine.setItem(hk, await EncryptedStore.encryptToBase64(this._masterKey, json));
      if (this._sessionId) {
        const tgsKey = 'tgs:' + key;
        await this._indexLock(async () => {
          this._keyIndex = null;
          const idx = await this._loadKeyIndexInternal();
          if (!idx.includes(tgsKey)) { idx.push(tgsKey); this._keyIndex = idx; await this._saveKeyIndexInternal(); }
        });
      }
    });
  }

  async listAvatars(): Promise<Array<{ opfsName: string; dataUri: string }>> {
    return this._serial(async () => {
      if (!this._masterKey) return [];
      await this.ensureEngine();
      const result: Array<{ opfsName: string; dataUri: string }> = [];
      const allKeys = await this.engine.getAllKeys();
      for (const opfsName of allKeys) {
        try {
          const raw = await this.engine.getItem(opfsName);
          if (!raw) continue;
          const val = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
          if (val.startsWith('data:')) {
            result.push({ opfsName, dataUri: val });
          }
        } catch {}
      }
      return result;
    });
  }

  async deleteAvatar(key: string): Promise<void> {
    return this._serial(async () => {
      if (!this._masterKey) return;
      await this.ensureEngine();
      const hk = await this.encKey('avatar:' + key);
      await this.engine.removeItem(hk);
      if (this._sessionId) {
        const avatarUserKey = 'avatar:' + key;
        await this._indexLock(async () => {
          this._keyIndex = null;
          const idx = await this._loadKeyIndexInternal();
          this._keyIndex = idx.filter(k => k !== avatarUserKey);
          await this._saveKeyIndexInternal();
        });
      }
    });
  }

  async deleteAvatarByOpfsName(opfsName: string): Promise<void> {
    return this._serial(async () => {
      if (!this._masterKey) return;
      await this.ensureEngine();
      await this.engine.removeItem(opfsName);
    });
  }

  async compact(): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      if (typeof (this.engine as any).compact === 'function') {
        await (this.engine as any).compact();
      }
    });
  }

  async clearCache(): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      await this.engine.clear();
      this._keyIndex = null;
      this._sessionId = null;
      this.scrubMasterKey();
      this._masterKey = null;
    });
  }

  async clearCacheKeepSession(preserveKeys: string[] = []): Promise<void> {
    return this._serial(async () => {
      await this.ensureEngine();
      const sid = await this.engine.getItem(SESSION_ID_KEY);
      const salt = await this.engine.getItem(SALT_KEY);
      const keyHash = await this.engine.getItem(KEY_VERIFY_KEY);
      let sessionData: string | null = null;
      if (sid) {
        const hk = await KeyManager.hash(sid, 'session:' + sid);
        sessionData = await this.engine.getItem(hk);
      }
      const keep = Array.from(new Set(preserveKeys.filter(k => k && k !== 'sessionId')));
      const preserved = new Map<string, string>();
      const restoredKeys: string[] = [];
      for (const key of keep) {
        const hk = await this.encKey(key);
        const raw = await this.engine.getItem(hk);
        if (raw != null) {
          preserved.set(hk, raw);
          restoredKeys.push(key);
          continue;
        }
        if (hk !== key) {
          const plain = await this.engine.getItem(key);
          if (plain != null) {
            preserved.set(key, plain);
            restoredKeys.push(key);
          }
        }
      }
      await this.engine.clear();
      if (salt) await this.engine.setItem(SALT_KEY, salt);
      if (keyHash) await this.engine.setItem(KEY_VERIFY_KEY, keyHash);
      if (sid) {
        await this.engine.setItem(SESSION_ID_KEY, sid);
        if (sessionData) {
          const hk = await KeyManager.hash(sid, 'session:' + sid);
          await this.engine.setItem(hk, sessionData);
        }
      }
      for (const [k, v] of preserved) {
        await this.engine.setItem(k, v);
      }
      this._keyIndex = restoredKeys;
      if (this._sessionId && this._masterKey) {
        await this._saveKeyIndexInternal();
      }
    });
  }

  private async ensureMasterKey(sessionId: string): Promise<Buffer> {
    if (this._masterKey) return this._masterKey;
    return KeyManager.deriveMasterKey(sessionId);
  }
}
