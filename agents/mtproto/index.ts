import { MTProtoCryptoPlugin, EncryptedData, DecryptedData } from '@ton-ai/mtproto';
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
            if (msgIds[i] <= msgIds[i-1]) {
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
        console.log(`   Average: ${(totalTime/count).toFixed(2)}ms per message`);
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
        'TEST 21': 'Edge Case - Minimum Session ID'
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
        console.log('🎉 MTProto 2.0 is complete and correct!');
    } else {
        console.log('⚠️ Some tests failed. Need to fix issues.');
    }

        await plugin.onDeactivate();
    }

comprehensiveMTProtoTest().catch((error: unknown) => {
    const err = error as Error;
    console.error('❌ Fatal error:', err.message);
});
