import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RadarLock {
    path: string;
    pid: number;
}

export function lockPathFor(statePath: string): string {
    return `${statePath}.lock`;
}

export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function acquireRadarLock(lockPath: string): RadarLock {
    mkdirSync(dirname(lockPath), { recursive: true });
    if (existsSync(lockPath)) {
        let holder = 0;
        try {
            const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown };
            if (typeof raw.pid === 'number' && Number.isFinite(raw.pid)) holder = Math.floor(raw.pid);
        } catch {
            holder = 0;
        }
        if (holder > 0 && holder !== process.pid && isPidAlive(holder)) {
            throw new Error(`opencode-radar already running (pid ${holder}, lock ${lockPath})`);
        }
    }
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return { path: lockPath, pid: process.pid };
}

export function releaseRadarLock(lock: RadarLock | null): void {
    if (!lock) return;
    try {
        const raw = JSON.parse(readFileSync(lock.path, 'utf8')) as { pid?: unknown };
        if (raw.pid !== lock.pid) return;
        rmSync(lock.path, { force: true });
    } catch {
    }
}
