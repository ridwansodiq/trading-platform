import { Button } from "@/components/ui/button";
import { compareForConflict } from "@/features/trades/lib/audit-diff";
import type { AmendableField } from "@/features/trades/lib/trade-form";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/trade";

type Props = {
  /** The values the user has in the form, shaped as a trade for comparison. */
  attempted: Trade;
  server: Trade;
  openedVersion: number;
  /** Fields the user actually edited — the only ones an amendment will send. */
  changedFields: readonly AmendableField[];
  onDiscard: () => void;
  onReapply: () => void;
};

/**
 * Rendered inside the amend drawer, above the form, so the user's input stays
 * visible and untouched. Nothing is ever merged automatically.
 *
 * The table separates the fields this amendment would write from the ones it
 * would leave alone, because that is the question the user actually has: not
 * "what is different?" but "what am I about to overwrite?".
 */
export function ConflictPanel({
  attempted,
  server,
  openedVersion,
  changedFields,
  onDiscard,
  onReapply
}: Props) {
  const rows = compareForConflict(attempted, server).map((row) => ({
    ...row,
    willSend: changedFields.includes(row.field as AmendableField)
  }));

  const overwrites = rows.filter((row) => row.willSend && row.differs).length;

  return (
    <section className="mb-4 rounded-lg border border-amber-line bg-amber-soft p-3">
      <h3 className="text-cell-2 font-semibold text-amber">This trade changed while you were editing</h3>
      <p className="mt-1 text-mini-2 leading-relaxed text-amber-2">
        You opened v{openedVersion}. {server.trader} saved v{server.version} at{" "}
        {formatClock(server.updatedAt)}. Nothing was merged — your input is untouched below.
      </p>
      <p className="mt-1.5 text-mini-2 leading-relaxed text-amber-2">
        Reapplying sends only the {changedFields.length}{" "}
        {changedFields.length === 1 ? "field" : "fields"} you edited
        {overwrites > 0 ? (
          <>
            , {overwrites} of which {overwrites === 1 ? "differs" : "differ"} from v{server.version}{" "}
            and would replace it
          </>
        ) : (
          <>, so nothing they changed is lost</>
        )}
        .
      </p>

      <div className="mt-3 overflow-hidden rounded-md border border-amber-line bg-surface">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-muted">
              <th className="px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4">
                Field
              </th>
              <th className="px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4">
                Your value
              </th>
              <th className="px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4">
                Server v{server.version}
              </th>
              <th className="px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.04em] text-ink-4">
                Sends
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line-soft">
                <td className="px-2.5 py-1.5 text-cell text-ink-4">{row.label}</td>
                <td className="px-2.5 py-1.5">
                  <span
                    className={cn(
                      "inline-block rounded-sm px-1.5 py-0.5 font-mono text-cell tabular-nums",
                      row.willSend ? "bg-violet-soft-2 font-medium text-violet-ink" : "text-ink-3"
                    )}
                  >
                    {row.mine}
                  </span>
                </td>
                <td className="px-2.5 py-1.5">
                  <span
                    className={cn(
                      "inline-block rounded-sm px-1.5 py-0.5 font-mono text-cell tabular-nums",
                      row.differs ? "bg-amber-soft-2 font-medium text-amber" : "text-ink-3"
                    )}
                  >
                    {row.theirs}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 text-cell text-ink-4">
                  {row.willSend ? (
                    <span className="font-medium text-violet-ink">yours</span>
                  ) : (
                    <span className="text-ink-5">keeps theirs</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={onDiscard} className="h-8 text-cell-2">
          Discard my changes
        </Button>
        <Button onClick={onReapply} className="h-8 text-cell-2">
          Reapply onto v{server.version}
        </Button>
      </div>
    </section>
  );
}
