function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  py3: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  dockerfile: 'docker',
  rs: 'rust',
  golang: 'go',
  cplusplus: 'cpp',
  'c++': 'cpp',
  csharp: 'csharp',
  'c#': 'csharp',
  md: 'markdown',
  markdown: 'markdown',
  json5: 'json',
  jsonc: 'json',
  plaintext: 'text',
  plain: 'text',
  txt: 'text',
  sol: 'solidity',
  func: 'func',
  tact: 'tact',
};

const DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'TSX',
  javascript: 'JavaScript',
  jsx: 'JSX',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  cpp: 'C++',
  c: 'C',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Bash',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'LESS',
  markdown: 'Markdown',
  md: 'Markdown',
  docker: 'Docker',
  dockerfile: 'Docker',
  nginx: 'Nginx',
  lua: 'Lua',
  perl: 'Perl',
  r: 'R',
  dart: 'Dart',
  scala: 'Scala',
  haskell: 'Haskell',
  elixir: 'Elixir',
  erlang: 'Erlang',
  clojure: 'Clojure',
  solidity: 'Solidity',
  funс: 'FunC',
  func: 'FunC',
  tact: 'Tact',
  ton: 'TON',
  text: 'code',
  plain: 'code',
  code: 'code',
};

export function normalizeLang(raw?: string): string {
  const l = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9+#_-]/g, '');
  if (!l) return '';
  return LANG_ALIASES[l] || l;
}

export function codeDisplayName(raw?: string): string {
  const n = normalizeLang(raw);
  if (!n) return 'code';
  if (DISPLAY_NAMES[n]) return DISPLAY_NAMES[n];
  if (n.length <= 4) return n.toUpperCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function codeLangClass(raw?: string): string {
  const n = normalizeLang(raw);
  return n ? `language-${n}` : 'language-text';
}

const KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'elif', 'for', 'while',
  'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete', 'typeof',
  'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'throws', 'async',
  'await', 'yield', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'struct', 'impl', 'trait', 'fn', 'pub', 'mut', 'ref', 'move', 'match', 'use',
  'mod', 'crate', 'where', 'loop', 'as', 'is', 'not', 'and', 'or', 'import',
  'from', 'export', 'require', 'module', 'package', 'func', 'defer', 'go', 'chan',
  'select', 'fallthrough', 'def', 'lambda', 'pass', 'raise', 'with', 'assert',
  'print', 'echo', 'static', 'public', 'private', 'protected', 'final', 'void',
  'int', 'float', 'double', 'bool', 'boolean', 'string', 'char', 'long', 'short',
  'true', 'false', 'null', 'nil', 'none', 'undefined', 'nan', 'self', 'super',
  'this', 'constructor', 'get', 'set', 'operator', 'template', 'typename',
  'namespace', 'virtual', 'override', 'abstract', 'sealed', 'readonly', 'volatile',
  'synchronized', 'throws', 'extends', 'super', 'SELECT', 'FROM', 'WHERE', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING',
  'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'UNION', 'ALL', 'DISTINCT',
  'AND', 'OR', 'NOT', 'NULL', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
];

const KW_RE_SRC = '\\b(?:' + KEYWORDS.join('|') + ')\\b';

const TOKEN_RE = new RegExp(
  '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->|(?:^|\\n)\\s*#[^\\n]*)' +
    '|(?<str>"(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\.)*`?)' +
    '|(?<kw>' + KW_RE_SRC + ')' +
    '|(?<num>\\b0x[0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)' +
    '|(?<fn>[A-Za-z_$][\\w$]*(?=\\s*\\())',
  'g',
);

const MAX_HIGHLIGHT_LEN = 60000;

export function highlightCode(src: string, _lang?: string): string {
  if (src == null) return '';
  const text = String(src);
  if (!text) return '';
  if (text.length > MAX_HIGHLIGHT_LEN) return escHtml(text);
  TOKEN_RE.lastIndex = 0;
  if (!TOKEN_RE.test(text)) return escHtml(text);
  TOKEN_RE.lastIndex = 0;

  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const idx = m.index;
    if (idx > last) out += escHtml(text.slice(last, idx));
    const g = (m.groups || {}) as Record<string, string | undefined>;
    const tok = m[0];
    if (g.comment !== undefined) {
      if (tok.charAt(0) === '\n') {
        out += '\n' + '<span class="tok-c">' + escHtml(tok.slice(1)) + '</span>';
      } else {
        out += '<span class="tok-c">' + escHtml(tok) + '</span>';
      }
    } else if (g.str !== undefined) {
      out += '<span class="tok-s">' + escHtml(tok) + '</span>';
    } else if (g.kw !== undefined) {
      out += '<span class="tok-k">' + escHtml(tok) + '</span>';
    } else if (g.num !== undefined) {
      out += '<span class="tok-n">' + escHtml(tok) + '</span>';
    } else if (g.fn !== undefined) {
      out += '<span class="tok-f">' + escHtml(tok) + '</span>';
    } else {
      out += escHtml(tok);
    }
    last = idx + tok.length;
    if (tok.length === 0) {
      TOKEN_RE.lastIndex++;
      last = TOKEN_RE.lastIndex;
    }
    if (out.length > MAX_HIGHLIGHT_LEN * 6) {
      out += escHtml(text.slice(last));
      return out;
    }
  }
  if (last < text.length) out += escHtml(text.slice(last));
  return out;
}
