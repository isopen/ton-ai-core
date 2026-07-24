import { h } from '@ton-ai/atom/jsx-runtime';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'small' | 'medium' | 'large';
  stretched?: boolean;
  active?: boolean;
  disabled?: boolean;
  id?: string;
  title?: string;
  key?: string;
  className?: string;
  onClick: (e: MouseEvent) => void;
  children?: any;
}

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'medium',
    stretched = false,
    active = false,
    disabled = false,
    id,
    title,
    className = '',
    onClick,
    children,
  } = props;

  let cls = 'Button';
  cls += ' Button_variant_' + variant;
  cls += ' Button_size_' + size;
  if (stretched) cls += ' Button_stretched';
  if (disabled) cls += ' Button_disabled';
  if (active) cls += ' Button_pressed';
  if (className) cls += ' ' + className;

  return (
    <button
      id={id}
      title={title}
      class={cls}
      disabled={disabled}
      onClick={onClick}
    >
      <span class="Button__content">{children}</span>
    </button>
  );
}
