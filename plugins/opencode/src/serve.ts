export const DEFAULT_SERVE_PORT = 4096;
export const DEFAULT_SERVE_HOSTNAME = '127.0.0.1';

export interface ServeTarget {
    port: number;
    hostname: string;
}

export interface SpawnedProcess {
    pid?: number;
    kill(signal?: string): boolean;
    on(event: string, listener: (...args: Array<unknown>) => void): void;
}

export type SpawnFn = (command: string, args: string[]) => SpawnedProcess;

export function parseServeTarget(baseUrl: string): ServeTarget {
    try {
        const url = new URL(baseUrl);
        const port = url.port ? Number.parseInt(url.port, 10) : DEFAULT_SERVE_PORT;
        return {
            port: Number.isFinite(port) ? port : DEFAULT_SERVE_PORT,
            hostname: url.hostname || DEFAULT_SERVE_HOSTNAME,
        };
    } catch {
        return { port: DEFAULT_SERVE_PORT, hostname: DEFAULT_SERVE_HOSTNAME };
    }
}

export function serveArgs(target: ServeTarget): string[] {
    return ['serve', '--port', String(target.port), '--hostname', target.hostname];
}
