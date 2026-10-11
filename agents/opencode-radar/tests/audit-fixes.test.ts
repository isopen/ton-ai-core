import { strict as assert } from 'assert';
import { crypton } from '@ton-ai/core';
import { OpencodeRadarAgent, OpencodeRadarConfig } from '../agent';
import { markdownToTelegramHtml } from '../formatter';

function makeAgent(): OpencodeRadarAgent {
    const config = {
        name: 'radar-audit',
        plugins: {},
        telegram: { token: 'test' },
        opencode: { baseUrl: 'http://127.0.0.1:4096' },
        radar: {
            chatId: 1,
            directory: '/tmp',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            statePath: '/tmp/radar-audit-state.json',
            pollMs: 1000,
            idleSec: 90,
        },
    } as unknown as OpencodeRadarConfig;
    return new OpencodeRadarAgent(config);
}

describe('opencode-radar audit fixes', () => {
    test('multi-part delivery resumes instead of re-sending delivered parts', async () => {
        const agent = makeAgent();
        (agent as unknown as { threadsEnabled: boolean }).threadsEnabled = true;
        const sentTexts: string[] = [];
        let failed = false;
        const telegram = {
            sendMessage: async (params: { text: string }) => {
                if (sentTexts.length === 1 && !failed) {
                    failed = true;
                    throw new Error('Too Many Requests: retry after 1');
                }
                sentTexts.push(params.text);
                return { message_id: 100 + sentTexts.length };
            },
        } as any;
        const state = { session: { id: 'ses' }, threadId: 7 } as any;
        const text = 'x'.repeat(5000);

        const first = (agent as unknown as {
            deliverMessage(tg: unknown, st: unknown, text: string): Promise<number>;
        }).deliverMessage(telegram, state, text);
        await assert.rejects(first, /Too Many Requests/);
        assert.equal(sentTexts.length, 1, 'exactly one part landed before the failure');
        const part0 = sentTexts[0];

        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        const firstId = await (agent as unknown as {
            deliverMessage(tg: unknown, st: unknown, text: string): Promise<number>;
        }).deliverMessage(telegram, state, text);

        assert.equal(sentTexts.length, 2, 'only the remaining part is sent on resume');
        assert.notEqual(sentTexts[1], part0, 'the delivered part is not re-sent');
        assert.equal(firstId, 101, 'the first delivered message id is preserved');
    });

    test('markdownToTelegramHtml strips private-use placeholder injection', () => {
        const html = markdownToTelegramHtml('A\uE000C99\uE000B\uE000Z');
        assert.equal(html.includes('<code>'), false, 'no injected code tag');
        assert.equal(html, 'AC99BZ', 'marker chars stripped, text preserved');
    });
});
