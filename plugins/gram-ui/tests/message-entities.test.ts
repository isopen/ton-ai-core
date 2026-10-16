/**
 * @jest-environment jsdom
 */
import { render } from '@ton-ai/atom';
import { h } from '@ton-ai/atom/jsx-runtime';
import { TmdView } from '../dist/components/tmd-view.js';

const TEXT = [
    'Готово. Оба бага с визуалкой код-блока исправлены.',
    '',
    'Что было не так',
    '',
    'bug_38.png — код-блок выглядел сплошным тёмным прямоугольником. Причина: в CSS стояли хардкоженные цвета:',
    '- фон var(--bg-surface) и границы var(--border);',
    '- внутренний pre получал фон второй раз.',
    '',
    'Что сделано',
    '',
    'plugins/gram-ui/src/styles.css — весь компонент переведён на токены темы.',
].join('\n');

function find(sub: string): { offset: number; length: number } {
    const i = TEXT.indexOf(sub);
    if (i < 0) throw new Error('not found: ' + sub);
    return { offset: i, length: sub.length };
}

const entities: any[] = [
    { _: 'messageEntityBold', ...find('Что было не так') },
    { _: 'messageEntityBold', ...find('bug_38.png') },
    { _: 'messageEntityCode', ...find('var(--bg-surface)') },
    { _: 'messageEntityCode', ...find('var(--border)') },
    { _: 'messageEntityBold', ...find('Что сделано') },
];

function mount(): HTMLElement {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const Probe: any = () => h('div', null, h(TmdView as any, { text: TEXT, documentUrls: {}, foreignEntities: entities }));
    render(Probe, c);
    return c;
}

describe('server entities keep their ranges and line breaks', () => {
    test('line breaks survive as <br>', () => {
        const root = mount();
        const brs = root.querySelectorAll('br');
        expect(brs.length).toBe(TEXT.split('\n').length - 1);
        const body = root.querySelector('.tmd-body') as HTMLElement;
        expect(body.textContent).toContain('исправлены.');
        expect(body.textContent).toContain('Что было не так');
    });

    test('bold covers exactly the server range', () => {
        const root = mount();
        const bolds = Array.from(root.querySelectorAll('strong.md-strong')).map((n) => n.textContent);
        expect(bolds).toEqual(['Что было не так', 'bug_38.png', 'Что сделано']);
    });

    test('code covers exactly the server range', () => {
        const root = mount();
        const codes = Array.from(root.querySelectorAll('code.md-code')).map((n) => n.textContent);
        expect(codes).toEqual(['var(--bg-surface)', 'var(--border)']);
    });

    test('tmd markers are not applied on top of server entities', () => {
        const root = mount();
        expect(root.querySelectorAll('u.md-u')).toHaveLength(0);
    });
});
