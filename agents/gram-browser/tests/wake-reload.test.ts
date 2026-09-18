/**
 * @jest-environment jsdom
 */

import { strict as assert } from 'assert';
import { handleWakeVisible, WAKE_RELOAD_AFTER_MS } from '../src/app/gram-events';
import type { GramState } from '../src/app/gram-state';

function mockState(peer: boolean, connectImpl?: () => Promise<void>): { s: GramState; calls: string[] } {
  const calls: string[] = [];
  const s = {
    tgService: {
      current: {
        connect: (..._args: any[]) => {
          calls.push('connect');
          return connectImpl ? connectImpl() : Promise.resolve();
        },
      },
    },
    selectedPeerRef: { current: peer ? { type: 'user', id: '1' } : null },
    reloadHistoryRef: {
      current: () => {
        calls.push('reload');
      },
    },
  } as unknown as GramState;
  return { s, calls };
}

describe('handleWakeVisible', () => {
  test('short absence does nothing', () => {
    const { s, calls } = mockState(true);
    handleWakeVisible(s, WAKE_RELOAD_AFTER_MS - 1);
    assert.deepStrictEqual(calls, []);
  });

  test('long absence reconnects and reloads open chat', () => {
    const { s, calls } = mockState(true);
    handleWakeVisible(s, WAKE_RELOAD_AFTER_MS + 1);
    assert.deepStrictEqual(calls, ['connect', 'reload']);
  });

  test('long absence without open chat only reconnects', () => {
    const { s, calls } = mockState(false);
    handleWakeVisible(s, WAKE_RELOAD_AFTER_MS + 1000);
    assert.deepStrictEqual(calls, ['connect']);
  });

  test('sync connect throw still reloads', () => {
    const calls: string[] = [];
    const s = {
      tgService: {
        current: {
          connect: () => {
            calls.push('connect');
            throw new Error('down');
          },
        },
      },
      selectedPeerRef: { current: { type: 'user', id: '1' } },
      reloadHistoryRef: {
        current: () => {
          calls.push('reload');
        },
      },
    } as unknown as GramState;
    handleWakeVisible(s, WAKE_RELOAD_AFTER_MS + 1);
    assert.deepStrictEqual(calls, ['connect', 'reload']);
  });
});
