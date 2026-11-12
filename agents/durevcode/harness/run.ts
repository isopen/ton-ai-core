import { join } from 'node:path';
import { TuneOutcome, planText, runTuneLoop } from './loop';
import { loadTasks, selectTasks, tasksSource } from './tasks';

interface Args {
    k: number;
    tasks: string;
    includeBaseline: boolean;
    probeTimeoutSec: number;
    outRoot: string;
    metaPort: number;
    probePortBase: number;
    keepWorktrees: boolean;
    probeCompose: boolean;
    repoDir: string;
    binPath: string;
    dryRun: boolean;
    modelProvider: string;
    modelId: string;
    modelVariant: string;
}

function flag(argv: string[], name: string, fallback: string): string {
    const index = argv.indexOf(`--${name}`);
    if (index !== -1) return argv[index + 1] ?? fallback;
    const pair = argv.find((entry) => entry.startsWith(`--${name}=`));
    return pair ? pair.slice(`--${name}=`.length) : fallback;
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(`--${name}`);
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const repoDir = process.env.TUNE_REPO ?? process.cwd();
    const modelSpec = process.env.TUNE_MODEL ?? 'opencode/big-pickle';
    const slash = modelSpec.indexOf('/');
    const modelProvider = slash > 0 ? modelSpec.slice(0, slash) : 'opencode';
    const modelId = slash > 0 ? modelSpec.slice(slash + 1) : modelSpec;
    const modelVariant = process.env.TUNE_MODEL_VARIANT ?? '';
    return {
        k: Number(flag(argv, 'k', '2')),
        tasks: flag(argv, 'tasks', 'all'),
        includeBaseline: !hasFlag(argv, 'no-baseline'),
        probeTimeoutSec: Number(flag(argv, 'timeout', '1200')),
        outRoot: flag(argv, 'out-root', join(repoDir, 'agents/durevcode/harness/out')),
        metaPort: Number(flag(argv, 'meta-port', '4196')),
        probePortBase: Number(flag(argv, 'probe-port-base', '4210')),
        keepWorktrees: hasFlag(argv, 'keep-worktrees'),
        probeCompose: !hasFlag(argv, 'no-probe-compose'),
        repoDir,
        binPath: process.env.OPENCODE_BIN ?? 'opencode',
        dryRun: hasFlag(argv, 'dry-run'),
        modelProvider,
        modelId,
        modelVariant,
    };
}

async function main(): Promise<void> {
    try {
        const args = parseArgs();
        if (!Number.isInteger(args.k) || args.k < 1) throw new Error(`--k must be a positive integer, got ${args.k}`);
        if (!Number.isFinite(args.probeTimeoutSec) || args.probeTimeoutSec < 30) throw new Error(`--timeout must be at least 30 seconds, got ${args.probeTimeoutSec}`);
        if (!Number.isInteger(args.metaPort) || args.metaPort < 1 || args.metaPort > 65535) throw new Error(`--meta-port must be a TCP port, got ${args.metaPort}`);
        if (!Number.isInteger(args.probePortBase) || args.probePortBase < 1 || args.probePortBase > 65535) throw new Error(`--probe-port-base must be a TCP port, got ${args.probePortBase}`);
        const tasks = selectTasks(loadTasks(), args.tasks);
        const options = {
            repoDir: args.repoDir,
            binPath: args.binPath,
            tasks,
            k: args.k,
            includeBaseline: args.includeBaseline,
            probeTimeoutSec: args.probeTimeoutSec,
            outRoot: args.outRoot,
            metaPort: args.metaPort,
            probePortBase: args.probePortBase,
            keepWorktrees: args.keepWorktrees,
            probeCompose: args.probeCompose,
            modelProvider: args.modelProvider,
            modelId: args.modelId,
            modelVariant: args.modelVariant,
            log: (line: string): void => console.log(line),
        };
        if (args.dryRun) {
            console.log(`tasks source: ${tasksSource()}`);
            console.log(planText(options));
            return;
        }
        const outcome: TuneOutcome = await runTuneLoop(options);
        console.log(`report: ${join(outcome.outDir, 'report.md')}`);
    } catch (error) {
        console.error('tune loop failed:', error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) console.error(error.stack.split('\n').slice(1, 6).join('\n'));
        process.exitCode = 1;
    }
}

void main();
