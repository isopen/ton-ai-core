import { BaseAgent } from '@ton-ai/core';
import { WalletManagerPlugin } from '@ton-ai/wallet-manager';

class SimpleWalletAgent extends BaseAgent {
  private wallet!: WalletManagerPlugin;

  protected async onInitialize(): Promise<void> {
    console.log(`[${this.name}] Initializing...`);

    this.wallet = new WalletManagerPlugin();
    await this.registerPlugin(this.wallet, {
      network: 'testnet',
      autoConnect: true,
      monitorInterval: 0
    });
  }

  protected async onStart(): Promise<void> {
    console.log(`[${this.name}] Started`);

    await this.wallet.waitForReady();

    const address = this.wallet.getAddress();
    console.log(`Address: ${address}`);

    const balance = await this.wallet.getBalance();
    console.log(`Balance: ${balance.formatted}`);

    this.wallet.onTransaction((event) => {
      console.log(`\nReceived ${event.amount} TON from ${event.from}`);
      console.log(`   Hash: ${event.hash}`);
    });
  }

  protected async onStop(): Promise<void> {
    console.log(`[${this.name}] Stopped`);
  }
}

async function main() {
  const agent = new SimpleWalletAgent({
    name: 'SimpleWallet',
    mode: 'stdio',
    network: 'testnet',
    mnemonic: process.env.MNEMONIC
  });

  process.on('SIGINT', async () => {
    await agent.stop();
    process.exit(0);
  });

  await agent.start();
}

main().catch(console.error);
