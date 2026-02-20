import { PaidAIAssistant } from './agent';

async function main() {
    ['MNEMONIC', 'OPENROUTER_API_KEY', 'TREASURY_ADDRESS'].forEach(varName => {
        if (!process.env[varName]) {
            console.error(`Error: ${varName} is not set in environment variables`);
            process.exit(1);
        }
    });

    const assistant = new PaidAIAssistant({
        mnemonic: process.env.MNEMONIC,
        openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
        treasuryAddress: process.env.TREASURY_ADDRESS || '',
        defaultModel: process.env.DEFAULT_MODEL || 'arcee-ai/trinity-large-preview:free',
        costPerRequest: '0.000001',
        minBalanceThreshold: '0.1',
        network: 'testnet',
        systemPrompt: 'You are a helpful assistant.',
        mode: 'stdio'
    });

    try {
        console.log('Initializing agent...');

        await assistant.initialize();
        console.log('Base initialization completed');

        console.log('Starting agent...');
        await assistant.start();
        console.log('Agent started');

        //const balance = await assistant.getBalance();
        //console.log(`Balance: ${balance.ton} TON`);

        console.log('\nSending request...');
        const response = await assistant.ask(
            'The capital of the world? Short answer.',
            { maxTokens: 300 }
        );

        console.log('\nResponse:', response.text);
        console.log(`Status: ${response.transaction.success ? 'OK' : 'NO'}`);

        console.log('\nStatistics:', assistant.getStats());

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
    } finally {
        console.log('\nStopping agent...');
        await assistant.stop();
        console.log('Agent stopped');
    }
}

main().catch(console.error);
