import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { commonErrorResponses } from "../../../infrastructure/errors/error.schema";
import type { AmendTradeBody } from "../schemas/amend-trade";
import { amendTradeSchema } from "../schemas/amend-trade";
import type { CreateTradeBody } from "../schemas/create-trade";
import { createTradeSchema } from "../schemas/create-trade";
import {
  exposureQuerySchema,
  filterOptionsQuerySchema,
  listTradesQuerySchema,
  tradeFilterOptionsSchema
} from "../schemas/list-trades";
import { tradeErrorSchema } from "../schemas/trade-error";
import {
  tradeAuditPageSchema,
  tradeExposureSchema,
  tradePageSchema,
  tradeSchema
} from "../schemas/trade-response";
import type { TransitionTradeBody } from "../schemas/transition-trade";
import { transitionTradeSchema } from "../schemas/transition-trade";
import type { AmendableTradeFields } from "../schemas/amend-trade";
import type { ExposureInput, ListFilterOptionsInput, ListTradesInput } from "../schemas/list-trades";
import type { TradeActor } from "../types";
import type { TradeService } from "../services/trade";

const security = [{ sessionCookie: [] }];
const idParamsSchema = z.object({ id: z.string().uuid() });

/** Shared by every route here, so no status code goes undocumented. */
const errors = commonErrorResponses(tradeErrorSchema);
const mutationErrors = { ...errors, 404: tradeErrorSchema, 409: tradeErrorSchema, 422: tradeErrorSchema };

export type TradeRoutesOptions = {
  tradeService: TradeService;
  requireAuth: preHandlerHookHandler;
};

/**
 * Thin HTTP layer: validate, build the service input from the request plus the
 * authenticated session, and call the service.
 *
 * There is no error handling here at all. Every failure — a stale version, a
 * terminal trade, a malformed body — travels as a thrown `ApplicationError` to
 * the one handler registered in `infrastructure/errors/error-handler.ts`, which
 * is also what guarantees a single error envelope across the whole API.
 */
export function createTradeRoutes({ tradeService, requireAuth }: TradeRoutesOptions): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    /** Actor identity always comes from the session, never the payload. */
    const actor = (request: FastifyRequest): TradeActor => {
      if (!request.currentUser) throw new Error("Authenticated route is missing actor context.");
      return { id: request.currentUser.id, displayName: request.currentUser.displayName };
    };

    app.get(
      "/api/trades",
      {
        schema: {
          operationId: "listTrades",
          tags: ["Trades"],
          security,
          querystring: listTradesQuerySchema,
          response: { 200: tradePageSchema, ...errors }
        }
      },
      async (request) => tradeService.list(request.query as ListTradesInput)
    );

    app.get(
      "/api/trades/exposure",
      {
        schema: {
          operationId: "getTradeExposure",
          tags: ["Trades"],
          security,
          description:
            "Notional and status aggregates across every trade matching the filter, not just the requested page. " +
            "Takes the same filter parameters as GET /api/trades so the two always describe the same set of trades.",
          querystring: exposureQuerySchema,
          response: { 200: tradeExposureSchema, ...errors }
        }
      },
      async (request) => tradeService.getExposure(request.query as ExposureInput)
    );

    app.get(
      "/api/trades/filter-options",
      {
        schema: {
          operationId: "listTradeFilterOptions",
          tags: ["Trades"],
          security,
          description:
            "Distinct values for one filterable column, searched server-side so the blotter scales past the values present on the current page.",
          querystring: filterOptionsQuerySchema,
          response: { 200: tradeFilterOptionsSchema, ...errors }
        }
      },
      async (request) => tradeService.listFilterOptions(request.query as ListFilterOptionsInput)
    );

    app.post(
      "/api/trades",
      {
        schema: {
          operationId: "createTrade",
          tags: ["Trades"],
          security,
          body: createTradeSchema,
          response: { 201: tradeSchema, ...errors, 422: tradeErrorSchema }
        }
      },
      async (request, reply) => {
        const body = request.body as CreateTradeBody;
        const trade = await tradeService.create({ ...body, actor: actor(request) });
        return reply.code(201).send(trade);
      }
    );

    app.get(
      "/api/trades/:id",
      {
        schema: {
          operationId: "getTrade",
          tags: ["Trades"],
          security,
          params: idParamsSchema,
          response: { 200: tradeSchema, ...errors, 404: tradeErrorSchema }
        }
      },
      async (request) => tradeService.getById((request.params as { id: string }).id)
    );

    app.get(
      "/api/trades/:id/audit",
      {
        schema: {
          operationId: "getTradeAudit",
          tags: ["Trades"],
          security,
          params: idParamsSchema,
          response: { 200: tradeAuditPageSchema, ...errors, 404: tradeErrorSchema }
        }
      },
      async (request) => ({
        data: await tradeService.getAuditHistory((request.params as { id: string }).id)
      })
    );

    app.patch(
      "/api/trades/:id",
      {
        schema: {
          operationId: "amendTrade",
          tags: ["Trades"],
          security,
          description:
            "Applies only the fields present in the body. Send just what changed: an omitted field keeps its current value, " +
            "so two traders amending different fields of the same trade do not overwrite each other.",
          params: idParamsSchema,
          body: amendTradeSchema,
          response: { 200: tradeSchema, ...mutationErrors }
        }
      },
      async (request) => {
        const { id } = request.params as { id: string };
        const { expectedVersion, ...rawChanges } = request.body as AmendTradeBody;

        // Absent keys must not be treated as "clear this field".
        const changes = Object.fromEntries(
          Object.entries(rawChanges).filter(([, value]) => value !== undefined)
        ) as AmendableTradeFields;

        return tradeService.amend({
          tradeId: id,
          expectedVersion,
          changes,
          actor: actor(request)
        });
      }
    );

    for (const [path, transition, operationId] of [
      ["execute", "EXECUTE", "executeTrade"],
      ["cancel", "CANCEL", "cancelTrade"]
    ] as const) {
      app.post(
        `/api/trades/:id/${path}`,
        {
          schema: {
            operationId,
            tags: ["Trades"],
            security,
            params: idParamsSchema,
            body: transitionTradeSchema,
            response: { 200: tradeSchema, ...mutationErrors }
          }
        },
        async (request) =>
          tradeService.transition({
            tradeId: (request.params as { id: string }).id,
            transition,
            expectedVersion: (request.body as TransitionTradeBody).expectedVersion,
            actor: actor(request)
          })
      );
    }
  };
}
