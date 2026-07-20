# Host Kick Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated room host immediately remove any participant, safely resolve an active hand, revoke the old credential, notify all clients, retain accounting, and deploy the verified feature to the public Docker site.

**Architecture:** A pure poker transition owns forced fold, seat removal, pending-top-up cancellation, and removed-player accounting. The realtime command validates host authority and serializes work, durable PostgreSQL revocation precedes Redis snapshot save and broadcasts, and the session registry detaches kicked identities. React renders a host-only per-seat action and a terminal kicked screen from a dedicated server event.

**Tech Stack:** TypeScript 5.8, React 19, Next.js 15, Zod 3, WebSocket `ws` 8, Prisma 6/PostgreSQL, Redis, Vitest 3, Playwright 1.53, Docker Compose.

## Global Constraints

- `docs/superpowers/specs/2026-07-20-host-kick-player-design.md` is authoritative.
- Do not add dependencies, delete historical rows, delete/rebuild Docker volumes, change `120.27.143.111:32768`, or expose host/participant tokens.
- Every behavior change starts with a focused failing test and its expected failure is observed.
- A kicked player may rejoin only through a newly created participant credential.
- Completion requires focused tests, typecheck, build, all tests, browser acceptance, production deployment, and public verification.

---

### Task 1: Pure kick transition and live-state schema

**Files:**
- Modify: `src/lib/poker/engine.ts`
- Modify: `src/server/live-room-store.ts`
- Create: `tests/poker/host-kick.test.ts`
- Modify: `tests/realtime/live-room-store.test.ts`

**Interfaces:**
- Produces: `RemovedParticipantLedger`, `RoomState.removedParticipants`, `kickParticipant(state, participantId, now): RoomState`.
- Consumes: `applyPlayerAction`, `applyInsuranceDecision`, existing fold settlement and flow state.

- [ ] Write failing tests that construct lobby, acting, non-acting, all-in, insurance-pending, presentation, duplicate-target, pending-top-up, and final-summary rooms. Assert forced fold retains commitment, actor/settlement stays valid, presentation outcome stays unchanged, seat becomes canonical empty, top-up disappears, removed ledger contains one entry, and final summary includes it once.
- [ ] Run `npx vitest run tests/poker/host-kick.test.ts`; expect failure because `kickParticipant` is not exported.
- [ ] Add `removedParticipants: Record<string, RemovedParticipantLedger>` to new room state. Implement a private `emptySeat` mapper and `kickParticipant`: validate target; decline owned pending insurance; for unfinished betting/insurance directly mark the target betting player folded (including all-in), use existing engine progression/settlement helpers to advance; snapshot accounting; vacate the seat; delete pending top-up. Do not rewrite showdown/runout/summary outcomes.
- [ ] Merge `removedParticipants` into `finalizeSession`, deduplicated by participant ID. Extend `LiveRoomStateSchema` with `.default({})`/normalization so old Redis rooms load as an empty ledger.
- [ ] Run `npx vitest run tests/poker/host-kick.test.ts tests/realtime/live-room-store.test.ts`; expect pass. Commit `feat: add authoritative player kick transition`.

### Task 2: Protocol and durable credential revocation

**Files:**
- Modify: `src/lib/realtime/messages.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260720130000_add_participant_kicked_at/migration.sql`
- Modify: `src/server/repositories/room-repository.ts`
- Modify: `tests/realtime/messages.test.ts`
- Modify: `tests/server/migration.test.ts`
- Modify: `tests/server/room-repository.test.ts`

**Interfaces:**
- Produces: strict `kick_player`, `player_kicked`, error `PARTICIPANT_NOT_FOUND`, `RoomRepository.kickParticipant(roomId, participantId, kickedAt): Promise<boolean>`.
- Changes: `verifyParticipantToken` matches `kickedAt: null`.

- [ ] Add failing schema tests for exact valid command/event and rejection of missing, extra, empty IDs. Add repository-source/Prisma tests proving exact room/id/not-kicked update and revoked-token rejection, plus migration test for nullable `kickedAt`.
- [ ] Run `npx vitest run tests/realtime/messages.test.ts tests/server/migration.test.ts tests/server/room-repository.test.ts`; expect missing command/model failures.
- [ ] Add `kickedAt DateTime?` and SQL `ALTER TABLE "RoomParticipant" ADD COLUMN "kickedAt" TIMESTAMP(3); CREATE INDEX ...`. Extend message unions and error codes. Implement repository `updateMany({ where: { roomId, id: participantId, kickedAt: null }, data: { kickedAt } })` and return `count === 1`; filter verification by `kickedAt: null`.
- [ ] Run the focused tests and `npm run prisma:generate`; expect pass. Commit `feat: revoke kicked participant credentials`.

### Task 3: Serialized realtime kick and session eviction

**Files:**
- Modify: `src/server/realtime/session-registry.ts`
- Modify: `src/server/realtime/game-server.ts`
- Modify: `tests/realtime/game-server.test.ts`
- Modify: `tests/realtime/spectator-and-disconnect.test.ts`

**Interfaces:**
- Produces: `SessionRegistry.evictParticipant(roomId, participantId, event): number`.
- Consumes: Task 1 `kickParticipant`; Task 2 repository revocation and protocol.

- [ ] Add failing integration tests: forged host makes zero calls; lobby and acting-player kicks revoke before live save, then evict and broadcast; persistence rejection leaves Redis/session/broadcast unchanged; duplicate returns `PARTICIPANT_NOT_FOUND`; evicted sessions do not receive later snapshots; queued stale target action fails participant auth.
- [ ] Run `npx vitest run tests/realtime/game-server.test.ts tests/realtime/spectator-and-disconnect.test.ts`; expect unsupported `kick_player`/missing eviction failures.
- [ ] Implement registry eviction by sending `player_kicked`, then clearing matching session identity and room membership. Add repository method to `GameRoomRepository`. In the `kick_player` branch: `requireHost`, locate target/display name, compute pure updated state, call durable kick and require `true`, save live state, evict target sessions, broadcast snapshot, broadcast `system_message` with `<name> was removed by the host`, and schedule flow timer. Map absence/duplicate to the canonical error.
- [ ] Ensure authentication happens for every queued target command after revocation and host validation occurs before any target mutation. Run focused tests and commit `feat: add host kick realtime command`.

### Task 4: Host UI and kicked-client experience

**Files:**
- Modify: `src/app/room/[roomId]/RoomClient.tsx`
- Modify: `src/components/table/PokerTable.tsx`
- Modify: `src/components/table/SeatRing.tsx`
- Modify: `src/styles/globals.css`
- Modify: `tests/room/room-client.test.ts`
- Modify: `tests/table/poker-table.test.ts`
- Modify: `tests/table/seat-ring.test.ts`

**Interfaces:**
- Produces: `onKickPlayer(participantId, displayName)`, host-only seat kick buttons/dialog, kicked screen.
- Consumes: `player_kicked` event and `kick_player` command.

- [ ] Add failing render/helper tests: only host sees `Kick <name>` on occupied non-local seats; confirmation names target; disconnected/pending disables submit; message builder includes host token; matching kicked event removes `holdem:<room>:participantToken` and `participantId`; kicked copy and rejoin link render; room notice remains visible.
- [ ] Run `npx vitest run tests/room/room-client.test.ts tests/table/poker-table.test.ts tests/table/seat-ring.test.ts`; expect missing controls/handler failures.
- [ ] Thread `onKickPlayer` and host state through `PokerTable` to `SeatRing`. Render an accessible seat action and `<dialog role="alertdialog">` with Cancel/Kick player. In `RoomClient`, send strict command, track pending target, consume the target event, clear local credentials/state, and show the terminal kicked panel with a normal room rejoin link. Do not place the host token in rendered text or invite links.
- [ ] Add responsive styles for 1440x900 and 390x844 without overlapping betting controls. Run focused tests and `npm run typecheck`; expect pass. Commit `feat: add host kick controls and kicked screen`.

### Task 5: Browser acceptance and adversarial regression

**Files:**
- Create: `tests/e2e/host-kick.spec.ts`
- Modify: `tests/e2e/friends-room.spec.ts` only if shared setup extraction is required.

**Interfaces:**
- Produces: real multi-context acceptance over HTTP/WebSocket.

- [ ] Write the Playwright test first: create room, join two named players, seat/start, identify current actor from DOM, host opens the actor seat control and confirms kick, target sees kicked screen, remaining context sees notice and continued state, old local credential cannot restore table after reload, new join succeeds. Repeat visibility/layout assertions at 390x844.
- [ ] Run `npx playwright test tests/e2e/host-kick.spec.ts`; observe failure before UI/server support or due missing running test stack, then run against the supported local test command/environment.
- [ ] Fix only product defects exposed by the acceptance test, each with a focused regression test first. Run `npm run typecheck`, `npm run build`, `npm test`, and the Playwright case; require all green and no token in output/artifacts.
- [ ] Review the complete diff against every conformance row and commit `test: cover host kick experience`.

### Task 6: Production deployment and public proof

**Files:**
- Modify only if a deployment defect is reproduced: deployment Skill or Docker config with a failing contract test first.

**Interfaces:**
- Consumes: committed clean worktree and installed `deploying-texas-holdem-production` Skill.
- Produces: running image and public acceptance evidence at `http://120.27.143.111:32768`.

- [ ] Confirm `git status --short` contains no tracked changes, capture `git rev-parse HEAD`, and rerun focused tests, typecheck, build, full tests, and local browser acceptance.
- [ ] Run the deployment orchestrator directly from this worktree. Enter the administrator password only in its masked WinForms popup. Require candidate build, backup, switch, HTTP health, runtime checks, and temporary-key cleanup to report success; never remove Docker volumes.
- [ ] Verify `curl --fail http://120.27.143.111:32768/api/health` and `/` return HTTP 200. Run the two-context host-kick acceptance against the public base URL using disposable identities, including old-token rejection and normal rejoin.
- [ ] Compare deployed container image ID/commit with the committed HEAD and inspect app/PostgreSQL/Redis health and restart counts. Report the public URL, commit, image, tests, kick-flow result, rollback path, and cleanup state.

## Plan self-review

- Every design conformance case maps to Tasks 1-5; public deployment maps to Task 6.
- Canonical names are consistent: `kick_player`, `player_kicked`, `PARTICIPANT_NOT_FOUND`, `kickParticipant`, `removedParticipants`, `kickParticipant` repository method, and `evictParticipant`.
- No dependency, destructive volume operation, historical deletion, token disclosure, or localhost-only completion path is authorized.
