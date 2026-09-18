import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { isEnabled, subscribeScope } from '@ton-ai/gram-debug';

const SCOPE = 'gram-ui:media-source-badge';

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
    default:
      return 'home-server';
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
    const mod = source === 'memory'
      ? 'tgui-media-source-badge--mem'
      : source === 'persisted'
        ? 'tgui-media-source-badge--db'
        : 'tgui-media-source-badge--srv';
    const pos = absolute ? 'position:absolute;bottom:0;right:0;z-index:2;' : '';
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
      style={`${pos}background:${source === 'memory' ? '#22c55e' : source === 'persisted' ? '#3b82f6' : '#ef4444'}`}
    >
      {mediaSourceLabel(source)}
    </span>
  );
}
