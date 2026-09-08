/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { useEffect, useState } from '@ton-ai/atom/hooks';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    const flat: any[] = [];
    const push = (c: any) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) { c.forEach(push); return; }
        if (typeof c === 'string' || typeof c === 'number') {
            flat.push({ type: 'TEXT_NODE', props: { nodeValue: String(c) }, children: [], key: null });
        } else {
            flat.push(c);
        }
    };
    children.forEach(push);
    const p = { ...props };
    if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
    return { type, props: p, children: flat, key: (props as any)?.key ?? null };
}

const effectLog: string[] = [];

function Inner({ docId }: { docId?: string }): any {
    useEffect(() => {
        effectLog.push('inner:' + docId);
    }, [docId]);
    if (!docId) return h('span', { class: 'bared' }, 'bared');
    return h('span', { class: 'inner' }, 'inner-' + docId);
}

function Outer({ documentId }: { documentId?: string }): any {
    useEffect(() => {
        effectLog.push('outer:' + documentId);
    }, [documentId]);
    if (!documentId) return null;
    return h(Inner as any, { docId: documentId });
}

describe('null to different-component-type patch', () => {
    beforeEach(() => { effectLog.length = 0; document.body.innerHTML = ''; });

    test('child instance is never reused across component types', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let flip: (v: string | undefined) => void = () => {};
        const Wrapper: any = () => {
            const [doc, setDoc] = useState<string | undefined>(undefined);
            flip = setDoc;
            return h('div', {}, h('button', { class: 'cell' }, h(Outer as any, { documentId: doc })));
        };
        render(Wrapper, container);
        await new Promise((r) => setTimeout(r, 30));
        expect(container.querySelectorAll('span.bared').length).toBe(0);
        expect(container.querySelectorAll('span.inner').length).toBe(0);
        flip('77');
        await new Promise((r) => setTimeout(r, 30));
        const good = container.querySelectorAll('span.inner');
        expect(good.length).toBe(1);
        expect(good[0].textContent).toBe('inner-77');
        expect(container.querySelectorAll('span.bared').length).toBe(0);
        expect(effectLog).toContain('outer:77');
        expect(effectLog).toContain('inner:77');
    });

    test('round-trip keeps component identities', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let flip: (v: string | undefined) => void = () => {};
        const Wrapper: any = () => {
            const [doc, setDoc] = useState<string | undefined>(undefined);
            flip = setDoc;
            return h('div', {}, h('button', { class: 'cell' }, h(Outer as any, { documentId: doc })));
        };
        render(Wrapper, container);
        await new Promise((r) => setTimeout(r, 30));
        flip('77');
        await new Promise((r) => setTimeout(r, 30));
        expect(container.querySelectorAll('span.inner').length).toBe(1);
        flip(undefined);
        await new Promise((r) => setTimeout(r, 30));
        expect(container.querySelectorAll('span.inner').length).toBe(0);
        expect(container.querySelectorAll('button.cell').length).toBe(1);
        flip('78');
        await new Promise((r) => setTimeout(r, 30));
        const good = container.querySelectorAll('span.inner');
        expect(good.length).toBe(1);
        expect(good[0].textContent).toBe('inner-78');
    });
});
