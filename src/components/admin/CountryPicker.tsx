import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Globe, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COUNTRIES, type Country, findCountryByCode, findCountryByName } from '@/lib/countries';
import { cn } from '@/lib/utils';

interface CountryPickerProps {
  /** Stored country value — accepts either ISO-3166 alpha-2 code or full name */
  value?: string | null;
  onChange: (country: Country) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Searchable country picker with dialing codes.
 * Resolves the current value either by ISO code or by exact name.
 */
export function CountryPicker({ value, onChange, placeholder = 'Select country…', className, disabled }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => findCountryByCode(value) ?? findCountryByName(value),
    [value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dial.includes(q.replace(/^\+/, '')),
    );
  }, [query]);

  /** Wrap the matched substring in a highlight span. */
  const renderHighlighted = (text: string) => {
    const q = query.trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                <span className="text-base leading-none">{selected.flag}</span>
                <span className="truncate">{selected.name}</span>
                <span className="text-xs text-muted-foreground">+{selected.dial}</span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4" />
                {placeholder}
              </>
            )}
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 z-[200]"
        align="start"
        side="bottom"
        sideOffset={4}
        avoidCollisions
        collisionPadding={12}
      >
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search countries or dial code…"
              className="h-8 pl-7 text-sm"
              aria-label="Search countries"
            />
          </div>
        </div>
        <div className="max-h-[min(18rem,50vh)] overflow-y-auto py-1 overscroll-contain">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No country matches "{query}"</p>
          ) : (
            filtered.map((country) => {
              const isActive = selected?.code === country.code;
              return (
                <button
                  key={country.code}
                  type="button"
                  data-testid={`country-option-${country.code}`}
                  onClick={() => {
                    onChange(country);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60 transition-colors text-left',
                    isActive && 'bg-muted/40',
                  )}
                >
                  <span className="text-base leading-none">{country.flag}</span>
                  <span className="flex-1 truncate">{renderHighlighted(country.name)}</span>
                  <span className="text-xs text-muted-foreground font-mono">+{country.dial}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}