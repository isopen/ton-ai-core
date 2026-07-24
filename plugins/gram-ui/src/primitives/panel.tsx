import { h } from '@ton-ai/atom/jsx-runtime';

interface PanelProps {
  mode?: 'primary' | 'secondary';
  centeredX?: boolean;
  centeredY?: boolean;
  className?: string;
  children?: any;
}

export function Panel(props: PanelProps) {
  const {
    mode = 'primary',
    centeredX = false,
    centeredY = false,
    className = '',
    children,
  } = props;

  let cls = 'Panel Panel_mode_' + mode;
  if (centeredX) cls += ' Panel_centeredX';
  if (centeredY) cls += ' Panel_centeredY';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      {children}
    </div>
  );
}
