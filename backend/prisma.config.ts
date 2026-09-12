import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/*
 * A config file replaces the CLI's own `.env` discovery, so the file it used to
 * find by itself has to be loaded here instead. Resolved from this file rather
 * than the working directory, so `npm run db:migrate -w backend` and a bare
 * `prisma` invocation read the same one. It is absent in the container image,
 * where the environment is supplied directly; dotenv no-ops in that case.
 */
loadEnv({ path: fileURLToPath(new URL(".env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // tsx, because the seed is TypeScript. The container image never runs this
    // path: it has no tsx and executes the compiled dist/prisma/seed.js.
    seed: "tsx prisma/seed.ts"
  }
});
