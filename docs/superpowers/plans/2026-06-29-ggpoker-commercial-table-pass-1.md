# GGpoker Commercial Table Pass 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the first play-screen pass so the bottom of the table matches the GGpoker benchmark: hero bottom-center, decisions lower-right, utilities lower-left, and no bottom clutter.

**Architecture:** Keep the current React/Next/WebSocket architecture. Change the table presentation contract so `SeatRing` owns hero presentation, `ActionControls` owns only betting/utility controls, and `RoomClient` owns visible table event toasts.

**Tech Stack:** React 19, Next.js 15, TypeScript, Vitest, Playwright.

## Global Constraints

- The attached GGpoker screenshot is the hard visual benchmark.
- Local player must be bottom-center in 2-6 player configurations.
- Desktop action console must be lower-right and compact.
- Main action buttons must be large red peers: `Fold`, `Call`, `Raise to`/`Bet`.
- Quick bet row must show `33%`, `50%`, `75%`, `100%`.
- Pre-join state must show modal/page-like join UI and no bottom action clutter.
- Rebuy success must be visible as a table event/toast for all seated players.
- No layout may overlap hero, action console, utilities, or player plates at 1440x900, 1366x768, or 390x844.

---

### Task 1: Hero Seat Owns The Bottom-Center Composition

**Files:**
- Modify: `src/components/table/SeatRing.tsx`
- Modify: `src/components/table/ActionControls.tsx`
- Modify: `tests/table/seat-ring.test.ts`
- Modify: `tests/table/action-controls.test.ts`

**Interfaces:**
- `SeatRing` consumes `localParticipantId`, `localDisplayName`, and hand `holeCards`.
- `ActionControls` no longer renders hero cards or hero identity markup.
- `SeatRing` produces a `.hero-seat-cluster` element on the local seat, containing `.hero-hole-cards`, `.seat-avatar`, and `.seat-panel`.

- [ ] Add a failing unit test proving the local seat renders `hero-seat-cluster` and visible hero cards when hole cards are available.
- [ ] Add a failing unit test proving `ActionControls` does not render `Your hand`, `.hero-pocket`, or hero cards.
- [ ] Update `SeatRing` markup so local seats render hero cards and identity as one cluster.
- [ ] Remove hero pocket markup from `ActionControls`.
- [ ] Run `npm test -- tests/table/seat-ring.test.ts tests/table/action-controls.test.ts`.
- [ ] Commit with message `Refactor hero into local seat`.

### Task 2: Lower-Right Betting Console

**Files:**
- Modify: `src/components/table/ActionControls.tsx`
- Modify: `tests/table/action-controls.test.ts`

**Interfaces:**
- `ActionControls` renders `.action-console` as the only main control surface.
- Live action buttons render inside `.primary-action-row`.
- Quick bet buttons render inside `.quick-bet-row`.

- [ ] Add a failing test that all live action buttons, including `Fold`, use the primary action class.
- [ ] Add a failing test that the quick bet row includes `33%`, `50%`, `75%`, `100%`.
- [ ] Initialize raise amount from legal min when available instead of a hard-coded `100`.
- [ ] Remove fallback legal actions during active live hands when `legalActions` is absent.
- [ ] Run `npm test -- tests/table/action-controls.test.ts`.
- [ ] Commit with message `Tighten betting console contract`.

### Task 3: Visible Rebuy Feedback

**Files:**
- Modify: `src/app/room/[roomId]/RoomClient.tsx`
- Modify: `src/components/table/SystemLog.tsx`
- Modify: `src/styles/globals.css`
- Modify: `tests/room/room-client.test.ts`

**Interfaces:**
- Room messages that mention rebuy/add chips produce a visible `.table-event-toast`.
- Toast is independent of the hidden/collapsed system log.

- [ ] Add a failing test that a rebuy-like table message can render as visible toast markup.
- [ ] Implement a small table event toast surface in `RoomClient`.
- [ ] Keep system log/quick phrases secondary and hidden on narrow layouts.
- [ ] Run `npm test -- tests/room/room-client.test.ts`.
- [ ] Commit with message `Show rebuy table event feedback`.

### Task 4: Benchmark CSS Pass

**Files:**
- Modify: `src/styles/globals.css`

**Interfaces:**
- `.hero-seat-cluster` is bottom-center and foregrounded.
- `.action-console` is lower-right on desktop/laptop.
- `.table-utility-cluster`/secondary tools are lower-left and visually subordinate.
- Mobile keeps primary actions reachable without whole-page bottom clutter.

- [ ] Restyle the felt/rail to a cleaner GGpoker-like oval with warm brown rail.
- [ ] Style player plates as circular avatar plus dark compact plate.
- [ ] Style local hero cards large and connected to the bottom seat plate.
- [ ] Style action console as quick bet row over three red action buttons.
- [ ] Convert seat bet labels into chip-like felt markers.
- [ ] Add breakpoint-specific rules for 1440x900, 1366x768, and 390x844 safety.
- [ ] Run `npm test -- tests/table/seat-ring.test.ts tests/table/action-controls.test.ts tests/room/room-client.test.ts`.
- [ ] Commit with message `Restyle table toward GGpoker benchmark`.

### Task 5: Evaluation Loop

**Files:**
- Modify only if evaluator finds blockers.

- [ ] Capture current screenshots at 1440x900, 1366x768, and 390x844.
- [ ] Ask independent evaluator to score against `docs/superpowers/specs/2026-06-29-ggpoker-commercial-table-design.md`.
- [ ] Fix all P0 findings and repeat evaluation.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run railway:build`.
- [ ] Push to `main` only after evaluator P0 findings are resolved.
