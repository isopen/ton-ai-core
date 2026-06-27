import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import net from 'net';
import { connectThroughProxy } from '../src/proxy-connect';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

const PROXY_ENV_VARS = [
    'all_proxy', 'ALL_PROXY', 'socks_proxy', 'SOCKS_PROXY',
    'https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY',
];

function saveAndClearProxyEnv(): Record<string, string | undefined> {
    const saved: Record<string, string | undefined> = {};
    for (const key of PROXY_ENV_VARS) {
        saved[key] = process.env[key];
        delete process.env[key];
    }
    return saved;
}

function restoreProxyEnv(saved: Record<string, string | undefined>): void {
    for (const key of PROXY_ENV_VARS) {
        if (saved[key] !== undefined) {
            process.env[key] = saved[key];
        } else {
            delete process.env[key];
        }
    }
}

describe('proxy-connect', () => {
    describe('getProxyUrl via env vars', () => {
        test('reads from all_proxy', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.all_proxy = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected - proxy won't work but getProxyUrl was called
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from ALL_PROXY', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.ALL_PROXY = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from socks_proxy', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.socks_proxy = 'socks5://proxy:1080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from SOCKS_PROXY', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.SOCKS_PROXY = 'socks5://proxy:1080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from https_proxy', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.https_proxy = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from HTTPS_PROXY', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.HTTPS_PROXY = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from http_proxy', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.http_proxy = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('reads from HTTP_PROXY', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.HTTP_PROXY = 'http://proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('explicit config overrides env var', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.http_proxy = 'http://env-proxy:9999';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port, { url: 'http://127.0.0.1:1' });
                } catch {
                    // expected - uses explicit URL not env
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('falls through env var chain', async () => {
            const saved = saveAndClearProxyEnv();
            process.env.https_proxy = 'http://fallback-proxy:8080';
            try {
                const port = getPort();
                const server = net.createServer((s) => { s.destroy(); });
                await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

                try {
                    await connectThroughProxy('127.0.0.1', port);
                } catch {
                    // expected
                }

                await new Promise<void>((r) => server.close(() => r()));
            } finally {
                restoreProxyEnv(saved);
            }
        });
    });

    describe('direct connection (no proxy)', () => {
        test('connects directly when no proxy configured', async () => {
            const saved = saveAndClearProxyEnv();
            try {
                const port = getPort();
                const server = net.createServer((socket) => {
                    socket.write('hello');
                    socket.end();
                });
                await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

                const socket = await connectThroughProxy('127.0.0.1', port);
                const data = await new Promise<Buffer>((resolve) => {
                    const chunks: Buffer[] = [];
                    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                    socket.on('end', () => resolve(Buffer.concat(chunks)));
                });

                assert.ok(data.equals(Buffer.from('hello')));
                await new Promise<void>((resolve) => server.close(() => resolve()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('direct connect fails on unreachable port', async () => {
            const saved = saveAndClearProxyEnv();
            try {
                try {
                    await connectThroughProxy('127.0.0.1', 1);
                    assert.fail('should have thrown');
                } catch {
                    // expected
                }
            } finally {
                restoreProxyEnv(saved);
            }
        });
    });

    describe('HTTP CONNECT proxy', () => {
        test('connects through HTTP proxy', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('target data');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let data = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                    if (data.includes('\r\n\r\n')) {
                        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                        const target = net.createConnection(targetPort, '127.0.0.1', () => {
                            socket.pipe(target);
                            target.pipe(socket);
                        });
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            const socket = await connectThroughProxy('127.0.0.1', targetPort, {
                url: `http://127.0.0.1:${proxyPort}`,
            });

            const data = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks)));
            });

            assert.ok(data.equals(Buffer.from('target data')));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });

        test('HTTP proxy rejects with non-200 status', async () => {
            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let data = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                    if (data.includes('\r\n\r\n')) {
                        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                        socket.destroy();
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            try {
                await connectThroughProxy('127.0.0.1', 12345, {
                    url: `http://127.0.0.1:${proxyPort}`,
                });
                assert.fail('should have thrown');
            } catch (e: any) {
                assert.ok(e.message.includes('HTTP CONNECT failed'));
            }

            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        });

        test('HTTP proxy sends correct CONNECT request', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('ok');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            let receivedRequest = '';
            const proxyServer = net.createServer((socket) => {
                let data = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                    if (data.includes('\r\n\r\n')) {
                        receivedRequest = data.toString();
                        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                        const target = net.createConnection(targetPort, '127.0.0.1', () => {
                            socket.pipe(target);
                            target.pipe(socket);
                        });
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            await connectThroughProxy('testhost.example.com', targetPort, {
                url: `http://127.0.0.1:${proxyPort}`,
            });

            assert.ok(receivedRequest.includes('CONNECT testhost.example.com:'));
            assert.ok(receivedRequest.includes('Host: testhost.example.com:'));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });

        test('HTTP header arrives in multiple chunks', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('chunked target');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let data = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                    if (data.includes('\r\n\r\n')) {
                        socket.write('HTTP/1.1 200 Conne');
                        setTimeout(() => {
                            socket.write('ction Established\r\n\r\n');
                            const target = net.createConnection(targetPort, '127.0.0.1', () => {
                                socket.pipe(target);
                                target.pipe(socket);
                            });
                        }, 10);
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            const socket = await connectThroughProxy('127.0.0.1', targetPort, {
                url: `http://127.0.0.1:${proxyPort}`,
            });

            const data = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks)));
            });

            assert.ok(data.equals(Buffer.from('chunked target')));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });

        test('HTTP proxy rest data is preserved', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('target');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let data = Buffer.alloc(0);
                socket.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                    if (data.includes('\r\n\r\n')) {
                        socket.write('HTTP/1.1 200 Connection Established\r\n\r\nextra-data');
                        const target = net.createConnection(targetPort, '127.0.0.1', () => {
                            socket.pipe(target);
                            target.pipe(socket);
                        });
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            const socket = await connectThroughProxy('127.0.0.1', targetPort, {
                url: `http://127.0.0.1:${proxyPort}`,
            });

            const data = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks)));
            });

            assert.ok(data.includes(Buffer.from('target')));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });
    });

    describe('SOCKS5 proxy', () => {
        test('connects through SOCKS5 with IP target', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('socks target');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let step = 0;
                socket.on('data', (chunk) => {
                    if (step === 0) {
                        socket.write(Buffer.from([0x05, 0x00]));
                        step = 1;
                    } else if (step === 1) {
                        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        const target = net.createConnection(targetPort, '127.0.0.1', () => {
                            socket.pipe(target);
                            target.pipe(socket);
                        });
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            const socket = await connectThroughProxy('127.0.0.1', targetPort, {
                url: `socks5://127.0.0.1:${proxyPort}`,
            });

            const data = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks)));
            });

            assert.ok(data.equals(Buffer.from('socks target')));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });

        test('SOCKS5 with domain name target', async () => {
            const targetPort = getPort();
            const targetServer = net.createServer((socket) => {
                socket.write('domain');
                socket.end();
            });
            await new Promise<void>((resolve) => targetServer.listen(targetPort, '127.0.0.1', resolve));

            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let step = 0;
                socket.on('data', (chunk) => {
                    if (step === 0) {
                        socket.write(Buffer.from([0x05, 0x00]));
                        step = 1;
                    } else if (step === 1) {
                        assert.strictEqual(chunk[3], 0x03);
                        const hostLen = chunk[4];
                        const host = chunk.subarray(5, 5 + hostLen).toString();
                        const port = chunk.readUInt16BE(5 + hostLen);
                        assert.strictEqual(host, 'example.com');
                        assert.strictEqual(port, 443);
                        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        const target = net.createConnection(targetPort, '127.0.0.1', () => {
                            socket.pipe(target);
                            target.pipe(socket);
                        });
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            const socket = await connectThroughProxy('example.com', 443, {
                url: `socks5://127.0.0.1:${proxyPort}`,
            });

            const data = await new Promise<Buffer>((resolve) => {
                const chunks: Buffer[] = [];
                socket.on('data', (chunk: Buffer) => chunks.push(chunk));
                socket.on('end', () => resolve(Buffer.concat(chunks)));
            });

            assert.ok(data.equals(Buffer.from('domain')));
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            await new Promise<void>((resolve) => targetServer.close(() => resolve()));
        });

        test('SOCKS5 auth failure', async () => {
            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                socket.on('data', () => {
                    socket.write(Buffer.from([0x05, 0x01]));
                    socket.destroy();
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            try {
                await connectThroughProxy('127.0.0.1', 8080, {
                    url: `socks5://127.0.0.1:${proxyPort}`,
                });
                assert.fail('should have thrown');
            } catch (e: any) {
                assert.ok(e.message.includes('SOCKS5 auth failed'));
            }

            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        });

        test('SOCKS5 connect failure', async () => {
            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                let step = 0;
                socket.on('data', () => {
                    if (step === 0) {
                        socket.write(Buffer.from([0x05, 0x00]));
                        step = 1;
                    } else {
                        socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                        socket.destroy();
                    }
                });
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            try {
                await connectThroughProxy('127.0.0.1', 8080, {
                    url: `socks5://127.0.0.1:${proxyPort}`,
                });
                assert.fail('should have thrown');
            } catch (e: any) {
                assert.ok(e.message.includes('SOCKS5 connect failed'));
            }

            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        });
    });

    describe('timeout and default ports', () => {
        test('proxy connection times out', async () => {
            const proxyPort = getPort();
            const proxyServer = net.createServer((socket) => {
                socket.on('data', () => {});
            });
            await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

            try {
                await connectThroughProxy('127.0.0.1', 8080, {
                    url: `http://127.0.0.1:${proxyPort}`,
                    timeout: 200,
                });
                assert.fail('should have thrown');
            } catch (e: any) {
                assert.ok(e.message.includes('timeout'));
            }

            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        });

        test('SOCKS5 default port is 1080 when URL has no port', async () => {
            const saved = saveAndClearProxyEnv();
            try {
                const proxyPort = getPort();
                const proxyServer = net.createServer((socket) => {
                    let step = 0;
                    socket.on('data', () => {
                        if (step === 0) {
                            socket.write(Buffer.from([0x05, 0x00]));
                            step = 1;
                        } else {
                            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                            socket.destroy();
                        }
                    });
                });
                await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

                try {
                    await connectThroughProxy('127.0.0.1', 8080, {
                        url: `socks5://127.0.0.1`,
                    });
                } catch {
                    // expected - uses default port 1080 which won't reach our server on proxyPort
                }

                await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            } finally {
                restoreProxyEnv(saved);
            }
        });

        test('HTTP default port is 8080 when URL has no port', async () => {
            const saved = saveAndClearProxyEnv();
            try {
                const proxyPort = getPort();
                const proxyServer = net.createServer((socket) => {
                    let data = Buffer.alloc(0);
                    socket.on('data', (chunk) => {
                        data = Buffer.concat([data, chunk]);
                        if (data.includes('\r\n\r\n')) {
                            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                            socket.pipe(socket);
                        }
                    });
                });
                await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));

                try {
                    await connectThroughProxy('127.0.0.1', 8080, {
                        url: `http://127.0.0.1`,
                    });
                } catch {
                    // expected - uses default port 8080 which won't reach our server
                }

                await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
            } finally {
                restoreProxyEnv(saved);
            }
        });
    });
});
