import { TelegramClientAgent } from './agent';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// Load .env
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const m = line.match(/^\s*([\w_]+)\s*=\s*(.+?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
});

const prompts: string[] = [];
rl.on('line', l => { if (!rl.terminal) prompts.push(l); });

function ask(query: string, def?: string): Promise<string> {
    return new Promise<string>(r => {
        if (!rl.terminal) {
            setImmediate(() => r(prompts.shift() || def || ''));
        } else {
            rl.question(query, r);
        }
    });
}

async function main() {
    const apiId = Number(process.env.API_ID || await ask('API_ID (94575): ', '94575'));
    const apiHash = process.env.API_HASH || await ask('API_HASH: ');
    const phone = process.env.PHONE_NUMBER || await ask('Phone: ');
    const proxy = process.env.PROXY || 'socks5://127.0.0.1:7897';
    const dcId = Number(process.env.DC_ID || '2');
    const isTestDc = process.env.IS_TEST_DC === 'true';
    const noObfuscation = process.env.NO_OBFUSCATION !== 'false';

    if (!apiHash) { console.error('API_HASH required'); process.exit(1); }
    if (!phone) { console.error('Phone required'); process.exit(1); }

    const agent = new TelegramClientAgent({
        name: 'telegram-client',
        apiId, apiHash, dcId, proxy, noObfuscation, isTestDc,
        authKeyFile: process.env.AUTH_KEY_FILE,
    });

    try {
        await agent.initialize();
        await agent.start();

        console.log(`\nConnecting to DC${dcId}...`);
        await agent.connectAndInit();
        console.log('Connected.\n');

        console.log(`Sending code to ${phone}...`);
        const sentCode = await agent.authSendCode(phone);
        const parsed = agent.parseAuthSentCode(sentCode);
        console.log(`  Type: ${parsed.type}  Hash: ${parsed.phoneCodeHash.slice(0, 8)}...\n`);

        const code = process.env.PHONE_CODE || await ask('Code: ');

        console.log('Signing in...');
        await agent.authSignIn(phone, parsed.phoneCodeHash, code);
        console.log('Signed in!\n');

        const t = await agent.updatesGetState();
        console.log('State:', t.length, 'bytes\n');

        console.log('Commands: dialogs, state, send <target> <msg>, exit\n');

        while (true) {
            const line = await ask('> ');
            const [cmd, ...args] = line.trim().split(/\s+/);
            if (!cmd || cmd === 'exit') break;
            if (cmd === 'dialogs') {
                console.log(`${(await agent.messagesGetDialogs(5)).length}B`);
            } else if (cmd === 'state') {
                console.log(`${(await agent.updatesGetState()).length}B`);
            } else if (cmd === 'send' && args.length >= 2) {
                const peer = agent.createInputPeerUser(Number(args[0]), 0n);
                const msg = args.slice(1).join(' ');
                await agent.messagesSendMessage(peer, msg, BigInt(Date.now()) * 1000n);
                console.log('Sent');
            } else {
                console.log('Unknown');
            }
        }
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    } finally {
        await agent.stop();
        rl.close();
    }
}

main();
