import { strict as assert } from 'assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpHttpTransport } from '../http-transport';
import { McpError } from '../types';

interface Route {
    method: string;
    reply: (id: number | string, params: unknown) => { status: number; body: string; contentType: string; sessionId?: string };
}

function startServer(routes: Route[], onSessionId?: (id: string | null) => void): Promise<{ server: Server; url: string }> {
    return new Promise((resolve) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                onSessionId?.(req.headers['mcp-session-id'] as string ?? null);
                let message: { id?: number | string; method?: string; params?: unknown };
                try {
                    message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {
                    res.writeHead(400).end('bad json');
                    return;
                }
                const route = routes.find((entry) => entry.method === message.method);
                if (!route) {
                    const body = JSON.stringify({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32601, message: 'Method not found' },
                    });
                    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
                    return;
                }
                const out = route.reply(message.id as number | string, message.params);
                const headers: Record<string, string> = { 'content-type': out.contentType };
                if (out.sessionId) headers['mcp-session-id'] = out.sessionId;
                res.writeHead(out.status, headers).end(out.body);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
        });
    });
}

function jsonRoute(
    method: string,
    result: (id: number | string, params: unknown) => unknown,
    sessionId?: string,
): Route {
    return {
        method,
        reply: (id, params) => ({
            status: 200,
            contentType: 'application/json',
            sessionId,
            body: JSON.stringify({ jsonrpc: '2.0', id, result: result(id, params) }),
        }),
    };
}

const closeServer = (server: Server): Promise<void> =>
    new Promise((resolve) => server.close(() => resolve()));

function canon(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('mcp http transport', () => {
    test('plain JSON request flow works', async () => {
        const { server, url } = await startServer([
            jsonRoute('initialize', () => ({
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: { name: 'fake-http', version: '2.0.0' },
            })),
            jsonRoute('tools/call', (_id, params) => ({
                content: [{ type: 'text', text: `got:${JSON.stringify((params as { arguments?: unknown }).arguments)}` }],
            })),
        ]);
        try {
            const transport = new McpHttpTransport({ url });
            await transport.start();
            const init = await transport.request(
                { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {} } },
                5000,
            );
            assert.deepEqual(canon((init.result as { serverInfo: { name: string } }).serverInfo), {
                name: 'fake-http',
                version: '2.0.0',
            });
            const call = await transport.request(
                { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 't', arguments: { a: 1 } } },
                5000,
            );
            assert.deepEqual(canon(call.result), { content: [{ type: 'text', text: 'got:{"a":1}' }] });
            await transport.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
            await transport.close();
            await assert.rejects(
                transport.request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }, 1000),
                /closed/,
            );
        } finally {
            await closeServer(server);
        }
    });

    test('SSE stream responses resolve by id', async () => {
        const { server, url } = await startServer([
            {
                method: 'tools/call',
                reply: (id) => ({
                    status: 200,
                    contentType: 'text/event-stream',
                    body:
                        'event: message\ndata: {"jsonrpc":"2.0","id":999,"result":{"content":[]}}\n\n' +
                        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'streamed' }] } })}\n\n`,
                }),
            },
        ]);
        try {
            const transport = new McpHttpTransport({ url });
            await transport.start();
            const response = await transport.request(
                { jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} },
                5000,
            );
            assert.deepEqual(canon(response.result), { content: [{ type: 'text', text: 'streamed' }] });
            await transport.close();
        } finally {
            await closeServer(server);
        }
    });

    test('per-request headers carry method, name and version', async () => {
        const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];
        const raw = await new Promise<{ server: Server; url: string }>((resolve) => {
            const inner = createServer((req: IncomingMessage, res: ServerResponse) => {
                let text = '';
                req.on('data', (chunk: Buffer) => {
                    text += chunk.toString();
                });
                req.on('end', () => {
                    seenHeaders.push({ ...req.headers });
                    const message = JSON.parse(text) as { id: number | string };
                    res.writeHead(200, { 'content-type': 'application/json' }).end(
                        JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok' }] } }),
                    );
                });
            });
            inner.listen(0, '127.0.0.1', () => {
                const address = inner.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                resolve({ server: inner, url: `http://127.0.0.1:${port}/mcp` });
            });
        });
        try {
            const transport = new McpHttpTransport({ url: raw.url });
            await transport.start();
            await transport.request(
                { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ping', arguments: {} } },
                5000,
                { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'ping' },
            );
            await transport.close();
        } finally {
            await closeServer(raw.server);
        }
        assert.equal(seenHeaders.length, 1);
        assert.equal(seenHeaders[0]['mcp-protocol-version'], '2026-07-28');
        assert.equal(seenHeaders[0]['mcp-method'], 'tools/call');
        assert.equal(seenHeaders[0]['mcp-name'], 'ping');
    });

    test('HTTP error statuses become McpError', async () => {
        const { server, url } = await startServer([
            {
                method: 'tools/call',
                reply: () => ({ status: 500, contentType: 'text/plain', body: 'boom' }),
            },
        ]);
        try {
            const transport = new McpHttpTransport({ url });
            await transport.start();
            await assert.rejects(
                transport.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, 5000),
                (error: unknown) => {
                    assert.ok(error instanceof McpError);
                    assert.equal((error as McpError).code, 500);
                    return true;
                },
            );
            await transport.close();
        } finally {
            await closeServer(server);
        }
    });

    test('non-http urls are rejected at start', async () => {
        const transport = new McpHttpTransport({ url: 'ws://127.0.0.1:1/mcp' });
        await assert.rejects(transport.start(), /only http\(s\) urls/);
    });
});
