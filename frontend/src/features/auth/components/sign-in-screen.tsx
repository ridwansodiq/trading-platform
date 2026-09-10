import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  onSignIn: (email: string, password: string) => Promise<void>;
  /** Shown when the previous session ended by expiry rather than sign-out. */
  sessionExpired?: boolean;
};

export function SignInScreen({ onSignIn, sessionExpired = false }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await onSignIn(email, password);
    } catch {
      // Deliberately generic: never reveal which field was wrong.
      setError("Invalid email or password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg-page px-4">
      <div className="w-full max-w-[376px]">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid size-[30px] place-items-center rounded-lg bg-violet text-body-2 font-semibold text-white">
            F
          </div>
          <span className="text-title font-semibold tracking-[-0.01em] text-ink">Fusion Trade Blotter</span>
        </div>

        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <h1 className="text-title font-semibold text-ink">Sign in</h1>
          <p className="mt-1 mb-5 text-body text-ink-4">Use your desk credentials to access the blotter.</p>

          {sessionExpired && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-amber-line bg-amber-soft px-3 py-2 text-cell-2 text-amber"
            >
              Your session expired. Sign in again to resume.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-line bg-red-soft px-3 py-2 text-cell-2 text-red"
            >
              {error}
            </p>
          )}

          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="signin-email" className="text-cell-2 font-medium text-ink-2">
                Email
              </Label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-9 text-body-2"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signin-password" className="text-cell-2 font-medium text-ink-2">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="signin-password"
                  type={revealed ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-9 pr-10 text-body-2"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((value) => !value)}
                  aria-label={revealed ? "Hide password" : "Show password"}
                  title={revealed ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-4 transition-colors hover:bg-surface-muted-2 hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={pending} className="h-9 w-full text-body-2 font-medium">
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </section>

        <p className="mt-4 text-center text-[11.5px] text-ink-5">
          Fusion Capital · Demo environment · © 2026
        </p>
      </div>
    </main>
  );
}
