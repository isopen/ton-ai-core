import { crypton } from '@ton-ai/core';
import { GramDbComponents, KeyManager, EncryptedStore, StorageEngine, DbVersion, currentDbVersion } from './components';
import type { StoredSession } from './types';
import { Buffer } from 'buffer';

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

  constructor(components: GramDbComponents) {
    this.components = components;
  }

  isReady(): boolean { return this.ready; }
  get engine(): StorageEngine { return this.components.engine; }

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
    await this.ensureEngine();
    return this.engine.getItem(SESSION_ID_KEY);
  }

  async setSessionId(sid: string): Promise<void> {
    await this.ensureEngine();
    await this.engine.setItem(SESSION_ID_KEY, sid);
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    await this.ensureEngine();
    if (key === 'sessionId') {
      const raw = await this.engine.getItem(SESSION_ID_KEY);
      return raw as unknown as T | undefined;
    }
    if (!this._masterKey) {
      const hk = await this.encKey(key);
      const raw = await this.engine.getItem(hk);
      if (!raw) return undefined;
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    }
    const hk = await this.encKey(key);
    const raw = await this.engine.getItem(hk);
    if (!raw) return undefined;

    try {
      const s = await EncryptedStore.decryptFromBase64(this._masterKey, raw);
      let result: T;
      try { result = JSON.parse(s) as T; } catch { result = s as unknown as T; }
      return result;
    } catch {}

    return undefined;
  }

  async set(key: string, value: any): Promise<void> {
    await this.ensureEngine();
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
      const idx = await this.loadKeyIndex();
      if (!idx.includes(key)) {
        idx.push(key);
        this._keyIndex = idx;
        await this.saveKeyIndex();
      }
    }
  }

  async del(key: string): Promise<void> {
    await this.ensureEngine();
    if (key === 'sessionId') {
      await this.engine.removeItem(SESSION_ID_KEY);
      return;
    }
    const hk = await this.encKey(key);
    await this.engine.removeItem(hk);
    if (this._sessionId) {
      const idx = await this.loadKeyIndex();
      this._keyIndex = idx.filter(k => k !== key);
      await this.saveKeyIndex();
    }
  }

  async getMany<T = any>(keys: string[]): Promise<Record<string, T | undefined>> {
    await this.ensureEngine();
    const result: Record<string, T | undefined> = {};
    for (const key of keys) {
      result[key] = await this.get<T>(key);
    }
    return result;
  }

  async keys(prefix: string): Promise<string[]> {
    await this.ensureEngine();
    const index = await this.loadKeyIndex();
    return index.filter(k => k.startsWith(prefix));
  }

  async delMany(keys: string[]): Promise<void> {
    await this.ensureEngine();
    for (const key of keys) {
      await this.del(key);
    }
  }

  private async loadKeyIndex(): Promise<string[]> {
    if (this._keyIndex) return this._keyIndex;
    await this.ensureEngine();
    const hk = await this.encKey(KEY_INDEX_KEY);
    const raw = await this.engine.getItem(hk);
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
      this._keyIndex = [];
    }
    return this._keyIndex;
  }

  private async saveKeyIndex(): Promise<void> {
    if (!this._sessionId || !this._keyIndex) return;
    await this.ensureEngine();
    const hk = await this.encKey(KEY_INDEX_KEY);
    await this.engine.setItem(hk,
      await EncryptedStore.encryptToBase64(this._masterKey!, JSON.stringify(this._keyIndex)));
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
    await this.ensureEngine();
    const mk = await this.ensureMasterKey(sessionId);
    const hk = await this.encKey('session:' + sessionId);
    await this.engine.setItem(hk,
      await EncryptedStore.encryptToBase64(mk, JSON.stringify(data)));
  }

  async loadSession(sessionId: string): Promise<StoredSession | null> {
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
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureEngine();
    const hk = await this.encKey('session:' + sessionId);
    await this.engine.removeItem(hk);
  }

  async setAvatarEncryptionKey(sessionId: string | null): Promise<void> {
    await this.setEncryptionKey(sessionId);
  }

  async getAvatar(key: string): Promise<string | null> {
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
  }

  async saveAvatar(key: string, dataUri: string): Promise<void> {
    if (!this._masterKey) return;
    await this.ensureEngine();
    const hk = await this.encKey('avatar:' + key);
    await this.engine.setItem(hk,
      await EncryptedStore.encryptToBase64(this._masterKey, dataUri));
    if (this._sessionId) {
      const avatarUserKey = 'avatar:' + key;
      const idx = await this.loadKeyIndex();
      if (!idx.includes(avatarUserKey)) {
        idx.push(avatarUserKey);
        this._keyIndex = idx;
        await this.saveKeyIndex();
      }
    }
  }

  async listAvatars(): Promise<Array<{ opfsName: string; dataUri: string }>> {
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
  }

  async deleteAvatar(key: string): Promise<void> {
    if (!this._masterKey) return;
    await this.ensureEngine();
    const hk = await this.encKey('avatar:' + key);
    await this.engine.removeItem(hk);
    if (this._sessionId) {
      const avatarUserKey = 'avatar:' + key;
      const idx = await this.loadKeyIndex();
      this._keyIndex = idx.filter(k => k !== avatarUserKey);
      await this.saveKeyIndex();
    }
  }

  async deleteAvatarByOpfsName(opfsName: string): Promise<void> {
    if (!this._masterKey) return;
    await this.ensureEngine();
    await this.engine.removeItem(opfsName);
  }

  async compact(): Promise<void> {
    await this.ensureEngine();
    if (typeof (this.engine as any).compact === 'function') {
      await (this.engine as any).compact();
    }
  }

  async clearCache(): Promise<void> {
    await this.ensureEngine();
    await this.engine.clear();
    this._keyIndex = null;
    this._sessionId = null;
    this.scrubMasterKey();
    this._masterKey = null;
  }

  async clearCacheKeepSession(): Promise<void> {
    await this.ensureEngine();
    const sid = await this.engine.getItem(SESSION_ID_KEY);
    const salt = await this.engine.getItem(SALT_KEY);
    const keyHash = await this.engine.getItem(KEY_VERIFY_KEY);
    let sessionData: string | null = null;
    if (sid) {
      const hk = await KeyManager.hash(sid, 'session:' + sid);
      sessionData = await this.engine.getItem(hk);
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
    this._keyIndex = [];
  }

  private async ensureMasterKey(sessionId: string): Promise<Buffer> {
    if (this._masterKey) return this._masterKey;
    return KeyManager.deriveMasterKey(sessionId);
  }
}
