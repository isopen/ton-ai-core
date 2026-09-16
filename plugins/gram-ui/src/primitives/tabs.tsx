import { h } from '@ton-ai/atom/jsx-runtime';

export interface TabsItem {
  id: string;
  label?: string;
  icon?: any;
  ariaLabel?: string;
}

export interface TabsProps {
  label: string;
  items: TabsItem[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function Tabs({ label, items, active, onSelect, className }: TabsProps) {
  return (
    <nav class={'TguiTabs' + (className ? ' ' + className : '')} aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          class={'TguiTabs__tab' + (item.id === active ? ' is-active' : '')}
          aria-label={item.ariaLabel}
          onClick={() => onSelect(item.id)}
        >
          {item.icon ? <span class="TguiTabs__icon">{item.icon}</span> : null}
          {item.label != null ? <span class="TguiTabs__label">{item.label}</span> : null}
        </button>
      ))}
    </nav>
  );
}
