import { useId, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  /** Options for the current search term. Filtering happens upstream. */
  options: readonly string[];
  search: string;
  onSearchChange: (search: string) => void;
  onOpenChange?: (open: boolean) => void;
  loading?: boolean;
  /** True when the option list was capped by the server. */
  hasMore?: boolean;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Renders a "clear" entry with this label, bound to `emptyValue`. */
  allLabel?: string;
  emptyValue?: string;
  /**
   * Lets the user commit a term that is not in the list — needed when booking
   * against a counterparty the blotter has not traded with before.
   */
  allowCustomValue?: boolean;
  className?: string;
  contentClassName?: string;
};

/**
 * Searchable single-select built from Popover + Command.
 *
 * Options are supplied by the caller and never filtered here: the source is a
 * server-side search, so the list stays correct when there are more values than
 * any one page — or any one response — could hold.
 */
export function Combobox({
  value,
  onChange,
  options,
  search,
  onSearchChange,
  onOpenChange,
  loading = false,
  hasMore = false,
  label,
  placeholder,
  searchPlaceholder,
  allLabel,
  emptyValue = "",
  allowCustomValue = false,
  className,
  contentClassName
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  const isEmpty = value === emptyValue;
  const trimmedSearch = search.trim();
  const canAddCustom =
    allowCustomValue &&
    trimmedSearch.length > 0 &&
    !options.some((option) => option.toLowerCase() === trimmedSearch.toLowerCase());

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    onSearchChange("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) onSearchChange("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          className={cn(
            "flex h-8 w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-cell-2 whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "dark:bg-input/30 dark:hover:bg-input/50",
            isEmpty && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{isEmpty ? (placeholder ?? label) : value}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className={cn("w-[260px] p-0", contentClassName)}>
        {/* Server-side search, so cmdk must not filter the list again. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
            className="text-cell-2"
          />
          <CommandList id={listId}>
            {loading && options.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-4 text-cell-2 text-ink-5">
                <Loader2 className="size-3.5 animate-spin" />
                Searching…
              </div>
            ) : (
              <>
                {!canAddCustom && <CommandEmpty className="py-4 text-cell-2">No matches.</CommandEmpty>}

                <CommandGroup>
                  {allLabel && (
                    <CommandItem value="__all__" onSelect={() => commit(emptyValue)} className="text-cell-2">
                      <Check className={cn("size-3.5", isEmpty ? "opacity-100" : "opacity-0")} />
                      {allLabel}
                    </CommandItem>
                  )}

                  {options.map((option) => (
                    <CommandItem
                      key={option}
                      value={option}
                      // Bound to the option itself — cmdk normalises the value it passes back.
                      onSelect={() => commit(option)}
                      className="text-cell-2"
                    >
                      <Check
                        className={cn("size-3.5", option === value ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate">{option}</span>
                    </CommandItem>
                  ))}

                  {canAddCustom && (
                    <CommandItem
                      value={`__custom__${trimmedSearch}`}
                      onSelect={() => commit(trimmedSearch)}
                      className="text-cell-2"
                    >
                      <Check className="size-3.5 opacity-0" />
                      Use “{trimmedSearch}”
                    </CommandItem>
                  )}
                </CommandGroup>

                {hasMore && (
                  <p className="border-t border-line px-3 py-2 text-mini-2 text-ink-5">
                    More values exist — keep typing to narrow the list.
                  </p>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
