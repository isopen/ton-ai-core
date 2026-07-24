import { h } from '@ton-ai/atom/jsx-runtime';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dotColor = status === 'connected' ? '#2ecc71'
    : status === 'connecting' ? '#f39c12'
    : '#e74c3c';
  return (
    <div class={`tgui-connection-indicator tgui-connection-${status}`}>
      <span class="tgui-connection-dot" style={`background:${dotColor}`} />
    </div>
  );
}
