import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, login as loginRequest, logout as logoutRequest } from "@/api/generated/endpoints/authentication/authentication";
import { ApiError } from "@/api/fetch-client";
import { ok } from "@/api/unwrap";
import type { SessionUser } from "@/types/trade";

export type SessionStatus = "bootstrapping" | "anonymous" | "authenticated" | "expired";

export type Session = {
  status: SessionStatus;
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called when a protected request returns 401 mid-session. */
  expire: () => void;
  returnToSignIn: () => void;
};

/**
 * Session bootstrap happens before trades are fetched or the stream is opened,
 * so trade data is never requested without a validated session.
 */
export function useSession(): Session {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("bootstrapping");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((response) => {
        if (!active) return;
        setUser(ok(response).user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const response = await loginRequest({ email, password });
      // Re-fetch authoritative data rather than reusing anything cached
      // from before the session changed.
      queryClient.clear();
      setUser(ok(response).user);
      setStatus("authenticated");
    },
    [queryClient]
  );

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } catch (error) {
      // An already-invalid session is still signed out locally.
      if (!(error instanceof ApiError)) throw error;
    }
    queryClient.clear();
    setUser(null);
    setStatus("anonymous");
  }, [queryClient]);

  const expire = useCallback(() => {
    setStatus((current) => (current === "authenticated" ? "expired" : current));
  }, []);

  const returnToSignIn = useCallback(() => {
    queryClient.clear();
    setUser(null);
    setStatus("anonymous");
  }, [queryClient]);

  return { status, user, signIn, signOut, expire, returnToSignIn };
}
