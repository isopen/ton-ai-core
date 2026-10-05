/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { snapshotEffectQueues, useDomEvent, useMemo, useRef, useState } from '@ton-ai/atom/hooks';
import { h } from '@ton-ai/atom';

function tick(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
}

let bump: ((n: number) => void) | null = null;

const Row = (props: { n: number }) => {
    const [v] = useState(() => props.n);
    const r = useRef(0);
    const m = useMemo(() => ({ v, r: r.current }), [v]);
    return h('span', null, String(m.v));
};

const ListApp = () => {
    const [n, setN] = useState(0);
    bump = setN;
    const rows: any[] = [];
    for (let i = 0; i < n; i++) rows.push(h(Row as any, { n: i, key: i }));
    return h('div', null, ...rows);
};

describe('audit regressions', () => {
    test('hook journal stays bounded across mount/unmount cycles', async () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        render(ListApp as any, c);
        await tick();
        const samples: number[] = [];
        for (let cycle = 0; cycle < 20; cycle++) {
            bump!(0);
            await tick();
            bump!(50);
            await tick();
            samples.push(snapshotEffectQueues()[2]);
        }
        expect(Math.max(...samples)).toBeLessThan(200);
        document.body.removeChild(c);
    });

    test('function target does not resubscribe while resolved node is stable', async () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        const el = document.createElement('video');
        const add: string[] = [];
        const remove: string[] = [];
        const origAdd = EventTarget.prototype.addEventListener;
        const origRemove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (this: any, ...a: any[]) {
            if (a[0] === 'timeupdate') add.push('a');
            return origAdd.apply(this, a as any);
        };
        EventTarget.prototype.removeEventListener = function (this: any, ...a: any[]) {
            if (a[0] === 'timeupdate') remove.push('r');
            return origRemove.apply(this, a as any);
        };
        const Host = () => {
            const [n, setN] = useState(0);
            bump = setN;
            useDomEvent(() => el, 'timeupdate', () => {}, []);
            return h('div', null, String(n));
        };
        try {
            render(Host as any, c);
            await tick();
            const mountedAdds = add.length;
            for (let i = 1; i <= 10; i++) {
                bump!(i);
                await tick();
            }
            expect(add.length - mountedAdds).toBe(0);
            expect(remove.length).toBe(0);
        } finally {
            EventTarget.prototype.addEventListener = origAdd;
            EventTarget.prototype.removeEventListener = origRemove;
            document.body.removeChild(c);
        }
    });

    test('function target backed by a ref settles instead of churning', async () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        const add: string[] = [];
        const remove: string[] = [];
        const origAdd = EventTarget.prototype.addEventListener;
        const origRemove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (this: any, ...a: any[]) {
            if (a[0] === 'timeupdate') add.push('a');
            return origAdd.apply(this, a as any);
        };
        EventTarget.prototype.removeEventListener = function (this: any, ...a: any[]) {
            if (a[0] === 'timeupdate') remove.push('r');
            return origRemove.apply(this, a as any);
        };
        const Holder = () => {
            const [n, setN] = useState(0);
            bump = setN;
            const videoRef = useRef<HTMLVideoElement | null>(null);
            useDomEvent(() => videoRef.current, 'timeupdate', () => {}, []);
            return h('div', null, h('video', { ref: (e: any) => { videoRef.current = e; } }, null), String(n));
        };
        try {
            render(Holder as any, c);
            await tick();
            const afterMount = add.length;
            for (let i = 1; i <= 10; i++) {
                bump!(i);
                await tick();
            }
            expect(add.length - afterMount).toBeLessThanOrEqual(2);
        } finally {
            EventTarget.prototype.addEventListener = origAdd;
            EventTarget.prototype.removeEventListener = origRemove;
            document.body.removeChild(c);
        }
    });

    test('root DOM is rebuilt after two consecutive patch failures', async () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        let armed = false;
        const Boom = (props: { tag: string }) => {
            if (armed) throw new Error('render-boom');
            return h('span', null, props.tag);
        };
        const App = () => {
            const [v, setV] = useState('a');
            bump = setV;
            return h('div', null, h(Boom as any, { tag: v, key: 'x' }));
        };
        render(App as any, c);
        await tick();
        expect(c.textContent).toBe('a');
        armed = true;
        bump!('b');
        await tick();
        armed = false;
        bump!('c');
        await tick();
        expect(c.textContent).toBe('c');
        expect(c.querySelectorAll('span').length).toBe(1);
        bump!('d');
        await tick();
        expect(c.textContent).toBe('d');
        document.body.removeChild(c);
    });
});
