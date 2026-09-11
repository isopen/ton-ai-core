import { renderCommonMark } from '../src/commonmark';

const render = (src: string): string => renderCommonMark(src, { safe: true });

const countOf = (html: string, sub: string): number => html.split(sub).length - 1;

describe('tmd indents', () => {
  test('nested bullet list keeps depth as nested ul', () => {
    const html = render('- parent\n  - child\n  - second\n- top');
    expect(countOf(html, '<ul')).toBe(2);
    expect(html).toContain('<li class="md-li">parent');
    expect(html).toContain('<li class="md-li">child</li>');
    expect(html).toContain('<li class="md-li">top</li>');
  });

  test('three-level bullet nesting keeps three ul levels', () => {
    const html = render('- a\n  - b\n    - c');
    expect(countOf(html, '<ul')).toBe(3);
    expect(html).toContain('<li class="md-li">c</li>');
  });

  test('nested ordered list keeps depth as nested ol', () => {
    const html = render('1. one\n   1. sub\n2. two');
    expect(countOf(html, '<ol')).toBe(2);
    expect(html).toContain('<li class="md-li">sub</li>');
    expect(html).toContain('<li class="md-li">two</li>');
  });

  test('four-space indented block becomes pre, not paragraph', () => {
    const html = render('para\n\n    code();\n    more();');
    expect(html).toContain('<p class="md-p">para</p>');
    expect(html).toContain('<pre class="md-pre">');
    expect(html).toContain('code();');
    expect(html).toContain('more();');
    expect(html).not.toContain('<p class="md-p">code();');
  });

  test('fenced code keeps leading spaces verbatim', () => {
    const html = render('```\n  two\n    four\n```');
    expect(html).toContain('  two\n    four');
  });

  test('indented continuation stays inside the same item', () => {
    const html = render('- item\n  continued');
    expect(html).toContain('<li class="md-li">item\ncontinued</li>');
  });

  test('nested blockquote keeps depth as nested blockquote', () => {
    const html = render('> outer\n> > inner');
    expect(countOf(html, '<blockquote')).toBe(2);
    expect(html).toContain('inner');
  });

  test('multiple interior spaces survive rendering', () => {
    const html = render('word   spaced');
    expect(html).toContain('word   spaced');
  });

  test('blank line between paragraphs separates blocks without br (spacing via CSS margins)', () => {
    const html = render('aaa\n\nbbb');
    expect(html).toContain('<p class="md-p">aaa</p>');
    expect(html).toContain('<p class="md-p">bbb</p>');
    expect(html).not.toContain('<br>');
  });

  test('adjacent lines without blank emit no br', () => {
    const html = render('aaa\nbbb');
    expect(html).not.toContain('<br');
  });

  test('two blank lines collapse like one (no extra br, bug_27)', () => {
    const html = render('aaa\n\n\nbbb');
    expect(html).toContain('<p class="md-p">aaa</p>');
    expect(html).toContain('<p class="md-p">bbb</p>');
    expect(html).not.toContain('<br>');
  });

  test('leading and trailing blanks are dropped', () => {
    const html = render('\n\naaa\n\nbbb\n\n');
    expect(html.startsWith('<p')).toBe(true);
    expect(html.endsWith('</p>')).toBe(true);
    expect(html).not.toContain('<br>');
  });

  test('blank before list separates without br, none inside tight list (bug_27)', () => {
    const html = render('text\n\n- a\n- b');
    expect(html).toContain('<p class="md-p">text</p>');
    expect(html).toContain('<ul class="md-list md-list-bullet">');
    expect(html).not.toContain('<br>');
  });

  test('blank between heading and paragraph separates without br', () => {
    const html = render('# t\n\npara');
    expect(html).toContain('</h1>');
    expect(html).toContain('<p class="md-p">para</p>');
    expect(html).not.toContain('<br>');
  });

  test('blank after quote and fenced code separates without br', () => {
    expect(render('> q\n\npara')).not.toContain('<br>');
    expect(render('```\nx\n```\n\npara')).not.toContain('<br>');
  });

  test('hard line break renders single br', () => {
    const html = render('aaa  \nbbb');
    expect(html).toContain('<p class="md-p">aaa<br />bbb</p>');
  });

  test('blank lines around table separate without br on both sides', () => {
    const html = render('text\n\n| h |\n| - |\n| b |\n\ntail');
    expect(html).toContain('<p class="md-p">text</p>');
    expect(html).toContain('<table');
    expect(html).toContain('<p class="md-p">tail</p>');
    expect(html).not.toContain('<br>');
  });

  test('bug_27: intro + ordered list + outro has no huge gaps (no br around list)', () => {
    const src = 'I setting up a TON validator node:\n\n1. First?\n2. Second?\n3. Third?\n\nAny help appreciated!';
    const html = render(src);
    expect(html).toContain('<ol class="md-list md-list-ordered">');
    expect(html).toContain('<p class="md-p">I setting up a TON validator node:</p>');
    expect(html).toContain('<p class="md-p">Any help appreciated!</p>');
    expect(html).not.toContain('<br>');
  });
});
