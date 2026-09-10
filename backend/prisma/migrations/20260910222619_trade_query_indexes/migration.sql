-- The trigram indexes below need pg_trgm. Prisma emits the indexes from the
-- schema but not the extension they depend on, so it is created here first.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex
DROP INDEX "Trade_tradeTimestamp_idx";

-- CreateIndex
CREATE INDEX "Trade_side_idx" ON "Trade"("side");

-- CreateIndex
CREATE INDEX "Trade_counterparty_idx" ON "Trade"("counterparty");

-- CreateIndex
CREATE INDEX "Trade_tradeTimestamp_tradeId_idx" ON "Trade"("tradeTimestamp", "tradeId");

-- CreateIndex
CREATE INDEX "Trade_price_tradeId_idx" ON "Trade"("price", "tradeId");

-- CreateIndex
CREATE INDEX "Trade_quantity_tradeId_idx" ON "Trade"("quantity", "tradeId");

-- CreateIndex
CREATE INDEX "Trade_version_tradeId_idx" ON "Trade"("version", "tradeId");

-- CreateIndex
CREATE INDEX "Trade_tradeId_trgm_idx" ON "Trade" USING GIN ("tradeId" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Trade_symbol_trgm_idx" ON "Trade" USING GIN ("symbol" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Trade_trader_trgm_idx" ON "Trade" USING GIN ("trader" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Trade_book_trgm_idx" ON "Trade" USING GIN ("book" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Trade_counterparty_trgm_idx" ON "Trade" USING GIN ("counterparty" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "TradeAuditEvent_actorUserId_idx" ON "TradeAuditEvent"("actorUserId");

-- ---------------------------------------------------------------------------
-- Notional is derived and never stored, so the Prisma schema cannot express an
-- index for it. PostgreSQL can still index the expression, which is what lets
-- the blotter sort by notional across the whole result set instead of
-- re-sorting whichever page the client happens to have loaded. Prisma leaves
-- expression indexes it cannot represent alone, so this survives `migrate dev`.
-- ---------------------------------------------------------------------------
CREATE INDEX "Trade_notional_idx" ON "Trade" (("quantity" * "price"), "tradeId");
