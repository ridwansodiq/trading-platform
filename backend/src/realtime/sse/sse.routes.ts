import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { env } from "../../infrastructure/config/env";
import { apiErrorSchema } from "../../infrastructure/errors/error.schema";
import type { TradeEvent } from "../../modules/trades/index";
import { tradeEventSchema } from "../../modules/trades/index";
import { sseFrame, type SseBroker } from "./sse-broker";
import { TRADE_UPDATE_EVENT } from "./trade-events";

/**
 * Liveness cadence. Short enough that a client can call a silent connection
 * dead within seconds; a heartbeat frame is ~60 bytes, so the cost per
 * connected client is negligible.
 */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** Retry delay the browser should use after the stream drops. */
const RECONNECT_HINT_MS = 2_000;

/**
 * A cursor we issued is a `BIGINT` in decimal. Anything else did not come from
 * this server — a proxy, a hand-written client, a stale format — and is ignored
 * rather than fed to the database. The range check is part of that: 19 digits
 * is the widest an `int8` can be but not every 19-digit number fits in one, and
 * the ones that do not are rejected here rather than by PostgreSQL.
 */
const STREAM_CURSOR = /^\d{1,19}$/;
const MAX_STREAM_CURSOR = 9_223_372_036_854_775_807n;

export type SseRoutesOptions = {
  broker: SseBroker;
  requireAuth: preHandlerHookHandler;
  /** Re-checks the request's session while its stream is still open. */
  isSessionValid: (request: FastifyRequest) => Promise<boolean>;
  /** Events committed after a cursor, oldest first, for `Last-Event-ID` replay. */
  replayEvents: (afterStreamSequence: string) => Promise<TradeEvent[]>;
};

export function createSseRoutes({
  broker,
  requireAuth,
  isSessionValid,
  replayEvents
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
            "its session is revoked or expires, and when the server has no capacity for another subscriber. " +
            "Each event frame is identified by its streamSequence, the audit event's position in the global event " +
            "stream; reconnecting with that value in Last-Event-ID replays everything committed after it, oldest " +
            "first, before live events resume.",
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
         * Replay after subscribing, never before. A query run first would leave
         * a gap: anything committed between reading the log and joining the
         * broadcast would reach the client through neither path. This way the
         * overlap is duplicates instead — a live frame written while the replay
         * query is still running, then repeated by it — and a duplicate is
         * already harmless, because the blotter applies strictly newer versions
         * only.
         */
        void replayMissed(request, replayEvents)
          .then((missed) => {
            if (reply.raw.writableEnded) return;
            for (const event of missed) {
              reply.raw.write(sseFrame(TRADE_UPDATE_EVENT, event, event.streamSequence));
            }
          })
          .catch((error: unknown) => {
            // The client refetches from REST on connect regardless, so a failed
            // replay costs freshness between the two, not correctness.
            request.log.error({ err: error }, "Failed to replay missed trade events.");
          });

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

/**
 * The events a reconnecting client is missing, if it told us where it got to.
 *
 * `EventSource` resends the last id it saw in `Last-Event-ID` on its own, so a
 * browser needs no code to participate in this — which is also why the id on a
 * published frame has to be the `streamSequence` the replay query orders by.
 * A first connection carries no such header and is replayed nothing: it is
 * about to load the blotter from REST anyway.
 */
async function replayMissed(
  request: FastifyRequest,
  replayEvents: (afterStreamSequence: string) => Promise<TradeEvent[]>
): Promise<TradeEvent[]> {
  const cursor = request.headers["last-event-id"];
  if (typeof cursor !== "string" || !STREAM_CURSOR.test(cursor)) return [];
  if (BigInt(cursor) > MAX_STREAM_CURSOR) return [];
  return replayEvents(cursor);
}
