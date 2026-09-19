/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';

function builtCss(): string {
  return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('^' + escaped + '\\s*\\{[^}]*\\}', 'm').exec(css);
  if (!m) throw new Error('missing block ' + selector);
  return m[0];
}

describe('table and button geometry follows font size', () => {
  test('rich table cells use em sizing', () => {
    const css = builtCss();
    const cell = block(css, '.rich-table .rich-cell');
    expect(cell).toContain('min-height: 2.4286em');
    expect(cell).not.toMatch(/min-height:\s*\d+px/);
    const base = block(css, '.rich-cell');
    expect(base).toContain('padding: 0.5em 0.6429em');
    const compact = block(css, '.rich-table_compact .rich-cell');
    expect(compact).toContain('padding: 0.3571em 0.5em');
  });

  test('markdown table cells and margins use em sizing', () => {
    const css = builtCss();
    const cells = block(css, '.md-body .md-th, .md-body .md-td');
    expect(cells).toContain('padding: 0.3571em 0.5em');
    const table = block(css, '.md-body .md-table');
    expect(table).toContain('margin: 0.4286em 0');
  });

  test('rich and keyboard buttons use em sizing', () => {
    const css = builtCss();
    const richBtn = block(css, '.rich-btn');
    expect(richBtn).toContain('padding: 0.8571em 1.1429em');
    expect(richBtn).toContain('border-radius: 1.7143em');
    const kbBtn = block(css, '.MessageBubble__kb-btn');
    expect(kbBtn).toContain('padding: 0.7143em 1em');
    expect(kbBtn).toContain('border-radius: 0.7143em');
    const row = block(css, '.rich-buttons');
    expect(row).toContain('gap: 0.4286em');
    expect(row).toContain('margin: 0.5714em 0');
  });
});

describe('table overflow guards', () => {
  test('rich buttons wrap instead of clipping labels', () => {
    const row = block(builtCss(), '.rich-buttons');
    expect(row).toContain('flex-wrap: wrap');
  });

  test('badge dots never render inside buttons', () => {
    const css = builtCss();
    expect(css).toContain('button .tgui-media-source-badge--dot');
  });

  test('rich table width cap scales with font', () => {
    const css = builtCss();
    const tableBlocks = css.match(/^\.rich-body \.rich-table\s*\{[^}]*\}/gm) || [];
    expect(tableBlocks.length).toBeGreaterThan(0);
    const last = tableBlocks[tableBlocks.length - 1];
    expect(last).toContain('max-width: 25.71em');
  });

  test('table cells clip overflow to keep grid clean', () => {
    const css = builtCss();
    expect(block(css, '.rich-table .rich-cell')).toContain('overflow: hidden');
    expect(block(css, '.md-body .md-th, .md-body .md-td')).toContain('overflow: hidden');
  });
});
