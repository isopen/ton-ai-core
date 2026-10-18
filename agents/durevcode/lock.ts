import { mkdirSync, openSync, closeSync, writeSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface DurevcodeLock {
    path: string;
    pid: number;
}

export function lockPathFor(statePath: string): string {
    return `${statePath}.lock`;
}

export function sharedChatLockPath(chatId: number, baseDir?: string): string {
    const dir = baseDir ?? join(homedir(), '.local', 'share', 'durevcode');
    return join(dir, `durevcode-chat-${chatId}.lock`);
}

export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'EPERM') return true;
        return false;
    }
}

export function acquireDurevcodeLock(lockPath: string): DurevcodeLock {
    mkdirSync(dirname(lockPath), { recursive: true });
    const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let fd: number | null = null;
        try {
            fd = openSync(lockPath, 'wx');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        if (fd !== null) {
            try {
                writeSync(fd, payload);
            } finally {
                closeSync(fd);
            }
            return { path: lockPath, pid: process.pid };
        }
        let holder = 0;
        try {
            const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown };
            if (typeof raw.pid === 'number' && Number.isFinite(raw.pid)) holder = Math.floor(raw.pid);
        } catch {
            holder = 0;
        }
        if (holder > 0 && holder !== process.pid && isPidAlive(holder)) {
            throw new Error(`durevcode already running (pid ${holder}, lock ${lockPath})`);
        }
        try {
            rmSync(lockPath, { force: true });
        } catch {
        }
    }
    throw new Error(`durevcode lock is contended: ${lockPath}`);
}

export function releaseDurevcodeLock(lock: DurevcodeLock | null): void {
    if (!lock) return;
    try {
        const raw = JSON.parse(readFileSync(lock.path, 'utf8')) as { pid?: unknown };
        if (raw.pid !== lock.pid) return;
        rmSync(lock.path, { force: true });
    } catch {
    }
}
