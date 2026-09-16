/**
 * @jest-environment jsdom
 */
import { createCallbacks, fetchPeerWallpaper, fetchAccountWallpapers, fetchSelfWallpaper, wallpaperFetchStatus } from '../src/app/gram-callbacks';

function makeState(callRpc: (...a: any[]) => Promise<any>): any {
  const actions: any[] = [];
  const s: any = {
    tgService: { current: { callRpc: (...a: any[]) => callRpc(...a) } },
    tgui: {
      current: {
        state: { peerWallpapers: {} as Record<string, any> },
        dispatch: (a: any) => {
          actions.push(a);
          if (a.type === 'SET_PEER_WALLPAPER' && a.peerKey) {
            s.tgui.current.state.peerWallpapers[a.peerKey] = a.wallpaper;
          }
        },
      },
    },
  };
  return { s, actions };
}

describe('fetchPeerWallpaper from full peer info', () => {
  test('user wallpaper from users.getFullUser is stored', async () => {
    const wall = { _: 'wallPaper', id: '9', slug: 's9', settings: { background_color: 0xFF112233 } };
    const seen: string[] = [];
    const { s, actions } = makeState(async (method: string) => {
      seen.push(method);
      return { _: 'users.userFull', full_user: { _: 'userFull', wallpaper: wall } };
    });
    await fetchPeerWallpaper(s, { type: 'user', id: '7', accessHash: '99' } as any);
    expect(seen).toEqual(['users.getFullUser']);
    expect(actions.length).toBe(1);
    expect(actions[0]).toEqual({ type: 'SET_PEER_WALLPAPER', peerKey: 'user_7', wallpaper: wall });
  });

  test('channel wallpaper from channels.getFullChannel is stored', async () => {
    const wall = { _: 'wallPaperNoFile', id: '3', settings: { background_color: 0xFF445566 } };
    const seen: any[] = [];
    const { s, actions } = makeState(async (method: string, params: any) => {
      seen.push([method, params]);
      return { _: 'messages.chatFull', full_chat: { _: 'channelFull', wallpaper: wall } };
    });
    await fetchPeerWallpaper(s, { type: 'channel', id: '11', accessHash: '22' } as any);
    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe('channels.getFullChannel');
    expect(actions.length).toBe(1);
    expect(actions[0].peerKey).toBe('channel_11');
    expect(actions[0].wallpaper).toBe(wall);
  });

  test('missing wallpaper dispatches nothing', async () => {
    const { s, actions } = makeState(async () => ({ _: 'users.userFull', full_user: { _: 'userFull' } }));
    await fetchPeerWallpaper(s, { type: 'user', id: '7', accessHash: '99' } as any);
    expect(actions.length).toBe(0);
  });

  test('identical wallpaper is not redispatched', async () => {
    const wall = { _: 'wallPaper', id: '9', slug: 's9' };
    const { s, actions } = makeState(async () => ({ full_user: { wallpaper: { _: 'wallPaper', id: '9', slug: 's9' } } }));
    s.tgui.current.state.peerWallpapers['user_7'] = wall;
    await fetchPeerWallpaper(s, { type: 'user', id: '7', accessHash: '99' } as any);
    expect(actions.length).toBe(0);
  });

  test('rpc failure stays silent', async () => {
    const { s, actions } = makeState(async () => { throw new Error('RPC Error 400: PEER_ID_INVALID'); });
    await expect(fetchPeerWallpaper(s, { type: 'channel', id: '11', accessHash: '22' } as any)).resolves.toBeUndefined();
    expect(actions.length).toBe(0);
  });

  test('basic chats and peers without hash are skipped', async () => {
    let calls = 0;
    const { s, actions } = makeState(async () => { calls++; return {}; });
    await fetchPeerWallpaper(s, { type: 'chat', id: '3' } as any);
    await fetchPeerWallpaper(s, { type: 'user', id: '7' } as any);
    expect(calls).toBe(0);
    expect(actions.length).toBe(0);
  });
});

describe('fetchAccountWallpapers default list', () => {
  test('failure stays silent', async () => {
    const { s, actions } = makeState(async () => { throw new Error('RPC Error 500: INTERNAL'); });
    await expect(fetchAccountWallpapers(s)).resolves.toBeUndefined();
    expect(actions.length).toBe(0);
  });

  test('not-modified dispatches nothing', async () => {
    const { s, actions } = makeState(async () => ({ _: 'account.wallPapersNotModified' }));
    await fetchAccountWallpapers(s);
    expect(actions.length).toBe(0);
  });

  test('stores server list', async () => {
    const items = [
      { _: 'wallPaper', id: '1', slug: 'a', pattern: true, document: { _: 'document', id: 'd1' }, settings: {} },
      { _: 'wallPaperNoFile', id: '2', default: true, settings: { background_color: 1 } },
    ];
    const seen: string[] = [];
    const { s, actions } = makeState(async (method: string) => {
      seen.push(method);
      return { _: 'account.wallPapers', hash: '0', wallpapers: items };
    });
    await fetchAccountWallpapers(s);
    expect(seen).toEqual(['account.getWallPapers']);
    expect(actions.length).toBe(1);
    expect(actions[0]).toEqual({ type: 'SET_ACCOUNT_WALLPAPERS', wallpapers: items });
  });
});

describe('fetchSelfWallpaper self full info', () => {
  test('self request uses inputUserSelf and stays silent', async () => {
    const seen: any[] = [];
    const { s, actions } = makeState(async (method: string, params: any) => {
      seen.push([method, params]);
      return { _: 'users.userFull', full_user: { _: 'userFull' } };
    });
    await fetchSelfWallpaper(s);
    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe('users.getFullUser');
    expect(seen[0][1]).toEqual({ id: { _: 'inputUserSelf' } });
    expect(actions.length).toBe(0);
  });
});

describe('wallpaperFetchStatus summary', () => {
  test('reports stored peer, account count and self kind', () => {
    const { s } = makeState(async () => ({}));
    s.tgui.current.state = {
      peerWallpapers: { user_7: { _: 'wallPaperNoFile' } },
      accountWallpapers: [{ _: 'wallPaper' }, { _: 'wallPaper' }],
    };
    const line = wallpaperFetchStatus(s, { type: 'user', id: '7' } as any);
    expect(line).toContain('peer=user_7');
    expect(line).toContain('peerStored=wallPaperNoFile');
    expect(line).toContain('accountN=2');
    const empty = wallpaperFetchStatus({ tgui: { current: { state: {} } } } as any, { type: 'channel', id: '9' } as any);
    expect(empty).toContain('peerStored=-');
    expect(empty).toContain('accountN=-1');
  });
});

describe('fetchWallpapers settings wiring', () => {
  test('callback loads account list and self info', async () => {
    jest.resetModules();
    const fresh: any = require('../src/app/gram-callbacks');
    const seen: string[] = [];
    const s: any = {
      tgService: {
        current: {
          callRpc: async (method: string) => {
            seen.push(method);
            if (method === 'account.getWallPapers') return { _: 'account.wallPapers', wallpapers: [] };
            return { _: 'users.userFull', full_user: { _: 'userFull' } };
          },
        },
      },
      tgui: { current: { state: {}, dispatch: () => {} } },
    };
    const cb = fresh.createCallbacks(s, () => cb as any);
    expect(typeof cb.fetchWallpapers).toBe('function');
    await cb.fetchWallpapers!();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toContain('account.getWallPapers');
    expect(seen).toContain('users.getFullUser');
  });
});
