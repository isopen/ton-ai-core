import { strict as assert } from 'assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpHub } from '../hub';
import { McpError } from '../types';

interface Route {
    method: string;
    reply: (id: number | string, params: unknown) => { status: number; contentType: string; body: string; keepOpen?: boolean };
}

function startServer(routes: Route[], onDiscover?: () => void): Promise<{ server: Server; url: string }> {
    return new Promise((resolve) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                let message: { id?: number | string; method?: string };
                try {
                    message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {
                    res.writeHead(400).end('bad json');
                    return;
                }
                if (message.method === 'server/discover') onDiscover?.();
                const route = routes.find((entry) => entry.method === message.method);
                if (!route) {
                    res.writeHead(200, { 'content-type': 'application/json' }).end(
                        JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }),
                    );
                    return;
                }
                const out = route.reply(message.id as number | string, message.params);
                if (out.keepOpen) {
                    res.writeHead(out.status, { 'content-type': 'text/event-stream' });
                    res.write(out.body);
                    return;
                }
                res.writeHead(out.status, { 'content-type': out.contentType }).end(out.body);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
        });
    });
}

const jsonRoute = (method: string, result: () => unknown): Route => ({
    method,
    reply: (id) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result: result() }) }),
});

const discoverRoute = jsonRoute('server/discover', () => ({
    supportedVersions: ['2026-07-28'],
    serverInfo: { name: 'probe', version: '1.0.0' },
}));

const closeServer = (server: Server): Promise<void> =>
    new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });

jest.setTimeout(20000);

describe('mcp hub audit fixes', () => {
    test('keeps resources and templates lists in separate cache entries', async () => {
        const { server, url } = await startServer([
            discoverRoute,
            jsonRoute('resources/list', () => ({ resources: [{ uri: 'file:///r1', name: 'real-resource' }], ttlMs: 10000 })),
            jsonRoute('resources/templates/list', () => ({ resourceTemplates: [{ uriTemplate: 'tpl://t1/{x}', name: 'real-template' }], ttlMs: 10000 })),
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });
            await hub.connect();

            const resources = await hub.listResources('srv');
            const templates = await hub.listResourceTemplates('srv');

            assert.equal(resources[0].name, 'real-resource');
            assert.equal(templates[0].name, 'real-template');
            assert.equal((await hub.listResources('srv'))[0].name, 'real-resource');
            assert.equal((await hub.listResourceTemplates('srv'))[0].name, 'real-template');
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('rejects subscribe when the transport closes before ack', async () => {
        const { server, url } = await startServer([
            discoverRoute,
            {
                method: 'subscriptions/listen',
                reply: () => ({
                    status: 200,
                    contentType: 'text/event-stream',
                    body: '',
                    keepOpen: true,
                }),
            },
        ]);
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } }, { requestTimeoutMs: 5000 });
            await hub.connect();

            const subscribing = hub.subscribe('srv', { toolsListChanged: true }, () => {});
            await new Promise((resolve) => setTimeout(resolve, 200));
            const assertion = assert.rejects(
                subscribing,
                (error: unknown) => {
                    assert.ok(error instanceof McpError);
                    return true;
                },
            );
            server.closeAllConnections();
            await assertion;
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });

    test('serializes concurrent connects to the same server', async () => {
        let discovers = 0;
        const { server, url } = await startServer([discoverRoute], () => { discovers += 1; });
        try {
            const hub = new McpHub({ srv: { transport: 'http', url } });

            await Promise.all([hub.connect(), hub.connect()]);

            assert.equal(discovers, 1);
            assert.equal(hub.status('srv'), 'ready');
            await hub.close();
        } finally {
            await closeServer(server);
        }
    });
});
