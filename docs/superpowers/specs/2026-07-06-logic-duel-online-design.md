# Logic Duel Online Design

Date: 2026-07-06
Status: v2.1, bilingual implementation-ready draft

Language note: English is the canonical contract for code-facing names, message types, field names, and error codes. The Chinese section mirrors the product and engineering intent for review and planning. When this spec changes, update both sections in the same commit.

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

---

# 逻辑对决线上版设计

日期：2026-07-06
状态：v2.1，双语实现就绪草案

语言说明：英文部分是面向代码的权威契约，尤其是消息类型、字段名、错误码和协议结构。中文部分用于产品、设计和工程意图审阅。之后更新 spec 时，两种语言必须在同一次提交中同步更新。

## Spec 维护规则

这份 spec 是线上多人第一版的事实来源。实现过程中发现更好的决策、隐藏边界或歧义时，应持续更新它。

更新规则：

- 如果实现时发现行为不明确，先更新 spec，再写对应行为。
- 如果测试暴露“预期”和“实现”不一致，先决定是改测试还是改 spec，再改生产代码。
- 如果某个功能决定延后，要写进“未来扩展”或“范围外”，不要让它停留在默认假设里。
- 如果协议消息变化，必须在同一个变更里更新 `WebSocket Protocol`。
- 如果验证时发现缺口，要先补验收标准或测试要求，再宣称功能完成。

## 目标

构建一个受桌游“逻辑对决”启发的线上多人浏览器游戏。第一版应允许两名玩家创建或加入房间，实时进行一局完整的隐藏信息推理对局，并能在本地以便于部署的 Node.js 结构运行。

## 范围

第一版只支持双人房间。玩家输入昵称，可以创建房间获得房间码，也可以通过房间码加入已有房间。房主在两名玩家都入座后开始游戏。

应用不包含账号、匹配、持久化统计、聊天、观战、AI 对手或公开大厅。这些能力刻意不放进第一版，以便先把隐藏信息和实时玩法做可靠。

## 范围外

第一版不支持：

- 三人或四人变体。
- 公开匹配、房间列表或邀请发现。
- 用户账号、密码或持久化个人资料。
- 跨设备重连。
- 观战模式。
- 聊天、表情互动或桌边聊天工具。
- 服务端重启后的状态持久化。
- 超出“服务端隐藏信息和动作校验”之外的反作弊。
- 商业卡牌完整文本或商业规则书原文复制。

## 架构

应用放在新的 `logic-duel/` 目录中。

后端是一个 Node.js 服务，同时提供静态前端资源和 WebSocket 端点。它拥有所有权威游戏状态：房间、玩家、牌堆顺序、手牌、问题卡、回合状态、历史记录和胜负结果。

前端使用纯 HTML、CSS 和 JavaScript。它渲染当前玩家可见的状态，通过 WebSocket 发送用户动作，并且在游戏结束前永远不会收到对手隐藏牌。

前端不需要构建步骤。`npm start` 启动服务，用户在浏览器打开本地 URL。服务端读取 `PORT` 环境变量，以便本地运行或部署到常见支持 WebSocket 的 Node 托管平台。

## 文件结构

第一版实现默认使用以下结构，除非实现计划阶段出现更好的理由：

- `logic-duel/package.json`：脚本和依赖。
- `logic-duel/server.js`：HTTP 服务和 WebSocket 接线。
- `logic-duel/src/game-core.js`：纯游戏规则，不依赖网络或 DOM。
- `logic-duel/src/rooms.js`：房间生命周期、玩家座位、重连 token、服务端动作校验。
- `logic-duel/src/protocol.js`：消息名、payload 校验辅助、视图过滤辅助。
- `logic-duel/public/index.html`：游戏主界面。
- `logic-duel/public/styles.css`：布局和视觉样式。
- `logic-duel/public/app.js`：WebSocket 客户端和 DOM 渲染。
- `logic-duel/test/*.test.js`：Node 测试套件。

纯游戏核心必须能在不启动服务器的情况下被测试直接调用。

## 数据模型

使用普通 JavaScript 对象。实现中可以加入辅助函数，但对外有意义的字段应保持稳定。

`Tile`：

- `number`：0 到 9 的整数。
- `color`：`red` 或 `blue`。

`Player`：

- `id`：服务端生成的座位稳定 id。
- `name`：清理后的显示名，1 到 24 个可见字符。
- `token`：加入房间的浏览器保存的重连密钥。
- `isOwner`：布尔值。
- `connected`：布尔值。
- `hand`：游戏开始后持有的 5 张 `Tile`。

`QuestionCard`：

- `id`：稳定字符串。
- `text`：可安全展示给双方的文本。
- `params`：可选结构化参数，供答案函数使用。
- `answerType`：`number`、`boolean`、`tileNumber`、`tileColor` 或 `text`。

`HistoryEntry`：

- `id`：房间内单调递增整数。
- `type`：`question`、`guess`、`system` 或 `result`。
- `actorId`：当记录来自玩家动作时，对应玩家 id。
- `text`：公开显示文本。
- `createdAt`：服务端毫秒时间戳。

`Room`：

- `code`：短的大写房间码。
- `state`：`waiting`、`playing` 或 `finished`。
- `players`：最多 2 个 `Player`。
- `ownerId`：房主玩家 id。
- `activePlayerId`：`playing` 状态下当前行动玩家 id。
- `questionDeck`：未揭示的 `QuestionCard` 数组。
- `questionMarket`：最多 6 张已揭示 `QuestionCard`。
- `history`：有序 `HistoryEntry` 数组。
- `winnerId`：正确猜测后的获胜玩家 id。
- `createdAt`：服务端毫秒时间戳。
- `updatedAt`：服务端毫秒时间戳。

在 `waiting` 或 `playing` 阶段，不得把对手 `hand` 放进任何客户端房间视图。

## 游戏模型

数字牌由两套颜色 `red` 和 `blue` 组成，每套数字 0 到 9，共 20 张。每名玩家获得 5 张。玩家手牌按数字升序排列；相同数字时，`red` 固定排在 `blue` 前面。

游戏开始时，服务端洗数字牌、发手牌、移除未使用牌、洗问题卡，并揭示 6 张公共问题卡。当前玩家可以询问一张已揭示问题卡，或提交一次对手 5 张牌的完整猜测。

询问问题时，服务端根据对手隐藏手牌计算答案，将公开结果加入历史，弃掉已用问题卡，如果还有牌则补一张，然后切换回合。

猜测时，玩家必须提交 5 张有序牌，每张包含数字和颜色。猜对则游戏结束并揭示双方手牌；猜错则公开记录本次尝试并切换回合。

## 游戏规则细节

房间设置：

- 房间码由服务端生成，应便于读出来，例如 4 到 6 位大写字母或数字。
- 一个房间最多接受两个玩家座位。
- 只有正好两个座位都有人时，房主才能开始。

回合规则：

- 只有当前行动玩家可以询问问题或提交猜测。
- 双人版本中，问题总是针对对手。
- 已使用的问题卡从 `questionMarket` 移除。
- 如果 `questionDeck` 还有卡，补一张使市场回到 6 张。
- 如果牌堆已空，则继续使用更少数量的可见问题卡。
- 询问问题或猜错后，`activePlayerId` 切换为对手。
- 猜对后，房间进入 `finished`，不再接受任何游戏动作。

猜测规则：

- 猜测必须包含正好 5 张有序牌。
- 每张猜测牌必须有合法数字和颜色。
- 允许数字重复，因为真实牌组中不同颜色可以有相同数字。
- 只有 5 个位置的数字和颜色全部匹配时才算正确。
- 猜错时只公开“猜错”结果，并可在历史中展示本次公开猜测序列。

## 问题卡

第一版内置一套可玩的自定义问题卡，不复制商业规则书。卡牌类型应是确定性的、能从手牌中直接计算，并且对推理有帮助。

初始牌组类型：

- 统计某种颜色的牌数。
- 统计奇数或偶数数量。
- 统计大于或小于某阈值的数字数量。
- 报告所有数字之和。
- 报告某个数字是否存在。
- 报告某个位置的数字。
- 报告某个位置的颜色。
- 报告是否存在相邻连续数字。
- 报告某个数字区间内的牌数。

每张卡有稳定 id、展示文本和答案函数。服务端计算答案；客户端只展示卡牌文本和公开结果。

初始牌组至少应有 24 张卡，避免多局过于重复。可以用同一类型搭配不同参数，例如“0-4 有几张？”和“5-9 有几张？”作为两张不同卡。

答案展示规则：

- 布尔答案展示为 `Yes` 或 `No`。
- 数字答案展示为数字。
- 位置问题在 UI 文本中使用从 1 开始的位置。
- 服务端结构化存储答案值，同时在历史里记录人类可读的 `text`。

## 房间与连接流程

玩家可以创建房间或通过房间码加入。首次连接时，服务端分配 player id，前端把 reconnect token 存到 local storage。如果同一个浏览器刷新，并且房间仍然活跃，可以用 token 重连回原座位。

房间有以下状态：

- `waiting`：已有一名或两名玩家，游戏未开始。
- `playing`：两名玩家正在对局。
- `finished`：已有胜者，隐藏手牌已揭示。

只有房主可以开始游戏。如果玩家在对局中断线，另一名玩家能看到断线状态。游戏状态保留在内存中，使浏览器刷新可以恢复。跨设备账号式恢复不在范围内。

第一版房间保存在内存中。等待和结束房间 2 小时无活动后过期。进行中房间只有在双方都断线 2 小时后才过期。

## 状态机

按房间状态允许的动作：

`waiting`：

- `createRoom`：房间不存在前允许。
- `joinRoom`：房间未满时允许。
- `startGame`：仅房主且已有两名玩家时允许。
- `askQuestion`：拒绝。
- `submitGuess`：拒绝。

`playing`：

- `joinRoom`：如果会创建第三个座位则拒绝；有效 token 重连允许。
- `startGame`：拒绝。
- `askQuestion`：仅当前行动玩家允许。
- `submitGuess`：仅当前行动玩家允许。
- `leave` 或断线：标记玩家断线，但保留房间状态。

`finished`：

- `askQuestion`：拒绝。
- `submitGuess`：拒绝。
- `startGame`：对已结束对局拒绝。
- `createRoom`：可创建另一个新房间。
- 重连允许，便于玩家查看结果。

所有被拒绝的动作都返回 `error` 消息，并且不改变权威状态。

## WebSocket 协议

消息是 JSON 对象。每个客户端到服务端消息都有：

- `type`：字符串动作名。
- `requestId`：客户端生成的字符串，用于关联响应。
- `payload`：对象。

每个服务端到客户端消息都有：

- `type`：字符串事件名。
- `requestId`：适用时复制触发请求的 request id。
- `payload`：对象。

客户端到服务端消息类型和 payload：

- `createRoom`：payload `{ "name": "Alice" }`
- `joinRoom`：payload `{ "roomCode": "ABCD", "name": "Bob" }`
- `reconnect`：payload `{ "roomCode": "ABCD", "playerId": "...", "token": "..." }`
- `startGame`：payload `{ "roomCode": "ABCD" }`
- `askQuestion`：payload `{ "roomCode": "ABCD", "cardId": "sum-all" }`
- `submitGuess`：payload `{ "roomCode": "ABCD", "tiles": [{ "number": 1, "color": "red" }] }`

完整客户端消息示例：

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

服务端到客户端消息类型和 payload：

- `roomCreated`：返回 `{ "roomCode": "...", "playerId": "...", "token": "...", "view": RoomView }`
- `roomJoined`：返回 `{ "roomCode": "...", "playerId": "...", "token": "...", "view": RoomView }`
- `reconnected`：返回 `{ "view": RoomView }`
- `roomUpdated`：向每个已连接玩家广播 `{ "view": RoomView }`，每个玩家收到的 view 都按自身权限过滤。
- `actionAccepted`：返回 `{ "message": "..." }`，用于结果主要通过 `roomUpdated` 体现的动作。
- `error`：返回 `{ "code": "OUT_OF_TURN", "message": "It is not your turn." }`

完整服务端错误示例：

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

`RoomView` 是客户端唯一用于渲染的房间状态形状。它包含：

- `code`
- `state`
- `self`：当前玩家 id、名字、房主标记、连接标记，以及发牌后的完整手牌。
- `opponent`：对手 id、名字、连接标记、牌数，并且只有 `state` 为 `finished` 时包含完整手牌。
- `isOwner`
- `isActivePlayer`
- `activePlayerName`
- `questionMarket`
- `history`
- `winnerName`
- `errorMessage`：可选临时 UI 提示。

客户端必须只渲染 `RoomView`，不能依赖原始 `Room`。

## 错误码

使用稳定错误码，使测试和 UI 不需要匹配提示文案：

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

错误消息应简短、可读。

## 可见性规则

服务端给每个玩家发送过滤后的视图：

- 玩家能看到自己的完整手牌。
- 游戏结束前，玩家只能看到对手牌数。
- 双方都能看到公共问题卡、回合状态、房间状态、公共历史和游戏结果。
- 只有游戏结束后，双方手牌才会同时揭示。

所有客户端动作都必须由服务端校验。客户端不能询问不存在的卡、不能越权行动、不能在不足两人时开始、不能提交畸形猜测、不能加入已满房间。

## 可见性矩阵

`waiting` 阶段：

- 玩家可见自己的名字、对手名字（若存在）、房间码、房主状态和连接状态。
- 此时还没有手牌和问题卡。

`playing` 阶段：

- 玩家可见自己的完整手牌。
- 玩家可见对手名字、连接状态和牌数。
- 玩家不可见对手牌的数字、颜色或已移除未使用牌。
- 双方都可见问题市场、公共历史、当前行动玩家和失败猜测历史。

`finished` 阶段：

- 双方都可见双方完整手牌、胜者、历史和最终结果。

本地开发时服务端日志可以包含完整状态，但面向生产的客户端消息不得泄露隐藏状态。

## 界面

第一屏就是可玩的游戏桌面，不做落地页。

布局包含四个主要区域：

- 房间面板：昵称、房间码、玩家、连接状态、开始/新游戏控制。
- 桌面面板：当前回合、6 张公共问题卡、动作反馈。
- 玩家面板：自己的手牌、对手占位牌、按顺序填写的猜测控件。
- 历史面板：公开问题、答案、失败猜测、最终结果和本地笔记区。

视觉风格应像一个清爽的桌游工具台：紧凑、易读、专注推理。卡牌和数字牌要有稳定尺寸，避免操作时布局跳动。优先桌面浏览器体验，但窄屏也应可用。

## 用户体验要求

UI 应让合法下一步动作非常明显：

- 两名玩家未到齐时禁用开始按钮，或显示明确原因。
- 非当前回合时禁用问题卡和猜测提交。
- 用玩家名字显示当前轮到谁。
- 显示双方连接状态。
- 房间码应便于复制。
- 本地笔记区在正常重新渲染时不得丢失内容。
- 游戏结束时显示最终揭示区域。

UI 不应依赖大段说明文字解释所有控件。优先用标签、禁用状态、工具提示和简短状态文本承载交互。

## 错误处理

服务端对非法动作返回结构化错误消息。前端显示简短行内提示，并让用户留在房间中。

预期错误包括：无效房间码、重复或满员房间、昵称缺失、非房主开始、未满两人开始、越权行动、过期问题卡选择、畸形猜测和 WebSocket 断开。

客户端应在短暂连接中断后自动尝试重连。如果重连失败，应保留房间码可见，方便玩家手动重试。

## 安全与公平性

第一版面向友好对局，不面向强对抗公网环境。即便如此，服务端也必须保护隐藏信息并拒绝非法动作。

最低保护：

- `finished` 前绝不向客户端发送对手手牌或未使用牌。
- 把所有客户端 payload 当作不可信输入。
- 服务端校验房间码、玩家座位、重连 token、回合归属、卡牌可用性和猜测形状。
- 用足够熵生成重连 token，满足友好场景。
- 同一 token 的第二个标签页不能创建第三个座位。

已知限制：

- 玩家可以检查自己浏览器里的状态和网络消息。
- 服务端重启会丢失内存状态。
- 没有账号身份、封禁系统、回放审计或洗牌公平性的密码学证明。

## 测试

核心游戏逻辑应与 WebSocket 传输隔离，并在写实现代码前用自动化测试覆盖。

必须覆盖的单元测试：

- 数字牌创建、洗牌/发牌形状、手牌排序。
- 问题卡答案函数。
- 猜测校验和胜负判断。
- 询问问题和猜错后的回合切换。
- 对局中隐藏对手手牌的可见性过滤。

必须覆盖的集成测试：

- 创建房间、加入房间、开始游戏。
- 询问问题并收到同步公共历史。
- 提交错误猜测和正确猜测。
- 拒绝越权或畸形动作。

手动验证应包括：打开两个浏览器标签页，一个创建房间，另一个加入，完成若干回合，刷新其中一个标签页，并完成一局游戏。

## 验收标准

第一版完成必须满足以下所有条件：

- 在 `logic-duel/` 中 `npm install` 和 `npm start` 可用。
- 两个浏览器标签页可以通过房间码创建和加入同一房间。
- 两名玩家未到齐时，房主不能开始。
- 开始游戏后，每名玩家获得 5 张排序后的牌，并揭示 6 张问题卡。
- 每个标签页能看到自己的手牌，并且在对局中看不到对手手牌。
- 当前行动玩家可以询问一张可见问题卡，两个标签页都能在历史中看到公开答案。
- 已使用问题卡离开市场，并在牌堆有卡时补牌。
- 当前行动玩家可以提交错误猜测，历史记录该行为，并切换回合。
- 当前行动玩家可以提交正确猜测，游戏结束，显示胜者，并揭示双方手牌。
- 越权、畸形、过期卡牌和满房间动作都用稳定错误码拒绝。
- 对局中刷新一个标签页可以通过 local storage 重连回同一座位。
- 自动化测试覆盖要求的单元和集成行为。
- 最终实现总结中记录已完成双标签页手动验证。

## 决策日志

- 2026-07-06：选择独立 `logic-duel/` 应用，而不是修改现有 `demo/`，因为这是独立产品界面。
- 2026-07-06：选择 Node.js + WebSocket，因为游戏需要实时房间，并且可部署到常见 Node 托管平台。
- 2026-07-06：v1 限制为双人，以便先把隐藏信息、回合流和重连做扎实。
- 2026-07-06：使用原创问题牌组，借鉴推理机制，但不复制商业卡牌文本。
- 2026-07-06：v1 使用内存房间，降低设置复杂度；持久化延后。
- 2026-07-06：使用同浏览器重连 token，而不是账号系统，以轻量支持刷新恢复。

## 未来扩展

可能的后续改进包括三人或四人变体、AI 对手、可分享部署、持久房间链接、带延迟揭示规则的观战模式、跨设备重连，以及更完整的问题牌组。
