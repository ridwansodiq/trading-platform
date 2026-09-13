import { useEffect, useSyncExternalStore } from "react";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import {
  amendTrade,
  cancelTrade,
  createTrade,
  executeTrade,
  listTrades
} from "@/api/generated/endpoints/trades/trades";
import { ok } from "@/api/unwrap";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Trade } from "@/api/generated/models";

/**
 * The demo pulse, driven entirely from the browser.
 *
 * **Simulate** starts a loop that runs two actions a second until it is
 * stopped: every third one books a fresh trade, and the rest move a live one —
 * mostly nudging its price or quantity, sometimes executing or cancelling it
 * outright. Each action is an ordinary REST request over the same endpoints a
 * human's
 * clicks use, so it is version-checked, audited and streamed back like any
 * other — the blotter picks the results up over SSE, which is why nothing here
 * touches the query cache.
 *
 * What it moves is what the user is looking at: `useSimulationSource` publishes
 * the blotter's current rows, so the amendments, fills and cancellations land
 * on the page in view — under whatever filter, sort and page the desk has
 * chosen — rather than on trades scrolled past. It falls back to reading the
 * first page itself only when the screen offers nothing live to act on.
 *
 * That is 120 requests a minute. Nothing on the API throttles them — login is
 * the only rate-limited route — so `TICK_MS` is the only ceiling there is, and
 * the share spent on bookings is what keeps the blotter ahead of the trades it
 * retires.
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
/**
 * How the actions that move an existing trade divide up; the remainder amend,
 * which is both the commonest thing a desk does and the only one of the three
 * that leaves the trade live.
 *
 * Executing and cancelling are terminal, so together they set the rate the
 * blotter retires trades at, and bookings have to stay ahead of it or a long
 * run drains the book. Three in ten of two thirds is 0.2 retirements an action
 * against 0.33 bookings — five to three, which keeps it filling up.
 */
const EXECUTE_SHARE = 0.2;
const CANCEL_SHARE = 0.1;
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

/** The blotter's current rows, live-published by `useSimulationSource`. */
let visible: readonly Trade[] = [];

/** Fallback candidates, read from the first page when the screen offers none. */
let pool: Trade[] = [];

/**
 * The version each trade was last acted on at, so the loop does not pick the
 * same row twice while its own amendment is still in flight — the entry stops
 * matching as soon as the updated trade arrives over SSE, which puts the trade
 * back in play, and a cancelled one never comes back as `NEW` at all.
 */
const actedVersions = new Map<string, number>();

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

/**
 * Publishes the rows the blotter is showing to the loop.
 *
 * It is a hook on the screen rather than a prop on the menu item because the
 * dropdown unmounts the item as it closes: the loop has to keep seeing the
 * table long after the menu that started it is gone.
 */
export function useSimulationSource(views: readonly Trade[]): void {
  useEffect(() => {
    // Only `NEW` trades can be amended or cancelled; the rest are terminal.
    visible = views.filter((view) => view.status === "NEW");
    return () => {
      visible = [];
    };
  }, [views]);
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

function fill(trade: Trade): Promise<unknown> {
  return executeTrade(trade.id, { expectedVersion: trade.version });
}

function kill(trade: Trade): Promise<unknown> {
  return cancelTrade(trade.id, { expectedVersion: trade.version });
}

/** One roll across the three, so the shares are read off a single number. */
function move(trade: Trade): Promise<unknown> {
  const roll = Math.random();
  if (roll < EXECUTE_SHARE) return fill(trade);
  if (roll < EXECUTE_SHARE + CANCEL_SHARE) return kill(trade);
  return nudge(trade);
}

const isFree = (trade: Trade): boolean => actedVersions.get(trade.id) !== trade.version;

/**
 * The trade to move next.
 *
 * The screen comes first, so the desk watches its own rows change; the first
 * page is read only when the screen has nothing left — an empty blotter, a
 * filter that excludes every live trade, or every visible row already moved and
 * not yet streamed back.
 *
 * A pooled trade leaves the pool when it is picked and is never put back, so
 * the fallback refill follows the real first page, including the trades this
 * loop has just booked.
 */
async function nextTarget(): Promise<Trade | undefined> {
  const onScreen = visible.filter(isFree);
  if (onScreen.length > 0) return pick(onScreen);

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

  let trade = pool.pop();
  while (trade && !isFree(trade)) trade = pool.pop();
  return trade;
}

/** One action: book a trade, or amend, execute or cancel one already live. */
async function act(): Promise<void> {
  const booking = ticks % ACTIONS_PER_BOOKING === 0;
  ticks += 1;
  if (booking) {
    await book();
    return;
  }

  const trade = await nextTarget();
  // Nothing live to move yet, so put the tick towards making one.
  if (!trade) {
    await book();
    return;
  }

  actedVersions.set(trade.id, trade.version);
  await move(trade);
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
        error instanceof Error ? error.message : "The blotter service rejected this request.",
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
  actedVersions.clear();
  setRunning(true);
  toast.success("Simulation started", {
    description: "Booking, amending, executing and cancelling trades until you stop it."
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
