import { h } from '@ton-ai/atom/jsx-runtime';

interface TextFieldProps {
  id?: string;
  type?: 'text' | 'password' | 'tel';
  placeholder?: string;
  value?: string;
  mode?: 'default' | 'contrast' | 'chat';
  code?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  className?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onChange?: (e: Event) => void;
  label?: string;
  labelAlign?: 'left' | 'center' | 'right';
}

export function TextField(props: TextFieldProps) {
  const {
    id,
    type = 'text',
    placeholder,
    value,
    mode = 'default',
    code = false,
    disabled = false,
    autofocus = false,
    className = '',
    onKeyDown,
    onBlur,
    onChange,
    label,
    labelAlign = 'left',
  } = props;

  let cls = 'Input';
  cls += ' Input_mode_' + mode;
  cls += ' Input_size_medium';
  if (disabled) cls += ' Input_disabled';
  if (code) cls += ' Input_code';
  if (className) cls += ' ' + className;

  const input = (
    <input
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      class={cls}
      disabled={disabled}
      autofocus={autofocus}
      onkeydown={onKeyDown}
      onblur={onBlur}
      onchange={onChange}
    />
  );

  if (label) {
    return (
      <div class="Input_floating">
        <label class={'Input_floating-label Input_floating-label_' + labelAlign}>
          {label}
        </label>
        {input}
      </div>
    );
  }

  return input;
}
