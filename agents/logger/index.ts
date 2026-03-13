import { LoggerAgent } from './agent';
import * as readline from 'readline';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const agent = new LoggerAgent({
        lancedbUri: process.env.LANCEDB_URI || './logger',
        vectorDimension: parseInt(process.env.VECTOR_DIMENSION || '384'),
        verbose: process.env.VERBOSE === 'true',
        embeddingModel: process.env.EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5',
        plugins: {
            lancedb: { enabled: true }
        }
    });

    try {
        await agent.initialize();
        await agent.start();

        if (!command || command === 'interactive') {
            await interactiveMode(agent);
        } else {
            await handleCommand(agent, command, args.slice(1));
            await agent.stop();
        }

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        await agent.stop().catch(() => { });
    }
}

async function interactiveMode(agent: LoggerAgent) {
    console.log('\nLogger Agent Interactive Mode');
    console.log('Commands:');
    console.log('  log <level> <message>                - Add a log entry (levels: info, warn, error, debug)');
    console.log('  search <query> [limit]                - Vector search');
    console.log('  fts <query> [limit]                   - Full-text search');
    console.log('  hybrid <query> [limit]                - Hybrid search');
    console.log('  level <level> [limit]                  - Search logs by level');
    console.log('  source <name> [limit]                  - Search logs by source');
    console.log('  recent [limit]                         - Show recent logs');
    console.log('  stats                                  - Show statistics');
    console.log('  clear                                  - Clear all logs');
    console.log('  exit                                   - Exit interactive mode');
    console.log('');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'logger> '
    });

    rl.prompt();

    rl.on('line', async (line: string) => {
        const [cmd, ...args] = line.trim().split(' ');

        try {
            switch (cmd) {
                case 'log':
                    if (args.length < 2) {
                        console.log('Usage: log <level> <message>');
                    } else {
                        const level = args[0].toLowerCase();
                        const validLevels = ['info', 'warn', 'error', 'debug'];

                        if (!validLevels.includes(level)) {
                            console.log(`Invalid level. Use: ${validLevels.join(', ')}`);
                        } else {
                            const message = args.slice(1).join(' ');
                            await agent.log({ level: level as any, message, source: 'interactive' });
                        }
                    }
                    break;

                case 'search':
                    if (args.length === 0) {
                        console.log('Usage: search <query> [limit]');
                    } else {
                        const limit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
                        const query = args.join(' ');
                        const results = await agent.vectorSearch(query, { limit });

                        console.log(`\nVector search results for "${query}":`);
                        if (results.length === 0) {
                            console.log('  No results found');
                        } else {
                            results.forEach((r, i) => {
                                const date = new Date(r.log.timestamp).toLocaleString();
                                console.log(`  ${i + 1}. [${r.log.level}] ${r.log.message} (${date}) - score: ${r.score.toFixed(3)}`);
                            });
                        }
                    }
                    break;

                case 'fts':
                case 'text':
                    if (args.length === 0) {
                        console.log('Usage: fts <query> [limit]');
                    } else {
                        const limit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
                        const query = args.join(' ');
                        const results = await agent.fullTextSearch(query, limit);

                        console.log(`\nFull-text search results for "${query}":`);
                        if (results.length === 0) {
                            console.log('  No results found');
                        } else {
                            results.forEach((log, i) => {
                                const date = new Date(log.timestamp).toLocaleString();
                                console.log(`  ${i + 1}. [${log.level}] ${log.message} (${date})`);
                            });
                        }
                    }
                    break;

                case 'hybrid':
                    if (args.length === 0) {
                        console.log('Usage: hybrid <query> [limit]');
                    } else {
                        const limit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
                        const query = args.join(' ');
                        const results = await agent.hybridSearch(query, { limit });

                        console.log(`\nHybrid search results for "${query}":`);
                        if (results.length === 0) {
                            console.log('  No results found');
                        } else {
                            results.forEach((r, i) => {
                                const date = new Date(r.log.timestamp).toLocaleString();
                                console.log(`  ${i + 1}. [${r.log.level}] ${r.log.message} (${date}) - score: ${r.score.toFixed(3)}`);
                            });
                        }
                    }
                    break;

                case 'level':
                    if (args.length === 0) {
                        console.log('Usage: level <info|warn|error|debug> [limit]');
                    } else {
                        const limit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
                        const level = args[0].toLowerCase();
                        const validLevels = ['info', 'warn', 'error', 'debug'];

                        if (!validLevels.includes(level)) {
                            console.log(`Invalid level. Use: ${validLevels.join(', ')}`);
                        } else {
                            const results = await agent.searchByLevel(level as any, limit);

                            console.log(`\n${level} logs:`);
                            if (results.length === 0) {
                                console.log('  No logs found');
                            } else {
                                results.forEach((r, i) => {
                                    const date = new Date(r.log.timestamp).toLocaleString();
                                    console.log(`  ${i + 1}. [${r.log.level}] ${r.log.message} (${date})`);
                                });
                            }
                        }
                    }
                    break;

                case 'source':
                    if (args.length === 0) {
                        console.log('Usage: source <name> [limit]');
                    } else {
                        const limit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
                        const source = args[0];
                        const results = await agent.searchBySource(source, limit);

                        console.log(`\nLogs from source '${source}':`);
                        if (results.length === 0) {
                            console.log('  No logs found');
                        } else {
                            results.forEach((r, i) => {
                                const date = new Date(r.log.timestamp).toLocaleString();
                                console.log(`  ${i + 1}. [${r.log.level}] ${r.log.message} (${date})`);
                            });
                        }
                    }
                    break;

                case 'recent':
                    const recentLimit = args[0] ? parseInt(args[0]) : 20;
                    const logs = await agent.getRecentLogs(recentLimit);

                    console.log(`\nRecent ${logs.length} logs:`);
                    if (logs.length === 0) {
                        console.log('  No logs found');
                    } else {
                        logs.forEach((log, i) => {
                            const date = new Date(log.timestamp).toLocaleString();
                            console.log(`  ${i + 1}. [${log.level}] ${log.message} (${date})${log.source ? ` - ${log.source}` : ''}`);
                        });
                    }
                    break;

                case 'stats':
                    const stats = await agent.getStats();

                    console.log('\nStatistics:');
                    console.log(`  Total logs: ${stats.totalLogs}`);
                    console.log('  By level:');
                    if (Object.keys(stats.byLevel).length === 0) {
                        console.log('    No logs');
                    } else {
                        Object.entries(stats.byLevel).forEach(([level, count]) => {
                            console.log(`    ${level}: ${count}`);
                        });
                    }
                    console.log('  By source:');
                    if (Object.keys(stats.bySource).length === 0) {
                        console.log('    No logs');
                    } else {
                        Object.entries(stats.bySource).forEach(([source, count]) => {
                            console.log(`    ${source}: ${count}`);
                        });
                    }
                    break;

                case 'clear':
                    await agent.clearAllLogs();
                    console.log('All logs cleared');
                    break;

                case 'exit':
                    console.log('Stopping agent...');
                    await agent.stop();
                    rl.close();
                    process.exit(0);
                    break;

                default:
                    console.log('Unknown command. Available commands:');
                    console.log('  log, search, fts, hybrid, level, source, recent, stats, clear, exit');
            }
        } catch (error) {
            console.error('Command error:', error instanceof Error ? error.message : String(error));
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\nExiting interactive mode');
        agent.stop().then(() => process.exit(0));
    });

    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT. Stopping agent...');
        await agent.stop();
        process.exit(0);
    });
}

async function handleCommand(agent: LoggerAgent, command: string, args: string[]) {
    switch (command) {
        case 'log':
            if (args.length < 2) {
                console.error('Usage: logger log <level> <message> [source]');
                process.exit(1);
            }
            const level = args[0].toLowerCase();
            const validLevels = ['info', 'warn', 'error', 'debug'];

            if (!validLevels.includes(level)) {
                console.error(`Invalid level. Use: ${validLevels.join(', ')}`);
                process.exit(1);
            }

            const message = args[1];
            const source = args[2];
            await agent.log({ level: level as any, message, source });
            console.log('Log added successfully');
            break;

        case 'search':
            if (args.length === 0) {
                console.error('Usage: logger search <query> [limit]');
                process.exit(1);
            }
            const searchLimit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
            const searchQuery = args.join(' ');
            const searchResults = await agent.vectorSearch(searchQuery, { limit: searchLimit });
            console.log(JSON.stringify(searchResults, null, 2));
            break;

        case 'fts':
            if (args.length === 0) {
                console.error('Usage: logger fts <query> [limit]');
                process.exit(1);
            }
            const ftsLimit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
            const ftsQuery = args.join(' ');
            const ftsResults = await agent.fullTextSearch(ftsQuery, ftsLimit);
            console.log(JSON.stringify(ftsResults, null, 2));
            break;

        case 'hybrid':
            if (args.length === 0) {
                console.error('Usage: logger hybrid <query> [limit]');
                process.exit(1);
            }
            const hybridLimit = args[args.length - 1].match(/^\d+$/) ? parseInt(args.pop()!) : 10;
            const hybridQuery = args.join(' ');
            const hybridResults = await agent.hybridSearch(hybridQuery, { limit: hybridLimit });
            console.log(JSON.stringify(hybridResults, null, 2));
            break;

        case 'recent':
            const recentLimit = args[0] ? parseInt(args[0]) : 50;
            const logs = await agent.getRecentLogs(recentLimit);
            console.log(JSON.stringify(logs, null, 2));
            break;

        case 'stats':
            const stats = await agent.getStats();
            console.log(JSON.stringify(stats, null, 2));
            break;

        default:
            console.error('Unknown command. Available: log, search, fts, hybrid, recent, stats');
            process.exit(1);
    }
}

main().catch(console.error);
