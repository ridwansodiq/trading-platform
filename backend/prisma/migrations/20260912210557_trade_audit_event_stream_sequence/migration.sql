-- ---------------------------------------------------------------------------
-- A global ordering over the audit log.
--
-- `tradeVersion` orders one trade's own history; it cannot say whether trade
-- A's second amendment happened before or after trade B's first. `BIGSERIAL`
-- makes PostgreSQL assign that ordering as each row is inserted, so the SSE
-- stream has a cursor a reconnecting client can resume from, and so several
-- application instances can share one sequence without coordinating.
--
-- Existing rows are backfilled by the column default in whatever order the
-- table is scanned. That is fine: the values only have to be distinct and
-- ordered relative to events written from here on.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "TradeAuditEvent" ADD COLUMN     "streamSequence" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TradeAuditEvent_streamSequence_key" ON "TradeAuditEvent"("streamSequence");
