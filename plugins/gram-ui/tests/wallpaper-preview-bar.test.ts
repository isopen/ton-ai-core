import * as fs from 'fs';
import * as path from 'path';

function builtCss(): string {
  return fs.readFileSync(path.join(process.cwd(), 'plugins/gram-ui/dist/styles.css'), 'utf8');
}

function barBlock(css: string): string {
  const m = /\.tgui-wall-preview-bar\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('missing bar');
  return m[0];
}

function barButtonBlock(css: string): string {
  const m = /\.tgui-wall-preview-bar\s+\.Button\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('missing bar button');
  return m[0];
}

function barGhostBlock(css: string): string {
  const m = /\.tgui-wall-preview-bar\s+\.Button_variant_ghost\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('missing bar ghost');
  return m[0];
}

function barPrimaryBlock(css: string): string {
  const m = /\.tgui-wall-preview-bar\s+\.Button_variant_primary\s*\{[^}]*\}/.exec(css);
  if (!m) throw new Error('missing bar primary');
  return m[0];
}

describe('wallpaper preview bar centered over image', () => {
  test('bar spans card bottom and centers group', () => {
    const css = builtCss();
    const bar = barBlock(css);
    expect(bar).toContain('position: absolute');
    expect(bar).toContain('left: 0');
    expect(bar).toContain('right: 0');
    expect(bar).toContain('bottom: 0');
    expect(bar).toContain('display: flex');
    expect(bar).toContain('justify-content: center');
    expect(bar).toContain('align-items: center');
  });

  test('buttons form compact centered cluster', () => {
    const css = builtCss();
    const btn = barButtonBlock(css);
    expect(btn).toContain('flex: 0 1 auto');
    expect(btn).not.toContain('flex: 1 1 0');
    expect(btn).toContain('max-width: 200px');
  });

  test('close button has gray translucent background', () => {
    const css = builtCss();
    const ghost = barGhostBlock(css);
    expect(ghost).toContain('rgba(115, 120, 128, 0.55)');
    expect(ghost).toContain('#fff');
  });

  test('apply button keeps accent with translucency', () => {
    const css = builtCss();
    const primary = barPrimaryBlock(css);
    expect(primary).toContain('rgba(0, 122, 255, 0.72)');
  });
});
