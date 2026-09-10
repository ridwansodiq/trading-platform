import { buildApp } from "./app.js";
import { env } from "./infrastructure/config/env.js";
import { prisma } from "./infrastructure/database/prisma.js";

/** Past this, stop waiting for in-flight work and exit anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = await buildApp();

let shuttingDown = false;

/**
 * A second signal during shutdown, or a close that hangs, must still terminate
 * the process — an orchestrator will otherwise escalate to SIGKILL and cut off
 * a request mid-transaction.
 */
const close = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    app.log.error("Shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    /*
     * Drain first. `close()` waits for open connections, and a hijacked SSE
     * stream never ends on its own, so closing before draining would block
     * until the timeout above fires.
     */
    app.drainRealtime();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Shutdown failed");
    process.exit(1);
  }
};

process.on("SIGINT", () => void close("SIGINT"));
process.on("SIGTERM", () => void close("SIGTERM"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
