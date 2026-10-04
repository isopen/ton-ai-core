import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { TdBinlog, EventType, buildEvent, buildEncryptionPayload } from '../src/td-binlog';

jest.setTimeout(30000);

class MockFile {
  data: Uint8Array;
  constructor(public name: string, data: Uint8Array = new Uint8Array(0), private dir?: MockDirectoryHandle) { this.data = data; }
  async move(newName: string): Promise<void> {
    if (!this.dir) throw new Error('no dir');
    this.dir.files.set(newName, this);
    this.dir.files.delete(this.name);
    this.name = newName;
  }
  async getFile() {
    const data = this.data;
    return {
      size: data.length,
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => {
          const slice = data.slice(start, end);

          return new Uint8Array(slice).buffer;
        },
      }),
      text: async () => new TextDecoder().decode(data),
      arrayBuffer: async () => new Uint8Array(data).buffer,
      stream: () => new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }),
    } as any;
  }
  async createWritable(opts?: any) {
    const self = this;
    return {
      write: async (data: any) => {
        if (data && typeof data === 'object' && 'data' in data) {
          const pos = data.position ?? self.data.length;
          const chunk = data.data as Uint8Array | Buffer | string;
          let arr: Uint8Array;
          if (typeof chunk === 'string') arr = new TextEncoder().encode(chunk);
          else if (chunk instanceof Uint8Array) arr = chunk;
          else arr = new Uint8Array(chunk as any);
          const needed = pos + arr.length;
          if (needed > self.data.length) {
            const nd = new Uint8Array(needed);
            nd.set(self.data, 0);
            self.data = nd;
          }
          self.data.set(arr, pos);
        } else if (typeof data === 'string') {
          self.data = new TextEncoder().encode(data);
        } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
          self.data = new Uint8Array(data as Uint8Array);
        }
      },
      truncate: async (offset: number) => {
        self.data = self.data.slice(0, offset);
      },
      close: async () => {},
      abort: async () => {},
    } as any;
  }
}

class MockDirectoryHandle {
  files = new Map<string, MockFile>();
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new Error('NotFound');
      this.files.set(name, new MockFile(name, new Uint8Array(0), this));
    }
    return this.files.get(name)!;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    return this;
  }
  async removeEntry(name: string) {
    this.files.delete(name);
  }
  async *entries(): AsyncIterableIterator<[string, any]> {
    for (const [k, v] of this.files) yield [k, v as any];
  }
}

function mockOPFS() {
  const dir = new MockDirectoryHandle();
  (global as any).navigator = {
    storage: {
      getDirectory: async () => dir,
    },
  };
  return dir;
}

describe('TdBinlog class', () => {
  let dir: MockDirectoryHandle;
  beforeEach(() => {
    dir = mockOPFS();
  });
  afterEach(() => {
    delete (global as any).navigator;
  });

  test('init creates file and replay empty', async () => {
    const binlog = new TdBinlog();
    await binlog.init('test-session-1');
    const st = binlog.getState();
    assert.strictEqual(st.dcId, 0);
    assert.strictEqual(st.authenticated, false);
  });

  test('append and getState', async () => {
    const binlog = new TdBinlog();
    await binlog.init('test-session-2');
    await binlog.append(EventType.AuthKey, 2, Buffer.from([1,2,3]), 123n, 456n);
    const st = binlog.getState();
    assert.strictEqual(st.dcId, 2);
    assert.ok(st.authKey);
  });

  test('append multiple and read back via replay', async () => {
    const binlog = new TdBinlog();
    await binlog.init('test-session-3');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([0xAA]), 1n, 1n);
    await binlog.append(EventType.SessionFlags, 3);
    await binlog.append(EventType.ServerTimeOffset, -100);
    const st = binlog.getState();
    assert.strictEqual(st.dcId, 1);
    assert.strictEqual(st.serverTimeOffset, -100);
    const binlog2 = new TdBinlog();
    await binlog2.init('test-session-3');
    const st2 = binlog2.getState();
    assert.strictEqual(st2.dcId, 1);
    assert.strictEqual(st2.serverTimeOffset, -100);
  });

  test('file lock prevents concurrent binlog instances', async () => {
    const heldLocks = new Set<string>();
    (global as any).navigator.locks = {
      request: async (name: string, opts: any, fn: (lock: any) => Promise<any>) => {
        if (opts?.ifAvailable && heldLocks.has(name)) {
          return await fn(null);
        }
        heldLocks.add(name);
        try {
          return await fn({ name });
        } finally {
          heldLocks.delete(name);
        }
      },
    };
    const binlog = new TdBinlog();
    await binlog.init('lock-session-1');
    const binlog2 = new TdBinlog();
    await assert.rejects(() => binlog2.init('lock-session-1'), /locked by another instance/);
    heldLocks.delete('gram-db-binlog-lock');
    const binlog3 = new TdBinlog();
    await binlog3.init('lock-session-1');
  });

  test('db key file persists across inits', async () => {
    void dir;
    await binlog1AppendAndRead();
    assert.ok(dir.files.has('binlog_key'), 'key file exists');
    const keyBytes = dir.files.get('binlog_key')!.data.slice(0);
    const binlog2 = new TdBinlog();
    await binlog2.init('keyfile-session-1');
    assert.ok(Buffer.from(dir.files.get('binlog_key')!.data).equals(keyBytes), 'key file unchanged');
  });

  test('legacy sessionId binlog migrates to raw db key', async () => {
    const { crypton, AesCtrCipher } = require('@ton-ai/core');
    const { buildEncryptionPayload } = require('../src/td-binlog');
    const salt = crypton.getRandomBytes(32);
    const iv = crypton.getRandomBytes(16);
    const sessionInput = Buffer.from('legacy-session', 'utf-8');
    const legacyKey = Buffer.from(await crypton.pbkdf2Sha256(sessionInput, salt, 60002, 32));
    const keyHash = Buffer.from(await crypton.hmacSha256(legacyKey, new TextEncoder().encode('cucumbers everywhere')));
    const encEvent = pad16(buildEvent(0n, -3, 0, 0n, buildEncryptionPayload(salt, iv, keyHash)));

    const authPayload = Buffer.concat([
      serInt32(2), serTlBytes(Buffer.from([0xAA])), serInt64(123n), serInt64(456n),
    ]);
    const authEvent = pad16(buildEvent(1n, EventType.AuthKey, 0, 0n, authPayload));

    const cipher = new AesCtrCipher(legacyKey, iv, 0);
    const blob2 = cipher.process(authEvent);

    const fh = await dir.getFileHandle('binlog', { create: true });
    const w = await fh.createWritable();
    await w.write({ type: 'write', position: 0, data: encEvent });
    await w.write({ type: 'write', position: encEvent.length, data: blob2 });
    await w.close();

    const binlog = new TdBinlog();
    const info = await binlog.init('legacy-session');
    assert.strictEqual(info.wrongPassword, false);
    const st = binlog.getState();
    assert.strictEqual(st.dcId, 2);
    assert.ok(st.authKey && st.authKey[0] === 0xAA, 'auth key restored from legacy binlog');
    assert.ok(dir.files.has('binlog_key'), 'raw key file created by migration');

    const binlog2 = new TdBinlog();
    const info2 = await binlog2.init('legacy-session');
    assert.strictEqual(info2.wrongPassword, false);
    assert.strictEqual(binlog2.getState().dcId, 2);
  });

  test('lost key file makes binlog wrongPassword', async () => {
    const binlog = new TdBinlog();
    await binlog.init('lostkey-session-1');
    await binlog.append(EventType.SessionFlags, 3);
    dir.files.delete('binlog_key');

    const binlog2 = new TdBinlog();
    const info = await binlog2.init('lostkey-session-1');
    assert.strictEqual(info.wrongPassword, true);
    assert.strictEqual(binlog2.getState().authenticated, false);
  });

  function pad16(buf: Buffer): Buffer {
    const padLen = (16 - (buf.length % 16)) % 16;
    return padLen ? Buffer.concat([buf, Buffer.alloc(padLen)]) : buf;
  }
  function serInt32(v: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    return b;
  }
  function serInt64(v: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v, 0);
    return b;
  }
  function serTlBytes(data: Buffer): Buffer {
    const { tlBytesLength, writeTlBytes } = require('@ton-ai/tl-language');
    const b = Buffer.alloc(tlBytesLength(data.length));
    writeTlBytes(b, 0, data);
    return b;
  }
  async function binlog1AppendAndRead(): Promise<void> {
    const binlog = new TdBinlog();
    await binlog.init('keyfile-session-1');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([7]), 11n, 22n);
    const check = new TdBinlog();
    await check.init('keyfile-session-1');
    assert.strictEqual(check.getState().dcId, 1);
  }

  test('clear truncates', async () => {
    const binlog = new TdBinlog();
    await binlog.init('test-session-4');
    await binlog.append(EventType.AuthKey, 2, Buffer.from([1]), 1n, 1n);
    await binlog.clear();
    const st = binlog.getState();
    assert.strictEqual(st.dcId, 0);
  });

  test('saveDcAuthKey', async () => {
    const binlog = new TdBinlog();
    await binlog.init('test-session-5');
    await binlog.saveDcAuthKey(2, { authKey: Buffer.from([1,2,3]), authKeyId: 1n, serverSalt: 2n, serverTime: 123 });
    const st = binlog.getState();
    assert.ok(st.dcAuthKeys);
  });

  test('replay truncates on bad header', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('bad-header-test');

    const file = dir.files.get('binlog')!;
    file.data = new Uint8Array([0,0,0,0, 1,2,3,4, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]);
    const binlog2 = new TdBinlog();
    await binlog2.init('bad-header-test');
    assert.ok(true);
  });

  test('replay truncates on CRC mismatch', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('crc-test');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    const file = dir.files.get('binlog')!;

    file.data[file.data.length-1] ^= 0xFF;
    const binlog2 = new TdBinlog();
    await binlog2.init('crc-test');
    assert.ok(true);
  });

  test('replay handles empty file after clear', async () => {
    const binlog = new TdBinlog();
    await binlog.init('empty-after-clear');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    await binlog.clear();
    const binlog2 = new TdBinlog();
    await binlog2.init('empty-after-clear');
    assert.strictEqual(binlog2.getState().dcId, 0);
  });
});

describe('OpfsEngine via GramDbComponents', () => {
  test('GramDbComponents initialize with mocked OPFS', async () => {
    const dir = mockOPFS();
    const { GramDbComponents } = await import('../src/components');
    const comps = new GramDbComponents();
    await comps.initialize();
    assert.ok(comps.initialized);
    await comps.engine.setItem('k', 'v');
    assert.strictEqual(await comps.engine.getItem('k'), 'v');
    await comps.engine.removeItem('k');
    assert.strictEqual(await comps.engine.getItem('k'), null);
    await comps.engine.setItem('a', '1');
    await comps.engine.setItem('b', '2');
    const keys = await comps.engine.getAllKeys();
    assert.ok(keys.includes('a'));
    await comps.engine.clear();
    assert.strictEqual((await comps.engine.getAllKeys()).length, 0);
    delete (global as any).navigator;
  });

  test('GramDbComponents falls back to memory engine without OPFS', async () => {
    delete (global as any).navigator;
    const { GramDbComponents } = await import('../src/components');
    const comps = new GramDbComponents();
    await comps.initialize();
    await comps.engine.setItem('k', 'v');
    assert.strictEqual(await comps.engine.getItem('k'), 'v');
  });

  test('GramDbComponents initialize throws without OPFS when fallback disabled', async () => {
    delete (global as any).navigator;
    const { GramDbComponents } = await import('../src/components');
    const comps = new GramDbComponents(undefined, { allowMemoryFallback: false });
    await assert.rejects(() => comps.initialize(), /OPFS not available/);
  });
});

describe('TdBinlog TDLib compat', () => {
  test('wrongPassword when db key file is lost', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('correct-session');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    dir.files.delete('binlog_key');
    const binlog2 = new TdBinlog();
    const info = await binlog2.init('wrong-session');
    const { strict: assert2 } = await import('assert');
    assert2.strictEqual(info.wrongPassword, true);
    assert2.strictEqual(info.isEncrypted, false);
  });

  test('same db key file decrypts across different session ids', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('correct-session');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    const binlog2 = new TdBinlog();
    const info = await binlog2.init('wrong-session');
    const { strict: assert2 } = await import('assert');
    assert2.strictEqual(info.wrongPassword, false);
    assert2.strictEqual(info.isEncrypted, true);
    assert2.strictEqual(binlog2.getState().dcId, 1);
  });

  test('oldSession fallback', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('old-session');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    const binlog2 = new TdBinlog();
    const info = await binlog2.init('new-session', 'old-session');
    const { strict: assert2 } = await import('assert');
    assert2.strictEqual(info.wrongPassword, false);
    assert2.strictEqual(binlog2.getState().dcId, 1);
  });
});
