import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";
import type { Theme } from "@/hooks/use-theme";
import type { ConnectionState, SessionUser } from "@/types/trade";

const CONNECTION: Record<ConnectionState, { label: string; className: string; dot: string }> = {
  live: { label: "Live", className: "bg-green-soft text-green", dot: "bg-green-3" },
  reconnecting: {
    label: "Reconnecting",
    className: "bg-amber-soft text-amber",
    dot: "bg-amber-3 animate-pulse"
  },
  disconnected: { label: "Disconnected", className: "bg-surface-muted-2 text-ink-4", dot: "bg-ink-5" },
  offline: { label: "Offline", className: "bg-red-soft text-red", dot: "bg-red-2" }
};

type Props = {
  user: SessionUser;
  connection: ConnectionState;
  theme: Theme;
  onToggleTheme: () => void;
  onSignOut: () => void;
};

export function TopBar({ user, connection, theme, onToggleTheme, onSignOut }: Props) {
  const state = CONNECTION[connection];

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-3.5">
      <div className="flex items-center gap-2">
        <div className="grid size-[22px] place-items-center rounded-md bg-violet text-mini font-semibold text-white">
          F
        </div>
        <span className="text-body-2 font-semibold text-ink">Fusion Trade Blotter</span>
        <span className="hidden h-5 items-center rounded-sm bg-surface-muted-2 px-1.5 text-micro-2 font-semibold uppercase tracking-[0.04em] text-ink-4 sm:inline-flex">
          Demo
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-cell font-medium",
            state.className
          )}
          role="status"
          aria-label={`Live connection: ${state.label}`}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", state.dot)} />
          <span className="hidden sm:inline">{state.label}</span>
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="size-[26px] text-ink-4"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </Button>

        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
