'use strict';

const readline = require('readline');

const state = {
    listCalls: 0,
    readCalls: 0,
    cancelledIds: [],
};

const TOOLS = [
    { name: 'plain', description: 'plain tool', inputSchema: { type: 'object' } },
    { name: 'state-probe', description: 'test introspection', inputSchema: { type: 'object' } },
];

const RESOURCES = [
    { uri: 'file:///a.txt', name: 'a.txt', mimeType: 'text/plain' },
    { uri: 'file:///b.txt', name: 'b.txt', mimeType: 'text/plain' },
    { uri: 'file:///c.txt', name: 'c.txt', mimeType: 'text/plain' },
];

const PROMPTS = [
    { name: 'review', description: 'review code', arguments: [{ name: 'code', required: true }] },
];

function reply(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error }) + '\n');
}

function notify(method, params) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        return;
    }
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.method && msg.id === undefined) {
        if (msg.method === 'notifications/cancelled' && msg.params) {
            state.cancelledIds.push(msg.params.requestId);
        }
        return;
    }
    if (msg.id === undefined) return;
    const params = msg.params || {};
    const id = msg.id;

    if (msg.method === 'server/discover') {
        reply(id, {
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'rich-fake', version: '3.0.0' },
            ttlMs: 60000,
            cacheScope: 'private',
        });
        return;
    }

    if (msg.method === 'tools/list') {
        state.listCalls += 1;
        const tools = [...TOOLS];
        if (state.listCalls > 1) {
            tools.push({ name: 'late', description: 'late tool', inputSchema: { type: 'object' } });
        }
        reply(id, {
            resultType: 'complete',
            tools,
            ttlMs: 60000,
            cacheScope: 'private',
        });
        return;
    }

    if (msg.method === 'tools/call' && params.name === 'state-probe') {
        reply(id, { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(state) }] });
        return;
    }

    if (msg.method === 'tools/call' && params.name === 'meta-probe') {
        reply(id, { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(params._meta || null) }] });
        return;
    }

    if (msg.method === 'tools/call' && params.name === 'need-input') {
        if (params.inputResponses && params.requestState === 'state-1') {
            reply(id, { resultType: 'complete', content: [{ type: 'text', text: `done:${params.inputResponses.login.content.name}` }] });
        } else {
            reply(id, {
                resultType: 'input_required',
                inputRequests: {
                    login: {
                        method: 'elicitation/create',
                        params: { mode: 'form', message: 'Login?', requestedSchema: { type: 'object' } },
                    },
                },
                requestState: 'state-1',
            });
        }
        return;
    }

    if (msg.method === 'tools/call' && params.name === 'always-ask') {
        reply(id, {
            resultType: 'input_required',
            inputRequests: {
                login: { method: 'elicitation/create', params: {} },
            },
            requestState: 'state-9',
        });
        return;
    }

    if (msg.method === 'tools/call') {
        reply(id, { resultType: 'complete', content: [{ type: 'text', text: '{"ok":true}' }] });
        return;
    }

    if (msg.method === 'resources/list') {
        const page = params.cursor === 'p2' ? RESOURCES.slice(2) : RESOURCES.slice(0, 2);
        const result = { resultType: 'complete', resources: page, ttlMs: 60000, cacheScope: 'private' };
        if (!params.cursor) result.nextCursor = 'p2';
        reply(id, result);
        return;
    }

    if (msg.method === 'resources/read') {
        state.readCalls += 1;
        if (params.inputResponses) {
            reply(id, { resultType: 'complete', contents: [{ uri: params.uri, mimeType: 'text/plain', text: 'gated-content' }] });
            return;
        }
        if (params.uri === 'file:///gated.txt') {
            reply(id, { resultType: 'input_required', inputRequests: { ok: { method: 'elicitation/create', params: {} } } });
            return;
        }
        const found = RESOURCES.find((entry) => entry.uri === params.uri);
        if (!found) {
            fail(id, -32602, 'Resource not found', { uri: params.uri });
            return;
        }
        reply(id, {
            resultType: 'complete',
            contents: [{ uri: found.uri, mimeType: found.mimeType, text: `content-of-${found.name}` }],
            ttlMs: 60000,
            cacheScope: 'private',
        });
        return;
    }

    if (msg.method === 'resources/templates/list') {
        reply(id, {
            resultType: 'complete',
            resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'files' }],
            ttlMs: 60000,
            cacheScope: 'private',
        });
        return;
    }

    if (msg.method === 'prompts/list') {
        reply(id, { resultType: 'complete', prompts: PROMPTS, ttlMs: 60000, cacheScope: 'private' });
        return;
    }

    if (msg.method === 'prompts/get') {
        if (params.name !== 'review') {
            fail(id, -32602, 'Invalid params');
            return;
        }
        reply(id, {
            resultType: 'complete',
            description: 'Review prompt',
            messages: [{ role: 'user', content: { type: 'text', text: `review ${(params.arguments || {}).code || ''}` } }],
        });
        return;
    }

    if (msg.method === 'subscriptions/listen') {
        notify('notifications/subscriptions/acknowledged', {
            _meta: { 'io.modelcontextprotocol/subscriptionId': id },
            notifications: params.notifications || {},
        });
        const filter = params.notifications || {};
        if (filter.toolsListChanged) {
            setTimeout(() => {
                notify('notifications/tools/list_changed', {
                    _meta: { 'io.modelcontextprotocol/subscriptionId': id },
                });
            }, 50).unref?.();
        }
        if (Array.isArray(filter.resourceSubscriptions) && filter.resourceSubscriptions.includes('file:///a.txt')) {
            setTimeout(() => {
                notify('notifications/resources/updated', {
                    _meta: { 'io.modelcontextprotocol/subscriptionId': id },
                    uri: 'file:///a.txt',
                });
            }, 50).unref?.();
        }
        return;
    }

    if (msg.method === 'debug/state') {
        reply(id, { state });
        return;
    }

    fail(id, -32601, 'Method not found');
});
