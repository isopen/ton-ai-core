import { h } from '@ton-ai/atom/jsx-runtime';
import { useRef, useEffect } from '@ton-ai/atom/hooks';

interface TumblerProps {
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

export function Tumbler({
  checked = false,
  disabled = false,
  size = 'medium',
  label = '',
  description = '',
  name,
  value,
  className = '',
  onChange,
}: TumblerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.checked = checked;
  }, [checked]);

  let cls = 'Tumbler Tumbler_size_' + size;
  if (checked) cls += ' Tumbler_on';
  if (disabled) cls += ' Tumbler_disabled';
  if (className) cls += ' ' + className;

  let wrapCls = 'TumblerWrap';
  if (disabled) wrapCls += ' TumblerWrap_disabled';

  return (
    <label class={wrapCls}>
      <input
        ref={(el: HTMLInputElement | null) => { inputRef.current = el; }}
        type="checkbox"
        class="Tumbler__input"
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e: any) => onChange?.(!!(e.target as HTMLInputElement).checked)}
      />
      <span class={cls}>
        <span class="Tumbler__knob" />
      </span>
      {label || description ? (
        <span class="Tumbler__text">
          {label ? <span class="Tumbler__label">{label}</span> : null}
          {description ? <span class="Tumbler__description">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
