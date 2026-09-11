import { env, isTest } from "../config/env";

/**
 * Fastify logger options. Silent under test so suite output stays readable.
 */
export const loggerOptions = isTest
  ? false
  : { level: env.NODE_ENV === "production" ? "info" : "debug" };
