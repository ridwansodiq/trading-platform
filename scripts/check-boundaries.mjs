#!/usr/bin/env node
/**
 * Asserts the architecture boundaries are actually enforced.
 *
 * A `no-restricted-imports` rule fails silently in two ways: its patterns match
 * the import specifier text rather than the resolved path, and in flat config a
 * later block replaces the rule for overlapping files instead of merging. Both
 * leave a green lint run with no protection at all.
 *
 * So rather than trusting the config, this writes a probe file containing a
 * forbidden import next to each real one and requires ESLint to reject it.
 *
 * The probe is a *new* file, never an edit to a tracked one. An earlier version
 * appended to the real source and restored it in a `finally`, which meant a
 * Ctrl-C or a CI timeout mid-run left the working tree corrupted.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Each case places a probe in the same directory as `near`, so it matches the
 * same ESLint `files` pattern the real file does.
 */
const CASES = [
  // ── Backend: trades module ───────────────────────────────────────────────
  {
    label: "trade routes -> Prisma",
    near: "backend/src/modules/trades/routes/trade.ts",
    code: 'import { PrismaClient } from "@prisma/client"; void PrismaClient;'
  },
  {
    label: "trade routes -> repository",
    near: "backend/src/modules/trades/routes/trade.ts",
    code: 'import { TradeRepository } from "../repositories/trade"; void TradeRepository;'
  },
  {
    label: "trade routes -> auth internals",
    near: "backend/src/modules/trades/routes/trade.ts",
    code: 'import { AuthService } from "../../auth/services/auth"; void AuthService;'
  },
  {
    label: "trade service -> Fastify",
    near: "backend/src/modules/trades/services/trade.ts",
    code: 'import type { FastifyRequest } from "fastify"; export type Probe = FastifyRequest;'
  },
  {
    label: "trade service -> Prisma",
    near: "backend/src/modules/trades/services/trade.ts",
    code: 'import { prisma } from "../../../infrastructure/database/prisma"; void prisma;'
  },
  {
    label: "trade service -> auth module",
    near: "backend/src/modules/trades/services/trade.ts",
    code: 'import { createAuthModule } from "../../auth/index"; void createAuthModule;'
  },
  {
    label: "trade repository -> Fastify",
    near: "backend/src/modules/trades/repositories/trade.ts",
    code: 'import type { FastifyReply } from "fastify"; export type Probe = FastifyReply;'
  },
  {
    label: "trade repository -> service",
    near: "backend/src/modules/trades/repositories/trade.ts",
    code: 'import { TradeService } from "../services/trade"; void TradeService;'
  },
  {
    label: "trade schemas -> Fastify",
    near: "backend/src/modules/trades/schemas/trade-response.ts",
    code: 'import type { FastifyRequest } from "fastify"; export type Probe = FastifyRequest;'
  },

  // ── Backend: auth module ─────────────────────────────────────────────────
  {
    label: "auth routes -> Prisma",
    near: "backend/src/modules/auth/routes/auth.ts",
    code: 'import { PrismaClient } from "@prisma/client"; void PrismaClient;'
  },
  {
    label: "auth service -> Fastify",
    near: "backend/src/modules/auth/services/auth.ts",
    code: 'import type { FastifyRequest } from "fastify"; export type Probe = FastifyRequest;'
  },
  {
    label: "auth repository -> service",
    near: "backend/src/modules/auth/repositories/user.ts",
    code: 'import { AuthService } from "../services/auth"; void AuthService;'
  },

  // ── Backend: cross-cutting ───────────────────────────────────────────────
  {
    label: "realtime -> module service",
    near: "backend/src/realtime/sse/trade-events.ts",
    code: 'import { TradeService } from "../../modules/trades/services/trade"; void TradeService;'
  },
  {
    label: "infrastructure -> module",
    near: "backend/src/infrastructure/logging/logger.ts",
    code: 'import { TradeService } from "../../modules/trades/services/trade"; void TradeService;'
  },

  // ── Frontend: feature isolation ──────────────────────────────────────────
  {
    label: "trades feature -> auth feature (alias)",
    near: "frontend/src/features/trades/hooks/use-trades.ts",
    extension: ".ts",
    code: 'import { useSession } from "@/features/auth/hooks/use-session"; void useSession;'
  },
  {
    label: "trades feature -> auth feature (relative)",
    near: "frontend/src/features/trades/hooks/use-trades.ts",
    extension: ".ts",
    code: 'import { useSession } from "../../auth/hooks/use-session"; void useSession;'
  },
  {
    label: "auth feature -> trades feature",
    near: "frontend/src/features/auth/hooks/use-session.ts",
    extension: ".ts",
    code: 'import { useTrades } from "@/features/trades/hooks/use-trades"; void useTrades;'
  },
  {
    label: "shared component -> feature",
    near: "frontend/src/components/layout/top-bar.tsx",
    extension: ".tsx",
    code: 'import { useSession } from "@/features/auth/hooks/use-session"; void useSession;'
  },
  {
    label: "shared lib -> feature",
    near: "frontend/src/lib/format.ts",
    extension: ".ts",
    code: 'import { toTradeView } from "@/features/trades/lib/trade-view"; void toTradeView;'
  }
];

/** Returns the ESLint output when it fails, or null when it passes. */
function lintOutput(file) {
  try {
    execFileSync("npx", ["eslint", "--no-warn-ignored", file], {
      encoding: "utf8",
      stdio: "pipe"
    });
    return null;
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

const scratch = mkdtempSync(".boundary-probe-");
let failures = 0;

try {
  for (const [index, { label, near, code, extension = ".ts" }] of CASES.entries()) {
    /*
     * The probe lives beside the file it stands in for so it matches the same
     * `files` glob, but under a scratch-prefixed name that is git-ignored and
     * unmistakably not source.
     */
    const probe = join(dirname(near), `${scratch}-${index}${extension}`);

    let output;
    try {
      writeFileSync(probe, `${code}\n`);
      output = lintOutput(probe);
    } finally {
      rmSync(probe, { force: true });
    }

    if (output?.includes("no-restricted-imports")) {
      console.log(`  ok       ${label}`);
    } else {
      failures += 1;
      console.error(`  NOT ENFORCED  ${label}  (probe beside ${near})`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(
    `\n${failures} architecture boundary/boundaries are documented but not enforced.` +
      "\nCheck eslint.config.mjs — remember that patterns match the import specifier" +
      "\ntext, and that a later flat-config block replaces the rule rather than" +
      "\nmerging with it.\n"
  );
  process.exit(1);
}

console.log(`\nAll ${CASES.length} architecture boundaries are enforced.`);
