import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface TuneTaskCheckerJest {
    kind: 'jest';
    spec: string;
    timeoutSec: number;
    testFilesFrom?: string;
    testNamePattern?: string;
    requireChangesIn?: string[];
}

export interface TuneTaskCheckerFiles {
    kind: 'file-contains';
    keywords: string[];
    extensions: string[];
    baseDir: string;
    expectChanged: boolean;
}

export type TuneTaskChecker = TuneTaskCheckerJest | TuneTaskCheckerFiles;

export interface TuneTask {
    id: string;
    title: string;
    prompt: string;
    checker: TuneTaskChecker;
    expectChangesIn: string[];
    lessonsHint?: string;
    base?: string;
}

export interface LoadTasksOptions {
    file?: string;
    localFile?: string;
}

const HARNESS_DIR = __dirname;
export const EXAMPLE_TASKS_PATH = join(HARNESS_DIR, '.tasks.example.json');
export const LOCAL_TASKS_PATH = join(HARNESS_DIR, '.tasks.json');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKeys(raw: Record<string, unknown>, allowed: string[], path: string): void {
    const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) throw new Error(`${path} has unknown keys: ${unknown.join(', ')}`);
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`);
    return value;
}

function optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    return expectString(value, path);
}

function stringArray(value: unknown, path: string): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new Error(`${path} must be an array of non-empty strings`);
    }
    return value as string[];
}

function validateChecker(raw: unknown, path: string): TuneTaskChecker {
    if (!isRecord(raw)) throw new Error(`${path} must be an object`);
    if (raw.kind === 'jest') {
        assertKeys(raw, ['kind', 'spec', 'timeoutSec', 'testFilesFrom', 'testNamePattern', 'requireChangesIn'], path);
        if (typeof raw.timeoutSec !== 'number' || !Number.isFinite(raw.timeoutSec) || raw.timeoutSec <= 0) {
            throw new Error(`${path}.timeoutSec must be a positive number`);
        }
        const testFilesFrom = optionalString(raw.testFilesFrom, `${path}.testFilesFrom`);
        const testNamePattern = optionalString(raw.testNamePattern, `${path}.testNamePattern`);
        const requireChangesIn = raw.requireChangesIn === undefined ? undefined : stringArray(raw.requireChangesIn, `${path}.requireChangesIn`);
        return {
            kind: 'jest',
            spec: expectString(raw.spec, `${path}.spec`),
            timeoutSec: raw.timeoutSec,
            ...(testFilesFrom !== undefined ? { testFilesFrom } : {}),
            ...(testNamePattern !== undefined ? { testNamePattern } : {}),
            ...(requireChangesIn !== undefined ? { requireChangesIn } : {}),
        };
    }
    if (raw.kind === 'file-contains') {
        assertKeys(raw, ['kind', 'keywords', 'extensions', 'baseDir', 'expectChanged'], path);
        if (typeof raw.expectChanged !== 'boolean') throw new Error(`${path}.expectChanged must be a boolean`);
        return {
            kind: 'file-contains',
            keywords: stringArray(raw.keywords, `${path}.keywords`),
            extensions: stringArray(raw.extensions, `${path}.extensions`),
            baseDir: expectString(raw.baseDir, `${path}.baseDir`),
            expectChanged: raw.expectChanged,
        };
    }
    throw new Error(`${path}.kind must be "jest" or "file-contains"`);
}

export function validateTask(raw: unknown, path = 'task'): TuneTask {
    if (!isRecord(raw)) throw new Error(`${path} must be an object`);
    assertKeys(raw, ['id', 'title', 'prompt', 'checker', 'expectChangesIn', 'lessonsHint', 'base'], path);
    const base = optionalString(raw.base, `${path}.base`);
    const lessonsHint = optionalString(raw.lessonsHint, `${path}.lessonsHint`);
    return {
        id: expectString(raw.id, `${path}.id`),
        title: expectString(raw.title, `${path}.title`),
        prompt: expectString(raw.prompt, `${path}.prompt`),
        checker: validateChecker(raw.checker, `${path}.checker`),
        expectChangesIn: stringArray(raw.expectChangesIn, `${path}.expectChangesIn`),
        ...(base !== undefined ? { base } : {}),
        ...(lessonsHint !== undefined ? { lessonsHint } : {}),
    };
}

export function validateTasks(raw: unknown, path = 'tasks'): TuneTask[] {
    if (!Array.isArray(raw)) throw new Error(`${path} must be a JSON array`);
    if (raw.length === 0) throw new Error(`${path} must contain at least one task`);
    const tasks = raw.map((entry, index) => validateTask(entry, `${path}[${index}]`));
    const seen = new Set<string>();
    for (const task of tasks) {
        if (seen.has(task.id)) throw new Error(`${path}: duplicate task id "${task.id}"`);
        seen.add(task.id);
    }
    return tasks;
}

function readTasksFile(path: string): TuneTask[] {
    let body: string;
    try {
        body = readFileSync(path, 'utf8');
    } catch (error) {
        throw new Error(`cannot read tasks file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (error) {
        throw new Error(`tasks file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validateTasks(parsed, path);
}

export function tasksSource(): string {
    return LOCAL_TASKS_PATH;
}

export function loadTasks(options: LoadTasksOptions = {}): TuneTask[] {
    const explicit = options.file && options.file.trim().length > 0 ? resolve(options.file) : '';
    const path = explicit || (options.localFile ? resolve(options.localFile) : LOCAL_TASKS_PATH);
    if (!existsSync(path)) {
        if (explicit) throw new Error(`tasks file not found: ${path}`);
        return [];
    }
    return readTasksFile(path);
}

export function selectTasks(tasks: TuneTask[], selection?: string): TuneTask[] {
    if (!selection || selection === 'all') return tasks;
    const ids = selection.split(',').map((entry) => entry.trim()).filter(Boolean);
    const unknown = ids.filter((id) => !tasks.some((task) => task.id === id));
    if (unknown.length > 0) throw new Error(`unknown task ids: ${unknown.join(', ')} (known: ${tasks.map((task) => task.id).join(', ')})`);
    return tasks.filter((task) => ids.includes(task.id));
}
