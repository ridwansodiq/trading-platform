import "dotenv/config";
import { z } from "zod";

/**
 * Validated environment configuration.
 *
 * Read once, here, so a missing or malformed variable fails at startup with a
 * clear message instead of surfacing as `undefined` deep inside a request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().min(1).default("fusion_session"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),

  /**
   * How often expired session rows are deleted. Nothing else prunes them, so
   * without this the table grows for the life of the deployment.
   */
  SESSION_SWEEP_MINUTES: z.coerce.number().positive().default(15),

  /**
   * Upper bound on concurrent SSE subscribers. Each one holds an open socket
   * and a heartbeat timer, so an unbounded count is a denial-of-service vector.
   */
  SSE_MAX_CLIENTS: z.coerce.number().int().positive().default(500),

  /**
   * How often a live SSE connection re-checks that its session is still valid.
   * Without it, a stream opened before logout keeps delivering trade data.
   */
  SSE_SESSION_RECHECK_SECONDS: z.coerce.number().int().positive().default(60),

  /**
   * Swagger UI is a full description of the API surface, so it is opt-in
   * outside development rather than served to the internet by default.
   */
  ENABLE_API_DOCS: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Docs default to on everywhere but production, where they must be requested. */
export const apiDocsEnabled = env.ENABLE_API_DOCS ?? !isProduction;
