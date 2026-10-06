import { strict as assert } from 'assert';
import { join } from 'node:path';
import { MrtrDemoAgent } from '../agent';

function testAgent(answer: string): MrtrDemoAgent {
    return new MrtrDemoAgent(
        async () => answer,
        {
            name: 'mrtr-demo-test',
            plugins: {},
            mcpServers: {
                demo: {
                    transport: 'stdio',
                    command: process.execPath,
                    args: [join(__dirname, '..', 'server.mjs')],
                },
            },
        },
    );
}

describe('mrtr demo agent', () => {
    test('a yes answer completes the deployment in one input round', async () => {
        const agent = testAgent('yes');
        try {
            await agent.start();
            const text = await agent.deploy();
            assert.equal(text, 'deployed demo-app v1 to production');
            assert.equal(agent.inputRounds, 1);
        } finally {
            await agent.stop();
        }
    });

    test('a no answer cancels without deploying', async () => {
        const agent = testAgent('no');
        try {
            await agent.start();
            const text = await agent.deploy();
            assert.equal(text, 'deployment cancelled by user');
            assert.equal(agent.inputRounds, 1);
        } finally {
            await agent.stop();
        }
    });

    test('an unrecognized answer aborts the round trip', async () => {
        const agent = testAgent('maybe later');
        try {
            await agent.start();
            await assert.rejects(agent.deploy(), /aborted/);
            assert.equal(agent.inputRounds, 1);
        } finally {
            await agent.stop();
        }
    });
});
