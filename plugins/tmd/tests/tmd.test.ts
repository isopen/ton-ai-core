import { parseTmdEntities, remapEntities, hasTmd, hasCommonTmd } from '../src/parser.js';
import { applyEntitiesHtml, renderTmdHtml, renderCommonMarkHtml, escapeHtml } from '../src/renderer.js';
import { renderCommonMark, hasCommonMark } from '../src/commonmark.js';

const parse = (src: string) => parseTmdEntities(src);

describe('parseTmdEntities', () => {
  test('*bold* → messageEntityBold, markers stripped', () => {
    const r = parse('*hello*');
    expect(r.text).toBe('hello');
    expect(r.entities).toEqual([{ _: 'messageEntityBold', offset: 0, length: 5 }]);
  });

  test('_italic_, __underline__, ~~strike~~, ||spoiler|| (Android TA)', () => {
    const r = parse('_it_ __u__ ~~s~~ ||sp||');
    expect(r.text).toBe('it u s sp');
    expect(r.entities.map((e) => [e._, e.offset, e.length])).toEqual([
      ['messageEntityItalic', 0, 2],
      ['messageEntityUnderline', 3, 1],
      ['messageEntityStrike', 5, 1],
      ['messageEntitySpoiler', 7, 2],
    ]);
  });

  test('legacy --underline-- still supported', () => {
    const r = parse('--u--');
    expect(r.text).toBe('u');
    expect(r.entities[0]._).toBe('messageEntityUnderline');
  });

  test('`code` and ```pre``` with language', () => {
    const c = parse('a `let x` b');
    expect(c.text).toBe('a let x b');
    expect(c.entities).toEqual([{ _: 'messageEntityCode', offset: 2, length: 5 }]);

    const pre = parse('```ts\nconst a = 1;\n```');
    expect(pre.text).toBe('const a = 1;');
    expect(pre.entities).toEqual([{ _: 'messageEntityPre', offset: 0, length: 12, language: 'ts' }]);

    const preNoLang = parse('```\nplain\n```');
    expect(preNoLang.text).toBe('plain');
    expect(preNoLang.entities[0]._).toBe('messageEntityPre');
  });

  test('inline pre on one line', () => {
    const r = parse('```const x = 1```');
    expect(r.text).toBe('const x = 1');
    expect(r.entities[0]._).toBe('messageEntityPre');
  });

  test('[text](url) → messageEntityTextLink', () => {
    const r = parse('go [there](https://x.io) now');
    expect(r.text).toBe('go there now');
    expect(r.entities).toEqual([{ _: 'messageEntityTextLink', offset: 3, length: 5, url: 'https://x.io' }]);
  });

  test('snake_case is never italic (TA rule)', () => {
    const r = parse('snake_case_name');
    expect(r.text).toBe('snake_case_name');
    expect(r.entities).toEqual([]);
  });

  test('unmatched markers stay literal', () => {
    const r = parse('a * b __ c');
    expect(r.text).toBe('a * b __ c');
    expect(r.entities).toEqual([]);
  });

  test('escapes produce literal markers', () => {
    const r = parse('\\*not bold\\* and \\`not code\\`');
    expect(r.text).toBe('*not bold* and `not code`');
    expect(r.entities).toEqual([]);
  });

  test('nested markers: outer wins first, inner stripped as text', () => {
    const r = parse('*bold __inner__ end*');
    expect(r.text).toBe('bold __inner__ end');
    expect(r.entities).toEqual([{ _: 'messageEntityBold', offset: 0, length: 18 }]);
  });

  test('srcToPlain maps plain indices back to source', () => {
    const r = parse('*ab*cd');
    expect(r.srcToPlain).toEqual([-1, 0, 1, -1, 2, 3]);
  });

  test('remapEntities shifts foreign entities and drops marker-overlaps', () => {
    const r = parse('*ab* cd **ef**');

    const foreign = [
      { _: 'messageEntityCustomEmoji', offset: 1, length: 2 },   // 'ab' inside bold → ok
      { _: 'messageEntityMention', offset: 4, length: 2 },       // 'cd' plain → ok
      { _: 'messageEntityMention', offset: 0, length: 1 },       // '*' marker → dropped
    ];
    const remapped = remapEntities(foreign, r.srcToPlain);
    expect(remapped).toEqual([
      { _: 'messageEntityCustomEmoji', offset: 0, length: 2 },
      { _: 'messageEntityMention', offset: 2, length: 2 },
    ]);
  });
});

describe('applyEntitiesHtml', () => {
  test('formats text with md-* classes', () => {
    const out = applyEntitiesHtml('hello world', [
      { _: 'messageEntityBold', offset: 0, length: 5 },
      { _: 'messageEntityItalic', offset: 6, length: 5 },
    ]);
    expect(out).toBe('<strong class="md-strong">hello</strong> <em class="md-em">world</em>');
  });

  test('escapes html inside text', () => {
    const out = applyEntitiesHtml('<b>&</b>', [{ _: 'messageEntityBold', offset: 0, length: 8 }]);
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;');
  });

  test('text_link renders sanitized anchor', () => {
    const out = applyEntitiesHtml('x', [
      { _: 'messageEntityTextLink', offset: 0, length: 1, url: 'javascript:alert(1)' } as any,
    ]);
    expect(out).toContain('href="#"');
    const ok = applyEntitiesHtml('x', [
      { _: 'messageEntityTextLink', offset: 0, length: 1, url: 'https://ok.io' } as any,
    ]);
    expect(ok).toContain('href="https://ok.io"');
  });

  test('pre renders with data-lang', () => {
    const out = applyEntitiesHtml('code', [{ _: 'messageEntityPre', offset: 0, length: 4, language: 'ts' } as any]);
    expect(out).toContain('data-lang="ts"');
    expect(out).toContain('md-pre');
  });

  test('spoiler renders as span', () => {
    const out = applyEntitiesHtml('secret', [{ _: 'messageEntitySpoiler', offset: 0, length: 6 }]);
    expect(out).toBe('<span class="md-spoiler">secret</span>');
  });
});

describe('renderTmdHtml (one-call)', () => {
  test('parses, strips and renders', () => {
    const out = renderTmdHtml('*hi* ~~gone~~ `c`');
    expect(out).toBe('<strong class="md-strong">hi</strong> <del class="md-del">gone</del> <code class="md-code">c</code>');
  });

  test('remaps foreign entities from source offsets', () => {
    const out = renderTmdHtml('*ab* cd', [
      { _: 'messageEntityItalic', offset: 1, length: 1 },
    ]);
    expect(out).toBe('<strong class="md-strong"><em class="md-em">a</em>b</strong> cd');
  });

  test('escapeHtml', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('hasTmd (TA syntax set)', () => {
  const cases: Array<[string, boolean]> = [
    ['*bold*', true],
    ['__italic__', true],
    ['--underline--', true],
    ['~~strike~~', true],
    ['||spoiler||', true],
    ['`code`', true],
    ['```pre```', true],
    ['[t](https://x.io)', true],
    ['plain text 100%', false],
    ['snake_case_word', false],
    ['a * b = c', false],
    ['5 - 3 - 2', false],
    ['', false],
  ];
  for (const [src, expected] of cases) {
    test(JSON.stringify(src), () => {
      expect(hasTmd(src)).toBe(expected);
    });
  }
});

describe('CommonMark 0.31.2 – hasCommonMark / hasCommonTmd', () => {
  const positive = [
    '# heading',
    '## heading 2',
    'heading\n===',
    'heading\n---',
    '***',
    '---',
    '___',
    '> blockquote',
    '- list',
    '* list',
    '+ list',
    '1. ordered',
    '```\ncode\n```',
    '    indented code',
    '`code`',
    '*em*',
    '_em_',
    '**strong**',
    '__strong__',
    '[link](https://example.com)',
    '![image](https://example.com/img.png)',
    '<https://example.com>',
    'foo  \nbar', // hard break
  ];
  for (const src of positive) {
    test(`hasCommonMark true for ${JSON.stringify(src).slice(0,40)}`, () => {
      expect(hasCommonMark(src)).toBe(true);
      expect(hasCommonTmd(src)).toBe(true);
      expect(hasTmd(src)).toBe(true);
    });
  }
  test('entity refs and escaped are not tmd', () => {
    expect(hasCommonMark('&amp; &copy;')).toBe(false);
    expect(hasCommonMark('\\*not*')).toBe(false);
  });
  test('plain text false', () => {
    expect(hasCommonMark('plain text')).toBe(false);
    expect(hasTmd('plain text')).toBe(false);
  });
});

describe('renderCommonMark – CommonMark 0.31.2 blocks', () => {
  test('ATX headings 1-6', () => {
    expect(renderCommonMark('# foo')).toBe('<h1 class="md-h md-h1">foo</h1>');
    expect(renderCommonMark('## foo')).toBe('<h2 class="md-h md-h2">foo</h2>');
    expect(renderCommonMark('### foo')).toContain('md-h3');
    expect(renderCommonMark('#### foo')).toContain('md-h4');
    expect(renderCommonMark('##### foo')).toContain('md-h5');
    expect(renderCommonMark('###### foo')).toContain('md-h6');
    expect(renderCommonMark('####### foo')).not.toContain('<h');
  });

  test('Setext headings', () => {
    expect(renderCommonMark('Foo\n===')).toContain('<h1 class="md-h md-h1">Foo</h1>');
    expect(renderCommonMark('Foo\n---')).toContain('<h2 class="md-h md-h2">Foo</h2>');
  });

  test('thematic breaks', () => {
    expect(renderCommonMark('***')).toContain('<hr class="md-hr"');
    expect(renderCommonMark('---')).toContain('<hr class="md-hr"');
    expect(renderCommonMark('___')).toContain('<hr class="md-hr"');
    expect(renderCommonMark(' - - -')).toContain('md-hr');
  });

  test('indented code blocks', () => {
    const out = renderCommonMark('    foo\n    bar');
    expect(out).toContain('<pre class="md-pre">');
    expect(out).toContain('<code class="md-code-block">');
    expect(out).toContain('foo');
  });

  test('fenced code blocks with language', () => {
    const out = renderCommonMark('```js\nconst x = 1;\n```');
    expect(out).toContain('<pre class="md-pre"');
    expect(out).toContain('md-code-block');
    expect(out).toContain('language-js');
    expect(out).toContain('const x = 1;');
    const out2 = renderCommonMark('~~~ python\nhello\n~~~');
    expect(out2).toContain('language-python');
  });

  test('paragraphs', () => {
    expect(renderCommonMark('hello world')).toBe('<p class="md-p">hello world</p>');
    const two = renderCommonMark('para1\n\npara2');
    expect(two).toContain('<p class="md-p">para1</p>');
    expect(two).toContain('<p class="md-p">para2</p>');
  });

  test('block quotes', () => {
    const out = renderCommonMark('> foo\n> bar');
    expect(out).toContain('<blockquote class="md-quote">');
    expect(out).toContain('foo');
  });

  test('bullet lists tight and loose', () => {
    const tight = renderCommonMark('- a\n- b');
    expect(tight).toContain('<ul class="md-list md-list-bullet">');
    expect(tight).toContain('<li class="md-li">a</li>');
    expect(tight).not.toContain('<p class="md-p">a</p>');
    const loose = renderCommonMark('- a\n\n- b');
    expect(loose).toContain('<li class="md-li">');

    expect(loose).toContain('<p class="md-p">');
  });

  test('ordered lists with start', () => {
    const out = renderCommonMark('1. a\n2. b');
    expect(out).toContain('<ol class="md-list md-list-ordered">');
    expect(out).toContain('<li class="md-li">a</li>');
    const out3 = renderCommonMark('3. a\n4. b');
    expect(out3).toContain('start="3"');
  });

  test('nested lists via indentation', () => {
    const out = renderCommonMark('- a\n  - b\n    - c');
    expect(out.match(/<ul/g)?.length).toBeGreaterThan(1);
    expect(out).toContain('c');
  });
});

describe('renderCommonMark – CommonMark 0.31.2 inlines', () => {
  test('emph and strong with * and _', () => {
    expect(renderCommonMark('*em*')).toContain('<em class="md-em">em</em>');
    expect(renderCommonMark('_em_')).toContain('<em class="md-em">em</em>');
    expect(renderCommonMark('**strong**')).toContain('<strong class="md-strong">strong</strong>');
    expect(renderCommonMark('__strong__')).toContain('<strong class="md-strong">strong</strong>');
    expect(renderCommonMark('**_both_**')).toContain('md-strong');
    expect(renderCommonMark('**_both_**')).toContain('md-em');
  });

  test('code spans', () => {
    expect(renderCommonMark('`code`')).toContain('<code class="md-code">code</code>');
    expect(renderCommonMark('`` code ` span ``')).toContain('md-code');
  });

  test('inline links', () => {
    const out = renderCommonMark('[text](https://example.com)');
    expect(out).toContain('<a class="md-link"');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('>text</a>');
    const withTitle = renderCommonMark('[t](https://example.com "title")');
    expect(withTitle).toContain('title="title"');
  });

  test('reference links', () => {
    const src = '[foo]: /url\n\n[foo]';
    const out = renderCommonMark(src);
    expect(out).toContain('href="/url"');
    expect(out).toContain('foo</a>');
  });

  test('images', () => {
    const out = renderCommonMark('![alt](https://example.com/img.png)');
    expect(out).toContain('<img class="md-image"');
    expect(out).toContain('src="https://example.com/img.png"');
    expect(out).toContain('alt="alt"');
  });

  test('autolinks', () => {
    const out = renderCommonMark('<https://example.com>');
    expect(out).toContain('href="https://example.com"');
    const mail = renderCommonMark('<user@example.com>');
    expect(mail).toContain('user@example.com');
  });

  test('hard and soft breaks', () => {
    const hard = renderCommonMark('foo  \nbar');
    expect(hard).toContain('<br');
    const hard2 = renderCommonMark('foo\\\nbar');
    expect(hard2).toContain('<br');
    const soft = renderCommonMark('foo\nbar');
    expect(soft).toBe('<p class="md-p">foo\nbar</p>');
  });

  test('backslash escapes and entity refs', () => {
    expect(renderCommonMark('\\*not*')).toContain('*not*');
    expect(renderCommonMark('\\[not](x)')).not.toContain('<a');
    const ent = renderCommonMark('&amp; &copy; &lt;');
    expect(ent).toContain('&amp;');
    expect(ent).not.toContain('&copy;');
  });

  test('raw HTML is escaped when safe', () => {
    const out = renderCommonMark('<div>hi</div>');
    expect(out).not.toContain('<div>hi</div>');
    expect(out).toContain('&lt;div&gt;');
  });

  test('link destination is sanitized (javascript: -> #)', () => {
    const out = renderCommonMark('[x](javascript:alert(1))');
    expect(out).toContain('href="#"');
  });
});

describe('renderCommonMarkHtml wrapper', () => {
  test('same as renderCommonMark', () => {
    const src = '# title\n\nhello **world**';
    expect(renderCommonMarkHtml(src)).toContain('md-h1');
    expect(renderCommonMarkHtml(src)).toContain('md-strong');
  });
});
