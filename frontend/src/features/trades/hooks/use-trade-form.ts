import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  apiErrorMessage,
  apiFieldErrors,
  asVersionConflict,
  useTradeMutations,
  type VersionConflict
} from "@/features/trades/hooks/use-trade-mutations";
import {
  changedFields,
  toFormValues,
  toTradeCommand,
  validateTradeForm,
  type AmendableField,
  type FieldErrors,
  type FormValues
} from "@/features/trades/lib/trade-form";
import { toTradeView } from "@/features/trades/lib/trade-view";
import type { AmendTradeCommand, CreateTradeCommand } from "@/api/generated/models";
import type { Trade, TradeView } from "@/types/trade";

export type TradeFormMode = { kind: "create" } | { kind: "amend"; trade: TradeView };

/**
 * What the user is editing.
 *
 * `baseline` is the state the form opened with; `values` is what they have
 * typed. The difference between them is the amendment — see `changed`.
 */
type FormState = {
  mode: TradeFormMode;
  baseline: FormValues;
  values: FormValues;
};

export type TradeForm = {
  mode: TradeFormMode | null;
  values: FormValues | null;
  /** Fields the user edited, and the only ones an amendment sends. */
  changed: readonly AmendableField[];
  errors: FieldErrors;
  conflict: VersionConflict | null;
  submitError: string | null;
  pending: boolean;
  /** True while the drawer is up, so the blotter's hotkeys can stand down. */
  isOpen: boolean;

  setValues: (next: FormValues) => void;
  startCreate: () => void;
  startAmend: (trade: TradeView) => void;
  close: () => void;
  submit: () => Promise<void>;
  discardConflict: () => void;
  reapplyConflict: (server: Trade) => void;
};

/**
 * Booking and amending a trade, including losing a race while doing so.
 *
 * These four pieces of state are one thing, not four: opening a form clears a
 * stale conflict, a rejected submission writes field errors, and resolving a
 * conflict rebases the form itself. Splitting them would mean keeping them in
 * step from the outside.
 *
 * The form's values live here rather than in the drawer, so every reset is an
 * event — a user opened a form, a user accepted a newer version — rather than
 * an effect reacting to a changed prop. That is what makes it safe for an
 * incoming SSE re-render to never disturb what someone has typed.
 */
export function useTradeForm(): TradeForm {
  const { create, amend } = useTradeMutations();

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const clearErrors = useCallback(() => {
    setConflict(null);
    setSubmitError(null);
    setErrors({});
  }, []);

  const openForm = useCallback(
    (mode: TradeFormMode, trade: TradeView | null) => {
      const fresh = toFormValues(trade, new Date());
      setForm({ mode, baseline: fresh, values: fresh });
      clearErrors();
    },
    [clearErrors]
  );

  const close = useCallback(() => {
    setForm(null);
    clearErrors();
  }, [clearErrors]);

  const startCreate = useCallback(() => openForm({ kind: "create" }, null), [openForm]);

  const startAmend = useCallback(
    (trade: TradeView) => openForm({ kind: "amend", trade }, trade),
    [openForm]
  );

  const setValues = useCallback((values: FormValues) => {
    setForm((current) => (current ? { ...current, values } : current));
  }, []);

  const changed = useMemo(() => (form ? changedFields(form.baseline, form.values) : []), [form]);

  const submit = useCallback(async () => {
    if (!form) return;

    const found = validateTradeForm(form.values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setConflict(null);
    setSubmitError(null);
    const command = toTradeCommand(form.values);

    try {
      if (form.mode.kind === "amend") {
        if (changed.length === 0) {
          toast.info("Nothing to save", { description: "No field was changed." });
          close();
          return;
        }

        /*
         * Only the edited fields travel. Resubmitting the untouched ones would
         * overwrite whatever a concurrent amendment wrote to them — a silent
         * merge, which is exactly what the conflict flow exists to prevent.
         */
        const body = {
          ...(Object.fromEntries(
            changed.map((field) => [field, command[field]])
          ) as Partial<CreateTradeCommand>),
          expectedVersion: form.mode.trade.version
        } satisfies AmendTradeCommand;

        await amend.mutateAsync({ id: form.mode.trade.id, body });
      } else {
        await create.mutateAsync(command);
      }
      close();
    } catch (error) {
      const versionConflict = asVersionConflict(error);
      if (versionConflict) {
        setConflict(versionConflict);
        return;
      }
      setErrors(apiFieldErrors(error));
      setSubmitError(
        apiErrorMessage(error, "The blotter service rejected this submission. No changes were written.")
      );
    }
  }, [amend, changed, close, create, form]);

  /**
   * Rebase onto the server's version, keeping what the user typed.
   *
   * Only the baseline moves. Their edits stay, and fields they never touched
   * now match the newer version — so saving again sends their changes without
   * reverting anyone else's.
   */
  const reapplyConflict = useCallback((server: Trade) => {
    setConflict(null);
    setForm((current) => {
      if (!current) return current;

      /*
       * Both halves move onto the server's version, and only the fields the
       * user actually edited are laid back over it. Rebasing the baseline
       * alone would leave every untouched field holding the values the form
       * opened with — which now differ from the newer version, so they would
       * read as edits and be sent, reverting the concurrent amendment. That is
       * the silent merge this whole flow exists to prevent, and it would also
       * break the promise the conflict panel just made about how many fields
       * the next save writes.
       */
      const rebased = toFormValues(server, new Date());
      const values: FormValues = { ...rebased };
      for (const field of changedFields(current.baseline, current.values)) {
        Object.assign(values, { [field]: current.values[field] });
      }

      return {
        mode: { kind: "amend", trade: toTradeView(server) },
        baseline: rebased,
        values
      };
    });
    toast.info(`Reviewing your changes against v${server.version} of ${server.tradeId}`, {
      description: "Save again to submit as the next version."
    });
  }, []);

  const discardConflict = useCallback(() => {
    const reference = conflict?.currentTrade?.tradeId;
    close();
    if (reference) {
      toast.info(`Your edit to ${reference} was discarded`, {
        description: "The blotter shows the current server version."
      });
    }
  }, [conflict, close]);

  return {
    mode: form?.mode ?? null,
    values: form?.values ?? null,
    changed,
    errors,
    conflict,
    submitError,
    pending: create.isPending || amend.isPending,
    isOpen: form !== null,
    setValues,
    startCreate,
    startAmend,
    close,
    submit,
    discardConflict,
    reapplyConflict
  };
}
