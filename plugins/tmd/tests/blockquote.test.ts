import { renderCommonMark, shouldCollapseQuote } from '../src/commonmark';
import { applyEntitiesHtml } from '../src/renderer';

const render = (src: string, entities: any[] = []): string =>
  renderCommonMark(src, { safe: true, entities } as any);

describe('tmd server blockquotes', () => {
  test('quote entity survives commonmark path next to a list', () => {
    const src = '1. In case...\nof slashing *every* round.';
    const html = render(src, [{ _: 'messageEntityBlockquote', offset: 14, length: 30 }]);
    expect(html).toContain('<ol class="md-list md-list-ordered">');
    expect(html).toContain('<blockquote class="md-quote">');
    expect(html).toContain('<em class="md-em">every</em>');
    expect(html).not.toContain('{{QUOTE_');
  });

  test('short quote renders without collapse', () => {
    const html = render('intro\n\nshort quote', [{ _: 'messageEntityBlockquote', offset: 7, length: 11 }]);
    expect(html).toContain('<blockquote class="md-quote">');
    expect(html).not.toContain('md-quote_collapsed');
    expect(html).not.toContain('md-quote_collapsible');
    expect(html).not.toContain('<button');
  });

  test('quote longer than three lines renders collapsed without button (toggle by click on quote)', () => {
    const src = 'intro\n\nl1\nl2\nl3\nl4';
    const html = render(src, [{ _: 'messageEntityBlockquote', offset: 7, length: 11 }]);
    expect(html).toContain('md-quote_collapsed');
    expect(html).toContain('md-quote_collapsible');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Show more');
  });

  test('expandable quote collapses even when short', () => {
    const html = render('intro\n\ntiny', [{ _: 'messageEntityExpandableBlockquote', offset: 7, length: 4 }]);
    expect(html).toContain('md-quote_collapsed');
  });

  test('custom emoji inside quote keeps working', () => {
    const src = 'a 🙂 b';
    const html = render(src, [
      { _: 'messageEntityBlockquote', offset: 0, length: 5 },
      { _: 'messageEntityCustomEmoji', offset: 2, length: 2, document_id: '42' },
    ]);
    expect(html).toContain('<blockquote class="md-quote">');
    expect(html).toContain('data-doc-id="42"');
    expect(html).not.toContain('{{QUOTE_');
    expect(html).not.toContain('{{EMOJI_');
  });

  test('literal greater-than marker still renders quote', () => {
    const html = render('> quoted');
    expect(html).toContain('<blockquote class="md-quote">');
    expect(html).not.toContain('md-quote_collapsed');
  });
});

describe('shouldCollapseQuote', () => {
  test('expandable always collapses', () => {
    expect(shouldCollapseQuote('messageEntityExpandableBlockquote', 'x')).toBe(true);
  });

  test('plain quote collapses after three lines or 300 chars', () => {
    expect(shouldCollapseQuote('messageEntityBlockquote', 'a\nb')).toBe(false);
    expect(shouldCollapseQuote('messageEntityBlockquote', 'a\nb\nc\nd')).toBe(true);
    expect(shouldCollapseQuote('messageEntityBlockquote', 'x'.repeat(301))).toBe(true);
  });
});

describe('legacy blockquote collapse', () => {
  test('short legacy quote has no collapse', () => {
    const html = applyEntitiesHtml('say hi', [{ _: 'messageEntityBlockquote', offset: 4, length: 2 } as any]);
    expect(html).toContain('<blockquote class="md-quote">');
    expect(html).not.toContain('md-quote_collapsed');
  });

  test('long legacy quote collapses', () => {
    const text = 'say ' + 'word '.repeat(80);
    const html = applyEntitiesHtml(text, [{ _: 'messageEntityBlockquote', offset: 4, length: text.length - 4 } as any]);
    expect(html).toContain('md-quote_collapsed');
    expect(html).toContain('md-quote_collapsible');
    expect(html).not.toContain('<button');
  });
});
