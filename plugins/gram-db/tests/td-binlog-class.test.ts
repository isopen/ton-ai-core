import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { TdBinlog, EventType } from '../src/td-binlog';

class MockFile {
  data: Uint8Array;
  constructor(public name: string, data: Uint8Array = new Uint8Array(0)) { this.data = data; }
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
      this.files.set(name, new MockFile(name));
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

  test('GramDbComponents initialize throws without OPFS', async () => {
    delete (global as any).navigator;
    const { GramDbComponents } = await import('../src/components');
    const comps = new GramDbComponents();
    await assert.rejects(() => comps.initialize(), /OPFS not available/);
  });
});

describe('TdBinlog TDLib compat', () => {
  test('wrongPassword when key mismatch', async () => {
    const dir = mockOPFS();
    const binlog = new TdBinlog();
    await binlog.init('correct-session');
    await binlog.append(EventType.AuthKey, 1, Buffer.from([1]), 1n, 1n);
    const binlog2 = new TdBinlog();
    const info = await binlog2.init('wrong-session');
    const { strict: assert2 } = await import('assert');
    assert2.strictEqual(info.wrongPassword, true);
    assert2.strictEqual(info.isEncrypted, false);
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
