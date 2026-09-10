import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuthenticatedUser } from "../dtos/login.dto.js";
import { UnauthenticatedError } from "../errors/auth.errors.js";
import type { AuthService } from "../services/auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: AuthenticatedUser | null;
  }
}

/**
 * Session resolution and the route guard.
 *
 * Lives inside the auth module because it *is* auth behaviour; other modules
 * reach it through the module barrel and never learn how sessions work.
 */
export function createAuthMiddleware(authService: AuthService) {
  /**
   * Populates `request.currentUser` for routes that ask for it.
   *
   * Costs nothing when no session cookie is present, and is only registered
   * for the API surface, so static and documentation requests never touch the
   * database.
   */
  const resolveSession = async (request: FastifyRequest): Promise<void> => {
    request.currentUser = await authService.resolveSession(request.cookies[authService.cookieName]);
  };

  /**
   * Throwing rather than replying halts the lifecycle the same way, but routes
   * the response through the single error handler so a 401 has the same
   * envelope as every other failure.
   */
  const requireAuth: preHandlerHookHandler = async (request) => {
    if (!request.currentUser) throw new UnauthenticatedError();
  };

  /**
   * Re-checks a still-open connection's session.
   *
   * A long-lived stream is authorised once at handshake; without a recheck it
   * keeps delivering trade data after the session behind it is revoked.
   */
  const isSessionValid = async (request: FastifyRequest): Promise<boolean> => {
    const user = await authService.resolveSession(request.cookies[authService.cookieName]);
    return user !== null;
  };

  return { resolveSession, requireAuth, isSessionValid };
}
