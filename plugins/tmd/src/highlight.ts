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

interface LangRule {
  lang: string;
  test: RegExp;
  weight?: number;
  needs?: RegExp[];
}

const JSX_SYNTAX = /<[A-Za-z][\w.-]*(?:\s[^<>]*)?>[\s\S]*<\/[A-Za-z][\w.-]*>|className=/;
const TS_DECL = /\b(?:interface|type|enum)\s+\w+/;
const TS_ANNOTATION = /:\s*(?:string|number|boolean|void|any|unknown|never|JSX\.Element|React\.\w+)\b/;

const STRONG_RULES: LangRule[] = [
  { lang: 'bash', test: /^\s*#!\s*\/(usr\/bin\/env\s+)?(bash|sh|zsh)\b/ },
  { lang: 'bash', test: /^\s*(#!\/(bin\/(ba)?sh)|source\s+\S+|\$\{?\w+\}?\s*=) /m },
  { lang: 'python', test: /^\s*#!\s*\/(usr\/bin\/env\s+)?python\d?\b/ },
  { lang: 'python', test: /\bdef\s+\w+\s*\([^)]*\)\s*(->\s*[\w\[\], .]+)?:\s*$/m, weight: 5 },
  { lang: 'python', test: /\b(print|self|elif|lambda|yield from|__init__|__name__)\b/, weight: 5 },
  { lang: 'rust', test: /\b(fn|impl|trait|struct|enum|match|mod|use|crate|pub|mut|where|loop)\b[\s\S]*?(->|::|\{)/ },
  { lang: 'rust', test: /\blet\s+(mut\s+)?\w+\s*(:\s*[\w:<>]+)?\s*=/ },
  { lang: 'rust', test: /&(mut\s+)?(str|String|self|[\w:]+)/ },
  { lang: 'go', test: /\b(package|func|import)\s+(main|\w+|\()[\s\S]*?(\{|\n)/ },
  { lang: 'go', test: /:=\s|= err\b|\bgo func\b|\bdefer\s+\w+\(/ },
  { lang: 'java', test: /\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>\[\]]+\s+\w+\s*\(/ },
  { lang: 'kotlin', test: /\b(fun|val|var|object|companion|data class|sealed|suspend)\b/ },
  { lang: 'swift', test: /\b(func|let|var|import Swift|@objc|guard let|defer)\b/ },
  { lang: 'csharp', test: /\b(namespace|using System|public class|private class|Console\.WriteLine|var\s+\w+\s*=)/ },
  { lang: 'php', test: /<\?php|\$this->|\becho\s+["']/ },
  { lang: 'ruby', test: /\b(def|end|require|puts|attr_accessor|module|class)\b[\s\S]*?\bend\b/ },
  { lang: 'typescript', test: /\b(interface|type|enum|namespace|implements|declare|readonly|private|public)\b/ },
  { lang: 'typescript', test: /:\s*(string|number|boolean|void|any|unknown|never|Promise<[\w<>]+>|[\w]+\[\])\b/ },
  { lang: 'typescript', test: /<[A-Z]\w*(Props|State|Ref)\b/ },
  { lang: 'tsx', test: JSX_SYNTAX, needs: [TS_DECL, TS_ANNOTATION], weight: 5 },
  { lang: 'tsx', test: JSX_SYNTAX, needs: [TS_DECL], weight: 5 },
  { lang: 'tsx', test: JSX_SYNTAX, needs: [TS_ANNOTATION], weight: 5 },
  { lang: 'jsx', test: JSX_SYNTAX, weight: 4 },
  { lang: 'javascript', test: /\b(const|let|var|function|=>|require\(|module\.exports|export default|async|await)\b/ },
  { lang: 'html', test: /<!DOCTYPE html>|<html[\s>]|<head[\s>]|<body[\s>]/i, weight: 6 },
  { lang: 'xml', test: /^<\?xml\s+version/i },
  { lang: 'svg', test: /<svg[\s>]|<path\s+d=/i },
  { lang: 'css', test: /\{\s*[\w-]+\s*:\s*[^;]+;\s*\}/, weight: 1 },
  { lang: 'css', test: /@media\s|@import\s|@keyframes\s/ },
  { lang: 'scss', test: /\$[\w-]+\s*:|@include\s|@mixin\s/ },
  { lang: 'json', test: /^\s*[{\[]\s*("[^"]*"\s*:\s*[^,]+,?\s*)+[}\]]\s*$/ },
  { lang: 'json', test: /^\s*\{\s*\n\s*"/ },
  { lang: 'yaml', test: /^\s*[\w.-]+:\s*(&|$|\S)/m, weight: 1 },
  { lang: 'yaml', test: /^\s*-\s+[\w.-]+:/m },
  { lang: 'toml', test: /^\s*\[[\w.-]+\]\s*$/m, weight: 1 },
  { lang: 'sql', test: /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE)\b[\s\S]*?\b(FROM|INTO|TABLE|SET|VALUES)\b/i },
  { lang: 'dockerfile', test: /^\s*FROM\s+\S+\s*$/m },
  { lang: 'dockerfile', test: /^\s*(RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|WORKDIR|EXPOSE)\s+/m },
  { lang: 'diff', test: /^(diff --git|---\s|\+\+\+\s|@@\s.*@@)/m },
  { lang: 'markdown', test: /^#{1,6}\s+\S/m, weight: 1 },
  { lang: 'markdown', test: /^\s*[-*+]\s+\S/m, weight: 1 },
  { lang: 'solidity', test: /\b(pragma solidity|contract\s+\w+|function\s*\([^)]*\)\s*(public|external|internal|private)?\s*(view|pure|payable)?\s*(returns)?\s*\()/ },
  { lang: 'cpp', test: /\b(std::|cout|cin|endl|namespace\s+\w+|template\s*<|class\s+\w+\s*(final)?\s*[:{])/, weight: 4 },
  { lang: 'c', test: /#include\s*<[\w./]+>/, weight: 1 },
];

const DETECT_MAX_LEN = 20000;

export function detectLang(code: string): string {
  if (!code) return '';
  const text = String(code);
  if (text.length > DETECT_MAX_LEN) return '';
  let bestLang = '';
  let bestScore = 0;
  for (const rule of STRONG_RULES) {
    if (!rule.test.test(text)) continue;
    if (rule.needs && !rule.needs.every((re) => re.test(text))) continue;
    const score = rule.weight ?? 3;
    if (score > bestScore) { bestScore = score; bestLang = rule.lang; }
  }
  return bestLang;
}

export function resolveLang(raw: string | undefined, code: string): string {
  const explicit = normalizeLang(raw);
  if (explicit) return explicit;
  return detectLang(code);
}
