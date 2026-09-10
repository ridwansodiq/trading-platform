import { Loader2 } from "lucide-react";
import { SessionExpiredDialog } from "@/features/auth/components/session-expired-dialog";
import { SignInScreen } from "@/features/auth/components/sign-in-screen";
import { useSession } from "@/features/auth/hooks/use-session";
import { BlotterScreen } from "@/features/trades/components/blotter-screen";

/**
 * Composition root. Session state decides which screen renders; trades are
 * never requested before the session is confirmed.
 */
export function App() {
  const session = useSession();

  if (session.status === "bootstrapping") {
    return (
      <main className="grid min-h-screen place-items-center bg-bg-page text-ink-5">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </main>
    );
  }

  if (session.status === "anonymous" || !session.user) {
    return <SignInScreen onSignIn={session.signIn} />;
  }

  return (
    <>
      <BlotterScreen
        user={session.user}
        onSignOut={() => void session.signOut()}
        onSessionExpired={session.expire}
      />
      <SessionExpiredDialog
        open={session.status === "expired"}
        onReturnToSignIn={session.returnToSignIn}
      />
    </>
  );
}
