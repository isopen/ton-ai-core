import { TelegramClientAgent } from './agent';
import * as fs from 'fs';

const CODE_HASH_FILE = process.env.CODE_HASH_FILE || '/tmp/telegram-code-hash.json';

async function main() {
    const required = ['API_ID', 'API_HASH'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
        console.error(`Missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }

    const agent = new TelegramClientAgent({
        name: 'telegram-client-test',
        apiId: Number(process.env.API_ID),
        apiHash: process.env.API_HASH!,
        dcId: Number(process.env.DC_ID || '2'),
        proxy: process.env.PROXY || 'socks5://127.0.0.1:7897',
        noObfuscation: process.env.NO_OBFUSCATION === 'true',
        authKeyFile: process.env.AUTH_KEY_FILE,
        phoneNumber: process.env.PHONE_NUMBER,
        phoneCode: process.env.PHONE_CODE,
        targetUserId: process.env.TARGET_USER_ID ? Number(process.env.TARGET_USER_ID) : undefined,
        targetAccessHash: process.env.TARGET_ACCESS_HASH,
        targetChatId: process.env.TARGET_CHAT_ID ? Number(process.env.TARGET_CHAT_ID) : undefined,
    });

    try {
        await agent.initialize();
        await agent.start();

        const action = process.env.ACTION || 'handshake';

        switch (action) {
            case 'handshake':
                await runHandshake(agent);
                break;
            case 'send-code':
                await runSendCode(agent);
                break;
            case 'sign-in':
                await runSignIn(agent);
                break;
            case 'full':
                await runFull(agent);
                break;
            default:
                await runHandshake(agent);
        }
    } catch (error) {
        console.error('Fatal:', error);
        process.exit(1);
    } finally {
        await agent.stop();
    }
}

async function runHandshake(agent: TelegramClientAgent) {
    console.log('\n' + '='.repeat(60));
    console.log('  TELEGRAM MTProto HANDSHAKE TEST');
    console.log('='.repeat(60));

    await agent.connectAndInit();

    console.log('\n[fetch] Fetching server config (help.getConfig)...');
    const config = await agent.fetchConfig();
    console.log(`  OK - Config received (${config.length} bytes)`);
    console.log(`  Hex (first 100): ${config.subarray(0, 100).toString('hex')}`);

    console.log('\n' + '='.repeat(60));
    console.log('  HANDSHAKE TEST PASSED');
    console.log('='.repeat(60) + '\n');
}

async function runSendCode(agent: TelegramClientAgent) {
    const phoneNumber = process.env.PHONE_NUMBER;
    if (!phoneNumber) {
        console.error('PHONE_NUMBER required for send-code action');
        process.exit(1);
    }

    await agent.connectAndInit();

    console.log(`\n[auth] Sending code to ${phoneNumber}...`);
    const sentCode = await agent.authSendCode(phoneNumber);
    const parsed = agent.parseAuthSentCode(sentCode);
    console.log(`  Code hash: ${parsed.phoneCodeHash.slice(0, 8)}...`);
    console.log(`  Type: ${parsed.type}`);
    console.log(`  Timeout: ${parsed.timeout || 0}s`);

    fs.writeFileSync(CODE_HASH_FILE, JSON.stringify({
        phoneNumber,
        phoneCodeHash: parsed.phoneCodeHash,
        timestamp: Date.now(),
    }, null, 2));

    const timeout = parsed.timeout ?? 0;
    if (timeout > 0) {
        console.log(`  Waiting ${timeout}s...`);
        await new Promise(r => setTimeout(r, timeout * 1000));
    }
}

async function runSignIn(agent: TelegramClientAgent) {
    const phoneNumber = process.env.PHONE_NUMBER;
    const phoneCode = process.env.PHONE_CODE;
    if (!phoneNumber || !phoneCode) {
        console.error('PHONE_NUMBER and PHONE_CODE required for sign-in action');
        process.exit(1);
    }

    let phoneCodeHash: string;
    try {
        const saved = JSON.parse(fs.readFileSync(CODE_HASH_FILE, 'utf-8'));
        phoneCodeHash = saved.phoneCodeHash;
    } catch {
        console.error('No saved code hash found. Run with ACTION=send-code first.');
        process.exit(1);
    }

    await agent.connectAndInit();

    console.log(`\n[auth] Signing in with code...`);
    await agent.authSignIn(phoneNumber, phoneCodeHash, phoneCode);
    console.log('  OK - Signed in');

    try { fs.unlinkSync(CODE_HASH_FILE); } catch {}
}

async function runFull(agent: TelegramClientAgent) {
    await agent.connectAndInit();

    const phoneNumber = process.env.PHONE_NUMBER;
    if (!phoneNumber) {
        console.log('\n  No PHONE_NUMBER. Skipping auth.');
        return;
    }

    let phoneCodeHash: string;
    try {
        const saved = JSON.parse(fs.readFileSync(CODE_HASH_FILE, 'utf-8'));
        phoneCodeHash = saved.phoneCodeHash;
    } catch {
        console.log(`\n[auth] Sending code to ${phoneNumber}...`);
        const sentCode = await agent.authSendCode(phoneNumber);
        const parsed = agent.parseAuthSentCode(sentCode);
        phoneCodeHash = parsed.phoneCodeHash;

        fs.writeFileSync(CODE_HASH_FILE, JSON.stringify({
            phoneNumber,
            phoneCodeHash,
            timestamp: Date.now(),
        }, null, 2));

        console.log(`  Code hash: ${phoneCodeHash.slice(0, 8)}...`);
        console.log(`  Set PHONE_CODE env var and restart.`);
        return;
    }

    const phoneCode = process.env.PHONE_CODE;
    if (!phoneCode) {
        console.log('Set PHONE_CODE env var with the code you received.');
        return;
    }

    console.log(`\n[auth] Signing in...`);
    await agent.authSignIn(phoneNumber, phoneCodeHash, phoneCode);
    try { fs.unlinkSync(CODE_HASH_FILE); } catch {}

    console.log(`\n[updates] Getting state...`);
    await agent.updatesGetState();
    console.log('  OK');

    const targetUserId = Number(process.env.TARGET_USER_ID);
    const targetAccessHash = process.env.TARGET_ACCESS_HASH;

    if (targetUserId && targetAccessHash) {
        console.log(`\n[message] Sending test message...`);
        const peer = agent.createInputPeerUser(targetUserId, BigInt(targetAccessHash));
        const randomId = BigInt(Date.now()) * 1000n;
        await agent.messagesSendMessage(peer, 'Hello from TON AI MTProto!', randomId);
        console.log('  OK - Message sent');
    }

    console.log('\n FULL AUTH PASSED\n');
}

main().catch(console.error);
