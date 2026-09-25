import { strict as assert } from 'assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { acquireRadarLock, isPidAlive, lockPathFor, releaseRadarLock, sharedChatLockPath } from '../lock';

let lockCounter = 0;

function lockPath(): string {
    lockCounter += 1;
    return `/tmp/opencode/radar-lock-test-${process.pid}-${lockCounter}.json.lock`;
}

describe('radar single-instance lock', () => {
    test('lockPathFor derives from the state path', () => {
        assert.equal(lockPathFor('/tmp/x/state.json'), '/tmp/x/state.json.lock');
    });

    test('second acquire fails while the holder is alive', () => {
        const path = lockPath();
        const first = acquireRadarLock(path);
        assert.equal(first.pid, process.pid);
        releaseRadarLock(first);
        const child = spawn('sleep', ['30']);
        writeFileSync(path, JSON.stringify({ pid: child.pid, startedAt: 1 }));
        try {
            assert.ok(isPidAlive(child.pid as number));
            assert.throws(() => acquireRadarLock(path), /already running/);
        } finally {
            child.kill();
        }
        rmSync(path, { force: true });
        assert.equal(existsSync(path), false);
    });

    test('stale lock of a dead pid is replaced', () => {
        const path = lockPath();
        writeFileSync(path, JSON.stringify({ pid: 2147483647, startedAt: 1 }));
        assert.equal(isPidAlive(2147483647), false);
        const lock = acquireRadarLock(path);
        assert.equal(lock.pid, process.pid);
        const saved = JSON.parse(readFileSync(path, 'utf8')) as { pid: number };
        assert.equal(saved.pid, process.pid);
        releaseRadarLock(lock);
    });

    test('release keeps a foreign lock file', () => {
        const path = lockPath();
        const mine = acquireRadarLock(path);
        writeFileSync(path, JSON.stringify({ pid: mine.pid + 1, startedAt: 1 }));
        releaseRadarLock(mine);
        assert.equal(existsSync(path), true);
    });

    test('shared chat lock blocks a second radar on one chat', () => {
        const dir = `/tmp/opencode/radar-chat-lock-${process.pid}`;
        mkdirSync(dir, { recursive: true });
        const same = sharedChatLockPath(777, dir);
        const other = sharedChatLockPath(778, dir);
        assert.ok(same.endsWith('radar-chat-777.lock'));
        const child = spawn('sleep', ['30']);
        writeFileSync(same, JSON.stringify({ pid: child.pid, startedAt: 1 }));
        try {
            assert.ok(isPidAlive(child.pid as number));
            assert.throws(() => acquireRadarLock(same), /already running/);
            const free = acquireRadarLock(other);
            releaseRadarLock(free);
            rmSync(other, { force: true });
        } finally {
            child.kill();
        }
        rmSync(same, { force: true });
    });
});
