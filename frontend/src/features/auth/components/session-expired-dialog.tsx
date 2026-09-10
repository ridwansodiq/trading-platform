import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

type Props = { open: boolean; onReturnToSignIn: () => void };

/**
 * Shown after a protected request returns 401. The stream is already closed and
 * trade actions disabled by the time this appears; signing back in re-fetches
 * authoritative data rather than reusing the pre-expiry cache.
 */
export function SessionExpiredDialog({ open, onReturnToSignIn }: Props) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[396px] gap-0 p-5"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="mb-3 grid size-7 place-items-center rounded-md bg-amber-soft text-amber">
          <Clock size={15} />
        </div>
        <DialogTitle className="text-body-2 font-semibold text-ink">Your session expired</DialogTitle>
        <DialogDescription className="mt-1.5 text-cell-2 leading-relaxed text-ink-4">
          The live connection has been closed and trade actions are disabled. Sign in again to reload
          authoritative trade data.
        </DialogDescription>
        <DialogFooter className="mt-5">
          <Button onClick={onReturnToSignIn} className="h-9 text-body-2">
            Return to sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
