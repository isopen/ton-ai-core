import { strict as assert } from 'assert';

jest.mock('@ton-ai/telegram/dist/telegram-service', () => ({
    TelegramService: class {
        constructor(_opts?: unknown) {}
    },
}));
jest.mock('@ton-ai/telegram/dist/types', () => ({
    serializePeer: (peer: unknown) => peer,
    TELEGRAM_WS_DC_OPTIONS: [],
}));
jest.mock('@/worker/worker-adapter', () => ({
    TelegramWorkerClient: class {},
}));

const { WorkerTelegramService } = require('../src/utils/worker-telegram-service') as {
    WorkerTelegramService: new (sessionId: string) => any;
};

function makeService() {
    const svc = new WorkerTelegramService('test-session');
    const rpcCalls: Array<{ method: string; params: any }> = [];
    const mediaCalls: any[] = [];
    (svc as any).workerClient = {
        sendMedia: async (peer: any, document: any, sticker: any, replyToMsgId?: number) => {
            mediaCalls.push({ peer, document, sticker, replyToMsgId });
            return { type: 'messageSent' };
        },
        callRpc: async (method: string, params: any) => {
            rpcCalls.push({ method, params });
            return { type: 'rpcResult', result: {} };
        },
        readHistory: async () => undefined,
    };
    return { svc, rpcCalls, mediaCalls };
}

describe('forum media and read state wiring', () => {
    test('sendMedia forwards the topic reply id to the worker', async () => {
        const { svc, mediaCalls } = makeService();
        const peer = { _: 'peerChannel', channel_id: 1 };
        const doc = { id: '5', access_hash: '6', file_reference: 'ab' };

        await svc.sendMedia(peer, doc, false, 42);
        await svc.sendMedia(peer, doc, false);

        assert.equal(mediaCalls.length, 2);
        assert.equal(mediaCalls[0].replyToMsgId, 42);
        assert.equal(mediaCalls[1].replyToMsgId, undefined);
    });

    test('readDiscussion calls messages.readDiscussion with topic ids', async () => {
        const { svc, rpcCalls } = makeService();
        const peer = { _: 'peerChannel', channel_id: 1 };

        await svc.readDiscussion(peer, 42, 1000);

        assert.equal(rpcCalls.length, 1);
        assert.equal(rpcCalls[0].method, 'messages.readDiscussion');
        assert.equal(rpcCalls[0].params.msg_id, 42);
        assert.equal(rpcCalls[0].params.read_max_id, 1000);
        assert.deepEqual(rpcCalls[0].params.peer, peer);
    });
});
