import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKER = join(__dirname, '..', 'src', 'worker', 'telegram-worker.ts');

function functionBody(src: string, name: string): string {
  const sig = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*[(<]');
  const at = src.search(sig);
  assert.ok(at >= 0, 'function ' + name + ' not found');

  let i = src.indexOf('(', at);
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      i = src.indexOf('\n', i) + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = src.indexOf('*/', i) + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  assert.ok(i < src.length, 'unterminated parameter list in ' + name);

  let angle = 0;
  let open = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '<') angle++;
    else if (ch === '>') angle--;
    else if (ch === '{' && angle <= 0) {
      open = i;
      break;
    } else if (ch === ';' && angle <= 0) break;
    i++;
  }
  assert.ok(open >= 0, 'no body for ' + name);
  depth = 0;
  i = open;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      i = src.indexOf('\n', i) + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = src.indexOf('*/', i) + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i++;
  }
  throw new Error('unbalanced braces in ' + name);
}

function resultLiterals(body: string): string[] {
  const out: string[] = [];
  const re = /(?:return\s+|resolve\s*\(\s*|:\s*DownloadResult\s*=\s*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    while (i < body.length) {
      const ch = body[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        const quote = ch;
        i++;
        while (i < body.length && body[i] !== quote) {
          if (body[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const lit = body.slice(open + 1, i);

          if (/bytes\s*:/.test(lit) && !/^\s*_\s*:/.test(lit)) out.push(lit);
          re.lastIndex = i;
          break;
        }
      }
      i++;
    }
  }
  return out;
}

describe('worker download results always carry a cacheSource', () => {
  const src = readFileSync(WORKER, 'utf8');

  for (const fn of ['downloadFile_', 'downloadFiles_']) {
    test(fn + ' never resolves a successful result without cacheSource', () => {
      const literals = resultLiterals(functionBody(src, fn));
      assert.ok(literals.length > 0, 'no result literals found in ' + fn);
      const missing: string[] = [];
      for (const lit of literals) {
        if (/error\s*:/.test(lit)) continue;
        if (!/cacheSource\s*:/.test(lit)) missing.push(lit.replace(/\s+/g, ' ').trim().slice(0, 90));
      }
      assert.deepStrictEqual(missing, [], fn + ' drops cacheSource on: ' + missing.join(' | '));
    });
  }

  test('the single-chunk path reports the dc the bytes came from', () => {
    const body = functionBody(src, 'downloadFile_');
    const single = body.slice(body.indexOf("'[dl] single chunk"));
    const ret = single.slice(single.indexOf('const res: DownloadResult'));
    assert.match(ret, /cacheSource:\s*serverType/);
  });

  test('the precise-retry path reports a cacheSource too', () => {
    const body = functionBody(src, 'downloadFile_');
    const ret = body.slice(body.indexOf('const res2: DownloadResult'));
    assert.match(ret.slice(0, 200), /cacheSource:\s*serverType/);
  });
});
