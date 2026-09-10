import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";

/**
 * Writes the OpenAPI document the frontend client is generated from.
 *
 * Resolved from this file rather than the working directory, so the output
 * lands in the repository's `openapi/` whichever directory the script is
 * invoked from.
 */
const outputDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../openapi");

const app = await buildApp();
await app.ready();
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "openapi.json"), `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
await prisma.$disconnect();
