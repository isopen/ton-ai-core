import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'assert';
import { CandidateEdit, pathAllowed, validateCandidate, applyEdits } from '../harness/apply';
import { formAnswerPayload, pickFormAnswer, pickFormLabel } from '../harness/client';
import { parseCandidates, parseComposeReply } from '../harness/prompts';
import { runChecker } from '../harness/probe';
import { EXAMPLE_TASKS_PATH, loadTasks, selectTasks, validateTasks } from '../harness/tasks';
import { applyProbeEdits, changedFiles } from '../harness/worktree';

describe('durevcode harness loop', () => {
    const tasksFixture = validateTasks(JSON.parse(readFileSync(EXAMPLE_TASKS_PATH, 'utf8')), EXAMPLE_TASKS_PATH);

    test('path whitelist allows only the harness surface', () => {
        assert.equal(pathAllowed('.opencode/opencode.json'), true);
        assert.equal(pathAllowed('.opencode/opencode.json'.replace('opencode.json', 'skills/x/SKILL.md')), true);
        assert.equal(pathAllowed('.opencode/scripts/helper.py'), true);
        assert.equal(pathAllowed('agents/durevcode/agent.ts'), false);
        assert.equal(pathAllowed('../escape.txt'), false);
        assert.equal(pathAllowed('/etc/passwd'), false);
        assert.equal(pathAllowed('.opencode/../opencode.json'), false);
    });

    test('candidate validation enforces whitelist and edit shape', () => {
        const good: CandidateEdit[] = [{ path: '.opencode/skills/demo/SKILL.md', content: '---\nname: demo\ndescription: d\n---\n' }];
        const spec = validateCandidate({ name: 'demo', edits: good });
        assert.equal(spec.name, 'demo');
        assert.throws(() => validateCandidate({ name: 'bad', edits: [{ path: 'agents/durevcode/agent.ts', content: 'x' }] }));
        assert.throws(() => validateCandidate({ name: 'bad', edits: [{ path: '.opencode/skills/demo/SKILL.md' }] }));
        assert.throws(() => validateCandidate({ name: '', edits: good }));
    });

    test('applyEdits writes full contents and single-hit replacements', () => {
        const dir = mkdtempSync(join(tmpdir(), 'harness-apply-'));
        mkdirSync(join(dir, '.opencode/skills/demo'), { recursive: true });
        writeFileSync(join(dir, '.opencode/skills/demo/SKILL.md'), 'name: demo\ndescription: d\nold line\n');
        const written = applyEdits(dir, [
            { path: '.opencode/skills/demo/SKILL.md', search: 'old line', replacement: 'new line' },
            { path: '.opencode/skills/demo/EXTRA.md', content: 'added' },
        ]);
        assert.deepEqual(written, ['.opencode/skills/demo/SKILL.md', '.opencode/skills/demo/EXTRA.md']);
        const text = require('node:fs').readFileSync(join(dir, '.opencode/skills/demo/SKILL.md'), 'utf8');
        assert.ok(text.includes('new line') && text.includes('name: demo'));
        assert.equal(require('node:fs').readFileSync(join(dir, '.opencode/skills/demo/EXTRA.md'), 'utf8'), 'added');
        assert.throws(() => applyEdits(dir, [{ path: '.opencode/skills/demo/SKILL.md', search: 'missing', replacement: 'x' }]));
    });

    test('proposal parsing takes the fenced candidates json', () => {
        const parsed = parseCandidates('prefix text\n```json\n{"candidates":[{"name":"a","edits":[{"path":".opencode/opencode.json","search":"x","replacement":"y"}]}]}\n```');
        assert.equal(parsed.candidates.length, 1);
        assert.equal(parseCandidates('no json here').candidates.length, 0);
        assert.equal(parseCandidates('```json\nnot json\n```').candidates.length, 0);
    });

    test('proposal parsing accepts raw and embedded json', () => {
        const raw = parseCandidates('{"candidates":[{"name":"a","edits":[{"path":".opencode/opencode.json","content":"{}"}]}]}');
        assert.equal(raw.candidates.length, 1);
        const embedded = parseCandidates('here you go: {"candidates":[{"name":"b","edits":[]}]} thanks');
        assert.equal(embedded.candidates.length, 1);
        assert.equal(parseCandidates('```JSON\n{"candidates":[{"name":"c","edits":[]}]}\n```').candidates.length, 1);
    });

    test('compose parsing keeps candidates and lessons', () => {
        const parsed = parseComposeReply('```json\n{"candidates":[{"name":"a","edits":[]}],"lessons":["keep diffs small",""]}\n```');
        assert.equal(parsed.candidates.length, 1);
        assert.deepEqual(parsed.lessons, ['keep diffs small']);
        const empty = parseComposeReply('no structured reply');
        assert.equal(empty.candidates.length, 0);
        assert.deepEqual(empty.lessons, []);
        assert.ok(empty.parseError);
    });

    test('form answers prefer the recommended option and honor field types', () => {
        const entry = {
            id: 'frm',
            fields: [
                { key: 'q0', type: 'string', options: [{ label: 'Other', value: 'o' }, { label: 'Recommended', value: 'r' }] },
                { key: 'q1', type: 'multiselect', options: ['a', 'b'] },
                { key: 'q2', type: 'boolean', options: [{ label: 'Yes', value: true }] },
                { key: 'q3', type: 'number', options: [{ label: '7', value: 7 }] },
            ],
        };
        const payload = formAnswerPayload(entry);
        assert.deepEqual(payload.answer, { q0: 'r', q1: ['a'], q2: true, q3: 7 });
        assert.deepEqual(payload.pickedLabels, ['Recommended', 'a', 'Yes', '7']);
        assert.equal(pickFormAnswer({ type: 'string' }), '');
        assert.equal(pickFormLabel({ type: 'string' }), '');
    });

    test('form answers accept a keyed field map', () => {
        const payload = formAnswerPayload({
            id: 'frm',
            fields: { q0: { key: 'q0', type: 'string', options: ['only'] } },
        });
        assert.deepEqual(payload.answer, { q0: 'only' });
    });

    test('probe edits reject paths outside the harness surface', () => {
        const dir = mkdtempSync(join(tmpdir(), 'harness-edits-'));
        assert.throws(() => applyProbeEdits(dir, [{ path: 'agents/durevcode/agent.ts', content: 'x' }]));
        assert.throws(() => applyProbeEdits(dir, [{ path: '../escape.txt', content: 'x' }]));
    });

    test('changedFiles expands untracked directories to file paths', () => {
        const dir = mkdtempSync(join(tmpdir(), 'harness-git-'));
        execFileSync('git', ['init', '-q'], { cwd: dir });
        writeFileSync(join(dir, 'base.txt'), 'base');
        execFileSync('git', ['add', '.'], { cwd: dir });
        execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'base'], { cwd: dir });
        mkdirSync(join(dir, 'docs/plans'), { recursive: true });
        writeFileSync(join(dir, 'docs/plans/crypton.md'), 'plan');
        assert.deepEqual(changedFiles(dir), ['docs/plans/crypton.md']);
    });

    test('jest checker fails before running when required changes are absent', () => {
        const task = tasksFixture.find((entry) => entry.id === 'question-radio');
        assert.ok(task);
        const outcome = runChecker(
            { task, candidate: 'c', worktreeDir: '/tmp', client: {} as never, port: 1, timeoutMs: 1, dbPath: '', log: () => undefined },
            ['agents/durevcode/tests/agent.test.ts'],
            '',
        );
        assert.equal(outcome.ok, false);
        assert.match(outcome.detail, /required changes missing: agents\/durevcode\/agent\.ts/);
    });

    test('hidden regression tasks pin fix commits and test patterns', () => {
        const expected: Record<string, { base: string; from: string; pattern: RegExp }> = {
            'question-radio': { base: '55a2170^', from: '55a2170', pattern: /first tap selects a radio answer/ },
            'topic-name-pin': { base: 'fb24f61^', from: 'fb24f61', pattern: /manual topic rename pins the name/ },
            'watch-slot-user': { base: 'b398363^', from: 'b398363', pattern: /user-activity windows/ },
            'bound-window': { base: 'd4c0442^', from: 'd4c0442', pattern: /outside the fresh window keeps its watch/ },
            'cmd-bubble': { base: '617b3da^', from: '617b3da', pattern: /handled typed command keeps its bubble/ },
            'thought-doc-fallback': { base: '9237009^', from: '9237009', pattern: /thought doc upload failure falls back/ },
        };
        for (const [id, spec] of Object.entries(expected)) {
            const task = tasksFixture.find((entry) => entry.id === id);
            assert.ok(task, id);
            assert.equal(task.base, spec.base, id);
            assert.equal(task.checker.kind, 'jest', id);
            if (task.checker.kind !== 'jest') continue;
            assert.equal(task.checker.testFilesFrom, spec.from, id);
            assert.match(task.checker.testNamePattern ?? '', spec.pattern, id);
            assert.deepEqual(task.checker.requireChangesIn, ['agents/durevcode/agent.ts'], id);
        }
    });

    test('every hidden regression task has a base commit and pattern', () => {
        const hidden = tasksFixture.filter((task) => task.checker.kind === 'jest' && task.checker.testFilesFrom);
        assert.ok(hidden.length >= 6);
        for (const task of hidden) {
            assert.ok(task.base, `${task.id} needs a base`);
            if (task.checker.kind !== 'jest') continue;
            assert.ok(task.checker.testNamePattern, `${task.id} needs a test pattern`);
        }
    });

    test('task files load from an explicit json and reject invalid shapes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'harness-tasks-'));
        const file = join(dir, '.tasks.json');
        const sample = tasksFixture[0];

        writeFileSync(file, JSON.stringify([sample]));
        assert.deepEqual(loadTasks({ file }).map((task) => task.id), [sample.id]);

        assert.throws(() => loadTasks({ file: join(dir, 'missing.json') }), /tasks file not found/);
        assert.deepEqual(loadTasks({ localFile: join(dir, 'missing.json') }), []);

        writeFileSync(file, JSON.stringify([{ ...sample, id: 'dup' }, { ...sample, id: 'dup' }]));
        assert.throws(() => loadTasks({ file }), /duplicate task id/);

        writeFileSync(file, JSON.stringify([{ ...sample, checker: { kind: 'jest', spec: 'x' } }]));
        assert.throws(() => loadTasks({ file }), /timeoutSec/);

        writeFileSync(file, '{not json');
        assert.throws(() => loadTasks({ file }), /not valid JSON/);

        assert.throws(() => validateTasks([{ ...sample, surprise: true }]), /unknown keys: surprise/);
        assert.throws(() => validateTasks([]), /at least one task/);
    });

    test('task selection validates ids', () => {
        assert.deepEqual(selectTasks(tasksFixture, 'question-radio').map((task) => task.id), ['question-radio']);
        assert.deepEqual(selectTasks(tasksFixture, 'question-radio,cmd-bubble').map((task) => task.id), ['question-radio', 'cmd-bubble']);
        assert.equal(selectTasks(tasksFixture).length, tasksFixture.length);
        assert.equal(new Set(tasksFixture.map((task) => task.id)).size, tasksFixture.length);
        assert.throws(() => selectTasks(tasksFixture, 'missing-id'));
    });
});
