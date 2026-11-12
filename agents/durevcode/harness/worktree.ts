import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copyHarness } from './harness';
import { applyEdits, CandidateEdit, pathAllowed } from './apply';

export function validateCandidateEdits(repoDir: string, candidate: { edits: CandidateEdit[] }): { ok: boolean; error?: string } {
    const tmpRoot = `/tmp/opencode/harness-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        mkdirSync(tmpRoot, { recursive: true });
        copyHarness(repoDir, tmpRoot);
        applyProbeEdits(tmpRoot, candidate.edits);
        patchProbeConfig(tmpRoot);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
        try {
            rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
        }
    }
}

export interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    code: number | null;
}

export function git(repoDir: string, args: string[]): GitResult {
    const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
    return {
        ok: result.status === 0,
        code: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

export function createProbeWorktree(repoDir: string, worktreeDir: string, edits: CandidateEdit[], baseRef = 'HEAD'): void {
    const verified = git(repoDir, ['rev-parse', '--verify', baseRef.startsWith('HEAD') ? baseRef : `${baseRef}^{commit}`]);
    const ref = verified.ok ? baseRef : 'HEAD';
    if (!verified.ok) throw new Error(`base ref not found: ${baseRef}`);
    const target = resolve(worktreeDir);
    const added = git(repoDir, ['worktree', 'add', '--detach', target, ref]);
    if (!added.ok) throw new Error(`worktree add failed: ${added.stderr.trim().slice(0, 200)}`);
    try {
        copyHarness(repoDir, worktreeDir);
        linkModules(repoDir, worktreeDir);
        if (edits.length > 0) applyProbeEdits(worktreeDir, edits);
        patchProbeConfig(worktreeDir);
    } catch (error) {
        removeProbeWorktree(repoDir, worktreeDir);
        throw error;
    }
}

export function applyProbeEdits(worktreeDir: string, edits: CandidateEdit[]): string[] {
    for (const edit of edits) {
        if (!pathAllowed(edit.path)) throw new Error(`edit path not allowed: ${edit.path}`);
    }
    return applyEdits(worktreeDir, edits);
}

function linkModules(repoDir: string, worktreeDir: string): void {
    for (const name of ['node_modules', '.opencode/node_modules']) {
        const source = resolve(repoDir, name);
        const target = resolve(worktreeDir, name);
        if (!existsSync(source)) continue;
        if (existsSync(target)) continue;
        symlinkSync(source, target);
    }
}

function patchProbeConfig(worktreeDir: string): void {
    const path = resolve(worktreeDir, '.opencode/opencode.json');
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
        mcp?: Record<string, { command?: unknown; environment?: Record<string, string> }>;
    };
    const server = config.mcp?.['rag-memory'];
    if (server && Array.isArray(server.command) && typeof server.command[1] === 'string') {
        server.command = [...server.command.slice(0, 1), resolve(worktreeDir, '.opencode/mcp/rag-memory/server.mjs'), ...server.command.slice(2)];
        server.environment = { ...(server.environment ?? {}), RAG_MEMORY_FILE: resolve(worktreeDir, '.opencode/rag-memory-probe.md') };
        writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    }
}

export function removeProbeWorktree(repoDir: string, worktreeDir: string): void {
    spawnSync('git', ['worktree', 'remove', '--force', resolve(worktreeDir)], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('rm', ['-rf', resolve(worktreeDir)], { encoding: 'utf8' });
}

export function changedFiles(worktreeDir: string): string[] {
    const result = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: worktreeDir, encoding: 'utf8' });
    return (result.stdout ?? '')
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .filter((line) => line.trim().length > 0)
        .map((line) => {
            const entry = line.slice(3).trim();
            const arrow = entry.indexOf(' -> ');
            return arrow === -1 ? entry : entry.slice(arrow + 4).trim();
        })
        .filter((entry) => entry.length > 0 && entry !== 'node_modules' && entry !== '.opencode/node_modules');
}

export function worktreeDiffStat(worktreeDir: string): string {
    const result = spawnSync('git', ['diff', '--stat'], { cwd: worktreeDir, encoding: 'utf8' });
    return (result.stdout ?? '').trim().split('\n').pop() ?? '';
}
