# Logic Duel Online Spec

Date: 2026-07-07
Status: v3, English-only executable engineering contract

## Spec Index

This document is the source of truth for the first online multiplayer version of Logic Duel.

- Product intent: `Objective`, `Users And Journeys`, `Scope`, `Out Of Scope`
- Agent contract: `Spec Maintenance`, `Three-Tier Boundaries`, `Commands`, `Project Structure`, `Code Style`, `Git Workflow`
- Game contract: `Game Model`, `Question Cards`, `State Machine`, `Room And Connection Flow`
- Network contract: `WebSocket Protocol`, `RoomView Contract`, `Error Codes`
- Safety contract: `Visibility Rules`, `Visibility Matrix`, `Security And Fair Play`
- UI contract: `Interface`, `UX Requirements`, `Accessibility And Responsive Requirements`
- Verification contract: `Testing Strategy`, `Conformance Cases`, `Manual Verification`, `Acceptance Criteria`
- History: `Decision Log`, `Open Questions`, `Future Extensions`

Task-specific agents should load the relevant section plus `Global Constraints` rather than the entire spec when possible.

## Spec Maintenance

This spec is a living source of truth. Implementation, tests, plans, and reviews must reconcile back to it.

Update rules:

- If implementation discovers ambiguous behavior, update this spec before coding through the ambiguity.
- If tests expose a mismatch between intended and implemented behavior, update either the test or this spec before changing production code.
- If a feature is intentionally deferred, record it in `Out Of Scope` or `Future Extensions`.
- If a public protocol, data model, error code, visibility rule, or game rule changes, update this spec in the same change.
- If manual or automated verification finds a gap, add an acceptance criterion or conformance case before marking work complete.
- This spec is English-only. Code-facing names, protocol values, error codes, and file paths are canonical as written.

## Objective

Build a deployable browser-based online multiplayer game inspired by the deduction tabletop game "Logic Duel". Version 1 lets two players create or join a room, play a complete real-time hidden-information deduction match, refresh and reconnect from the same browser, and finish with both hands revealed.

Success means a player can send a room code to a friend, both can complete a match in separate browser tabs or machines connected to the same deployed server, and the server never exposes hidden opponent information before the game ends.

## Users And Journeys

Primary users:

- Host player: creates a room, shares the room code, starts the match, and plays.
- Guest player: joins by room code and plays.
- Future maintainer/agent: implements and verifies behavior from this spec without relying on conversation memory.

Primary host journey:

1. Open the app.
2. Enter a display name.
3. Create a room.
4. Copy/share the room code.
5. Wait for a guest.
6. Start the game once two players are present.
7. Ask questions or submit guesses on own turns.
8. See the final reveal and winner.

Primary guest journey:

1. Open the app.
2. Enter a display name and room code.
3. Join the room.
4. Wait for the host to start.
5. Ask questions or submit guesses on own turns.
6. Refresh during a match and reconnect to the same seat.
7. See the final reveal and winner.

Failure journeys:

- Invalid room code returns a stable `ROOM_NOT_FOUND` error without clearing entered name.
- Full room returns `ROOM_FULL`.
- Disconnected WebSocket shows disconnected state and attempts same-browser reconnect.
- Out-of-turn action is rejected with `OUT_OF_TURN` and leaves state unchanged.

## Scope

Version 1 supports:

- Two-player rooms.
- Nickname-based seats.
- Create room and join by room code.
- Host-controlled game start.
- Server-authoritative game state.
- Real-time updates through WebSocket.
- Same-browser reconnect using local storage.
- In-memory rooms with inactivity expiry.
- Custom question deck inspired by deduction mechanics.
- Automated unit and integration tests.
- Manual two-client verification.

## Out Of Scope

Version 1 will not support:

- Three- or four-player variants.
- Public matchmaking, room lists, or invite discovery.
- User accounts, passwords, persistent profiles, or cross-device reconnect.
- Chat, reactions, spectator mode, or table-talk tooling.
- Server persistence after process restart.
- Database storage.
- Shuffle fairness proof or cryptographic audit.
- Strong anti-cheat beyond server-side hidden information and action validation.
- Copying commercial card text, commercial rules text, official art, logos, or trade dress.
- AI opponents.

## Global Constraints

- The app lives in a standalone `logic-duel/` directory.
- Frontend uses plain HTML, CSS, and JavaScript; no frontend build step.
- Backend uses Node.js HTTP plus WebSocket.
- Server owns all authoritative state.
- Clients render only filtered `RoomView` data.
- Never send opponent hands or unused tiles to any client before `state === "finished"`.
- Tests must cover game core, room actions, protocol validation, visibility filtering, and invalid actions.
- Do not modify unrelated existing project files.
- Do not copy commercial game text or assets.

## Three-Tier Boundaries

| Tier | Rule |
|---|---|
| Always | Update this spec when public contracts change. |
| Always | Keep game rules pure and testable outside WebSocket transport. |
| Always | Validate all client actions server-side. |
| Always | Run automated tests before claiming completion. |
| Always | Record manual two-client verification in the final implementation summary. |
| Ask first | Add any dependency beyond `ws` and Node built-ins. |
| Ask first | Introduce a frontend framework or build step. |
| Ask first | Add persistence, accounts, chat, spectators, AI, or more than two players. |
| Ask first | Change canonical colors, tile counts, hand size, room expiry, or protocol message names. |
| Ask first | Split this spec into multiple files. |
| Never | Commit secrets or tokens. |
| Never | Let clients compute authoritative answers, wins, or hidden opponent state. |
| Never | Send raw `Room` to a client. |
| Never | Remove failing tests to make progress. |
| Never | Copy copyrighted commercial card text, rulebook text, art, logos, or trade dress. |

## Tech Stack

Runtime:

- Node.js 20 or newer.
- npm for scripts and dependency installation.
- `ws` for WebSocket support, unless a different dependency is explicitly approved.
- Node built-in `node:test` and `assert/strict` for automated tests.

Frontend:

- Plain HTML, CSS, and JavaScript.
- Browser APIs only: WebSocket, localStorage, DOM APIs, Clipboard API where available.
- No bundler, transpiler, React/Vue/Svelte, Tailwind, or CSS preprocessor in version 1.

Deployment target:

- Any Node host that supports WebSockets and `PORT`, such as Render, Railway, Fly.io, or a VPS.
- Local development must work with `npm start`.

## Commands

Commands run from `logic-duel/` after implementation exists:

| Purpose | Command | Expected |
|---|---|---|
| Install | `npm install` | Installs dependencies without errors. |
| Start dev server | `npm start` | Starts HTTP/WebSocket server on `PORT` or `3000`. |
| Run tests | `npm test` | Runs all Node tests and exits 0. |
| Run unit tests | `npm run test:unit` | Runs pure game/protocol/room unit tests. |
| Run integration tests | `npm run test:integration` | Runs WebSocket integration tests. |
| Manual verify | `npm run verify:manual` | Prints manual checklist or runs a local smoke helper if implemented. |

Before `logic-duel/` exists, planning and spec work are done from the repository root.

## Project Structure

Create:

- `logic-duel/package.json`: scripts, dependency metadata, Node engine guidance.
- `logic-duel/server.js`: HTTP server, static file serving, WebSocket connection lifecycle.
- `logic-duel/src/game-core.js`: pure tile, deal, question, guess, and turn rules.
- `logic-duel/src/questions.js`: custom question deck definitions and answer functions.
- `logic-duel/src/protocol.js`: message validation, error helpers, `RoomView` filtering.
- `logic-duel/src/rooms.js`: room lifecycle, seats, reconnect, action validation, state transitions.
- `logic-duel/public/index.html`: single playable game surface.
- `logic-duel/public/styles.css`: responsive layout and visual styling.
- `logic-duel/public/app.js`: browser state, WebSocket client, rendering, local storage reconnect.
- `logic-duel/test/game-core.test.js`: pure game tests.
- `logic-duel/test/questions.test.js`: question answer tests.
- `logic-duel/test/protocol.test.js`: validation and view filtering tests.
- `logic-duel/test/rooms.test.js`: room state/action tests.
- `logic-duel/test/integration.test.js`: WebSocket flow tests.
- `logic-duel/README.md`: local run, test, and deploy notes.

Responsibilities:

- `game-core.js` must not import WebSocket, HTTP, DOM, filesystem, or room storage.
- `questions.js` must not know about rooms or players beyond receiving a hand.
- `protocol.js` owns external message shape and filtered views.
- `rooms.js` owns authoritative mutations and calls pure helpers.
- `server.js` owns transport, connection maps, static files, and broadcasting.
- `public/app.js` must not contain authoritative rules.

## Code Style

JavaScript style:

- Use CommonJS modules for Node files unless implementation planning explicitly switches to ESM.
- Prefer small pure functions with explicit arguments.
- Use `const` by default, `let` only for reassignment.
- Use plain objects and arrays for state.
- Use stable string constants for protocol types and error codes.
- Throw or return structured errors from server-side validation; never rely on UI-only checks.
- Keep functions under roughly 80 lines when reasonable.
- No minification, obfuscation, generated code, or bundled artifacts.

Naming:

- Room codes are uppercase alphanumeric strings.
- Colors are exactly `red` and `blue`.
- Room states are exactly `waiting`, `playing`, and `finished`.
- Message types and error codes are canonical as listed in this spec.

UI style:

- Use readable labels and stable layout dimensions.
- Do not build a marketing landing page.
- Do not use large explanatory feature text inside the app.
- Prefer compact controls, visible turn state, and scannable history.

## Git Workflow

- Use branch prefix `codex/` for implementation branches unless the user requests otherwise.
- Keep spec changes in dedicated commits when they are not inseparable from implementation.
- During implementation, commit after each independently testable task.
- Before final completion, include the verification commands and manual verification result in the final summary.
- Do not stage or commit unrelated existing workspace files.

## Architecture

The backend serves static files and hosts a WebSocket endpoint. It owns rooms, players, deck order, hands, question cards, turn state, history, reconnect tokens, and results.

The frontend renders `RoomView`, sends user actions, stores reconnect credentials in local storage, and displays inline errors. It must not receive or infer hidden opponent data from server payloads before finish.

State is in memory for version 1. A process restart loses rooms. This is acceptable and must be documented in `README.md`.

## Data Model

Use plain JavaScript objects.

`Tile`:

```js
{
  number: 0,        // integer 0..9
  color: "red"     // "red" | "blue"
}
```

`Player`:

```js
{
  id: "player_...",
  name: "Alice",
  token: "secret reconnect token",
  isOwner: true,
  connected: true,
  hand: []          // 5 Tile objects after start
}
```

`QuestionCard`:

```js
{
  id: "count-color-red",
  text: "How many red tiles do you have?",
  params: { color: "red" },
  answerType: "number"
}
```

Allowed `answerType` values:

- `number`
- `boolean`
- `tileNumber`
- `tileColor`
- `text`

`HistoryEntry`:

```js
{
  id: 1,
  type: "question",
  actorId: "player_...",
  text: "Alice asked: How many red tiles do you have? Answer: 2.",
  createdAt: 1783450000000
}
```

Allowed `HistoryEntry.type` values:

- `question`
- `guess`
- `system`
- `result`

`Room`:

```js
{
  code: "ABCD",
  state: "waiting",
  players: [],
  ownerId: "player_...",
  activePlayerId: null,
  questionDeck: [],
  questionMarket: [],
  history: [],
  winnerId: null,
  createdAt: 1783450000000,
  updatedAt: 1783450000000
}
```

Do not include opponent `hand` values in any `RoomView` during `waiting` or `playing`.

## Game Model

Tiles:

- Two color sets: `red` and `blue`.
- Numbers: 0 through 9 in each color.
- Total tiles: 20.
- Players: exactly 2.
- Hand size: 5 tiles each.
- Unused tiles: 10 tiles removed from player visibility for version 1.

Sorting:

- Hands sort by ascending `number`.
- For equal `number`, `red` sorts before `blue`.
- Sorting is server-side and deterministic.

Start:

1. Shuffle 20 tiles.
2. Deal 5 tiles to player A and 5 to player B.
3. Sort both hands.
4. Keep unused tiles server-side only.
5. Shuffle question deck.
6. Reveal up to 6 question cards into `questionMarket`.
7. Set `activePlayerId` to room owner unless changed by explicit future rule.
8. Add system history entry.

Turn actions:

- Ask one visible question card.
- Submit one complete ordered guess of opponent hand.

Question action:

1. Validate room is `playing`.
2. Validate actor is active player.
3. Validate `cardId` is in `questionMarket`.
4. Evaluate answer against opponent hand.
5. Add public question history.
6. Remove used question card.
7. Draw replacement from `questionDeck` if available.
8. Pass turn to opponent.
9. Broadcast filtered views.

Guess action:

1. Validate room is `playing`.
2. Validate actor is active player.
3. Validate exactly 5 guessed tiles.
4. Validate each tile has integer `number` 0..9 and `color` `red` or `blue`.
5. Compare ordered guess against opponent hand.
6. If correct, set `state` to `finished`, set `winnerId`, add result history, reveal both hands in views.
7. If incorrect, add public guess history, pass turn, keep hands hidden.

## Question Cards

The first deck is custom. It must not copy commercial card text.

Minimum deck size:

- At least 24 cards.
- The deck may repeat card families with different parameters.

Initial card families:

- Count tiles matching a color.
- Count odd numbers.
- Count even numbers.
- Count numbers greater than a threshold.
- Count numbers less than a threshold.
- Sum all numbers.
- Check whether a specific number is present.
- Report number at a 1-based position.
- Report color at a 1-based position.
- Report whether any adjacent tiles are consecutive.
- Count tiles within an inclusive numeric range.

Answer display:

- `boolean`: display `Yes` or `No`.
- `number`: display decimal number.
- `tileNumber`: display decimal number.
- `tileColor`: display `red` or `blue`.
- `text`: display short text.

Question answer functions must be deterministic and testable with fixed hands.

## Room And Connection Flow

Room creation:

- Client sends `createRoom` with name.
- Server validates name.
- Server creates a room with one owner player.
- Server returns `roomCreated` with room code, player id, reconnect token, and filtered view.

Join:

- Client sends `joinRoom` with room code and name.
- Server validates room exists, state is `waiting`, and seats are available.
- Server returns `roomJoined`.
- Server broadcasts `roomUpdated` to both players.

Reconnect:

- Frontend stores `{ roomCode, playerId, token }` in local storage after create/join.
- On page load, if stored credentials exist, client attempts `reconnect`.
- Server accepts reconnect if room exists and token matches player seat.
- Reconnect does not create a new seat.
- If a second tab reconnects with same token, latest socket becomes active for that seat; previous socket may be closed or marked stale.

Disconnect:

- Server marks player `connected: false` when socket closes.
- Room remains in memory.
- Opponent sees disconnected state.
- Disconnected player may reconnect with valid token.

Expiry:

- Waiting rooms expire after 2 hours of inactivity.
- Finished rooms expire after 2 hours of inactivity.
- Playing rooms expire after 2 hours only if both players are disconnected.
- `updatedAt` changes on create, join, reconnect, start, ask, guess, and disconnect.

## State Machine

| State | Action | Allowed When | Result |
|---|---|---|---|
| none | `createRoom` | Valid name | Create `waiting` room. |
| waiting | `joinRoom` | Room exists and has one seat open | Add second player. |
| waiting | `startGame` | Actor is owner and exactly two players connected or seated | Enter `playing`. |
| waiting | `askQuestion` | Never | Error `GAME_NOT_STARTED`. |
| waiting | `submitGuess` | Never | Error `GAME_NOT_STARTED`. |
| playing | `joinRoom` | Never for new seat | Error `ROOM_FULL` or `GAME_ALREADY_STARTED`. |
| playing | `reconnect` | Valid token | Restore socket for seat. |
| playing | `startGame` | Never | Error `GAME_ALREADY_STARTED`. |
| playing | `askQuestion` | Actor is active player and card is available | Add answer, replace card, pass turn. |
| playing | `submitGuess` | Actor is active player and guess is valid | Finish on correct, pass turn on incorrect. |
| playing | disconnect | Socket closes | Mark player disconnected. |
| finished | `reconnect` | Valid token | Return final view. |
| finished | `askQuestion` | Never | Error `GAME_FINISHED`. |
| finished | `submitGuess` | Never | Error `GAME_FINISHED`. |
| finished | `startGame` | Never | Error `GAME_FINISHED`. |

Rejected actions leave authoritative room state unchanged except for optional error history, which version 1 should not add.

## WebSocket Protocol

Transport:

- WebSocket URL: same host as page, path `/ws`.
- Message encoding: UTF-8 JSON text frames.
- Invalid JSON returns `INVALID_MESSAGE` when possible, then may close the socket if parsing repeatedly fails.

Client envelope:

```json
{
  "type": "askQuestion",
  "requestId": "req-17",
  "payload": {}
}
```

Server envelope:

```json
{
  "type": "roomUpdated",
  "requestId": "req-17",
  "payload": {}
}
```

Envelope rules:

- `type` is required.
- `requestId` is required for client action messages and copied into direct responses.
- `payload` must be an object.
- Unknown `type` returns `INVALID_MESSAGE`.

Client-to-server messages:

| Type | Payload |
|---|---|
| `createRoom` | `{ "name": "Alice" }` |
| `joinRoom` | `{ "roomCode": "ABCD", "name": "Bob" }` |
| `reconnect` | `{ "roomCode": "ABCD", "playerId": "player_...", "token": "..." }` |
| `startGame` | `{ "roomCode": "ABCD" }` |
| `askQuestion` | `{ "roomCode": "ABCD", "cardId": "sum-all" }` |
| `submitGuess` | `{ "roomCode": "ABCD", "tiles": [{ "number": 1, "color": "red" }] }` |

Server-to-client messages:

| Type | Payload |
|---|---|
| `roomCreated` | `{ "roomCode": "ABCD", "playerId": "player_...", "token": "...", "view": RoomView }` |
| `roomJoined` | `{ "roomCode": "ABCD", "playerId": "player_...", "token": "...", "view": RoomView }` |
| `reconnected` | `{ "view": RoomView }` |
| `roomUpdated` | `{ "view": RoomView }` |
| `actionAccepted` | `{ "message": "..." }` |
| `error` | `{ "code": "OUT_OF_TURN", "message": "It is not your turn." }` |

Broadcast rules:

- After join, start, ask, guess, reconnect, and disconnect, server sends `roomUpdated` to connected players.
- `roomUpdated` payload must be independently filtered per receiving player.
- Direct responses may be followed by `roomUpdated`.

## RoomView Contract

`RoomView` is the only room state shape rendered by the client.

During `waiting`:

```js
{
  code: "ABCD",
  state: "waiting",
  self: {
    id: "player_1",
    name: "Alice",
    isOwner: true,
    connected: true,
    hand: null
  },
  opponent: {
    id: "player_2",
    name: "Bob",
    connected: true,
    tileCount: 0,
    hand: null
  },
  isOwner: true,
  isActivePlayer: false,
  activePlayerName: null,
  questionMarket: [],
  history: [],
  winnerName: null
}
```

During `playing`:

- `self.hand` contains 5 full tiles.
- `opponent.hand` is `null`.
- `opponent.tileCount` is `5`.
- `questionMarket` contains public card objects.
- `history` contains public history only.

During `finished`:

- `self.hand` contains own full hand.
- `opponent.hand` contains opponent full hand.
- `winnerName` is set.

Client code must not depend on raw `Room`.

## Error Codes

Stable error codes:

- `INVALID_MESSAGE`
- `NAME_REQUIRED`
- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `NOT_ROOM_OWNER`
- `NEED_TWO_PLAYERS`
- `GAME_ALREADY_STARTED`
- `GAME_NOT_STARTED`
- `GAME_FINISHED`
- `OUT_OF_TURN`
- `CARD_NOT_AVAILABLE`
- `INVALID_GUESS`
- `INVALID_RECONNECT`
- `PLAYER_NOT_IN_ROOM`

Error behavior:

- Error messages are short and human-readable.
- Errors do not mutate game state.
- UI displays the latest error inline without leaving the room.

## Input Validation

Names:

- Trim whitespace.
- Require 1 to 24 visible characters.
- Reject empty names with `NAME_REQUIRED`.
- Escape names when rendering in HTML.

Room codes:

- Canonical room codes are 4 to 6 uppercase alphanumeric characters.
- Normalize entered room codes by trimming and uppercasing.

Guesses:

- Must be an array of exactly 5 tiles.
- Each tile must have `number` integer 0..9.
- Each tile must have `color` exactly `red` or `blue`.
- Reject invalid shape with `INVALID_GUESS`.

Question cards:

- `cardId` must be a string.
- `cardId` must exist in `questionMarket`.
- Stale or missing cards return `CARD_NOT_AVAILABLE`.

## Visibility Rules

The server sends each player a filtered view:

- Player sees own full hand after deal.
- Player sees only opponent name, connection state, and tile count before finish.
- Player never sees unused tiles before finish.
- Both players see public question market, turn state, room state, public history, and result.
- Both hands are revealed only after finish.

All hidden-information protection must be enforced server-side.

## Visibility Matrix

| Data | Waiting self | Waiting opponent | Playing self | Playing opponent | Finished both |
|---|---:|---:|---:|---:|---:|
| Room code | yes | yes | yes | yes | yes |
| Own name | yes | yes | yes | yes | yes |
| Opponent name | if present | if present | yes | yes | yes |
| Own hand | no | no | yes | no | yes |
| Opponent hand | no | no | no | no | yes |
| Opponent tile count | 0 | 0 | yes | yes | yes |
| Unused tiles | no | no | no | no | no |
| Question market | no | no | yes | yes | yes |
| Public history | yes | yes | yes | yes | yes |
| Winner | no | no | no | no | yes |

Server logs may contain full state during local development, but client messages must not leak hidden state.

## Interface

The first screen is the playable game surface, not a landing page.

Layout:

- Room panel: name input, room code input, create/join controls, copy room code, players, connection state, start button.
- Table panel: current turn, question cards, selected action feedback.
- Player panel: own hand, opponent placeholder tiles, ordered guess controls.
- History panel: public questions, answers, failed guesses, result, local notes.

States:

- Not connected: show name, create, and join controls.
- Waiting: show room code, seats, and start readiness.
- Playing: show turn, question cards, own hand, opponent placeholders, guess form, history.
- Finished: show winner, both hands, history, and new room option.

## UX Requirements

- Disable start until two players are seated.
- Disable start for non-owner.
- Disable question cards and guess submission when not active player.
- Make active player name visible.
- Show both players' connection state.
- Keep room code copyable.
- Preserve local notes across normal re-renders.
- Keep latest error visible until next successful action or dismissal.
- Show final reveal area after finish.
- Do not rely on long instructional paragraphs.

## Accessibility And Responsive Requirements

- All buttons and inputs must have accessible labels.
- Question cards must be keyboard-focusable buttons.
- Disabled controls must use actual `disabled` where applicable.
- Color cannot be the only indicator of tile color; include text labels or symbols.
- Layout must remain usable at 360px viewport width.
- Text must not overflow fixed controls.
- Dynamic history updates should not steal focus from active form controls.

## Error Handling

Expected errors:

- Invalid JSON or envelope.
- Missing or invalid name.
- Invalid room code.
- Joining a full or started room.
- Starting as non-owner.
- Starting before two players are seated.
- Acting out of turn.
- Selecting a stale question card.
- Submitting malformed guess.
- Losing WebSocket connection.
- Reconnect token mismatch.

Client behavior:

- Display inline error.
- Keep current form values when possible.
- Attempt reconnect with stored credentials after transient disconnect.
- If reconnect fails, show create/join controls and keep room code visible if known.

## Security And Fair Play

Minimum safeguards:

- Treat all client payloads as untrusted.
- Never send opponent hands before finish.
- Never send unused tiles to clients.
- Validate player seat and token for every room action.
- Generate reconnect tokens with enough entropy for friendly games.
- Escape user names in HTML.
- Do not use `innerHTML` for untrusted user-provided text unless escaped first.

Known limitations:

- Players can inspect their own browser state and network messages.
- In-memory state disappears on process restart.
- There is no account identity, moderation, ban system, replay audit, or cryptographic shuffle proof.
- Friendly-game anti-cheat is acceptable for version 1.

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

| Case | Setup | Action | Expected |
|---|---|---|---|
| Create room | Connected socket, valid name | `createRoom` | `roomCreated`, state `waiting`, owner true, token returned. |
| Join room | Waiting room with one player | Guest `joinRoom` | `roomJoined`, both players receive `roomUpdated`. |
| Start too early | Waiting room with one player | Owner `startGame` | Error `NEED_TWO_PLAYERS`, state unchanged. |
| Non-owner start | Waiting room with two players | Guest `startGame` | Error `NOT_ROOM_OWNER`, state unchanged. |
| Start game | Waiting room with two players | Owner `startGame` | State `playing`, each self view has 5 sorted tiles, market has 6 cards. |
| Hidden opponent hand | Playing room | Inspect player A `RoomView` | A sees own hand, opponent hand is `null`, opponent tile count is 5. |
| Ask question | Playing room, player A active, card visible | A `askQuestion` | History adds answer, card replaced if deck nonempty, active player becomes B. |
| Out-of-turn ask | Playing room, player B active | A `askQuestion` | Error `OUT_OF_TURN`, history and active player unchanged. |
| Stale card | Card already used | Active player asks old `cardId` | Error `CARD_NOT_AVAILABLE`, state unchanged. |
| Malformed guess | Playing room, active player | Guess has 4 tiles | Error `INVALID_GUESS`, state unchanged. |
| Incorrect guess | Playing room, active player | Submit valid wrong guess | History records incorrect guess, turn passes, hands remain hidden. |
| Correct guess | Playing room, active player | Submit exact opponent hand | State `finished`, winner set, both hands visible. |
| Reconnect | Playing room, player socket closed | Same credentials `reconnect` | `reconnected`, same seat restored, no third seat. |
| Full room | Waiting room has two players | Third user `joinRoom` | Error `ROOM_FULL`. |
| Finished action | Finished room | Any `askQuestion` | Error `GAME_FINISHED`, state unchanged. |

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

## Decision Log

- 2026-07-06: Use standalone `logic-duel/` app instead of modifying existing `demo/`.
- 2026-07-06: Use Node.js plus WebSocket for real-time rooms and deployability.
- 2026-07-06: Limit version 1 to two players.
- 2026-07-06: Use an original custom question deck instead of commercial card text.
- 2026-07-06: Use in-memory rooms for version 1.
- 2026-07-06: Use same-browser reconnect tokens instead of accounts.
- 2026-07-07: Make spec English-only because code-facing contracts are canonical and the user no longer needs Chinese.
- 2026-07-07: Harden spec using agent-oriented PRD/SRS practices: six core areas, three-tier boundaries, conformance cases, and spec index.

## Open Questions

None blocking version 1 implementation.

Non-blocking choices for implementation planning:

- Whether to add a small debug-only helper for manual correct-guess verification.
- Whether room codes should avoid ambiguous characters such as `0`, `O`, `1`, and `I`.
- Whether failed guess history should display the full guessed sequence or only that a guess was attempted. Current default: display the public guessed sequence.

## Future Extensions

- Three- or four-player variants.
- AI opponent.
- Public deployment with share links.
- Persistent room links.
- Database-backed rooms.
- Cross-device reconnect.
- Spectator mode with delayed or finished-only reveal.
- Fuller custom question deck.
- Replay export.
- Cryptographic shuffle proof.
