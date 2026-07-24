import { h } from '@ton-ai/atom/jsx-runtime';

interface IconButtonProps {
  onClick?: (e: MouseEvent) => void;
  className?: string;
  children?: any;
}

export function IconButton(props: IconButtonProps) {
  const {
    onClick,
    className = '',
    children,
  } = props;

  let cls = 'IconButton';
  if (className) cls += ' ' + className;

  return (
    <div class={cls} onClick={onClick}>
      {children}
    </div>
  );
}
