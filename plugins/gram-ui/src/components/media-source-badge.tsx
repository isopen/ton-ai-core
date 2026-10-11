import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { isEnabled, subscribeScope } from '@ton-ai/gram-debug';

const SCOPE = 'gram-ui:media-source-badge';

export type MediaSource = 'memory' | 'persisted' | 'home-server' | 'cdn-server' | 'migrate-server' | 'glyph' | 'unknown' | (string & {});

function mediaSourceLabel(source?: string): string {
  if (!source) return '';
  switch (source) {
    case 'memory':
      return 'in-memory';
    case 'persisted':
      return 'gram-db';
    case 'cdn-server':
      return 'cdn-server';
    case 'migrate-server':
      return 'migrate-server';
    case 'glyph':
      return 'text glyph';
    case 'unknown':
      return 'unknown';
    default:
      return 'home-server';
  }
}

function sourceModifier(source: string): string {
  switch (source) {
    case 'glyph':
      return 'tgui-media-source-badge--glyph';
    case 'memory':
    case 'persisted':
    case 'unknown':
      return 'tgui-media-source-badge--db';
    default:
      return 'tgui-media-source-badge--srv';
  }
}

function sourceColor(source: string): string {
  switch (sourceModifier(source)) {
    case 'tgui-media-source-badge--glyph':
      return '#22c55e';
    case 'tgui-media-source-badge--db':
      return '#eab308';
    default:
      return '#ef4444';
  }
}

export function MediaSourceBadge({ source, className, absolute = true, variant = 'badge' }: {
  source?: string;
  className?: string;
  absolute?: boolean;
  variant?: 'badge' | 'dot';
}) {
  const [enabled, setEnabled] = useState(() => isEnabled(SCOPE));

  useEffect(() => subscribeScope(SCOPE, () => setEnabled(isEnabled(SCOPE))), []);

  if (!source || !enabled) return null;
  if (variant === 'dot') {
    const mod = sourceModifier(source);

    const pos = absolute ? 'position:absolute;bottom:-3px;right:-3px;z-index:3;' : '';
    return (
      <span
        class={`tgui-media-source-badge tgui-media-source-badge--dot ${mod}${className ? ' ' + className : ''}`}
        style={pos}
        title={mediaSourceLabel(source)}
      />
    );
  }
  const pos = absolute ? 'position:absolute;top:4px;right:4px;z-index:2;' : '';
  return (
    <span
      class={`tgui-media-source-badge${className ? ' ' + className : ''}`}
      style={`${pos}background:${sourceColor(source)}`}
    >
      {mediaSourceLabel(source)}
    </span>
  );
}
