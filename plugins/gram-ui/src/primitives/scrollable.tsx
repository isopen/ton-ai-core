import { h } from '../framework/jsx-runtime.js';

interface ScrollableProps {
  id?: string;
  className?: string;
  style?: any;
  maxHeight?: string;
  onScroll?: (e: Event) => void;
  children?: any;
}

export function Scrollable(props: ScrollableProps) {
  const { id, className = '', style, maxHeight, onScroll, children } = props;

  const styles: any = {
    overflowY: 'auto',
    overflowX: 'hidden',
    minHeight: 0,
    flex: 1,
    ...(style || {}),
  };

  if (maxHeight) styles.maxHeight = maxHeight;

  return (
    <div id={id} class={'Scrollable' + (className ? ' ' + className : '')} style={styles} onScroll={onScroll}>
      {children}
    </div>
  );
}
