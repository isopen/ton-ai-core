import { h } from '@ton-ai/atom/jsx-runtime';
import { useRef, useEffect } from '@ton-ai/atom/hooks';

interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  label?: string;
  className?: string;
  onChange?: (checked: boolean) => void;
}

function CheckGlyph() {
  return (
    <svg class="Checkbox__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function DashGlyph() {
  return (
    <svg class="Checkbox__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
      <path d="M6 12h12" />
    </svg>
  );
}

export function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  size = 'medium',
  label = '',
  className = '',
  onChange,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
      inputRef.current.checked = checked;
    }
  }, [indeterminate, checked]);

  const selected = checked || indeterminate;
  let cls = 'Checkbox Checkbox_size_' + size;
  if (selected) cls += ' Checkbox_selected';
  if (indeterminate) cls += ' Checkbox_indeterminate';
  if (disabled) cls += ' Checkbox_disabled';
  if (className) cls += ' ' + className;

  let wrapCls = 'CheckboxWrap';
  if (disabled) wrapCls += ' CheckboxWrap_disabled';

  return (
    <label class={wrapCls}>
      <input
        ref={(el: HTMLInputElement | null) => { inputRef.current = el; }}
        type="checkbox"
        class="Checkbox__input"
        disabled={disabled}
        onChange={(e: any) => onChange?.(!!(e.target as HTMLInputElement).checked)}
      />
      <span class={cls}>
        {indeterminate ? <DashGlyph /> : <CheckGlyph />}
      </span>
      {label ? <span class="Checkbox__label">{label}</span> : null}
    </label>
  );
}
