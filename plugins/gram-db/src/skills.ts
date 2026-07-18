import { crypton } from '@ton-ai/core';
import { GramDbComponents, KeyManager, EncryptedStore, StorageEngine, DbVersion, currentDbVersion, IV_SIZE, HMAC_LABEL, OpfsEngine } from './components';
import type { StoredSession, GramDbConfig, EngineType } from './types';
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

  constructor(components: GramDbComponents, config: GramDbConfig) {
    this.components = components;
  }

  isReady(): boolean { return this.ready; }
  setReady(ready: boolean): void { this.ready = ready; }
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
    let binlogKey: Uint8Array | null = null;
    if (sessionId) {
      const rawSalt = await this.engine.getItem(SALT_KEY);
      if (rawSalt) {
        this._masterKey = await KeyManager.deriveKey(sessionId, Buffer.from(rawSalt, 'base64'));
        const storedHash = await this.engine.getItem(KEY_VERIFY_KEY);
        if (storedHash) {
          const computedHash = await KeyManager.createKeyHash(this._masterKey);
          if (!crypton.constantTimeEqual(computedHash, Buffer.from(storedHash, 'base64'))) {
            // Key mismatch: sessionId changed, regenerate
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
      binlogKey = await crypton.hmacSha256(this._masterKey!, new TextEncoder().encode('gram-db-binlog-v1'));
    } else {
      this._masterKey = null;
    }
    if (typeof (this.engine as any).setEncryptionKey === 'function') {
      await (this.engine as any).setEncryptionKey(binlogKey ? new Uint8Array(binlogKey) : null);
    }
    this._keyIndex = null;
    this.ready = true;
  }

  async migrateStorage(targetType: EngineType): Promise<void> {
    if (this.components.engine instanceof OpfsEngine && targetType === 'opfs') return;

    const oldEngine = this.components.engine;
    const keys = await oldEngine.getAllKeys();

    const newEngine: StorageEngine = new OpfsEngine();
    await newEngine.init();

    for (const key of keys) {
      const val = await oldEngine.getItem(key);
      if (val !== null) {
        await newEngine.setItem(key, val);
      }
    }

    await this.components.replaceEngine(newEngine);
    this._keyIndex = null;
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

  // ---- Bootstrap ----

  async getSessionId(): Promise<string | null> {
    await this.ensureEngine();
    return this.engine.getItem(SESSION_ID_KEY);
  }

  async setSessionId(sid: string): Promise<void> {
    await this.ensureEngine();
    await this.engine.setItem(SESSION_ID_KEY, sid);
  }

  // ---- KV Operations ----

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

  // ---- Key Index ----

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

  // ---- Migration ----

  async migrateFromLocalStorage(): Promise<void> {
    await this.ensureEngine();
    if (typeof localStorage === 'undefined') return;
    const val = localStorage.getItem('tg_sessionId');
    if (val !== null) {
      const existing = await this.engine.getItem(SESSION_ID_KEY);
      if (existing === null) {
        await this.engine.setItem(SESSION_ID_KEY, val);
      }
      localStorage.removeItem('tg_sessionId');
    }
    for (const legacyKey of ['tg_lang_code', 'tg_worker_mode', 'tg_orphaned_dialogs']) {
      if (localStorage.getItem(legacyKey) !== null) {
        localStorage.removeItem(legacyKey);
      }
    }
  }

  async init(): Promise<void> {
    await this.components.initialize();
    await this.migrateIfNeeded();
  }

  private async migrateIfNeeded(): Promise<void> {
    const rawVer = await this.engine.getItem(VERSION_KEY);
    const ver = rawVer !== null ? parseInt(rawVer, 10) : DbVersion.Initial;
    if (ver >= currentDbVersion()) return;

    if (ver < DbVersion.TDLibStyle) {
      await this.migrateV0ToV1();
    }

    await this.engine.setItem(VERSION_KEY, String(currentDbVersion()));
  }

  private async decryptV0GC(key: Buffer, encoded: string): Promise<string | null> {
    try {
      const data = Buffer.from(encoded, 'base64');
      if (data.length < 2 + IV_SIZE + 32 || data[0] !== 0x47 || data[1] !== 0x43) return null;
      const iv = data.subarray(2, 2 + IV_SIZE);
      const ciphertext = data.subarray(2 + IV_SIZE, data.length - 32);
      const storedHmac = data.subarray(data.length - 32);
      const hmacKey = await crypton.hmacSha256(key, new TextEncoder().encode(HMAC_LABEL));
      const expectedHmac = await crypton.hmacSha256(hmacKey, new Uint8Array(data.subarray(0, data.length - 32)));
      if (!crypton.constantTimeEqual(Buffer.from(storedHmac), expectedHmac)) return null;
      return crypton.AES256CTR.process(ciphertext, key, iv, 0).toString('utf-8');
    } catch { return null; }
  }

  private async decryptV0Legacy(sessionId: string, encoded: string): Promise<string | null> {
    try {
      const V0_SALT = 16;
      const data = Buffer.from(encoded, 'base64');
      if (data.length < V0_SALT + IV_SIZE) return null;
      const salt = data.subarray(0, V0_SALT);
      const iv = data.subarray(V0_SALT, V0_SALT + IV_SIZE);
      const ciphertext = data.subarray(V0_SALT + IV_SIZE);
      const key = await KeyManager.deriveKey(sessionId, Buffer.from(salt));
      return crypton.AES256CTR.process(ciphertext, key, iv, 0).toString('utf-8');
    } catch { return null; }
  }

  private async decryptV0NoMagic(key: Buffer, encoded: string): Promise<string | null> {
    try {
      const data = Buffer.from(encoded, 'base64');
      if (data.length < IV_SIZE) return null;
      const iv = data.subarray(0, IV_SIZE);
      const ciphertext = data.subarray(IV_SIZE);
      return crypton.AES256CTR.process(ciphertext, key, iv, 0).toString('utf-8');
    } catch { return null; }
  }

  private async migrateV0ToV1(): Promise<void> {
    const sessionId = await this.engine.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      await this.engine.clear();
      return;
    }

    const oldKey = await KeyManager.deriveMasterKey(sessionId);

    // Read old key index
    const indexHk = await KeyManager.hash(sessionId, KEY_INDEX_KEY);
    const indexRaw = await this.engine.getItem(indexHk);
    let userKeys: string[] = [];
    if (indexRaw) {
      const decIndex = await this.decryptV0GC(oldKey, indexRaw)
        ?? await this.decryptV0NoMagic(oldKey, indexRaw)
        ?? await this.decryptV0Legacy(sessionId, indexRaw);
      if (decIndex) {
        try { const p = JSON.parse(decIndex); if (Array.isArray(p)) userKeys = p; } catch {}
      }
    }

    // Decrypt values with old key
    const migrated: Array<{ userKey: string; plaintext: string }> = [];
    for (const userKey of userKeys) {
      const hk = await KeyManager.hash(sessionId, userKey);
      const raw = await this.engine.getItem(hk);
      if (!raw) continue;
      const pt = await this.decryptV0GC(oldKey, raw)
        ?? await this.decryptV0NoMagic(oldKey, raw)
        ?? await this.decryptV0Legacy(sessionId, raw);
      if (pt !== null) migrated.push({ userKey, plaintext: pt });
    }

    // Read old session data
    const sessionHk = await KeyManager.hash(sessionId, 'session:' + sessionId);
    const sessionRaw = await this.engine.getItem(sessionHk);
    let sessionPlaintext: string | null = null;
    if (sessionRaw) {
      sessionPlaintext = await this.decryptV0GC(oldKey, sessionRaw)
        ?? await this.decryptV0NoMagic(oldKey, sessionRaw)
        ?? await this.decryptV0Legacy(sessionId, sessionRaw);
    }

    // Clear and set up new format
    await this.engine.clear();
    await this.engine.setItem(SESSION_ID_KEY, sessionId);

    const newSalt = await KeyManager.generateSalt();
    const newKey = await KeyManager.deriveKey(sessionId, newSalt);
    const keyHash = await KeyManager.createKeyHash(newKey);

    if (sessionPlaintext) {
      const hk = await KeyManager.hash(sessionId, 'session:' + sessionId);
      await this.engine.setItem(hk, await EncryptedStore.encryptToBase64(newKey, sessionPlaintext));
    }

    const newIndex: string[] = [];
    for (const { userKey, plaintext } of migrated) {
      const hk = await KeyManager.hash(sessionId, userKey);
      await this.engine.setItem(hk, await EncryptedStore.encryptToBase64(newKey, plaintext));
      newIndex.push(userKey);
    }

    if (newIndex.length > 0) {
      const hk = await KeyManager.hash(sessionId, KEY_INDEX_KEY);
      await this.engine.setItem(hk, await EncryptedStore.encryptToBase64(newKey, JSON.stringify(newIndex)));
    }

    await this.engine.setItem(SALT_KEY, newSalt.toString('base64'));
    await this.engine.setItem(KEY_VERIFY_KEY, keyHash.toString('base64'));
    newSalt.fill(0);
  }

  // ---- Session Storage ----

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

  // ---- Avatar Cache ----

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
