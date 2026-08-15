import { spawn } from 'child_process';
import * as net from 'net';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('telegram');

const PROXY_PORT = parseInt(process.env.WS_PROXY_PORT || '9500', 10);

function waitForPort(port: number, host = '127.0.0.1', timeout = 10000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tryConnect = () => {
            if (Date.now() - start > timeout) {
                return reject(new Error(`Timeout waiting for port ${port}`));
            }
            const sock = new net.Socket();
            sock.once('connect', () => { sock.destroy(); resolve(); });
            sock.once('error', () => { sock.destroy(); setTimeout(tryConnect, 200); });
            sock.connect(port, host);
        };
        tryConnect();
    });
}

async function main() {
    const proxy = spawn('npx', ['tsx', 'src/utils/ws-tcp-proxy.ts'], {
        stdio: 'inherit',
        env: { ...process.env, WS_PROXY_PORT: String(PROXY_PORT) },
    });

    proxy.on('exit', (code) => {
        log.info(`Proxy exited with code ${code}`);
        process.exit(code ?? 1);
    });

    await waitForPort(PROXY_PORT);
    log.info(`Proxy ready on port ${PROXY_PORT}`);

    const dev = spawn('next', ['dev'], {
        stdio: 'inherit',
        env: {
            ...process.env,
            TELEGRAM_TRANSPORT: 'websocket',
            TELEGRAM_WS_PROXY: `ws://127.0.0.1:${PROXY_PORT}`,
        },
    });

    dev.on('exit', (code) => {
        proxy.kill();
        process.exit(code ?? 0);
    });

    process.on('SIGINT', () => { proxy.kill(); dev.kill(); process.exit(0); });
    process.on('SIGTERM', () => { proxy.kill(); dev.kill(); process.exit(0); });
}

main().catch((e) => { log.error(e); process.exit(1); });
