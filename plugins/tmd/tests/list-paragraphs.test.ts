import { renderCommonMark } from '../src/commonmark';

describe('tmd list paragraphs', () => {
  test('ordered tight list has no p inside li', () => {
    const html = renderCommonMark('1. First point\n2. Second point', { safe: true });
    expect(html).toContain('<li class="md-li">First point</li>');
    expect(html).toContain('<li class="md-li">Second point</li>');
    expect(html).not.toContain('<p class="md-p">');
  });

  test('ordered loose list with single-paragraph items has no p inside li', () => {
    const html = renderCommonMark('1. First point\n\n2. Second point', { safe: true });
    expect(html).toContain('<li class="md-li">First point</li>');
    expect(html).toContain('<li class="md-li">Second point</li>');
    expect(html).not.toContain('<p class="md-p">');
  });

  test('bullet loose list with single-paragraph items has no p inside li', () => {
    const html = renderCommonMark('- aaa\n\n- bbb', { safe: true });
    expect(html).toContain('<li class="md-li">aaa</li>');
    expect(html).toContain('<li class="md-li">bbb</li>');
  });

  test('multi-paragraph item keeps p wrappers', () => {
    const html = renderCommonMark('- lead\n\n  tail\n\n- next', { safe: true });
    expect(html).toContain('<p class="md-p">lead</p>');
    expect(html).toContain('<p class="md-p">tail</p>');
  });

  test('inline markup inside unwrapped item survives', () => {
    const html = renderCommonMark('1. **bold** and *em*\n\n2. plain', { safe: true });
    expect(html).toContain('<li class="md-li"><strong class="md-strong">bold</strong> and <em class="md-em">em</em></li>');
  });
});
