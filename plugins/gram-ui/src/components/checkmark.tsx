import { h } from '@ton-ai/atom/jsx-runtime';

interface CheckmarkProps {
  status: 'pending' | 'sent' | 'delivered' | 'read';
  className?: string;
}

const COLOR: Record<CheckmarkProps['status'], string> = {
  pending: 'var(--bubble-meta)',
  sent: 'var(--bubble-meta)',
  delivered: 'var(--bubble-meta)',
  read: 'var(--accent)',
};

export function Checkmark({ status, className = '' }: CheckmarkProps) {
  let cls = 'Checkmark';
  if (className) cls += ' ' + className;

  if (status === 'pending') {
    return <span class={cls} style={`color:${COLOR[status]}`}>○</span>;
  }

  if (status === 'sent' || status === 'delivered') {
    return <span class={cls} style={`color:${COLOR[status]}`}>✓</span>;
  }

  return (
    <span class={cls} style={{ color: COLOR[status] }}>
      <span class="Checkmark__icon">✓</span>
      <span class="Checkmark__icon" style={{ marginLeft: '-7px' }}>✓</span>
    </span>
  );
}
