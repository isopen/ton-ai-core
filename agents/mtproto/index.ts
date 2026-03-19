import { MTProtoCryptoPlugin, EncryptedData } from '@ton-ai/mtproto';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

function createMessageId(seqNo: number): bigint {
    const now = Date.now();
    const timePart = BigInt(Math.floor(now / 1000)) * 4294967296n;
    const microSec = BigInt(now % 1000) * 4294967n;

    let messageId = (timePart + microSec + BigInt(seqNo * 2)) & 0x7FFFFFFFFFFFFFFFn;

    if (messageId % 2n === 1n) {
        messageId = messageId + 1n;
    }

    return messageId;
}

async function simpleTest() {
    console.log('MTProto 2.0 Test');

    const plugin = new MTProtoCryptoPlugin();

    const context = {
        mcp: {} as any,
        logger: console,
        events: new EventEmitter(),
        config: { mode: 'client' }
    };

    context.events.on('mtproto:authkey:generated', (data) => {
        console.log(`   Event: AuthKey generated (ID: ${data.id})`);
    });

    await plugin.initialize(context);
    await plugin.onActivate();
    console.log('Plugin initialized\n');

    try {
        console.log('Step 1: Key generation');
        const dhKeys = plugin.generateDHKeys();
        console.log('   DH keys generated');

        const sharedSecret = plugin.computeSharedSecret(dhKeys.privateKey, dhKeys.publicKey);
        console.log('   Shared secret computed');

        const authKey = await plugin.generateAuthKey(sharedSecret);
        plugin.setAuthKey(authKey);
        console.log(`   AuthKey set (ID: ${authKey.id.toString(16)})\n`);

        const serverSalt = crypto.randomBytes(8);
        plugin.setServerSalt(serverSalt);
        console.log(`Step 2: Server salt set (${serverSalt.toString('hex')})\n`);

        console.log('Step 3: Message testing');

        const testCases = [
            { name: 'Short', text: 'Hello!' },
            { name: 'Medium', text: 'Test message for verification' },
            { name: 'Long', text: 'A'.repeat(100) },
            { name: 'Unicode', text: 'Hello world! 🔥' },
            { name: 'Empty', text: '' }
        ];

        const sessionId = 0x12345678n;
        let successCount = 0;

        for (let i = 0; i < testCases.length; i++) {
            const test = testCases[i];
            const messageId = createMessageId(i);

            console.log(`\n   Test ${i + 1}: ${test.name}`);
            console.log(`   Text: "${test.text}"`);
            console.log(`   Session ID: ${sessionId.toString(16)}`);
            console.log(`   Message ID: ${messageId.toString(16)}`);

            try {
                const encryptedData = plugin.encryptMessage(
                    Buffer.from(test.text),
                    sessionId,
                    messageId,
                    i
                );
                console.log(`   Encrypted (${encryptedData.data.length} bytes)`);

                const decrypted = plugin.decryptMessage(encryptedData, sessionId);
                const decryptedText = decrypted.toString('utf8');

                if (test.text === decryptedText) {
                    console.log(`   Decrypted: "${decryptedText}"`);
                    successCount++;
                } else {
                    console.log(`   Expected: "${test.text}"`);
                    console.log(`   Got: "${decryptedText}"`);
                }
            } catch (error) {
                const err = error as Error;
                console.log(`   Error: ${err.message}`);
            }
        }

        console.log(`\nResult: ${successCount}/${testCases.length} tests passed`);

        console.log('\nStep 4: Session ID testing');

        const sessionIds = [
            0x1n,
            0x1234n,
            0x12345678n,
            0x123456789n,
            0x7FFFFFFFFFFFFFFFn
        ];

        const testMessage = 'Test message';
        let sessionSuccess = 0;

        for (const sid of sessionIds) {
            try {
                const msgId = createMessageId(0);
                const encryptedData = plugin.encryptMessage(
                    Buffer.from(testMessage),
                    sid,
                    msgId,
                    0
                );
                const decrypted = plugin.decryptMessage(encryptedData, sid);

                if (decrypted.toString('utf8') === testMessage) {
                    console.log(`   Session ID ${sid.toString(16).padStart(16, '0')}`);
                    sessionSuccess++;
                } else {
                    console.log(`   Session ID ${sid.toString(16).padStart(16, '0')}`);
                }
            } catch (error) {
                const err = error as Error;
                console.log(`   Session ID ${sid.toString(16).padStart(16, '0')}: ${err.message}`);
            }
        }

        console.log(`\nSession ID tests: ${sessionSuccess}/${sessionIds.length} passed`);

        console.log('\nStep 5: msg_key validation');
        try {
            const testMsg = 'Validation test';
            const msgId = createMessageId(0);

            const encryptedData = plugin.encryptMessage(
                Buffer.from(testMsg),
                sessionId,
                msgId,
                0
            );

            const corruptedData: EncryptedData = {
                data: Buffer.from(encryptedData.data),
                msgKey: Buffer.from(encryptedData.msgKey),
                iv: encryptedData.iv ? Buffer.from(encryptedData.iv) : undefined
            };
            corruptedData.data[0] ^= 0xFF;

            try {
                plugin.decryptMessage(corruptedData, sessionId);
                console.log('   Should have thrown error');
            } catch (error) {
                const err = error as Error;
                console.log(`   Caught: ${err.message}`);
            }

            const decrypted = plugin.decryptMessage(encryptedData, sessionId);
            if (decrypted.toString('utf8') === testMsg) {
                console.log('   Validation successful');
            }

        } catch (error) {
            const err = error as Error;
            console.log(`   Error: ${err.message}`);
        }

        console.log('\nStep 6: Size testing');
        const sizes = [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256];
        let sizeSuccess = 0;

        for (const size of sizes) {
            try {
                const testMsg = 'A'.repeat(size);
                const msgId = createMessageId(size);

                const encryptedData = plugin.encryptMessage(
                    Buffer.from(testMsg),
                    sessionId,
                    msgId,
                    size
                );

                const decrypted = plugin.decryptMessage(encryptedData, sessionId);

                if (decrypted.toString('utf8') === testMsg) {
                    console.log(`   Size ${size} bytes`);
                    sizeSuccess++;
                } else {
                    console.log(`   Size ${size} bytes`);
                }
            } catch (error) {
                const err = error as Error;
                console.log(`   Size ${size} bytes: ${err.message}`);
            }
        }

        console.log(`\nSize tests: ${sizeSuccess}/${sizes.length} passed`);

    } catch (error) {
        const err = error as Error;
        console.error('Test error:', err.message);
    }

    await plugin.onDeactivate();
    console.log('\nPlugin deactivated');
}

simpleTest().catch((error: unknown) => {
    const err = error as Error;
    console.error('Fatal error:', err.message);
});
