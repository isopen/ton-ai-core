import { strict as assert } from 'assert';
import { getLabels, labelAt, nextLabel } from '../src/labels';

describe('tgcloud-hello labels', () => {
    test('getLabels returns the three demo slides in order', () => {
        assert.deepEqual(getLabels(), ['Hello, world!', "Let's do IT", 'Ready to GO!']);
    });

    test('getLabels returns a copy', () => {
        const first = getLabels();
        first.push('mutated');
        assert.deepEqual(getLabels(), ['Hello, world!', "Let's do IT", 'Ready to GO!']);
    });

    test('nextLabel cycles through the slides', () => {
        assert.equal(nextLabel('Hello, world!'), "Let's do IT");
        assert.equal(nextLabel("Let's do IT"), 'Ready to GO!');
        assert.equal(nextLabel('Ready to GO!'), 'Hello, world!');
    });

    test('nextLabel falls back to the first slide for unknown input', () => {
        assert.equal(nextLabel(''), 'Hello, world!');
        assert.equal(nextLabel('something else'), 'Hello, world!');
    });

    test('labelAt wraps around in both directions', () => {
        assert.equal(labelAt(0), 'Hello, world!');
        assert.equal(labelAt(2), 'Ready to GO!');
        assert.equal(labelAt(3), 'Hello, world!');
        assert.equal(labelAt(-1), 'Ready to GO!');
    });
});
