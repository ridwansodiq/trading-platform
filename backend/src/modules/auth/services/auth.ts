import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { env, sessionCookieSecure } from "../../../infrastructure/config/env";
import type { AuthenticatedUser, EstablishedSession, LoginDto } from "../types";
import { InvalidCredentialsError } from "../errors/auth";
import type { SessionRepository } from "../repositories/session";
import type { UserRepository } from "../repositories/user";

const TOKEN_BYTES = 32;

/**
 * A real Argon2id hash of a value nobody uses, verified when no account matches
 * so that a login attempt costs the same whether or not the email exists.
 * Without it, response time alone distinguishes a registered address.
 */
const DUMMY_PASSWORD_HASH = await hash(randomBytes(32).toString("hex"), {
  memoryCost: 19_456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1
});

/**
 * Credential verification and opaque session lifecycle.
 *
 * Authentication exists here primarily so audit attribution is trustworthy:
 * every trade command records a real, server-resolved user.
 */
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository
  ) {}

  readonly cookieName = env.SESSION_COOKIE_NAME;

  readonly cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: sessionCookieSecure,
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 60 * 60
  };

  async login({ email, password }: LoginDto): Promise<EstablishedSession> {
    const user = await this.users.findByEmail(email);

    /*
     * Always run a verification, even with no user, so the work done is
     * identical either way. The generic error keeps the response from
     * distinguishing the two cases; this keeps the timing from doing it.
     */
    const passwordMatches = await verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.sessions.create(hashToken(token), user.id, expiresAt);

    return { token, user: toAuthenticatedUser(user) };
  }

  /** Returns null rather than throwing: not every route requires a session. */
  async resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const session = await this.sessions.findActive(hashToken(token), new Date());
    return session ? toAuthenticatedUser(session.user) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.deleteByTokenHash(hashToken(token));
  }

  /** Removes rows that can no longer authenticate anything. */
  async purgeExpiredSessions(): Promise<number> {
    return this.sessions.deleteExpired(new Date());
  }
}

/**
 * SHA-256 is the right primitive here, not Argon2: the token is 256 bits of
 * randomness rather than a guessable secret, so there is nothing to slow a
 * brute force against. The hash exists so a leaked table is not a set of live
 * credentials.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  displayName: string;
  desk: string;
}): AuthenticatedUser {
  return { id: user.id, email: user.email, displayName: user.displayName, desk: user.desk };
}
