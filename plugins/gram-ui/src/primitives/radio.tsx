import { h } from '@ton-ai/atom/jsx-runtime';
import { useRef, useEffect } from '@ton-ai/atom/hooks';

interface RadioProps {
  checked?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  label?: string;
  description?: string;
  name?: string;
  value?: string;
  className?: string;
  onChange?: (checked: boolean) => void;
}

export function Radio({
  checked = false,
  disabled = false,
  size = 'medium',
  label = '',
  description = '',
  name,
  value,
  className = '',
  onChange,
}: RadioProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.checked = checked;
  }, [checked]);

  let cls = 'Radio Radio_size_' + size;
  if (checked) cls += ' Radio_selected';
  if (disabled) cls += ' Radio_disabled';
  if (className) cls += ' ' + className;

  let wrapCls = 'RadioWrap';
  if (disabled) wrapCls += ' RadioWrap_disabled';

  return (
    <label class={wrapCls}>
      <input
        ref={(el: HTMLInputElement | null) => { inputRef.current = el; }}
        type="radio"
        class="Radio__input"
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e: any) => onChange?.(!!(e.target as HTMLInputElement).checked)}
      />
      <span class={cls}>
        <span class="Radio__dot" />
      </span>
      {label || description ? (
        <span class="Radio__text">
          {label ? <span class="Radio__label">{label}</span> : null}
          {description ? <span class="Radio__description">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
