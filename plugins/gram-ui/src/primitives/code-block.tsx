import { h } from '@ton-ai/atom/jsx-runtime';
import { t, S } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { codeLangClass, detectLang, normalizeLang } from '@ton-ai/tmd';
import { copyToClipboard } from '../utils.js';

const log = getLogger('gram-ui:code-block');

const MAX_LINES = 12;

const CODE_LANG_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JSX',
  javascript: 'JavaScript',
  rs: 'Rust',
  rust: 'Rust',
  py: 'Python',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  csharp: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  sh: 'Bash',
  bash: 'Bash',
  zsh: 'Bash',
  sql: 'SQL',
  xml: 'XML',
  toml: 'TOML',
  dockerfile: 'Docker',
  diff: 'Diff',
  solidity: 'Solidity',
  swift: 'Swift',
  kotlin: 'Kotlin',
};

function langLabel(raw?: string): string {
  const n = normalizeLang(raw);
  if (!n) return 'code';
  return CODE_LANG_LABELS[n] || n.charAt(0).toUpperCase() + n.slice(1);
}


export interface CodeBlockProps {
  code: string;
  lang?: string;
  maxLines?: number;
  defaultExpanded?: boolean;
  className?: string;
}

export function CodeBlock({ code, lang, maxLines = MAX_LINES, defaultExpanded = false, className = '' }: CodeBlockProps) {
  const text = code == null ? '' : code;
  if (!text) return null;

  const collapsed = text.split('\n').length > maxLines && !defaultExpanded;
  const resolved = normalizeLang(lang) || detectLang(text);
  const cls = 'md-codeblock' + (collapsed ? ' is-collapsed' : '') + (className ? ' ' + className : '');

  const onCopy = (e: any) => {
    const btn = e?.currentTarget as HTMLElement | null;
    if (!btn) return;
    copyToClipboard(text).then(() => {
      btn.textContent = t(S.CODE_COPIED);
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = t(S.CODE_COPY);
        btn.classList.remove('is-copied');
      }, 1600);
    }).catch((err) => {
      log.error('[CodeBlock] copy failed', err);
    });
  };

  const onToggle = (e: any) => {
    const btn = e?.currentTarget as HTMLElement | null;
    const block = btn?.closest?.('.md-codeblock') as HTMLElement | null;
    if (!btn || !block) return;
    const isCollapsed = block.classList.toggle('is-collapsed');
    btn.textContent = isCollapsed ? t(S.CODE_EXPAND) : t(S.CODE_COLLAPSE);
  };

  return (
    <div class={cls}>
      <div class="md-codeblock__head">
        <span class="md-codeblock__lang">{langLabel(resolved)}</span>
        <button type="button" class="md-codeblock__copy" aria-label={t(S.CODE_COPY)} title={t(S.CODE_COPY)} onClick={onCopy}>
          {t(S.CODE_COPY)}
        </button>
      </div>
      <div class="md-codeblock__body">
        <pre class="md-pre md-codeblock__pre">
          <code class={`md-code-block ${codeLangClass(resolved)}`}>{text}</code>
        </pre>
      </div>
      {collapsed ? (
        <button type="button" class="md-codeblock__expand" onClick={onToggle}>
          {t(S.CODE_EXPAND)}
        </button>
      ) : null}
    </div>
  );
}

export function codeBlockLangClass(raw?: string): string {
  return codeLangClass(raw);
}
