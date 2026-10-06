import { strict as assert } from 'assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpHub, McpHttpTransport, McpEmptyStreamError, McpError, mcpCallJson } from '../index';
import type { McpLogger } from '../types';

interface Route {
    method: string;
    reply: (id: number | string, params: Record<string, unknown>, headers: IncomingMessage['headers']) => {
        status: number;
        contentType: string;
        body: string;
        keepOpen?: boolean;
        sessionId?: string;
        onOpen?: (res: ServerResponse) => void;
    };
}

interface FakeServer {
    server: Server;
    url: string;
    counts: Record<string, number>;
    lastHeaders: Record<string, Record<string, unknown>>;
}

function startServer(routes: Route[]): Promise<FakeServer> {
    const counts: Record<string, number> = {};
    const lastHeaders: Record<string, Record<string, unknown>> = {};
    return new Promise((resolve) => {
        const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                let message: { id?: number | string; method?: string; params?: Record<string, unknown> };
                try {
                    message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {
                    res.writeHead(400).end('bad json');
                    return;
                }
                const method = message.method ?? '';
                counts[method] = (counts[method] ?? 0) + 1;
                lastHeaders[method] = { ...req.headers } as Record<string, unknown>;
                const route = routes.find((entry) => entry.method === method);
                if (!route) {
                    res.writeHead(200, { 'content-type': 'application/json' }).end(
                        JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }),
                    );
                    return;
                }
                const out = route.reply(message.id as number | string, message.params ?? {}, req.headers);
                const headers: Record<string, string> = { 'content-type': out.contentType };
                if (out.sessionId) headers['mcp-session-id'] = out.sessionId;
                if (out.keepOpen) {
                    res.writeHead(out.status, headers);
                    res.write(out.body);
                    out.onOpen?.(res);
                    return;
                }
                res.writeHead(out.status, headers).end(out.body);
            });
        });
        srv.listen(0, '127.0.0.1', () => {
            const address = srv.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server: srv, url: `http://127.0.0.1:${port}/mcp`, counts, lastHeaders });
        });
    });
}

const closeServer = (server: Server): Promise<void> =>
    new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });

const jsonRoute = (method: string, result: (params: Record<string, unknown>) => unknown, sessionId?: string): Route => ({
    method,
    reply: (id) => ({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result: result({}) }),
        sessionId,
    }),
});

const discoverRoute = jsonRoute('server/discover', () => ({
    supportedVersions: ['2026-07-28'],
    serverInfo: { name: 'probe', version: '1.0.0' },
}));

const toolsRoute = jsonRoute('tools/list', () => ({
    tools: [{ name: 'work', description: 'worker', inputSchema: { type: 'object' } }],
    ttlMs: 10000,
}));

const callRoute = (body: unknown, sessionId?: string): Route => ({
    method: 'tools/call',
    reply: (id) => ({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result: body }),
        sessionId,
    }),
});

async function waitFor(condition: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for ${label}`);
}

describe('mcp hub reliability', () => {
    test('caps runaway pagination at maxListPages', async () => {
        const { server, url, counts } = await startServer([
            discoverRoute,
            {
                method: 'resources/list',
                reply: (id) => ({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id,
                        result: {
                            resources: [{ uri: 'file:///r', name: 'r' }],
                            nextCursor: `page-${Math.random()}`,
                            ttlMs: 10000,
                        },
                    }),
                }),
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } }, { maxListPages: 3 });
            await hub.connect();

            await assert.rejects(() => hub.listResources('srv'), /pagination exceeded 3 pages/);
            assert.equal(counts['resources/list'], 3);
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('does not retry a tools/call after an empty stream', async () => {
        const { server, url, counts } = await startServer([
            discoverRoute,
            toolsRoute,
            {
                method: 'tools/call',
                reply: () => ({ status: 200, contentType: 'text/event-stream', body: '' }),
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            await assert.rejects(
                () => hub.callTool('srv', 'work', {}),
                (error: unknown) => error instanceof McpEmptyStreamError,
            );
            assert.equal(counts['tools/call'], 1);
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('mcpCallJson surfaces isError results as McpError', async () => {
        const { server, url } = await startServer([
            discoverRoute,
            toolsRoute,
            callRoute({ content: [{ type: 'text', text: 'boom' }], isError: true }),
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            await assert.rejects(
                () => mcpCallJson(hub, 'srv', 'work', {}),
                (error: unknown) => {
                    assert.ok(error instanceof McpError);
                    assert.ok(String((error as Error).message).includes('MCP tool failed'));
                    return true;
                },
            );
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('echoes the assigned mcp-session-id on later requests', async () => {
        const { server, url, lastHeaders } = await startServer([
            jsonRoute('server/discover', () => ({
                supportedVersions: ['2026-07-28'],
                serverInfo: { name: 'probe', version: '1.0.0' },
            }), 'sess-42'),
            toolsRoute,
            callRoute({ content: [{ type: 'text', text: 'ok' }] }),
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();
            await hub.callTool('srv', 'work', {});

            assert.equal(lastHeaders['server/discover']['mcp-session-id'], undefined);
            assert.equal(lastHeaders['tools/call']?.['mcp-session-id'], 'sess-42');
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('cancels the open SSE stream after the tool response arrives', async () => {
        let streamClosed = false;
        const { server, url } = await startServer([
            discoverRoute,
            toolsRoute,
            {
                method: 'tools/call',
                reply: (id) => ({
                    status: 200,
                    contentType: 'text/event-stream',
                    keepOpen: true,
                    body: `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'done' }] } })}\n\n`,
                    onOpen: (res) => {
                        res.on('close', () => {
                            streamClosed = true;
                        });
                    },
                }),
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            const result = await hub.callTool('srv', 'work', {});
            assert.equal(result.content[0]?.text, 'done');
            await waitFor(() => streamClosed, 'stream close');
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('keeps connecting remaining servers when one fails', async () => {
        const { server, url, counts } = await startServer([discoverRoute, toolsRoute]);
        try {
            const hub = new McpHub({
                bad: { transport: 'http', url: 'http://127.0.0.1:1/mcp' },
                good: { transport: 'http', url },
            });

            await assert.rejects(() => hub.connect());

            assert.equal(hub.status('good'), 'ready');
            assert.equal(hub.status('bad'), 'closed');
            assert.ok(counts['server/discover'] >= 1);
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('does not adopt a session id from an error response', async () => {
        let calls = 0;
        const { server, url, lastHeaders } = await startServer([
            discoverRoute,
            toolsRoute,
            {
                method: 'tools/call',
                reply: (id) => {
                    calls += 1;
                    if (calls === 1) {
                        return { status: 500, contentType: 'application/json', body: 'boom', sessionId: 'ghost' };
                    }
                    return {
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } }),
                    };
                },
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            await assert.rejects(() => hub.callTool('srv', 'work', {}), /status 500/);
            await hub.callTool('srv', 'work', {});

            assert.equal(lastHeaders['tools/call']?.['mcp-session-id'], undefined);
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('readResource returns copies that do not poison the cache', async () => {
        const { server, url } = await startServer([
            discoverRoute,
            jsonRoute('resources/read', () => ({
                contents: [{ uri: 'file:///x', mimeType: 'text/plain', text: 'original' }],
                ttlMs: 10000,
            })),
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            const first = await hub.readResource('srv', 'file:///x');
            first[0].text = 'mutated';
            const second = await hub.readResource('srv', 'file:///x');

            assert.equal(second[0].text, 'original');
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('logs the transport failure reason when a subscription dies before ack', async () => {
        const { server, url } = await startServer([
            discoverRoute,
            {
                method: 'subscriptions/listen',
                reply: () => ({ status: 200, contentType: 'text/event-stream', body: '', keepOpen: true }),
            },
        ]);
        const debugLines: string[] = [];
        const logger: McpLogger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: (message) => debugLines.push(String(message)),
        };
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } }, { logger, requestTimeoutMs: 5000 });
            await hub.connect();

            const subscribing = hub.subscribe('srv', { toolsListChanged: true }, () => {});
            await new Promise((resolve) => setTimeout(resolve, 200));
            const assertion = assert.rejects(subscribing, (error: unknown) => error instanceof McpError);
            server.closeAllConnections();
            await assertion;

            assert.ok(
                debugLines.some((line) => line.includes('MCP subscription request failed')),
                `expected pending failure in debug log, got: ${JSON.stringify(debugLines)}`,
            );
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('listTools keeps polling remaining servers when one fails', async () => {
        let toolsListCalls = 0;
        const flakyFirst = await startServer([
            discoverRoute,
            {
                method: 'tools/list',
                reply: (id) => {
                    toolsListCalls += 1;
                    if (toolsListCalls === 1) {
                        return {
                            status: 200,
                            contentType: 'application/json',
                            body: JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'internal' } }),
                        };
                    }
                    return {
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [], ttlMs: 10000 } }),
                    };
                },
            },
        ]);
        const second = await startServer([discoverRoute, toolsRoute]);
        try {
            const hub = new McpHub({
                a: { transport: 'http', url: flakyFirst.url },
                b: { transport: 'http', url: second.url },
            });
            await hub.connect();

            await assert.rejects(() => hub.listTools(), /internal/);
            assert.equal(second.counts['tools/list'], 1);
            await hub.close();
        } finally {
            await closeServer(flakyFirst.server);
            await closeServer(second.server);
        }
    });

    test('rejects connect when discover answers with input_required', async () => {
        const { server, url, counts } = await startServer([
            {
                method: 'server/discover',
                reply: (id) => ({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id,
                        result: { resultType: 'input_required', inputRequests: { ack: { method: 'x' } } },
                    }),
                }),
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });

            await assert.rejects(
                () => hub.connect(),
                (error: unknown) => {
                    assert.ok(error instanceof McpError);
                    assert.ok(String((error as Error).message).includes('additional input during version negotiation'));
                    return true;
                },
            );
            assert.equal(counts['initialize'], undefined);
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('notify forwards explicit headers to the wire', async () => {
        const { server, url, lastHeaders } = await startServer([discoverRoute]);
        try {
            const transport = new McpHttpTransport({ url });
            await transport.start();

            await transport.notify(
                { jsonrpc: '2.0', method: 'notifications/test' },
                { 'MCP-Protocol-Version': '2026-07-28' },
            );

            assert.equal(lastHeaders['notifications/test']?.['mcp-protocol-version'], '2026-07-28');
            await transport.close();
        } finally {
            await closeServer(server);
        }
    });

    test('captures serverInfo from the legacy initialize response', async () => {
        const LEGACY_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'legacy-mcp', version: '9.9.9' } });
  } else {
    reply({});
  }
});
`;
        const debugLines: string[] = [];
        const logger: McpLogger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: (message) => debugLines.push(String(message)),
        };
        const hub = new McpHub(
            { srv: { transport: 'stdio', command: process.execPath, args: ['-e', LEGACY_SERVER] } },
            { logger },
        );
        await hub.connect();

        assert.ok(
            debugLines.some((line) => line.includes('MCP server ready (srv legacy-mcp 9.9.9 era=legacy)')),
            `expected ready log with serverInfo, got: ${JSON.stringify(debugLines)}`,
        );
        await hub.close();
    });
});
