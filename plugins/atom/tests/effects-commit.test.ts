/**
 * @jest-environment jsdom
 */
import { h } from '@ton-ai/atom';
import { render } from '@ton-ai/atom';
import { useEffect, useState } from '@ton-ai/atom/hooks';

function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('failed commit drops queued effects', () => {
  test('effect from aborted mount never runs after successful remount', async () => {
    const seen: string[] = [];
    const Child: any = ({ v }: any) => {
      useEffect(() => {
        seen.push('run:' + v);
        return () => { seen.push('cleanup:' + v); };
      }, [v]);
      return h('span', null, 'c');
    };
    const Bomb: any = ({ go }: any) => {
      if (go) throw new Error('boom');
      return h('span', null, 'ok');
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    expect(() => render(() => h('div', null, h(Child as any, { v: 'boom' }), h(Bomb as any, { go: true })), c)).toThrow('boom');
    render(() => h('div', null, h(Child as any, { v: 'ok' }), h(Bomb as any, { go: false })), c);
    await tick();
    expect(seen).toEqual(['run:ok']);
    expect(c.querySelectorAll('span').length).toBe(2);
    document.body.removeChild(c);
  });

  test('effect from failed update never runs after successful retry', async () => {
    const seen: string[] = [];
    let setV: ((v: string) => void) | null = null;
    let bombArmed = false;
    const Child: any = ({ v }: any) => {
      useEffect(() => {
        seen.push('run:' + v);
        return () => { seen.push('cleanup:' + v); };
      }, [v]);
      return h('span', null, 'c' + v);
    };
    const Ref: any = () => h('span', {
      ref: () => {
        if (bombArmed) throw new Error('ref-boom');
      },
    }, 'r');
    const App: any = () => {
      const [v, setState] = useState('a');
      setV = setState;
      return h('div', null, h(Child as any, { v }), h(Ref as any, null));
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(App as any, c);
    await tick();
    expect(seen).toEqual(['run:a']);
    bombArmed = true;
    setV!('b');
    await tick();
    bombArmed = false;
    setV!('c');
    await tick();
    expect(seen).toEqual(['run:a', 'cleanup:a', 'run:c']);
    document.body.removeChild(c);
  });
});
