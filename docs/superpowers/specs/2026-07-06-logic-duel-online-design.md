# Logic Duel Online Design

Date: 2026-07-06

## Goal

Build an online multiplayer browser game inspired by the deduction tabletop game "Logic Duel". The first version should let two players create or join a room, play a complete hidden-information deduction match in real time, and run locally with a deployment-friendly Node.js structure.

## Scope

The first version supports two-player rooms only. Players enter a nickname, create a room to receive a room code, or join an existing room by code. The room owner starts the game once two players are present.

The app does not include accounts, matchmaking, persistent statistics, chat, spectators, AI opponents, or public lobby browsing. These are intentionally outside the first version so hidden information and real-time gameplay can be reliable.

## Architecture

The app lives in a new `logic-duel/` directory.

The backend is a Node.js server that serves static frontend assets and hosts a WebSocket endpoint. It owns all authoritative game state: rooms, players, deck order, hands, question cards, turn state, history, and win/loss results.

The frontend is plain HTML, CSS, and JavaScript. It renders the current player's visible state, sends user actions over the WebSocket, and never receives the opponent's hidden tiles until the game ends.

No build step is required for the frontend. `npm start` starts the server, and users open the local URL in a browser. The server will read a `PORT` environment variable so it can run locally or on common Node hosting platforms that support WebSockets.

## Game Model

Tiles consist of two colored sets, `red` and `blue`, of the numbers 0 through 9, for 20 total tiles. Each player receives 5 tiles. A player's hand is sorted by ascending number, with `red` before `blue` as the fixed color tiebreaker for duplicate numbers.

At game start, the server shuffles tiles, deals hands, removes unused tiles from play, shuffles question cards, and reveals six public question cards. The active player may ask one revealed question or submit a complete guess of the opponent's five tiles.

Asking a question causes the server to calculate the answer from the opponent's hidden hand, add the public result to history, discard the used question card, reveal a replacement if available, and pass the turn.

Guessing requires the player to submit five ordered tile guesses, each with a number and color. A correct guess ends the game and reveals both hands. An incorrect guess is recorded publicly and the turn passes.

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

## Room And Connection Flow

A player can create a room or join by code. On first connection, the server assigns a player id and the frontend stores a reconnect token in local storage. If the same browser refreshes, it may reconnect to the same seat while the room is still active.

A room has these states:

- `waiting`: one or two players are present, game has not started.
- `playing`: two players are playing a match.
- `finished`: a winner exists and hidden hands are revealed.

Only the room owner can start the match. If a player disconnects during a match, the other player sees a disconnected status. The game state remains in memory so a browser refresh can recover. Cross-device account-based recovery is out of scope.

Rooms are in memory for the first version. They may expire after inactivity to avoid stale server state.

## Visibility Rules

The server sends each player a filtered view:

- The player sees their own full hand.
- The player sees only the opponent's tile count before the game ends.
- Both players see public question cards, turn state, room state, public history, and game result.
- Both hands are revealed only after the game finishes.

All client actions are validated server-side. A client cannot ask a missing card, act out of turn, start without two players, guess with malformed tiles, or join a full room.

## Interface

The first screen is the playable game surface, not a landing page.

The layout has four main areas:

- Room panel: nickname, room code, players, connection state, start/new game controls.
- Table panel: current turn, six public question cards, and action feedback.
- Player panel: own hand, opponent placeholder tiles, and ordered guess controls.
- History panel: public questions, answers, failed guesses, final result, and a local notes textarea.

The visual style should feel like a clean tabletop tool: compact, readable, and focused on deduction. Cards and tiles should have stable dimensions so the interface does not shift during play. Desktop browsers are the primary target; the layout should remain usable on narrow screens.

## Error Handling

The server returns structured error messages for invalid actions. The frontend displays concise inline messages and keeps the user in the room.

Expected error cases include invalid room code, duplicate or full room, missing nickname, start attempted by a non-owner, start attempted before two players join, out-of-turn actions, stale question card selection, malformed guesses, and disconnected WebSocket.

The client should try to reconnect automatically after short connection drops. If reconnect fails, it should keep the room code visible so the player can retry manually.

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

## Future Extensions

Likely follow-up improvements include three- or four-player variants, AI opponent mode, shareable deployment, persistent room links, spectator mode with delayed reveal rules, better reconnect across devices, and a fuller question deck.
