import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TuneTask } from './tasks';
import { changedFiles } from './worktree';
import { OpencodeProbeClient, AnsweredQuestion, SessionApiRow, runCommand, superviseSession, lastAssistantText } from './client';

export interface ProbeResult {
    taskId: string;
    candidate: string;
    sessionId: string;
    port: number;
    timedOut: boolean;
    durationMs: number;
    outcome: string;
    tokens: { input: number; output: number; cost: number };
    finalText: string;
    filesChanged: string[];
    questions: AnsweredQuestion[];
    checker: { kind: string; ok: boolean; detail: string };
    error?: string;
}

export interface ProbeSpec {
    task: TuneTask;
    candidate: string;
    worktreeDir: string;
    client: OpencodeProbeClient;
    port: number;
    timeoutMs: number;
    dbPath: string;
    log: (line: string) => void;
    model?: { providerID: string; id: string; variant?: string };
}

export async function runProbe(spec: ProbeSpec): Promise<ProbeResult> {
    const startedAt = Date.now();
    const log = (line: string): void => spec.log(`[${spec.candidate}/${spec.task.id}] ${line}`);
    try {
        await spec.client.waitForReady(20000);
        const session = await spec.client.createSession(spec.worktreeDir);
        log(`session ${session.id}`);
        await spec.client.patchPermissions(session.id);
        if (spec.model) await spec.client.setModel(session.id, spec.model);
        await spec.client.sendPrompt(session.id, spec.task.prompt);
        const supervised = await superviseSession(spec.client, session.id, {
            timeoutMs: spec.timeoutMs,
            onNote: log,
        });
        if (supervised.timedOut) log('timed out, interrupted');
        const filesChanged = changedFiles(spec.worktreeDir);
        let finalText = lastAssistantText(spec.dbPath, session.id);
        if (finalText.trim().length === 0) {
            try {
                finalText = await spec.client.readFinalText(session.id);
            } catch (error) {
                log(`api read failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const checker = runChecker(spec, filesChanged, finalText);
        const failure = sessionError(supervised.row);
        log(`done outcome=${supervised.row?.outcome ?? ''} checker=${checker.kind}:${checker.ok ? 'pass' : 'fail'}${failure ? ` error=${failure}` : ''}`);
        return {
            taskId: spec.task.id,
            candidate: spec.candidate,
            sessionId: session.id,
            port: spec.port,
            timedOut: supervised.timedOut,
            durationMs: Date.now() - startedAt,
            outcome: String(supervised.row?.outcome ?? ''),
            tokens: readTokens(supervised.row),
            finalText: finalText.slice(0, 8000),
            filesChanged,
            questions: supervised.answered,
            checker,
            error: failure || undefined,
        };
    } catch (error) {
        return {
            taskId: spec.task.id,
            candidate: spec.candidate,
            sessionId: '',
            port: spec.port,
            timedOut: false,
            durationMs: Date.now() - startedAt,
            outcome: 'error',
            tokens: { input: 0, output: 0, cost: 0 },
            finalText: '',
            filesChanged: [],
            questions: [],
            checker: { kind: 'none', ok: false, detail: '' },
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function readTokens(row: SessionApiRow | null): { input: number; output: number; cost: number } {
    const tokens = (row?.tokens ?? {}) as Record<string, number>;
    return { input: tokens.input ?? 0, output: tokens.output ?? 0, cost: tokens.cost ?? 0 };
}

function sessionError(row: SessionApiRow | null): string {
    const raw = row?.error;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const entry = raw as { type?: unknown; message?: unknown };
        if (typeof entry.message === 'string') {
            return typeof entry.type === 'string' ? `${entry.type}: ${entry.message}` : entry.message;
        }
    }
    return '';
}

export interface CheckerOutcome {
    kind: string;
    ok: boolean;
    detail: string;
}

export function runChecker(spec: ProbeSpec, filesChanged: string[], finalText: string): CheckerOutcome {
    const checker = spec.task.checker;
    try {
        if (checker.kind === 'jest') {
            const missingChanges = (checker.requireChangesIn ?? []).filter((path) => !filesChanged.includes(path));
            if (missingChanges.length > 0) {
                return { kind: 'jest', ok: false, detail: `required changes missing: ${missingChanges.join(', ')}` };
            }
            let hiddenNote = '';
            if (checker.testFilesFrom) {
                const source = runCommand(spec.worktreeDir, 'git', ['show', `${checker.testFilesFrom}:${checker.spec}`], 30000);
                if (source.code !== 0) {
                    return { kind: 'jest', ok: false, detail: `hidden test fetch failed: ${source.stderr.trim().slice(0, 300)}` };
                }
                const target = resolve(spec.worktreeDir, checker.spec);
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, source.stdout);
                hiddenNote = ` hidden=${checker.testFilesFrom}:${checker.spec}`;
            }
            const args = ['jest', checker.spec, '--runInBand'];
            if (checker.testNamePattern) args.push('--testNamePattern', checker.testNamePattern);
            const result = runCommand(spec.worktreeDir, 'npx', args, checker.timeoutSec * 1000);
            const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-12).join('\n').slice(0, 2000);
            return { kind: 'jest', ok: result.code === 0, detail: `${hiddenNote}${tail}` };
        }
        const hits = filesChanged.filter(
            (file) => checker.extensions.some((ext) => file.endsWith(`.${ext}`)) && file.startsWith(`${checker.baseDir}/`),
        );
        let body = finalText;
        for (const file of hits) body += `\n${readFileSync(resolve(spec.worktreeDir, file), 'utf8')}`;
        const missing = checker.keywords.filter((keyword) => !body.includes(keyword));
        const ok = hits.length > 0 && missing.length === 0;
        return {
            kind: 'file-contains',
            ok,
            detail: `files=${hits.join(', ') || 'none'}${missing.length > 0 ? ` missing=${missing.join(',')}` : ''}`,
        };
    } catch (error) {
        return { kind: String(checker.kind), ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}
