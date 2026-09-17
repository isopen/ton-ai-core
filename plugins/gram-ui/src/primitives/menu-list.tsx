import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';

export interface MenuListItem {
  id: string;
  label: string;
  onSelect?: (id: string) => void;
}

interface MenuListProps {
  items?: MenuListItem[];
  width?: number | string;
  title?: string;
  collapsible?: boolean;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  className?: string;
  bare?: boolean;
  children?: any;
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class={'tgui-menu-chevron' + (open ? ' tgui-menu-chevron_open' : '')}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function MenuList({
  items = [],
  width,
  title = '',
  collapsible = false,
  expanded,
  defaultExpanded = false,
  onToggle,
  className = '',
  bare = false,
  children,
}: MenuListProps) {
  const [innerOpen, setInnerOpen] = useState(defaultExpanded);
  const controlled = expanded !== undefined;
  const open = controlled ? (expanded as boolean) : innerOpen;
  const canCollapse = collapsible && title !== '';
  const shown = canCollapse ? open : true;

  const toggle = () => {
    const next = !open;
    if (!controlled) setInnerOpen(next);
    onToggle?.(next);
  };

  let cls = bare ? 'tgui-menu-list tgui-menu-list_bare' : 'tgui-settings-card tgui-menu-list';
  if (className) cls += ' ' + className;
  let style = '';
  if (width !== undefined) style = 'width:' + (typeof width === 'number' ? width + 'px' : width) + ';max-width:100%';

  return (
    <div class={cls} style={style}>
      {canCollapse ? (
        <button class="tgui-menu-item" aria-expanded={open ? 'true' : 'false'} onClick={toggle}>
          <span class="tgui-menu-label">{title}</span>
          <Chevron open={open} />
        </button>
      ) : null}
      {shown ? (
        <Fragment>
          {items.map((item) => (
            <button key={item.id} class="tgui-menu-item" onClick={() => item.onSelect?.(item.id)}>
              <span class="tgui-menu-label">{item.label}</span>
              <Chevron />
            </button>
          ))}
          {children ? <div class="tgui-menu-content">{children}</div> : null}
        </Fragment>
      ) : null}
    </div>
  );
}
