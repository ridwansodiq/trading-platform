import { ChevronDown, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import type { ReactNode } from "react";
import type { SessionUser } from "@/types/trade";

type Props = {
  user: SessionUser;
  onSignOut: () => void;
  /**
   * Feature-owned entries, rendered above the account actions.
   *
   * A slot rather than an import: shared chrome may not reach into a feature,
   * so whatever knows about trades passes its own item down instead.
   */
  menuItems?: ReactNode;
};

export function UserMenu({ user, onSignOut, menuItems }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex h-[26px] items-center gap-1.5 rounded-md px-1 text-cell-2 text-ink-2 transition-colors hover:bg-surface-muted-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="grid size-6 place-items-center rounded-sm bg-violet-soft-2 text-micro-2 font-semibold text-violet-ink">
          {initials(user.displayName)}
        </span>
        <span className="hidden font-medium sm:inline">{user.displayName}</span>
        <ChevronDown size={13} className="text-ink-5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-cell-2 font-medium text-ink">{user.displayName}</p>
          <p className="font-mono text-mini text-ink-5">{user.email}</p>
          <p className="mt-1 text-mini text-ink-5">Desk {user.desk}</p>
        </div>
        <DropdownMenuSeparator />
        {menuItems ? (
          <>
            {menuItems}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={onSignOut} className="text-cell-2">
          <LogOut size={14} />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
