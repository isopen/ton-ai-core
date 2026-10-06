import { strict as assert } from 'assert';
import { tonServer } from '../src/index';
import { TonMcpClient } from '../src/client';
import type { McpHub } from '@ton-ai/core';

function stubHub(responses: Record<string, unknown>): McpHub {
    return {
        status: () => 'ready',
        callTool: async (_server: string, tool: string) => {
            if (!(tool in responses)) {
                throw new Error(`unexpected tool: ${tool}`);
            }
            return { content: [{ type: 'text', text: JSON.stringify(responses[tool]) }] };
        },
    } as unknown as McpHub;
}

describe('mcp ton server definition', () => {
    test('tonServer maps options into env', () => {
        const config = tonServer({
            command: '/usr/bin/ton-mcp',
            network: 'mainnet',
            mnemonic: 'word '.repeat(24).trim(),
            toncenterApiKey: 'key-1',
            walletVersion: 'v5r1',
        });
        assert.equal(config.transport, 'stdio');
        if (config.transport !== 'stdio') throw new Error('unreachable');
        assert.equal(config.command, '/usr/bin/ton-mcp');
        assert.deepEqual(config.args, []);
        assert.equal(config.env?.NETWORK, 'mainnet');
        assert.equal(config.env?.MNEMONIC, 'word '.repeat(24).trim());
        assert.equal(config.env?.TONCENTER_API_KEY, 'key-1');
        assert.equal(config.env?.WALLET_VERSION, 'v5r1');
    });

    test('tonServer refuses to start without a mnemonic', () => {
        const saved = process.env.MNEMONIC;
        delete process.env.MNEMONIC;
        try {
            assert.throws(() => tonServer({ network: 'testnet' }), /mnemonic/);
        } finally {
            if (saved !== undefined) process.env.MNEMONIC = saved;
        }
    });
});

describe('ton mcp client', () => {
    test('balance maps nano to tons', async () => {
        const client = new TonMcpClient(
            stubHub({ get_balance: { balanceNano: '1500000000' } }),
        );
        assert.deepEqual(await client.getBalance(), { ton: '1.5', nano: '1500000000' });
    });

    test('sends prefer normalizedHash', async () => {
        const client = new TonMcpClient(
            stubHub({
                send_ton: { normalizedHash: 'abc', hash: 'def' },
                send_jetton: { hash: 'j1' },
                send_nft: { hash: 'n1' },
            }),
        );
        assert.deepEqual(await client.sendTON('to', '1'), { hash: 'abc' });
        assert.deepEqual(await client.sendJetton('to', 'jetton', '1'), { hash: 'j1' });
        assert.deepEqual(await client.sendNFT('nft', 'to'), { hash: 'n1' });
    });

    test('lists unwrap arrays', async () => {
        const client = new TonMcpClient(
            stubHub({
                get_jettons: { jettons: [{ symbol: 'TON' }] },
                get_known_jettons: [{ symbol: 'USDT' }],
                get_transactions: { transactions: [{ hash: 'h' }] },
                get_nfts: { nfts: [{ id: 1 }] },
            }),
        );
        assert.deepEqual(await client.getJettons(), [{ symbol: 'TON' }]);
        assert.deepEqual(await client.getKnownJettons(), [{ symbol: 'USDT' }]);
        assert.deepEqual(await client.getTransactions(), [{ hash: 'h' }]);
        assert.deepEqual(await client.getNFTs(), [{ id: 1 }]);
    });

    test('wallet address is cached after fetch', async () => {
        let calls = 0;
        const hub = stubHub({});
        const client = new TonMcpClient({
            ...hub,
            callTool: async () => {
                calls += 1;
                return { content: [{ type: 'text', text: JSON.stringify({ address: 'UQABC' }) }] };
            },
        } as unknown as McpHub);
        assert.equal(client.getWalletAddress(), undefined);
        assert.equal(await client.fetchWalletAddress(), 'UQABC');
        assert.equal(client.getWalletAddress(), 'UQABC');
        assert.equal(await client.fetchWalletAddress(), 'UQABC');
        assert.equal(calls, 2);
    });

    test('readiness reflects the hub', async () => {
        const ready = new TonMcpClient(stubHub({}));
        assert.equal(ready.isReady(), true);
        await ready.waitForReady();
        const missing = new TonMcpClient(null);
        assert.equal(missing.isReady(), false);
        await assert.rejects(missing.waitForReady(), /not connected/);
        await assert.rejects(missing.getBalance(), /not connected/);
    });
});
