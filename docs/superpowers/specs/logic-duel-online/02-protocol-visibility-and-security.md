# Logic Duel Online - Protocol Visibility And Security

Date: 2026-07-07
Status: v3.1, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

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
