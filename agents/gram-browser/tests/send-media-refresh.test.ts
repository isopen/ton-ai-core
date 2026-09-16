/**
 * @jest-environment jsdom
 */
import { createCallbacks } from '../src/app/gram-callbacks';

function makeState(opts: { sendMedia: (...a: any[]) => Promise<any>; callRpc: (...a: any[]) => Promise<any> }): any {
  const errors: string[] = [];
  const sent: any[][] = [];
  const ui: any = {
    state: { messages: [] as any[] },
    setMessages: (m: any[]) => { ui.state.messages = m; },
    scrollChatToBottom: () => {},
    setDialogs: () => {},
    setError: (e: string) => { errors.push(e); },
    addLog: () => {},
  };
  const s: any = {
    selectedPeerRef: { current: { type: 'user', id: '7', accessHash: '99' } },
    tgui: { current: ui },
    tgService: {
      current: {
        sendMedia: (...a: any[]) => { sent.push(a); return opts.sendMedia(...a); },
        callRpc: (...a: any[]) => opts.callRpc(...a),
      },
    },
    messagesCache: { current: new Map() },
    dialogsRef: { current: [] },
  };
  return { s, ui, errors, sent };
}

describe('sendSticker refresh fallback', () => {
  test('INPUT_FETCH_ERROR without setId recovers via fresh recent lookup', async () => {
    const stale = { id: '101', access_hash: '201', file_reference: 'aabbcc' };
    const fresh = { id: '101', access_hash: '202', file_reference: 'ddeeff' };
    let calls = 0;
    const { s, ui, errors, sent } = makeState({
      sendMedia: async () => {
        calls++;
        if (calls === 1) throw new Error('RPC Error 400: INPUT_FETCH_ERROR');
        return { data: { _: 'updateShortSentMessage', id: 55, date: 1700000000 } };
      },
      callRpc: async (method: string) => {
        if (method === 'messages.getRecentStickers') return { stickers: [fresh] };
        return {};
      },
    });
    const cb = createCallbacks(s, () => cb as any);
    await cb.sendSticker!(stale);
    expect(sent.length).toBe(2);
    expect(sent[1][1]).toBe(fresh);
    expect(errors.length).toBe(0);
    expect(ui.state.messages.some((m: any) => m.id === 55)).toBe(true);
  });

  test('INPUT_FETCH_ERROR with setId misses set but recovers via recent', async () => {
    const stale = { id: '111', access_hash: '211', file_reference: 'aabbcc' };
    const fresh = { id: '111', access_hash: '212', file_reference: 'ddeeff' };
    let calls = 0;
    const seen: string[] = [];
    const { s, ui, errors, sent } = makeState({
      sendMedia: async () => {
        calls++;
        if (calls === 1) throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
        return { data: { _: 'updateShortSentMessage', id: 56, date: 1700000000 } };
      },
      callRpc: async (method: string) => {
        seen.push(method);
        if (method === 'messages.getStickerSet') return { documents: [{ id: '999', file_reference: 'zz' }] };
        if (method === 'messages.getRecentStickers') return { stickers: [fresh] };
        return {};
      },
    });
    const cb = createCallbacks(s, () => cb as any);
    await cb.sendSticker!(stale, '5', '6');
    expect(sent.length).toBe(2);
    expect(sent[1][1]).toBe(fresh);
    expect(seen).toEqual(['messages.getStickerSet', 'messages.getRecentStickers']);
    expect(errors.length).toBe(0);
    expect(ui.state.messages.some((m: any) => m.id === 56)).toBe(true);
  });

  test('non-reference error surfaces without retry', async () => {
    const doc = { id: '102', access_hash: '201', file_reference: 'aabbcc' };
    let rpcCalls = 0;
    const { s, errors, sent } = makeState({
      sendMedia: async () => { throw new Error('RPC Error 400: PEER_ID_INVALID'); },
      callRpc: async () => { rpcCalls++; return {}; },
    });
    const cb = createCallbacks(s, () => cb as any);
    await cb.sendSticker!(doc);
    expect(sent.length).toBe(1);
    expect(rpcCalls).toBe(0);
    expect(errors).toEqual(['RPC Error 400: PEER_ID_INVALID']);
  });

  test('custom emoji entities tagged for animated render before server echo', async () => {
    let resolveSend!: (v: any) => void;
    const gate = new Promise((r) => { resolveSend = r; });
    const { s, ui } = makeState({
      sendMedia: async () => ({}),
      callRpc: async () => ({}),
    });
    (s.tgService.current as any).sendMessage = () => gate;
    const cb = createCallbacks(s, () => cb as any);
    const p = cb.sendMessage!('A😎', [{ offset: 1, length: 2, document_id: '601' }]);
    await new Promise((r) => setTimeout(r, 10));
    const optimistic = ui.state.messages[ui.state.messages.length - 1];
    expect(optimistic.message).toBe('A😎');
    expect(optimistic.entities).toHaveLength(1);
    expect(optimistic.entities[0]._).toBe('messageEntityCustomEmoji');
    expect(String(optimistic.entities[0].document_id)).toBe('601');
    resolveSend({ data: { _: 'updateShortSentMessage', id: 77, date: 1700000001 } });
    await p;
    const reconciled = ui.state.messages[ui.state.messages.length - 1];
    expect(reconciled.id).toBe(77);
    expect(reconciled.entities).toHaveLength(1);
    expect(reconciled.entities[0]._).toBe('messageEntityCustomEmoji');
  });
});
