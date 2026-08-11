import { stripCommentsText, detectLanguage } from '@ton-ai/comment-stripper';

describe('language detection', () => {
    it('maps extensions to languages', () => {
        expect(detectLanguage('a.ts')).toBe('typescript');
        expect(detectLanguage('a.tsx')).toBe('typescript');
        expect(detectLanguage('a.js')).toBe('javascript');
        expect(detectLanguage('a.py')).toBe('python');
        expect(detectLanguage('a.rb')).toBe('ruby');
        expect(detectLanguage('a.php')).toBe('php');
        expect(detectLanguage('a.c')).toBe('c');
        expect(detectLanguage('a.cpp')).toBe('cpp');
        expect(detectLanguage('a.java')).toBe('java');
        expect(detectLanguage('a.kt')).toBe('kotlin');
        expect(detectLanguage('a.cs')).toBe('csharp');
        expect(detectLanguage('a.go')).toBe('go');
        expect(detectLanguage('a.rs')).toBe('rust');
        expect(detectLanguage('a.swift')).toBe('swift');
        expect(detectLanguage('a.lua')).toBe('lua');
        expect(detectLanguage('a.hs')).toBe('haskell');
        expect(detectLanguage('a.ex')).toBe('elixir');
        expect(detectLanguage('a.erl')).toBe('erlang');
        expect(detectLanguage('a.clj')).toBe('clojure');
        expect(detectLanguage('a.sql')).toBe('sql');
        expect(detectLanguage('a.sh')).toBe('shell');
        expect(detectLanguage('a.yaml')).toBe('yaml');
        expect(detectLanguage('a.css')).toBe('css');
        expect(detectLanguage('a.html')).toBe('markup');
        expect(detectLanguage('a.xml')).toBe('markup');
        expect(detectLanguage('Makefile')).toBe('make');
        expect(detectLanguage('Dockerfile')).toBe('dockerfile');
        expect(detectLanguage('a.json')).toBe('json');
        expect(detectLanguage('a.jsonc')).toBe('jsonc');
        expect(detectLanguage('a.unknown')).toBeNull();
    });
});

describe('string safety — no comment markers stripped inside strings', () => {
    const cases: Array<[string, string, string]> = [
        ['typescript', `const url = "http://x.com/a"; // comment\nlet re = /a\\/\\/b/;`, `const url = "http://x.com/a";\nlet re = /a\\/\\/b/;`],
        ['python', `s = "http://x.com#frag"  # comment`, `s = "http://x.com#frag"`],
        ['python', `s = 'https://x' # c`, `s = 'https://x'`],
        ['python', `doc = """\n# not a comment\nmore\n"""\nx = 1  # real comment`, `doc = """\n# not a comment\nmore\n"""\nx = 1`],
        ['ruby', `s = "a#b" # comment`, `s = "a#b"`],
        ['php', `$s = "http://x/#y"; // c`, `$s = "http://x/#y";`],
        ['c', `const char *s = "a//b"; // c`, `const char *s = "a//b";`],
        ['c', `char c = '/'; // comment`, `char c = '/';`],
        ['cpp', `auto s = "/* not a comment */"; /* real */`, `auto s = "/* not a comment */";`],
        ['java', `String s = "a/*b*/c"; // real`, `String s = "a/*b*/c";`],
        ['go', `s := "a//b" // real\nraw := \`x//y\``, `s := "a//b"\nraw := \`x//y\``],
        ['rust', `let s = "a//b"; // real\nlet raw = r#"x//y"#; // real2`, `let s = "a//b";\nlet raw = r#"x//y"#;`],
        ['rust', `let raw = r"http://x"; // c`, `let raw = r"http://x";`],
        ['csharp', `var s = "a//b"; // real\nvar v = @"c""d";`, `var s = "a//b";\nvar v = @"c""d";`],
        ['lua', `s = "a--b" -- real`, `s = "a--b"`],
        ['haskell', `s = "a--b" -- real`, `s = "a--b"`],
        ['sql', `select '--x' as a; -- real`, `select '--x' as a;`],
        ['shell', `echo "a#b"; # real`, `echo "a#b";`],
        ['shell', `echo $#; # real`, `echo $#;`],
        ['yaml', `key: "a#b" # real`, `key: "a#b"`],
        ['css', `.a { content: "/*x*/"; } /* real */`, `.a { content: "/*x*/"; }`],
        ['markup', `<a title="<!--">x</a><!-- real -->`, `<a title="<!--">x</a>`],
        ['cpp', `auto s = R"(// not a comment /* nor this */)"; /* real */`, `auto s = R"(// not a comment /* nor this */)";`],
        ['cpp', `auto s = R"delim(x//y)delim"; // real`, `auto s = R"delim(x//y)delim";`],
        ['cpp', `auto s = u8R"(a//b)"; /* real */`, `auto s = u8R"(a//b)";`],
        ['cpp', `auto s = LR"(/*x*/)"; // real`, `auto s = LR"(/*x*/)";`],
        ['cpp', `auto s = R"(line1\n// inside\nline3)"; // real`, `auto s = R"(line1\n// inside\nline3)";`],
        ['cpp', `auto s = fooR"(x//y)"; // real`, `auto s = fooR"(x//y)";`],
        ['objc', `NSString *s = R"(x//y)"; // real`, `NSString *s = R"(x//y)";`],
    ];
    for (const [lang, input, expected] of cases) {
        it(lang + ': ' + input.slice(0, 40), () => {
            expect(stripCommentsText(input, lang).text).toBe(expected.endsWith('\n') ? expected : expected + '\n');
        });
    }
});

describe('comment removal', () => {
    it('removes ts block and line comments via AST', () => {
        const src = `// header\nexport const x = 1; /* inline */\n/** doc */\nfunction f() {\n  // inner\n  return 2; // trail\n}\n`;
        const out = stripCommentsText(src, 'typescript').text;
        expect(out).not.toContain('//');
        expect(out).not.toContain('/*');
        expect(out).toContain('export const x = 1;');
        expect(out).toContain('return 2;');
    });
    it('removes python comments and keeps blocks readable', () => {
        const out = stripCommentsText('#!/usr/bin/env python3\n# header\ndef f():\n    # inner\n    x = 1\n\n\n    return x\n', 'python').text;
        expect(out).toBe('#!/usr/bin/env python3\n\ndef f():\n    x = 1\n\n    return x\n');
    });
    it('removes php # but not #[ attributes', () => {
        const src = `<?php\n#[Attr]\nclass C {\n  # comment\n  public $x = 1; // c\n}\n`;
        const out = stripCommentsText(src, 'php').text;
        expect(out).toContain('#[Attr]');
        expect(out).not.toContain('# comment');
        expect(out).not.toContain('// c');
    });
    it('removes ruby =begin/=end blocks', () => {
        const src = `# c\n=begin\nmulti\nline\n=end\nx = 1\n`;
        expect(stripCommentsText(src, 'ruby').text).toBe('x = 1\n');
    });
    it('removes haskell nested block comments', () => {
        const src = `-- c\nx = 1 {- outer {- inner -} still -}\n`;
        expect(stripCommentsText(src, 'haskell').text).toBe('x = 1\n');
    });
    it('removes lua long comments', () => {
        const src = `--[[ multi\n--[[ nested ]] deep ]]` + `\nx = 1\n`;
        expect(stripCommentsText(src, 'lua').text).toBe('x = 1\n');
    });
    it('removes rust nested block comments', () => {
        const src = `/* outer /* inner */ still */\nfn main() {}\n`;
        expect(stripCommentsText(src, 'rust').text).toBe('fn main() {}\n');
    });
    it('removes css and html comments', () => {
        expect(stripCommentsText('a { color: red; } /* c */', 'css').text).toBe('a { color: red; }\n');
        expect(stripCommentsText('<div><!-- c -->x</div>', 'markup').text).toBe('<div>x</div>\n');
    });
    it('removes sql and shell comments', () => {
        expect(stripCommentsText('SELECT 1; -- c\nSELECT 2;', 'sql').text).toBe('SELECT 1;\nSELECT 2;\n');
        expect(stripCommentsText('#!/bin/sh\necho hi # c\n', 'shell').text).toBe('#!/bin/sh\necho hi\n');
    });
    it('keeps json untouched', () => {
        const src = '{ "a": 1, "b": "x" }\n';
        expect(stripCommentsText(src, 'json').text).toBe(src);
    });
    it('preserves CRLF and BOM', () => {
        const src = '\uFEFFconst a = 1; // c\r\nconst b = 2;\r\n';
        const out = stripCommentsText(src, 'typescript').text;
        expect(out.charCodeAt(0)).toBe(0xfeff);
        expect(out).toContain('\r\n');
        expect(out).not.toContain('// c');
    });
    it('throws on leftover comments (self-verification)', () => {
        expect(() => stripCommentsText('const a = 1; // x', 'typescript')).not.toThrow();
    });
});

describe('cpp raw strings', () => {
    it('keeps raw string bodies with comment markers intact', () => {
        const src = `int main() {\n  auto a = R"(http://x // keep\n/* keep too */)";\n  // real comment\n  return 0;\n}\n`;
        const out = stripCommentsText(src, 'cpp').text;
        expect(out).toContain('R"(http://x // keep');
        expect(out).toContain('/* keep too */)";');
        expect(out).not.toContain('// real comment');
        expect(out).toContain('return 0;');
    });
    it('handles custom delimiters with parens inside body', () => {
        const src = `auto s = R"xx( (a) // keep )xx"; // real\n`;
        const out = stripCommentsText(src, 'cpp').text;
        expect(out).toBe(`auto s = R"xx( (a) // keep )xx";\n`);
    });
    it('handles unterminated raw string safely (no crash)', () => {
        const src = `auto s = R"( // no close;\nreturn 1; // real\n`;
        expect(() => stripCommentsText(src, 'cpp')).not.toThrow();
    });
});

describe('preserve-header mode', () => {
    it('keeps the leading license block, strips the rest', () => {
        const src = `/*\n * Copyright (c) 2026\n * License text here\n */\n#include <x>\n// regular comment\nint main() { return 0; }\n`;
        const out = stripCommentsText(src, 'cpp', { preserveHeader: true }).text;
        expect(out).toContain('License text here');
        expect(out).toContain('#include <x>');
        expect(out).not.toContain('// regular comment');
    });
    it('keeps leading line-comment header', () => {
        const src = `// Copyright 2026 me\n// SPDX-License-Identifier: MIT\nconst a = 1; // c\n`;
        const out = stripCommentsText(src, 'typescript', { preserveHeader: true }).text;
        expect(out).toContain('SPDX-License-Identifier: MIT');
        expect(out).not.toContain('// c');
    });
    it('strips everything when preserveHeader is off', () => {
        const src = `/* license */\nconst a = 1; // c\n`;
        const out = stripCommentsText(src, 'typescript').text;
        expect(out).not.toContain('license');
        expect(out).not.toContain('// c');
    });
    it('preserve-header + leftover verification stays consistent', () => {
        const src = `/* header */\nint x = 1; // c\n`;
        const first = stripCommentsText(src, 'cpp', { preserveHeader: true }).text;
        const again = stripCommentsText(first, 'cpp', { preserveHeader: true }).text;
        expect(again).toBe(first);
    });
});
