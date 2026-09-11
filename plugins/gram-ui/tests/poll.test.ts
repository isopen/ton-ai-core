/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { PollBubble } from '../dist/components/poll-bubble.js';

function h(type: any, props: Record<string, any> = {}, ...children: any[]): any {
    return { type, props: { ...props }, children: children.flat(), key: (props as any)?.key ?? null };
}

function mount(node: any): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const Comp: any = () => node;
    render(Comp, container);
    return container;
}

const baseMsg = (poll: any, results: any = {}) => ({
    id: 7001, date: 1788697000, out: false, sender: 'U',
    message: '', entities: [],
    media: { _: 'messageMediaPoll', poll, results },
});

const singlePoll = {
    question: { text: 'Pick one' },
    answers: [
        { option: 'a1', text: { text: 'First' } },
        { option: 'a2', text: { text: 'Second' } },
    ],
};

const multiPoll = { ...singlePoll, multiple_choice: true };

const bubbleProps = (m: any) => ({
    m, timeStr: '12:44', out: false, status: 'read', documentUrls: {},
});

describe('PollBubble option primitives', () => {
    test('single poll renders Radio options', () => {
        const c = mount(h(PollBubble as any, bubbleProps(baseMsg(singlePoll))));
        const radios = c.querySelectorAll('.Radio');
        expect(radios.length).toBe(2);
        expect(c.querySelector('.Checkbox')).toBeNull();
        expect(c.querySelectorAll('.Radio_selected').length).toBe(0);
    });

    test('multi poll renders Checkbox options', () => {
        const c = mount(h(PollBubble as any, bubbleProps(baseMsg(multiPoll))));
        expect(c.querySelectorAll('.Checkbox').length).toBe(2);
        expect(c.querySelector('.Radio')).toBeNull();
    });

    test('single row click votes immediately without Vote button', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7001, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick one' }, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: {} } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            expect(container.querySelector('button.tgui-poll-vote')).toBeNull();
            const rows = Array.from(container.querySelectorAll('.tgui-poll-answer')) as HTMLElement[];
            rows[1].click();
            await new Promise((r) => setTimeout(r, 60));
            expect(seen.length).toBe(1);
            expect(seen[0].messageId).toBe(7001);
            expect(seen[0].options).toEqual(['a2']);
            expect(container.querySelector('button.tgui-poll-vote')).toBeNull();
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('vote dispatches picked options', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7001, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick one' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: {} } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            const rows = Array.from(container.querySelectorAll('.tgui-poll-answer')) as HTMLElement[];
            rows[0].click();
            rows[1].click();
            await new Promise((r) => setTimeout(r, 60));
            (container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).click();
            expect(seen.length).toBe(1);
            expect(seen[0].messageId).toBe(7001);
            expect([...seen[0].options].sort()).toEqual(['a1', 'a2']);
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('voted poll shows bars with disabled choice marks', () => {
        const results = { total_voters: 3, results: [{ option: 'a2', voters: 3, chosen: true }] };
        const c = mount(h(PollBubble as any, bubbleProps(baseMsg(singlePoll, results))));
        const radios = Array.from(c.querySelectorAll('.Radio'));
        expect(radios.length).toBe(2);
        expect(radios.every((el) => (el as HTMLElement).className.includes('Radio_disabled'))).toBe(true);
        expect(c.querySelectorAll('.Radio_selected').length).toBe(1);
        expect(c.querySelector('.tgui-poll-bar')).toBeTruthy();
        expect(c.querySelector('button.tgui-poll-vote')).toBeNull();
    });

    test('closed poll shows bars with disabled choice marks', () => {
        const closedPoll = { ...singlePoll, closed: true };
        const c = mount(h(PollBubble as any, bubbleProps(baseMsg(closedPoll))));
        const radios = Array.from(c.querySelectorAll('.Radio'));
        expect(radios.length).toBe(2);
        expect(radios.every((el) => (el as HTMLElement).className.includes('Radio_disabled'))).toBe(true);
        expect(c.querySelector('.tgui-poll-bar')).toBeTruthy();
    });

    test('multi shows Vote only after picking', async () => {
        document.body.innerHTML = '';
        const m = { id: 7002, date: 1, out: false, sender: 'U', message: '', entities: [],
            media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick many' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'First' } }] }, results: {} } };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
        render(Comp, container);
        expect(container.querySelectorAll('.tgui-poll-answer').length).toBe(1);
        expect((container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).disabled).toBe(true);
        (container.querySelector('.tgui-poll-answer') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 60));
        expect((container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).disabled).toBe(false);
    });

    test('fresh multi poll with zero-vote results stays votable', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7003, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Test' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: { total_voters: 0, results: [{ option: 'a1', voters: 0 }, { option: 'a2', voters: 0 }] } } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            expect(container.querySelectorAll('.Checkbox').length).toBe(2);
            expect(container.querySelector('.tgui-poll-bar')).toBeNull();
            expect(container.querySelector('.tgui-poll-pct')).toBeNull();
            expect((container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).disabled).toBe(true);
            const rows = Array.from(container.querySelectorAll('.tgui-poll-answer')) as HTMLElement[];
            rows[0].click();
            rows[1].click();
            await new Promise((r) => setTimeout(r, 60));
            expect((container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).disabled).toBe(false);
            expect(container.querySelectorAll('.tgui-poll-bar').length).toBe(0);
            expect(container.querySelectorAll('.tgui-poll-pct').length).toBe(0);
            const checked = Array.from(container.querySelectorAll('.Checkbox_selected'));
            expect(checked.length).toBe(2);
            (container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).click();
            expect(seen.length).toBe(1);
            expect([...seen[0].options].sort()).toEqual(['a1', 'a2']);
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('fresh single poll with zero-vote results stays votable', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7004, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick one' }, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: { total_voters: 0, results: [{ option: 'a1', voters: 0 }, { option: 'a2', voters: 0 }] } } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            expect(container.querySelectorAll('.Radio').length).toBe(2);
            expect(container.querySelector('.tgui-poll-bar')).toBeNull();
            expect(container.querySelector('.tgui-poll-pct')).toBeNull();
            const rows = Array.from(container.querySelectorAll('.tgui-poll-answer')) as HTMLElement[];
            rows[1].click();
            await new Promise((r) => setTimeout(r, 60));
            expect(seen.length).toBe(1);
            expect(seen[0].options).toEqual(['a2']);
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('picked multi reveals stats on voted options', async () => {
        const prevDataset = (document.documentElement as any).dataset.animations;
        (document.documentElement as any).dataset.animations = 'off';
        try {
            document.body.innerHTML = '';
            const m = { id: 7009, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Q' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: { total_voters: 5, results: [{ option: 'a1', voters: 5 }, { option: 'a2', voters: 0 }] } } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            expect(container.querySelector('.tgui-poll-pct')).toBeNull();
            const rows = Array.from(container.querySelectorAll('.tgui-poll-answer')) as HTMLElement[];
            rows[1].click();
            await new Promise((r) => setTimeout(r, 60));
            const pcts = Array.from(container.querySelectorAll('.tgui-poll-pct')).map((el) => el.textContent);
            expect(pcts.sort()).toEqual(['0%', '100%']);
            expect(container.querySelectorAll('.tgui-poll-bar').length).toBe(2);
        } finally {
            if (prevDataset === undefined) delete (document.documentElement as any).dataset.animations;
            else (document.documentElement as any).dataset.animations = prevDataset;
        }
    });

    test('others voted but self did not stays votable', () => {
        document.body.innerHTML = '';
        const m = { id: 7005, date: 1, out: false, sender: 'U', message: '', entities: [],
            media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick one' }, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: { total_voters: 3, results: [{ option: 'a1', voters: 3 }] } } };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
        render(Comp, container);
        expect(container.querySelectorAll('.Radio').length).toBe(2);
        expect(container.querySelector('.tgui-poll-bar')).toBeNull();
        expect(container.querySelector('.tgui-poll-pct')).toBeNull();
    });
});

    test('label click toggles checkbox exactly once', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7006, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick many' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: {} } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            const label = container.querySelector('.tgui-poll-answer label') as HTMLElement;
            expect(label).toBeTruthy();
            label.click();
            await new Promise((r) => setTimeout(r, 60));
            expect(container.querySelector('button.tgui-poll-vote')).toBeTruthy();
            (container.querySelector('button.tgui-poll-vote') as HTMLButtonElement).click();
            expect(seen.length).toBe(1);
            expect(seen[0].options).toEqual(['a1']);
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('label click on single votes exactly once', async () => {
        const seen: any[] = [];
        const onVote = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-send-poll-vote', onVote);
        try {
            document.body.innerHTML = '';
            const m = { id: 7007, date: 1, out: false, sender: 'U', message: '', entities: [],
                media: { _: 'messageMediaPoll', poll: { question: { text: 'Pick one' }, answers: [{ option: 'a1', text: { text: 'First' } }, { option: 'a2', text: { text: 'Second' } }] }, results: {} } };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
            render(Comp, container);
            const label = container.querySelector('.tgui-poll-answer label') as HTMLElement;
            expect(label).toBeTruthy();
            label.click();
            await new Promise((r) => setTimeout(r, 60));
            expect(seen.length).toBe(1);
            expect(seen[0].options).toEqual(['a1']);
            expect(container.querySelector('button.tgui-poll-vote')).toBeNull();
        } finally {
            window.removeEventListener('tg-send-poll-vote', onVote);
        }
    });

    test('question custom emoji resolves with document urls', () => {
        const seen: any[] = [];
        const onFetch = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-fetch-custom-emoji', onFetch);
        try {
            document.body.innerHTML = '';
            const q = { text: 'Q X', entities: [{ _: 'messageEntityCustomEmoji', offset: 2, length: 1, document_id: '99' }] };
            const mk = (poll: any, urls: any) => {
                const m = { id: 7008, date: 1, out: false, sender: 'U', message: '', entities: [],
                    media: { _: 'messageMediaPoll', poll, results: {} } };
                const container = document.createElement('div');
                document.body.appendChild(container);
                const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: urls });
                render(Comp, container);
                return container;
            };
            const c1 = mk({ question: q, answers: [{ option: 'a1', text: { text: 'First' } }] }, {});
            expect(seen.some((d) => Array.isArray(d.ids) && d.ids.includes('99'))).toBe(true);
            c1.remove();
            seen.length = 0;
            const c2 = mk({ question: q, answers: [{ option: 'a1', text: { text: 'First' } }] }, { 'emojipack-99': 'http://localhost/x.png' });
            expect(seen.some((d) => Array.isArray(d.ids) && d.ids.includes('99'))).toBe(false);
            c2.remove();
        } finally {
            window.removeEventListener('tg-fetch-custom-emoji', onFetch);
        }
    });
});

describe('PollBubble mock layout', () => {
    const mk = (poll: any, results: any = {}) => {
        const m = { id: 7010, date: 1, out: false, sender: 'U', message: '', entities: [],
            media: { _: 'messageMediaPoll', poll, results } };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
        render(Comp, container);
        return container;
    };

    test('header shows title and anonymity subtitle', () => {
        const c = mk({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] });
        const header = c.querySelector('.tgui-poll-header') as HTMLElement;
        expect(header.textContent).toContain('Poll');
        const sub = c.querySelector('.tgui-poll-sub') as HTMLElement;
        expect(sub.textContent).toContain('Anonymous');
        c.remove();
    });

    test('multi shows hint subtitle and counted confirm button', async () => {
        const c = mk({ question: { text: 'Q' }, multiple_choice: true, answers: [{ option: 'a1', text: { text: 'A' } }, { option: 'a2', text: { text: 'B' } }] });
        expect((c.querySelector('.tgui-poll-sub') as HTMLElement).textContent).toContain('multiple');
        const btn = c.querySelector('button.tgui-poll-vote') as HTMLButtonElement;
        expect(btn).toBeTruthy();
        expect((btn.disabled)).toBe(true);
        expect(btn.textContent).toContain('(0)');
        (c.querySelector('.tgui-poll-answer') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 60));
        expect((c.querySelector('button.tgui-poll-vote') as HTMLButtonElement).textContent).toContain('(1)');
        c.remove();
    });

    test('footer votes text follows total', () => {
        const c0 = mk({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] });
        expect((c0.querySelector('.tgui-poll-total') as HTMLElement).textContent).toBe('No votes');
        c0.remove();
        const c1 = mk({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] },
            { total_voters: 1, results: [{ option: 'a1', voters: 1, chosen: true }] });
        expect((c1.querySelector('.tgui-poll-total') as HTMLElement).textContent).toBe('1 vote');
        c1.remove();
        const c2 = mk({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] },
            { total_voters: 12483, results: [{ option: 'a1', voters: 12483, chosen: true }] });
        expect((c2.querySelector('.tgui-poll-total') as HTMLElement).textContent).toBe('12,483 votes');
        c2.remove();
    });

    test('attached photo renders above question', () => {
        const photo = { _: 'photo', id: '5', access_hash: '0', file_reference: '', date: 1, sizes: [{ _: 'photoSize', type: 'x', w: 100, h: 80, size: 10 }] };
        const c = mk({ question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] });
        expect(c.querySelector('.tgui-poll-attach')).toBeNull();
        c.remove();
        const m = { id: 7011, date: 1, out: false, sender: 'U', message: '', entities: [],
            media: { _: 'messageMediaPoll', poll: { question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] }, results: {}, attached_media: { photo } } };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
        render(Comp, container);
        const attach = container.querySelector('.tgui-poll-attach');
        expect(attach).toBeTruthy();
        expect((container.querySelector('.tgui-poll-question') as HTMLElement).compareDocumentPosition(attach as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        container.remove();
    });

    test('option custom emoji resolves with document urls', () => {
        const seen: any[] = [];
        const onFetch = (e: Event) => { seen.push((e as CustomEvent).detail); };
        window.addEventListener('tg-fetch-custom-emoji', onFetch);
        try {
            document.body.innerHTML = '';
            const opt = { option: 'a1', text: { text: 'A X', entities: [{ _: 'messageEntityCustomEmoji', offset: 2, length: 1, document_id: '77' }] } };
            const mkOpt = (urls: any) => {
                const m = { id: 7012, date: 1, out: false, sender: 'U', message: '', entities: [],
                    media: { _: 'messageMediaPoll', poll: { question: { text: 'Q' }, answers: [opt] }, results: {} } };
                const container = document.createElement('div');
                document.body.appendChild(container);
                const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: urls });
                render(Comp, container);
                return container;
            };
            const c1 = mkOpt({});
            expect(seen.some((d) => Array.isArray(d.ids) && d.ids.includes('77'))).toBe(true);
            c1.remove();
            seen.length = 0;
            const c2 = mkOpt({ 'emojipack-77': 'http://localhost/y.png' });
            expect(seen.some((d) => Array.isArray(d.ids) && d.ids.includes('77'))).toBe(false);
            c2.remove();
        } finally {
            window.removeEventListener('tg-fetch-custom-emoji', onFetch);
        }
    });

    test('blocks order header question photo description answers', () => {
        const photo = { _: 'photo', id: '6', access_hash: '0', file_reference: '', date: 1, sizes: [{ _: 'photoSize', type: 'x', w: 100, h: 80, size: 10 }] };
        const m = { id: 7013, date: 1, out: false, sender: 'U', message: 'cap', entities: [],
            media: { _: 'messageMediaPoll', poll: { question: { text: 'Q' }, answers: [{ option: 'a1', text: { text: 'A' } }] }, results: {}, attached_media: { photo } } };
        const container = document.createElement('div');
        document.body.appendChild(container);
        const Comp: any = () => h(PollBubble as any, { m, timeStr: '12:44', out: false, status: 'read', documentUrls: {} });
        render(Comp, container);
        const order = ['.tgui-poll-header', '.tgui-poll-question', '.tgui-poll-attach', '.tgui-poll-caption', '.tgui-poll-answers']
            .map((s) => container.querySelector(s) as HTMLElement);
        expect(order.every(Boolean)).toBe(true);
        for (let i = 0; i + 1 < order.length; i++) {
            expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        container.remove();
    });
});
