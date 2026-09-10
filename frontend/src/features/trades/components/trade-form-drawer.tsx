import { useMemo, type FormEvent } from "react";
import Decimal from "decimal.js";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { ConflictPanel } from "@/features/trades/components/conflict-panel";
import { FilterCombobox } from "@/features/trades/components/filter-combobox";
import type { VersionConflict } from "@/features/trades/hooks/use-trade-mutations";
import type { TradeFormMode } from "@/features/trades/hooks/use-trade-workflow";
import {
  toTradeCommand,
  type AmendableField,
  type FieldErrors,
  type FormValues
} from "@/features/trades/lib/trade-form";
import { formatNotional, formatQuantity, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionUser, Trade, TradeSide } from "@/types/trade";

export type { TradeFormMode };

/**
 * Fully controlled: the values, which fields are dirty, and every error come
 * from `useTradeWorkflow`. Nothing here resets state in response to a changed
 * prop, so a re-render triggered by an incoming SSE event cannot disturb what
 * the user has typed.
 */
type Props = {
  mode: TradeFormMode | null;
  values: FormValues | null;
  onChange: (values: FormValues) => void;
  /** Fields that differ from the version the form opened on. */
  changed: readonly AmendableField[];
  user: SessionUser;
  pending: boolean;
  conflict: VersionConflict | null;
  submitError: string | null;
  errors: FieldErrors;
  /** Set when SSE reported a newer version while this form was open. */
  staleVersion: number | null;
  onSubmit: () => void;
  onClose: () => void;
  onDiscardConflict: () => void;
  onReapplyConflict: (server: Trade) => void;
};

function Field({
  label,
  htmlFor,
  error,
  changed,
  children,
  className
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  changed?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="flex items-center gap-1.5 text-cell-2 font-medium text-ink-2">
        {label}
        {changed && (
          <span className="rounded-sm bg-violet-soft-2 px-1 text-micro font-semibold text-violet-ink">
            edited
          </span>
        )}
      </Label>
      {children}
      {error && <p className="text-mini-2 text-red">{error}</p>}
    </div>
  );
}

export function TradeFormDrawer({
  mode,
  values,
  onChange,
  changed,
  user,
  pending,
  conflict,
  submitError,
  errors,
  staleVersion,
  onSubmit,
  onClose,
  onDiscardConflict,
  onReapplyConflict
}: Props) {
  const amending = mode?.kind === "amend" ? mode.trade : null;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    if (values) onChange({ ...values, [key]: value });
  };

  const isChanged = (field: AmendableField) => changed.includes(field);
  const errorFor = (field: keyof FormValues): string | undefined => errors[field];

  const notionalPreview = useMemo(() => {
    const quantity = Number(values?.quantity);
    const price = Number(values?.price);
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) return null;
    return {
      formula: `${formatQuantity(quantity)} × ${price}`,
      value: formatNotional(new Decimal(quantity).times(price))
    };
  }, [values?.quantity, values?.price]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  /** The user's in-progress values, shaped as a trade so the panel can diff them. */
  const attempted: Trade | null =
    amending && conflict?.currentTrade && values
      ? { ...conflict.currentTrade, ...toTradeCommand(values) }
      : null;

  return (
    <Sheet open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-[468px]">
        <SheetHeader className="border-b border-line px-4 py-3">
          <SheetTitle className="text-body-2 font-semibold text-ink">
            {amending ? "Amend trade" : "New trade"}
          </SheetTitle>
          <SheetDescription className="font-mono text-mini-2 text-ink-5">
            {amending
              ? `${amending.tradeId} · current version v${amending.version}`
              : "Booked as NEW · version v1"}
          </SheetDescription>
        </SheetHeader>

        {values && (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
            {conflict?.currentTrade && attempted && amending && (
              <ConflictPanel
                attempted={attempted}
                server={conflict.currentTrade}
                openedVersion={conflict.expectedVersion ?? amending.version}
                changedFields={changed}
                onDiscard={onDiscardConflict}
                onReapply={() => onReapplyConflict(conflict.currentTrade as Trade)}
              />
            )}

            {staleVersion !== null && !conflict && (
              <p
                role="status"
                className="mb-4 rounded-lg border border-amber-line bg-amber-soft px-3 py-2 text-mini-2 leading-relaxed text-amber"
              >
                A newer version (v{staleVersion}) arrived from the server. Your input has been
                preserved — review before saving.
              </p>
            )}

            {submitError && !conflict && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-red-line bg-red-soft px-3 py-2 text-mini-2 leading-relaxed text-red"
              >
                {submitError}
              </p>
            )}

            <div className="space-y-4">
              <Field
                label="Symbol"
                htmlFor="trade-symbol"
                error={errorFor("symbol")}
                changed={Boolean(amending) && isChanged("symbol")}
              >
                <Input
                  id="trade-symbol"
                  value={values.symbol}
                  onChange={(event) => set("symbol", event.target.value.toUpperCase())}
                  aria-invalid={Boolean(errorFor("symbol"))}
                  className="h-9 font-mono text-body-2 uppercase"
                  autoComplete="off"
                />
              </Field>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-cell-2 font-medium text-ink-2">
                  Side
                  {amending && isChanged("side") && (
                    <span className="rounded-sm bg-violet-soft-2 px-1 text-micro font-semibold text-violet-ink">
                      edited
                    </span>
                  )}
                </Label>
                <div
                  role="group"
                  aria-label="Side"
                  className="flex w-[200px] gap-0.5 rounded-lg bg-surface-muted-2 p-0.5"
                >
                  {(["BUY", "SELL"] as const).map((side: TradeSide) => {
                    const active = values.side === side;
                    return (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={active}
                        onClick={() => set("side", side)}
                        className={cn(
                          "h-8 flex-1 rounded-sm text-cell-2 font-semibold transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          active
                            ? cn("bg-raised shadow-xs", side === "BUY" ? "text-green" : "text-red")
                            : "text-ink-4 hover:text-ink-2"
                        )}
                      >
                        {side}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Quantity"
                  htmlFor="trade-quantity"
                  error={errorFor("quantity")}
                  changed={Boolean(amending) && isChanged("quantity")}
                >
                  <Input
                    id="trade-quantity"
                    value={values.quantity}
                    onChange={(event) => set("quantity", event.target.value)}
                    inputMode="numeric"
                    aria-invalid={Boolean(errorFor("quantity"))}
                    className="h-9 text-right font-mono text-body-2 tabular-nums"
                  />
                </Field>
                <Field
                  label="Price"
                  htmlFor="trade-price"
                  error={errorFor("price")}
                  changed={Boolean(amending) && isChanged("price")}
                >
                  <Input
                    id="trade-price"
                    value={values.price}
                    onChange={(event) => set("price", event.target.value)}
                    inputMode="decimal"
                    aria-invalid={Boolean(errorFor("price"))}
                    className="h-9 text-right font-mono text-body-2 tabular-nums"
                  />
                </Field>
              </div>

              {/* Trader is server-derived from the session and can never be picked. */}
              <div className="space-y-1.5">
                <Label className="text-cell-2 font-medium text-ink-2">Trader</Label>
                <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-muted px-3 py-2">
                  <span className="grid size-6 place-items-center rounded-sm bg-violet-soft-2 text-micro-2 font-semibold text-violet-ink">
                    {initials(user.displayName)}
                  </span>
                  <div>
                    <p className="text-cell-2 font-medium text-ink">{user.displayName}</p>
                    <p className="text-mini text-ink-5">Signed-in user</p>
                  </div>
                </div>
              </div>

              {/*
                Searched server-side, and both accept a value that is not on the
                list yet — a desk can book against a new counterparty.
              */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-cell-2 font-medium text-ink-2">
                    Book
                    {amending && isChanged("book") && (
                      <span className="rounded-sm bg-violet-soft-2 px-1 text-micro font-semibold text-violet-ink">
                        edited
                      </span>
                    )}
                  </Label>
                  <FilterCombobox
                    field="book"
                    value={values.book}
                    onChange={(book) => set("book", book)}
                    label="Book"
                    placeholder="Select or type a book"
                    allowCustomValue
                    className="h-9 w-full font-mono text-body-2"
                  />
                  {errorFor("book") && <p className="text-mini-2 text-red">{errorFor("book")}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-cell-2 font-medium text-ink-2">
                    Counterparty
                    {amending && isChanged("counterparty") && (
                      <span className="rounded-sm bg-violet-soft-2 px-1 text-micro font-semibold text-violet-ink">
                        edited
                      </span>
                    )}
                  </Label>
                  <FilterCombobox
                    field="counterparty"
                    value={values.counterparty}
                    onChange={(counterparty) => set("counterparty", counterparty)}
                    label="Counterparty"
                    placeholder="Select or type a counterparty"
                    allowCustomValue
                    className="h-9 w-full text-body-2"
                  />
                  {errorFor("counterparty") && (
                    <p className="text-mini-2 text-red">{errorFor("counterparty")}</p>
                  )}
                </div>
              </div>

              <Field
                label="Trade time (UTC)"
                htmlFor="trade-timestamp"
                error={errorFor("tradeTimestamp")}
                changed={Boolean(amending) && isChanged("tradeTimestamp")}
              >
                <Input
                  id="trade-timestamp"
                  type="datetime-local"
                  step="1"
                  value={values.tradeTimestamp}
                  onChange={(event) => set("tradeTimestamp", event.target.value)}
                  aria-invalid={Boolean(errorFor("tradeTimestamp"))}
                  className="h-9 font-mono text-body-2"
                />
              </Field>

              <div className="rounded-lg bg-surface-muted p-3">
                <p className="text-micro font-semibold uppercase tracking-[0.04em] text-ink-5">
                  Notional
                </p>
                {notionalPreview ? (
                  <>
                    <p className="mt-1 font-mono text-mini-2 text-ink-4">{notionalPreview.formula}</p>
                    <p className="mt-0.5 font-mono text-title font-semibold tabular-nums text-ink">
                      {notionalPreview.value}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-cell-2 text-ink-5">Enter a quantity and price.</p>
                )}
              </div>
            </div>
          </div>

          <SheetFooter className="flex-row items-center justify-between border-t border-line px-4 py-3">
            <p className="hidden text-mini-2 text-ink-5 sm:block">
              {amending
                ? changed.length > 0
                  ? `Sends ${changed.length} changed ${changed.length === 1 ? "field" : "fields"}.`
                  : "Status is set by execution events, not by amendment."
                : "Booked as NEW. Status changes via execute or cancel."}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={pending}
                className="h-9 text-body-2"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="h-9 text-body-2">
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {pending ? "Saving…" : amending ? "Save amendment" : "Book trade"}
              </Button>
            </div>
          </SheetFooter>
        </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
