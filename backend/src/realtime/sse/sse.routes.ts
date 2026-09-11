import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { env } from "../../infrastructure/config/env";
import { apiErrorSchema } from "../../infrastructure/errors/error.schema";
import { tradeEventSchema } from "../../modules/trades/index";
import type { SseBroker } from "./sse-broker";

/**
 * Liveness cadence. Short enough that a client can call a silent connection
 * dead within seconds; a heartbeat frame is ~60 bytes, so the cost per
 * connected client is negligible.
 */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** Retry delay the browser should use after the stream drops. */
const RECONNECT_HINT_MS = 2_000;

export type SseRoutesOptions = {
  broker: SseBroker;
  requireAuth: preHandlerHookHandler;
  /** Re-checks the request's session while its stream is still open. */
  isSessionValid: (request: FastifyRequest) => Promise<boolean>;
};

export function createSseRoutes({
  broker,
  requireAuth,
  isSessionValid
}: SseRoutesOptions): FastifyPluginAsync {
  return async (app) => {
    app.get(
      "/api/events",
      {
        preHandler: requireAuth,
        schema: {
          operationId: "streamTradeEvents",
          tags: ["Trades"],
          security: [{ sessionCookie: [] }],
          description:
            "Server-Sent Events stream of committed trade mutations. Notification only; REST remains authoritative. " +
            `Emits a named "heartbeat" event every ${HEARTBEAT_INTERVAL_MS / 1000}s so a client can detect a dead ` +
            'connection without waiting for a TCP timeout, and a "connected" event on open. The stream closes when ' +
            "its session is revoked or expires, and when the server has no capacity for another subscriber.",
          response: { 200: tradeEventSchema, 401: apiErrorSchema, 503: apiErrorSchema }
        }
      },
      async (request, reply) => {
        const unsubscribe = broker.subscribe(reply.raw);
        if (!unsubscribe) {
          // Refused before hijacking, so this is an ordinary JSON response.
          return reply.code(503).send({
            code: "STREAM_CAPACITY_REACHED",
            message: "The event stream is at capacity. Retry shortly."
          });
        }

        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });

        // Tell the browser how soon to retry, rather than leaving it to a
        // vendor-specific default of several seconds.
        reply.raw.write(`retry: ${RECONNECT_HINT_MS}\n\n`);
        reply.raw.write(
          `event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`
        );

        /*
         * A named event, not an SSE comment. `EventSource` never surfaces
         * comments to JavaScript, so a `: heartbeat` line keeps proxies awake
         * but leaves the client unable to tell a live stream from a dead socket.
         */
        const heartbeat = setInterval(() => {
          if (reply.raw.writableEnded) return;
          reply.raw.write(
            `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`
          );
        }, HEARTBEAT_INTERVAL_MS);

        /*
         * The handshake authorised this stream once. Logging out or letting the
         * session expire must also stop it — otherwise a revoked session keeps
         * receiving every trade booked for as long as the socket survives.
         */
        const recheck = setInterval(() => {
          void isSessionValid(request)
            .then((valid) => {
              if (valid || reply.raw.writableEnded) return;
              reply.raw.write(
                `event: session-expired\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`
              );
              reply.raw.end();
            })
            .catch(() => {
              // A transient database failure must not drop a healthy stream;
              // the next tick re-checks.
            });
        }, env.SSE_SESSION_RECHECK_SECONDS * 1_000);

        const teardown = () => {
          clearInterval(heartbeat);
          clearInterval(recheck);
          unsubscribe();
        };

        request.raw.on("close", teardown);
        reply.raw.on("close", teardown);
      }
    );
  };
}
