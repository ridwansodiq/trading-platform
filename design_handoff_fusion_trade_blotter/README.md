# Handoff: Fusion Trade Blotter (auth + equity trading blotter)

## Overview

An internal operational web application for an equity trading desk. A trader signs in, sees a
dense blotter of the day's trades, and amends / executes / cancels working trades. Trade updates
arrive asynchronously over SSE. The design covers the full operational surface: authentication,
the blotter, create & amend, execute & cancel confirmations, immutable audit history,
optimistic-concurrency conflict resolution, and the connection / loading / empty / error /
session-expiry states.

Two design files are bundled:

| File | What it is |
| --- | --- |
| `designs/Fusion Trade Blotter v2.dc.html` | **The design to build.** Adds keyboard-first navigation, ⌘K command palette, exposure strip, live price ticks, undoable actions, and dark mode. |
| `designs/Fusion Trade Blotter v1.dc.html` | Earlier, simpler baseline. Reference only — build v2. |

## About the design files

These files are **design references authored in HTML** — running prototypes that show intended
look, motion and behaviour. They are **not production code to copy**. `support.js` is a
prototyping runtime (a small template + React-class layer); it has no place in a real app.

Your task is to **recreate these designs in the target codebase's existing environment**
(React/Vue/Angular/etc.) using its established component library, routing, data layer and test
patterns. If no codebase exists yet, pick an appropriate stack — the design assumes
React + a ShadCN/Radix-style component set + Tailwind, which is the design system's own stack.

To view a prototype: open the `.dc.html` file in a browser (keep `support.js` beside it).
Sign in with any valid-looking email and a password of 4+ characters.

## Fidelity

**High fidelity.** Colours, type, spacing, radii, motion timings and copy are final and should be
reproduced faithfully, expressed through the target codebase's own tokens/components rather than
copied inline styles. Mock data is illustrative; wire to real APIs.

## Design system

Built AI Design System (ShadCN/Radix + Tailwind v4, "Violet" theme).
`tokens/builtai_colors_and_type.css` is the canonical token file. Notable rules the design follows:

- Neutrals are Tailwind **Slate**; brand violet `#5C3FDD` for primary buttons, focus ring, brand mark.
- Type: **Geist** (UI) and **Geist Mono** (all IDs, numbers, timestamps, kbd chips). Tabular numerals on every numeric column.
- Icons: **Lucide only**, 1.5–1.8px stroke, rendered at 13–16px. No emoji.
- Hairline 1px borders; shadows reserved for popovers/drawers/dialogs; no gradients or glass.
- Motion: 120–200ms, `ease-out`, opacity/translate only. No bounce, no scale-on-press.
- Radii: this app uses a tighter **4–6px** scale (operational density) rather than the design
  system's default 10.4px. Buttons/inputs/cards/dialogs = 6px, chips/pills/kbd = 4–5px.

---

## Screens / views

### 1. Sign in

- **Purpose:** authenticate before any trade data is fetched.
- **Layout:** full-viewport flex centre on `--bg-page`; a 376px column. Above the card: 30px violet
  rounded-square mark (6px radius, white "F", 14px/600) + product name (15px/600, -0.01em).
  Card: white, 1px `--line` border, 6px radius, `shadow-xs`, 24px padding. Footer line beneath the
  card: 11.5px `--ink-5`, centred — `Fusion Capital · Demo environment · © 2026`.
- **Contents (in order):** title "Sign in" (15px/600); subtitle "Use your desk credentials to access
  the blotter." (13px `--ink-4`, 20px below); optional notice banners; Email field; Password field
  with show/hide icon button (28px, inside the input's right edge); primary submit button (full
  width, 36px, violet, 13.5px/500).
- **Fields:** label 12.5px/500 `--ink-2`, 6px above a 36px input, 1px `--line`, 6px radius,
  13.5px text. Focus: `border-color: --ring` + `0 0 0 3px rgba(139,92,246,.18)`.
- **States:**
  - *Pending* — button label becomes "Signing in…" with a 14px spinner; button `disabled` so a second
    submit is impossible; simulated latency 900ms.
  - *Invalid credentials* — red alert above the form, `--red-soft` bg, `--red-line` border,
    12.5px `--red` text: **"Invalid email or password."** Generic by design; never reveal which field failed.
  - *Session expired* — amber notice: "Your session expired after 30 minutes of inactivity. Sign in again to resume."
- **Accessibility:** real `<label for>` on both fields, `autoComplete="username" / "current-password"`,
  native `<form onSubmit>` so Enter submits, `role="alert"` on the error, visible 2px violet focus ring.
- **Do not build:** registration, password reset, social login, SSO, MFA, role management.

### 2. Blotter (primary screen)

Full-height flex column: header → exposure strip → toolbar → (optional stale banner) → table card → footer.

**a. Top bar — 48px, white, 1px bottom border**
Left: 22px violet logo tile, "Fusion Trade Blotter" (13.5px/600), `Demo` environment chip (20px,
uppercase 10.5px, `--muted` fill).
Right: ⌘K search/command button (26px, shows a `⌘K` kbd chip), theme toggle (26px icon button),
SSE indicator, user menu.

*SSE indicator* — 26px pill, 6px dot + 12px/500 label:
`Live` emerald on `#F0FDF4`; `Reconnecting` amber on `#FFFBEB`, dot pulses 1.2s;
`Disconnected` slate on `--muted`.

*User menu* — 24px violet-tinted avatar tile with initials (`ME`), name, chevron. Opens a 224px
popover: name / email / "Desk Equity Delta · Session 28m left", separator, "Simulate session expiry",
"Log out". (The expiry item is a prototype affordance — in production, expiry is driven by the token.)

**b. Exposure strip — min 46px, white**
Five metrics separated by 1px dividers, each a 10px uppercase `--ink-5` label over a 13px mono/600
value: Trades in view · Working · Buy notional · Sell notional · Net exposure (signed, green/red,
abbreviated to `$1.23M` above a million). All computed from the *filtered* set. Right side: connection
dot + `Last update HH:MM:SS` in mono `--ink-5`.

**c. Command toolbar — wrapping flex, 8px gap, 9px/14px padding**
Search input (32px, 220–300px, leading search icon, trailing `/` kbd hint) ·
status chip group (All / NEW / EXECUTED / CANCELLED, each with a status dot and live count;
active chip = `--raised` fill + `shadow-xs`) · side chip group (All / BUY / SELL) ·
Trader select · Book select · date-range button (`10 Sep 2026`) · "Clear filters" (violet text
button, only rendered when a filter is active) · spacer · Refresh icon button (icon spins 700ms) ·
primary **New Trade** button with an `N` kbd chip.
Below 1100px the toolbar wraps; the chip groups stay intact.

**d. Trade table**
Card: white, 1px border, 6px radius, `overflow:hidden`. Scroll container `overflow:auto`;
table `min-width:1600px` so narrow screens scroll horizontally.

Header: sticky `top:0`, `--muted` fill, 34px, 11px/600 uppercase `.04em` `--ink-4`, click to sort
(active column shows a ▲/▼ in violet). Trade ID column is **also** sticky `left:0` (z-index above
the body cells) with a 2px right edge shadow.

Rows: 34px compact / 42px comfortable, 1px `--line-soft` bottom border, hover `--muted`.
Selected row `--violet-soft`. The keyboard cursor row shows a 2px violet bar inside the Trade ID cell.

| # | Column | Align | Format |
| -- | --- | --- | --- |
| 1 | Trade ID | left | mono 12px, sticky |
| 2 | Symbol | left | 12.5px/600 |
| 3 | Side | left | tag: 19px, 4px radius, 10.5px/600 — BUY `--green` on `--green-soft`, SELL `--red` on `--red-soft` |
| 4 | Quantity | right | mono, thousands separators |
| 5 | Price | right | mono, 2dp — animates on remote tick |
| 6 | Notional | right | mono, 2dp — **derived** `qty × price` |
| 7 | Signed Qty | right | mono, **derived** `±qty` by side, green/red |
| 8 | Signed Notional | right | mono, **derived** `±qty × price`, green/red |
| 9 | Trader | left | 12.5px |
| 10 | Book | left | mono 11.5px |
| 11 | Counterparty | left | 12.5px |
| 12 | Trade Time | left | mono 11.5px `YYYY-MM-DD HH:MM:SS` |
| 13 | Status | left | neutral 20px pill, 1px border, coloured 5px dot + 10.5px/600 label: NEW amber, EXECUTED emerald, CANCELLED slate |
| 14 | Version | right | mono `v3` |
| 15 | Actions | right | four 26px icon buttons |

CANCELLED rows render at `opacity: .66`.

*Row actions* (Lucide): pencil = Amend, check = Execute, x = Cancel, clock = Audit history.
Amend/Execute/Cancel are enabled **only** when `status === "NEW"` and the stream is connected;
otherwise `disabled`, `--ink-6`, `cursor:not-allowed`, and the tooltip explains why
("Execute — unavailable for executed trades"). Audit is always enabled. Every button has an
`aria-label` and a `title`.

**e. Footer — 1px top border**
Left: `1–10 of 15 trades`, plus `TRD-2041 selected` in violet when a row is selected.
Middle: keyboard hint chips (`J K` move, `A` amend, `E` execute, `/` search, `⌘K` commands).
Right: Previous · `Page 1 of 2` · Next (disabled at the ends).

**Table states:** `ready` · `loading` (34px header bar + 9 shimmering skeleton rows, 1.4s ease-in-out
opacity pulse) · `empty` ("No trades match these filters" + reason + Clear filters) ·
`error` ("Unable to load trades", "The blotter service returned 503. Data shown may be stale.", Retry).

### 3. Command palette (⌘K)

544px dialog, 12vh from the top, 8px radius, `shadow-2xl`, over a `--scrim` overlay; opens with a
160ms pop (translateY 6px + scale .985 → 0). 46px search row → grouped results → 8px footer of hint
chips (`↑↓` navigate, `↵` run, `J / K` move row, `A E C`).
Groups: **Trades** (only when the query matches — up to 5, showing `TRD-2044 · AMZN` and
`BUY 6,750 @ 187.44`) then **Actions** (New trade, Amend/Execute/Cancel/Audit the focused trade,
each showing the focused trade ID as meta) then **View** (working only, executed only, clear filters,
refresh, log out). Active item: `--violet-soft` fill and violet icon; mouse hover and ↑↓ share one index.
Empty: "No commands or trades match “xyz”."

### 4. Create / amend drawer

Right drawer, `min(100%, 468px)`, full height, slides in 180ms from +18px; overlay `--scrim`;
click-outside and Esc close it. Below ~520px viewport width it should go full-screen.

Header: title ("New trade" / "Amend trade") + mono subtitle — for amendments
`TRD-2041 · current version v3`, quiet 11.5px `--ink-5`.

Body (16px padding, scrollable): Symbol (mono, uppercased) · Side segmented control (200px, 2px
padded track on `--muted`, active segment `--raised` + `shadow-xs`, BUY green / SELL red) ·
Quantity + Price side-by-side (mono, right-aligned) · **Trader — read-only**, rendered as a
disabled-looking row with the signed-in user's avatar initials, name, and the caption
"Signed-in user"; it is never a picker · Book + Counterparty selects · Trade date + time ·
calculated **Notional preview** card (`--muted` fill, uppercase caption, `12,500 × 214.32` formula
line, 15px mono/600 value).

Footer: quiet note on the left — "Status is set by execution events, not by amendment." /
"Booked as NEW. Status changes via execute or cancel." — then Cancel and the primary
Save amendment / Book trade button.

**Validation** (on submit, inline, 11.5px `--red` under the field, input border `--red-line`):
symbol required; quantity > 0; price > 0. Business status is never editable.
**Submitting:** button disabled, spinner, label "Saving…", 850ms simulated latency.
**Success:** green inline confirmation ("Amendment saved. TRD-2041 is now v4."), a toast, drawer
closes after 1100ms. **Error:** red banner — "The blotter service rejected this submission (503).
No changes were written." (also what a disconnected stream produces).
**Stale while editing:** amber banner — "A newer version (v4) arrived from the server. Your input
has been preserved — review before saving." The user's input is never overwritten.

### 5. Execute / cancel confirmation

432px centred dialog, 6px radius, 160ms pop. 28px tinted icon tile (emerald check / red x), title,
one-sentence terminal warning:
- Execute — "Execution is terminal. The trade moves to EXECUTED and can no longer be amended or cancelled."
- Cancel — "Cancellation is terminal. The trade moves to CANCELLED and cannot be reinstated or amended."

Then a bordered fact list — Trade ID, Symbol, Side (coloured), Quantity, Price, Notional — all mono
and right-aligned. Actions: "Keep as is" (secondary) and the explicit
"Execute trade" (emerald `#047857`) / "Cancel trade" (destructive `#DC2626`). Restrained destructive
styling: solid red button only, no red dialog chrome.

### 6. Audit history drawer

Right drawer, `min(100%, 440px)`. Caption: "Immutable record. Newest last."
Vertical timeline — 9px dot with a 3px halo and a connecting 1px line. Per entry:
event type (CREATED violet / AMENDED amber / EXECUTED emerald / CANCELLED slate),
`v{n}` mono chip, right-aligned mono timestamp, then an 18px initials tile + actor name
(**the acting user for every event**), then a compact change table — one row per changed field:
`Field | before (struck through, --ink-5) | → | after (--ink, 500)`. No JSON blobs.
A CREATED entry shows a one-line note instead ("SELL 3,150 TSLA booked to EQ-VOL.").
Reference trade `TRD-2039` demonstrates CREATED v1 → AMENDED v2 → AMENDED v3 → EXECUTED v4.

### 7. Version conflict (optimistic concurrency)

Rendered **inside the amend drawer**, above the form, so the user's input stays visible and intact.
Amber-bordered panel: heading "This trade changed while you were editing" and
"You opened v3. Dan Okafor saved v4 at 14:07:52. Nothing was merged — your input is untouched below."
Then a three-column diff — `Field | Your value | Server v4` — where differing values are chip-highlighted
(yours violet on `--violet-soft`, server amber on `--amber-soft`) and identical values stay neutral.
Actions: **Discard my changes** (secondary) and **Reapply onto v4** (primary).
Discard closes the drawer and shows a page banner: "Your edit to TRD-2041 was discarded. The blotter
shows server version v4." Reapply loads v4 into the row, keeps the user's edits in the form, and banners
"Reviewing your changes against v4 of TRD-2041. Save again to submit as v5."
**Never** imply an automatic merge; never silently overwrite.

### 8. Toasts

Bottom-right stack, max 3, 296px min width, 6px radius, `shadow-lg`, 180ms rise.
22px tinted icon tile + title + mono detail line (`TRD-2038 · AAPL · $2,679,000.00`) +
optional **Undo** + dismiss. Execute/cancel toasts are undoable for 7s (restores the previous
status and version); informational toasts auto-dismiss at 4.2s.

### 9. Session expiry

Triggered by an expired token (prototype: user menu → "Simulate session expiry"). Effects, in order:
close the SSE stream (indicator → Disconnected), disable all trade actions, then a 396px calm dialog —
"Your session expired" / "The live connection has been closed and trade actions are disabled. Sign in
again to reload authoritative trade data." with one action, **Return to sign in**. Signing back in must
**re-fetch authoritative trade data** rather than reuse the pre-expiry cache. No alarming language.

---

## Interactions & behaviour

**Keyboard (blotter, when no dialog is open and focus isn't in a field)**

| Key | Action |
| --- | --- |
| `J` / `↓` | move row cursor down |
| `K` / `↑` | move row cursor up |
| `N` | new trade |
| `A` / `E` / `C` | amend / execute / cancel the focused trade |
| `H` | audit history for the focused trade |
| `/` | focus search |
| `⌘K` / `Ctrl K` | toggle command palette |
| `Esc` | close drawer / dialog / palette, or blur the field |

Acting on a non-NEW or disconnected trade raises a warn toast ("Action unavailable · TRD-2039 · EXECUTED")
instead of failing silently. In the palette: `↑↓` move, `↵` run, `Esc` close.

**Real-time (SSE)** — a trade-update event every ~9s while `Live`: the row's price moves ≤0.3%,
version increments, the price cell flashes green (up) or red (down) for 2.4s, the row flashes violet,
and the "Last update" clock advances. Never re-sort or re-page the table underneath the user, and never
overwrite an open form — raise the stale banner instead. `Reconnecting` pauses updates and pulses the dot;
`Disconnected` closes the stream and disables trade actions.

**Motion inventory** — drawer slide-in 180ms ease-out; dialog/palette pop 160ms; toast rise 180ms;
row/tick flash 2.4s ease-out; skeleton shimmer 1.4s; spinner 800ms linear; hover fills 150ms.

**Responsive** — desktop-first. Toolbar wraps; table scrolls horizontally with the Trade ID column
pinned; drawers go full-screen on narrow viewports; footer hint chips may be hidden below ~900px;
nothing may overlap or clip.

**Dark mode** — a header toggle switches a `data-fusion-theme` attribute; every colour is a token, so
no component logic changes. Dark surfaces are near-black slate; accent colours shift to their 300/400
tints (BUY `#34D399`, SELL `#F87171`, amber `#FCD34D`, violet `#7C5CFF`) to hold ≥4.5:1 contrast.
Persist the choice per user.

## State management

| State | Notes |
| --- | --- |
| `session` | user (name, initials, email, desk), token, expiry; drives header identity, the read-only Trader field, and audit actor attribution |
| `trades[]` | id, symbol, side, qty, price, status, trader, book, counterparty, time, **version** |
| `filters` | query, status, side, trader, book, dateRange |
| `sort` | `{ key, dir }` — includes the derived keys `notional`, `signedQty`, `signedNotional` |
| `pagination` | page, pageSize (default 10) |
| `selection` / `cursor` | selected row id; keyboard cursor row id |
| `connection` | `live` · `reconnecting` · `disconnected` |
| `tableState` | `ready` · `loading` · `empty` · `error` |
| `drawer` | `null` · `create` · `amend` + form values, per-field errors, `saving`, `saveOk`, `saveError`, `formStale` |
| `conflict` | attempted values, server values, computed field diff |
| `confirm` | `{ kind: execute \| cancel, trade }` |
| `audit` | trade id whose history is open |
| `toasts[]` | id, kind, title, sub, undo handler |
| `palette` | open, query, highlighted index |
| `theme` | `light` · `dark` |

**Data requirements:** `POST /auth/login`; `GET /trades` (filter/sort/page server-side for real volumes);
`POST /trades`; `PATCH /trades/{id}` carrying the **expected version** — a `409` returns the current
server trade and drives the conflict panel; `POST /trades/{id}/execute`; `POST /trades/{id}/cancel`;
`GET /trades/{id}/audit`; `GET /stream` (SSE, re-subscribed on reconnect, closed on expiry).
Notional, Signed Quantity and Signed Notional are **derived in the UI** — never persisted.

## Design tokens

Semantic tokens used by the design (light / dark). The blotter defines these in one place and
references them everywhere.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-page` | `#F8FAFC` | `#0C0E12` | app background |
| `--surface` | `#FFFFFF` | `#15181E` | cards, bars, drawers |
| `--raised` | `#FFFFFF` | `#2E343E` | active chip / segment fill |
| `--muted` | `#F8FAFC` | `#1B1F26` | table header, chip tracks, inset fields |
| `--muted-2` | `#F1F5F9` | `#232830` | hover fill, icon tiles |
| `--line` | `#E2E8F0` | `#2C323B` | 1px borders |
| `--line-soft` | `#F1F5F9` | `#242931` | row separators |
| `--ink` | `#0F172A` | `#EAECEF` | primary text |
| `--ink-2` | `#334155` | `#C6CBD3` | labels |
| `--ink-3` | `#475569` | `#B0B7C1` | secondary values |
| `--ink-4` | `#64748B` | `#929AA6` | secondary text |
| `--ink-5` | `#94A3B8` | `#79818E` | captions, timestamps |
| `--ink-6` | `#CBD5E1` | `#4C535C` | disabled |
| `--violet` | `#5C3FDD` | `#7C5CFF` | primary action, brand |
| `--violet-2` | `#4C1D95` | `#9277FF` | primary hover |
| `--violet-soft` | `#F5F3FF` | `#221D3A` | selected row, palette highlight |
| `--violet-soft-2` | `#EDE9FE` | `#2B2452` | avatar tile, row flash |
| `--violet-ink` | `#5B21B6` | `#C4B5FD` | avatar initials |
| `--ring` | `#8B5CF6` | `#A78BFA` | focus ring |
| `--green` / `--green-2` / `--green-3` | `#047857` / `#065F46` / `#059669` | `#34D399` / `#6EE7B7` / `#10B981` | BUY, executed |
| `--green-soft` / `--green-line` | `#ECFDF5` / `#A7F3D0` | `#0F2A22` / `#1F5B45` | BUY tag, success banner |
| `--red` / `--red-2` | `#B91C1C` / `#DC2626` | `#F87171` / `#EF4444` | SELL, destructive |
| `--red-soft` / `--red-line` | `#FEF2F2` / `#FECACA` | `#2C1518` / `#5E2626` | SELL tag, error banner |
| `--amber` / `--amber-2` / `--amber-3` | `#92400E` / `#B45309` / `#F59E0B` | `#FCD34D` / `#F59E0B` / `#F59E0B` | NEW, warnings, stale |
| `--amber-soft` / `--amber-line` | `#FFFBEB` / `#FDE68A` | `#2B2212` / `#5C4718` | warning surfaces |
| `--scrim` | `rgba(15,23,42,.35)` | `rgba(2,4,8,.62)` | modal overlays |

**Spacing** 2 · 4 · 6 · 8 · 12 · 14 · 16 · 20 · 24 (px).
**Radii** 3 (kbd) · 4 (tags, chips) · 5 (icon buttons, menu rows) · 6 (buttons, inputs, cards, dialogs) · 8 (palette).
**Shadows** `xs 0 1px 2px 0 rgb(0 0 0/.05)` · `sm` · `lg 0 10px 15px -3px rgb(0 0 0/.10), 0 4px 6px -4px rgb(0 0 0/.10)` ·
`2xl 0 25px 50px -12px rgb(0 0 0/.25)` · drawer `-10px 0 30px -12px rgba(2,4,8,.35)`.
**Type** 10/10.5/11/11.5/12/12.5/13/13.5/14/15px. Geist 400/500/600; Geist Mono 400/500/600 for every
ID, number, timestamp and kbd chip, always with `font-variant-numeric: tabular-nums`.

## Assets

None to ship. Fonts: Geist + Geist Mono (Google Fonts in the prototype; use
`@fontsource-variable/geist` in production). Icons: Lucide — the prototype inlines the paths; use
`lucide-react` (or your framework's Lucide package). The "F" logo tile is a placeholder for the real
Fusion mark.

## Files

```
designs/Fusion Trade Blotter v2.dc.html   ← build this
designs/Fusion Trade Blotter v1.dc.html   ← earlier baseline, reference only
designs/support.js                        ← prototype runtime, do NOT port
tokens/builtai_colors_and_type.css        ← Built AI design-system tokens
data/mock_trades.json                     ← the 15 seed trades + reference users
```

Inside `Fusion Trade Blotter v2.dc.html`: the markup lives between `<x-dc>` tags; the behaviour is the
`class Component` block near the end (state shape, filtering/sorting, audit generation, conflict
handling, keyboard map). A `screen` prop at the top of that class (`applyScreen`) enumerates every
state — `sign in`, `sign in — error`, `sign in — session expired`, `blotter`, `new trade drawer`,
`amend drawer`, `amend — stale warning`, `version conflict`, `execute confirmation`,
`cancel confirmation`, `audit history`, `session expired`, `loading`, `no results`, `load error`,
`disconnected` — useful as a checklist of what to implement and test.

## Acceptance checklist

- [ ] Sign-in blocks duplicate submission and shows only a generic credential error.
- [ ] Trader is populated from the session and is never editable.
- [ ] Amend / Execute / Cancel are available only for `NEW` trades and are visibly disabled elsewhere.
- [ ] Notional, Signed Qty, Signed Notional are derived client-side, tabular, consistently precise.
- [ ] Sorting works on derived columns; header stays sticky; Trade ID stays pinned when scrolling horizontally.
- [ ] A `409` on amend renders the conflict panel with a real field diff and never auto-merges.
- [ ] A remote update to a trade being edited preserves user input and warns.
- [ ] Session expiry closes the stream, blocks actions, explains itself, and re-fetches after re-auth.
- [ ] Audit history shows event, version, timestamp, actor, and before/after per changed field — no JSON.
- [ ] Full keyboard operation with visible focus; contrast ≥4.5:1 in both themes.
