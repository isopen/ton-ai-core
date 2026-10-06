import { strict as assert } from 'assert';
import { join } from 'node:path';
import { McpHub, McpError, mcpContentText } from '../index';
import type { McpJsonRpcNotification } from '../types';

const RICH_SERVER = join(__dirname, 'fake-rich-server.cjs');

function richConfig() {
    return {
        transport: 'stdio' as const,
        command: process.execPath,
        args: [RICH_SERVER],
    };
}

async function stateOf(hub: McpHub): Promise<{ listCalls: number; readCalls: number; cancelledIds: unknown[] }> {
    const res = await hub.callTool('rich', 'state-probe', {});
    return JSON.parse(mcpContentText(res)) as { listCalls: number; readCalls: number; cancelledIds: unknown[] };
}

async function waitFor(condition: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
        if (await condition()) return;
        if (Date.now() >= deadline) {
            throw new Error(`timed out waiting for ${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

describe('mcp resources and prompts', () => {
    test('resources list paginates and reads return contents', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        const resources = await hub.listResources('rich');
        assert.deepEqual(
            resources.map((entry) => entry.uri),
            ['file:///a.txt', 'file:///b.txt', 'file:///c.txt'],
        );
        assert.equal(resources[0].server, 'rich');
        const contents = await hub.readResource('rich', 'file:///a.txt');
        assert.deepEqual(contents, [{ uri: 'file:///a.txt', mimeType: 'text/plain', text: 'content-of-a.txt' }]);
        await assert.rejects(hub.readResource('rich', 'file:///missing.txt'), (error: unknown) => {
            assert.ok(error instanceof McpError);
            assert.equal((error as McpError).code, -32602);
            return true;
        });
        await hub.close();
    });

    test('resource reads are cached per uri', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        await hub.readResource('rich', 'file:///a.txt');
        await hub.readResource('rich', 'file:///a.txt');
        assert.equal((await stateOf(hub)).readCalls, 1);
        await hub.close();
    });

    test('resource templates list works', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        const templates = await hub.listResourceTemplates('rich');
        assert.deepEqual(
            templates.map((entry) => entry.uriTemplate),
            ['file:///{path}'],
        );
        await hub.close();
    });

    test('prompts list and get work', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        const prompts = await hub.listPrompts('rich');
        assert.deepEqual(prompts.map((entry) => entry.name), ['review']);
        assert.deepEqual(prompts[0].arguments, [{ name: 'code', required: true }]);
        const prompt = await hub.getPrompt('rich', 'review', { code: 'x = 1' });
        assert.equal(prompt.description, 'Review prompt');
        assert.deepEqual(prompt.messages, [{ role: 'user', content: { type: 'text', text: 'review x = 1' } }]);
        await assert.rejects(hub.getPrompt('rich', 'nope', {}), (error: unknown) => {
            assert.ok(error instanceof McpError);
            assert.ok(String((error as Error).message).includes('Invalid params'));
            return true;
        });
        await hub.close();
    });
});

describe('mcp multi round-trip requests', () => {
    test('input handler completes the round trip with echoed state', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        const seen: Array<{ server: string; method: string }> = [];
        const result = await hub.callTool(
            'rich',
            'need-input',
            {},
            {
                onInput: async (server, method, inputRequests) => {
                    seen.push({ server, method });
                    assert.deepEqual(Object.keys(inputRequests), ['login']);
                    return { login: { action: 'accept', content: { name: 'octocat' } } };
                },
            },
        );
        assert.equal(mcpContentText(result), 'done:octocat');
        assert.deepEqual(seen, [{ server: 'rich', method: 'tools/call' }]);
        await hub.close();
    });

    test('missing handler surfaces input_required as McpError', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        await assert.rejects(hub.callTool('rich', 'need-input', {}), (error: unknown) => {
            assert.ok(error instanceof McpError);
            assert.ok(String((error as Error).message).includes('additional input'));
            return true;
        });
        await hub.close();
    });

    test('aborted input and exhausted rounds throw', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        await assert.rejects(
            hub.callTool('rich', 'always-ask', {}, { onInput: async () => null }),
            /aborted/,
        );
        await assert.rejects(
            hub.callTool(
                'rich',
                'always-ask',
                {},
                { onInput: async () => ({ login: { action: 'accept', content: {} } }), maxRounds: 2 },
            ),
            /rounds exhausted/,
        );
        await hub.close();
    });

    test('resources/read supports the same round trip', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        const contents = await hub.readResource('rich', 'file:///gated.txt', {
            onInput: async () => ({ ok: { action: 'accept', content: {} } }),
        });
        assert.deepEqual(contents, [{ uri: 'file:///gated.txt', mimeType: 'text/plain', text: 'gated-content' }]);
        await hub.close();
    });
});

describe('mcp subscriptions', () => {
    test('list_changed invalidates the tools cache', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        assert.deepEqual((await hub.listTools('rich')).map((tool) => tool.name).sort(), ['plain', 'state-probe']);
        const events: McpJsonRpcNotification[] = [];
        const unsubscribe = await hub.subscribe('rich', { toolsListChanged: true }, (notification) => {
            events.push(notification);
        });
        await waitFor(
            async () => events.some((event) => event.method === 'notifications/tools/list_changed'),
            'list_changed notification',
        );
        assert.ok(events.some((event) => event.method === 'notifications/subscriptions/acknowledged'));
        await waitFor(
            async () => (await hub.listTools('rich')).some((tool) => tool.name === 'late'),
            'refreshed tools list',
        );
        await unsubscribe();
        await hub.close();
    });

    test('resources/updated clears the read cache for that uri', async () => {
        const hub = new McpHub({ rich: richConfig() });
        await hub.connect('rich');
        await hub.readResource('rich', 'file:///a.txt');
        assert.equal((await stateOf(hub)).readCalls, 1);
        const events: McpJsonRpcNotification[] = [];
        const unsubscribe = await hub.subscribe('rich', { resourceSubscriptions: ['file:///a.txt'] }, (notification) => {
            events.push(notification);
        });
        await waitFor(
            async () => events.some((event) => event.method === 'notifications/resources/updated'),
            'resources/updated notification',
        );
        await hub.readResource('rich', 'file:///a.txt');
        assert.equal((await stateOf(hub)).readCalls, 2);
        await unsubscribe();
        await hub.close();
    });
});
