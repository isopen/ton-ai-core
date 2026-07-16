import { h } from '../framework/jsx-runtime.js';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function Spinner({ size = 'medium', className = '' }: SpinnerProps) {
  let cls = 'Spinner Spinner_size_' + size;
  if (className) cls += ' ' + className;
  return <div class={cls} />;
}
