# Host Kick Player Design

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
