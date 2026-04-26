import { useEffect, useRef, useState } from 'react';
import { Input } from './input';

export type ComboboxOption = {
  label: string;
  sublabel?: string;
  value: string;
};

type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: ComboboxOption) => void;
  options: ComboboxOption[];
  placeholder?: string;
  maxResults?: number;
};

export function Combobox({ value, onChange, onSelect, options, placeholder, maxResults = 8 }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered =
    value.trim().length > 0
      ? options
          .filter(
            (opt) =>
              opt.label.toLowerCase().includes(value.toLowerCase()) ||
              (opt.sublabel && opt.sublabel.toLowerCase().includes(value.toLowerCase())),
          )
          .slice(0, maxResults)
      : [];

  useEffect(() => {
    setHighlighted(0);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || !filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && filtered[highlighted]) {
      e.preventDefault();
      onSelect(filtered[highlighted]);
      setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-md border border-border bg-background shadow-lg">
          {filtered.map((opt, i) => (
            <div
              key={opt.value}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground'
              }`}
              onMouseDown={() => {
                onSelect(opt);
                setOpen(false);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="font-medium">{opt.label}</div>
              {opt.sublabel && <div className="text-xs text-muted-foreground">{opt.sublabel}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
