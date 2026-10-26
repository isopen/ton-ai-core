export const DEFAULT_SERVE_PORT = 8178;
export const DEFAULT_SERVE_HOSTNAME = '127.0.0.1';
export const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1'];

export interface ServeTarget {
    port: number;
    hostname: string;
}

export interface ServerArgsOptions {
    modelPath: string;
    threads: number;
    language: string;
}

export function parseServeTarget(serverUrl: string): ServeTarget | null {
    try {
        const url = new URL(serverUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const port = url.port ? Number.parseInt(url.port, 10) : DEFAULT_SERVE_PORT;
        return {
            port: Number.isFinite(port) ? port : DEFAULT_SERVE_PORT,
            hostname: url.hostname || DEFAULT_SERVE_HOSTNAME
        };
    } catch {
        return null;
    }
}

export function isLoopback(hostname: string): boolean {
    return LOOPBACK_HOSTNAMES.includes(hostname.replace(/^\[|\]$/g, ''));
}

export function serveArgs(target: ServeTarget, opts: ServerArgsOptions): string[] {
    return [
        '-m', opts.modelPath,
        '-t', String(opts.threads),
        '-l', opts.language,
        '--port', String(target.port)
    ];
}
