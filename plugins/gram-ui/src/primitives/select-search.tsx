import { h } from '../framework/jsx-runtime.js';
import { useEffect, useRef } from '../framework/hooks.js';

interface SelectSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function SelectSearch(props: SelectSearchProps) {
  const { value, onChange } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleInput(e: Event) {
    onChange((e.target as HTMLInputElement).value);
  }

  function handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
  }

  return (
    <div class="Input_select-search">
      <input
        ref={inputRef}
        type="text"
        class="Input_select-search-input"
        placeholder="Search..."
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
