import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  apiErrorSchema,
  commonErrorResponses
} from "../../../infrastructure/errors/error.schema";
import type { LoginBody } from "../schemas/login";
import { loginSchema } from "../schemas/login";
import { currentUserResponseSchema } from "../schemas/user-response";
import { UnauthenticatedError } from "../errors/auth";
import type { AuthService } from "../services/auth";

const errors = commonErrorResponses(apiErrorSchema);

export type AuthRoutesOptions = {
  authService: AuthService;
  requireAuth: preHandlerHookHandler;
};

/**
 * Errors are thrown, never caught: the single Fastify error handler turns an
 * `ApplicationError` into its documented response, so a bad password and a
 * malformed body come back in the same envelope.
 */
export function createAuthRoutes({ authService, requireAuth }: AuthRoutesOptions): FastifyPluginAsync {
  return async (app) => {
    app.post(
      "/api/auth/login",
      {
        schema: {
          operationId: "login",
          tags: ["Authentication"],
          body: loginSchema,
          response: { 200: currentUserResponseSchema, ...errors, 429: apiErrorSchema }
        },
        /*
         * The only limited route on the API. It is unauthenticated and it is
         * the one endpoint worth guessing at, so the ceiling is set for a
         * person mistyping a password rather than for a script trying a
         * dictionary — five attempts a minute leaves room for the first and
         * none for the second.
         */
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
      },
      async (request, reply) => {
        const { email, password } = request.body as LoginBody;
        const session = await authService.login({ email, password });
        reply.setCookie(authService.cookieName, session.token, authService.cookieOptions);
        return { user: session.user };
      }
    );

    app.post(
      "/api/auth/logout",
      {
        schema: {
          operationId: "logout",
          tags: ["Authentication"],
          security: [{ sessionCookie: [] }],
          response: { 204: z.null(), ...errors }
        }
      },
      async (request, reply) => {
        await authService.logout(request.cookies[authService.cookieName]);
        reply.clearCookie(authService.cookieName, { path: "/" });
        return reply.code(204).send();
      }
    );

    app.get(
      "/api/auth/me",
      {
        preHandler: requireAuth,
        schema: {
          operationId: "getCurrentUser",
          tags: ["Authentication"],
          security: [{ sessionCookie: [] }],
          response: { 200: currentUserResponseSchema, ...errors }
        }
      },
      async (request) => {
        // `requireAuth` has already rejected an anonymous request; this narrows
        // the type rather than re-checking the session.
        if (!request.currentUser) throw new UnauthenticatedError();
        return { user: request.currentUser };
      }
    );
  };
}
