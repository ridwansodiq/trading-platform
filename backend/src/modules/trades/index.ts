import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { createTradeRoutes } from "./routes/trade.routes.js";
import { TradeAuditRepository } from "./repositories/trade-audit.repository.js";
import { TradeRepository } from "./repositories/trade.repository.js";
import { TradeService, type TradeEventPublisher } from "./services/trade.service.js";

/**
 * The trades module's public surface.
 *
 * Wiring lives here so the layers inside stay unaware of each other's
 * construction, and so nothing outside the module reaches past this file into
 * its services or repositories.
 */
export function createTradesModule(options: {
  requireAuth: preHandlerHookHandler;
  events: TradeEventPublisher;
}) {
  const auditRepository = new TradeAuditRepository(prisma);
  const tradeRepository = new TradeRepository(prisma, auditRepository);
  const tradeService = new TradeService(tradeRepository, auditRepository, options.events);

  return {
    tradeService,
    routes: createTradeRoutes({ tradeService, requireAuth: options.requireAuth })
  };
}

export { tradeEventSchema } from "./schemas/trade-response.schema.js";
export type { TradeState } from "./dtos/trade.dto.js";
export type { TradeEventPublisher } from "./services/trade.service.js";
