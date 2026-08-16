import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { isEnabled, subscribeScope } from '@ton-ai/gram-debug';

const SCOPE = 'gram-ui:media-source-badge';

export function mediaSourceLabel(source?: string): string {
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

export function MediaSourceBadge({ source, className, absolute = true }: {
  source?: string;
  className?: string;
  absolute?: boolean;
}) {
  const [enabled, setEnabled] = useState(() => isEnabled(SCOPE));

  useEffect(() => subscribeScope(SCOPE, () => setEnabled(isEnabled(SCOPE))), []);

  if (!source || !enabled) return null;
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
