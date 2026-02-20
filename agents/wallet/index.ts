import { BaseAgent } from '@ton-ai/core';

class WalletAgent extends BaseAgent {
  protected async onInitialize() {
    console.log('Initializing WalletAgent...');
  }

  protected async onStart() {
    console.log('WalletAgent started');
    console.log('Wallet:', this.getWalletAddress());

    const balance = await this.getBalance();
    console.log('Balance:', balance);

    //await this.sendTON('UQAvlO9Hl_s0amBNHeA7M1szpYIWHtZn7lTAqsYtn7H1RhCv', '0.1', 'test');
  }

  protected async onStop() {
    console.log('WalletAgent stop');
  }
}

async function main() {
  const aliceAgent = new WalletAgent({
    mode: 'stdio',
    network: 'testnet',
    mnemonic: process.env.MNEMONIC
  });

  await aliceAgent.start();

  const bobAgent = new WalletAgent({
    mode: 'stdio',
    network: 'testnet',
    mnemonic: process.env.MNEMONIC_1
  });

  await bobAgent.start();

  process.on('SIGINT', async () => {
    await aliceAgent.stop();
    await bobAgent.stop();
    process.exit(0);
  });
}

main().catch(console.error);
