import { h } from '../framework/jsx-runtime.js';

interface ListItemProps {
  before?: any;
  after?: any;
  selected?: boolean;
  collapsed?: boolean;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  children?: any;
}

export function ListItem(props: ListItemProps) {
  const {
    before,
    after,
    selected = false,
    collapsed = false,
    className = '',
    onClick,
    children,
  } = props;

  let cls = 'ListItem';
  if (selected) cls += ' ListItem_selected';
  if (collapsed) cls += ' ListItem_collapsed';
  if (className) cls += ' ' + className;

  return (
    <div class={cls} onClick={onClick}>
      {before ? <div class="ListItem__before">{before}</div> : null}
      {!collapsed ? <div class="ListItem__content">{children}</div> : null}
      {!collapsed && after ? <div class="ListItem__after">{after}</div> : null}
    </div>
  );
}
