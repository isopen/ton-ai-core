import { h } from '@ton-ai/atom/jsx-runtime';

interface ToastProps {
  text: string;
  visible?: boolean;
  version?: number | string;
  className?: string;
  style?: string;
}

export function Toast({ text, visible = true, version, className = '', style }: ToastProps) {
  if (!visible || !text) return null;
  let cls = 'toast is-visible';
  if (className) cls += ' ' + className;
  return (
    <div key={version} class={cls} style={style}>
      {text}
    </div>
  );
}
