import { strict as assert } from 'assert';
import { EventEmitter } from '../event-emitter';

describe('event emitter', () => {
    it('reports emit success and passes arguments to listeners in order', () => {
        const emitter = new EventEmitter();
        const seen: Array<[string, number]> = [];

        assert.equal(emitter.emit('missing'), false);

        emitter.on('data', (a: string, b: number) => seen.push([a, b]));
        emitter.on('data', (a: string) => seen.push([a + '!', 0]));

        assert.equal(emitter.emit('data', 'x', 7), true);
        assert.deepEqual(seen, [['x', 7], ['x!', 0]]);
    });

    it('runs a once listener exactly once', () => {
        const emitter = new EventEmitter();
        let calls = 0;

        emitter.once('tick', () => { calls += 1; });
        emitter.emit('tick');
        emitter.emit('tick');

        assert.equal(calls, 1);
        assert.equal(emitter.listenerCount('tick'), 0);
    });

    it('calls the listener once when once is registered twice for the same event', () => {
        const emitter = new EventEmitter();
        let calls = 0;
        const listener = () => { calls += 1; };

        emitter.once('tick', listener);
        emitter.once('tick', listener);
        emitter.emit('tick');
        emitter.emit('tick');

        assert.equal(calls, 1);
        assert.equal(emitter.listenerCount('tick'), 0);
    });

    it('keeps independent once wrappers for the same listener across events', () => {
        const emitter = new EventEmitter();
        const seen: string[] = [];
        const listener = (tag: string) => seen.push(tag);

        emitter.once('a', listener);
        emitter.once('b', listener);
        emitter.emit('a', 'a1');
        emitter.emit('a', 'a2');
        emitter.emit('b', 'b1');

        assert.deepEqual(seen, ['a1', 'b1']);
        assert.equal(emitter.listenerCount('a'), 0);
        assert.equal(emitter.listenerCount('b'), 0);
    });

    it('removes a once wrapper when the original listener is passed to off', () => {
        const emitter = new EventEmitter();
        let calls = 0;
        const listener = () => { calls += 1; };

        emitter.once('tick', listener);
        emitter.off('tick', listener);
        emitter.emit('tick');

        assert.equal(calls, 0);
        assert.equal(emitter.listenerCount('tick'), 0);
    });

    it('reflects listeners, eventNames and listenerCount without exposing internals', () => {
        const emitter = new EventEmitter();
        const first = () => {};
        const second = () => {};

        emitter.on('a', first);
        emitter.on('a', second);

        assert.deepEqual(emitter.eventNames(), ['a']);
        assert.deepEqual(emitter.listeners('a'), [first, second]);
        assert.equal(emitter.listenerCount('a'), 2);

        emitter.listeners('a').push(() => {});
        assert.equal(emitter.listenerCount('a'), 2);
    });

    it('clears a single event or everything with removeAllListeners', () => {
        const emitter = new EventEmitter();

        emitter.on('a', () => {});
        emitter.on('b', () => {});
        emitter.removeAllListeners('a');

        assert.equal(emitter.emit('a'), false);
        assert.equal(emitter.emit('b'), true);

        emitter.removeAllListeners();
        assert.equal(emitter.emit('b'), false);
        assert.deepEqual(emitter.eventNames(), []);
    });

    it('keeps iterating a snapshot when a listener removes itself mid-emit', () => {
        const emitter = new EventEmitter();
        const order: string[] = [];
        const first = () => {
            order.push('first');
            emitter.off('e', first);
        };

        emitter.on('e', first);
        emitter.on('e', () => order.push('second'));

        assert.equal(emitter.emit('e'), true);
        assert.deepEqual(order, ['first', 'second']);
        assert.equal(emitter.listenerCount('e'), 1);
    });

    it('supports addListener and removeListener aliases and tolerates unknown removals', () => {
        const emitter = new EventEmitter();
        let calls = 0;
        const listener = () => { calls += 1; };

        emitter.addListener('hit', listener);
        assert.equal(emitter.emit('hit'), true);

        emitter.removeListener('hit', listener);
        assert.equal(emitter.emit('hit'), false);

        emitter.removeListener('ghost', listener);
        emitter.off('ghost', () => {});
        assert.equal(calls, 1);
    });
});
