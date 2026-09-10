import { useState } from "react";
import { Combobox } from "@/components/combobox";
import { useFilterOptions } from "@/features/trades/hooks/use-filter-options";
import type { TradeFilterField } from "@/api/generated/models";

type Props = {
  field: TradeFilterField;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Renders a "clear" entry; omit when the field is required. */
  allLabel?: string;
  emptyValue?: string;
  allowCustomValue?: boolean;
  className?: string;
};

/**
 * A {@link Combobox} wired to the server-side distinct-value search for one
 * trade column. Owns its own search box and only queries while open.
 */
export function FilterCombobox({
  field,
  value,
  onChange,
  label,
  placeholder,
  allLabel,
  emptyValue,
  allowCustomValue,
  className
}: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { values, hasMore, loading } = useFilterOptions(field, search, open);

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={values}
      search={search}
      onSearchChange={setSearch}
      onOpenChange={setOpen}
      loading={loading}
      hasMore={hasMore}
      label={label}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(allLabel === undefined ? {} : { allLabel })}
      {...(emptyValue === undefined ? {} : { emptyValue })}
      {...(allowCustomValue === undefined ? {} : { allowCustomValue })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
