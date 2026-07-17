# Poker Runout, Queued Top-Ups, and Session Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace instant all-in settlement with an authoritative cinematic runout, queue cumulative virtual-chip additions for the next hand, show exact results after every hand, and let the host finish the room with a durable session summary.

**Architecture:** Pure poker transitions own phases, card revelation, exact pot awards, top-up application, and summary calculations. A clock-injected room-flow controller plus a bounded per-room coordinator owns deadlines and serialization; the realtime adapter persists before broadcasting and schedules one stale-token-safe timer per connected room. React renders only participant-filtered authoritative snapshots.

**Tech Stack:** Node.js 22, TypeScript 5.8, Next.js 15.3, React 19.1, `ws` 8.18, Zod 3.25, Prisma 6.10, PostgreSQL, Redis, Vitest 3.2, Playwright 1.53, Docker Compose.

## Global Constraints

- The canonical design is `docs/superpowers/specs/2026-07-17-poker-runout-topups-and-session-stats-design.md`.
- Exact durations are showdown 2,000 ms, flop-card gap 1,000 ms, completed flop 2,000 ms, turn 2,000 ms, river 2,000 ms, and hand summary 2,000 ms.
- `RoomState.status` remains the room lifecycle; `RoomState.flow.phase` owns presentation lifecycle.
- Future board cards and folded hole cards remain server-only. Every snapshot passes through `toParticipantView()`.
- Top-ups are cash-table-only, positive safe integers, cumulative, visible to the room, and applied only immediately before their target hand starts.
- An end request never aborts an active hand. Unapplied top-ups are cancelled when the session finishes.
- No new runtime dependency. No money, cash-out, redemption, prize, public lobby, or public matchmaking behavior or copy.
- Every behavior change follows red-green-refactor. Use focused Vitest commands after each step and the full verification matrix in Task 9.
- Do not stage `.superpowers/`, `.next/`, environment files, or unrelated worktree changes.

---

### Task 1: Shared Flow, Result, Top-Up, and Protocol Contracts

**Files:**
- Modify: `src/lib/poker/types.ts`
- Modify: `src/lib/poker/engine.ts`
- Modify: `src/lib/realtime/messages.ts`
- Modify: `tests/realtime/messages.test.ts`
- Modify: `tests/poker/engine.test.ts`

**Interfaces:**
- Consumes: existing `Card`, `Seat`, `RoomState`, `HandState`, and strict Zod client-message parsing.
- Produces: `TableFlowPhase`, `TableFlowState`, `PendingTopUp`, `PotAward`, `HandPlayerResult`, `HandResult`, `SessionPlayerResult`, `RealtimeErrorCode`, typed server event payloads, default room flow, and per-hand starting stacks.

- [x] **Step 1: Write failing contract tests**

Add assertions that unsafe top-up amounts fail parsing, new event messages type-check, and initial/started rooms contain the new state:

```ts
expect(ClientMessageSchema.safeParse({
  type: "rebuy",
  roomId: "r1",
  participantToken: "token",
  amount: Number.MAX_SAFE_INTEGER + 1
}).success).toBe(false);

const room = createInitialRoomState(cashSettings, "r1");
expect(room.flow).toEqual({
  phase: "betting",
  sequence: 0,
  deadlineAt: null,
  nextRunoutStep: null,
  handResult: null
});
expect(room.pendingTopUps).toEqual({});
expect(room.endAfterCurrentHand).toBe(false);

const started = startHand(readyRoom, fixedDeck);
expect(started.hand?.startingChipsByParticipantId).toEqual({ p1: 1000, p2: 1000 });
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/realtime/messages.test.ts tests/poker/engine.test.ts`

Expected: FAIL because the new fields and safe-integer schema do not exist.

- [x] **Step 3: Add the shared contracts and defaults**

Define and export the canonical shapes in `types.ts`:

```ts
export type TableFlowPhase = "betting" | "insurance-pending" | "showdown-reveal" | "runout" | "hand-summary" | "session-summary";
export interface RunoutStep { street: "flop" | "turn" | "river"; cardIndexOnStreet: number }
export interface PendingTopUp { participantId: string; targetHandNumber: number; amount: number; requestCount: number }
export interface PotAward { potIndex: number; amount: number; eligibleParticipantIds: string[]; awardsByParticipantId: Record<string, number> }
export interface HandPlayerResult { participantId: string; displayName: string; seatNumber: number; startingChips: number; committedChips: number; potAward: number; insuranceDelta: number; endingChips: number; netChips: number }
export interface HandResult { handNumber: number; board: string[]; winnerParticipantIds: string[]; players: HandPlayerResult[]; pots: PotAward[] }
export interface SessionPlayerResult { participantId: string; displayName: string; initialChips: number; topUpChips: number; finalChips: number; netChips: number }
export interface TableFlowState { phase: TableFlowPhase; sequence: number; deadlineAt: number | null; nextRunoutStep: RunoutStep | null; handResult: HandResult | null }
```

Extend `RoomState` with `flow`, `pendingTopUps`, `endAfterCurrentHand`, `sessionEndedAt`, and `sessionSummary`; extend `HandState` with `startingChipsByParticipantId`. Initialize all fields deterministically and re-export supporting types from `engine.ts` for existing imports.

Change the `rebuy` amount schema to `z.number().int().positive().safe()`. Add typed event variants for `showdown_started`, `runout_card_revealed`, `top_up_queued`, `top_up_applied`, `room_end_requested`, and `room_finished`. Add:

```ts
export type RealtimeErrorCode = "INVALID_MESSAGE" | "ROOM_NOT_FOUND" | "INVALID_PARTICIPANT_TOKEN" | "INVALID_HOST_TOKEN" | "PRESENTATION_IN_PROGRESS" | "TOP_UP_NOT_ALLOWED" | "TOP_UP_AMOUNT_INVALID" | "ROOM_FINISHED" | "SERVER_BUSY";
```

and make `error.payload` equal `{ code: RealtimeErrorCode; message: string }`.

- [x] **Step 4: Run focused tests and type checking and verify GREEN**

Run: `npx vitest run tests/realtime/messages.test.ts tests/poker/engine.test.ts && npm run typecheck`

Expected: both test files pass and TypeScript reports no errors.

- [x] **Step 5: Commit the contract slice**

```bash
git add src/lib/poker/types.ts src/lib/poker/engine.ts src/lib/realtime/messages.ts tests/realtime/messages.test.ts tests/poker/engine.test.ts
git commit -m "feat: add authoritative table flow contracts"
```

### Task 2: Pure Cinematic Runout and Exact Hand Settlement

**Files:**
- Modify: `src/lib/poker/engine.ts`
- Modify: `tests/poker/engine.test.ts`
- Create: `tests/poker/runout-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 flow and result types, existing `buildPots()`, evaluator, insurance state, and deterministic decks.
- Produces: `SHOWDOWN_REVEAL_MS`, `FLOP_CARD_GAP_MS`, `FLOP_HOLD_MS`, `TURN_HOLD_MS`, `RIVER_HOLD_MS`, `HAND_SUMMARY_MS`, `advanceDuePhase(room, now)`, and exact `HandResult` settlement.

- [x] **Step 1: Write failing preflop all-in phase tests**

Create `runout-flow.test.ts` with a four-player fixed deck and assertions:

```ts
const locked = playFourWayPreflopAllIn(0);
expect(locked.flow).toMatchObject({ phase: "showdown-reveal", deadlineAt: 2000 });
expect(locked.hand?.board).toEqual([]);
expect(locked.hand?.finished).toBe(false);
expect(locked.flow.handResult).toBeNull();

const flop1 = advanceDuePhase(locked, 2000);
expect(flop1.hand?.board).toHaveLength(1);
expect(flop1.flow).toMatchObject({ phase: "runout", deadlineAt: 3000, nextRunoutStep: { street: "flop", cardIndexOnStreet: 1 } });

const flop2 = advanceDuePhase(flop1, 3000);
const flop3 = advanceDuePhase(flop2, 4000);
const turn = advanceDuePhase(flop3, 6000);
const river = advanceDuePhase(turn, 8000);
expect([flop2.hand?.board.length, flop3.hand?.board.length, turn.hand?.board.length, river.hand?.board.length]).toEqual([2, 3, 4, 5]);
expect(river.hand?.finished).toBe(false);

const settled = advanceDuePhase(river, 10000);
expect(settled.flow.phase).toBe("hand-summary");
expect(settled.flow.deadlineAt).toBe(12000);
expect(settled.hand?.finished).toBe(true);
expect(settled.flow.handResult?.players).toHaveLength(4);
```

Add later-street, normal-river, fold-win, exact unequal-side-pot, split/remainder, and insurance-delta cases.

- [x] **Step 2: Run the runout tests and verify RED**

Run: `npx vitest run tests/poker/runout-flow.test.ts`

Expected: FAIL because all-in settlement is still synchronous and `advanceDuePhase()` is absent.

- [x] **Step 3: Implement pure flow advancement and settlement**

Export exact constants and use deadline arithmetic from the prior deadline rather than callback time:

```ts
export const SHOWDOWN_REVEAL_MS = 2_000;
export const FLOP_CARD_GAP_MS = 1_000;
export const FLOP_HOLD_MS = 2_000;
export const TURN_HOLD_MS = 2_000;
export const RIVER_HOLD_MS = 2_000;
export const HAND_SUMMARY_MS = 2_000;

export function advanceDuePhase(state: RoomState, now: number): RoomState {
  if (state.flow.deadlineAt === null || state.flow.deadlineAt > now) return state;
  if (state.flow.phase === "showdown-reveal" || state.flow.phase === "runout") return advanceRunoutOrSettle(state);
  return state;
}
```

Replace `showdown(runOutBoard(state))` with a `beginShowdown(state, now)` transition. Reveal exactly one card per due transition. When the board is complete and the river/showdown hold expires, settle each `buildPots()` entry independently, distribute deterministic remainder chips in seat order, build `PotAward[]`, apply insurance, and compute every dealt-in player's result from `startingChipsByParticipantId`.

Use deterministic optional clock arguments to preserve existing pure call sites while the server always supplies its injected clock:

```ts
export function startHand(state: RoomState, providedDeck?: Card[], now = 0): RoomState;
export function applyPlayerAction(state: RoomState, action: BettingAction, now = 0): RoomState;
export function applyInsuranceDecision(state: RoomState, participantId: string, accepted: boolean, now = 0): RoomState;
export function finishHandIfReady(state: RoomState, now = 0): RoomState;
```

Fold wins call the same result builder with a single pot award and enter `hand-summary` immediately. Do not apply post-hand tournament elimination until settlement.

- [x] **Step 4: Verify all engine behavior GREEN**

Run: `npx vitest run tests/poker/runout-flow.test.ts tests/poker/engine.test.ts tests/poker/room-modes.test.ts tests/poker/betting.test.ts && npm run typecheck`

Expected: all focused engine tests pass; previous instant-settlement expectations are updated to phase/deadline assertions.

- [x] **Step 5: Commit the runout slice**

```bash
git add src/lib/poker/engine.ts tests/poker/engine.test.ts tests/poker/runout-flow.test.ts
git commit -m "feat: add cinematic server-side runout flow"
```

### Task 3: Queued Top-Ups and Session Finalization Rules

**Files:**
- Modify: `src/lib/poker/engine.ts`
- Create: `tests/poker/top-up-and-session.test.ts`

**Interfaces:**
- Consumes: `PendingTopUp`, `SessionPlayerResult`, hand-summary state, seats, and cumulative buy-in.
- Produces: `queueTopUp(state, participantId, amount)`, `getApplicableTopUps(state)`, `applyPendingTopUps(state)`, `completeHandBoundary(state, now)`, `requestRoomEnd(state)`, and `finalizeSession(state, now)`.

- [ ] **Step 1: Write failing queue/application/finalization tests**

```ts
const first = queueTopUp(activeRoom, "p1", 500);
const second = queueTopUp(first, "p1", 300);
expect(second.seats.find((seat) => seat.participantId === "p1")?.chips).toBe(activeStack);
expect(second.pendingTopUps.p1).toEqual({ participantId: "p1", targetHandNumber: 2, amount: 800, requestCount: 2 });

expect(() => queueTopUp(tournamentRoom, "p1", 500)).toThrow("TOP_UP_NOT_ALLOWED");
expect(() => queueTopUp(activeRoom, "p1", Number.MAX_SAFE_INTEGER)).toThrow("TOP_UP_AMOUNT_INVALID");

const applied = applyPendingTopUps(finishedSummaryRoom);
expect(applied.seats.find((seat) => seat.participantId === "p1")).toMatchObject({ chips: activeStack + 800, cumulativeBuyIn: 1800 });
expect(applied.pendingTopUps).toEqual({});

const waiting = completeHandBoundary(summaryWithOnlyOneEligiblePlayer, 12_000);
expect(waiting.flow).toMatchObject({ phase: "betting", deadlineAt: null, handResult: null });
expect(waiting.hand?.finished).toBe(true);
expect(waiting.pendingTopUps).toEqual(summaryWithOnlyOneEligiblePlayer.pendingTopUps);

const requested = requestRoomEnd(activeRoom);
expect(requested.endAfterCurrentHand).toBe(true);
const final = finalizeSession(finalHandSummary, 10_000);
expect(final.status).toBe("finished");
expect(final.flow.phase).toBe("session-summary");
expect(final.pendingTopUps).toEqual({});
expect(final.sessionSummary).toEqual(expect.arrayContaining([
  expect.objectContaining({ participantId: "p1", initialChips: 1000, topUpChips: 800, finalChips: 2100, netChips: 300 })
]));
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run tests/poker/top-up-and-session.test.ts`

Expected: FAIL because queue and finalization functions do not exist.

- [ ] **Step 3: Implement safe cumulative queueing and finalization**

Use `assertSafePositiveChipAmount()` for the submitted amount, aggregate, cumulative buy-in, and request count. The queue key is participant ID and target is always `handCounter + 1`. `getApplicableTopUps()` returns target-hand entries only when their simulated application leaves at least two eligible active seats. `applyPendingTopUps()` applies that returned set atomically in pure state. `completeHandBoundary()` starts the next hand when possible; otherwise it returns to deadline-free `betting`, leaves the previous hand finished and pending top-ups intact, and clears the transient result. `requestRoomEnd()` is idempotent. `finalizeSession()` clears pending entries, computes sorted totals, sets `status`, `sessionEndedAt`, `sessionSummary`, and `flow.phase`.

- [ ] **Step 4: Verify the queue/session slice GREEN**

Run: `npx vitest run tests/poker/top-up-and-session.test.ts tests/poker/engine.test.ts tests/poker/room-modes.test.ts && npm run typecheck`

Expected: focused tests and type checking pass.

- [ ] **Step 5: Commit the rule slice**

```bash
git add src/lib/poker/engine.ts tests/poker/top-up-and-session.test.ts
git commit -m "feat: queue top-ups and finalize room sessions"
```

### Task 4: Deadline Controller, Bounded Coordinator, and Backward-Compatible Live State

**Files:**
- Create: `src/server/room-flow-controller.ts`
- Create: `src/server/room-command-coordinator.ts`
- Modify: `src/server/live-room-store.ts`
- Create: `tests/server/room-flow-controller.test.ts`
- Create: `tests/server/room-command-coordinator.test.ts`
- Modify: `tests/realtime/live-room-store.test.ts`

**Interfaces:**
- Consumes: pure `advanceDuePhase()`, `completeHandBoundary()`, `RoomState.flow`, Redis JSON, and the 256-command bound.
- Produces: `RoomFlowController`, `RoomFlowController.isHandBoundaryDue()`, `RoomCommandCoordinator.run(roomId, operation, source)`, `FlowTimerToken`, and normalized legacy room state.

- [ ] **Step 1: Write failing clock, stale-token, serialization, overflow, and legacy-state tests**

```ts
const controller = new RoomFlowController(() => 5_000);
expect(controller.timerToken(room)).toEqual({ roomId: "r1", handId: "r1-1", sequence: 3, deadlineAt: 5_000 });
expect(controller.matchesToken(newerRoom, staleToken)).toBe(false);
expect(controller.catchUpDuePhases(room, 4_999)).toBe(room);
expect(controller.catchUpDuePhases(room, 5_000).flow.sequence).toBeGreaterThan(room.flow.sequence);

const order: string[] = [];
await Promise.all([
  coordinator.run("r1", async () => { order.push("a-start"); await gate; order.push("a-end"); }, "client"),
  coordinator.run("r1", async () => { order.push("b"); }, "client")
]);
expect(order).toEqual(["a-start", "a-end", "b"]);

expect(await store.getRoom("legacy-room")).toMatchObject({
  pendingTopUps: {},
  endAfterCurrentHand: false,
  flow: { phase: "betting", deadlineAt: null }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run tests/server/room-flow-controller.test.ts tests/server/room-command-coordinator.test.ts tests/realtime/live-room-store.test.ts`

Expected: FAIL because the controller/coordinator do not exist and strict legacy parsing rejects missing fields.

- [ ] **Step 3: Implement controller/coordinator/normalization**

The controller delegates pure advancement and builds a token from `roomId`, `hand.id`, `flow.sequence`, and `deadlineAt`. Catch-up loops while a deadline is due and stops when the phase no longer changes, `isHandBoundaryDue()` reports the persistence boundary, or the next deadline is in the future. The realtime adapter performs boundary persistence and then calls pure `completeHandBoundary()`.

The coordinator stores one promise tail and external pending count per room. It serializes timer and client work; client work above 256 throws an error with code `SERVER_BUSY`; timer work is never rejected. Remove idle room entries in `finally`.

Make new Zod room fields optional during parse, then normalize them before validation. Derive legacy finished hands as expired hand summaries and active unfinished hands as betting. Never synthesize future board cards.

- [ ] **Step 4: Verify controller/store GREEN**

Run: `npx vitest run tests/server/room-flow-controller.test.ts tests/server/room-command-coordinator.test.ts tests/realtime/live-room-store.test.ts && npm run typecheck`

Expected: all controller/store tests pass and no type errors remain.

- [ ] **Step 5: Commit the scheduling slice**

```bash
git add src/server/room-flow-controller.ts src/server/room-command-coordinator.ts src/server/live-room-store.ts tests/server/room-flow-controller.test.ts tests/server/room-command-coordinator.test.ts tests/realtime/live-room-store.test.ts
git commit -m "feat: coordinate and recover room flow deadlines"
```

### Task 5: Idempotent Hand, Top-Up, and Session Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260717090000_add_room_session_summary/migration.sql`
- Modify: `src/server/repositories/room-repository.ts`
- Modify: `tests/server/migration.test.ts`
- Modify: `tests/server/room-repository.test.ts`
- Modify: `tests/realtime/hand-history.test.ts`

**Interfaces:**
- Consumes: exact `HandResult.pots`, `startingChipsByParticipantId`, `PendingTopUp`, and `SessionPlayerResult[]`.
- Produces: `recordTopUp(roomId, pending)`, `finishRoom(roomId, endedAt, summary)`, exact durable pot winners, and public hand-player net results.

- [ ] **Step 1: Write failing migration and repository tests**

```ts
expect(migrationSql).toContain('ALTER TABLE "Room" ADD COLUMN "sessionSummary" JSONB');

await repository.recordTopUp("r1", { participantId: "p1", targetHandNumber: 2, amount: 800, requestCount: 2 });
expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: "buyin_r1_p1_hand_2" },
  create: expect.objectContaining({ id: "buyin_r1_p1_hand_2", amount: 800 }),
  update: { amount: 800 }
}));

const details = createHandPersistenceDetails(roomWithSidePots);
expect(details.pots[1].winnerParticipantIds).toEqual(["p2"]);
expect(details.players.find((player) => player.participantId === "p1")).toMatchObject({ startingChips: 50, endingChips: 150 });

await repository.finishRoom("r1", new Date(10_000), summary);
expect(roomUpdateMock).toHaveBeenCalledWith({ where: { id: "r1" }, data: { endedAt: new Date(10_000), sessionSummary: summary } });
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run tests/server/migration.test.ts tests/server/room-repository.test.ts tests/realtime/hand-history.test.ts`

Expected: FAIL because schema, migration, repository operations, and exact result mapping are absent.

- [ ] **Step 3: Implement idempotent persistence**

Add `sessionSummary Json?` to `Room`. Create the exact SQL migration. Change hand persistence to use `hand.startingChipsByParticipantId` and `flow.handResult.pots`; never filter a global winner list into each pot.

Implement top-up upsert with ID `buyin_${roomId}_${participantId}_hand_${targetHandNumber}` and an unchanged amount update. Validate session summary using a shared Zod schema before updating `endedAt` and `sessionSummary`. Extend public hand review players with starting, ending, and signed net chips without exposing hole cards.

- [ ] **Step 4: Generate Prisma and verify GREEN**

Run: `npm run prisma:generate && npx vitest run tests/server/migration.test.ts tests/server/room-repository.test.ts tests/realtime/hand-history.test.ts && npm run typecheck`

Expected: Prisma generation succeeds, focused persistence tests pass, and type checking passes.

- [ ] **Step 5: Commit the persistence slice**

```bash
git add prisma/schema.prisma prisma/migrations/20260717090000_add_room_session_summary/migration.sql src/server/repositories/room-repository.ts tests/server/migration.test.ts tests/server/room-repository.test.ts tests/realtime/hand-history.test.ts
git commit -m "feat: persist exact hand and room results"
```

### Task 6: Realtime Orchestration, Timers, Events, and Host Ending

**Files:**
- Modify: `src/server/realtime/game-server.ts`
- Modify: `src/server/index.ts`
- Modify: `tests/realtime/game-server.test.ts`
- Create: `tests/realtime/room-flow-events.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5 contracts, controller, coordinator, persistence methods, auth, sessions, and participant-filtered snapshots.
- Produces: save-before-broadcast transition execution, one timer per connected room, join/command catch-up, queue/application/final events, functional `end_room`, coded errors, and 16 KiB payload protection.

- [ ] **Step 1: Write failing realtime scenarios with fake timers**

Use `vi.useFakeTimers()` and injectable `now`, `setTimer`, and `clearTimer` options. Assert:

```ts
expect(await nextTypedMessage(p1, "showdown_started")).toMatchObject({ payload: { handNumber: 1, deadline: 2_000 } });
expect((await readStoredRoom()).hand?.board).toHaveLength(0);

await vi.advanceTimersByTimeAsync(2_000);
expect(await nextTypedMessage(p1, "runout_card_revealed")).toMatchObject({ payload: { street: "flop", cardIndex: 0 } });
expect((await readStoredRoom()).hand?.board).toHaveLength(1);

p1.send(topUp(500));
p1.send(topUp(300));
expect(await nextTypedMessage(spectator, "top_up_queued")).toMatchObject({ payload: { submittedAmount: 300, pendingTotal: 800, targetHandNumber: 2 } });

host.send(JSON.stringify({ type: "end_room", roomId, hostToken: "host-token" }));
expect(await nextTypedMessage(p1, "room_end_requested")).toMatchObject({ payload: { finalHandNumber: 1 } });
expect(recordTopUp).not.toHaveBeenCalled();
```

Also test forged tokens, action rejection during presentation, stale timer no-op, reconnect catch-up, save failure before broadcast, finalization failure, `SERVER_BUSY`, and `maxPayload: 16 * 1024`.

- [ ] **Step 2: Run realtime tests and verify RED**

Run: `npx vitest run tests/realtime/game-server.test.ts tests/realtime/room-flow-events.test.ts`

Expected: FAIL because the server still settles synchronously, omits `end_room`, and applies rebuys immediately.

- [ ] **Step 3: Implement serialized transition execution**

Extend `GameServerOptions` with the full persistence pick and optional clock/timer functions. Construct `WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })`. Route every parsed message through `coordinator.run(roomId, ..., "client")`; run catch-up before auth-dependent commands.

For each transition:

1. Reload newest state.
2. Verify token/authorization.
3. Calculate the next pure state.
4. Execute required idempotent hand/top-up/session persistence.
5. Save live state.
6. Broadcast participant-filtered snapshot.
7. Broadcast typed phase/result/top-up/final event.
8. Register or replace the room timer.

At a due hand-summary boundary, persist applicable top-ups before applying/clearing them. Persist the final summary before setting finished live state. Timer callbacks use coordinator source `timer` and return on a stale token. Implement `end_room` and canonical coded error responses. Pass the repository methods from `src/server/index.ts`.

If a summary expires without enough eligible players, save the deadline-free waiting-between-hands state. A later accepted top-up performs the readiness check again and, when sufficient, persists the aggregate, applies it, emits `top_up_applied` before `hand_started`, saves, broadcasts, and schedules the newly started hand.

- [ ] **Step 4: Verify realtime GREEN**

Run: `npx vitest run tests/realtime/game-server.test.ts tests/realtime/room-flow-events.test.ts tests/realtime/spectator-and-disconnect.test.ts tests/realtime/messages.test.ts && npm run typecheck`

Expected: realtime/auth/flow tests pass; no future card or unpersisted result is broadcast.

- [ ] **Step 5: Commit the realtime slice**

```bash
git add src/server/realtime/game-server.ts src/server/index.ts tests/realtime/game-server.test.ts tests/realtime/room-flow-events.test.ts
git commit -m "feat: orchestrate authoritative realtime room flow"
```

### Task 7: Phase-Aware Participant Visibility

**Files:**
- Modify: `src/lib/poker/visibility.ts`
- Modify: `tests/poker/visibility.test.ts`

**Interfaces:**
- Consumes: authoritative room flow, pending top-ups, hand/session results, folded state, and viewer identity.
- Produces: snapshot fields needed by UI without server deck, folded cards, tokens, or premature results.

- [ ] **Step 1: Write failing visibility matrix tests**

```ts
expect(toParticipantView(bettingRoom, spectator).hand?.seats.flatMap((seat) => seat.holeCards ?? [])).toEqual([]);
expect(toParticipantView(showdownRoom, spectator).hand?.seats.find((seat) => seat.participantId === "p1")?.holeCards).toHaveLength(2);
expect(toParticipantView(showdownRoom, spectator).hand?.seats.find((seat) => seat.participantId === "folded")?.holeCards).toBeUndefined();
expect(JSON.stringify(toParticipantView(runoutRoom, spectator))).not.toContain("deck");
expect(toParticipantView(runoutRoom, spectator).flow.handResult).toBeNull();
expect(toParticipantView(summaryRoom, spectator).flow.handResult?.players).toHaveLength(4);
expect(toParticipantView(sessionRoom, spectator).sessionSummary).toHaveLength(4);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run tests/poker/visibility.test.ts`

Expected: FAIL because spectators never see legal showdown hands and new snapshot fields are absent.

- [ ] **Step 3: Implement phase-aware projection**

Expose `flow`, viewer-safe pending totals, `endAfterCurrentHand`, and `sessionSummary`. Reveal a hand when the viewer owns it or when phase is `showdown-reveal`, `runout`, or `hand-summary` and that participant is a non-folded pot contender. Return no legal actions outside `betting` and `insurance-pending`. Never include `deck` or raw token fields.

- [ ] **Step 4: Verify visibility GREEN**

Run: `npx vitest run tests/poker/visibility.test.ts tests/realtime/spectator-and-disconnect.test.ts && npm run typecheck`

Expected: visibility and spectator regressions pass.

- [ ] **Step 5: Commit the visibility slice**

```bash
git add src/lib/poker/visibility.ts tests/poker/visibility.test.ts
git commit -m "feat: project phase-aware private table views"
```

### Task 8: Persistent Top-Up UI, Per-Hand Card, Host End, and Final Summary

**Files:**
- Modify: `src/app/room/[roomId]/RoomClient.tsx`
- Modify: `src/components/table/PokerTable.tsx`
- Modify: `src/components/table/ActionControls.tsx`
- Modify: `src/components/table/HandResultPanel.tsx`
- Create: `src/components/table/SessionResultPanel.tsx`
- Modify: `src/styles/globals.css`
- Modify: `tests/room/room-client.test.ts`
- Modify: `tests/table/action-controls.test.ts`
- Modify: `tests/table/hand-result-panel.test.ts`
- Modify: `tests/table/poker-table.test.ts`
- Create: `tests/table/session-result-panel.test.ts`

**Interfaces:**
- Consumes: Task 7 authoritative snapshot; `onRebuy(amount)`; new `onEndRoom()` command.
- Produces: persistent lower-left top-up popover, pending badge, phase-driven showdown/board/result UI, exact two-column hand results, host final-hand state, and full-screen session summary.

- [ ] **Step 1: Write failing server-rendered component tests**

```ts
expect(renderControls({ playerControls: true, mode: "cash", pendingTopUp: 800 })).toContain("Add chips");
expect(renderControls({ playerControls: true, mode: "cash", pendingTopUp: 800 })).toContain("Pending +800");
expect(renderControls({ playerControls: false, mode: "cash" })).not.toContain("top-up-popover");
expect(renderControls({ hostControls: true, endAfterCurrentHand: true })).toContain("Ending after this hand");

const handHtml = renderHandResult(fourPlayerHandResult);
expect(handHtml).toContain("Hand 19 result");
expect(handHtml).toContain("Alice");
expect(handHtml).toContain("+800");
expect(handHtml).toContain("-500");

const sessionHtml = renderSessionResult(sessionSummary);
expect(sessionHtml).toContain("Session results");
expect(sessionHtml).toContain("Initial");
expect(sessionHtml).toContain("Top-ups");
expect(sessionHtml).toContain("Final");
expect(sessionHtml).toContain("Net");
```

Update the RoomClient test to assert that `HAND_RESULT_ANIMATION_MS` and the local hand-result timeout are removed and that `end_room` is sent from host controls.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npx vitest run tests/room/room-client.test.ts tests/table/action-controls.test.ts tests/table/hand-result-panel.test.ts tests/table/poker-table.test.ts tests/table/session-result-panel.test.ts`

Expected: FAIL because current UI hides add chips while stacked, uses a client timeout, and has no session panel/end control.

- [ ] **Step 3: Implement snapshot-driven React UI**

Remove `HAND_RESULT_ANIMATION_MS`, `visibleHandResult`, and `attachHandResult()`. Send `end_room` with the host token. Extend `PokerTable` props with `onEndRoom`, pass flow/pending/end state to controls, show showdown whenever the authoritative phase permits, and render the result components directly from snapshot state.

Replace the forced rebuy modal with a lower-left `<details className="top-up-popover">`. Its summary always reads `Add chips` for a seated cash player and adds `Pending +N` when present. The form label is `Add chips amount`; the action is `Add next hand`; submission preserves the entered amount and does not mutate stack locally.

Render all `HandResult.players`, signed net chips, board, and exact pot winners only in `hand-summary`. Render `SessionResultPanel` as a full-screen, non-expiring overlay in `session-summary`. Add host button text `End room` / `Ending after this hand`.

Add responsive CSS that pins the utility to the lower-left, uses two columns for six or more hand participants, preserves the existing action console, and fits `1440x900` and `390x844` without overlap.

- [ ] **Step 4: Verify component GREEN**

Run: `npx vitest run tests/room/room-client.test.ts tests/table/action-controls.test.ts tests/table/hand-result-panel.test.ts tests/table/poker-table.test.ts tests/table/session-result-panel.test.ts tests/table/seat-ring-css.test.ts && npm run typecheck`

Expected: all room/table component tests and type checking pass.

- [ ] **Step 5: Commit the UI slice**

```bash
git add src/app/room/[roomId]/RoomClient.tsx src/components/table/PokerTable.tsx src/components/table/ActionControls.tsx src/components/table/HandResultPanel.tsx src/components/table/SessionResultPanel.tsx src/styles/globals.css tests/room/room-client.test.ts tests/table/action-controls.test.ts tests/table/hand-result-panel.test.ts tests/table/poker-table.test.ts tests/table/session-result-panel.test.ts
git commit -m "feat: render top-ups and authoritative table results"
```

### Task 9: Browser Acceptance, Long-Run Accounting, Build, and Docker Verification

**Files:**
- Modify: `tests/e2e/friends-room.spec.ts`
- Create: `tests/e2e/runout-topup-session.spec.ts`
- Modify: `scripts/simulate-six-player-session.ts`
- Modify: `docs/qa-test-checklist.md`

**Interfaces:**
- Consumes: completed server/UI flow and production Docker configuration.
- Produces: end-to-end proof for cinematic sequence, persistent controls, exact summaries, responsive layouts, reconnect behavior, and accounting conservation.

- [ ] **Step 1: Write failing Playwright and long-run acceptance checks**

Add a WebSocket-driven UI test that sends authoritative snapshots for phases in order and asserts the rendered sequence:

```ts
await expect(page.getByLabel("Showdown reveal")).toBeVisible();
await expect(page.getByLabel("Board").locator(".playing-card")).toHaveCount(0);
await pushSnapshot(flop1); await expect(boardCards(page)).toHaveCount(1);
await pushSnapshot(flop2); await expect(boardCards(page)).toHaveCount(2);
await pushSnapshot(flop3); await expect(boardCards(page)).toHaveCount(3);
await pushSnapshot(turn); await expect(boardCards(page)).toHaveCount(4);
await pushSnapshot(river); await expect(boardCards(page)).toHaveCount(5);
await pushSnapshot(handSummary); await expect(page.getByLabel("Hand result")).toContainText("+800");
```

At both `1440x900` and `390x844`, assert the top-up button is visible and does not overlap the action dock. Assert the final summary blocks action controls. Extend the simulator's conservation equation to include applied top-ups and recorded insurance delta.

- [ ] **Step 2: Run new acceptance checks and verify RED if a requirement is still missing**

Run: `npx playwright test tests/e2e/runout-topup-session.spec.ts --project=mobile-chrome`

Run: `$env:LONG_RUN_SECONDS='30'; $env:ACTION_DELAY_MS='0'; npm run test:long-run`

Expected before final fixes: any missing integration fails with a requirement-specific assertion, not a timeout-only error.

- [ ] **Step 3: Fix only behavior exposed by failing acceptance checks**

For every discovered defect, add or retain the focused regression assertion, modify the owning production file, rerun the focused test to green, and update the canonical design first if a contract changes. Record the browser scenarios and expected visual states in `docs/qa-test-checklist.md`.

- [ ] **Step 4: Run the complete automated verification matrix**

Run in order:

```powershell
npm test
npm run typecheck
npm run test:e2e
npm run build
$env:LONG_RUN_SECONDS='600'; $env:ACTION_DELAY_MS='0'; npm run test:long-run
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health
```

Expected: every command exits 0; Vitest and Playwright show zero failures; Next production build completes; the ten-minute simulation reports conserved chips adjusted for top-ups/insurance; app, PostgreSQL, and Redis containers are healthy; health endpoint returns HTTP 200.

- [ ] **Step 5: Perform adversarial and visual review**

Verify forged participant/host tokens, stale reconnects, duplicate timer callbacks, queue overflow, unsafe chip amounts, top-up/finalization persistence failures, future deck leakage, folded-card leakage, and post-finish commands. Use the in-app browser at desktop `1440x900` and mobile `390x844` to capture the top-up control, showdown, each board phase, hand result, and final summary.

Critical or important findings are fixed test-first before proceeding.

- [ ] **Step 6: Request code review and commit final acceptance coverage**

```bash
git add tests/e2e/friends-room.spec.ts tests/e2e/runout-topup-session.spec.ts scripts/simulate-six-player-session.ts docs/qa-test-checklist.md
git commit -m "test: verify poker flow end to end"
```

Then use `requesting-code-review`, address all critical/important findings, rerun the full matrix, and use `verification-before-completion` before the final handoff.
