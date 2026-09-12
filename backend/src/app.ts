import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { z } from "zod";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler
} from "fastify-type-provider-zod";
import { apiDocsEnabled, env, isProduction } from "./infrastructure/config/env";
import { registerErrorHandler } from "./infrastructure/errors/error-handler";
import { loggerOptions } from "./infrastructure/logging/logger";
import { createAuthModule } from "./modules/auth/index";
import { createTradesModule } from "./modules/trades/index";
import { SseBroker } from "./realtime/sse/sse-broker";
import { createSseRoutes } from "./realtime/sse/sse.routes";
import { createTradeEventPublisher } from "./realtime/sse/trade-events";

const healthSchema = z.object({ status: z.literal("ok") }).meta({ id: "HealthStatus" });

/** Only these prefixes need a resolved session, so nothing else pays for one. */
const SESSION_SCOPED_PREFIX = "/api/";
const PUBLIC_API_PATHS = new Set(["/api/health", "/api/auth/login"]);

export type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * Composition root: build the modules, wire cross-cutting infrastructure, and
 * register everything. This is the only place that knows how the pieces fit.
 */
export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const auth = createAuthModule();
  const broker = new SseBroker({ maxClients: env.SSE_MAX_CLIENTS });
  const trades = createTradesModule({
    requireAuth: auth.requireAuth,
    events: createTradeEventPublisher(broker)
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "Fusion Trade Blotter API", version: "1.0.0" },
      tags: [{ name: "Authentication" }, { name: "Trades" }, { name: "Health" }],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: auth.cookieName,
            description: "Opaque server-side session token set by POST /api/auth/login."
          }
        }
      }
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject
  });

  /*
   * Swagger UI describes the whole API surface, so it is not served to the
   * internet by default. `npm run api:spec` still generates the document
   * regardless — the contract does not depend on the viewer being reachable.
   */
  if (apiDocsEnabled) {
    await app.register(swaggerUi, { routePrefix: "/api/docs" });
  }

  await app.register(helmet, {
    // Off because the default policy blocks the inline styles Swagger UI needs.
    // A real deployment behind TLS should set a policy rather than disable it;
    // that is a deployment concern this take-home does not reach.
    contentSecurityPolicy: false,
    hsts: isProduction
  });
  await app.register(cors, { origin: env.FRONTEND_ORIGIN, credentials: true });
  await app.register(cookie);
  /*
   * The store is per-process. One instance is the deployment today, but behind
   * more than one the effective limit multiplies by the instance count — the
   * login route's 10/minute becomes 10 per instance. Running replicas means
   * giving this plugin a shared Redis store, not raising the numbers.
   */
  await app.register(rateLimit, { max: 500, timeWindow: "1 minute" });

  /*
   * The built SPA, when one is mounted. Development leaves this unset: Vite
   * serves the app and proxies /api here, so the backend stays a pure API.
   * The container image sets it, which collapses the demo onto one origin —
   * no CORS preflight, no cross-site cookie, and no reverse proxy in front of
   * an SSE stream waiting to buffer it.
   *
   * `wildcard: false` registers the built files as individual routes rather
   * than a catch-all, so anything unmatched still reaches the not-found
   * handler — the single place that decides API 404 versus SPA fallback.
   */
  if (env.SPA_DIR) {
    await app.register(fastifyStatic, {
      root: resolve(env.SPA_DIR),
      wildcard: false,
      index: ["index.html"],
      setHeaders(reply, path) {
        // Vite fingerprints every asset it emits, so those are immutable.
        // index.html must not be cached, or a new build stays invisible until
        // the browser happens to revalidate.
        reply.header(
          "cache-control",
          path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
        );
      }
    });
  }

  registerErrorHandler(app, Boolean(env.SPA_DIR));

  /*
   * Resolve the session for API requests; individual routes decide whether one
   * is required. Health checks, documentation and login are excluded so they
   * never touch the database, and `onRequest` runs before body parsing so an
   * unauthenticated write is rejected before its payload is read.
   */
  app.decorateRequest("currentUser", null);
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith(SESSION_SCOPED_PREFIX) || PUBLIC_API_PATHS.has(path)) return;
    await auth.resolveSession(request);
  });

  app.get(
    "/api/health",
    { schema: { operationId: "health", tags: ["Health"], response: { 200: healthSchema } } },
    async () => ({ status: "ok" as const })
  );

  await app.register(auth.routes);
  await app.register(trades.routes);
  await app.register(
    createSseRoutes({ broker, requireAuth: auth.requireAuth, isSessionValid: auth.isSessionValid })
  );

  /**
   * Ends the long-lived work that would otherwise keep the process alive.
   *
   * This has to run *before* `app.close()`, not from an `onClose` hook.
   * `close()` waits for open connections to finish, and a hijacked SSE response
   * is an open connection that nothing else ever ends — so a hook, which only
   * runs once that wait is over, is exactly too late. Draining first turns a
   * shutdown that hangs until the force-exit timeout into an immediate one.
   */
  app.decorate("drainRealtime", () => {
    broker.closeAll();
    auth.stop();
  });

  // A belt-and-braces backstop for callers that close the app directly, such
  // as the integration tests.
  app.addHook("onClose", async () => {
    broker.closeAll();
    auth.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    drainRealtime: () => void;
  }
}
