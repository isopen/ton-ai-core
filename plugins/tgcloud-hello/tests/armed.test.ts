import { strict as assert } from 'assert';
import type { EventBus, PluginContext } from '@ton-ai/core';
import { TgcloudHelloPlugin } from '../src';

describe('TgcloudHelloPlugin.armed', () => {
    test('arms once, wires the context and delegates to the skills', async () => {
        const seen: string[] = [];
        const events: EventBus = {
            on: () => events,
            once: () => events,
            off: () => events,
            emit: (event: string) => {
                seen.push(event);
                return true;
            },
            removeAllListeners: () => events,
        };
        const plugin = await TgcloudHelloPlugin.armed({ events } as Partial<PluginContext>);
        assert.deepEqual(seen, ['tgcloud-hello:ready']);
        assert.deepEqual(plugin.getLabels(), ['Hello, world!', "Let's do IT", 'Ready to GO!']);
        assert.equal(plugin.nextLabel('Hello, world!'), "Let's do IT");
        assert.equal(plugin.labelAt(1), "Let's do IT");
        assert.deepEqual(plugin.currentSlide('Ready to GO!'), { text: 'Ready to GO!', index: 2, total: 3 });
    });

    test('returns the same armed instance on later calls', async () => {
        const first = await TgcloudHelloPlugin.armed();
        const second = await TgcloudHelloPlugin.armed();
        assert.equal(first, second);
    });
});
