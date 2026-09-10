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

export type TransitionKind = "execute" | "cancel";

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

export type TradeWorkflow = {
  formMode: TradeFormMode | null;
  formValues: FormValues | null;
  /** Fields the user edited, and the only ones an amendment sends. */
  changed: readonly AmendableField[];
  errors: FieldErrors;
  conflict: VersionConflict | null;
  submitError: string | null;
  confirm: { kind: TransitionKind; trade: TradeView } | null;
  auditTrade: TradeView | null;
  pending: boolean;
  transitionPending: boolean;
  /** True while any modal surface is open, so hotkeys can stand down. */
  isModalOpen: boolean;

  setFormValues: (next: FormValues) => void;
  startCreate: () => void;
  startAmend: (trade: TradeView) => void;
  startTransition: (kind: TransitionKind, trade: TradeView) => void;
  openAudit: (trade: TradeView) => void;
  closeAudit: () => void;
  closeConfirm: () => void;
  closeForm: () => void;
  submitForm: () => Promise<void>;
  confirmTransition: () => Promise<void>;
  discardConflict: () => void;
  reapplyConflict: (server: Trade) => void;
};

/**
 * Everything the blotter can be in the middle of doing: booking, amending,
 * confirming a terminal action, reading history, or holding a conflict.
 *
 * These are one workflow rather than several independent flags — opening a form
 * clears a stale conflict, resolving a conflict rebases the form — so they live
 * together, and the screen component is left with layout.
 *
 * The form's own values live here too. Every reset is therefore an event (a
 * user opened a form, a user accepted a newer version) rather than an effect
 * reacting to a changed prop, which is what makes it safe for an incoming SSE
 * re-render to never disturb what someone has typed.
 */
export function useTradeWorkflow(): TradeWorkflow {
  const { create, amend, transition } = useTradeMutations();

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: TransitionKind; trade: TradeView } | null>(null);
  const [auditTrade, setAuditTrade] = useState<TradeView | null>(null);

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

  const closeForm = useCallback(() => {
    setForm(null);
    clearErrors();
  }, [clearErrors]);

  const startCreate = useCallback(() => openForm({ kind: "create" }, null), [openForm]);

  const startAmend = useCallback(
    (trade: TradeView) => openForm({ kind: "amend", trade }, trade),
    [openForm]
  );

  const setFormValues = useCallback((values: FormValues) => {
    setForm((current) => (current ? { ...current, values } : current));
  }, []);

  const startTransition = useCallback((kind: TransitionKind, trade: TradeView) => {
    setConfirm({ kind, trade });
  }, []);

  const changed = useMemo(
    () => (form ? changedFields(form.baseline, form.values) : []),
    [form]
  );

  const submitForm = useCallback(async () => {
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
          closeForm();
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
      closeForm();
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
  }, [amend, changed, closeForm, create, form]);

  const confirmTransition = useCallback(async () => {
    if (!confirm) return;
    try {
      await transition.mutateAsync({
        id: confirm.trade.id,
        kind: confirm.kind,
        expectedVersion: confirm.trade.version
      });
    } catch {
      // Surfaced as a toast by the mutation's onError handler.
    }
    setConfirm(null);
  }, [confirm, transition]);

  /**
   * Rebase onto the server's version, keeping what the user typed.
   *
   * Only the baseline moves. Their edits stay, and fields they never touched
   * now match the newer version — so saving again sends their changes without
   * reverting anyone else's.
   */
  const reapplyConflict = useCallback((server: Trade) => {
    setConflict(null);
    setForm((current) =>
      current
        ? {
            mode: { kind: "amend", trade: toTradeView(server) },
            baseline: toFormValues(server, new Date()),
            values: current.values
          }
        : current
    );
    toast.info(`Reviewing your changes against v${server.version} of ${server.tradeId}`, {
      description: "Save again to submit as the next version."
    });
  }, []);

  const discardConflict = useCallback(() => {
    const reference = conflict?.currentTrade?.tradeId;
    closeForm();
    if (reference) {
      toast.info(`Your edit to ${reference} was discarded`, {
        description: "The blotter shows the current server version."
      });
    }
  }, [conflict, closeForm]);

  return {
    formMode: form?.mode ?? null,
    formValues: form?.values ?? null,
    changed,
    errors,
    conflict,
    submitError,
    confirm,
    auditTrade,
    pending: create.isPending || amend.isPending,
    transitionPending: transition.isPending,
    isModalOpen: Boolean(form || confirm || auditTrade),
    setFormValues,
    startCreate,
    startAmend,
    startTransition,
    openAudit: setAuditTrade,
    closeAudit: useCallback(() => setAuditTrade(null), []),
    closeConfirm: useCallback(() => setConfirm(null), []),
    closeForm,
    submitForm,
    confirmTransition,
    discardConflict,
    reapplyConflict
  };
}
