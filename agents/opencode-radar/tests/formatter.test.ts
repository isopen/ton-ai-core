import { strict as assert } from 'assert';
import {
    escapeHtml,
    truncate,
    repoRelative,
    formatDuration,
    formatProgress,
    formatSummary,
    formatTopicName,
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

    test('formatProgress contains title, activity, stats and stays in budget', () => {
        const text = formatProgress({
            title: 'Test session <x>',
            directory: '/repo',
            activity: ['⚙️ read /repo/a.ts', '✅ edit /repo/b.ts'],
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
        assert.ok(text.includes('⚙️ read /repo/a.ts'));
        assert.ok(text.includes('🧰 2'));
        assert.ok(text.includes('src/a.ts'));
        assert.ok(!text.includes('<x>'));
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
        assert.ok(text.length <= TELEGRAM_TEXT_LIMIT);
    });
});
