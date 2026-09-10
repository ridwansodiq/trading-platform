import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from "lucide-react";
import { Button } from "@/components/ui/button";

const HINTS: ReadonlyArray<[string, string]> = [
  ["J K", "move"],
  ["A", "amend"],
  ["E", "execute"],
  ["C", "cancel"],
  ["H", "history"],
  ["/", "search"]
];

type Props = {
  page: number;
  pageSize: number;
  total: number;
  rowsOnPage: number;
  selectedRef: string | null;
  onPageChange: (page: number) => void;
};

export function BlotterFooter({
  page,
  pageSize,
  total,
  rowsOnPage,
  selectedRef,
  onPageChange
}: Props) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = (page - 1) * pageSize + rowsOnPage;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  /*
   * A filtered book runs to hundreds of pages, so stepping is not a way to
   * reach either end. The jump buttons are also the recovery path for a page
   * number that is out of range — a shared link whose filters have since
   * narrowed, say — which is why "last" is enabled whenever the current page
   * is not the last one, rather than only when stepping forward is possible.
   */
  const atFirst = page <= 1;
  const atLast = page === pageCount;

  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2">
      <p className="text-cell-2 text-ink-4">
        <span className="font-mono tabular-nums">
          {first}–{last}
        </span>{" "}
        of <span className="font-mono tabular-nums">{total}</span> trades
        {selectedRef && <span className="ml-2 font-mono text-violet">{selectedRef} selected</span>}
      </p>

      <div className="hidden items-center gap-2.5 lg:flex">
        {HINTS.map(([keys, label]) => (
          <span key={label} className="flex items-center gap-1 text-mini text-ink-5">
            <kbd className="rounded-xs border border-line bg-surface-muted px-1 font-mono text-micro text-ink-4">
              {keys}
            </kbd>
            {label}
          </span>
        ))}
      </div>

      <nav aria-label="Pagination" className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={atFirst}
          onClick={() => onPageChange(1)}
          aria-label="First page"
          title="First page"
          className="h-7 px-1.5"
        >
          <ChevronsLeft size={14} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={atFirst}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="h-7 px-2 text-cell-2"
        >
          <ChevronLeft size={14} />
          Previous
        </Button>

        <span aria-live="polite" className="font-mono text-cell tabular-nums text-ink-4">
          Page {page} of {pageCount}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="h-7 px-2 text-cell-2"
        >
          Next
          <ChevronRight size={14} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={atLast}
          onClick={() => onPageChange(pageCount)}
          aria-label="Last page"
          title="Last page"
          className="h-7 px-1.5"
        >
          <ChevronsRight size={14} />
        </Button>
      </nav>
    </footer>
  );
}
