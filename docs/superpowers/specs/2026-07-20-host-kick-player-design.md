# Host Kick Player Design

This approved document is the implementation source of truth. If code discovery exposes a contradiction, update and review this document before coding through it.

## Goal

Allow the authenticated room host to remove any participant at any time. Removal is authoritative, immediate, visible to the room, safe during an active hand, and enforced across reconnects. The completed feature must be deployed to the production Docker site and verified through its public URL.

## Product behavior

- Host-only controls expose `Kick player` for every occupied seat except the host's own participant identity, if any.
- The action requires an in-app confirmation naming the target. A pending request disables duplicate submission.
- A valid kick immediately removes the target from the room. Everyone receives a system notice naming the removed player.
- The removed client receives a dedicated `player_kicked` event, clears the room participant token and participant ID from local storage, stops rendering the table, and shows `You were removed from the room by the host` with a link to rejoin normally.
- A kicked credential can no longer join, claim a seat, act, top up, or send quick phrases. The person may create a new participant through the ordinary join flow.
- Pending top-ups for the target are cancelled. Prior hands, buy-ins, hand results, and session accounting remain durable history.

## Authoritative state transition

Add a pure `kickParticipant(state, participantId, now)` transition.

- Reject an unknown or already removed participant without changing state.
- Lobby, between-hand, paused, presentation, and finished states remove the seat immediately and cancel pending top-ups.
- During an unfinished betting or insurance phase, force the target to fold even if all-in, so committed chips remain in the pot but the kicked player can no longer win it. Actor progression and early settlement reuse the existing poker rules. Then vacate the public seat while retaining the immutable hand snapshot and historical accounting needed for settlement.
- Once the hand has already entered showdown/runout/result presentation and winners are authoritative, removal cannot rewrite that completed betting outcome; it removes the participant from the room and all future hands immediately while the current presentation completes unchanged.
- If the target owns a pending insurance decision, treat the decision as declined before progressing.
- The transition never pauses the room merely because a player was kicked.

## Realtime authority and revocation

Add strict client message `kick_player { roomId, hostToken, participantId }` and server event `player_kicked { participantId, displayName }`.

The game server must:

1. Validate the host token before reading or mutating target state.
2. Serialize the command through the existing per-room coordinator.
3. Persist the new room state before broadcasting it.
4. Mark the participant record as kicked/revoked durably and remove all sockets authenticated as that participant from room membership.
5. Send `player_kicked` directly to those sockets before closing or detaching them.
6. Broadcast the filtered snapshot and system notice to remaining clients.

Participant authentication must reject a revoked participant token. Restarting the server must not restore access.

## Persistence

Add nullable participant removal metadata (`kickedAt`, and optionally a removal reason constrained to `host_kick`) instead of deleting the participant row. Repository operations update the participant marker and the authoritative room snapshot in the same command boundary supported by the current persistence design. Historical foreign keys remain valid.

## UI

Place the destructive action in the existing host tools/seat interaction surface, not in ordinary player controls. Use a compact confirmation dialog with `Cancel` and `Kick player`. While disconnected, reconnecting, or submitting, disable it. The control must work at desktop and mobile widths without covering betting controls.

## Errors and races

- Forged/missing host token returns `INVALID_HOST_TOKEN` and performs no mutation.
- Missing/already kicked target returns a stable `PARTICIPANT_NOT_FOUND` error.
- Duplicate concurrent kicks are idempotent from the room's perspective: one succeeds; later attempts receive the stable not-found result.
- Commands sent by the target after revocation are rejected even if already queued behind the kick.
- Persistence failure sends an error to the host and leaves the prior in-memory/broadcast state intact.

## Verification

Automated coverage must prove message validation, host authorization, pure transitions in lobby/active actor/non-actor/all-in/insurance/presentation states, token revocation, socket detachment, top-up cancellation, persistence history retention, UI confirmation, kicked-client credential cleanup, and mobile layout.

Browser acceptance uses separate host and player contexts against the real WebSocket path: join, seat, begin a hand, kick the acting player, observe automatic fold and continued play, verify the kicked screen, verify room-wide notice, and prove the old token cannot reconnect. After full regression tests pass, deploy through the installed production deployment Skill and repeat health and kick-flow checks at `http://120.27.143.111:32768`.

## Out of scope

- Ban lists, IP/device bans, timed suspensions, moderation notes, undo, and deleting historical results.

## Project map and contracts

| Area | Owned files |
|---|---|
| Pure poker transition | `src/lib/poker/engine.ts`, `tests/poker/host-kick.test.ts` |
| Wire protocol | `src/lib/realtime/messages.ts`, `tests/realtime/messages.test.ts` |
| Durable revocation | `prisma/schema.prisma`, `prisma/migrations/20260720130000_add_participant_kicked_at/migration.sql`, `src/server/repositories/room-repository.ts`, `tests/server/room-repository.test.ts` |
| Session eviction and command orchestration | `src/server/realtime/session-registry.ts`, `src/server/realtime/game-server.ts`, `tests/realtime/game-server.test.ts` |
| Client and table UI | `src/app/room/[roomId]/RoomClient.tsx`, `src/components/table/PokerTable.tsx`, `src/components/table/SeatRing.tsx`, `src/styles/globals.css`, component tests |
| Browser acceptance | `tests/e2e/host-kick.spec.ts` |

Canonical contracts:

```ts
type KickPlayerCommand = {
  type: "kick_player";
  roomId: string;
  hostToken: string;
  participantId: string;
};

type PlayerKickedEvent = {
  type: "player_kicked";
  payload: { participantId: string; displayName: string };
};

interface RoomParticipant {
  kickedAt: Date | null;
}

interface RemovedParticipantLedger {
  participantId: string;
  displayName: string;
  initialChips: number;
  cumulativeBuyIn: number;
  finalChips: number;
}
```

`RoomState.removedParticipants` is a record keyed by participant ID. Kicking snapshots the target's displayed name, initial chips, cumulative buy-in, and uncommitted final stack before vacating the seat. It is server state, not an occupied seat and not a reconnect permission. `finalizeSession` merges this ledger with occupied seats so the final session summary still includes every removed player exactly once. The live-room schema accepts missing `removedParticipants` as `{}` for backward compatibility with currently stored production rooms.

`RoomRepository.kickParticipant(roomId, participantId, kickedAt): Promise<boolean>` performs an exact scoped update where `roomId`, `id`, and `kickedAt: null` all match; it returns `true` only for the first revocation. `verifyParticipantToken` includes `kickedAt: null` in its lookup. No participant row or historical child row is deleted.

`SessionRegistry.evictParticipant(roomId, participantId, event): number` sends the event, clears room/participant/host identity on every matching session, and returns the number evicted. The socket may remain open to show the kicked screen and allow an explicit new join, but it receives no later room broadcasts.

## Conformance matrix

| Case | Setup and action | Required result |
|---|---|---|
| Forged host | Non-host sends `kick_player` | `INVALID_HOST_TOKEN`; state, database, sessions unchanged |
| Lobby target | Occupied player, no hand | Seat becomes empty, pending top-up removed, token revoked, target evicted |
| Acting target | Target owns action | Forced fold, committed chips retained, actor advances or hand settles, seat vacated |
| Non-acting target | Another player owns action | Target folds, current actor remains if still eligible, seat vacated |
| All-in target before presentation | Unfinished betting/insurance | Target marked folded and ineligible for pot; existing commitment remains |
| Insurance target | Target owns pending offer | Decline insurance, then forced fold/removal; flow advances without pausing |
| Presentation target | Showdown/runout/summary already authoritative | Current outcome unchanged; target removed from future hands and room |
| Duplicate kick | Two serialized commands target same participant | First succeeds; second returns `PARTICIPANT_NOT_FOUND` with no second notice |
| Stale queued command | Target command executes after kick | Participant auth fails; no state mutation |
| Persistence failure | Durable revocation throws | No live-room save, eviction, snapshot, or notice |
| Refresh with old token | Kicked client reconnects | `INVALID_PARTICIPANT_TOKEN`; table is not restored |
| Rejoin | Person submits ordinary join form | A new participant ID/token can enter normally |
| Final room summary | One player was kicked earlier | Summary includes that participant once with `finalChips` captured at removal and correct net chips |

## Boundaries

| Tier | Rules |
|---|---|
| Always | Validate host first; serialize per room; persist revocation and room state before broadcast; preserve committed chips/history; add regression tests; verify desktop/mobile and public production URL. |
| Ask first | Add a dependency; introduce bans beyond one credential; delete/rebuild Docker volumes; change the public port or production host. |
| Never | Trust a client-supplied participant identity without host authentication; leak tokens; delete historical rows; let revoked tokens authenticate; claim completion from localhost-only evidence. |

## Commands and delivery gates

- Setup: `npm install`
- Focused tests: `npx vitest run tests/poker/host-kick.test.ts tests/realtime/messages.test.ts tests/server/room-repository.test.ts tests/realtime/game-server.test.ts tests/table/seat-ring.test.ts tests/room/room-client.test.ts`
- Static verification: `npm run typecheck && npm run build`
- Full regression: `npm test`
- Browser acceptance: `npx playwright test tests/e2e/host-kick.spec.ts`
- Deployment: run `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\deploy.ps1` from the committed worktree.
- Production proof: health and page HTTP 200 plus two-browser-context host kick through the public URL `http://120.27.143.111:32768`.

No implementation is complete until focused tests, typecheck, build, full regression, browser acceptance, deployment, and public production verification all pass. Any discovered defect must first be reproduced by a failing test.

## Decision log and maintenance

- 2026-07-20: User approved immediate forced fold during an unfinished hand; committed chips are not refunded.
- 2026-07-20: Presentation outcomes already made authoritative are not rewritten.
- 2026-07-20: Revocation is per participant credential, not a person/device ban; normal rejoin creates a new identity.
- 2026-07-20: Historical data is retained through nullable `kickedAt` rather than row deletion.

There are no open product questions. Protocol, migration, or state-transition changes require updating this spec and its conformance matrix in the same commit.
