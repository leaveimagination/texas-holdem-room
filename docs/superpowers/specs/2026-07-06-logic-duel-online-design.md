# Logic Duel Online Design

Date: 2026-07-06
Status: v2, implementation-ready draft

## Spec Maintenance

This spec is the source of truth for the first online multiplayer version. Keep it updated as the implementation reveals better decisions or hidden edge cases.

Update rules:

- If implementation discovers an ambiguous behavior, update this spec before coding the behavior.
- If tests expose a mismatch between intended and implemented behavior, update either the test or the spec before changing production code.
- If a feature is intentionally deferred, record it in `Future Extensions` or `Out Of Scope` instead of leaving it implied.
- If a protocol message changes, update `WebSocket Protocol` in the same change as the code.
- If verification finds a gap, add an acceptance criterion or test requirement before marking the feature complete.

## Goal

Build an online multiplayer browser game inspired by the deduction tabletop game "Logic Duel". The first version should let two players create or join a room, play a complete hidden-information deduction match in real time, and run locally with a deployment-friendly Node.js structure.

## Scope

The first version supports two-player rooms only. Players enter a nickname, create a room to receive a room code, or join an existing room by code. The room owner starts the game once two players are present.

The app does not include accounts, matchmaking, persistent statistics, chat, spectators, AI opponents, or public lobby browsing. These are intentionally outside the first version so hidden information and real-time gameplay can be reliable.

## Out Of Scope

The first version will not support:

- Three- or four-player variants.
- Public matchmaking, room lists, or invite discovery.
- User accounts, passwords, or persistent profiles.
- Cross-device reconnect.
- Spectator mode.
- Chat, emoji reactions, or table talk tooling.
- Server persistence after process restart.
- Anti-cheat beyond server-side hidden information and action validation.
- A copy of the commercial card deck or exact commercial rulebook text.

## Architecture

The app lives in a new `logic-duel/` directory.

The backend is a Node.js server that serves static frontend assets and hosts a WebSocket endpoint. It owns all authoritative game state: rooms, players, deck order, hands, question cards, turn state, history, and win/loss results.

The frontend is plain HTML, CSS, and JavaScript. It renders the current player's visible state, sends user actions over the WebSocket, and never receives the opponent's hidden tiles until the game ends.

No build step is required for the frontend. `npm start` starts the server, and users open the local URL in a browser. The server will read a `PORT` environment variable so it can run locally or on common Node hosting platforms that support WebSockets.

## File Layout

The first implementation should use this layout unless a better reason appears during planning:

- `logic-duel/package.json`: scripts and dependencies.
- `logic-duel/server.js`: HTTP server and WebSocket wiring.
- `logic-duel/src/game-core.js`: pure game rules with no network or DOM dependencies.
- `logic-duel/src/rooms.js`: room lifecycle, player seats, reconnect token handling, and server-side action validation.
- `logic-duel/src/protocol.js`: message names, payload validation helpers, and view shaping helpers.
- `logic-duel/public/index.html`: game surface.
- `logic-duel/public/styles.css`: layout and visual styling.
- `logic-duel/public/app.js`: WebSocket client and DOM rendering.
- `logic-duel/test/*.test.js`: Node test suite.

The pure game core should be usable from tests without starting a server.

## Data Model

Use plain JavaScript objects. The exact implementation may include helper functions, but the externally meaningful fields should remain stable.

`Tile`:

- `number`: integer from 0 to 9.
- `color`: `red` or `blue`.

`Player`:

- `id`: server-generated stable id for the seat.
- `name`: trimmed display name, 1 to 24 visible characters.
- `token`: reconnect secret stored by the joining browser.
- `isOwner`: boolean.
- `connected`: boolean.
- `hand`: array of 5 `Tile` objects after the game starts.

`QuestionCard`:

- `id`: stable string.
- `text`: display text safe to show to both players.
- `params`: optional structured parameters used by the answer function.
- `answerType`: `number`, `boolean`, `tileNumber`, `tileColor`, or `text`.

`HistoryEntry`:

- `id`: monotonically increasing integer within the room.
- `type`: `question`, `guess`, `system`, or `result`.
- `actorId`: player id, when an entry belongs to a player action.
- `text`: public display text.
- `createdAt`: server timestamp in milliseconds.

`Room`:

- `code`: short uppercase room code.
- `state`: `waiting`, `playing`, or `finished`.
- `players`: array of up to 2 `Player` objects.
- `ownerId`: player id.
- `activePlayerId`: player id during `playing`.
- `questionDeck`: unrevealed `QuestionCard` array.
- `questionMarket`: up to 6 revealed `QuestionCard` objects.
- `history`: ordered `HistoryEntry` array.
- `winnerId`: player id after a correct guess.
- `createdAt`: server timestamp in milliseconds.
- `updatedAt`: server timestamp in milliseconds.

Do not include opponent `hand` values in a client's room view during `waiting` or `playing`.

## Game Model

Tiles consist of two colored sets, `red` and `blue`, of the numbers 0 through 9, for 20 total tiles. Each player receives 5 tiles. A player's hand is sorted by ascending number, with `red` before `blue` as the fixed color tiebreaker for duplicate numbers.

At game start, the server shuffles tiles, deals hands, removes unused tiles from play, shuffles question cards, and reveals six public question cards. The active player may ask one revealed question or submit a complete guess of the opponent's five tiles.

Asking a question causes the server to calculate the answer from the opponent's hidden hand, add the public result to history, discard the used question card, reveal a replacement if available, and pass the turn.

Guessing requires the player to submit five ordered tile guesses, each with a number and color. A correct guess ends the game and reveals both hands. An incorrect guess is recorded publicly and the turn passes.

## Game Rules Details

Room setup:

- Room codes are generated by the server and should be easy to read aloud, for example 4 to 6 uppercase letters or digits.
- A room accepts at most two player seats.
- The owner can start only when exactly two seats are occupied.

Turn rules:

- Only the active player may ask a question or submit a guess.
- Asking a question always targets the opponent in the two-player version.
- A used question card is removed from `questionMarket`.
- If `questionDeck` still has cards, draw one replacement so the market returns to 6 cards.
- If the deck is empty, continue with fewer visible question cards.
- After a question or incorrect guess, `activePlayerId` changes to the opponent.
- After a correct guess, the room enters `finished` and no further game actions are accepted.

Guess rules:

- A guess must include exactly five ordered tiles.
- Each guessed tile must have a valid number and color.
- Duplicate guesses are allowed because the real tile set has duplicate numbers across colors.
- A guess is correct only if all five positions match both number and color.
- An incorrect guess should reveal only that the guess was incorrect, plus the public guessed sequence if useful for history.

## Question Cards

The first version includes a playable custom question set rather than copying a commercial rulebook. Card types should be deterministic, easy to answer from a hand, and useful for deduction.

Initial card families:

- Count tiles matching a color.
- Count odd or even numbers.
- Count numbers greater than or less than a threshold.
- Report the sum of all numbers.
- Report whether a specific number is present.
- Report the number at a specific position.
- Report the color at a specific position.
- Report whether any adjacent tiles are consecutive.
- Report the count of tiles within a numeric range.

Each card has a stable id, display text, and answer function. The server computes answers; clients only display card text and public results.

The initial deck should have at least 24 cards so multiple games do not feel too repetitive. It can include repeated card families with different parameters, for example "How many numbers are 0-4?" and "How many numbers are 5-9?" as separate cards.

Question answer style:

- Boolean answers display as `Yes` or `No`.
- Numeric answers display as a number.
- Position questions use 1-based positions in UI text.
- The server stores answer values structurally and also records a human-readable `text` in history.

## Room And Connection Flow

A player can create a room or join by code. On first connection, the server assigns a player id and the frontend stores a reconnect token in local storage. If the same browser refreshes, it may reconnect to the same seat while the room is still active.

A room has these states:

- `waiting`: one or two players are present, game has not started.
- `playing`: two players are playing a match.
- `finished`: a winner exists and hidden hands are revealed.

Only the room owner can start the match. If a player disconnects during a match, the other player sees a disconnected status. The game state remains in memory so a browser refresh can recover. Cross-device account-based recovery is out of scope.

Rooms are in memory for the first version. Waiting and finished rooms expire after 2 hours of inactivity. Playing rooms expire after 2 hours only if both players are disconnected.

## State Machine

Allowed actions by room state:

`waiting`:

- `createRoom`: allowed before a room exists.
- `joinRoom`: allowed until the room has two players.
- `startGame`: allowed only for the owner when two players are present.
- `askQuestion`: rejected.
- `submitGuess`: rejected.

`playing`:

- `joinRoom`: rejected if it would create a third seat; reconnect is allowed with a valid token.
- `startGame`: rejected.
- `askQuestion`: allowed only for the active player.
- `submitGuess`: allowed only for the active player.
- `leave` or disconnect: marks player disconnected but keeps room state.

`finished`:

- `askQuestion`: rejected.
- `submitGuess`: rejected.
- `startGame`: rejected for the finished match.
- `createRoom`: allowed as a separate new room.
- Reconnect is allowed so players can see the result.

Every rejected action returns an `error` message and leaves authoritative state unchanged.

## WebSocket Protocol

Messages are JSON objects. Every client-to-server message has:

- `type`: string action name.
- `requestId`: client-generated string so responses can be correlated.
- `payload`: object.

Every server-to-client message has:

- `type`: string event name.
- `requestId`: copied from the triggering request when applicable.
- `payload`: object.

Client-to-server message types and payloads:

- `createRoom`: payload `{ "name": "Alice" }`
- `joinRoom`: payload `{ "roomCode": "ABCD", "name": "Bob" }`
- `reconnect`: payload `{ "roomCode": "ABCD", "playerId": "...", "token": "..." }`
- `startGame`: payload `{ "roomCode": "ABCD" }`
- `askQuestion`: payload `{ "roomCode": "ABCD", "cardId": "sum-all" }`
- `submitGuess`: payload `{ "roomCode": "ABCD", "tiles": [{ "number": 1, "color": "red" }] }`

Example full client message:

```json
{
  "type": "askQuestion",
  "requestId": "req-17",
  "payload": {
    "roomCode": "ABCD",
    "cardId": "sum-all"
  }
}
```

Server-to-client message types and payloads:

- `roomCreated`: returns `{ "roomCode": "...", "playerId": "...", "token": "...", "view": RoomView }`
- `roomJoined`: returns `{ "roomCode": "...", "playerId": "...", "token": "...", "view": RoomView }`
- `reconnected`: returns `{ "view": RoomView }`
- `roomUpdated`: broadcasts `{ "view": RoomView }` to each connected player, with each view filtered for that player.
- `actionAccepted`: returns `{ "message": "..." }` for actions whose result is mainly visible through `roomUpdated`.
- `error`: returns `{ "code": "OUT_OF_TURN", "message": "It is not your turn." }`

Example full server error:

```json
{
  "type": "error",
  "requestId": "req-17",
  "payload": {
    "code": "OUT_OF_TURN",
    "message": "It is not your turn."
  }
}
```

`RoomView` is the only room state shape clients render. It includes:

- `code`
- `state`
- `self`: current player id, name, owner flag, connection flag, and full hand if dealt.
- `opponent`: opponent id, name, connection flag, tile count, and full hand only when `state` is `finished`.
- `isOwner`
- `isActivePlayer`
- `activePlayerName`
- `questionMarket`
- `history`
- `winnerName`
- `errorMessage`, optional transient UI hint

The client must render only `RoomView`; it must not depend on raw `Room`.

## Error Codes

Use stable error codes so tests and UI can target behavior without matching prose:

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

Error messages should be short and human-readable.

## Visibility Rules

The server sends each player a filtered view:

- The player sees their own full hand.
- The player sees only the opponent's tile count before the game ends.
- Both players see public question cards, turn state, room state, public history, and game result.
- Both hands are revealed only after the game finishes.

All client actions are validated server-side. A client cannot ask a missing card, act out of turn, start without two players, guess with malformed tiles, or join a full room.

## Visibility Matrix

During `waiting`:

- A player can see their own name, opponent name if present, room code, owner status, and connection state.
- No hands or question cards exist yet.

During `playing`:

- A player can see their own full hand.
- A player can see the opponent's name, connection state, and tile count.
- A player cannot see opponent tile numbers, colors, or removed unused tiles.
- Both players can see question market, public history, active player, and failed guess history.

During `finished`:

- Both players can see both full hands, winner, history, and final result.

Server logs may contain full state during local development, but production-facing client messages must not leak hidden state.

## Interface

The first screen is the playable game surface, not a landing page.

The layout has four main areas:

- Room panel: nickname, room code, players, connection state, start/new game controls.
- Table panel: current turn, six public question cards, and action feedback.
- Player panel: own hand, opponent placeholder tiles, and ordered guess controls.
- History panel: public questions, answers, failed guesses, final result, and a local notes textarea.

The visual style should feel like a clean tabletop tool: compact, readable, and focused on deduction. Cards and tiles should have stable dimensions so the interface does not shift during play. Desktop browsers are the primary target; the layout should remain usable on narrow screens.

## UX Requirements

The UI should make the legal next action obvious:

- Disable start until two players are present or show a clear reason.
- Disable question cards and guess submission when it is not the player's turn.
- Show whose turn it is using player names.
- Show connection state for both players.
- Keep the room code copyable.
- Preserve the local notes textarea across normal re-renders.
- Show a final reveal area when the game ends.

The UI should not use instructional paragraphs to explain every control. Labels, disabled states, tooltips, and concise status text should carry the interaction.

## Error Handling

The server returns structured error messages for invalid actions. The frontend displays concise inline messages and keeps the user in the room.

Expected error cases include invalid room code, duplicate or full room, missing nickname, start attempted by a non-owner, start attempted before two players join, out-of-turn actions, stale question card selection, malformed guesses, and disconnected WebSocket.

The client should try to reconnect automatically after short connection drops. If reconnect fails, it should keep the room code visible so the player can retry manually.

## Security And Fair Play

The first version is designed for friendly games, not hostile public play. Still, the server must preserve hidden information and reject invalid actions.

Minimum safeguards:

- Never send opponent hands or unused tiles to a client before `finished`.
- Treat all client payloads as untrusted.
- Validate room code, player seat, reconnect token, turn ownership, card availability, and guess shape server-side.
- Generate reconnect tokens with enough entropy for casual use.
- Do not let a second tab with the same token create a third seat.

Known limitations:

- A player can inspect their own browser state and messages.
- In-memory state disappears if the server restarts.
- There is no account identity, ban system, replay audit, or cryptographic proof of shuffle fairness.

## Testing

Core game logic should be isolated from WebSocket transport and covered with automated tests before implementation code is added.

Required unit coverage:

- Tile creation, shuffle/deal shape, and sorted hand order.
- Question card answer functions.
- Guess validation and win detection.
- Turn switching after question and failed guess.
- Visibility filtering that hides opponent hands during play.

Required integration coverage:

- Create room, join room, start game.
- Ask a question and receive synchronized public history.
- Submit incorrect and correct guesses.
- Reject invalid out-of-turn or malformed actions.

Manual verification should include opening two browser tabs, creating a room in one tab, joining from the other, completing several turns, refreshing one tab, and finishing a game.

## Acceptance Criteria

The first version is complete when all of these are true:

- `npm install` and `npm start` work inside `logic-duel/`.
- Two browser tabs can create and join a room by code.
- The owner cannot start until two players are present.
- Starting a game deals each player 5 sorted tiles and reveals 6 question cards.
- Each tab sees its own hand and does not see the opponent hand during play.
- The active player can ask a visible question and both tabs see the public answer in history.
- Used question cards leave the market and are replaced while the deck has cards.
- The active player can submit an incorrect guess, see it recorded, and the turn passes.
- The active player can submit a correct guess, the game finishes, winner is shown, and both hands are revealed.
- Out-of-turn, malformed, stale-card, and full-room actions are rejected with stable error codes.
- Refreshing one tab during a match can reconnect to the same seat using local storage.
- Automated tests cover the required unit and integration behaviors.
- Manual two-tab verification has been run and recorded in the final implementation summary.

## Decision Log

- 2026-07-06: Choose a standalone `logic-duel/` app instead of modifying the existing `demo/` app, because the game is a separate product surface.
- 2026-07-06: Choose Node.js plus WebSocket so the game can support real-time rooms and remain deployable on common Node hosts.
- 2026-07-06: Limit v1 to two players so hidden information, turn flow, and reconnect behavior can be made solid before adding variants.
- 2026-07-06: Use an original question deck inspired by deduction mechanics instead of copying commercial card text.
- 2026-07-06: Use in-memory rooms for v1 to keep setup simple; persistence is deferred.
- 2026-07-06: Use same-browser reconnect tokens, not accounts, for lightweight refresh recovery.

## Future Extensions

Likely follow-up improvements include three- or four-player variants, AI opponent mode, shareable deployment, persistent room links, spectator mode with delayed reveal rules, better reconnect across devices, and a fuller question deck.
