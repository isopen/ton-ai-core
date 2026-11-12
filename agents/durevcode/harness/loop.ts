import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CandidateSpec, CandidateEdit, editsToDiffText, validateCandidate } from './apply';
import { OpencodeProbeClient, SpawnedServer, spawnServer, lastAssistantText, superviseSession } from './client';
import { readHarnessSnapshot, snapshotMarkdown } from './harness';
import { runProbe, ProbeResult } from './probe';
import { composePrompt, declareProposePrompt, parseCandidates, parseComposeReply } from './prompts';
import { TuneTask } from './tasks';
import { createProbeWorktree, removeProbeWorktree, validateCandidateEdits } from './worktree';

export interface TuneOptions {
    repoDir: string;
    binPath: string;
    tasks: TuneTask[];
    k: number;
    includeBaseline: boolean;
    probeTimeoutSec: number;
    outRoot: string;
    metaPort: number;
    probePortBase: number;
    keepWorktrees: boolean;
    probeCompose: boolean;
    lessonsPath?: string;
    modelProvider?: string;
    modelId?: string;
    modelVariant?: string;
    log?: (line: string) => void;
}

export interface TuneOutcome {
    outDir: string;
    baseline: ProbeResult[];
    candidates: Array<{ spec: CandidateSpec; results: ProbeResult[] }>;
    composed: { spec: CandidateSpec | null; results: ProbeResult[]; lessons: string[] };
    notes: string[];
}

const DEFAULT_DB_PATH = join(homedir(), '.local/share/opencode/opencode.db');

export function planText(options: TuneOptions): string {
    return [
        `drive: ${options.repoDir}`,
        `bin: ${options.binPath}`,
        `meta server port: ${options.metaPort}`,
        `probe ports: ${options.probePortBase}+`,
        `tasks: ${options.tasks.map((task) => task.id).join(', ')}`,
        `k candidates: ${options.k}`,
        `baseline: ${options.includeBaseline ? 'run' : 'skip'}`,
        `probe compose: ${options.probeCompose ? 'run' : 'skip'}`,
        `probe timeout: ${options.probeTimeoutSec}s per task`,
        `model: ${options.modelProvider ?? 'opencode'}/${options.modelId ?? 'default'}${options.modelVariant ? `#${options.modelVariant}` : ''}`,
    ].join('\n');
}

export async function runTuneLoop(options: TuneOptions): Promise<TuneOutcome> {
    const log = options.log ?? ((line: string): void => console.log(line));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = join(options.outRoot, `harness-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
    const wtDir = join(outDir, 'wt');
    mkdirSync(outDir, { recursive: true });
    const notes: string[] = [];
    mkdirSync(wtDir, { recursive: true });
    const dbPath = resolveDbPath(options.repoDir, notes);
    const snapshot = readHarnessSnapshot(options.repoDir);
    writeFileSync(join(outDir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    writeFileSync(join(outDir, 'snapshot.md'), `${snapshotMarkdown(snapshot)}\n`);
    log(`out dir: ${outDir}`);

    const startedServers: SpawnedServer[] = [];
    const createdWorktrees: string[] = [];
    try {
        const baseline: ProbeResult[] = [];
        if (options.includeBaseline) {
            try {
                const run = await probeStaged(options, outDir, wtDir, 'baseline', [], log, startedServers, createdWorktrees, dbPath);
                baseline.push(...run);
                writeResults(join(outDir, 'baseline.json'), run);
            } catch (error) {
                notes.push(`baseline probe failed: ${error instanceof Error ? error.message : String(error)}`);
                log('baseline failed, continuing without it');
            }
        }

        const lessons = readLessons(options);
        const metaDir = join(wtDir, 'meta');
        createProbeWorktree(options.repoDir, metaDir, []);
        createdWorktrees.push(metaDir);
        const metaPort = options.metaPort;
        const metaServer = spawnServer(options.binPath, metaPort, metaDir, outDir);
        startedServers.push(metaServer);
        const metaClient = new OpencodeProbeClient(`http://127.0.0.1:${metaPort}`, metaServer.password);
        log(`meta server: http://127.0.0.1:${metaPort} (worktree ${metaDir})`);

        const baselineEvidence = evidenceText(baseline, 'baseline');
        const collectCandidates = async (prompt: string): Promise<CandidateSpec[]> => {
            let raw = '';
            try {
                raw = await askMeta(metaClient, metaDir, prompt, options, log, outDir, dbPath, 'propose');
            } catch (error) {
                notes.push(`propose failed: ${error instanceof Error ? error.message : String(error)}`);
                return [];
            }
            const parsed = parseCandidates(raw);
            if (parsed.candidates.length === 0) {
                notes.push(parsed.parseError ?? 'no parseable candidates json in reply');
                return [];
            }
            const accepted: CandidateSpec[] = [];
            const rejectionNotes: string[] = [];
            for (const entry of parsed.candidates) {
                try {
                    const spec = validateCandidate(entry);
                    const dry = validateCandidateEdits(options.repoDir, spec);
                    if (!dry.ok) throw new Error(`dry-apply failed: ${dry.error}`);
                    accepted.push(spec);
                } catch (error) {
                    rejectionNotes.push(error instanceof Error ? error.message : String(error));
                }
                if (accepted.length >= options.k) break;
            }
            if (rejectionNotes.length > 0) notes.push(...rejectionNotes);
            return accepted;
        };

        let proposePrompt = declareProposePrompt(options.tasks, baselineEvidence, options.k, lessons);
        let candidates = await collectCandidates(proposePrompt);
        if (candidates.length === 0) {
            log('all proposed candidates failed validation; retrying propose once with feedback');
            const retryPrompt = `${proposePrompt}\n\nPREVIOUS REPLY FAILED VALIDATION. Re-send corrected JSON only. Common failure: edits to .opencode/opencode.json must leave it parseable as JSON; escape newlines as \\n inside string values, and never put a literal line break inside a JSON string.`;
            candidates = await collectCandidates(retryPrompt);
        }
        if (candidates.length === 0) throw new Error('all proposed candidates failed validation');
        log(`proposing done: ${candidates.length} candidate(s)`);
        candidates.forEach((spec, index) => {
            const slug = fileSlug(spec.name);
            writeFileSync(join(outDir, `candidate-${index}-${slug}.json`), `${JSON.stringify(spec, null, 2)}\n`);
            writeFileSync(join(outDir, `candidate-${index}-${slug}.md`), `${editsToDiffText(spec)}\n`);
        });

        const candidateResults: Array<{ spec: CandidateSpec; results: ProbeResult[] }> = [];
        for (const [index, spec] of candidates.entries()) {
            try {
                const results = await probeStaged(
                    options,
                    outDir,
                    wtDir,
                    spec.name,
                    spec.edits,
                    log,
                    startedServers,
                    createdWorktrees,
                    dbPath,
                    options.probePortBase + (index + 1) * (options.tasks.length + 1),
                );
                candidateResults.push({ spec, results });
                writeResults(join(outDir, `results-${fileSlug(spec.name)}.json`), results);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                notes.push(`candidate ${spec.name} probe failed: ${message}`);
                log(`candidate ${spec.name} skipped: ${message}`);
            }
        }
        if (candidateResults.length === 0 && options.includeBaseline === false) {
            throw new Error('no candidate could be probed');
        }

        const candidateEvidence = candidateResults
            .map((entry) => evidenceText(entry.results, entry.spec.name, entry.spec.rationale ?? ''))
            .join('\n\n');
        const composed: { spec: CandidateSpec | null; results: ProbeResult[]; lessons: string[] } = {
            spec: null,
            results: [],
            lessons: [],
        };
        try {
            const composedRaw = await askMeta(
                metaClient,
                metaDir,
                composePrompt(options.tasks, candidateEvidence, lessons),
                options,
                log,
                outDir,
                dbPath,
                'compose',
            );
            const composedParsed = parseComposeReply(composedRaw);
            const composedList = composedParsed.candidates.map((raw) => {
                try {
                    return validateCandidate(raw);
                } catch (error) {
                    notes.push(`composed rejected: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                }
            }).filter((value): value is CandidateSpec => value !== null);
            composed.spec = composedList[0] ?? null;
            composed.lessons = composedParsed.lessons;
            if (composedParsed.parseError) notes.push(composedParsed.parseError);
        } catch (error) {
            notes.push(`compose failed: ${error instanceof Error ? error.message : String(error)}`);
            log('compose failed, writing the report without a composed candidate');
        }
        if (composed.spec) {
            writeFileSync(join(outDir, 'composed.json'), `${JSON.stringify(composed.spec, null, 2)}\n`);
            writeFileSync(join(outDir, 'composed.md'), `${editsToDiffText(composed.spec)}\n`);
            if (options.probeCompose) {
                try {
                    composed.results = await probeStaged(
                        options,
                        outDir,
                        wtDir,
                        composed.spec.name,
                        composed.spec.edits,
                        log,
                        startedServers,
                        createdWorktrees,
                        dbPath,
                        options.probePortBase + (candidates.length + 1) * (options.tasks.length + 1),
                    );
                    writeResults(join(outDir, 'results-composed.json'), composed.results);
                } catch (error) {
                    notes.push(`composed probe failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        writeFileSync(join(outDir, 'lessons.md'), lessonsMarkdown(lessons, composed.lessons));
        writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ baseline, candidates: candidateResults, composed, notes }, null, 2)}\n`);
        writeFileSync(join(outDir, 'report.md'), reportMarkdown(baseline, candidateResults, composed, notes));
        log('tune loop finished');

        return { outDir, baseline, candidates: candidateResults, composed, notes };
    } finally {
        for (const server of startedServers) {
            server.kill();
            await server.waitForExit(5000);
        }
        if (!options.keepWorktrees) {
            for (const dir of createdWorktrees) {
                try {
                    removeProbeWorktree(options.repoDir, dir);
                } catch {
                    continue;
                }
            }
        } else {
            for (const dir of createdWorktrees) log(`worktree kept: ${dir}`);
        }
    }
}

async function probeStaged(
    options: TuneOptions,
    outDir: string,
    wtDir: string,
    candidate: string,
    edits: CandidateEdit[],
    log: (line: string) => void,
    servers: SpawnedServer[],
    worktrees: string[],
    dbPath: string,
    port = options.probePortBase,
): Promise<ProbeResult[]> {
    log(`=== stage ${candidate}: probing ${options.tasks.length} task(s) ===`);
    const results: ProbeResult[] = [];
    for (const [taskIndex, task] of options.tasks.entries()) {
        const slug = fileSlug(candidate);
        const worktreeDir = join(wtDir, 'c', `${slug}-${task.id}`);
        const taskPort = port + taskIndex;
        const baseRef = task.base ?? 'HEAD';
        log(`task ${task.id}: worktree ${worktreeDir} (base ${baseRef}, port ${taskPort})`);
        createProbeWorktree(options.repoDir, worktreeDir, edits, baseRef);
        worktrees.push(worktreeDir);
        const server = spawnServer(options.binPath, taskPort, worktreeDir, outDir);
        servers.push(server);
        const client = new OpencodeProbeClient(`http://127.0.0.1:${taskPort}`, server.password);
        const result = await runProbe({
            task,
            candidate,
            worktreeDir,
            client,
            port: taskPort,
            timeoutMs: options.probeTimeoutSec * 1000,
            dbPath,
            log,
            model: options.modelId
                ? { providerID: options.modelProvider ?? 'opencode', id: options.modelId, variant: options.modelVariant || undefined }
                : undefined,
        });
        results.push(result);
        writeResults(join(outDir, `run-${fileSlug(candidate)}-${task.id}.json`), [result]);
        server.kill();
        await server.waitForExit(5000);
        removeProbeWorktree(options.repoDir, worktreeDir);
    }
    return results;
}

async function askMeta(
    client: OpencodeProbeClient,
    metaDir: string,
    promptUser: string,
    options: TuneOptions,
    log: (line: string) => void,
    outDir: string,
    dbPath: string,
    step: string,
): Promise<string> {
    await client.waitForReady(20000);
    const session = await client.createSession(metaDir);
    await client.patchPermissions(session.id);
    if (options.modelId) {
        await client.setModel(session.id, {
            providerID: options.modelProvider ?? 'opencode',
            id: options.modelId,
            variant: options.modelVariant || undefined,
        });
    }
    await client.sendPrompt(session.id, promptUser);
    log(`meta ${step}: session ${session.id}`);
    const supervised = await superviseSession(client, session.id, {
        timeoutMs: options.probeTimeoutSec * 1000,
        onNote: (line) => log(`meta ${step}: ${line}`),
    });
    if (supervised.timedOut) log(`meta ${step}: timeout, interrupted`);
    let finalText = '';
    for (let attempt = 0; attempt < 6 && finalText.trim().length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        finalText = dbPath.length > 0 ? lastAssistantText(dbPath, session.id) : '';
    }
    if (finalText.trim().length === 0) {
        try {
            finalText = await client.readFinalText(session.id);
        } catch (error) {
            log(`meta ${step}: api read failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    writeFileSync(join(outDir, `${step}-reply.txt`), `${finalText}\n`);
    if (finalText.trim().length === 0) {
        throw new Error(`meta ${step} produced empty reply (timedOut=${supervised.timedOut})`);
    }
    return finalText;
}

export function evidenceText(results: ProbeResult[], candidate: string, rationale = ''): string {
    const lines = [`## candidate ${candidate}`, rationale, ...results.map((result) => {
        return [
            `task=${result.taskId} outcome=${result.outcome} checker=${result.checker.kind}:${result.checker.ok ? 'PASS' : 'FAIL'} ${Math.round(result.durationMs / 1000)}s tokens=${result.tokens.input}/${result.tokens.output} timed_out=${result.timedOut}`,
            `files: ${result.filesChanged.join(', ') || 'none'}`,
            `questions auto-answered: ${result.questions.length > 0 ? result.questions.map((question) => question.picked).join(' | ') : 'none'}`,
            `checker detail: ${result.checker.detail.replace(/\s+/g, ' ').slice(0, 600)}`,
            `error: ${result.error ?? 'none'}`,
            `final text: ${result.finalText.replace(/\s+/g, ' ').slice(0, 1500)}`,
        ].join('\n');
    })];
    return lines.join('\n');
}

function fileSlug(name: string): string {
    const slug = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return slug.length > 0 ? slug : 'candidate';
}

function readLessons(options: TuneOptions): string {
    const path = options.lessonsPath ?? join(options.repoDir, 'agents/durevcode/harness/lessons.md');
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8').slice(-8000);
}

function lessonsMarkdown(previous: string, lessons: string[]): string {
    if (lessons.length === 0) return previous;
    return `${previous}\n## ${new Date().toISOString()}\n${lessons.map((lesson) => `- ${lesson}`).join('\n')}\n`;
}

function reportMarkdown(
    baseline: ProbeResult[],
    candidates: Array<{ spec: CandidateSpec; results: ProbeResult[] }>,
    composed: { spec: CandidateSpec | null; results: ProbeResult[]; lessons: string[] },
    notes: string[],
): string {
    const rows: Array<string[]> = [['stage', 'task', 'checker', 'result', 'sec', 'tokens in/out', 'files', 'error']];
    if (baseline.length > 0) baseline.forEach((result) => rows.push(row('baseline', result)));
    candidates.forEach((entry) => entry.results.forEach((result) => rows.push(row(entry.spec.name, result))));
    composed.results.forEach((result) => rows.push(row('composed', result)));
    const table = rows.map((entry) => `| ${entry.join(' | ')} |`).join('\n');
    return [
        '# tune report',
        '',
        table,
        '',
        '## composed rationale',
        composed.spec?.rationale ?? '(none)',
        '',
        '## lessons',
        composed.lessons.map((lesson) => `- ${lesson}`).join('\n') || '(none)',
        '',
        '## notes',
        notes.map((note) => `- ${note}`).join('\n') || '(none)',
        '',
        'Apply manually: see composed.md / candidate-*.md. Nothing is auto-applied to the repo.',
    ].join('\n');
}

function row(stage: string, result: ProbeResult): string[] {
    return [
        stage,
        result.taskId,
        result.checker.kind,
        result.checker.ok ? 'PASS' : `FAIL${result.timedOut ? '(timeouts)' : ''}`,
        String(Math.round(result.durationMs / 1000)),
        `${result.tokens.input}/${result.tokens.output}`,
        result.filesChanged.join(', ').slice(0, 60) || 'none',
        (result.error ?? '').replace(/\|/g, '/').slice(0, 80) || 'none',
    ];
}

function writeResults(path: string, results: ProbeResult[]): void {
    writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`);
}

function resolveDbPath(repoDir: string, notes: string[]): string {
    const envPath = process.env.OPENCODE_DB_PATH ?? '';
    if (envPath.length > 0 && existsSync(envPath)) return envPath;
    if (existsSync(DEFAULT_DB_PATH)) return DEFAULT_DB_PATH;
    notes.push(`opencode sqlite DB not found at ${DEFAULT_DB_PATH}; final text capture disabled`);
    return '';
}
