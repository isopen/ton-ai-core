import { strict as assert } from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_DIR = join(__dirname, '..');
const WIDGET = join(AGENT_DIR, 'tgcloud', 'lib', 'widget.js');
const FIXTURES = join(AGENT_DIR, 'tgcloud', 'lib', 'fixtures.js');
const HANDLER = join(AGENT_DIR, 'tgcloud', 'handlers', 'message.js');

const url = (path: string) => pathToFileURL(path).href;

function runModule(lines: string[]): string {
    return execFileSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], {
        encoding: 'utf8',
    }).trim();
}

describe('tgs-gallary Telegram widget', () => {
    const stdout = runModule([
        `import { galleryTeaser, galleryWidget } from ${JSON.stringify(url(WIDGET))};`,
        `import { fixtureStats } from ${JSON.stringify(url(FIXTURES))};`,
        "import { deflateSync } from 'node:zlib';",
        'const stats = fixtureStats();',
        'const html = galleryWidget(stats);',
        'const teaser = galleryTeaser(stats);',
        'console.log(JSON.stringify({',
        '  html,',
        '  teaser,',
        '  bytes: Buffer.byteLength(html, "utf8"),',
        '  packed: deflateSync(html, { level: 9 }).length,',
        '  stats,',
        '}));',
    ]);
    const result = JSON.parse(stdout) as {
        html: string;
        teaser: string;
        bytes: number;
        packed: number;
        stats: { count: number; bytes: number; packs: number; names: string[] };
    };

    test('fits the widget limits', () => {
        assert.ok(result.bytes <= 32768, `uncompressed HTML is ${result.bytes} bytes`);
        assert.ok(result.packed <= 4096, `compressed HTML is ${result.packed} bytes`);
        assert.ok(result.packed <= 3800, `compressed HTML is ${result.packed} bytes, keep a safety margin`);
    });

    test('is self-contained and offline', () => {
        assert.ok(!/<(?:img|script|link|iframe|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["']https?:/i.test(result.html), 'must not load external resources');
        assert.ok(!/@import\s+url\s*\(/i.test(result.html), 'must not import external styles');
        assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(result.html), 'must not use network APIs');
        assert.ok(!/<(?:input|textarea|select)\b/i.test(result.html), 'widgets have no keyboard');
    });

    test('shows the gallery and opens it', () => {
        assert.ok(result.html.includes('TGS Gallary'));
        assert.ok(result.html.includes('https://app9208241906.tgcloud.ai/'));
        assert.ok(result.html.includes('TelegramWidget.openLink'));
        assert.ok(result.html.includes(result.stats.count.toLocaleString('en-US')));
        assert.ok(result.html.includes(String(result.stats.packs)));
        assert.ok(result.html.includes((result.stats.bytes / 1000000).toFixed(1) + ' MB'));
        const featured = ['PepeEmoji', 'DogeEmoji', 'Cat2O', 'UtyaD', 'TONEmoji', 'HalloweenTeamEmoji']
            .filter((name) => result.stats.names.includes(name));
        assert.ok(featured.length > 0);
        assert.ok(result.html.includes(featured[0]));
    });

    test('teaser carries the same numbers for the button message', () => {
        assert.ok(result.teaser.includes('<b>TGS Gallary</b>'));
        assert.ok(result.teaser.includes(result.stats.count.toLocaleString('en-US')));
        assert.ok(result.teaser.includes(String(result.stats.packs)));
        assert.ok(result.teaser.includes((result.stats.bytes / 1000000).toFixed(1) + ' MB'));
    });

    test('handler probes the widget in private chats and falls back to a teaser', () => {
        const handler = readFileSync(HANDLER, 'utf8');
        assert.ok(handler.includes("from '../lib/widget.js'"));
        assert.ok(handler.includes('galleryWidget(stats)'));
        assert.ok(handler.includes('api.sendWidget'));
        assert.ok(handler.includes('allow_queries: false'));
        assert.ok(handler.includes("message.chat.type === 'private'"));
        assert.ok(handler.includes('widgetsBlocked'), 'a blocked widget is not retried on every /start');
        assert.ok(handler.includes('api.sendMessage'));
        assert.ok(handler.includes('galleryTeaser(stats)'));
        assert.ok(handler.includes("parse_mode: 'HTML'"));
        assert.ok(handler.includes('web_app'));
        assert.ok(handler.includes('url: APP_URL'));

        const privateBlock = handler.slice(handler.indexOf('if (isPrivate'), handler.indexOf('await reply(galleryTeaser(stats)'));
        assert.ok(privateBlock.includes('api.sendWidget'), 'sendWidget must be private-chat only');
        assert.ok(privateBlock.includes('catch (e)'), 'widget failures must fall back');
    });
});
