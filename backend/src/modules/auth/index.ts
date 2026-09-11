import { env } from "../../infrastructure/config/env";
import { prisma } from "../../infrastructure/database/prisma";
import { createAuthMiddleware } from "./middleware/require-auth";
import { createAuthRoutes } from "./routes/auth";
import { SessionRepository } from "./repositories/session";
import { UserRepository } from "./repositories/user";
import { AuthService } from "./services/auth";

/**
 * The auth module's public surface: its routes, the middleware other modules
 * need, and a sweeper the composition root is responsible for stopping.
 * `AuthService` and the repositories stay private.
 */
export function createAuthModule() {
  const authService = new AuthService(new UserRepository(prisma), new SessionRepository(prisma));
  const { resolveSession, requireAuth, isSessionValid } = createAuthMiddleware(authService);

  /**
   * Expired sessions are unreadable but not self-removing. `unref` keeps the
   * timer from holding the process open on shutdown.
   */
  const sweeper = setInterval(
    () => {
      void authService.purgeExpiredSessions().catch(() => {
        // A failed sweep is retried on the next tick; it must never crash the
        // process or reject an unrelated request.
      });
    },
    env.SESSION_SWEEP_MINUTES * 60 * 1000
  );
  sweeper.unref();

  return {
    resolveSession,
    requireAuth,
    isSessionValid,
    cookieName: authService.cookieName,
    routes: createAuthRoutes({ authService, requireAuth }),
    stop: () => clearInterval(sweeper)
  };
}

export type { AuthenticatedUser } from "./types";
