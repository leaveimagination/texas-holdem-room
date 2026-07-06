# Logic Duel Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone browser-based online multiplayer implementation of Logic Duel under `logic-duel/`, backed by an authoritative Node.js WebSocket server and covered by executable tests.

**Architecture:** The server owns all hidden state, turn order, scoring, reconnect tokens, room expiry, and question resolution. The browser only renders `RoomView` payloads and sends validated intent messages over `/ws`. Pure rule modules are tested first, then composed into room state, protocol filtering, transport, and UI.

**Tech Stack:** Node.js 20+, built-in `node:test`, CommonJS modules, `ws` 8.x, static HTML/CSS/JS served by the same Node process.

## Global Constraints

- Spec entrypoint: `docs/superpowers/specs/2026-07-06-logic-duel-online-design.md`.
- Binding subspecs: `docs/superpowers/specs/logic-duel-online/00-overview-and-agent-contract.md` through `07-operations-and-invariants.md`.
- App root is `logic-duel/`; do not migrate or modify `demo/`.
- Runtime command from app root: `npm install`, `npm test`, `npm start`, `node scripts/manual-checklist.js`.
- Server endpoints: static app on `/`, WebSocket on `/ws`, JSON health on `/healthz`.
- Health response includes `status`, `version`, `uptimeSeconds`, `activeRooms`, `activeConnections`, `expiredRoomsCleaned`.
- Canonical room-started join error: `GAME_ALREADY_STARTED`.
- Development-only deterministic fixture for manual correct-guess verification is enabled only when `LOGIC_DUEL_ENABLE_FIXTURES=1`.
- Tile sort order is numeric ascending, with red before blue for equal numbers.
- `RoomView` must never expose opponent hidden tile colors or server-only tokens.
- New production behavior follows TDD: write failing tests, observe expected failure, implement minimal code, rerun tests.
- No commercial question-card text is copied; cards are original wording derived from public rule concepts.

---

## File Structure

- `logic-duel/package.json`: Node package metadata, scripts, dependency pins.
- `logic-duel/README.md`: local run, rules summary, verification, deploy, and operations notes.
- `logic-duel/server.js`: HTTP server, static files, `/healthz`, `/ws`, connection lifecycle.
- `logic-duel/src/game-core.js`: pure tile, hand, turn, guess, and scoring helpers.
- `logic-duel/src/questions.js`: question deck, answer functions, fixture deck helpers.
- `logic-duel/src/protocol.js`: message validation, error envelope, `RoomView` filtering.
- `logic-duel/src/rooms.js`: authoritative room store, actions, reconnect, cleanup, invariants.
- `logic-duel/public/index.html`: app shell.
- `logic-duel/public/styles.css`: responsive board and control styling.
- `logic-duel/public/app.js`: browser state, WebSocket client, UI rendering, user actions.
- `logic-duel/scripts/manual-checklist.js`: prints manual verification checklist and fixture instructions.
- `logic-duel/test/game-core.test.js`: pure rule tests.
- `logic-duel/test/questions.test.js`: deck and answer tests.
- `logic-duel/test/protocol.test.js`: validation and visibility tests.
- `logic-duel/test/rooms.test.js`: room lifecycle, turns, reconnect, cleanup, invariant tests.
- `logic-duel/test/integration.test.js`: HTTP and WebSocket integration tests.

## Frozen Interfaces

```js
// src/game-core.js
function createTiles()
function sortHand(hand)
function dealHands(tiles, handSize = 5, rng = Math.random)
function isSameTile(a, b)
function validateGuessTiles(tiles)
function isCorrectGuess(guess, targetHand)
function getPublicTile(tile)

// src/questions.js
function createQuestionDeck()
function answerQuestion(card, actorHand, targetHand, context = {})
function createFixtureHands()

// src/protocol.js
function validateClientMessage(raw)
function makeError(code, message, details = {})
function roomView(room, viewerPlayerId)
function publicEvent(type, payload = {})

// src/rooms.js
function createRoomStore(options = {})
store.createRoom({ playerName, now, enableFixture })
store.joinRoom({ roomId, playerName, now })
store.reconnect({ roomId, playerId, reconnectToken, now })
store.startGame({ roomId, playerId, now })
store.askQuestion({ roomId, playerId, cardId, now })
store.makeGuess({ roomId, playerId, guess, now })
store.leaveRoom({ roomId, playerId, now })
store.cleanupExpiredRooms(now)
store.getRoom(roomId)
store.getMetrics()
```

## Task 1: Scaffold App and Core Rules

**Files:**
- Create: `logic-duel/package.json`
- Create: `logic-duel/src/game-core.js`
- Create: `logic-duel/test/game-core.test.js`

**Interfaces:**
- Produces all `src/game-core.js` functions listed in Frozen Interfaces.
- Later tasks import `createTiles`, `sortHand`, `dealHands`, `isCorrectGuess`, and `getPublicTile`.

- [ ] **Step 1: Write failing core tests**

Create `logic-duel/test/game-core.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTiles,
  sortHand,
  dealHands,
  isCorrectGuess,
  validateGuessTiles,
  getPublicTile
} = require('../src/game-core');

test('createTiles creates 20 unique red and blue number tiles', () => {
  const tiles = createTiles();
  assert.equal(tiles.length, 20);
  assert.equal(new Set(tiles.map((tile) => `${tile.number}:${tile.color}`)).size, 20);
  assert.deepEqual(
    tiles.filter((tile) => tile.number === 0).map((tile) => tile.color).sort(),
    ['blue', 'red']
  );
});

test('sortHand orders by number with red before blue ties', () => {
  const sorted = sortHand([
    { number: 2, color: 'blue' },
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 9, color: 'blue' },
    { number: 7, color: 'red' }
  ]);
  assert.deepEqual(sorted, [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ]);
});

test('dealHands consumes deterministic rng and returns sorted hands', () => {
  const rngValues = [0.99, 0.01, 0.55, 0.25, 0.75, 0.33, 0.66, 0.12, 0.88, 0.44];
  const rng = () => rngValues.shift() ?? 0;
  const result = dealHands(createTiles(), 5, rng);
  assert.equal(result.players[0].length, 5);
  assert.equal(result.players[1].length, 5);
  assert.equal(result.remaining.length, 10);
  assert.deepEqual(result.players[0], sortHand(result.players[0]));
  assert.deepEqual(result.players[1], sortHand(result.players[1]));
});

test('validateGuessTiles accepts complete sorted tile identities', () => {
  const guess = [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ];
  assert.deepEqual(validateGuessTiles(guess), { ok: true, tiles: guess });
});

test('validateGuessTiles rejects duplicate or invalid tile identities', () => {
  assert.equal(validateGuessTiles([{ number: 1, color: 'green' }]).ok, false);
  assert.equal(validateGuessTiles([{ number: 1, color: 'red' }, { number: 1, color: 'red' }]).ok, false);
});

test('isCorrectGuess compares the full sorted target hand', () => {
  const hand = [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ];
  assert.equal(isCorrectGuess([...hand].reverse(), hand), true);
  assert.equal(isCorrectGuess(hand.slice(0, 4), hand), false);
  assert.equal(isCorrectGuess([{ number: 0, color: 'blue' }, ...hand.slice(1)], hand), false);
});

test('getPublicTile hides color when a tile is hidden', () => {
  assert.deepEqual(getPublicTile({ number: 4, color: 'red', revealed: false }), { number: 4, revealed: false });
  assert.deepEqual(getPublicTile({ number: 4, color: 'red', revealed: true }), { number: 4, color: 'red', revealed: true });
});
```

- [ ] **Step 2: Add package metadata and run the failing test**

Create `logic-duel/package.json` with scripts before running tests:

```json
{
  "name": "logic-duel-online",
  "version": "0.1.0",
  "private": true,
  "description": "Online multiplayer Logic Duel implementation",
  "main": "server.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/*.test.js",
    "test:unit": "node --test test/game-core.test.js test/questions.test.js test/protocol.test.js test/rooms.test.js",
    "test:integration": "node --test test/integration.test.js",
    "verify:manual": "node scripts/manual-checklist.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

Run: `cd logic-duel; npm test -- test/game-core.test.js`
Expected: FAIL with `Cannot find module '../src/game-core'`.

- [ ] **Step 3: Implement minimal core helpers**

Create `logic-duel/src/game-core.js` implementing the frozen interface and no server behavior.

- [ ] **Step 4: Run tests**

Run: `cd logic-duel; npm test -- test/game-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/package.json logic-duel/src/game-core.js logic-duel/test/game-core.test.js
git commit -m "Add logic duel core rules"
```

## Task 2: Question Deck and Fixture Hands

**Files:**
- Create: `logic-duel/src/questions.js`
- Create: `logic-duel/test/questions.test.js`

**Interfaces:**
- Consumes: `sortHand` from `src/game-core.js`.
- Produces: `createQuestionDeck`, `answerQuestion`, and `createFixtureHands`.

- [ ] **Step 1: Write failing deck tests**

Create `logic-duel/test/questions.test.js` with tests asserting:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuestionDeck, answerQuestion, createFixtureHands } = require('../src/questions');

test('createQuestionDeck returns at least 24 stable original question cards', () => {
  const deck = createQuestionDeck();
  assert.ok(deck.length >= 24);
  assert.equal(new Set(deck.map((card) => card.id)).size, deck.length);
  assert.ok(deck.every((card) => card.id && card.prompt && card.family));
  assert.ok(deck.every((card) => !/copy|copyright|official text/i.test(card.prompt)));
});

test('answerQuestion counts colors, parity, ranges, and sums deterministically', () => {
  const { actorHand, targetHand } = createFixtureHands();
  assert.deepEqual(answerQuestion({ family: 'color-count', color: 'red' }, actorHand, targetHand), { value: 3 });
  assert.deepEqual(answerQuestion({ family: 'parity-count', parity: 'even' }, actorHand, targetHand), { value: 3 });
  assert.deepEqual(answerQuestion({ family: 'range-count', min: 0, max: 4 }, actorHand, targetHand), { value: 3 });
  assert.deepEqual(answerQuestion({ family: 'sum' }, actorHand, targetHand), { value: 20 });
});

test('createFixtureHands provides the manual verification target hand', () => {
  const { targetHand } = createFixtureHands();
  assert.deepEqual(targetHand, [
    { number: 0, color: 'red', revealed: false },
    { number: 2, color: 'red', revealed: false },
    { number: 2, color: 'blue', revealed: false },
    { number: 7, color: 'red', revealed: false },
    { number: 9, color: 'blue', revealed: false }
  ]);
});
```

- [ ] **Step 2: Run failing test**

Run: `cd logic-duel; npm test -- test/questions.test.js`
Expected: FAIL with `Cannot find module '../src/questions'`.

- [ ] **Step 3: Implement deck and answer families**

Implement at least these families: `color-count`, `parity-count`, `range-count`, `sum`, `exact-number-count`, `adjacent-gap-count`, `low-high-balance`, and `revealed-count`.

- [ ] **Step 4: Run tests**

Run: `cd logic-duel; npm test -- test/game-core.test.js test/questions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/src/questions.js logic-duel/test/questions.test.js
git commit -m "Add logic duel question deck"
```

## Task 3: Protocol Validation and Visibility

**Files:**
- Create: `logic-duel/src/protocol.js`
- Create: `logic-duel/test/protocol.test.js`

**Interfaces:**
- Consumes room objects shaped by Task 4.
- Produces validation, error, event, and `RoomView` helpers for Tasks 4 and 5.

- [ ] **Step 1: Write failing protocol tests**

Create tests asserting valid messages for `createRoom`, `joinRoom`, `startGame`, `askQuestion`, `makeGuess`, `leaveRoom`, and `reconnect`; invalid JSON returns `INVALID_MESSAGE`; missing names return `NAME_REQUIRED`; unknown types return `INVALID_MESSAGE`; `roomView` hides opponent unrevealed colors and omits `reconnectToken`.

- [ ] **Step 2: Run failing test**

Run: `cd logic-duel; npm test -- test/protocol.test.js`
Expected: FAIL with `Cannot find module '../src/protocol'`.

- [ ] **Step 3: Implement validation and view filtering**

Implement `validateClientMessage(raw)`, `makeError(code, message, details)`, `publicEvent(type, payload)`, and `roomView(room, viewerPlayerId)`. The view must include `roomId`, `phase`, `ownerId`, `turnPlayerId`, `players`, `availableQuestions`, `currentQuestion`, `history`, `winnerPlayerId`, `expiresAt`, and `serverTime`.

- [ ] **Step 4: Run tests**

Run: `cd logic-duel; npm test -- test/protocol.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/src/protocol.js logic-duel/test/protocol.test.js
git commit -m "Add logic duel protocol contract"
```

## Task 4: Authoritative Room Store

**Files:**
- Create: `logic-duel/src/rooms.js`
- Create: `logic-duel/test/rooms.test.js`

**Interfaces:**
- Consumes: game core, questions, and protocol error helpers.
- Produces: room store used by `server.js`.

- [ ] **Step 1: Write failing room lifecycle tests**

Create tests covering create/join/start, owner-only start, room-full and game-started errors, out-of-turn rejection, question use/removal, failed guess history, correct guess winner, reconnect token validation, leave/disconnect marking, cleanup expiry, and metrics.

- [ ] **Step 2: Run failing test**

Run: `cd logic-duel; npm test -- test/rooms.test.js`
Expected: FAIL with `Cannot find module '../src/rooms'`.

- [ ] **Step 3: Implement store**

Implement in-memory rooms using cryptographically strong ids from `node:crypto`. Default room expiry is 30 minutes after last activity. Store reconnect tokens server-side and return them only from create/join/reconnect action results, never through `roomView`.

- [ ] **Step 4: Run tests**

Run: `cd logic-duel; npm test -- test/game-core.test.js test/questions.test.js test/protocol.test.js test/rooms.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/src/rooms.js logic-duel/test/rooms.test.js
git commit -m "Add logic duel room store"
```

## Task 5: HTTP and WebSocket Server

**Files:**
- Create: `logic-duel/server.js`
- Create: `logic-duel/test/integration.test.js`
- Modify: `logic-duel/package.json`

**Interfaces:**
- Consumes: `createRoomStore`, `validateClientMessage`, `roomView`.
- Produces: static app, `/healthz`, `/ws`, broadcast and direct response behavior.

- [ ] **Step 1: Write failing integration tests**

Create tests that start the server on port `0`, fetch `/healthz`, fetch `/`, connect two WebSocket clients to `/ws`, create a room, join it, start it, ask one question, make one failed guess, and verify both clients receive filtered `roomView` updates.

- [ ] **Step 2: Install dependency and run failing test**

Run: `cd logic-duel; npm install`
Run: `cd logic-duel; npm test -- test/integration.test.js`
Expected: FAIL with `Cannot find module '../server'` or missing static file.

- [ ] **Step 3: Implement server factory**

Export `createServer(options = {})` from `server.js`; when run directly, listen on `process.env.PORT || 3000`. Accept `LOGIC_DUEL_ENABLE_FIXTURES=1` for fixture room creation.

- [ ] **Step 4: Run tests**

Run: `cd logic-duel; npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/server.js logic-duel/test/integration.test.js logic-duel/package.json logic-duel/package-lock.json
git commit -m "Add logic duel multiplayer server"
```

## Task 6: Browser UI

**Files:**
- Create: `logic-duel/public/index.html`
- Create: `logic-duel/public/styles.css`
- Create: `logic-duel/public/app.js`

**Interfaces:**
- Consumes: server `RoomView` and client event envelopes.
- Produces: usable online multiplayer app with create, join, reconnect, start, ask, guess, leave, and status views.

- [ ] **Step 1: Write UI smoke expectations**

Add integration assertions that `/` contains `id="app"`, links `styles.css`, and loads `app.js`.

- [ ] **Step 2: Run failing integration test**

Run: `cd logic-duel; npm test -- test/integration.test.js`
Expected: FAIL because `public/index.html` is missing required shell.

- [ ] **Step 3: Implement frontend**

Implement compact responsive UI with accessible form controls, tile buttons, question list, guess builder, history, room code, player status, and reconnect token persistence in `localStorage`.

- [ ] **Step 4: Run tests and manually open app**

Run: `cd logic-duel; npm test`
Run: `cd logic-duel; npm start`
Open: `http://localhost:3000`
Expected: two browser tabs can create/join/start/play.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/public/index.html logic-duel/public/styles.css logic-duel/public/app.js logic-duel/test/integration.test.js
git commit -m "Add logic duel browser UI"
```

## Task 7: Docs and Manual Verification

**Files:**
- Create: `logic-duel/README.md`
- Create: `logic-duel/scripts/manual-checklist.js`

**Interfaces:**
- Consumes: all app commands.
- Produces: operational docs and executable manual checklist.

- [ ] **Step 1: Write failing script test through package command**

Add an integration assertion or direct script test that `node scripts/manual-checklist.js` exits `0` and prints `/healthz`, `/ws`, `LOGIC_DUEL_ENABLE_FIXTURES=1`, and the fixture target `0 red, 2 red, 2 blue, 7 red, 9 blue`.

- [ ] **Step 2: Run failing command**

Run: `cd logic-duel; node scripts/manual-checklist.js`
Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement docs and checklist**

Write README sections: install, run, test, fixture mode, gameplay rules, protocol notes, health/ops, deployment assumptions, and known limits.

- [ ] **Step 4: Run verification**

Run: `cd logic-duel; npm test`
Run: `cd logic-duel; npm run verify:manual`
Expected: PASS and checklist output.

- [ ] **Step 5: Commit**

```bash
git add logic-duel/README.md logic-duel/scripts/manual-checklist.js logic-duel/test/integration.test.js
git commit -m "Document logic duel verification"
```

## Task 8: Final Compliance Pass

**Files:**
- Modify only files needed to close test, spec, or review gaps.

**Interfaces:**
- Consumes the full branch implementation.
- Produces a verified branch ready for human playtest.

- [ ] **Step 1: Run full verification**

Run:

```bash
cd logic-duel
npm test
npm run verify:manual
node -e "const { createQuestionDeck } = require('./src/questions'); if (createQuestionDeck().length < 24) process.exit(1)"
```

Expected: all commands exit `0`.

- [ ] **Step 2: Spec traceability check**

Read `docs/superpowers/specs/logic-duel-online/06-traceability-and-plan-slices.md` and confirm requirements R01-R12 are implemented by files in `logic-duel/`.

- [ ] **Step 3: Security visibility check**

Run a direct script or test assertion that no `roomView` JSON contains `reconnectToken` or opponent hidden `color` fields.

- [ ] **Step 4: Commit any fixes**

```bash
git add logic-duel docs/superpowers/plans/2026-07-07-logic-duel-online-implementation.md
git commit -m "Complete logic duel online verification"
```

## Self-Review Notes

- R01-R12 coverage maps to Tasks 1-8: rules in Task 1, deck in Task 2, protocol/security in Task 3, rooms/invariants in Task 4, transport in Task 5, UX in Task 6, verification/ops in Task 7, final traceability in Task 8.
- C01-C17 verification maps to unit, integration, manual checklist, and final compliance tests across Tasks 1-8.
- Pauli review resolutions: `logic-duel/` is created in Task 1; canonical started-room join error is `GAME_ALREADY_STARTED`; manual correct-guess path uses `LOGIC_DUEL_ENABLE_FIXTURES=1`.
