# Logic Duel Online - Operations And Invariants

Date: 2026-07-07
Status: v3.3, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Runtime Invariants

These invariants must hold after every accepted room mutation and after every rejected action unless explicitly noted.

| ID | Invariant |
|---|---|
| I01 | A room has 0 to 2 players. |
| I02 | A room has exactly one owner while it exists. |
| I03 | `ownerId` always matches an existing player id. |
| I04 | `waiting` rooms have no dealt hands and no active player. |
| I05 | `playing` rooms have exactly two players, each with 5 sorted tiles. |
| I06 | `finished` rooms have `winnerId` set to an existing player id. |
| I07 | No `Tile` appears in more than one player hand. |
| I08 | `questionMarket.length` is at most 6. |
| I09 | A `QuestionCard.id` appears at most once across `questionMarket` and `questionDeck`. |
| I10 | `activePlayerId` is either `null` or an existing player id. |
| I11 | During `playing`, `activePlayerId` references a seated player, even if that player's socket is currently disconnected. |
| I12 | `history.id` values are strictly increasing within a room. |
| I13 | Rejected actions do not change room state, except connection-related bookkeeping for disconnects. |
| I14 | Filtered `RoomView` for `playing` never contains opponent hand or unused tiles. |
| I15 | `updatedAt` never moves backwards. |

Invariant tests should run through representative accepted and rejected actions, not just static fixtures.

## Test Fixtures

Use these fixtures for deterministic unit and conformance tests.

Fixture hand A:

```js
[
  { number: 0, color: "red" },
  { number: 2, color: "blue" },
  { number: 2, color: "red" },
  { number: 7, color: "red" },
  { number: 9, color: "blue" }
]
```

Sorted fixture hand A must become:

```js
[
  { number: 0, color: "red" },
  { number: 2, color: "red" },
  { number: 2, color: "blue" },
  { number: 7, color: "red" },
  { number: 9, color: "blue" }
]
```

Fixture hand B:

```js
[
  { number: 1, color: "blue" },
  { number: 3, color: "red" },
  { number: 4, color: "blue" },
  { number: 6, color: "red" },
  { number: 8, color: "blue" }
]
```

Expected answers for sorted fixture hand A:

| Question Family | Params | Expected |
|---|---|---|
| Count color | `{ color: "red" }` | `3` |
| Count color | `{ color: "blue" }` | `2` |
| Count odd | `{ parity: "odd" }` | `2` |
| Count even | `{ parity: "even" }` | `3` |
| Greater than | `{ threshold: 5 }` | `2` |
| Less than | `{ threshold: 5 }` | `3` |
| Sum all | `{}` | `20` |
| Has number | `{ number: 2 }` | `true` |
| Has number | `{ number: 5 }` | `false` |
| Number at position | `{ position: 1 }` | `0` |
| Color at position | `{ position: 3 }` | `"blue"` |
| Has adjacent consecutive | `{}` | `false` |
| Count range | `{ min: 2, max: 7 }` | `3` |

If implementation uses different internal question ids, tests should still cover these families and expected answers.

## Health And Observability

The server must expose:

- `GET /healthz`: returns HTTP 200 and JSON `{ "ok": true }` when the process is running.

Logging rules:

- Log server start with port.
- Log room creation with room code and player count, but not reconnect tokens.
- Log joins, starts, disconnects, reconnects, and room expiry.
- Do not log full hands by default.
- Do not log reconnect tokens.
- Development-only debug logs may include additional state only behind an explicit local flag such as `DEBUG_LOG_STATE=1`.

The spec does not require metrics, tracing, or external logging services in version 1.

## Cleanup And Expiry

Room cleanup must be deterministic enough to test.

Rules:

- Waiting rooms expire after 2 hours of inactivity.
- Finished rooms expire after 2 hours of inactivity.
- Playing rooms expire after 2 hours only if both players are disconnected.
- Cleanup may run on an interval or opportunistically during room actions.
- Cleanup must not remove an active playing room with at least one connected player.

Tests should use injectable time or a room-store cleanup function that accepts `nowMs`.

## Deployment Contract

README deployment notes must include:

- Required Node version: 20 or newer.
- Required install command: `npm install`.
- Required start command: `npm start`.
- Environment variable: `PORT`, optional with default `3000`.
- Health check path: `/healthz`.
- WebSocket support requirement.
- In-memory limitation: rooms disappear on process restart.

Deployment is acceptable when:

- Static app loads over HTTP.
- WebSocket connects to `/ws` on the same host.
- `GET /healthz` returns 200.
- Two remote clients can complete the manual verification flow.

## Done Checklist

Before implementation is marked complete:

- All invariants have automated coverage or a documented reason in the final summary.
- Fixture answers are covered in unit tests.
- `GET /healthz` is implemented and tested.
- README includes deployment contract.
- Final summary states whether any runtime invariant remains untested.
