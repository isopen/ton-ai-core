import { h } from '@ton-ai/atom/jsx-runtime';

interface IconButtonProps {
  label: string;
  title?: string;
  onClick: (e: MouseEvent) => void;
  className?: string;
  children?: any;
}

export function IconButton({ label, title, onClick, className, children }: IconButtonProps) {
  return (
    <button
      type="button"
      class={'IconButton' + (className ? ' ' + className : '')}
      aria-label={label}
      title={title || label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
