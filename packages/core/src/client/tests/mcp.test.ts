import { config } from 'dotenv';
import { MCPClient } from '@ton-ai/core';

config({ path: require('path').resolve(__dirname, '.env') });

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) { console.error('MNEMONIC not set in .env'); process.exit(1); }
const DELAY = 1500;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    passed++;
    console.log(`  ✓ ${name}`, result !== undefined ? `→ ${JSON.stringify(result).slice(0, 120)}` : '');
  } catch (e: any) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message?.slice(0, 200)}`);
  }
  await sleep(DELAY);
}

async function main() {
  const client = new MCPClient({
    mode: 'stdio',
    network: 'testnet',
    mnemonic: MNEMONIC,
    debug: false
  });
  await client.initialize();

  const wallet = client.getWalletAddress()!;
  console.log(`Wallet: ${wallet}\n`);

  console.log('Read:');
  await test('getBalance', async () => {
    const b = await client.getBalance();
    return `${b.ton} TON`;
  });

  await test('getWallet', async () => {
    return (client as any).request('get_wallet', {});
  });

  await test('getTransactions(3)', async () => {
    const txs = await client.getTransactions(3);
    return `${txs.length} txs`;
  });

  await test('getJettons', async () => {
    const j = await client.getJettons();
    return `${j.length} jettons`;
  });

  await test('getKnownJettons', async () => {
    const k = await client.getKnownJettons();
    return `${k.length} known (${k.map((x: any) => x.symbol).join(', ')})`;
  });

  await test('getJettonBalance (USDT)', async () => {
    return (client as any).request('get_jetton_balance', {
      jettonAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
    });
  });

  await test('getNFTs', async () => {
    const n = await client.getNFTs();
    return `${n.length} nfts`;
  });

  await test('getTransactionStatus', async () => {
    const txs = await client.getTransactions(1);
    if (!txs.length) return 'no txs to check';
    return (client as any).request('get_transaction_status', { hash: txs[0].eventId });
  });

  console.log('\nDNS:');
  await test('resolveDNS (ton.ai)', async () => {
    return client.resolveDNS('ton.ai');
  });

  await test('backResolveDNS (self)', async () => {
    return client.backResolveDNS(wallet);
  });

  console.log('\nSwap:');
  await test('getSwapQuote (TON → USDT)', async () => {
    return client.getSwapQuote(
      'TON',
      'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
      '0.1'
    );
  });

  console.log('\nSend:');
  await test('sendTON (0.001 → self)', async () => {
    const tx = await client.sendTON(wallet, '0.001', 'MCP test');
    return `hash: ${tx.hash}`;
  });

  await test('sendJetton (0 USDT → self)', async () => {
    return client.sendJetton(
      wallet,
      'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
      '0'
    );
  });

  await test('sendRawTransaction (0.001 → self)', async () => {
    return client.sendRawTransaction([
      { address: wallet, amount: '1000000', payload: 'raw test' }
    ]);
  });

  await client.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
