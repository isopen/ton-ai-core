/**
 * @jest-environment jsdom
 */

import { defaultState, reducer } from '../dist/state.js';

describe('UPDATE_MESSAGE_DOCUMENT_FAILED', () => {
    test('resets stuck progress to idle and bumps renderTick', () => {
        let s = defaultState();
        s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId: 42, progress: 50 } as any);
        expect(s.documentProgress[42]).toBe(50);
        const tick = s.renderTick;
        s = reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT_FAILED', messageId: 42 } as any);
        expect(42 in s.documentProgress).toBe(false);
        expect(s.renderTick).toBe(tick + 1);
    });

    test('unknown messageId is identity', () => {
        const s = defaultState();
        expect(reducer(s, { type: 'UPDATE_MESSAGE_DOCUMENT_FAILED', messageId: 7 } as any)).toBe(s);
    });
});

describe('MARK_BUTTON_INACTIVE / CLEAR_BUTTON_INACTIVE', () => {
    test('marks composite key and skips duplicates', () => {
        let s = defaultState();
        s = reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 5, data: 'dW5kbw==' } as any);
        expect(s.inactiveButtons['5\ndW5kbw==']).toBe(true);
        const tick = s.renderTick;
        expect(reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 5, data: 'dW5kbw==' } as any)).toBe(s);
        expect(s.renderTick).toBe(tick);
    });

    test('clears single message id keeping others', () => {
        let s = defaultState();
        s = reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 5, data: 'dW5kbw==' } as any);
        s = reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 6, data: 'ZmxpcA==' } as any);
        s = reducer(s, { type: 'CLEAR_BUTTON_INACTIVE', messageId: 5 } as any);
        expect('5\ndW5kbw==' in s.inactiveButtons).toBe(false);
        expect(s.inactiveButtons['6\nZmxpcA==']).toBe(true);
    });

    test('clears id list and all', () => {
        let s = defaultState();
        s = reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 5, data: 'a' } as any);
        s = reducer(s, { type: 'MARK_BUTTON_INACTIVE', messageId: 6, data: 'b' } as any);
        s = reducer(s, { type: 'CLEAR_BUTTON_INACTIVE', messageIds: [5, 6] } as any);
        expect(s.inactiveButtons).toEqual({});
        expect(reducer(s, { type: 'CLEAR_BUTTON_INACTIVE' } as any)).toBe(s);
    });
});

describe('SET_BUTTON_NOTICE / CLEAR_BUTTON_NOTICE', () => {
    test('sets notice with bumping version, ignores empty text', () => {
        let s = defaultState();
        expect(s.buttonNotice).toBeNull();
        s = reducer(s, { type: 'SET_BUTTON_NOTICE', messageId: 9, text: 'Limit' } as any);
        expect(s.buttonNotice).toEqual({ messageId: 9, text: 'Limit', version: 1, rel: null });
        s = reducer(s, { type: 'SET_BUTTON_NOTICE', messageId: 9, text: 'Again' } as any);
        expect(s.buttonNotice?.version).toBe(2);
        expect(reducer(s, { type: 'SET_BUTTON_NOTICE', messageId: 9, text: '' } as any)).toBe(s);
    });

    test('clears notice and is identity when empty', () => {
        const s = defaultState();
        expect(reducer(s, { type: 'CLEAR_BUTTON_NOTICE' } as any)).toBe(s);
        let s2 = reducer(s, { type: 'SET_BUTTON_NOTICE', messageId: 9, text: 'x' } as any);
        s2 = reducer(s2, { type: 'CLEAR_BUTTON_NOTICE' } as any);
        expect(s2.buttonNotice).toBeNull();
    });
});
