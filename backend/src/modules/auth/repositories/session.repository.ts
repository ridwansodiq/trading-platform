import type { PrismaClient, Session, User } from "@prisma/client";

export type SessionWithUser = Session & { user: User };

/**
 * Sessions are stored as a SHA-256 hash of the opaque token, so a database
 * leak does not hand over usable credentials.
 */
export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.prisma.session.create({ data: { tokenHash, userId, expiresAt } });
  }

  async findActive(tokenHash: string, now: Date): Promise<SessionWithUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true }
    });
    if (!session || session.expiresAt <= now) return null;
    return session;
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  /**
   * Expired rows are never read again, but nothing else removes them, so
   * without a sweep the table grows for the life of the deployment.
   */
  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: now } }
    });
    return count;
  }
}
