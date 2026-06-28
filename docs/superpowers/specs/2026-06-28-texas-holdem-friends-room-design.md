# Texas Hold'em Friends Room Web MVP Design

## Summary

Build a mobile-first web app for private Texas Hold'em rooms. A host creates a room, shares an invite link, and friends join without accounts by entering a nickname. The app supports 2-6 player no-limit Texas Hold'em with virtual chips only.

The first release focuses on private friend rooms, not a public gaming platform. It has no real-money flow, no recharge, no withdrawal, no prizes, no public lobby, and no long-term account system.

## Goals

- Let a host create a private poker room and share it with friends.
- Let players join instantly without registration.
- Support real-time 2-6 player no-limit Texas Hold'em.
- Support cash-game and tournament room modes.
- Preserve each hand's action log for basic review.
- Keep the user experience usable on mobile browsers, including inside WeChat.
- Keep all game authority on the server so clients cannot inspect hidden cards or submit illegal actions.

## Non-Goals

- WeChat Mini Program release in the first version.
- Public matchmaking or public room list.
- Real-money settlement, recharge, withdrawal, rewards, prizes, or token exchange.
- Free-form text chat or voice chat.
- Long-term user accounts, friend lists, or global rankings.
- Advanced anti-collusion detection.
- AI opponents or training drills in the first version.

## Product Positioning

The app is a private entertainment and learning tool for friends. Copy and UI should use terms like "private room", "virtual chips", "review", and "practice". The app must avoid language that implies gambling, cash settlement, or external value.

## Room Creation

The host can create a room with these settings:

- Mode: cash game or tournament.
- Seats: 2-6.
- Initial chips.
- Blind levels.
- Action timer: finite duration or no timer.
- For tournaments: blind increases by either every X minutes or every X hands.

After creation, the host receives:

- Invite link: lets guests join as players or spectators.
- Host management link: grants host controls without requiring an account.

The host link acts as a secret capability. Anyone with that link can control the room as host, so the UI should warn the host to keep it private.

## Anonymous Identity

Users do not create accounts. When a browser first joins a room, the client receives a room-scoped participant token stored locally. That token lets the same browser reconnect to the same seat after refresh or temporary disconnection.

Rules:

- A single browser identity cannot occupy multiple seats in the same room.
- A player can refresh and return to their seat.
- A guest who loses local storage may rejoin as a spectator and ask the host for manual handling.
- Identity is room-scoped, not global.

## Room Modes

### Cash Game

- Players may join after the room has started if a seat is open.
- New seated players enter from the next hand.
- Blind levels do not automatically increase.
- If a player loses all chips, they may rebuy virtual chips without host approval.
- The system records each player's cumulative buy-in.
- End-of-room result uses:

```text
net result = final chips - cumulative buy-in
```

### Tournament

- Players may join seats only before the tournament starts.
- Once started, new guests can only spectate.
- Players who lose all chips are eliminated.
- Rebuy is not allowed.
- Blind levels increase according to host settings: every X minutes or every X hands.
- The system records elimination order and final rank.
- Tournament ends when one player remains with chips.

## Spectator Mode

Spectators can enter through the invite link without occupying a seat.

Spectators can see:

- Seats, nicknames, chip counts, and player status.
- Pot size and current bet.
- Public board cards.
- Public action log.
- Revealed showdown cards.
- Basic hand history for the room.

Spectators cannot see:

- Any unrevealed hole cards.
- Folded hands before showdown.
- Cards mucked without reveal.

Spectator seating rules:

- Cash game: a spectator may take an open seat and starts from the next hand.
- Tournament before start: a spectator may take an open seat and prepare.
- Tournament after start: a spectator cannot sit.

## Chat And Messages

The first version supports quick phrases and system messages only.

Quick phrases use ASCII internal keys and localized display labels:

- think: localized display label "thinking"
- nice_hand: localized display label "nice hand"
- well_played: localized display label "well played"
- another_hand: localized display label "one more hand"
- wait_for_me: localized display label "wait for me"
- back_now: localized display label "I'm back"

System messages cover:

- Player joined, seated, prepared, disconnected, reconnected, or left.
- Host paused, resumed, ended room, or handled a disconnected player.
- Hand started, street changed, blinds posted, blind level increased.
- Player action summaries.
- Tournament elimination and final result.

No free-form text chat and no voice chat in the first release.

## Host Controls

The host can:

- Start the room when minimum players are ready.
- Pause and resume the room.
- End the room.
- Handle disconnected players.
- Remove a disconnected player from a seat.
- Force the current disconnected player's hand to fold.

The host cannot:

- See hidden player cards.
- Change cards, chip balances, or hand results during an active hand.
- Approve or deny cash-game rebuy. Rebuy is self-service.

## Disconnection Handling

When an active player disconnects:

- The hand pauses.
- The table displays the disconnected status.
- The host chooses how to proceed.

Host options:

- Wait for reconnection.
- Fold the disconnected player's current hand.
- Remove the disconnected player from the seat after the hand is resolved or if they are not in the current hand.
- Pause the whole room.

If the disconnected player reconnects with the same participant token, they resume their seat.

## Game Rules

The game is no-limit Texas Hold'em.

Supported table size:

- Minimum active players to start a hand: 2.
- Maximum seats: 6.

Core hand flow:

1. Assign dealer button, small blind, and big blind.
2. Shuffle and deal two hole cards to each active player.
3. Preflop betting.
4. Flop.
5. Flop betting.
6. Turn.
7. Turn betting.
8. River.
9. River betting.
10. Showdown if needed.
11. Pot and side-pot settlement.
12. Record hand history.
13. Advance to next hand unless room ended.

The server must handle:

- Legal turn order.
- Valid fold, check, call, bet, raise, and all-in actions.
- Minimum raise rules.
- Main pot and side pots.
- Player all-in states.
- Early hand end when all but one player fold.
- Showdown hand evaluation.
- Dealer button movement across empty seats and eliminated players.

## Page Structure

### Home

Primary actions:

- Create room.
- Join by room code.

### Create Room

Fields:

- Mode: cash game or tournament.
- Seats: 2-6.
- Initial chips.
- Blind settings.
- Action timer.
- Tournament blind increase rule, shown only for tournament mode.

### Join Room

Flow:

- Open invite link or enter room code.
- Enter nickname.
- Choose to sit if allowed or spectate.
- If seated, mark ready.

### Table

Mobile-first table view:

- Seats arranged around a compact table.
- Current actor clearly highlighted.
- Player's own hole cards fixed near the bottom.
- Action controls fixed near the bottom.
- Pot, board, current bet, and blind level visible.
- Quick phrases and system log accessible without covering controls.

### Hand Result

Shown after each hand:

- Winner or winners.
- Pot distribution.
- Revealed hands.
- Short action timeline.
- Continue to next hand.

### Room Review

Shows basic hand history:

- Hand number.
- Board.
- Winners.
- Pot size.
- Action log.
- For cash game: chip delta and cumulative buy-in.
- For tournament: elimination events and final rank.

## Technical Architecture

Recommended stack:

- React and Next.js for the web UI and route structure.
- Node.js for the game server.
- WebSocket for real-time room communication.
- Redis for active room and hand state.
- PostgreSQL for durable hand history and room records.

High-level flow:

```text
Browser UI
  <-> WebSocket / HTTP
Node.js game server
  <-> Redis for live room state
  <-> PostgreSQL for hand history
```

The browser never connects directly to Redis or PostgreSQL.

## Server Authority

The server is authoritative for:

- Deck shuffle and card dealing.
- Hidden-card visibility.
- Turn order.
- Legal action validation.
- Bet sizing and chip accounting.
- Pot and side-pot settlement.
- Hand evaluation.
- Room-mode rules.

Clients submit intended actions only. The server validates each action, updates state, and broadcasts a filtered view to each participant.

## State And Visibility

The server must generate participant-specific table views.

Player view includes:

- Their own hole cards.
- Public table state.
- Revealed showdown cards.
- Legal actions available to them.

Other player and spectator views exclude unrevealed hole cards.

Host view has host controls but no extra card visibility.

## Real-Time Events

Client-to-server events:

- join_room
- claim_seat
- leave_seat
- set_ready
- start_room
- pause_room
- resume_room
- end_room
- player_action
- rebuy
- quick_phrase
- handle_disconnect

Server-to-client events:

- room_snapshot
- table_update
- private_cards
- legal_actions
- hand_started
- street_changed
- action_recorded
- hand_finished
- blind_level_changed
- player_disconnected
- player_reconnected
- player_eliminated
- room_finished
- system_message
- error

Every broadcast must be filtered by participant identity before delivery.

## Data Model

PostgreSQL records:

- rooms: room id, mode, settings, created time, ended time.
- room_participants: room id, display name, role, seat number, join time.
- hands: hand id, room id, hand number, button seat, blinds, board, started time, ended time.
- hand_players: hand id, participant id, seat, starting chips, ending chips, hole cards if revealable after hand end.
- hand_actions: hand id, sequence number, street, participant id, action type, amount, resulting stack, timestamp.
- pots: hand id, pot type, amount, eligible participants, winners.
- buy_ins: room id, participant id, amount, timestamp.
- tournament_results: room id, participant id, elimination order, final rank.

Redis records:

- Active room settings.
- Current seats and online status.
- Current hand state.
- Deck and hidden cards.
- Turn state and timers.
- Pending disconnection handling state.
- Recent event sequence number for reconnect sync.

## Basic Security

- Use unpredictable room ids and host tokens.
- Store host authority separately from invite authority.
- Use room-scoped participant tokens.
- Never expose hidden cards in generic room snapshots.
- Validate every action on the server.
- Reject actions from non-active players, spectators, wrong seats, and wrong turns.
- Rate-limit room creation, join attempts, quick phrases, and WebSocket messages.
- Avoid public room discovery.

## Compliance Guardrails

- Use virtual chips only.
- Do not support recharge, withdrawal, exchange, rewards, prizes, or settlement.
- Do not create public leaderboards based on chip winnings.
- Do not include copy that implies cash value or gambling profit.
- Do not provide public matchmaking in the first release.
- Keep rooms private and link-based.

## Testing Strategy

Unit tests:

- Deck creation and shuffle invariants.
- Hand ranking and tie splitting.
- Betting legality.
- Minimum raise rules.
- All-in and side-pot settlement.
- Dealer and blind movement.
- Cash-game rebuy accounting.
- Tournament elimination and blind increase.

Integration tests:

- Create room, join, sit, ready, start.
- Full hand flow with multiple players.
- Player disconnect and reconnect.
- Host handles disconnected player.
- Cash-game mid-room join from next hand.
- Tournament rejects new seats after start.
- Spectator visibility excludes hidden cards.

End-to-end tests:

- Two browsers join the same room and play a hand.
- Six-player table layout on mobile viewport.
- Host link controls appear only for host token.
- Refresh restores the same seat.

## MVP Acceptance Criteria

- A host can create and share a private 2-6 seat room.
- Friends can join without accounts by entering nicknames.
- A cash-game room can play consecutive hands with rebuy and cumulative buy-in tracking.
- A tournament room can play consecutive hands, increase blinds, eliminate players, and finish with a winner.
- Spectators can watch public information without seeing hidden cards.
- Quick phrases and system messages work.
- Active-player disconnection pauses the hand and lets the host decide how to proceed.
- Hand history is saved and can be reviewed.
- Server-side filtering prevents hidden cards from being exposed to other players, spectators, or host-only views.
