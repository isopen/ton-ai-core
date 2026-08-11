import { StripperAgent } from './agent';

const USAGE = `usage: npx ts-node agents/stripper/index.ts <command> [args]

commands:
  strip <paths...>     strip comments in files/dirs (any language)
  git-dirty            strip comments in all files changed since HEAD
  watch <dir>          watch dir and strip comments on every file save
  help                 show this help
`;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command || command === 'help') {
        console.log(USAGE);
        return;
    }
    const agent = new StripperAgent({
        name: 'stripper',
        verbose: process.env.VERBOSE === 'true',
    });
    await agent.initialize();
    await agent.start();
    try {
        switch (command) {
            case 'strip': {
                const paths = args.slice(1);
                if (paths.length === 0) {
                    console.error('usage: strip <paths...>');
                    process.exitCode = 1;
                    return;
                }
                await agent.strip(paths);
                break;
            }
            case 'git-dirty':
                await agent.stripGitDirty(process.cwd());
                break;
            case 'watch': {
                const dir = args[1] || process.cwd();
                agent.watch(dir);
                await new Promise<void>(() => {});
                break;
            }
            default:
                console.error('unknown command: ' + command);
                console.log(USAGE);
                process.exitCode = 1;
        }
    } finally {
        await agent.stop().catch(() => {});
    }
}

main().catch((e) => {
    console.error('error:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
});
