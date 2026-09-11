import type { Prisma, PrismaClient } from "@prisma/client";
import { toJsonSnapshot } from "../mappers/trade";
import type { TradeAuditEventDraft, TradeAuditEventRecord, TradeState } from "../types";

/**
 * The append-only audit log.
 *
 * Writes take the caller's transaction client rather than opening their own, so
 * an audit event can never commit apart from the trade change that produced it.
 * That is the whole reason audit lives inside the trades module.
 */
export class TradeAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * `createdAt` is left to the database default: an append-only log is only
   * trustworthy if its clock is the one place that cannot be influenced by a
   * caller.
   */
  async insert(tx: Prisma.TransactionClient, draft: TradeAuditEventDraft): Promise<void> {
    await tx.tradeAuditEvent.create({
      data: {
        tradeId: draft.tradeId,
        tradeVersion: draft.tradeVersion,
        eventType: draft.eventType,
        actorUserId: draft.actorUserId,
        actorDisplayName: draft.actorDisplayName,
        // Prisma rejects an explicit JSON null, so omit the key for a create.
        ...(draft.before === null ? {} : { before: toJsonSnapshot(draft.before) }),
        after: toJsonSnapshot(draft.after)
      }
    });
  }

  /** Oldest first, so a lifecycle reads downwards. */
  async listForTrade(tradeId: string): Promise<TradeAuditEventRecord[]> {
    const events = await this.prisma.tradeAuditEvent.findMany({
      where: { tradeId },
      orderBy: { tradeVersion: "asc" },
      select: {
        id: true,
        tradeVersion: true,
        eventType: true,
        actorUserId: true,
        actorDisplayName: true,
        before: true,
        after: true,
        createdAt: true
      }
    });

    return events.map((event) => ({
      id: event.id,
      tradeVersion: event.tradeVersion,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorDisplayName: event.actorDisplayName,
      before: (event.before ?? null) as TradeState | null,
      after: event.after as unknown as TradeState,
      createdAt: event.createdAt.toISOString()
    }));
  }
}
