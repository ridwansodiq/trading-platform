import type { PrismaClient, User } from "@prisma/client";

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Email is stored normalised, so lookups normalise too. */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }
}
