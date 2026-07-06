# Logic Duel Online

Standalone online multiplayer implementation of Logic Duel for two friendly players.

## Requirements

- Node.js 20 or newer
- WebSocket support on the deployment host

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. The server uses `PORT` when set and defaults to `3000`.

For deterministic manual verification:

```bash
LOGIC_DUEL_ENABLE_FIXTURES=1 npm start
```

In fixture mode, Alice's correct hand is `0 red, 2 red, 2 blue, 7 red, 9 blue`.

## Test

```bash
npm test
npm run verify:manual
```

Targeted checks can be run with Node's test runner:

```bash
node --test test/game-core.test.js test/questions.test.js test/protocol.test.js test/rooms.test.js
node --test test/integration.test.js
```

## Game Flow

One player creates a room and becomes owner. A second player joins with the room code. The owner starts the game once two players are seated. On each turn the active player either asks one visible question card or submits a complete five-tile guess of the opponent hand. Correct guesses finish the game and reveal both hands; incorrect guesses are public and pass the turn.

## Protocol And Operations

- Static app: `/`
- WebSocket: `/ws`
- Health check: `/healthz`
- Health fields: `ok`, `status`, `version`, `uptimeSeconds`, `activeRooms`, `activeConnections`, `expiredRoomsCleaned`
- Reconnect credentials are returned only to the owning client after create, join, or reconnect.
- `RoomView` hides opponent hands and unused tiles until the game is finished.

## Deployment Notes

Use:

```bash
npm install
npm start
```

The host must forward HTTP and WebSocket traffic to the same Node process. Rooms are stored in memory, so active rooms disappear when the process restarts. Version 1 does not include accounts, persistence, moderation, a ban system, or cryptographic shuffle proof.
