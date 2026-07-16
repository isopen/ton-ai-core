import { h } from '../framework/jsx-runtime.js';
import { useState, useEffect, useRef } from '../framework/hooks.js';
import { Scrollable } from './scrollable.js';
import { SelectSearch } from './select-search.js';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  label?: string;
  labelAlign?: 'left' | 'center' | 'right';
  renderOption?: (option: SelectOption, isSelected: boolean) => any;
  renderTrigger?: (option: SelectOption) => any;
}

export function Select(props: SelectProps) {
  const {
    value,
    onChange,
    options,
    placeholder,
    disabled = false,
    className = '',
    searchable = false,
    label,
    labelAlign = 'left',
    renderOption,
    renderTrigger,
  } = props;

  const [isOpen, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const allOptions = [...options];
  if (placeholder && !allOptions.some(o => o.value === '')) {
    allOptions.unshift({ value: '', label: placeholder });
  }

  const filteredOptions = searchable && searchQuery
    ? allOptions.filter(o =>
        o.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.value.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allOptions;

  const selectedOption = allOptions.find(o => o.value === value);
  const displayLabel = selectedOption?.label || value || placeholder || '';

  useEffect(() => {
    if (!isOpen) {
      if (searchQuery) setSearchQuery('');
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  function handleSelect(optValue: string) {
    if (optValue !== value) {
      onChange({ target: { value: optValue } });
    }
    setOpen(false);
  }

  function handleTriggerClick() {
    if (!disabled) {
      setOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
      }
    }
  }

  let cls = 'Input Input_select Input_mode_default Input_size_medium';
  if (disabled) cls += ' Input_disabled';
  if (isOpen) cls += ' Input_select--open';
  if (label) cls += ' Input_floating';
  if (className) cls += ' ' + className;

  return (
    <div class={cls} ref={containerRef}>
      {label && (
        <label class={'Input_floating-label Input_floating-label_' + labelAlign}>
          {label}
        </label>
      )}
      <div class="Input_select-trigger" onClick={handleTriggerClick}>
        <span class="Input_select-label">{renderTrigger && selectedOption ? renderTrigger(selectedOption) : displayLabel}</span>
        <span class="Input_select-arrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {isOpen && (
        <Scrollable className="Input_select-menu" maxHeight="280px">
          {searchable && (
            <SelectSearch value={searchQuery} onChange={setSearchQuery} />
          )}
          {filteredOptions.map(o => {
            const isSelected = o.value === value;
            return (
              <div
                key={o.value}
                class={'Input_select-option' + (isSelected ? ' Input_select-option--selected' : '')}
                onClick={() => handleSelect(o.value)}
              >
                {renderOption ? renderOption(o, isSelected) : o.label}
              </div>
            );
          })}
          {filteredOptions.length === 0 && (
            <div class="Input_select-empty">No results</div>
          )}
        </Scrollable>
      )}
    </div>
  );
}
