import { h } from '@ton-ai/atom/jsx-runtime';
import { CustomScrollbar } from './custom-scrollbar.js';

interface ScrollableProps {
  id?: string;
  className?: string;
  style?: any;
  maxHeight?: string;
  onScroll?: (e: Event) => void;
  onNearTop?: () => void;
  startAtBottom?: boolean;
  onReadyContent?: (el: HTMLDivElement) => void;
  children?: any;
  virtualItems?: any[];
  renderVirtualItem?: (item: any, index: number) => any;
  estimatedItemHeight?: number;
}

export function Scrollable(props: ScrollableProps) {
  const { id, className, style, maxHeight, onScroll, onNearTop, startAtBottom, onReadyContent, children, virtualItems, renderVirtualItem, estimatedItemHeight } = props;

  return (
    <CustomScrollbar id={id} className={className} style={style} maxHeight={maxHeight} onScroll={onScroll} onNearTop={onNearTop} startAtBottom={startAtBottom} onReadyContent={onReadyContent} virtualItems={virtualItems} renderVirtualItem={renderVirtualItem} estimatedItemHeight={estimatedItemHeight}>
      {children}
    </CustomScrollbar>
  );
}
