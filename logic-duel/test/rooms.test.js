const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../src/rooms');

function createStartedRoom(options = {}) {
  const store = createRoomStore({
    idFactory: (() => {
      const ids = ['ROOM1', 'player_a', 'token_a', 'player_b', 'token_b'];
      return () => ids.shift();
    })(),
    now: () => 1_000,
    ...options
  });

  const created = store.createRoom({ playerName: 'Alice', now: 1_000, enableFixture: true });
  const joined = store.joinRoom({ roomCode: created.roomCode, playerName: 'Bob', now: 2_000 });
  const started = store.startGame({ roomCode: created.roomCode, playerId: created.playerId, now: 3_000 });
  assert.equal(started.ok, true);

  return { store, created, joined, roomCode: created.roomCode };
}

test('createRoom creates a waiting owner seat with a reconnect token', () => {
  const store = createRoomStore({
    idFactory: (() => {
      const ids = ['ROOM1', 'player_a', 'token_a'];
      return () => ids.shift();
    })()
  });

  const result = store.createRoom({ playerName: ' Alice ', now: 1_000 });

  assert.equal(result.ok, true);
  assert.equal(result.roomCode, 'ROOM1');
  assert.equal(result.playerId, 'player_a');
  assert.equal(result.token, 'token_a');
  assert.equal(result.view.state, 'waiting');
  assert.equal(result.view.self.name, 'Alice');
  assert.equal(result.view.self.isOwner, true);
});

test('joinRoom rejects started rooms with GAME_ALREADY_STARTED', () => {
  const { store, roomCode } = createStartedRoom();

  const result = store.joinRoom({ roomCode, playerName: 'Cara', now: 4_000 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GAME_ALREADY_STARTED');
});

test('startGame requires the owner and two seated players', () => {
  const store = createRoomStore({
    idFactory: (() => {
      const ids = ['ROOM1', 'player_a', 'token_a', 'player_b', 'token_b'];
      return () => ids.shift();
    })()
  });
  const created = store.createRoom({ playerName: 'Alice', now: 1_000 });
  const early = store.startGame({ roomCode: created.roomCode, playerId: created.playerId, now: 2_000 });
  assert.equal(early.ok, false);
  assert.equal(early.error.code, 'NEED_TWO_PLAYERS');

  const joined = store.joinRoom({ roomCode: created.roomCode, playerName: 'Bob', now: 3_000 });
  const nonOwner = store.startGame({ roomCode: created.roomCode, playerId: joined.playerId, now: 4_000 });
  assert.equal(nonOwner.ok, false);
  assert.equal(nonOwner.error.code, 'NOT_ROOM_OWNER');
});

test('startGame deals fixture hands, opens up to six questions, and makes owner active', () => {
  const { store, created, joined, roomCode } = createStartedRoom();
  const room = store.getRoom(roomCode);

  assert.equal(room.state, 'playing');
  assert.equal(room.activePlayerId, created.playerId);
  assert.equal(room.players[0].hand.length, 5);
  assert.equal(room.players[1].hand.length, 5);
  assert.ok(room.questionMarket.length > 0);
  assert.ok(room.questionMarket.length <= 6);

  const ownerView = store.getView(roomCode, created.playerId);
  const guestView = store.getView(roomCode, joined.playerId);
  assert.equal(ownerView.self.hand.length, 5);
  assert.equal(ownerView.opponent.hand, null);
  assert.equal(guestView.self.hand.length, 5);
  assert.equal(guestView.opponent.hand, null);
});

test('askQuestion answers, records public history, removes card, and passes turn', () => {
  const { store, created, joined, roomCode } = createStartedRoom();
  const room = store.getRoom(roomCode);
  const cardId = room.questionMarket[0].id;

  const result = store.askQuestion({ roomCode, playerId: created.playerId, cardId, now: 4_000 });

  assert.equal(result.ok, true);
  assert.equal(store.getRoom(roomCode).activePlayerId, joined.playerId);
  assert.equal(store.getRoom(roomCode).history.at(-1).type, 'question');
  assert.equal(store.getRoom(roomCode).questionMarket.some((card) => card.id === cardId), false);
});

test('askQuestion rejects out of turn and stale cards without mutating room state', () => {
  const { store, created, joined, roomCode } = createStartedRoom();
  const before = JSON.stringify(store.getRoom(roomCode));

  const outOfTurn = store.askQuestion({ roomCode, playerId: joined.playerId, cardId: 'missing', now: 4_000 });
  assert.equal(outOfTurn.ok, false);
  assert.equal(outOfTurn.error.code, 'OUT_OF_TURN');
  assert.equal(JSON.stringify(store.getRoom(roomCode)), before);

  const stale = store.askQuestion({ roomCode, playerId: created.playerId, cardId: 'missing', now: 4_000 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'CARD_NOT_AVAILABLE');
});

test('makeGuess passes turn on failure and finishes on correct guess', () => {
  const { store, created, joined, roomCode } = createStartedRoom();

  const failed = store.makeGuess({
    roomCode,
    playerId: created.playerId,
    guess: [
      { number: 0, color: 'blue' },
      { number: 1, color: 'blue' },
      { number: 3, color: 'red' },
      { number: 4, color: 'blue' },
      { number: 6, color: 'red' }
    ],
    now: 4_000
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.correct, false);
  assert.equal(store.getRoom(roomCode).activePlayerId, joined.playerId);

  const correct = store.makeGuess({
    roomCode,
    playerId: joined.playerId,
    guess: [
      { number: 0, color: 'red' },
      { number: 2, color: 'red' },
      { number: 2, color: 'blue' },
      { number: 7, color: 'red' },
      { number: 9, color: 'blue' }
    ],
    now: 5_000
  });
  assert.equal(correct.ok, true);
  assert.equal(correct.correct, true);
  assert.equal(store.getRoom(roomCode).state, 'finished');
  assert.equal(store.getRoom(roomCode).winnerId, joined.playerId);
});

test('reconnect validates token and does not create a new seat', () => {
  const { store, created, roomCode } = createStartedRoom();
  const invalid = store.reconnect({
    roomCode,
    playerId: created.playerId,
    reconnectToken: 'wrong',
    now: 4_000
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_RECONNECT');

  const valid = store.reconnect({
    roomCode,
    playerId: created.playerId,
    reconnectToken: created.token,
    now: 5_000
  });
  assert.equal(valid.ok, true);
  assert.equal(store.getRoom(roomCode).players.length, 2);
});

test('cleanup removes inactive waiting rooms and keeps active playing rooms', () => {
  const store = createRoomStore({
    idFactory: (() => {
      const ids = ['WAIT1', 'player_a', 'token_a', 'PLAY1', 'player_b', 'token_b', 'player_c', 'token_c'];
      return () => ids.shift();
    })(),
    expiryMs: 7_200_000
  });
  const waiting = store.createRoom({ playerName: 'Alice', now: 1_000 });
  const playing = store.createRoom({ playerName: 'Bob', now: 2_000, enableFixture: true });
  store.joinRoom({ roomCode: playing.roomCode, playerName: 'Cara', now: 3_000 });
  store.startGame({ roomCode: playing.roomCode, playerId: playing.playerId, now: 4_000 });

  const cleaned = store.cleanupExpiredRooms(7_204_001);

  assert.deepEqual(cleaned, ['WAIT1']);
  assert.equal(store.getRoom(waiting.roomCode), null);
  assert.notEqual(store.getRoom(playing.roomCode), null);
});

test('getMetrics reports room and cleanup counts', () => {
  const store = createRoomStore({
    idFactory: (() => {
      const ids = ['ROOM1', 'player_a', 'token_a'];
      return () => ids.shift();
    })()
  });
  store.createRoom({ playerName: 'Alice', now: 1_000 });
  assert.deepEqual(store.getMetrics(), {
    activeRooms: 1,
    activeConnections: 1,
    expiredRoomsCleaned: 0
  });
});
