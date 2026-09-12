import type { Prisma, PrismaClient } from "@prisma/client";
import { toJsonSnapshot } from "../mappers/trade";
import type {
  TradeAuditEventDraft,
  TradeAuditEventRecord,
  TradeEvent,
  TradeState
} from "../types";

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
   * `createdAt` and `streamSequence` are both left to the database: an
   * append-only log is only trustworthy if its clock is the one place a caller
   * cannot influence, and its global ordering is only safe across several
   * application instances if PostgreSQL is the one handing numbers out.
   *
   * Returns the committed event so the service can publish exactly what was
   * written, `streamSequence` included — the value the SSE frame is identified
   * by, and the cursor a reconnecting client resumes from.
   */
  async insert(tx: Prisma.TransactionClient, draft: TradeAuditEventDraft): Promise<TradeEvent> {
    const stored = await tx.tradeAuditEvent.create({
      data: {
        tradeId: draft.tradeId,
        tradeVersion: draft.tradeVersion,
        eventType: draft.eventType,
        actorUserId: draft.actorUserId,
        actorDisplayName: draft.actorDisplayName,
        // Prisma rejects an explicit JSON null, so omit the key for a create.
        ...(draft.before === null ? {} : { before: toJsonSnapshot(draft.before) }),
        after: toJsonSnapshot(draft.after)
      },
      select: { id: true, streamSequence: true, createdAt: true }
    });

    return {
      id: stored.id,
      eventType: draft.eventType,
      trade: draft.after,
      occurredAt: stored.createdAt.toISOString(),
      streamSequence: stored.streamSequence.toString()
    };
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

  /**
   * Everything committed after a point in the global stream, oldest first.
   *
   * This is the `Last-Event-ID` replay: `streamSequence` is unique and
   * monotonic, so a client that names the last id it saw is sent precisely the
   * events it missed, in the order they were written. Ordering by
   * `tradeVersion` or `createdAt` could not do that — one is per trade, and the
   * other is not unique.
   *
   * The cursor arrives as a string because that is how it left here, and it is
   * widened back to `BIGINT` in the only layer that should know the column's
   * type. `take` bounds a long absence: past it the client resynchronises from
   * REST, which it does on every connect anyway.
   */
  async listSince(afterStreamSequence: string, take: number): Promise<TradeEvent[]> {
    const events = await this.prisma.tradeAuditEvent.findMany({
      where: { streamSequence: { gt: BigInt(afterStreamSequence) } },
      orderBy: { streamSequence: "asc" },
      take,
      select: { id: true, eventType: true, after: true, createdAt: true, streamSequence: true }
    });

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      trade: event.after as unknown as TradeState,
      occurredAt: event.createdAt.toISOString(),
      streamSequence: event.streamSequence.toString()
    }));
  }
}
