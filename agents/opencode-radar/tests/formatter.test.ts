import { strict as assert } from 'assert';
import {
    escapeHtml,
    markdownToTelegramHtml,
    truncate,
    repoRelative,
    formatDuration,
    formatProgress,
    formatTopicName,
    formatContextPin,
    formatConsoleBatch,
    formatQuestion,
    formatQuestionResolved,
    preBlock,
    langFromPath,
    splitTelegramHtml,
    truncateHtml,
    displayModel,
    toTodoState,
    toToolState,
    FORUM_TOPIC_NAME_LIMIT,
    TELEGRAM_TEXT_LIMIT,
    RENDER_BUDGET,
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
        assert.ok(text.includes('План 1/3'));
        assert.ok(text.includes('5258046117932711905'));
        assert.ok(text.includes('first'));
        assert.ok(text.includes('5766933926429854499'));
        assert.ok(text.includes('second'));
        assert.ok(text.includes('5264727218734524899'));
        assert.ok(text.includes('⬜ third'));
        assert.ok(text.includes('edit /repo/b.ts'));
        assert.ok(text.includes('5411634513509885099'));
        assert.ok(text.includes('model-1'));
        assert.ok(text.includes('5372981976804366741'));
        assert.ok(text.includes('<tg-spoiler>'));
        assert.ok(text.includes('5449428597922079323'));
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
        assert.ok(text.includes('5449428597922079323'));
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
        assert.ok(text.includes('5449428597922079323'));
        assert.ok(text.endsWith(' in'));
        assert.ok(text.includes('</i>'));
        assert.ok(text.includes('</code></tg-spoiler>'));
        assert.ok(text.length <= 3900);
    });

    test('formatContextPin shows usage percent when limit is known', () => {
        const pin = formatContextPin({ total: 500000, input: 90000, output: 8000, reasoning: 2000, cacheRead: 390000, cacheWrite: 10000, limit: 1000000, cost: 0.0234 });
        assert.ok(pin.includes('500,000 / 1,000,000 (50%)'));
        assert.ok(pin.includes('90,000 in'));
        assert.ok(pin.includes('8,000 out'));
        assert.ok(pin.includes('2,000 reasoning'));
        assert.ok(pin.includes('390,000 cache'));
        assert.ok(pin.includes('$0.0234'));
    });

    test('formatContextPin works without limit', () => {
        const pin = formatContextPin({ total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, limit: null, cost: 0 });
        assert.ok(pin.includes('15 tokens'));
        assert.ok(!pin.includes('%'));
    });

    test('formatConsoleBatch renders console lines in order', () => {
        const batch = formatConsoleBatch(
            [
                { kind: 'tool', tool: 'bash', status: 'completed', summary: 'bash ls', output: 'ok', time: 2 },
                { kind: 'text', text: 'done <now>', time: 3 },
                { kind: 'step', tokens: 5, cost: 0, finish: 'stop', time: 4 },
                { kind: 'files', files: ['/repo/a.ts'], time: 5 },
            ],
            [{ content: 'write code', state: 'active' }],
        );
        assert.ok(batch.includes('Plan 0/1'));
        assert.ok(batch.includes('5258046117932711905'));
        assert.ok(batch.includes('bash ls'));
        assert.ok(batch.includes('5766933926429854499'));
        assert.ok(batch.includes('done &lt;now&gt;'));
        assert.ok(batch.includes('/repo/a.ts'));
        assert.ok(!batch.includes('<now>'));
        assert.ok(batch.indexOf('Plan') < batch.indexOf('bash ls'));
    });

    test('formatConsoleBatch keeps every line without cuts', () => {
        const batch = formatConsoleBatch(
            Array.from({ length: 60 }, (_, i) => ({
                kind: 'text' as const,
                text: `line-${i} ${'x'.repeat(200)}`,
                time: i,
            })),
            null,
        );
        assert.ok(batch.includes('line-0'));
        assert.ok(batch.includes('line-59'));
        assert.ok(!batch.includes('more'));
        const parts = splitTelegramHtml(batch);
        assert.ok(parts.length > 1);
        for (const part of parts) assert.ok(part.length <= TELEGRAM_TEXT_LIMIT);
    });

    test('formatConsoleBatch returns empty string for step-only input', () => {
        assert.equal(formatConsoleBatch([{ kind: 'step', tokens: 1, cost: 0, finish: 'stop', time: 1 }], null), '');
    });

    test('formatTopicName fits the forum limit and tags the session', () => {
        const name = formatTopicName('My session', 'ses_f4cc46126ffeS3cq');
        assert.ok(name.includes('5384090987024892581'));
        assert.ok(name.includes('My session · '));
        assert.ok(name.endsWith('feS3cq'));
        const long = formatTopicName('word '.repeat(60), 'ses_abc123');
        assert.ok(long.length <= FORUM_TOPIC_NAME_LIMIT);
        assert.ok(long.endsWith('abc123'));
        assert.ok(long.includes('…'));
        assert.equal(formatTopicName('   ', '!!!'), '<tg-emoji emoji-id="5384090987024892581">💎</tg-emoji> Untitled session · session');
    });

    test('splitTelegramHtml passes short text through', () => {
        assert.deepEqual(splitTelegramHtml('hello'), ['hello']);
    });

    test('splitTelegramHtml splits long text on newlines', () => {
        const text = `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`;
        const parts = splitTelegramHtml(text);
        assert.equal(parts.length, 2);
        for (const part of parts) assert.ok(part.length <= TELEGRAM_TEXT_LIMIT);
        assert.ok(parts[0].includes('a'));
        assert.ok(parts[1].includes('b'));
    });

    test('splitTelegramHtml balances tags across parts', () => {
        const text = `<b>${'x'.repeat(4050)}\nbold tail ${'y'.repeat(120)}</b>`;
        const parts = splitTelegramHtml(text);
        assert.ok(parts.length > 1);
        for (const part of parts) assert.ok(part.length <= TELEGRAM_TEXT_LIMIT);
        assert.ok(parts[0].endsWith('</b>'));
        assert.ok(parts[1].startsWith('<b>'));
        assert.ok(parts[1].includes('bold tail'));
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

    test('markdownToTelegramHtml renders telegram tags', () => {
        assert.equal(markdownToTelegramHtml('**bold**'), '<b>bold</b>');
        assert.equal(markdownToTelegramHtml('*italic*'), '<i>italic</i>');
        assert.equal(markdownToTelegramHtml('`code`'), '<code>code</code>');
        assert.equal(markdownToTelegramHtml('~~strike~~'), '<s>strike</s>');
        assert.equal(
            markdownToTelegramHtml('[docs](https://example.com/a_b)'),
            '<a href="https://example.com/a_b">docs</a>',
        );
        assert.ok(markdownToTelegramHtml('**<b>&</b>**').includes('&lt;b&gt;&amp;&lt;/b&gt;'));
        assert.ok(!markdownToTelegramHtml('**bold**').includes('**'));
    });

    test('markdownToTelegramHtml keeps stars inside code literal', () => {
        assert.equal(markdownToTelegramHtml('`a * b **c**`'), '<code>a * b **c**</code>');
        const block = markdownToTelegramHtml('```\n**x**\n```');
        assert.ok(block.includes('<pre>'));
        assert.ok(block.includes('**x**'));
    });

    test('formatConsoleBatch converts markdown in text events', () => {
        const batch = formatConsoleBatch([{ kind: 'text', text: '**done** and *fast*', time: 1 }], null);
        assert.ok(batch.includes('<b>done</b>'));
        assert.ok(batch.includes('<i>fast</i>'));
        assert.ok(!batch.includes('**done**'));
    });

    test('formatConsoleBatch caps long tool output', () => {
        const batch = formatConsoleBatch(
            [{ kind: 'tool', tool: 'bash', status: 'completed', summary: 'run', output: 'x'.repeat(5000), time: 1 }],
            null,
        );
        assert.ok(batch.length < 5000);
        assert.ok(batch.includes('…'));
        assert.ok(batch.includes('</code></tg-spoiler>'));
        assert.ok(!batch.includes('x'.repeat(5000)));
    });

    test('truncateHtml never breaks tags or entities', () => {
        assert.equal(truncateHtml('hello', 10), 'hello');
        assert.equal(truncateHtml('<b>hello <i>world</i> end</b>', 15), '<b>hello …</b>');
        const cut = truncateHtml('<i>a&lt;b&lt;c</i>', 8);
        assert.ok(!/&[a-z]*$/.test(cut.replace(/…<\/i>$/, '')));
        assert.ok(cut.endsWith('</i>'));
        assert.ok(cut.length <= 8);
    });

    test('formatProgress keeps valid HTML and footer when lastText expands on escape', () => {
        const text = formatProgress({
            title: 'T',
            directory: '/repo',
            model: 'm',
            todos: [],
            tools: [],
            result: null,
            lastText: '<test> '.repeat(600),
            toolCalls: 1,
            tokensIn: 100,
            tokensOut: 200,
            cost: 0.001,
            files: [],
            startedAt: 0,
            updatedAt: 60000,
        });
        assert.ok(text.length <= RENDER_BUDGET);
        assert.equal((text.match(/<i>/g) || []).length, (text.match(/<\/i>/g) || []).length);
        assert.ok(text.endsWith(' in'));
        assert.ok(text.includes('5449428597922079323'));
        assert.ok(!/&[a-zA-Z]*…/.test(text));
    });

    test('formatProgress does not leak raw markdown when lastText is cut mid-token', () => {
        const text = formatProgress({
            title: 'T',
            directory: '/repo',
            model: 'm',
            todos: Array.from({ length: 8 }, (_, i) => ({ content: `todo-${i} ${'x'.repeat(110)}`, state: 'queued' as const })),
            tools: [],
            result: null,
            lastText: '**done** and *fast* with a [link](https://example.com/very-long-path-here) plus ' + 'tail '.repeat(600),
            toolCalls: 1,
            tokensIn: 100,
            tokensOut: 200,
            cost: 0.001,
            files: [],
            startedAt: 0,
            updatedAt: 60000,
        });
        assert.ok(text.length <= RENDER_BUDGET);
        assert.ok(!text.includes('**'));
        assert.ok(!text.includes('[docs]('));
        assert.equal((text.match(/<i>/g) || []).length, (text.match(/<\/i>/g) || []).length);
    });
});

describe('formatter questions', () => {
    const REQUEST = {
        id: 'que_1',
        sessionID: 'ses_1',
        questions: [
            {
                header: 'Pick',
                question: 'Which <one>?',
                options: [
                    { label: 'Alpha', description: 'first' },
                    { label: 'Beta' },
                ],
            },
        ],
    };

    test('formatQuestion renders options with escaped markup', () => {
        const text = formatQuestion(REQUEST);
        assert.ok(text.includes('Which &lt;one&gt;?'));
        assert.ok(text.includes('Alpha'));
        assert.ok(text.includes('first'));
        const resolved = formatQuestionResolved(REQUEST, [['Beta']]);
        assert.ok(resolved.includes('5766933926429854499'));
        assert.ok(resolved.includes('Beta'));
        assert.ok(!resolved.includes('Alpha'));
    });
});

describe('formatter tmd markdown', () => {
    test('gap text between entities stays outside tags', () => {
        assert.equal(markdownToTelegramHtml('**done** and *fast*'), '<b>done</b> and <i>fast</i>');
        assert.equal(markdownToTelegramHtml('*a*   and   _b_'), '<i>a</i>   and   <i>b</i>');
    });

    test('headers become bold and code spans survive around markup', () => {
        assert.equal(markdownToTelegramHtml('# Title here'), '<b>Title here</b>');
        assert.equal(markdownToTelegramHtml('## Sub `x` tail'), '<b>Sub <code>x</code> tail</b>');
    });

    test('spoiler underline and links with underscores', () => {
        assert.equal(markdownToTelegramHtml('||hidden||'), '<tg-spoiler>hidden</tg-spoiler>');
        assert.equal(markdownToTelegramHtml('__line__'), '<u>line</u>');
        assert.equal(
            markdownToTelegramHtml('[a_b](https://x.io/y_z)'),
            '<a href="https://x.io/y_z">a_b</a>',
        );
    });
});

describe('formatter code blocks', () => {
    test('fenced code keeps its language for highlighting', () => {
        assert.equal(
            markdownToTelegramHtml('```js\nconsole.log(1);\n```'),
            '<pre><code class="language-javascript">console.log(1);\n</code></pre>',
        );
        assert.equal(markdownToTelegramHtml('```\nplain\n```'), '<pre>plain\n</pre>');
    });

    test('tool output with fences renders as highlightable blocks', () => {
        const batch = formatConsoleBatch(
            [{ kind: 'tool', tool: 'write', status: 'completed', summary: 'write f', output: '```solidity\ncontract C {}\n```', time: 1 }],
            null,
        );
        assert.ok(batch.includes('<pre><code class="language-solidity">'));
        assert.ok(!batch.includes('tg-spoiler'));
    });

    test('multiline tool output renders as a block, single line stays collapsed', () => {
        const block = formatConsoleBatch(
            [{ kind: 'tool', tool: 'bash', status: 'completed', summary: 'run', output: 'line1\nline2', time: 1 }],
            null,
        );
        assert.ok(block.includes('<pre>line1\nline2</pre>'));
        assert.ok(!block.includes('tg-spoiler'));
        const inline = formatConsoleBatch(
            [{ kind: 'tool', tool: 'bash', status: 'completed', summary: 'run', output: 'ok', time: 1 }],
            null,
        );
        assert.ok(inline.includes('</code></tg-spoiler>'));
    });
});

describe('formatter code collapse', () => {
    test('long code folds into a spoiler keeping the language', () => {
        assert.equal(langFromPath('write /a/counter.sol'), 'sol');
        assert.equal(langFromPath('bash ls -la'), '');
        const short = preBlock('a\nb', 'js');
        assert.ok(!short.includes('blockquote'));
        assert.ok(short.includes('language-javascript'));
        const long = preBlock(Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n'), 'sol');
        assert.ok(long.startsWith('<blockquote expandable><pre>'));
        assert.ok(long.includes('language-solidity'));
    });

    test('tool output derives the language from the summary path', () => {
        const batch = formatConsoleBatch(
            [{ kind: 'tool', tool: 'write', status: 'completed', summary: 'write /a/counter.sol', output: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk', time: 1 }],
            null,
        );
        assert.ok(batch.includes('<blockquote expandable><pre><code class="language-solidity">'));
    });
});
