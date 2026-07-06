# Logic Duel Online - Verification

Date: 2026-07-07
Status: v3.2, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Testing Strategy

Use Node's built-in test runner.

Unit tests:

- Tile creation.
- Shuffle/deal shape using injectable deterministic shuffle where needed.
- Hand sorting.
- Question answer functions.
- Guess validation.
- Win detection.
- Turn switching.
- Room state transitions.
- Error code returns.
- Visibility filtering.

Integration tests:

- WebSocket create/join/start.
- Ask question and receive synchronized history.
- Incorrect guess and turn pass.
- Correct guess and final reveal.
- Reconnect after socket close.
- Reject invalid JSON, malformed message, out-of-turn action, stale card, full room.

Regression rule:

- Any implementation bug found during manual testing must get an automated test before or with the fix when reasonably testable.


## Conformance Cases

| ID | Case | Setup | Action | Expected |
|---|---|---|---|---|
| C01 | Create room | Connected socket, valid name | `createRoom` | `roomCreated`, state `waiting`, owner true, token returned. |
| C02 | Join room | Waiting room with one player | Guest `joinRoom` | `roomJoined`, both players receive `roomUpdated`. |
| C03 | Start too early | Waiting room with one player | Owner `startGame` | Error `NEED_TWO_PLAYERS`, state unchanged. |
| C04 | Non-owner start | Waiting room with two players | Guest `startGame` | Error `NOT_ROOM_OWNER`, state unchanged. |
| C05 | Start game | Waiting room with two players | Owner `startGame` | State `playing`, each self view has 5 sorted tiles, market has 6 cards. |
| C06 | Hidden opponent hand | Playing room | Inspect player A `RoomView` | A sees own hand, opponent hand is `null`, opponent tile count is 5. |
| C07 | Ask question | Playing room, player A active, card visible | A `askQuestion` | History adds answer, card replaced if deck nonempty, active player becomes B. |
| C08 | Out-of-turn ask | Playing room, player B active | A `askQuestion` | Error `OUT_OF_TURN`, history and active player unchanged. |
| C09 | Stale card | Card already used | Active player asks old `cardId` | Error `CARD_NOT_AVAILABLE`, state unchanged. |
| C10 | Malformed guess | Playing room, active player | Guess has 4 tiles | Error `INVALID_GUESS`, state unchanged. |
| C11 | Incorrect guess | Playing room, active player | Submit valid wrong guess | History records incorrect guess, turn passes, hands remain hidden. |
| C12 | Correct guess | Playing room, active player | Submit exact opponent hand | State `finished`, winner set, both hands visible. |
| C13 | Reconnect | Playing room, player socket closed | Same credentials `reconnect` | `reconnected`, same seat restored, no third seat. |
| C14 | Full room | Waiting room has two players | Third user `joinRoom` | Error `ROOM_FULL`. |
| C15 | Finished action | Finished room | Any `askQuestion` | Error `GAME_FINISHED`, state unchanged. |


## Manual Verification

Run from `logic-duel/`:

1. `npm install`
2. `npm test`
3. `npm start`
4. Open first browser tab at local server URL.
5. Create room as Alice.
6. Copy room code.
7. Open second browser tab or another browser.
8. Join room as Bob.
9. Verify Alice can start and Bob cannot start.
10. Start game.
11. Verify each tab sees only its own hand.
12. Ask at least two questions across both players.
13. Submit one incorrect guess.
14. Refresh one tab and verify reconnect to same seat.
15. Submit a correct guess using server-known hand during local testing or a debug-assisted test path if available.
16. Verify final reveal shows both hands and winner.
17. Stop server.

The final implementation summary must record whether each step passed.


## Acceptance Criteria

Version 1 is complete only when:

- `npm install` works in `logic-duel/`.
- `npm start` serves the app and WebSocket endpoint.
- `npm test` passes.
- Two clients can create, join, start, play, reconnect, and finish a game.
- Server remains authoritative for all game state.
- Opponent hands and unused tiles are not sent before finish.
- All listed conformance cases pass manually or through automated tests.
- UI is usable on desktop and at 360px width.
- README documents run, test, and deploy basics.
- Final summary includes automated test output and manual verification result.
