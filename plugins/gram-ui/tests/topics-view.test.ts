/**
 * @jest-environment jsdom
 */

import { render } from '@ton-ai/atom';
import { TopicsView } from '../dist/components/topics-view.js';

function makeState(over: Record<string, unknown> = {}): any {
    return {
        selectedPeer: { type: 'channel', id: '1', forum: true },
        selectedTopic: null,
        topics: [],
        topicsLoading: false,
        ...over,
    };
}

const topics = [
    { id: 1, title: 'General', iconColor: 0, topMessage: 1, unreadCount: 0 },
    { id: 2, title: 'News', iconColor: 1, topMessage: 10, unreadCount: 3 },
];

describe('TopicsView', () => {
    test('renders topic rows', () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        const seen: any[] = [];
        render(() => TopicsView({
            state: makeState({ topics }),
            dispatch: ((a: any) => { seen.push(a); }) as any,
        } as any) as any, c as HTMLElement);
        const text = c.textContent || '';
        expect(text).toContain('General');
        expect(text).toContain('News');
        document.body.removeChild(c);
    });

    test('loading state without topics', () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        render(() => TopicsView({
            state: makeState({ topicsLoading: true }),
            dispatch: (() => {}) as any,
        } as any) as any, c as HTMLElement);
        expect(c.querySelector('.tgui-topics-loading')).not.toBeNull();
        document.body.removeChild(c);
    });

    test('empty state', () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        render(() => TopicsView({
            state: makeState(),
            dispatch: (() => {}) as any,
        } as any) as any, c as HTMLElement);
        expect(c.querySelector('.tgui-topics-empty')).not.toBeNull();
        document.body.removeChild(c);
    });

    test('click dispatches SET_SELECTED_TOPIC', () => {
        const c = document.createElement('div');
        document.body.appendChild(c);
        const seen: any[] = [];
        render(() => TopicsView({
            state: makeState({ topics }),
            dispatch: ((a: any) => { seen.push(a); }) as any,
        } as any) as any, c as HTMLElement);
        const rows = c.querySelectorAll('.tgui-topics-list > *');
        expect(rows.length).toBe(2);
        (rows[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(seen.length).toBe(1);
        expect(seen[0].type).toBe('SET_SELECTED_TOPIC');
        expect(seen[0].topic.topicId).toBe(2);
        expect(seen[0].topic.peerKey).toBe('channel_1');
        document.body.removeChild(c);
    });
});
