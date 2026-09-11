import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../../infrastructure/database/prisma";
import { createTradeRoutes } from "./routes/trade";
import { TradeAuditRepository } from "./repositories/trade-audit";
import { TradeRepository } from "./repositories/trade";
import { TradeService, type TradeEventPublisher } from "./services/trade";

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

  return { routes: createTradeRoutes({ tradeService, requireAuth: options.requireAuth }) };
}

export { tradeEventSchema } from "./schemas/trade-response";
export type { TradeState } from "./types";
export type { TradeEventPublisher } from "./services/trade";
