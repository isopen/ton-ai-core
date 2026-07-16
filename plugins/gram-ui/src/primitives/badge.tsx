import { h } from '../framework/jsx-runtime.js';

interface BadgeProps {
  count: number;
  variant?: 'pill' | 'circle';
  max?: number;
  className?: string;
}

export function Badge(props: BadgeProps) {
  const {
    count,
    variant = 'pill',
    max = 99,
    className = '',
  } = props;

  if (count <= 0) return null;

  const label = count > max ? `${max}+` : String(count);
  let cls = `Badge Badge_variant_${variant} Badge_animated`;
  if (className) cls += ' ' + className;

  return <span class={cls}>{label}</span>;
}
