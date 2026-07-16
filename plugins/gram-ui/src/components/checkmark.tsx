import { h } from '../framework/jsx-runtime.js';

interface CheckmarkProps {
  status: 'pending' | 'sent' | 'delivered' | 'read';
  className?: string;
}

const COLOR: Record<CheckmarkProps['status'], string> = {
  pending: '#888',
  sent: '#888',
  delivered: '#888',
  read: '#5ba3ff',
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
