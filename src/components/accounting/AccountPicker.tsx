import { useState, useMemo } from 'react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PickerAccount {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
}

const TYPE_LABELS: Record<PickerAccount['type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

interface Props {
  accounts: PickerAccount[];
  value: string;
  onChange: (id: string) => void;
  /** Restrict by account type. */
  types?: PickerAccount['type'][];
  /** Restrict by code prefix (e.g. ['10','11'] for cash & pending payouts). */
  codePrefixes?: string[];
  /** Restrict to specific account codes (overrides everything else). */
  codes?: string[];
  placeholder?: string;
  disabled?: boolean;
}

export function AccountPicker({
  accounts,
  value,
  onChange,
  types,
  codePrefixes,
  codes,
  placeholder = 'Select account',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => accounts.filter((a) => {
    if (codes && !codes.includes(a.code)) return false;
    if (types && !types.includes(a.type)) return false;
    if (codePrefixes && !codePrefixes.some((p) => a.code.startsWith(p))) return false;
    return true;
  }), [accounts, types, codePrefixes, codes]);

  const selected = accounts.find((a) => a.id === value);

  // Group by type for clarity
  const grouped = useMemo(() => filtered.reduce<Record<string, PickerAccount[]>>((acc, a) => {
    (acc[a.type] = acc[a.type] || []).push(a);
    return acc;
  }, {}), [filtered]);

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-muted-foreground',
          )}
        >
          {selected ? (
            <span className="truncate">
              <span className="font-mono text-xs text-muted-foreground mr-2">{selected.code}</span>
              {selected.name}
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const acc = filtered.find((a) => a.id === itemValue);
            if (!acc) return 0;
            const haystack = `${acc.code} ${acc.name}`.toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by code or name…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching accounts.</CommandEmpty>
            {Object.entries(grouped).map(([type, list]) => (
              <CommandGroup
                key={type}
                heading={TYPE_LABELS[type as PickerAccount['type']]}
              >
                {list.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.id}
                    onSelect={() => { onChange(a.id); setOpen(false); }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === a.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                    <span className="truncate">{a.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
