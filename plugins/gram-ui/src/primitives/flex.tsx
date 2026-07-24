import { h } from '@ton-ai/atom/jsx-runtime';

interface FlexProps {
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  align?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
  justify?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  gap?: string | number;
  grow?: boolean | number;
  shrink?: boolean | number;
  fullWidth?: boolean;
  fullHeight?: boolean;
  className?: string;
  style?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
  children?: any;
}

export function Flex(props: FlexProps) {
  const {
    direction = 'row',
    align = 'stretch',
    justify = 'flex-start',
    wrap = 'nowrap',
    gap,
    grow,
    shrink,
    fullWidth,
    fullHeight,
    className = '',
    style,
    onClick,
    children,
  } = props;

  const s: Record<string, string> = {
    display: 'flex',
    flexDirection: direction,
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap,
    ...(style || {}),
  };

  if (gap != null) {
    const v = typeof gap === 'number' ? gap + 'px' : gap;
    s.gap = v;
  }
  if (grow === true) s.flexGrow = '1';
  else if (typeof grow === 'number') s.flexGrow = String(grow);
  if (shrink === true) s.flexShrink = '1';
  else if (typeof shrink === 'number') s.flexShrink = String(shrink);
  if (fullWidth) s.width = '100%';
  if (fullHeight) s.height = '100%';

  const styleStr = Object.entries(s).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';');

  let cls = className;
  if (onClick) cls += ' ' + (cls ? ' ' : '') + 'Flex';

  return (
    <div
      class={cls.trim()}
      style={styleStr}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
