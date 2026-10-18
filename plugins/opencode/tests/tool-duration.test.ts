import { strict as assert } from 'assert';
import { toolDurationSec, mapPart } from '../src/projector';

function part(data: Record<string, unknown>, over: Record<string, number> = {}): string {
    return JSON.stringify(data);
}

function toolPart(status: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: 'tool', tool: 'bash', state: { status, input: { command: 'npx jest' }, output: 'ok', ...over } };
}

import { formatLiveTool, formatConsoleBatch, TOOL_DURATION_MIN_SEC } from '@ton-ai/durevcode-agent/formatter';

function toolEvent(over: Record<string, unknown> = {}): any {
    return { kind: 'tool', tool: 'bash', status: 'completed', summary: 'npx jest 2>&1 | tail -6', output: 'ok', time: 7000, ...over };
}

describe('tool duration rendering', () => {
    test('a finished long command shows its time in the final message', () => {
        const text = formatConsoleBatch([toolEvent({ durationSec: 213 })], null);
        assert.ok(text.includes('213s'), 'final message must show the duration');
    });

    test('a short command shows no time', () => {
        const text = formatConsoleBatch([toolEvent({ durationSec: 0 })], null);
        assert.ok(!/\d+s/.test(text), 'a sub-threshold command stays clean');
        const none = formatConsoleBatch([toolEvent()], null);
        assert.ok(!/\d+s/.test(none));
    });

    test('the live message counts up', () => {
        assert.ok(formatLiveTool(toolEvent({ status: 'running' }), 1).includes('1s'));
        assert.ok(formatLiveTool(toolEvent({ status: 'running' }), 5).includes('5s'));
    });

    test('the live message falls back to the stored span once it stops', () => {
        const text = formatLiveTool(toolEvent({ durationSec: 9 }));
        assert.ok(text.includes('9s'));
    });

    test('the threshold is one second', () => {
        assert.equal(TOOL_DURATION_MIN_SEC, 1);
    });
});

describe('tool duration', () => {
    test('a finished tool reports how long it ran', () => {
        assert.equal(toolDurationSec('completed', 1000, 6500), 5);
        assert.equal(toolDurationSec('error', 0, 12_400), 12);
    });

    test('a running tool reports nothing, its time is still counting', () => {
        for (const status of ['running', 'pending', 'input-streaming', 'output-streaming']) {
            assert.equal(toolDurationSec(status, 1000, 99_000), undefined);
        }
    });

    test('a sub-second or missing span reports nothing', () => {
        assert.equal(toolDurationSec('completed', 1000, 1500), undefined);
        assert.equal(toolDurationSec('completed', 5000, 1000), undefined);
        assert.equal(toolDurationSec('completed', undefined, 5000), undefined);
        assert.equal(toolDurationSec('completed', 1000, undefined), undefined);
    });

    test('a completed part carries the span into the event', () => {
        const event = mapPart({
            id: 'p1',
            time_created: 2000,
            time_updated: 7000,
            data: part(toolPart('completed')),
        });
        assert.ok(event);
        assert.equal(event!.kind, 'tool');
        assert.equal((event as { durationSec?: number }).durationSec, 5);
    });

    test('a running part carries no span', () => {
        const event = mapPart({
            id: 'p2',
            time_created: 2000,
            time_updated: 7000,
            data: part(toolPart('running')),
        });
        assert.ok(event);
        assert.equal((event as { durationSec?: number }).durationSec, undefined);
    });

    test('a row without time_created still maps', () => {
        const event = mapPart({ id: 'p3', time_updated: 7000, data: part(toolPart('completed')) });
        assert.ok(event);
        assert.equal(event!.kind, 'tool');
        assert.equal((event as { durationSec?: number }).durationSec, undefined);
    });
});
