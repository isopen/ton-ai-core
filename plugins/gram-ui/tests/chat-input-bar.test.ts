/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { SendInput } from '../dist/components/send-input.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(onEmojiToggle: () => void = () => {}): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Probe: any = () => h(SendInput as any, { dispatch: (() => {}) as any, onEmojiToggle });
    render(Probe, container);
    return container;
}

function typeText(container: HTMLElement, text: string) {
    const edit = container.querySelector('#tg-msg-input') as HTMLElement;
    edit.textContent = text;
    edit.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('new chat input', () => {
    test('empty input shows mic action button', async () => {
        const c = mount();
        await new Promise((r) => setTimeout(r, 20));
        const btn = c.querySelector('#tg-send-msg-btn') as HTMLElement;
        expect(btn).not.toBeNull();
        expect(btn.getAttribute('data-state')).toBe('inactive');
        document.body.removeChild(c);
    });

    test('typing enables send and dispatches message', async () => {
        const sent: any[] = [];
        const onMsg = (e: Event) => { sent.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-message', onMsg);
        try {
            const c = mount();
            await new Promise((r) => setTimeout(r, 20));
            typeText(c, 'hello');
            await new Promise((r) => setTimeout(r, 20));
            const btn = c.querySelector('#tg-send-msg-btn') as HTMLElement;
            expect(btn.getAttribute('data-state')).toBe('active');
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));
            expect(sent.length).toBe(1);
            expect(sent[0].text).toBe('hello');
            expect((c.querySelector('#tg-msg-input') as HTMLElement).textContent).toBe('');
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-send-message', onMsg);
        }
    });

    test('enter sends, emoji button toggles picker', async () => {
        const sent: any[] = [];
        let toggles = 0;
        const onMsg = (e: Event) => { sent.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-message', onMsg);
        try {
            const c = mount(() => { toggles++; });
            await new Promise((r) => setTimeout(r, 20));
            typeText(c, 'hi');
            await new Promise((r) => setTimeout(r, 20));
            const edit = c.querySelector('#tg-msg-input') as HTMLElement;
            edit.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
            await new Promise((r) => setTimeout(r, 20));
            expect(sent.length).toBe(1);
            (c.querySelector('#tg-emoji-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(toggles).toBe(1);
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-send-message', onMsg);
        }
    });

    test('attach button toggles toolbar', async () => {
        const c = mount();
        await new Promise((r) => setTimeout(r, 20));
        expect(c.querySelector('.ci-toolbar')).toBeNull();
        const btns = Array.from(c.querySelectorAll('.ci-icon-btn'));
        (btns[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
        const bar = c.querySelector('.ci-toolbar') as HTMLElement;
        expect(bar).not.toBeNull();
        expect(bar.querySelectorAll('.ci-icon-btn').length).toBe(6);
        document.body.removeChild(c);
    });

    test('mic without backend stays idle', async () => {
        const c = mount();
        await new Promise((r) => setTimeout(r, 20));
        const btn = c.querySelector('#tg-send-msg-btn') as HTMLElement;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        expect(c.querySelector('.chat-input--recording')).toBeNull();
        document.body.removeChild(c);
    });

    test('mocked voice records then sends event', async () => {
        const g = global as any;
        const origMD = g.navigator?.mediaDevices;
        const origMR = g.MediaRecorder;
        const origCreate = URL.createObjectURL;
        const origRevoke = URL.revokeObjectURL;
        g.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [] }) };
        g.MediaRecorder = class {
            ondataavailable: any = null;
            onstop: any = null;
            constructor(public stream: any) {}
            start() {}
            stop() {
                if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x']) });
                if (this.onstop) this.onstop();
            }
        };
        (URL as any).createObjectURL = () => 'blob:voice1';
        (URL as any).revokeObjectURL = () => {};
        const voiced: any[] = [];
        const onVoice = (e: Event) => { voiced.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-voice', onVoice);
        try {
            const c = mount();
            await new Promise((r) => setTimeout(r, 20));
            (c.querySelector('#tg-send-msg-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 60));
            expect(c.querySelector('.chat-input--recording')).not.toBeNull();
            (c.querySelector('.chat-input--recording .ci-action-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
            expect(c.querySelector('.chat-input--voice-ready')).not.toBeNull();
            (c.querySelector('.chat-input--voice-ready .ci-action-btn') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));
            expect(voiced.length).toBe(1);
            expect(voiced[0].seconds).toBeGreaterThanOrEqual(1);
            expect(c.querySelector('.chat-input--voice-ready')).toBeNull();
            document.body.removeChild(c);
        } finally {
            window.removeEventListener('tg-send-voice', onVoice);
            if (origMD !== undefined) g.navigator.mediaDevices = origMD;
            if (origMR !== undefined) g.MediaRecorder = origMR; else delete g.MediaRecorder;
            (URL as any).createObjectURL = origCreate;
            (URL as any).revokeObjectURL = origRevoke;
        }
    });
});
