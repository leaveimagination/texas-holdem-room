# Logic Duel Online - Overview And Agent Contract

Date: 2026-07-07
Status: v3.2, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Spec Index

This document is the source of truth for the first online multiplayer version of Logic Duel.

- Product intent: `Objective`, `Users And Journeys`, `Scope`, `Out Of Scope`
- Agent contract: `Spec Maintenance`, `Three-Tier Boundaries`, `Commands`, `Project Structure`, `Code Style`, `Git Workflow`
- Game contract: `Game Model`, `Question Cards`, `State Machine`, `Room And Connection Flow`
- Network contract: `WebSocket Protocol`, `RoomView Contract`, `Error Codes`
- Safety contract: `Visibility Rules`, `Visibility Matrix`, `Security And Fair Play`
- UI contract: `Interface`, `UX Requirements`, `Accessibility And Responsive Requirements`
- Verification contract: `Testing Strategy`, `Conformance Cases`, `Manual Verification`, `Acceptance Criteria`
- Traceability contract: `Requirement Traceability`, `Implementation Slices`, `Review Checkpoints`
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
| Ask first | Create new sub-specs, rename existing sub-specs, or move canonical ownership of a section. |
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
