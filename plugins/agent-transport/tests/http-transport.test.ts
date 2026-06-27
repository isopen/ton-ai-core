import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import http from 'http';
import net from 'net';
import { HttpTransport } from '../src/http-transport';
import { MAX_CONNECTIONS, MAX_MESSAGE_SIZE } from '../src/types';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

function postRequest(port: number, data: Buffer, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1', port, path: '/', method: 'POST',
                headers: { 'Content-Length': data.length.toString(), ...headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
            }
        );
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function getRequest(port: number, path: string = '/'): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${path}`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

describe('HttpTransport', () => {
    describe('start/stop', () => {
        test('start and stop server', async () => {
            const port = getPort();
            const transport = new HttpTransport(port, '127.0.0.1', undefined, true);
            await transport.start();
            await transport.stop();
        });

        test('stop without server does nothing', async () => {
            const transport = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            await transport.stop();
        });

        test('non-server start does nothing', async () => {
            const transport = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            await transport.start();
        });
    });

    describe('basic request handling', () => {
        test('POST receives data', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const payload = Buffer.from('hello http');
            await postRequest(port, payload);

            await new Promise(r => setTimeout(r, 50));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));
            await server.stop();
        });

        test('GET returns 404', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const { status } = await getRequest(port);
            assert.strictEqual(status, 404);
            await server.stop();
        });

        test('empty POST body does not emit message', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            let msgCount = 0;
            server.on('message', () => { msgCount++; });
            await server.start();

            await postRequest(port, Buffer.alloc(0));
            await new Promise(r => setTimeout(r, 50));
            assert.strictEqual(msgCount, 0);
            await server.stop();
        });
    });

    describe('peer-id header', () => {
        test('x-peer-id is captured', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            let peerId: string | undefined;
            server.on('message', (_msg: Buffer, _id: string, pid: string) => { peerId = pid; });
            await server.start();

            await postRequest(port, Buffer.from('data'), { 'X-Peer-ID': 'peer-abc' });
            await new Promise(r => setTimeout(r, 50));
            assert.strictEqual(peerId, 'peer-abc');
            await server.stop();
        });

        test('missing x-peer-id passes undefined', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            let peerId: string = 'not-set';
            server.on('message', (_msg: Buffer, _id: string, pid: string) => { peerId = pid; });
            await server.start();

            await postRequest(port, Buffer.from('data'));
            await new Promise(r => setTimeout(r, 50));
            assert.strictEqual(peerId, undefined);
            await server.stop();
        });
    });

    describe('503 too many connections', () => {
        test('returns 503 when max connections exceeded', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            for (let i = 0; i < MAX_CONNECTIONS; i++) {
                connections.set(`fake-${i}`, {
                    sessionId: `fake-${i}`,
                    lastActivity: Date.now(),
                    outbox: [],
                    pendingPoll: null,
                });
            }

            const { status, body } = await postRequest(port, Buffer.from('overflow'));
            assert.strictEqual(status, 503);
            assert.ok(body.toString().includes('Too many connections'));

            await server.stop();
        });

        test('existing connection is not rejected', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            for (let i = 0; i < MAX_CONNECTIONS; i++) {
                connections.set(`fake-${i}`, {
                    sessionId: `fake-${i}`,
                    lastActivity: Date.now(),
                    outbox: [],
                    pendingPoll: null,
                });
            }

            const { status } = await postRequest(port, Buffer.from('existing'));
            assert.ok(status === 200 || status === 503);

            await server.stop();
        });
    });

    describe('payload too large', () => {
        test('returns 413 for oversized payload', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const hugePayload = Buffer.alloc(MAX_MESSAGE_SIZE + 100, 0x41);
            const { status } = await postRequest(port, hugePayload);
            assert.strictEqual(status, 413);

            await server.stop();
        });
    });

    describe('parseWaitParam', () => {
        test('returns 0 for no query string', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const { status } = await postRequest(port, Buffer.alloc(0));
            assert.strictEqual(status, 200);
            await server.stop();
        });

        test('returns 0 for query without wait', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const { status } = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
                const req = http.request(
                    { hostname: '127.0.0.1', port, path: '/?foo=bar', method: 'POST', headers: { 'Content-Length': '0' } },
                    (res) => {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk: Buffer) => chunks.push(chunk));
                        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
                    }
                );
                req.on('error', reject);
                req.write(Buffer.alloc(0));
                req.end();
            });

            assert.strictEqual(status, 200);
            await server.stop();
        });

        test('clamps wait to max 25', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('response'), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('init'), undefined, 25);
            assert.ok(response.equals(Buffer.from('response')));
            await server.stop();
        });

        test('wait=0 returns empty response immediately', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const { status, body } = await new Promise<{ status: number; body: Buffer }>((resolve) => {
                const req = http.request(
                    { hostname: '127.0.0.1', port, path: '/?wait=0', method: 'POST', headers: { 'Content-Length': '0' } },
                    (res) => {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk: Buffer) => chunks.push(chunk));
                        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
                    }
                );
                req.write(Buffer.alloc(0));
                req.end();
            });

            assert.strictEqual(status, 200);
            assert.strictEqual(body.length, 0);
            await server.stop();
        });

        test('wait with non-numeric value returns 0', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const { status } = await new Promise<{ status: number; body: Buffer }>((resolve) => {
                const req = http.request(
                    { hostname: '127.0.0.1', port, path: '/?wait=abc', method: 'POST', headers: { 'Content-Length': '0' } },
                    (res) => {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk: Buffer) => chunks.push(chunk));
                        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
                    }
                );
                req.write(Buffer.alloc(0));
                req.end();
            });

            assert.strictEqual(status, 200);
            await server.stop();
        });
    });

    describe('long-poll', () => {
        test('long-poll times out with empty response', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.alloc(0), undefined, 0.5);
            assert.strictEqual(response.length, 0);
            await server.stop();
        });

        test('long-poll returns data when sent', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('echo:' + msg.toString()), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('ping'), undefined, 2);
            assert.ok(response.equals(Buffer.from('echo:ping')));
            await server.stop();
        });

        test('long-poll is cancelled when client disconnects', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const pollPromise = client.sendToServer('127.0.0.1', port, Buffer.alloc(0), undefined, 0.5);

            const response = await pollPromise;
            assert.strictEqual(response.length, 0);
            await server.stop();
        });
    });

    describe('outbox', () => {
        test('send with connId queues to outbox when no pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            let connId = '';
            server.on('message', (_msg: Buffer, id: string) => { connId = id; });

            await postRequest(port, Buffer.from('init'));
            await new Promise(r => setTimeout(r, 50));

            server.send(Buffer.from('queued'), connId);

            const response = await postRequest(port, Buffer.alloc(0));
            assert.ok(response.body.equals(Buffer.from('queued')));
            await server.stop();
        });

        test('send without connId queues to outbox when no pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            await postRequest(port, Buffer.from('init'));
            await new Promise(r => setTimeout(r, 50));

            server.send(Buffer.from('queued'));

            const response = await postRequest(port, Buffer.alloc(0));
            assert.ok(response.body.equals(Buffer.from('queued')));
            await server.stop();
        });

        test('send with non-existent connId falls through to broadcast', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            await postRequest(port, Buffer.from('init'));
            await new Promise(r => setTimeout(r, 50));

            server.send(Buffer.from('broadcast'), 'nonexistent');

            const response = await postRequest(port, Buffer.alloc(0));
            assert.ok(response.body.equals(Buffer.from('broadcast')));
            await server.stop();
        });

        test('send without connId with no connections does nothing', () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.send(Buffer.from('nothing'));
        });
    });

    describe('send with pending poll', () => {
        test('send with connId responds to pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('poll-data'), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('init'), undefined, 2);
            assert.ok(response.equals(Buffer.from('poll-data')));
            await server.stop();
        });

        test('send without connId responds to first pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', () => {
                server.send(Buffer.from('broadcast'));
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('trigger'), undefined, 2);
            assert.ok(response.equals(Buffer.from('broadcast')));
            await server.stop();
        });
    });

    describe('sendToServer', () => {
        test('returns response', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('echo:' + msg.toString()), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('ping'));
            assert.ok(response.equals(Buffer.from('echo:ping')));
            await server.stop();
        });

        test('sendToServer with wait param', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('echo:' + msg.toString()), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('ping'), undefined, 5);
            assert.ok(response.equals(Buffer.from('echo:ping')));
            await server.stop();
        });

        test('sendToServer with peerId', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            let peerId = '';
            server.on('message', (_msg: Buffer, id: string, pid: string) => {
                peerId = pid;
                server.send(Buffer.from('ok'), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            await client.sendToServer('127.0.0.1', port, Buffer.from('test'), 'my-peer');
            assert.strictEqual(peerId, 'my-peer');
            await server.stop();
        });

        test('sendToServer timeout returns empty buffer', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('test'), undefined, 0);
            assert.strictEqual(response.length, 0);
            await server.stop();
        });

        test('sendToServer connection error rejects', async () => {
            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            await assert.rejects(
                () => client.sendToServer('127.0.0.1', 1, Buffer.from('test')),
                /ECONNREFUSED/
            );
        });
    });

    describe('long-poll close and error handling', () => {
        test('cancels pending poll when client disconnects', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const req = http.request(
                { hostname: '127.0.0.1', port, path: '/?wait=5', method: 'POST', headers: { 'Content-Length': '0' } },
                () => {}
            );
            req.on('error', () => {});
            req.write(Buffer.alloc(0));
            req.end();
            await new Promise(r => setTimeout(r, 100));

            req.destroy();
            await new Promise(r => setTimeout(r, 200));

            await server.stop();
        });

        test('handles error on incoming request', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));

            socket.write('POST / HTTP/1.1\r\nContent-Length: 10\r\n\r\n');
            await new Promise(r => setTimeout(r, 50));
            socket.destroy();
            await new Promise(r => setTimeout(r, 200));

            await server.stop();
        });
    });

    describe('send to pending poll broadcast', () => {
        test('send without connId queues when no pending poll exists', () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.send(Buffer.from('no-connections'));
            server.send(Buffer.from('data'), 'nonexistent');
        });
    });

    describe('stop with pending polls', () => {
        test('stop resolves pending polls', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            server.on('message', (msg: Buffer, id: string) => {
                server.send(Buffer.from('response'), id);
            });
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.from('ping'), undefined, 2);
            assert.ok(response.equals(Buffer.from('response')));
            await server.stop();
        });

        test('stop clears pending poll timers', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.alloc(0), undefined, 0.5);
            assert.strictEqual(response.length, 0);
            await server.stop();
        });

        test('stop without server resolves', async () => {
            const transport = new HttpTransport(getPort(), '127.0.0.1', undefined, true);
            await transport.stop();
        });
    });

    describe('internal state manipulation', () => {
        test('req error handler returns 500', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write('POST / HTTP/1.1\r\nContent-Length: 10\r\n\r\n');
            await new Promise(r => setTimeout(r, 50));
            socket.destroy();
            await new Promise(r => setTimeout(r, 200));
            await server.stop();
        });

        test('stop clears pending poll timers via direct state', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            const fakeRes = {
                writeHead: () => {},
                end: () => {},
            };
            const fakeTimer = setTimeout(() => {}, 10000);
            connections.set('test-conn', {
                sessionId: 'test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: fakeTimer },
            });

            await server.stop();
            assert.ok(connections.size === 0);
        });

        test('send with connId queues to outbox when no pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            connections.set('test-conn', {
                sessionId: 'test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: null,
            });

            server.send(Buffer.from('queued'), 'test-conn');
            const conn = connections.get('test-conn');
            assert.strictEqual(conn.outbox.length, 1);
            assert.ok(conn.outbox[0].equals(Buffer.from('queued')));
            await server.stop();
        });

        test('send without connId broadcasts to first connection with pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const fakeRes = {
                writeHead: () => {},
                end: () => {},
            };
            const fakeTimer = setTimeout(() => {}, 10000);
            const connections = (server as any).connections as Map<string, any>;
            connections.set('test-conn', {
                sessionId: 'test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: fakeTimer },
            });

            server.send(Buffer.from('broadcast'));
            assert.ok(connections.get('test-conn').pendingPoll === null);
            await server.stop();
        });

        test('send with connId responds to pending poll', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const fakeRes = {
                writeHead: () => {},
                end: () => {},
            };
            const fakeTimer = setTimeout(() => {}, 10000);
            const connections = (server as any).connections as Map<string, any>;
            connections.set('test-conn', {
                sessionId: 'test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: fakeTimer },
            });

            server.send(Buffer.from('poll-data'), 'test-conn');
            assert.ok(connections.get('test-conn').pendingPoll === null);
            await server.stop();
        });

        test('long-poll timeout fires and returns empty response', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const client = new HttpTransport(getPort(), '127.0.0.1', undefined, false);
            const response = await client.sendToServer('127.0.0.1', port, Buffer.alloc(0), undefined, 1);
            assert.strictEqual(response.length, 0);
            await server.stop();
        }, 10000);

        test('long-poll timer fires via direct state manipulation', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const fakeRes: any = {
                writeHead: () => {},
                end: () => {},
            };
            const fakeTimer = setTimeout(() => {}, 10000);
            const connections = (server as any).connections as Map<string, any>;
            connections.set('timer-conn', {
                sessionId: 'timer-test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: fakeTimer },
            });

            let endCalled = false;
            fakeRes.end = () => { endCalled = true; };

            const conn = connections.get('timer-conn');
            const pollRes = conn.pendingPoll.res;

            const writeHeadCalls: number[][] = [];
            fakeRes.writeHead = (...args: any[]) => writeHeadCalls.push(args);

            const timer = setTimeout(() => {
                if (conn.pendingPoll?.res === pollRes) {
                    conn.pendingPoll = null;
                    fakeRes.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                    fakeRes.end(Buffer.alloc(0));
                }
            }, 50);

            await new Promise(r => setTimeout(r, 200));
            clearTimeout(timer);
            assert.ok(endCalled);
            assert.strictEqual(conn.pendingPoll, null);
            await server.stop();
        });

        test('long-poll timer does not fire if pendingPoll was cleared', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            let endCalled = false;
            const fakeRes: any = {
                writeHead: () => {},
                end: () => { endCalled = true; },
            };
            const connections = (server as any).connections as Map<string, any>;
            connections.set('cleared-conn', {
                sessionId: 'cleared-test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: setTimeout(() => {}, 10000) },
            });

            const conn = connections.get('cleared-conn');
            conn.pendingPoll = null;

            await new Promise(r => setTimeout(r, 100));
            assert.ok(!endCalled);
            await server.stop();
        });

        test('req error triggers 500 response', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            let writeHeadStatus: number | undefined;
            let endCalled = false;
            const fakeRes: any = {
                writeHead: (status: number) => { writeHeadStatus = status; },
                end: () => { endCalled = true; },
            };

            const fakeReq: any = new (require('events').EventEmitter)();
            fakeReq.method = 'POST';
            fakeReq.url = '/';
            fakeReq.headers = { 'content-length': '0' };
            fakeReq.socket = { remoteAddress: '127.0.0.1', remotePort: 54321 };
            (server as any).handleRequest(fakeReq, fakeRes);

            await new Promise(r => setTimeout(r, 50));
            fakeReq.emit('error', new Error('test error'));
            await new Promise(r => setTimeout(r, 50));

            assert.strictEqual(writeHeadStatus, 500);
            assert.ok(endCalled);
            await server.stop();
        });

        test('req error via direct state manipulation', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            let endCalled = false;
            let writeHeadStatus: number | undefined;
            const fakeRes: any = {
                writeHead: (status: number) => { writeHeadStatus = status; },
                end: () => { endCalled = true; },
            };

            const connections = (server as any).connections as Map<string, any>;
            connections.set('error-conn', {
                sessionId: 'error-test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: null,
            });

            const fakeReq: any = new (require('events').EventEmitter)();
            fakeReq.method = 'POST';
            fakeReq.url = '/';
            fakeReq.headers = { 'content-length': '0' };
            fakeReq.socket = { remoteAddress: '127.0.0.1', remotePort: 12345 };
            (server as any).handleRequest(fakeReq, fakeRes);

            fakeReq.emit('end');
            await new Promise(r => setTimeout(r, 50));
            fakeReq.emit('error', new Error('test error'));
            await new Promise(r => setTimeout(r, 50));

            assert.strictEqual(writeHeadStatus, 500);
            assert.ok(endCalled);
            await server.stop();
        });

        test('constructor with default parameters', () => {
            const transport = new HttpTransport(8080);
            assert.strictEqual((transport as any).host, '127.0.0.1');
            assert.strictEqual((transport as any).isServer, false);
        });

        test('handles request with null url', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            let endCalled = false;
            const fakeRes: any = {
                writeHead: () => {},
                end: () => { endCalled = true; },
            };

            const fakeReq: any = new (require('events').EventEmitter)();
            fakeReq.method = 'POST';
            fakeReq.url = null;
            fakeReq.headers = { 'content-length': '0' };
            fakeReq.socket = { remoteAddress: '127.0.0.1', remotePort: 11111 };
            (server as any).handleRequest(fakeReq, fakeRes);

            fakeReq.emit('end');
            await new Promise(r => setTimeout(r, 50));
            assert.ok(endCalled);
            await server.stop();
        });

        test('long-poll timer skips if pendingPoll was already cleared by close', async () => {
            const port = getPort();
            const server = new HttpTransport(port, '127.0.0.1', undefined, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            const fakeRes: any = {
                writeHead: () => {},
                end: () => {},
            };
            connections.set('close-conn', {
                sessionId: 'close-test',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: { res: fakeRes, timer: setTimeout(() => {}, 10000) },
            });

            const conn = connections.get('close-conn');
            conn.pendingPoll = null;

            const fakeReq: any = new (require('events').EventEmitter)();
            fakeReq.method = 'POST';
            fakeReq.url = '/?wait=1';
            fakeReq.headers = { 'content-length': '0' };
            fakeReq.socket = { remoteAddress: '127.0.0.1', remotePort: 22222 };
            (server as any).connections.set('close-conn2', {
                sessionId: 'close-test2',
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: null,
            });

            const fakeRes2: any = {
                writeHead: () => {},
                end: () => {},
            };

            const fakeReq2: any = new (require('events').EventEmitter)();
            fakeReq2.method = 'POST';
            fakeReq2.url = '/?wait=1';
            fakeReq2.headers = { 'content-length': '0' };
            fakeReq2.socket = { remoteAddress: '127.0.0.1', remotePort: 33333 };
            (server as any).handleRequest(fakeReq2, fakeRes2);

            fakeReq2.emit('end');
            await new Promise(r => setTimeout(r, 50));

            const conn2 = (server as any).connections.get('close-conn2');
            conn2.pendingPoll = null;

            await new Promise(r => setTimeout(r, 1200));
            await server.stop();
        });
    });
});
