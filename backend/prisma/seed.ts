import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import {
  PrismaClient,
  type Prisma,
  type TradeAuditEventType,
  type TradeSide,
  type TradeStatus
} from "@prisma/client";

/**
 * Demo data.
 *
 * Sized to be worth querying: at a few hundred rows every sort looks correct
 * and every aggregate fits on one page, which hides exactly the problems
 * server-side sorting, paging and exposure exist to solve.
 *
 *   SEED_TRADE_COUNT=5000   how many trades to write (default)
 *   SEED_RESET=true         delete existing trades and audit history first
 *
 * Rows are written with `createMany` in batches; inserting 5,000 trades one
 * round trip at a time would take minutes.
 */
const TRADE_COUNT = Number(process.env.SEED_TRADE_COUNT ?? 5_000);
const RESET = process.env.SEED_RESET === "true";
const BATCH_SIZE = 1_000;

/** Trades span this many days back, so time-based sorting has real spread. */
const HISTORY_DAYS = 90;

const prisma = new PrismaClient();

if (!Number.isInteger(TRADE_COUNT) || TRADE_COUNT < 0) {
  throw new Error(`SEED_TRADE_COUNT must be a non-negative integer, got "${process.env.SEED_TRADE_COUNT}".`);
}

/**
 * Deterministic PRNG, so reseeding produces the same book twice and a bug
 * found against seeded data can be reproduced.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(0x5eed);
const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

const demoUsers = [
  ["alice.morgan@fusion.local", "Alice Morgan", "Rates"],
  ["bob.chen@fusion.local", "Bob Chen", "Credit"],
  ["maya.patel@fusion.local", "Maya Patel", "Equities"],
  ["sam.wilson@fusion.local", "Sam Wilson", "Operations"]
] as const satisfies ReadonlyArray<readonly [string, string, string]>;

const symbols = [
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "JPM", "GS", "BARC",
  "LLOY", "HSBA", "VOD", "BP", "SHEL", "AZN", "ULVR", "RIO", "GLEN", "NWG"
];
const books = ["ALPHA-1", "DELTA-2", "GAMMA-3", "OMEGA-4", "SIGMA-5", "THETA-6"];
const counterparties = [
  "Goldman Sachs", "J.P. Morgan", "Morgan Stanley", "Barclays", "HSBC",
  "Citadel Securities", "Jane Street", "Optiver", "Nomura", "BNP Paribas"
];

/** The shape stored in an audit snapshot: the module's `TradeState`, as JSON. */
type Snapshot = {
  id: string;
  tradeId: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  traderUserId: string;
  trader: string;
  book: string;
  counterparty: string;
  tradeTimestamp: string;
  status: TradeStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** `numeric(18,4)`, so a seeded price must already fit or the row would round. */
const toPrice = (value: number): number => Number(value.toFixed(4));

async function insertInBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insert(rows.slice(start, start + BATCH_SIZE));
  }
}

const passwordHash = await hash("Fusion123!", {
  memoryCost: 19_456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1
});

const users = await Promise.all(
  demoUsers.map(([email, displayName, desk]) =>
    prisma.user.upsert({
      where: { email },
      update: { displayName, desk, passwordHash },
      create: { email, displayName, desk, passwordHash }
    })
  )
);

if (RESET) {
  // Audit first: its foreign key to Trade is `onDelete: Restrict`.
  const audit = await prisma.tradeAuditEvent.deleteMany({});
  const trades = await prisma.trade.deleteMany({});
  console.log(`Reset: removed ${trades.count} trades and ${audit.count} audit events.`);
}

const existingTradeCount = await prisma.trade.count();

if (existingTradeCount > 0) {
  console.log(
    `Updated demo users; kept ${existingTradeCount} existing trades.\n` +
      "Re-run with SEED_RESET=true to replace them.\n" +
      "Login: alice.morgan@fusion.local / Fusion123!"
  );
  await prisma.$disconnect();
  process.exit(0);
}

const trades: Prisma.TradeCreateManyInput[] = [];
const auditEvents: Prisma.TradeAuditEventCreateManyInput[] = [];
const now = Date.now();

for (let index = 0; index < TRADE_COUNT; index += 1) {
  const user = users[index % users.length]!;
  const id = randomUUID();
  const tradeId = `TRD-${100_000 + index}`;

  const bookedAt = new Date(now - Math.floor(random() * HISTORY_DAYS * 24 * 60 * 60 * 1000));
  const side: TradeSide = random() < 0.5 ? "BUY" : "SELL";
  const quantity = between(1, 200) * 100;
  const price = toPrice(5 + random() * 495);

  /**
   * A realistic mix of lifecycles rather than every trade sitting at v1.
   * Amendments matter most: without them the audit timeline never renders a
   * field-level diff, which is the part of that screen worth looking at.
   */
  const amendments = random() < 0.35 ? (random() < 0.3 ? 2 : 1) : 0;
  const outcome = random();
  const terminal: TradeStatus | null =
    outcome < 0.22 ? "EXECUTED" : outcome < 0.37 ? "CANCELLED" : null;

  const base: Snapshot = {
    id,
    tradeId,
    symbol: pick(symbols),
    side,
    quantity,
    price,
    traderUserId: user.id,
    trader: user.displayName,
    book: pick(books),
    counterparty: pick(counterparties),
    tradeTimestamp: bookedAt.toISOString(),
    status: "NEW",
    version: 1,
    createdAt: bookedAt.toISOString(),
    updatedAt: bookedAt.toISOString()
  };

  const pushEvent = (
    eventType: TradeAuditEventType,
    before: Snapshot | null,
    after: Snapshot
  ) => {
    auditEvents.push({
      tradeId: id,
      tradeVersion: after.version,
      eventType,
      actorUserId: user.id,
      actorDisplayName: user.displayName,
      ...(before ? { before } : {}),
      after,
      createdAt: new Date(after.updatedAt)
    });
  };

  pushEvent("CREATED", null, base);

  // Each version is one audit event, and versions increase by exactly one.
  let current = base;
  let elapsed = 0;

  for (let amendment = 0; amendment < amendments; amendment += 1) {
    elapsed += between(2, 240) * 60_000;
    const next: Snapshot = {
      ...current,
      // An amendment moves the economics, which is what makes the diff show.
      quantity: between(1, 200) * 100,
      price: toPrice(current.price * (0.9 + random() * 0.2)),
      version: current.version + 1,
      updatedAt: new Date(bookedAt.getTime() + elapsed).toISOString()
    };
    pushEvent("AMENDED", current, next);
    current = next;
  }

  if (terminal) {
    elapsed += between(2, 240) * 60_000;
    const next: Snapshot = {
      ...current,
      status: terminal,
      version: current.version + 1,
      updatedAt: new Date(bookedAt.getTime() + elapsed).toISOString()
    };
    pushEvent(terminal, current, next);
    current = next;
  }

  trades.push({
    id: current.id,
    tradeId: current.tradeId,
    symbol: current.symbol,
    side: current.side,
    quantity: current.quantity,
    price: current.price,
    traderUserId: current.traderUserId,
    trader: current.trader,
    book: current.book,
    counterparty: current.counterparty,
    tradeTimestamp: new Date(current.tradeTimestamp),
    status: current.status,
    version: current.version,
    createdAt: new Date(current.createdAt),
    updatedAt: new Date(current.updatedAt)
  });
}

await insertInBatches(trades, (batch) => prisma.trade.createMany({ data: batch }));
await insertInBatches(auditEvents, (batch) => prisma.tradeAuditEvent.createMany({ data: batch }));

console.log(
  `Seeded ${users.length} users, ${trades.length} trades and ${auditEvents.length} audit events.\n` +
    "Login: alice.morgan@fusion.local / Fusion123!"
);

await prisma.$disconnect();
