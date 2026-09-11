import { useSyncExternalStore } from "react";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import { amendTrade, createTrade, listTrades } from "@/api/generated/endpoints/trades/trades";
import { ok } from "@/api/unwrap";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Trade } from "@/api/generated/models";

/**
 * The demo pulse, driven entirely from the browser.
 *
 * **Simulate** starts a loop that runs two actions a second until it is
 * stopped: every third one books a fresh trade, the rest nudge the price or
 * quantity of a live trade from the first page. Each action is an ordinary REST
 * command over the same endpoints a human's clicks use, so it is
 * version-checked, audited and streamed back like any other — the blotter picks
 * the results up over SSE, which is why nothing here touches the query cache.
 *
 * That is 120 commands a minute plus a listing every twenty seconds or so,
 * against the API's 500-a-minute budget. Raising the rate here is what would
 * start returning 429s, and the share spent on bookings is what decides how
 * often the pool has to be refilled.
 *
 * It calls the generated endpoints rather than `useTradeMutations` because the
 * loop runs at module scope, outside React — and because those hooks invalidate
 * the query cache on success, which is exactly what this must not do: the point
 * is to watch the blotter react over SSE, the way it would to another trader.
 *
 * It renders as one dropdown item, but it is trade behaviour, not chrome, so it
 * lives with the feature and is passed into `TopBar` as a menu item.
 */
const TICK_MS = 500;
const ACTIONS_PER_BOOKING = 3;
const PAGE_SIZE = 25;

/**
 * A moved trade or a lost race is ordinary and gets dropped, but a session that
 * has expired fails *every* action — so a run of them stops the loop rather
 * than letting it retry twice a second forever.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

const SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "JPM", "GS", "BARC",
  "LLOY", "HSBA", "VOD", "BP", "SHEL", "AZN", "ULVR", "RIO", "GLEN", "NWG"
];
const BOOKS = ["ALPHA-1", "DELTA-2", "GAMMA-3", "OMEGA-4", "SIGMA-5", "THETA-6"];
const COUNTERPARTIES = [
  "Goldman Sachs", "J.P. Morgan", "Morgan Stanley", "Barclays", "HSBC",
  "Citadel Securities", "Jane Street", "Optiver", "Nomura", "BNP Paribas"
];

const pick = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!;
const between = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));
/** `numeric(18,4)` on the server, and its schema rejects anything finer. */
const toPrice = (value: number): number => Number(value.toFixed(4));

/**
 * The loop lives at module scope because the dropdown unmounts this item as it
 * closes — a `useState` flag would be thrown away the moment the first action
 * fired. The item subscribes instead, so whenever it is mounted it renders the
 * state of the loop that is actually running.
 */
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticks = 0;
let actionsRun = 0;
let failures = 0;

/** Live trades left to amend before the first page is read again. */
let pool: Trade[] = [];

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setRunning(next: boolean): void {
  running = next;
  for (const listener of listeners) listener();
}

function book(): Promise<unknown> {
  return createTrade({
    symbol: pick(SYMBOLS),
    side: Math.random() < 0.5 ? "BUY" : "SELL",
    quantity: between(1, 200) * 100,
    price: toPrice(5 + Math.random() * 495),
    book: pick(BOOKS),
    counterparty: pick(COUNTERPARTIES),
    tradeTimestamp: new Date().toISOString()
  });
}

/** An amendment sends only what changed, so nudge one field, never the form. */
function nudge(trade: Trade): Promise<unknown> {
  return amendTrade(trade.id, {
    expectedVersion: trade.version,
    ...(Math.random() < 0.5
      ? { price: toPrice(trade.price * (0.97 + Math.random() * 0.06)) }
      : { quantity: Math.max(100, trade.quantity + between(-5, 5) * 100) })
  });
}

/**
 * One action.
 *
 * A trade leaves the pool when it is picked and is never put back, so the pool
 * drains in about twenty seconds and the refill follows the real first page —
 * including the trades this loop has just booked.
 */
async function act(): Promise<void> {
  const booking = ticks % ACTIONS_PER_BOOKING === 0;
  ticks += 1;
  if (booking) {
    await book();
    return;
  }

  if (pool.length === 0) {
    const page = ok(
      await listTrades({
        status: "NEW",
        sortBy: "tradeTimestamp",
        sortDirection: "desc",
        page: 1,
        pageSize: PAGE_SIZE
      })
    );
    pool = [...page.data].sort(() => Math.random() - 0.5);
  }

  const trade = pool.pop();
  // Nothing live to amend yet, so put the tick towards making one.
  await (trade ? nudge(trade) : book());
}

/**
 * A self-rescheduling timeout rather than an interval, so an action that
 * outruns `TICK_MS` delays the next one instead of overlapping it — two in
 * flight would race for the same trade and lose one to a version conflict.
 */
function schedule(delay: number): void {
  timer = setTimeout(() => void tick(), Math.max(0, delay));
}

async function tick(): Promise<void> {
  const startedAt = Date.now();

  try {
    await act();
    actionsRun += 1;
    failures = 0;
  } catch (error) {
    /*
     * Usually expected rather than exceptional: the loop picks a trade and then
     * acts on it in a second call, so the desk — or the previous action — can
     * execute or amend it in between, which is exactly the 404/409 the
     * lifecycle exists to raise. Dropping the action is the right response;
     * stopping because the book moved would defeat the point.
     */
    failures += 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      stop();
      toast.error(
        // `ApiError` already carries the server's message; anything else is a fault.
        error instanceof Error ? error.message : "The blotter service rejected this command.",
        { description: "Simulation stopped." }
      );
      return;
    }
  }

  /*
   * Timed from the start of the action, not its end, so the round trip comes
   * out of the wait rather than being added to it and the rate stays at two a
   * second. An action slower than `TICK_MS` just leaves no wait at all.
   */
  if (running) schedule(TICK_MS - (Date.now() - startedAt));
}

/** Idempotent, so a second click while it is running changes nothing. */
function start(): void {
  if (running) return;
  ticks = 0;
  actionsRun = 0;
  failures = 0;
  pool = [];
  setRunning(true);
  toast.success("Simulation started", {
    description: "Booking and moving trades until you stop it."
  });
  // Act immediately rather than making the first tick wait out the interval.
  void tick();
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  setRunning(false);
}

/** The **Simulate** switch, reading the loop rather than owning it. */
export function SimulateMenuItem() {
  const isRunning = useSyncExternalStore(subscribe, () => running);

  const toggle = () => {
    if (!isRunning) {
      start();
      return;
    }
    stop();
    toast.success("Simulation stopped", { description: `${actionsRun} actions run.` });
  };

  return (
    <DropdownMenuItem onSelect={toggle} className="text-cell-2">
      {isRunning ? <Square size={14} /> : <Play size={14} />}
      {isRunning ? "Stop simulation" : "Simulate"}
      {isRunning && (
        <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-green-3" />
      )}
    </DropdownMenuItem>
  );
}
