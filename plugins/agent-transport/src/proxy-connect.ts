import net from 'net';

export interface ProxyConfig {
    url?: string;
    timeout?: number;
}

function getProxyUrl(explicit?: string): string | undefined {
    return explicit
        || process.env.all_proxy
        || process.env.ALL_PROXY
        || process.env.socks_proxy
        || process.env.SOCKS_PROXY
        || process.env.https_proxy
        || process.env.HTTPS_PROXY
        || process.env.http_proxy
        || process.env.HTTP_PROXY;
}

export function connectThroughProxy(
    targetHost: string,
    targetPort: number,
    config?: ProxyConfig,
): Promise<net.Socket> {
    const proxyUrl = getProxyUrl(config?.url);
    if (!proxyUrl) {
        return directConnect(targetHost, targetPort);
    }

    const proxy = new URL(proxyUrl);
    const isSocks = proxy.protocol.startsWith('socks');
    const timeout = config?.timeout ?? 10000;

    return new Promise((resolve, reject) => {
        const socket = net.createConnection({
            host: proxy.hostname,
            port: parseInt(proxy.port) || (isSocks ? 1080 : 8080),
        });

        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`proxy connect timeout (${timeout}ms)`));
        }, timeout);

        socket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        if (isSocks) {
            socks5Connect(socket, targetHost, targetPort, timer, resolve, reject);
        } else {
            httpConnect(socket, targetHost, targetPort, timer, resolve, reject);
        }
    });
}

function directConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => resolve(socket));
        socket.on('error', reject);
    });
}

function httpConnect(
    socket: net.Socket,
    targetHost: string,
    targetPort: number,
    timer: NodeJS.Timeout,
    resolve: (s: net.Socket) => void,
    reject: (e: Error) => void,
): void {
    const safeHost = targetHost.replace(/[\r\n]/g, '');
    socket.write(`CONNECT ${safeHost}:${targetPort} HTTP/1.1\r\nHost: ${safeHost}:${targetPort}\r\n\r\n`);

    let headerBuf = Buffer.alloc(0);
    const onHeader = (chunk: Buffer) => {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        const idx = headerBuf.indexOf('\r\n\r\n');
        if (idx < 0) return;

        clearTimeout(timer);
        socket.removeListener('data', onHeader);

        const header = headerBuf.toString().split('\r\n')[0];
        if (!header.includes('200')) {
            socket.destroy();
            return reject(new Error(`HTTP CONNECT failed: ${header}`));
        }

        const rest = headerBuf.subarray(idx + 4);
        if (rest.length > 0) socket.unshift(rest);
        resolve(socket);
    };

    socket.on('data', onHeader);
}

function socks5Connect(
    socket: net.Socket,
    targetHost: string,
    targetPort: number,
    timer: NodeJS.Timeout,
    resolve: (s: net.Socket) => void,
    reject: (e: Error) => void,
): void {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));

    let step = 0;
    socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
            if (chunk[1] !== 0x00) {
                clearTimeout(timer);
                socket.destroy();
                return reject(new Error('SOCKS5 auth failed'));
            }
            step = 1;
            const addr = targetHost.split('.').map(Number);
            const isIp = addr.length === 4 && addr.every(n => !isNaN(n) && n >= 0 && n <= 255);
            if (isIp) {
                const req = Buffer.alloc(10);
                req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01;
                req.writeUInt8(addr[0], 4); req.writeUInt8(addr[1], 5);
                req.writeUInt8(addr[2], 6); req.writeUInt8(addr[3], 7);
                req.writeUInt16BE(targetPort, 8);
                socket.write(req);
            } else {
                const hostBuf = Buffer.from(targetHost, 'ascii');
                const req = Buffer.alloc(7 + hostBuf.length);
                req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
                req.writeUInt8(hostBuf.length, 4);
                hostBuf.copy(req, 5);
                req.writeUInt16BE(targetPort, 5 + hostBuf.length);
                socket.write(req);
            }
        } else if (step === 1) {
            clearTimeout(timer);
            if (chunk[1] !== 0x00) {
                socket.destroy();
                return reject(new Error('SOCKS5 connect failed'));
            }
            socket.removeAllListeners('data');
            resolve(socket);
        }
    });
}
