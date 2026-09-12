/**
 * @jest-environment jsdom
 */
import { h } from '@ton-ai/atom';
import { render } from '@ton-ai/atom';
import { useState } from '@ton-ai/atom/hooks';

function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('failed patch keeps committed tree and retries', () => {
  test('transient patch failure self-heals on retry, tree stays consistent', async () => {
    let setV: ((v: string) => void) | null = null;
    let bombArmed = false;
    const Child: any = ({ v }: any) => h('div', null,
      h('span', {
        ref: () => {
          if (bombArmed) {
            bombArmed = false;
            throw new Error('ref-boom-once');
          }
        },
      }, 'r'),
      h('span', null, 't' + v));
    const App: any = () => {
      const [v, setState] = useState('a');
      setV = setState;
      return h('div', null, h(Child as any, { v }));
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    render(App as any, c);
    await tick();
    expect(c.textContent).toContain('ta');
    bombArmed = true;
    setV!('b');
    await tick();
    await tick();
    expect(c.textContent).toContain('tb');
    setV!('c');
    await tick();
    expect(c.textContent).toContain('tc');
    expect(c.querySelectorAll('span').length).toBe(2);
    document.body.removeChild(c);
  });
});
