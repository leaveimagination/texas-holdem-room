# Logic Duel Online - Game Rules And State

Date: 2026-07-07
Status: v3.3, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

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

Runtime invariants that involve these models are canonical in `07-operations-and-invariants.md`.


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
