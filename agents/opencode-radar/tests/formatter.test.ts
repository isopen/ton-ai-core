import { strict as assert } from 'assert';
import {
    escapeHtml,
    truncate,
    repoRelative,
    formatDuration,
    formatProgress,
    formatSummary,
    formatTopicName,
    displayModel,
    toTodoState,
    toToolState,
    FORUM_TOPIC_NAME_LIMIT,
    TELEGRAM_TEXT_LIMIT,
} from '../formatter';

describe('formatter', () => {
    test('escapeHtml escapes markup', () => {
        assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
    });

    test('truncate keeps short strings and caps long ones', () => {
        assert.equal(truncate('abc', 10), 'abc');
        const capped = truncate('abcdef', 5);
        assert.equal(capped.length, 5);
        assert.ok(capped.endsWith('…'));
    });

    test('repoRelative strips directory prefix', () => {
        assert.equal(repoRelative('/repo/src/a.ts', '/repo'), 'src/a.ts');
        assert.equal(repoRelative('/other/a.ts', '/repo'), '/other/a.ts');
    });

    test('formatDuration renders seconds, minutes, hours', () => {
        assert.equal(formatDuration(0, 45000), '45s');
        assert.equal(formatDuration(0, 125000), '2m 5s');
        assert.equal(formatDuration(0, 3700000), '1h 1m');
    });

    test('formatProgress shows plan, tools, result and stats in budget', () => {
        const text = formatProgress({
            title: 'Test session <x>',
            directory: '/repo',
            model: '{"id":"model-1"}',
            todos: [
                { content: 'first', state: 'done' },
                { content: 'second', state: 'active' },
                { content: 'third', state: 'queued' },
            ],
            tools: [
                { text: 'read /repo/a.ts', state: 'ok' },
                { text: 'edit /repo/b.ts', state: 'running' },
            ],
            result: { tool: 'bash', ok: true, text: 'ok output' },
            lastText: 'done <soon>',
            toolCalls: 2,
            tokensIn: 1000,
            tokensOut: 200,
            cost: 0.0123,
            files: ['/repo/src/a.ts', '/repo/src/b.ts'],
            startedAt: 0,
            updatedAt: 60000,
        });
        assert.ok(text.includes('Test session &lt;x&gt;'));
        assert.ok(text.includes('📋 План 1/3'));
        assert.ok(text.includes('✅ first'));
        assert.ok(text.includes('🔄 second'));
        assert.ok(text.includes('⬜ third'));
        assert.ok(text.includes('⚙️ edit /repo/b.ts'));
        assert.ok(text.includes('🤖 model-1'));
        assert.ok(text.includes('<tg-spoiler>'));
        assert.ok(text.includes('🧰 2'));
        assert.ok(!text.includes('<x>'));
        assert.ok(!text.includes('<soon>'));
        assert.ok(text.length <= 3900);
    });

    test('formatProgress delivers long lastText in full when budget allows', () => {
        const lastText = `1. ${'abc '.repeat(500)}`;
        const text = formatProgress({
            title: 'Long reply',
            directory: '/repo',
            model: 'model-1',
            todos: [],
            tools: [],
            result: null,
            lastText,
            toolCalls: 1,
            tokensIn: 100,
            tokensOut: 200,
            cost: 0.001,
            files: [],
            startedAt: 0,
            updatedAt: 60000,
        });
        assert.ok(text.includes(lastText));
        assert.ok(text.includes('🧰 1'));
        assert.ok(text.includes('</i>'));
        assert.ok(text.length <= 3900);
    });

    test('formatProgress keeps footer and valid tags on overflow', () => {
        const lastText = `1. ${'abc '.repeat(500)}`;
        const text = formatProgress({
            title: 'Overflow',
            directory: '/repo',
            model: 'model-1',
            todos: Array.from({ length: 8 }, (_, i) => ({ content: `todo-${i} ${'x'.repeat(110)}`, state: 'queued' as const })),
            tools: Array.from({ length: 4 }, (_, i) => ({ text: `tool-${i} ${'y'.repeat(130)}`, state: 'running' as const })),
            result: { tool: 'bash', ok: true, text: 'z'.repeat(500) },
            lastText,
            toolCalls: 9,
            tokensIn: 100,
            tokensOut: 200,
            cost: 0.001,
            files: [],
            startedAt: 0,
            updatedAt: 60000,
        });
        assert.ok(!text.includes(lastText));
        assert.ok(text.includes('🧰 9'));
        assert.ok(text.endsWith(' in'));
        assert.ok(text.includes('</i>'));
        assert.ok(text.includes('</code></tg-spoiler>'));
        assert.ok(text.length <= 3900);
    });

    test('formatTopicName fits the forum limit and tags the session', () => {
        const name = formatTopicName('My session', 'ses_f4cc46126ffeS3cq');
        assert.ok(name.startsWith('📡 My session · '));
        assert.ok(name.endsWith('feS3cq'));
        const long = formatTopicName('word '.repeat(60), 'ses_abc123');
        assert.ok(long.length <= FORUM_TOPIC_NAME_LIMIT);
        assert.ok(long.endsWith('abc123'));
        assert.ok(long.includes('…'));
        assert.equal(formatTopicName('   ', '!!!'), '📡 Untitled session · session');
    });

    test('formatSummary caps at Telegram limit and lists files', () => {
        const text = formatSummary({
            title: 'Done',
            directory: '/repo',
            model: 'model-1',
            todos: [{ content: 'a', state: 'done' }],
            toolCalls: 10,
            tokensIn: 5000,
            tokensOut: 1500,
            cost: 0.02,
            files: Array.from({ length: 20 }, (_, i) => `/repo/f${i}.ts`),
            lastText: 'all green',
            startedAt: 0,
            finishedAt: 120000,
        });
        assert.ok(text.startsWith('✅'));
        assert.ok(text.includes('files (20)'));
        assert.ok(text.includes('📋 План 1/1'));
        assert.ok(text.includes('🤖 model-1'));
        assert.ok(text.length <= TELEGRAM_TEXT_LIMIT);
    });

    test('displayModel parses provider JSON and passes plain names through', () => {
        assert.equal(displayModel('{"id":"muse-spark","providerID":"x"}'), 'muse-spark');
        assert.equal(displayModel('plain-model'), 'plain-model');
        assert.equal(displayModel('   '), '');
        assert.equal(displayModel('not json {'), 'not json {');
    });

    test('toTodoState and toToolState map statuses', () => {
        assert.equal(toTodoState('completed'), 'done');
        assert.equal(toTodoState('in_progress'), 'active');
        assert.equal(toTodoState('pending'), 'queued');
        assert.equal(toTodoState('weird'), 'queued');
        assert.equal(toToolState('completed'), 'ok');
        assert.equal(toToolState('error'), 'fail');
        assert.equal(toToolState('failed'), 'fail');
        assert.equal(toToolState('running'), 'running');
    });
});
