import { h } from '../framework/jsx-runtime.js';

interface TextProps {
  variant?: 'label' | 'desc' | 'caption' | 'title';
  className?: string;
  children?: any;
}

export function Text({ variant = 'label', className = '', children }: TextProps) {
  let cls = 'Text Text_variant_' + variant;
  if (className) cls += ' ' + className;
  return <span class={cls}>{children}</span>;
}
