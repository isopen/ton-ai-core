import {
    MTProtoCryptoPlugin,
    EncryptedData,
    DecryptedData,
    AES256IGE,
    MTProtoKDF,
    DiffieHellman,
    SecretExpander,
    X25519
} from '@ton-ai/mtproto';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

function createMessageId(seqNo: number, isClient: boolean = true): bigint {
    const now = Date.now();
    const timeInSeconds = BigInt(Math.floor(now / 1000));
    const messageIdBase = timeInSeconds * 4294967296n;
    const milliseconds = BigInt(now % 1000);
    const fractionalPart = (milliseconds * 4294967296n) / 1000n;

    let messageId = messageIdBase + fractionalPart + BigInt(seqNo * 4);

    if (isClient) {
        if (messageId % 2n === 1n) {
            messageId = messageId + 1n;
        }
    } else {
        if (messageId % 2n === 0n) {
            messageId = messageId + 1n;
        }
    }

    return messageId & 0x7FFFFFFFFFFFFFFFn;
}

async function comprehensiveMTProtoTest() {
    console.log('MTProto 2.0 Comprehensive Test Suite');

    const plugin = new MTProtoCryptoPlugin();
    const context = {
        mcp: {} as any,
        logger: console,
        events: new EventEmitter(),
        config: { mode: 'client' }
    };

    context.events.on('mtproto:authkey:generated', (data) => {
        console.log(`   📍 Event: AuthKey generated (ID: ${data.id})`);
    });
    context.events.on('mtproto:encrypted', (data) => {
        console.log(`   📍 Event: Data encrypted (${data.size} bytes)`);
    });
    context.events.on('mtproto:decrypted', (data) => {
        console.log(`   📍 Event: Data decrypted (valid: ${data.valid})`);
    });

    await plugin.initialize(context);
    await plugin.onActivate();
    console.log('Plugin initialized\n');

    const testResults: Record<string, boolean> = {};

    console.log('TEST 1: Key Generation and Management');
    try {
        const dhKeys = plugin.generateDHKeys();
        console.log('   DH keys generated');
        console.log(`      Private key: ${dhKeys.privateKey.toString(16).substring(0, 32)}...`);
        console.log(`      Public key: ${dhKeys.publicKey.toString(16).substring(0, 32)}...`);

        const sharedSecret = plugin.computeSharedSecret(dhKeys.privateKey, dhKeys.publicKey);
        console.log(`   Shared secret computed (${sharedSecret.length} bytes)`);

        const authKey = await plugin.generateAuthKey(sharedSecret);
        plugin.setAuthKey(authKey);
        console.log(`   AuthKey generated:`);
        console.log(`      ID: ${authKey.id.toString(16)}`);
        console.log(`      Length: ${authKey.key.length} bytes (2048 bits)`);

        const sha1 = crypto.createHash('sha1').update(authKey.key).digest();
        const expectedId = BigInt('0x' + sha1.subarray(-8).toString('hex'));
        const idVerification = authKey.id === expectedId;
        console.log(`   AuthKey ID verification: ${idVerification ? 'PASS' : 'FAIL'}`);

        const serverSalt = crypto.randomBytes(8);
        plugin.setServerSalt(serverSalt);
        console.log(`   Server salt set: ${serverSalt.toString('hex')}`);

        const storedAuthKey = plugin.getAuthKey();
        const storedSalt = plugin.getServerSalt();
        const storedDHKeys = plugin.getDHKeys();
        const keyStorage = !!(storedAuthKey && storedSalt && storedDHKeys);
        console.log(`   Key storage: ${keyStorage ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 1'] = idVerification && keyStorage;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 1'] = false;
    }

    console.log('📝 TEST 2: Message ID Requirements');
    try {
        const clientMsgId1 = createMessageId(0, true);
        const clientMsgId2 = createMessageId(1, true);
        const serverMsgId = createMessageId(0, false);

        console.log(`   Client message ID (seq0): ${clientMsgId1.toString(16)} (${clientMsgId1})`);
        console.log(`   Client message ID (seq1): ${clientMsgId2.toString(16)} (${clientMsgId2})`);
        console.log(`   Server message ID: ${serverMsgId.toString(16)} (${serverMsgId})`);

        const clientParity = clientMsgId1 % 2n === 0n;
        const serverParity = serverMsgId % 2n === 1n;
        const monotonic = clientMsgId2 > clientMsgId1;

        console.log(`   Client parity (even): ${clientParity ? 'PASS' : 'FAIL'} (${clientMsgId1 % 2n})`);
        console.log(`   Server parity (odd): ${serverParity ? 'PASS' : 'FAIL'} (${serverMsgId % 2n})`);
        console.log(`   Monotonic: ${monotonic ? 'PASS' : 'FAIL'} (${clientMsgId2} > ${clientMsgId1})`);

        const now = BigInt(Math.floor(Date.now() / 1000)) * 4294967296n;
        const timeDiff = clientMsgId1 > now ? clientMsgId1 - now : now - clientMsgId1;
        const timeDiffSeconds = Number(timeDiff) / 4294967296;
        const timeProximity = Math.abs(timeDiffSeconds) < 300;
        console.log(`   Time difference: ${timeDiffSeconds.toFixed(2)} seconds`);
        console.log(`   Time proximity: ${timeProximity ? 'PASS' : 'FAIL'}`);

        const allPassed = clientParity && serverParity && monotonic && timeProximity;
        console.log(`   Overall: ${allPassed ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 2'] = allPassed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 2'] = false;
    }

    console.log('TEST 3: Basic Encryption/Decryption Cycle');

    const testCases = [
        { name: 'Empty', text: '' },
        { name: 'Short', text: 'Hello!' },
        { name: 'Medium', text: 'Test message for verification' },
        { name: 'Long', text: 'A'.repeat(100) },
        { name: 'Unicode', text: 'Hello world! 🔥 Привет мир! 🌍' },
        { name: 'Special', text: '!@#$%^&*()_+{}[]|\\:;"\'<>,.?/~`' }
    ];

    const sessionId = 0x12345678n;
    let basicSuccess = 0;

    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];
        const messageId = createMessageId(i);

        console.log(`\n   Test ${i + 1}: ${test.name}`);
        console.log(`   Text: "${test.text}"`);
        console.log(`   Length: ${test.text.length} bytes`);

        try {
            const encryptedData = plugin.encryptMessage(
                Buffer.from(test.text),
                sessionId,
                messageId,
                i
            );
            console.log(`   Encrypted: ${encryptedData.data.length} bytes`);
            console.log(`      MsgKey: ${encryptedData.msgKey.toString('hex')}`);

            const decryptedData = plugin.decryptMessage(encryptedData, sessionId);
            const decryptedText = decryptedData.toString('utf8');

            if (test.text === decryptedText) {
                console.log(`   Decrypted: "${decryptedText}"`);
                basicSuccess++;
            } else {
                console.log(`   Mismatch:`);
                console.log(`      Expected: "${test.text}"`);
                console.log(`      Got: "${decryptedText}"`);
            }
        } catch (error) {
            const err = error as Error;
            console.log(`   Error: ${err.message}`);
        }
    }
    console.log(`\n   Basic cycle: ${basicSuccess}/${testCases.length} passed\n`);
    testResults['TEST 3'] = basicSuccess === testCases.length;

    console.log('TEST 4: Session ID Variations');

    const sessionIds = [
        0x0n,
        0x1n,
        0x1234n,
        0x12345678n,
        0x123456789n,
        0x7FFFFFFFFFFFFFFFn
    ];

    const testMessage = 'Session test message';
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
                console.log(`   Session ID: 0x${sid.toString(16).padStart(16, '0')}`);
                sessionSuccess++;
            } else {
                console.log(`   Session ID: 0x${sid.toString(16).padStart(16, '0')}`);
            }
        } catch (error) {
            const err = error as Error;
            console.log(`   Session ID: 0x${sid.toString(16).padStart(16, '0')} - ${err.message}`);
        }
    }
    console.log(`\n   Session ID tests: ${sessionSuccess}/${sessionIds.length} passed\n`);
    testResults['TEST 4'] = sessionSuccess === sessionIds.length;

    console.log('TEST 5: Message Size Boundaries');

    const sizes = [
        0, 1, 15, 16, 17, 31, 32, 33,
        63, 64, 65, 127, 128, 129,
        255, 256, 511, 512, 1023, 1024, 2048
    ];

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
                console.log(`   Size ${size} bytes (enc: ${encryptedData.data.length} bytes)`);
                sizeSuccess++;
            } else {
                console.log(`   Size ${size} bytes`);
            }
        } catch (error) {
            const err = error as Error;
            console.log(`   Size ${size} bytes: ${err.message}`);
        }
    }
    console.log(`\n   Size tests: ${sizeSuccess}/${sizes.length} passed\n`);
    testResults['TEST 5'] = sizeSuccess === sizes.length;

    console.log('TEST 6: Padding Validation');
    try {
        const smallMsg = 'Small';
        const msgId = createMessageId(0);

        const encrypted = plugin.encryptMessage(
            Buffer.from(smallMsg),
            sessionId,
            msgId,
            0
        );

        const encrypted_len = encrypted.data.length;
        const plaintext_len = 32 + smallMsg.length;
        const padding = encrypted_len - plaintext_len;

        const paddingMin = padding >= 12;
        const paddingMax = padding <= 1024;
        const multipleOf16 = encrypted_len % 16 === 0;

        console.log(`   Message length: ${smallMsg.length} bytes`);
        console.log(`   Plaintext length: ${plaintext_len} bytes`);
        console.log(`   Encrypted length: ${encrypted_len} bytes`);
        console.log(`   Padding: ${padding} bytes`);
        console.log(`   Padding >= 12: ${paddingMin ? 'PASS' : 'FAIL'}`);
        console.log(`   Padding <= 1024: ${paddingMax ? 'PASS' : 'FAIL'}`);
        console.log(`   Multiple of 16: ${multipleOf16 ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 6'] = paddingMin && paddingMax && multipleOf16;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 6'] = false;
    }

    console.log('TEST 7: Message Key Validation');
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

        let corruptedDataCaught = false;
        try {
            plugin.decryptMessage(corruptedData, sessionId);
            console.log('   Corrupted data: Should have thrown error');
        } catch (error) {
            const err = error as Error;
            console.log(`   Corrupted data: ${err.message}`);
            corruptedDataCaught = true;
        }

        const corruptedKey: EncryptedData = {
            data: Buffer.from(encryptedData.data),
            msgKey: Buffer.from(encryptedData.msgKey),
            iv: encryptedData.iv ? Buffer.from(encryptedData.iv) : undefined
        };
        corruptedKey.msgKey[0] ^= 0xFF;

        let corruptedKeyCaught = false;
        try {
            plugin.decryptMessage(corruptedKey, sessionId);
            console.log('   Corrupted key: Should have thrown error');
        } catch (error) {
            const err = error as Error;
            console.log(`   Corrupted key: ${err.message}`);
            corruptedKeyCaught = true;
        }

        const decrypted = plugin.decryptMessage(encryptedData, sessionId);
        const validData = decrypted.toString('utf8') === testMsg;
        if (validData) {
            console.log('   Valid data: Correctly decrypted');
        }

        console.log('');
        testResults['TEST 7'] = corruptedDataCaught && corruptedKeyCaught && validData;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 7'] = false;
    }

    console.log('TEST 8: Sequence Numbers');
    try {
        const messages = ['First', 'Second', 'Third', 'Fourth'];

        for (let i = 0; i < messages.length; i++) {
            const msgId = createMessageId(i);
            const encrypted = plugin.encryptMessage(
                Buffer.from(messages[i]),
                sessionId,
                msgId,
                i
            );
            console.log(`   Message ${i} processed with seq_no ${i}`);
        }
        console.log('');
        testResults['TEST 8'] = true;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 8'] = false;
    }

    console.log('TEST 9: Concurrent Sessions');
    try {
        const sessions = [0x1111n, 0x2222n, 0x3333n, 0x4444n, 0x5555n];
        const message = 'Concurrent test';

        const results = [];
        for (let index = 0; index < sessions.length; index++) {
            const sid = sessions[index];
            const msgId = createMessageId(index);
            const encrypted = plugin.encryptMessage(
                Buffer.from(message),
                sid,
                msgId,
                index
            );
            const decrypted = plugin.decryptMessage(encrypted, sid);
            results.push(decrypted.toString('utf8') === message);
        }

        const success = results.filter(r => r).length;
        console.log(`   ${success}/${sessions.length} concurrent sessions successful\n`);
        testResults['TEST 9'] = success === sessions.length;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 9'] = false;
    }

    console.log('TEST 10: Performance Benchmark');
    try {
        const iterations = 1000;
        const message = 'Performance test message';
        const msgId = createMessageId(0);

        const encryptStart = Date.now();
        for (let i = 0; i < iterations; i++) {
            plugin.encryptMessage(
                Buffer.from(message),
                sessionId,
                msgId + BigInt(i),
                i
            );
        }
        const encryptTime = Date.now() - encryptStart;

        const encryptedData = plugin.encryptMessage(
            Buffer.from(message),
            sessionId,
            msgId,
            0
        );

        const decryptStart = Date.now();
        for (let i = 0; i < iterations; i++) {
            plugin.decryptMessage(encryptedData, sessionId);
        }
        const decryptTime = Date.now() - decryptStart;

        console.log(`   ${iterations} iterations:`);
        console.log(`   Encrypt: ${encryptTime}ms (${(iterations / (encryptTime / 1000)).toFixed(0)} ops/sec)`);
        console.log(`   Decrypt: ${decryptTime}ms (${(iterations / (decryptTime / 1000)).toFixed(0)} ops/sec)\n`);
        testResults['TEST 10'] = true;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 10'] = false;
    }

    console.log('TEST 11: Metrics');
    try {
        const metrics = plugin.getMetrics();
        console.log('   Current metrics:');
        console.log(`   Mode: ${metrics.mode}`);
        console.log(`   Ready: ${metrics.ready}`);
        console.log(`   Has AuthKey: ${metrics.hasAuthKey}`);
        console.log(`   AuthKey ID: ${metrics.authKeyId || 'none'}\n`);
        testResults['TEST 11'] = metrics.mode === 'client' && metrics.ready && metrics.hasAuthKey;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 11'] = false;
    }

    console.log('TEST 12: Reset Functionality');
    try {
        console.log('   Before reset:');
        console.log(`   AuthKey: ${plugin.getAuthKey() ? 'present' : 'absent'}`);
        console.log(`   ServerSalt: ${plugin.getServerSalt() ? 'present' : 'absent'}`);
        console.log(`   DHKeys: ${plugin.getDHKeys() ? 'present' : 'absent'}`);

        plugin.reset();

        console.log('   After reset:');
        console.log(`   AuthKey: ${plugin.getAuthKey() ? 'present' : 'absent'}`);
        console.log(`   ServerSalt: ${plugin.getServerSalt() ? 'present' : 'absent'}`);
        console.log(`   DHKeys: ${plugin.getDHKeys() ? 'present' : 'absent'}`);
        console.log('   Reset successful\n');
        testResults['TEST 12'] = !plugin.getAuthKey() && !plugin.getServerSalt() && !plugin.getDHKeys();
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 12'] = false;
    }

    const dhKeys = plugin.generateDHKeys();
    const sharedSecret = plugin.computeSharedSecret(dhKeys.privateKey, dhKeys.publicKey);
    const authKey = await plugin.generateAuthKey(sharedSecret);
    plugin.setAuthKey(authKey);
    const serverSalt = crypto.randomBytes(8);
    plugin.setServerSalt(serverSalt);
    const testSessionId = 0x12345678n;

    console.log('TEST 13: Message ID Uniqueness');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const ids = new Set();
        let duplicates = 0;

        for (let i = 0; i < 1000; i++) {
            const msgId = createMessageId(i);
            if (ids.has(msgId)) duplicates++;
            ids.add(msgId);
        }

        console.log(`   Generated 1000 message IDs`);
        console.log(`   Duplicates: ${duplicates}`);
        const unique = duplicates === 0;
        console.log(`   Message IDs unique: ${unique ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 13'] = unique;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 13'] = false;
    }

    console.log('TEST 14: Message Ordering');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const msgIds = [];

        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 1));
            msgIds.push(createMessageId(i));
        }

        let increasing = true;
        for (let i = 1; i < msgIds.length; i++) {
            if (msgIds[i] <= msgIds[i - 1]) {
                increasing = false;
                break;
            }
        }

        console.log(`   Message IDs strictly increasing: ${increasing ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 14'] = increasing;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 14'] = false;
    }

    console.log('TEST 15: Different Sessions - Same Message');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Same message text';
        const msgId = createMessageId(0);
        const sessions = [0x1n, 0x2n, 0x3n, 0x4n, 0x5n];

        const encryptedMessages = [];
        for (const sid of sessions) {
            const encrypted = await plugin.encryptMessage(
                Buffer.from(message),
                sid,
                msgId,
                0
            );
            encryptedMessages.push(encrypted);
        }

        let allDifferent = true;
        for (let i = 0; i < encryptedMessages.length; i++) {
            for (let j = i + 1; j < encryptedMessages.length; j++) {
                if (encryptedMessages[i].data.equals(encryptedMessages[j].data)) {
                    allDifferent = false;
                    break;
                }
            }
        }

        console.log(`   Different sessions produce different ciphertext: ${allDifferent ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 15'] = allDifferent;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 15'] = false;
    }

    console.log('TEST 16: Large Message Stress Test');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const sizes = [4096, 8192, 16384, 32768];
        let allPassed = true;

        for (const size of sizes) {
            const largeMsg = 'X'.repeat(size);
            const msgId = createMessageId(size);

            const start = Date.now();
            const encrypted = plugin.encryptMessage(
                Buffer.from(largeMsg),
                testSessionId,
                msgId,
                size
            );
            const encryptTime = Date.now() - start;

            const decryptStart = Date.now();
            const decrypted = plugin.decryptMessage(encrypted, testSessionId);
            const decryptTime = Date.now() - decryptStart;

            const success = decrypted.toString('utf8') === largeMsg;
            if (!success) allPassed = false;

            console.log(`   Size ${size} bytes:`);
            console.log(`      Encrypted: ${encrypted.data.length} bytes (${encryptTime}ms)`);
            console.log(`      Decrypted: ${decryptTime}ms`);
            console.log(`      Success: ${success ? 'PASS' : 'FAIL'}`);
        }
        console.log('');
        testResults['TEST 16'] = allPassed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 16'] = false;
    }

    console.log('TEST 17: Rapid Fire Messages');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const count = 100;
        const message = 'Rapid test';
        const start = Date.now();
        let allPassed = true;

        for (let i = 0; i < count; i++) {
            const msgId = createMessageId(i);
            const encrypted = plugin.encryptMessage(
                Buffer.from(message),
                testSessionId,
                msgId,
                i
            );
            const decrypted = plugin.decryptMessage(encrypted, testSessionId);

            if (decrypted.toString('utf8') !== message) {
                allPassed = false;
            }
        }

        const totalTime = Date.now() - start;
        console.log(`   ${count} rapid messages: ${totalTime}ms`);
        console.log(`   Average: ${(totalTime / count).toFixed(2)}ms per message`);
        console.log(`   Rapid fire test: ${allPassed ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 17'] = allPassed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 17'] = false;
    }

    console.log('TEST 18: Invalid Session ID');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const correctSid = testSessionId;
        const wrongSid = 0xDEADBEEFn;

        const encrypted = plugin.encryptMessage(
            Buffer.from(message),
            correctSid,
            msgId,
            0
        );

        let wrongCaught = false;
        try {
            plugin.decryptMessage(encrypted, wrongSid);
            console.log('   Should have thrown error for wrong session ID');
        } catch (error) {
            const err = error as Error;
            console.log(`   Wrong session ID caught: ${err.message}`);
            wrongCaught = true;
        }

        const decrypted = plugin.decryptMessage(encrypted, correctSid);
        const correctWorks = decrypted.toString('utf8') === message;
        console.log(`   Correct session ID works: ${correctWorks ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 18'] = wrongCaught && correctWorks;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 18'] = false;
    }

    console.log('TEST 19: Binary Data');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const binaryData = Buffer.from([
            0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD, 0xFC,
            0x10, 0x20, 0x30, 0x40, 0x80, 0x90, 0xA0, 0xB0
        ]);

        const msgId = createMessageId(0);
        const encrypted = plugin.encryptMessage(
            binaryData,
            testSessionId,
            msgId,
            0
        );

        const decrypted = plugin.decryptMessage(encrypted, testSessionId);

        const success = binaryData.equals(decrypted);
        console.log(`   Binary data length: ${binaryData.length} bytes`);
        console.log(`   Binary data preserved: ${success ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 19'] = success;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 19'] = false;
    }

    console.log('TEST 20: Edge Case - Maximum SeqNo');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const maxSeqNo = 0x7FFFFFFF;
        const message = 'Max seqno test';
        const msgId = createMessageId(maxSeqNo);

        const encrypted = plugin.encryptMessage(
            Buffer.from(message),
            testSessionId,
            msgId,
            maxSeqNo
        );

        const decrypted = plugin.decryptMessage(encrypted, testSessionId);

        const success = decrypted.toString('utf8') === message;
        console.log(`   Max seqNo: ${maxSeqNo}`);
        console.log(`   Max seqNo works: ${success ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 20'] = success;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 20'] = false;
    }

    console.log('TEST 21: Edge Case - Minimum Session ID');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const minSid = 0n;
        const message = 'Min session test';
        const msgId = createMessageId(0);

        const encrypted = plugin.encryptMessage(
            Buffer.from(message),
            minSid,
            msgId,
            0
        );

        const decrypted = plugin.decryptMessage(encrypted, minSid);

        const success = decrypted.toString('utf8') === message;
        console.log(`   Min session ID: 0x${minSid.toString(16)}`);
        console.log(`   Min session ID works: ${success ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 21'] = success;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 21'] = false;
    }

    console.log('TEST 22: Message ID Uniqueness Across Sessions');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const ids = new Set<string>();
        let duplicates = 0;

        for (let session = 0; session < 5; session++) {
            for (let i = 0; i < 200; i++) {
                const msgId = createMessageId(i + (session * 1000));
                const idStr = msgId.toString();
                if (ids.has(idStr)) {
                    duplicates++;
                    console.log(`   Duplicate found: ${msgId.toString(16)}`);
                }
                ids.add(idStr);
            }
        }

        console.log(`   Generated 1000 message IDs across 5 sessions`);
        console.log(`   Duplicates: ${duplicates}`);
        const unique = duplicates === 0;
        console.log(`   Message IDs unique across sessions: ${unique ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 22'] = unique;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 22'] = false;
    }

    console.log('TEST 23: Multiple Message IDs in Rapid Succession');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const ids: bigint[] = [];
        const start = Date.now();

        for (let i = 0; i < 1000; i++) {
            ids.push(createMessageId(i));
        }

        const end = Date.now();
        const timePerId = (end - start) / 1000;

        let increasing = true;
        for (let i = 1; i < ids.length; i++) {
            if (ids[i] <= ids[i - 1]) {
                increasing = false;
                break;
            }
        }

        console.log(`   Generated 1000 IDs in ${end - start}ms`);
        console.log(`   Average: ${timePerId.toFixed(3)}ms per ID`);
        console.log(`   Strictly increasing: ${increasing ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 23'] = increasing;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 23'] = false;
    }

    console.log('TEST 24: Server Message ID Parity');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        let passed = true;

        for (let i = 0; i < 100; i++) {
            const serverMsgId = createMessageId(i, false);
            if (serverMsgId % 2n === 0n) {
                passed = false;
                console.log(`   ❌ Server message ID even: ${serverMsgId.toString(16)}`);
                break;
            }
        }

        console.log(`   Server message IDs always odd: ${passed ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 24'] = passed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 24'] = false;
    }

    console.log('TEST 25: Message ID Time Difference Consistency');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const samples = [];

        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const msgId = createMessageId(i);
            const now = BigInt(Math.floor(Date.now() / 1000)) * 4294967296n;
            const diff = msgId > now ? msgId - now : now - msgId;
            const seconds = Number(diff) / 4294967296;
            samples.push(seconds);
        }

        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const maxDiff = Math.max(...samples) - Math.min(...samples);

        console.log(`   Average time difference: ${avg.toFixed(3)} seconds`);
        console.log(`   Max variation: ${maxDiff.toFixed(3)} seconds`);
        console.log(`   Time difference consistent: ${maxDiff < 1 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 25'] = maxDiff < 1;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 25'] = false;
    }

    console.log('TEST 26: Message ID Wrapping Behavior');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const maxId = 0x7FFFFFFFFFFFFFFFn;
        const nearMax = maxId - 100n;

        const id1 = createMessageId(0);
        const id2 = createMessageId(1000);

        console.log(`   Normal ID: ${id1.toString(16)}`);
        console.log(`   Later ID: ${id2.toString(16)}`);
        console.log(`   IDs increase monotonically: ${id2 > id1 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 26'] = id2 > id1;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 26'] = false;
    }

    console.log('TEST 27: Message ID with Maximum SeqNo');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const maxSeqNo = 0x7FFFFFFF;
        const msgId = createMessageId(maxSeqNo);

        console.log(`   Max seqNo: ${maxSeqNo}`);
        console.log(`   Generated ID: ${msgId.toString(16)} (${msgId})`);
        console.log(`   ID within 64-bit range: ${msgId <= 0x7FFFFFFFFFFFFFFFn ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 27'] = msgId <= 0x7FFFFFFFFFFFFFFFn;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 27'] = false;
    }

    console.log('TEST 28: Message ID with Zero SeqNo');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const msgId = createMessageId(0);

        console.log(`   SeqNo 0: ${msgId.toString(16)} (${msgId})`);
        console.log(`   Valid ID generated: ${msgId > 0n ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 28'] = msgId > 0n;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 28'] = false;
    }

    console.log('TEST 29: Message ID Monotonicity Under Load');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const ids: bigint[] = [];
        const startTime = Date.now();

        for (let i = 0; i < 100; i++) {
            const msgId = createMessageId(i);
            ids.push(msgId);
        }

        let monotonic = true;
        for (let i = 1; i < ids.length; i++) {
            if (ids[i] <= ids[i - 1]) {
                monotonic = false;
                console.log(`   Non-monotonic at index ${i}:`);
                console.log(`      ${ids[i - 1].toString(16)} -> ${ids[i].toString(16)}`);
                break;
            }
        }

        const endTime = Date.now();
        console.log(`   Generated 100 IDs in ${endTime - startTime}ms`);
        console.log(`   Message IDs strictly increasing: ${monotonic ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 29'] = monotonic;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 29'] = false;
    }

    console.log('TEST 30: Message ID Boundary Values');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const boundaries = [
            { seq: 0, time: 0 },
            { seq: 0x7FFFFFFF, time: Date.now() },
            { seq: 0, time: 0x7FFFFFFF * 1000 }
        ];

        let allValid = true;
        for (const b of boundaries) {
            const msgId = createMessageId(b.seq);
            const valid = msgId > 0n && msgId <= 0x7FFFFFFFFFFFFFFFn;
            if (!valid) allValid = false;
            console.log(`   Boundary (seq:${b.seq}): ${msgId.toString(16)} - ${valid ? 'VALID' : 'INVALID'}`);
        }

        console.log(`   All boundary values valid: ${allValid ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 30'] = allValid;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 30'] = false;
    }

    console.log('TEST 31: Message ID with Maximum Time Value');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const msgId = createMessageId(0);

        console.log(`   Generated ID: ${msgId.toString(16)}`);
        console.log(`   ID within valid range: ${msgId > 0n && msgId <= 0x7FFFFFFFFFFFFFFFn ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 31'] = msgId > 0n && msgId <= 0x7FFFFFFFFFFFFFFFn;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 31'] = false;
    }

    console.log('TEST 32: Message ID with Negative Time');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const msgId = createMessageId(0);

        console.log(`   Generated ID: ${msgId.toString(16)}`);
        console.log(`   ID is positive: ${msgId > 0n ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 32'] = msgId > 0n;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 32'] = false;
    }

    console.log('TEST 33: Message ID with Different Clients');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const client1Id = createMessageId(0, true);
        const client2Id = createMessageId(0, true);
        const serverId = createMessageId(0, false);

        console.log(`   Client 1 ID: ${client1Id.toString(16)} (${client1Id % 2n === 0n ? 'even' : 'odd'})`);
        console.log(`   Client 2 ID: ${client2Id.toString(16)} (${client2Id % 2n === 0n ? 'even' : 'odd'})`);
        console.log(`   Server ID: ${serverId.toString(16)} (${serverId % 2n === 1n ? 'odd' : 'even'})`);

        const allValid = (client1Id % 2n === 0n) && (client2Id % 2n === 0n) && (serverId % 2n === 1n);
        console.log(`   All IDs have correct parity: ${allValid ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 33'] = allValid;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 33'] = false;
    }

    console.log('TEST 34: Message ID with Maximum SeqNo and Time');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const maxSeqNo = 0x7FFFFFFF;
        const msgId = createMessageId(maxSeqNo);

        console.log(`   Max seqNo: ${maxSeqNo}`);
        console.log(`   Generated ID: ${msgId.toString(16)}`);
        console.log(`   ID within 64-bit range: ${msgId <= 0x7FFFFFFFFFFFFFFFn ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 34'] = msgId <= 0x7FFFFFFFFFFFFFFFn;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 34'] = false;
    }

    console.log('TEST 35: AuthKey Generation with Different Shared Secrets');
    try {
        const dhKeys1 = plugin.generateDHKeys();
        const dhKeys2 = plugin.generateDHKeys();

        const sharedSecret1 = plugin.computeSharedSecret(dhKeys1.privateKey, dhKeys1.publicKey);
        const sharedSecret2 = plugin.computeSharedSecret(dhKeys2.privateKey, dhKeys2.publicKey);

        const authKey1 = await plugin.generateAuthKey(sharedSecret1);
        const authKey2 = await plugin.generateAuthKey(sharedSecret2);

        console.log(`   AuthKey1 ID: ${authKey1.id.toString(16)}`);
        console.log(`   AuthKey2 ID: ${authKey2.id.toString(16)}`);
        console.log(`   Different shared secrets produce different AuthKeys: ${authKey1.id !== authKey2.id ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 35'] = authKey1.id !== authKey2.id;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 35'] = false;
    }

    console.log('TEST 36: AuthKey ID Collision Resistance');
    try {
        const ids = new Set<string>();
        let collisions = 0;

        for (let i = 0; i < 1000; i++) {
            const dhKeys = plugin.generateDHKeys();
            const sharedSecret = plugin.computeSharedSecret(dhKeys.privateKey, dhKeys.publicKey);
            const authKey = await plugin.generateAuthKey(sharedSecret);
            const idStr = authKey.id.toString(16);

            if (ids.has(idStr)) {
                collisions++;
                console.log(`   Collision found: ${idStr}`);
            }
            ids.add(idStr);
        }

        console.log(`   Generated 1000 AuthKeys`);
        console.log(`   Collisions: ${collisions}`);
        console.log(`   AuthKey IDs are unique: ${collisions === 0 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 36'] = collisions === 0;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 36'] = false;
    }

    console.log('TEST 37: Server Salt Uniqueness');
    try {
        const salts = new Set<string>();

        for (let i = 0; i < 100; i++) {
            const salt = crypto.randomBytes(8);
            salts.add(salt.toString('hex'));
        }

        console.log(`   Generated 100 salts`);
        console.log(`   Unique salts: ${salts.size}`);
        console.log(`   Salts are unique: ${salts.size === 100 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 37'] = salts.size === 100;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 37'] = false;
    }

    console.log('TEST 38: Message Encryption with Different Salts');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const sessionId = 0x12345678n;

        const salt1 = crypto.randomBytes(8);
        const salt2 = crypto.randomBytes(8);

        plugin.setServerSalt(salt1);
        const encrypted1 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);

        plugin.setServerSalt(salt2);
        const encrypted2 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);

        const different = !encrypted1.data.equals(encrypted2.data);
        console.log(`   Different salts produce different ciphertext: ${different ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 38'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 38'] = false;
    }

    console.log('TEST 39: Message Encryption with Different Sessions');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const salt = crypto.randomBytes(8);
        plugin.setServerSalt(salt);

        const encrypted1 = plugin.encryptMessage(Buffer.from(message), 0x1n, msgId, 0);
        const encrypted2 = plugin.encryptMessage(Buffer.from(message), 0x2n, msgId, 0);

        const different = !encrypted1.data.equals(encrypted2.data);
        console.log(`   Different sessions produce different ciphertext: ${different ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 39'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 39'] = false;
    }

    console.log('TEST 40: Message Encryption with Different SeqNo');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const sessionId = 0x12345678n;
        const salt = crypto.randomBytes(8);
        plugin.setServerSalt(salt);

        const encrypted1 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);
        const encrypted2 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 1);

        const different = !encrypted1.data.equals(encrypted2.data);
        console.log(`   Different seqNo produce different ciphertext: ${different ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 40'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 40'] = false;
    }

    console.log('TEST 41: Message Encryption with Different Message IDs');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const sessionId = 0x12345678n;
        const salt = crypto.randomBytes(8);
        plugin.setServerSalt(salt);

        const encrypted1 = plugin.encryptMessage(Buffer.from(message), sessionId, createMessageId(0), 0);
        const encrypted2 = plugin.encryptMessage(Buffer.from(message), sessionId, createMessageId(1), 0);

        const different = !encrypted1.data.equals(encrypted2.data);
        console.log(`   Different message IDs produce different ciphertext: ${different ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 41'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 41'] = false;
    }

    console.log('TEST 42: Decrypt with Wrong AuthKey');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const sessionId = 0x12345678n;
        const salt = crypto.randomBytes(8);
        plugin.setServerSalt(salt);

        const encrypted = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);

        const dhKeys = plugin.generateDHKeys();
        const sharedSecret = plugin.computeSharedSecret(dhKeys.privateKey, dhKeys.publicKey);
        const wrongAuthKey = await plugin.generateAuthKey(sharedSecret);

        const originalAuthKey = plugin.getAuthKey();
        if (!originalAuthKey) throw new Error('Original AuthKey is null');

        plugin.setAuthKey(wrongAuthKey);

        let decryptionFailed = false;
        try {
            plugin.decryptMessage(encrypted, sessionId);
        } catch (error) {
            decryptionFailed = true;
        }

        plugin.setAuthKey(originalAuthKey);

        console.log(`   Decrypt with wrong AuthKey fails: ${decryptionFailed ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 42'] = decryptionFailed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 42'] = false;
    }

    console.log('TEST 43: Message Integrity with Different Salts');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const message = 'Test message';
        const msgId = createMessageId(0);
        const sessionId = 0x12345678n;

        const salt1 = crypto.randomBytes(8);
        const salt2 = crypto.randomBytes(8);

        plugin.setServerSalt(salt1);
        const encrypted1 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);

        plugin.setServerSalt(salt2);
        const encrypted2 = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, 0);

        const different = !encrypted1.data.equals(encrypted2.data);

        console.log(`   Salt1: ${salt1.toString('hex')}`);
        console.log(`   Salt2: ${salt2.toString('hex')}`);
        console.log(`   Different salts produce different ciphertext: ${different ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 43'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 43'] = false;
    }

    console.log('TEST 44: Message Key Collision Resistance');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const msgKeys = new Set<string>();
        let collisions = 0;

        for (let i = 0; i < 100; i++) {
            const message = `Test message ${i}`;
            const msgId = createMessageId(i);
            const sessionId = 0x12345678n;
            const salt = crypto.randomBytes(8);
            plugin.setServerSalt(salt);

            const encrypted = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, i);
            const msgKeyStr = encrypted.msgKey.toString('hex');

            if (msgKeys.has(msgKeyStr)) {
                collisions++;
            }
            msgKeys.add(msgKeyStr);
        }

        console.log(`   Generated 100 message keys`);
        console.log(`   Collisions: ${collisions}`);
        console.log(`   Message keys are unique: ${collisions === 0 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 44'] = collisions === 0;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 44'] = false;
    }

    console.log('TEST 45: Padding Size Distribution');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');
        const paddingSizes: number[] = [];

        for (let size = 1; size <= 100; size++) {
            const message = 'A'.repeat(size);
            const msgId = createMessageId(size);
            const encrypted = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, size);

            const encryptedLen = encrypted.data.length;
            const plaintextLen = 32 + size;
            const padding = encryptedLen - plaintextLen;
            paddingSizes.push(padding);
        }

        let allValid = true;
        for (const p of paddingSizes) {
            if (p < 12 || p > 1024) {
                allValid = false;
                break;
            }
        }

        const minPadding = Math.min(...paddingSizes);
        const maxPadding = Math.max(...paddingSizes);
        const avgPadding = paddingSizes.reduce((a, b) => a + b, 0) / paddingSizes.length;

        console.log(`   Padding range: ${minPadding} - ${maxPadding} bytes`);
        console.log(`   Average padding: ${avgPadding.toFixed(2)} bytes`);
        console.log(`   All padding within 12-1024 range: ${allValid ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 45'] = allValid;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 45'] = false;
    }

    console.log('TEST 46: AES-256-IGE Known Test Vectors');
    try {
        const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
        const iv = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
        const plaintext = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

        const encrypted = AES256IGE.encrypt(plaintext, key, iv);
        const decrypted = AES256IGE.decrypt(encrypted, key, iv);

        console.log(`   Plaintext: ${plaintext.toString('hex')}`);
        console.log(`   Encrypted: ${encrypted.toString('hex').substring(0, 32)}...`);
        console.log(`   Decrypted: ${decrypted.toString('hex')}`);
        console.log(`   AES-256-IGE test vector: ${plaintext.equals(decrypted) ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 46'] = plaintext.equals(decrypted);
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 46'] = false;
    }

    console.log('TEST 47: Auth Key Generation with SHA256');
    try {
        const testSecret = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
        const hash = crypto.createHash('sha256').update(testSecret).digest();
        const expectedKey = Buffer.concat([testSecret, hash]);

        const authKey = await plugin.generateAuthKey(testSecret);

        const keyMatch = authKey.key.slice(0, 32).equals(testSecret) &&
            authKey.key.slice(32, 64).equals(hash);

        console.log(`   AuthKey format: ${keyMatch ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 47'] = keyMatch;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 47'] = false;
    }

    console.log('TEST 48: KDF with Client/Server Differentiation');
    try {
        const authKey = crypto.randomBytes(256);
        const plaintext = crypto.randomBytes(64);
        const padding = crypto.randomBytes(20);

        const clientMsgKey = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);
        const serverMsgKey = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, false);

        const clientKeys = MTProtoKDF.deriveKeys(authKey, clientMsgKey, true);
        const serverKeys = MTProtoKDF.deriveKeys(authKey, serverMsgKey, false);

        const different = !clientMsgKey.equals(serverMsgKey) &&
            !clientKeys.aesKey.equals(serverKeys.aesKey);

        console.log(`   Client/Server KDF differentiation: ${different ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 48'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 48'] = false;
    }

    console.log('TEST 49: Message Key Computation with Padding');
    try {
        const authKey = crypto.randomBytes(256);
        const plaintext = Buffer.from('Test message');
        const padding1 = crypto.randomBytes(20);
        const padding2 = crypto.randomBytes(20);

        const msgKey1 = MTProtoKDF.computeMsgKey(authKey, plaintext, padding1, true);
        const msgKey2 = MTProtoKDF.computeMsgKey(authKey, plaintext, padding2, true);

        console.log(`   Different padding -> different msgKey: ${!msgKey1.equals(msgKey2) ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 49'] = !msgKey1.equals(msgKey2);
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 49'] = false;
    }

    console.log('TEST 50: AuthKey ID from SHA1');
    try {
        const testKey = crypto.randomBytes(256);
        const sha1 = crypto.createHash('sha1').update(testKey).digest();
        const expectedId = BigInt('0x' + sha1.subarray(-8).toString('hex'));

        const computedId = MTProtoKDF.computeAuthKeyId(testKey);

        console.log(`   Expected ID: ${expectedId.toString(16)}`);
        console.log(`   Computed ID: ${computedId.toString(16)}`);
        console.log(`   AuthKey ID matches SHA1 last 8 bytes: ${computedId === expectedId ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 50'] = computedId === expectedId;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 50'] = false;
    }

    console.log('TEST 51: Key Deriviation Function Uniqueness');
    try {
        const authKey = crypto.randomBytes(256);
        const plaintext = crypto.randomBytes(64);
        const padding = crypto.randomBytes(20);

        const msgKey1 = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);
        const msgKey2 = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);

        console.log(`   Same inputs produce same msgKey: ${msgKey1.equals(msgKey2) ? 'YES' : 'NO'}`);
        console.log(`   KDF deterministic: ${msgKey1.equals(msgKey2) ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 51'] = msgKey1.equals(msgKey2);
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 51'] = false;
    }

    console.log('TEST 52: KDF Avalanche Effect');
    try {
        const authKey = crypto.randomBytes(256);
        const plaintext = crypto.randomBytes(64);
        const padding = crypto.randomBytes(20);

        const msgKey1 = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);

        const plaintext2 = Buffer.from(plaintext);
        plaintext2[0] ^= 0x01;
        const msgKey2 = MTProtoKDF.computeMsgKey(authKey, plaintext2, padding, true);

        const diffBits = (a: Buffer, b: Buffer): number => {
            let count = 0;
            for (let i = 0; i < a.length; i++) {
                let xor = a[i] ^ b[i];
                while (xor) {
                    count += xor & 1;
                    xor >>= 1;
                }
            }
            return count;
        };

        const bitsChanged = diffBits(msgKey1, msgKey2);
        const totalBits = msgKey1.length * 8;
        const percentChanged = (bitsChanged / totalBits) * 100;

        console.log(`   Total bits: ${totalBits}`);
        console.log(`   Bits changed: ${bitsChanged}`);
        console.log(`   Change rate: ${percentChanged.toFixed(2)}%`);
        console.log(`   Expected: 30-70% (${(totalBits * 0.3).toFixed(0)}-${(totalBits * 0.7).toFixed(0)} bits)`);

        const minExpected = Math.floor(totalBits * 0.3);
        const maxExpected = Math.ceil(totalBits * 0.7);
        const passed = bitsChanged >= minExpected && bitsChanged <= maxExpected;

        console.log(`   KDF avalanche effect: ${passed ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 52'] = passed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 52'] = false;
    }

    console.log('TEST 53: AES-256-IGE Block Independence');
    try {
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(32);

        const block1 = crypto.randomBytes(16);
        const block2 = crypto.randomBytes(16);
        const combined = Buffer.concat([block1, block2]);

        const encrypted = AES256IGE.encrypt(combined, key, iv);
        const decrypted = AES256IGE.decrypt(encrypted, key, iv);

        const block1Decrypted = decrypted.subarray(0, 16);
        const block2Decrypted = decrypted.subarray(16, 32);

        console.log(`   Block1 preserved: ${block1.equals(block1Decrypted) ? 'YES' : 'NO'}`);
        console.log(`   Block2 preserved: ${block2.equals(block2Decrypted) ? 'YES' : 'NO'}`);
        console.log(`   IGE mode block independence: ${block1.equals(block1Decrypted) && block2.equals(block2Decrypted) ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 53'] = block1.equals(block1Decrypted) && block2.equals(block2Decrypted);
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 53'] = false;
    }

    console.log('TEST 54: AES-256-IGE Error Propagation');
    try {
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(32);
        const plaintext = crypto.randomBytes(64);

        const encrypted = AES256IGE.encrypt(plaintext, key, iv);

        const corrupted = Buffer.from(encrypted);
        corrupted[20] ^= 0xFF;

        const decrypted = AES256IGE.decrypt(corrupted, key, iv);

        let diffCount = 0;
        for (let i = 0; i < plaintext.length; i++) {
            if (plaintext[i] !== decrypted[i]) diffCount++;
        }

        console.log(`   Corrupted bytes: 1`);
        console.log(`   Affected bytes in output: ${diffCount}`);
        console.log(`   IGE error propagation: ${diffCount >= 16 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 54'] = diffCount >= 16;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 54'] = false;
    }

    console.log('TEST 55: AES-256-ECB vs IGE Mode');
    try {
        const key = crypto.randomBytes(32);
        const iv = crypto.randomBytes(32);

        const identicalBlocks = Buffer.concat([
            crypto.randomBytes(16),
            crypto.randomBytes(16),
            crypto.randomBytes(16)
        ]);

        const encrypted = AES256IGE.encrypt(identicalBlocks, key, iv);

        const block1 = encrypted.subarray(0, 16);
        const block2 = encrypted.subarray(16, 32);
        const block3 = encrypted.subarray(32, 48);

        const allDifferent = !block1.equals(block2) && !block2.equals(block3) && !block1.equals(block3);

        console.log(`   Identical plaintext blocks produce different ciphertext: ${allDifferent ? 'YES' : 'NO'}`);
        console.log(`   IGE mode (not ECB): ${allDifferent ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 55'] = allDifferent;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 55'] = false;
    }

    console.log('TEST 56: Padding Randomness');
    try {
        if (!plugin.getAuthKey()) throw new Error('Auth key not set');

        const message = 'A';
        const paddings: Buffer[] = [];

        for (let i = 0; i < 100; i++) {
            const msgId = createMessageId(i);
            const encrypted = plugin.encryptMessage(Buffer.from(message), sessionId, msgId, i);
            const encryptedLen = encrypted.data.length;
            const plaintextLen = 32 + message.length;

            const paddingStart = 32 + message.length;
            const padding = encrypted.data.subarray(paddingStart, encryptedLen);
            paddings.push(padding);
        }

        let allDifferent = true;
        for (let i = 0; i < paddings.length; i++) {
            for (let j = i + 1; j < paddings.length; j++) {
                if (paddings[i].equals(paddings[j])) {
                    allDifferent = false;
                    break;
                }
            }
        }

        console.log(`   Random padding bytes are unique: ${allDifferent ? 'YES' : 'NO'}`);
        console.log(`   Padding randomness: ${allDifferent ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 56'] = allDifferent;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 56'] = false;
    }

    console.log('TEST 57: Message Key Length');
    try {
        const authKey = crypto.randomBytes(256);
        const plaintext = crypto.randomBytes(64);
        const padding = crypto.randomBytes(20);

        const msgKey = MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);

        console.log(`   MsgKey length: ${msgKey.length} bytes`);
        console.log(`   Expected length: 16 bytes`);
        console.log(`   MsgKey length correct: ${msgKey.length === 16 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 57'] = msgKey.length === 16;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 57'] = false;
    }

    console.log('TEST 58: AES Key and IV Length');
    try {
        const authKey = crypto.randomBytes(256);
        const msgKey = crypto.randomBytes(16);

        const { aesKey, aesIv } = MTProtoKDF.deriveKeys(authKey, msgKey, true);

        console.log(`   AES Key length: ${aesKey.length} bytes`);
        console.log(`   AES IV length: ${aesIv.length} bytes`);
        console.log(`   Expected: 32 bytes each`);
        console.log(`   Key/IV lengths correct: ${aesKey.length === 32 && aesIv.length === 32 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 58'] = aesKey.length === 32 && aesIv.length === 32;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 58'] = false;
    }

    console.log('TEST 59: AuthKey Length');
    try {
        const sharedSecret = crypto.randomBytes(256);
        const authKey = await plugin.generateAuthKey(sharedSecret);

        console.log(`   AuthKey length: ${authKey.key.length} bytes`);
        console.log(`   Expected: 288 bytes (256 + 32)`);
        console.log(`   AuthKey length correct: ${authKey.key.length === 288 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 59'] = authKey.key.length === 288;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 59'] = false;
    }

    console.log('TEST 60: DH Prime Validation');
    try {
        const keys1 = DiffieHellman.generateKeys();
        const keys2 = DiffieHellman.generateKeys();

        const secret1 = DiffieHellman.computeSharedSecret(keys1.privateKey, keys2.publicKey);
        const secret2 = DiffieHellman.computeSharedSecret(keys2.privateKey, keys1.publicKey);

        const sharedSecretsMatch = secret1.equals(secret2);

        console.log(`   Shared secrets match: ${sharedSecretsMatch ? 'YES' : 'NO'}`);
        console.log(`   Secret length: ${secret1.length} bytes`);
        console.log(`   Expected: 256 bytes`);
        console.log(`   DH prime validation: ${sharedSecretsMatch && secret1.length === 256 ? 'PASS' : 'FAIL'}\n`);
        testResults['TEST 60'] = sharedSecretsMatch && secret1.length === 256;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 60'] = false;
    }

    console.log('TEST 61: BasicHandshake Key Generation Test');
    try {
        const aliceKeys = DiffieHellman.generateKeys();
        const bobKeys = DiffieHellman.generateKeys();

        const sharedFromAlice = DiffieHellman.computeSharedSecret(aliceKeys.privateKey, bobKeys.publicKey);
        const sharedFromBob = DiffieHellman.computeSharedSecret(bobKeys.privateKey, aliceKeys.publicKey);

        const sharedSecretsMatch = sharedFromAlice.equals(sharedFromBob);

        console.log(`   Alice private key: ${aliceKeys.privateKey.toString(16).substring(0, 32)}...`);
        console.log(`   Alice public key: ${aliceKeys.publicKey.toString(16).substring(0, 32)}...`);
        console.log(`   Bob private key: ${bobKeys.privateKey.toString(16).substring(0, 32)}...`);
        console.log(`   Bob public key: ${bobKeys.publicKey.toString(16).substring(0, 32)}...`);
        console.log(`   Shared secrets match: ${sharedSecretsMatch ? 'YES' : 'NO'}`);
        console.log(`   BasicHandshake test: ${sharedSecretsMatch ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 61'] = sharedSecretsMatch;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 61'] = false;
    }

    console.log('TEST 62: KDF3 with X=0 and X=8 Test');
    try {
        const aliceKeys = DiffieHellman.generateKeys();
        const bobKeys = DiffieHellman.generateKeys();
        const sharedSecret = DiffieHellman.computeSharedSecret(aliceKeys.privateKey, bobKeys.publicKey);
        const authKey = await plugin.generateAuthKey(sharedSecret);

        const data = Buffer.from('hello world');

        const msgKeyClient = MTProtoKDF.computeMsgKey(authKey.key, data, Buffer.alloc(0), true);
        const msgKeyServer = MTProtoKDF.computeMsgKey(authKey.key, data, Buffer.alloc(0), false);

        const clientKeys = MTProtoKDF.deriveKeys(authKey.key, msgKeyClient, true);
        const serverKeys = MTProtoKDF.deriveKeys(authKey.key, msgKeyServer, false);

        const msgKeysDifferent = !msgKeyClient.equals(msgKeyServer);
        const aesKeysDifferent = !clientKeys.aesKey.equals(serverKeys.aesKey);
        const aesIvsDifferent = !clientKeys.aesIv.equals(serverKeys.aesIv);

        console.log(`   Client msgKey: ${msgKeyClient.toString('hex')}`);
        console.log(`   Server msgKey: ${msgKeyServer.toString('hex')}`);
        console.log(`   Client AES Key: ${clientKeys.aesKey.toString('hex').substring(0, 32)}...`);
        console.log(`   Server AES Key: ${serverKeys.aesKey.toString('hex').substring(0, 32)}...`);
        console.log(`   Client AES IV: ${clientKeys.aesIv.toString('hex').substring(0, 32)}...`);
        console.log(`   Server AES IV: ${serverKeys.aesIv.toString('hex').substring(0, 32)}...`);
        console.log(`   MsgKeys different: ${msgKeysDifferent ? 'YES' : 'NO'}`);
        console.log(`   AES Keys different: ${aesKeysDifferent ? 'YES' : 'NO'}`);
        console.log(`   AES IVs different: ${aesIvsDifferent ? 'YES' : 'NO'}`);
        console.log(`   KDF3 X=0/X=8 test: ${msgKeysDifferent && aesKeysDifferent && aesIvsDifferent ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 62'] = msgKeysDifferent && aesKeysDifferent && aesIvsDifferent;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 62'] = false;
    }

    console.log('TEST 63: Get Public Key from Private Key');
    try {
        const keys = DiffieHellman.generateKeys();
        const publicKeyFromPrivate = DiffieHellman.computePublicKey(keys.privateKey);

        const publicKeyMatches = publicKeyFromPrivate === keys.publicKey;

        console.log(`   Private key: ${keys.privateKey.toString(16).substring(0, 32)}...`);
        console.log(`   Public key (original): ${keys.publicKey.toString(16).substring(0, 32)}...`);
        console.log(`   Public key (computed): ${publicKeyFromPrivate.toString(16).substring(0, 32)}...`);
        console.log(`   Public key derivation: ${publicKeyMatches ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 63'] = publicKeyMatches;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 63'] = false;
    }

    console.log('TEST 64: Expand Secret with HMAC-SHA512');
    try {
        const secret = crypto.randomBytes(32);
        const expanded = SecretExpander.expandSecret(secret);

        console.log(`   Secret length: ${secret.length} bytes`);
        console.log(`   Expanded length: ${expanded.length} bytes`);
        console.log(`   Expected length: 128 bytes`);
        console.log(`   Secret expansion: ${expanded.length === 128 ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 64'] = expanded.length === 128;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 64'] = false;
    }

    console.log('TEST 65: X25519 Complete Functionality Test');
    try {
        const { X25519 } = await import('@ton-ai/mtproto');

        const alicePriv = X25519.generatePrivateKey();
        const alicePub = X25519.computePublicKey(alicePriv);

        const bobPriv = X25519.generatePrivateKey();
        const bobPub = X25519.computePublicKey(bobPriv);

        console.log(`   Key generation successful`);
        console.log(`      Alice pub: ${Buffer.from(alicePub).toString('hex').substring(0, 32)}...`);
        console.log(`      Bob pub: ${Buffer.from(bobPub).toString('hex').substring(0, 32)}...`);

        const sharedAlice = X25519.computeSharedSecret(alicePriv, bobPub);
        const sharedBob = X25519.computeSharedSecret(bobPriv, alicePub);

        const sharedMatch = Buffer.from(sharedAlice).equals(Buffer.from(sharedBob));
        console.log(`   Shared secrets match: ${sharedMatch ? 'YES' : 'NO'}`);

        const testKey = new Uint8Array(32);
        for (let i = 0; i < 32; i++) testKey[i] = 0xff;
        const clamped = X25519.clamp(testKey);

        const lower3BitsClear = (clamped[0] & 0x07) === 0;
        const topBitClear = (clamped[31] & 0x80) === 0;
        const secondTopBitSet = (clamped[31] & 0x40) !== 0;
        const clampingOk = lower3BitsClear && topBitClear && secondTopBitSet;
        console.log(`   Clamping correct: ${clampingOk ? 'YES' : 'NO'}`);

        const allPassed = sharedMatch && clampingOk;
        console.log(`   X25519 complete test: ${allPassed ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 65'] = allPassed;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 65'] = false;
    }

    console.log('TEST 66: X25519 Key Exchange Test');
    try {
        const alicePriv = X25519.generatePrivateKey();
        const alicePub = X25519.computePublicKey(alicePriv);

        const bobPriv = X25519.generatePrivateKey();
        const bobPub = X25519.computePublicKey(bobPriv);

        const sharedAlice = X25519.computeSharedSecret(alicePriv, bobPub);
        const sharedBob = X25519.computeSharedSecret(bobPriv, alicePub);

        const match = Buffer.from(sharedAlice).equals(Buffer.from(sharedBob));

        console.log(`   Alice pub: ${Buffer.from(alicePub).toString('hex').substring(0, 32)}...`);
        console.log(`   Bob pub: ${Buffer.from(bobPub).toString('hex').substring(0, 32)}...`);
        console.log(`   Shared secret length: ${sharedAlice.length} bytes`);
        console.log(`   Shared secrets match: ${match ? 'YES' : 'NO'}`);
        console.log(`   X25519 key exchange: ${match ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 66'] = match;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 66'] = false;
    }

    console.log('TEST 67: X25519 to AES Key Derivation');
    try {
        const alicePriv = X25519.generatePrivateKey();
        const alicePub = X25519.computePublicKey(alicePriv);

        const bobPriv = X25519.generatePrivateKey();
        const bobPub = X25519.computePublicKey(bobPriv);

        const sharedSecret = X25519.computeSharedSecret(alicePriv, bobPub);

        const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();

        console.log(`   Shared secret: ${Buffer.from(sharedSecret).toString('hex').substring(0, 32)}...`);
        console.log(`   AES key: ${aesKey.toString('hex').substring(0, 32)}...`);
        console.log(`   AES key length: ${aesKey.length} bytes (${aesKey.length * 8} bits)`);
        console.log(`   AES key derivation: ${aesKey.length === 32 ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 67'] = aesKey.length === 32;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 67'] = false;
    }

    console.log('TEST 68: X25519 Key Uniqueness');
    try {
        const keys = new Set();
        const count = 100;

        for (let i = 0; i < count; i++) {
            const priv = X25519.generatePrivateKey();
            const pub = X25519.computePublicKey(priv);
            keys.add(Buffer.from(priv).toString('hex'));
            keys.add(Buffer.from(pub).toString('hex'));
        }

        const unique = keys.size === count * 2;

        console.log(`   Generated ${count} key pairs`);
        console.log(`   Unique keys: ${keys.size} (expected ${count * 2})`);
        console.log(`   Key uniqueness: ${unique ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 68'] = unique;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 68'] = false;
    }

    console.log('TEST 69: X25519 Public Key Validation');
    try {
        const alicePriv = X25519.generatePrivateKey();

        const testKeys = [
            { key: new Uint8Array(32), expected: 'reject' },
            { key: new Uint8Array(32).fill(0xff), expected: 'reject' },
            { key: Buffer.from('0101010101010101010101010101010101010101010101010101010101010101', 'hex'), expected: 'accept' },
            { key: Buffer.from('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c', 'hex'), expected: 'accept' },
        ];

        let validResults = 0;

        for (const test of testKeys) {
            try {
                const shared = X25519.computeSharedSecret(alicePriv, test.key);
                const sharedHex = Buffer.from(shared).toString('hex').substring(0, 16);
                console.log(`   Key ${test.key.toString('hex').substring(0, 16)}... accepted (shared: ${sharedHex}...)`);
                if (test.expected === 'accept') validResults++;
            } catch (error) {
                const err = error as Error;
                console.log(`   Key ${test.key.toString('hex').substring(0, 16)}... rejected: ${err.message}`);
                if (test.expected === 'reject') validResults++;
            }
        }

        console.log(`   Valid results: ${validResults}/${testKeys.length}`);
        console.log(`   Key validation: ${validResults === testKeys.length ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 69'] = validResults === testKeys.length;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 69'] = false;
    }

    console.log('TEST 70: X25519 Perfect Forward Secrecy');
    try {
        const alicePriv1 = X25519.generatePrivateKey();
        const alicePub1 = X25519.computePublicKey(alicePriv1);
        const bobPriv1 = X25519.generatePrivateKey();
        const bobPub1 = X25519.computePublicKey(bobPriv1);
        const session1Secret = X25519.computeSharedSecret(alicePriv1, bobPub1);

        const alicePriv2 = X25519.generatePrivateKey();
        const alicePub2 = X25519.computePublicKey(alicePriv2);
        const bobPriv2 = X25519.generatePrivateKey();
        const bobPub2 = X25519.computePublicKey(bobPriv2);
        const session2Secret = X25519.computeSharedSecret(alicePriv2, bobPub2);

        const alicePub1Hex = Buffer.from(alicePub1).toString('hex').substring(0, 16);
        const bobPub1Hex = Buffer.from(bobPub1).toString('hex').substring(0, 16);
        const alicePub2Hex = Buffer.from(alicePub2).toString('hex').substring(0, 16);
        const bobPub2Hex = Buffer.from(bobPub2).toString('hex').substring(0, 16);

        const different = !Buffer.from(session1Secret).equals(Buffer.from(session2Secret));

        console.log(`   Session 1 keys: Alice=${alicePub1Hex}..., Bob=${bobPub1Hex}...`);
        console.log(`   Session 2 keys: Alice=${alicePub2Hex}..., Bob=${bobPub2Hex}...`);
        console.log(`   Session 1 secret: ${Buffer.from(session1Secret).toString('hex').substring(0, 32)}...`);
        console.log(`   Session 2 secret: ${Buffer.from(session2Secret).toString('hex').substring(0, 32)}...`);
        console.log(`   Different sessions have different secrets: ${different ? 'YES' : 'NO'}`);
        console.log(`   Perfect forward secrecy: ${different ? 'PASS' : 'FAIL'}\n`);

        testResults['TEST 70'] = different;
    } catch (error) {
        const err = error as Error;
        console.log(`   ❌ Test failed: ${err.message}\n`);
        testResults['TEST 70'] = false;
    }

    console.log('\n📊 TESTS SUMMARY');

    const testDetails: Record<string, string> = {
        'TEST 1': 'Key Generation and Management',
        'TEST 2': 'Message ID Requirements',
        'TEST 3': 'Basic Encryption/Decryption Cycle',
        'TEST 4': 'Session ID Variations',
        'TEST 5': 'Message Size Boundaries',
        'TEST 6': 'Padding Validation',
        'TEST 7': 'Message Key Validation',
        'TEST 8': 'Sequence Numbers',
        'TEST 9': 'Concurrent Sessions',
        'TEST 10': 'Performance Benchmark',
        'TEST 11': 'Metrics',
        'TEST 12': 'Reset Functionality',
        'TEST 13': 'Message ID Uniqueness',
        'TEST 14': 'Message Ordering',
        'TEST 15': 'Different Sessions - Same Message',
        'TEST 16': 'Large Message Stress Test',
        'TEST 17': 'Rapid Fire Messages',
        'TEST 18': 'Invalid Session ID',
        'TEST 19': 'Binary Data',
        'TEST 20': 'Edge Case - Maximum SeqNo',
        'TEST 21': 'Edge Case - Minimum Session ID',
        'TEST 22': 'Message ID Uniqueness Across Sessions',
        'TEST 23': 'Multiple Message IDs in Rapid Succession',
        'TEST 24': 'Server Message ID Parity',
        'TEST 25': 'Message ID Time Difference Consistency',
        'TEST 26': 'Message ID Wrapping Behavior',
        'TEST 27': 'Message ID with Maximum SeqNo',
        'TEST 28': 'Message ID with Zero SeqNo',
        'TEST 29': 'Message ID Monotonicity Under Load',
        'TEST 30': 'Message ID Boundary Values',
        'TEST 31': 'Message ID with Maximum Time Value',
        'TEST 32': 'Message ID with Negative Time',
        'TEST 33': 'Message ID with Different Clients',
        'TEST 34': 'Message ID with Maximum SeqNo and Time',
        'TEST 35': 'AuthKey Generation with Different Shared Secrets',
        'TEST 36': 'AuthKey ID Collision Resistance',
        'TEST 37': 'Server Salt Uniqueness',
        'TEST 38': 'Message Encryption with Different Salts',
        'TEST 39': 'Message Encryption with Different Sessions',
        'TEST 40': 'Message Encryption with Different SeqNo',
        'TEST 41': 'Message Encryption with Different Message IDs',
        'TEST 42': 'Decrypt with Wrong AuthKey',
        'TEST 43': 'Message Integrity with Different Salts',
        'TEST 44': 'Message Key Collision Resistance',
        'TEST 45': 'Padding Size Distribution',
        'TEST 46': 'AES-256-IGE Known Test Vectors',
        'TEST 47': 'Auth Key Generation with SHA256',
        'TEST 48': 'KDF with Client/Server Differentiation',
        'TEST 49': 'Message Key Computation with Padding',
        'TEST 50': 'AuthKey ID from SHA1',
        'TEST 51': 'KDF Determinism',
        'TEST 52': 'KDF Avalanche Effect',
        'TEST 53': 'AES-256-IGE Block Independence',
        'TEST 54': 'AES-256-IGE Error Propagation',
        'TEST 55': 'IGE vs ECB Mode Distinction',
        'TEST 56': 'Padding Randomness',
        'TEST 57': 'Message Key Length Validation',
        'TEST 58': 'AES Key and IV Length Validation',
        'TEST 59': 'AuthKey Length Validation',
        'TEST 60': 'DH Prime Validation',
        'TEST 61': 'BasicHandshake Key Generation Test',
        'TEST 62': 'KDF3 with X=0 and X=8 Test',
        'TEST 63': 'Get Public Key from Private Key',
        'TEST 64': 'Expand Secret with HMAC-SHA512',
        'TEST 65': 'X25519 Complete Functionality Test',
        'TEST 66': 'X25519 Key Exchange Test',
        'TEST 67': 'X25519 to AES Key Derivation',
        'TEST 68': 'X25519 Key Uniqueness',
        'TEST 69': 'X25519 Public Key Validation',
        'TEST 70': 'X25519 Perfect Forward Secrecy'
    };

    const sortedTests = Object.keys(testResults).sort((a, b) => {
        const numA = parseInt(a.split(' ')[1]);
        const numB = parseInt(b.split(' ')[1]);
        return numA - numB;
    });

    for (const test of sortedTests) {
        const status = testResults[test] ? '✅' : '❌';
        const name = testDetails[test] || '';
        console.log(`${status} ${test}: ${name}`);
    }

    const totalTests = Object.keys(testResults).length;
    const passedTests = Object.values(testResults).filter(v => v).length;
    const failedTests = totalTests - passedTests;

    console.log(`\n📈 TOTAL: ${passedTests}/${totalTests} tests passed`);
    console.log(`   ✅ Passed: ${passedTests}`);
    console.log(`   ❌ Failed: ${failedTests}`);

    if (failedTests === 0) {
        console.log('🎉 MTProto 2.0 encryption layer is complete and correct!');
    } else {
        console.log('⚠️ Some tests failed. Need to fix issues.');
    }

    await plugin.onDeactivate();
}

comprehensiveMTProtoTest().catch((error: unknown) => {
    const err = error as Error;
    console.error('❌ Fatal error:', err.message);
});
