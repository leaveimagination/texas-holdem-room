const crypto = require('node:crypto');
const { createTiles, dealHands, isCorrectGuess, validateGuessTiles, sortHand } = require('./game-core');
const { createQuestionDeck, answerQuestion, createFixtureHands } = require('./questions');
const { roomView } = require('./protocol');

const DEFAULT_EXPIRY_MS = 2 * 60 * 60 * 1000;

function createRoomStore(options = {}) {
  const rooms = new Map();
  const idFactory = options.idFactory || defaultIdFactory;
  const nowFactory = options.now || Date.now;
  const rng = options.rng || Math.random;
  const expiryMs = options.expiryMs || DEFAULT_EXPIRY_MS;
  const roomCodeAttempts = options.roomCodeAttempts || 16;
  const maxRooms = options.maxRooms || 1_000;
  let expiredRoomsCleaned = 0;

  function findRoom(roomCode) {
    return findRoomFromMap(rooms, roomCode);
  }

  function createRoom({ playerName, now = nowFactory(), enableFixture = false }) {
    const name = normalizeName(playerName);
    if (!name) {
      return failure('NAME_REQUIRED', 'Name is required.');
    }
    if (rooms.size >= maxRooms) {
      return failure('ROOM_LIMIT_REACHED', 'Room limit reached.');
    }

    const roomCode = allocateRoomCode();
    const playerId = nextId(idFactory, 'player');
    const token = nextId(idFactory, 'token');
    const player = {
      id: playerId,
      name,
      token,
      isOwner: true,
      connected: true,
      hand: null
    };
    const room = {
      code: roomCode,
      roomCode,
      id: roomCode,
      state: 'waiting',
      phase: 'waiting',
      players: [player],
      ownerId: playerId,
      activePlayerId: null,
      turnPlayerId: null,
      questionDeck: [],
      questionMarket: [],
      availableQuestions: [],
      history: [],
      winnerId: null,
      winnerPlayerId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + expiryMs,
      serverTime: new Date(now).toISOString(),
      nextHistoryId: 1,
      enableFixture
    };
    rooms.set(roomCode, room);
    return successWithSeat(room, player, token, now);
  }

  function joinRoom({ roomCode, playerName, now = nowFactory() }) {
    const room = findRoom(roomCode);
    if (!room) {
      return failure('ROOM_NOT_FOUND', 'Room not found.');
    }
    if (room.state === 'playing' || room.state === 'finished') {
      return failure(room.state === 'playing' ? 'GAME_ALREADY_STARTED' : 'GAME_FINISHED', 'Game already started.');
    }
    if (room.players.length >= 2) {
      return failure('ROOM_FULL', 'Room is full.');
    }

    const name = normalizeName(playerName);
    if (!name) {
      return failure('NAME_REQUIRED', 'Name is required.');
    }

    const playerId = nextId(idFactory, 'player');
    const token = nextId(idFactory, 'token');
    const player = {
      id: playerId,
      name,
      token,
      isOwner: false,
      connected: true,
      hand: null
    };
    room.players.push(player);
    touch(room, now, expiryMs);
    assertInvariants(room);
    return successWithSeat(room, player, token, now);
  }

  function reconnect({ roomCode, playerId, reconnectToken, now = nowFactory() }) {
    const room = findRoom(roomCode);
    if (!room) {
      return failure('ROOM_NOT_FOUND', 'Room not found.');
    }
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player || player.token !== reconnectToken) {
      return failure('INVALID_RECONNECT', 'Reconnect failed.');
    }
    player.connected = true;
    touch(room, now, expiryMs);
    assertInvariants(room);
    return {
      ok: true,
      roomCode: room.code,
      playerId: player.id,
      token: player.token,
      view: getView(room.code, player.id, now)
    };
  }

  function startGame({ roomCode, playerId, now = nowFactory() }) {
    const room = findRoom(roomCode);
    if (!room) {
      return failure('ROOM_NOT_FOUND', 'Room not found.');
    }
    if (room.state === 'playing') {
      return failure('GAME_ALREADY_STARTED', 'Game already started.');
    }
    if (room.state === 'finished') {
      return failure('GAME_FINISHED', 'Game is finished.');
    }
    if (room.ownerId !== playerId) {
      return failure('NOT_ROOM_OWNER', 'Only the owner can start.');
    }
    if (room.players.length !== 2) {
      return failure('NEED_TWO_PLAYERS', 'Two players are required.');
    }

    if (room.enableFixture) {
      const fixture = createFixtureHands();
      room.players[0].hand = fixture.targetHand.map(cloneTile);
      room.players[1].hand = fixture.actorHand.map(cloneTile);
    } else {
      const dealt = dealHands(createTiles(), 5, rng);
      room.players[0].hand = dealt.players[0];
      room.players[1].hand = dealt.players[1];
    }

    room.state = 'playing';
    room.phase = 'playing';
    room.activePlayerId = room.ownerId;
    room.turnPlayerId = room.ownerId;
    room.questionDeck = shuffle(createQuestionDeck().map(publicCard), rng);
    room.questionMarket = room.questionDeck.splice(0, 6);
    room.availableQuestions = room.questionMarket;
    addHistory(room, 'system', playerId, 'Game started.', now);
    touch(room, now, expiryMs);
    assertInvariants(room);
    return { ok: true, view: getView(room.code, playerId, now) };
  }

  function askQuestion({ roomCode, playerId, cardId, now = nowFactory() }) {
    const room = findRoom(roomCode);
    const precheck = checkActionRoom(room, playerId);
    if (!precheck.ok) {
      return precheck;
    }
    const cardIndex = room.questionMarket.findIndex((card) => card.id === cardId);
    if (cardIndex === -1) {
      return failure('CARD_NOT_AVAILABLE', 'Question is not available.');
    }

    const actor = getPlayer(room, playerId);
    const target = getOpponent(room, playerId);
    const [card] = room.questionMarket.splice(cardIndex, 1);
    const answer = answerQuestion(card, actor.hand, target.hand);
    if (room.questionDeck.length > 0) {
      room.questionMarket.push(room.questionDeck.shift());
    }
    room.availableQuestions = room.questionMarket;
    addHistory(room, 'question', playerId, `${actor.name} asked: ${card.text} Answer: ${answer.display}.`, now);
    passTurn(room, playerId);
    touch(room, now, expiryMs);
    assertInvariants(room);
    return { ok: true, answer, view: getView(room.code, playerId, now) };
  }

  function makeGuess({ roomCode, playerId, guess, now = nowFactory() }) {
    const room = findRoom(roomCode);
    const precheck = checkActionRoom(room, playerId);
    if (!precheck.ok) {
      return precheck;
    }
    const validated = validateGuessTiles(guess);
    if (!validated.ok || validated.tiles.length !== 5) {
      return failure('INVALID_GUESS', 'Invalid guess.');
    }

    const actor = getPlayer(room, playerId);
    const target = getOpponent(room, playerId);
    const correct = isCorrectGuess(validated.tiles, target.hand);
    if (correct) {
      room.state = 'finished';
      room.phase = 'finished';
      room.winnerId = playerId;
      room.winnerPlayerId = playerId;
      room.activePlayerId = null;
      room.turnPlayerId = null;
      addHistory(room, 'result', playerId, `${actor.name} made the correct guess.`, now);
    } else {
      addHistory(room, 'guess', playerId, `${actor.name} guessed ${formatGuess(validated.tiles)}.`, now);
      passTurn(room, playerId);
    }
    touch(room, now, expiryMs);
    assertInvariants(room);
    return { ok: true, correct, view: getView(room.code, playerId, now) };
  }

  function leaveRoom({ roomCode, playerId, now = nowFactory() }) {
    const room = findRoom(roomCode);
    if (!room) {
      return failure('ROOM_NOT_FOUND', 'Room not found.');
    }
    const player = getPlayer(room, playerId);
    if (!player) {
      return failure('PLAYER_NOT_IN_ROOM', 'Player is not in this room.');
    }
    player.connected = false;
    touch(room, now, expiryMs);
    assertInvariants(room);
    return { ok: true, view: getView(room.code, playerId, now) };
  }

  function cleanupExpiredRooms(now = nowFactory()) {
    const cleaned = [];
    for (const [code, room] of rooms.entries()) {
      const inactiveLongEnough = now - room.updatedAt > expiryMs;
      const playingWithConnection = room.state === 'playing' && room.players.some((player) => player.connected);
      if (inactiveLongEnough && !playingWithConnection) {
        rooms.delete(code);
        cleaned.push(code);
      }
    }
    expiredRoomsCleaned += cleaned.length;
    return cleaned;
  }

  function getRoom(roomCode) {
    return findRoom(roomCode);
  }

  function getView(roomCode, playerId, now = nowFactory()) {
    const room = findRoom(roomCode);
    if (!room) {
      return null;
    }
    room.serverTime = new Date(now).toISOString();
    const baseView = roomView(room, playerId);
    return {
      ...baseView,
      state: baseView.phase,
      self: buildSelfOpponentView(room, playerId).self,
      opponent: buildSelfOpponentView(room, playerId).opponent,
      isOwner: room.ownerId === playerId,
      isActivePlayer: room.activePlayerId === playerId,
      activePlayerName: getPlayer(room, room.activePlayerId)?.name ?? null,
      questionMarket: baseView.availableQuestions,
      winnerName: getPlayer(room, room.winnerId)?.name ?? null
    };
  }

  function getMetrics() {
    return {
      activeRooms: rooms.size,
      activeConnections: [...rooms.values()].reduce((sum, room) => (
        sum + room.players.filter((player) => player.connected).length
      ), 0),
      expiredRoomsCleaned
    };
  }

  return {
    createRoom,
    joinRoom,
    reconnect,
    startGame,
    askQuestion,
    makeGuess,
    leaveRoom,
    cleanupExpiredRooms,
    getRoom,
    getView,
    getMetrics
  };

  function allocateRoomCode() {
    for (let attempt = 0; attempt < roomCodeAttempts; attempt += 1) {
      const roomCode = nextId(idFactory, 'room').toUpperCase();
      if (!rooms.has(roomCode)) {
        return roomCode;
      }
    }
    throw new Error('Unable to allocate a unique room code.');
  }
}

function checkActionRoom(room, playerId) {
  if (!room) {
    return failure('ROOM_NOT_FOUND', 'Room not found.');
  }
  if (room.state === 'waiting') {
    return failure('GAME_NOT_STARTED', 'Game has not started.');
  }
  if (room.state === 'finished') {
    return failure('GAME_FINISHED', 'Game is finished.');
  }
  if (!getPlayer(room, playerId)) {
    return failure('PLAYER_NOT_IN_ROOM', 'Player is not in this room.');
  }
  if (room.activePlayerId !== playerId) {
    return failure('OUT_OF_TURN', 'It is not your turn.');
  }
  return { ok: true };
}

function buildSelfOpponentView(room, playerId) {
  const self = getPlayer(room, playerId);
  const opponent = getOpponent(room, playerId);
  return {
    self: self ? publicSeat(room, self, true) : null,
    opponent: opponent ? publicSeat(room, opponent, false) : null
  };
}

function publicSeat(room, player, isSelf) {
  const view = {
    id: player.id,
    name: player.name,
    isOwner: player.isOwner,
    connected: player.connected
  };
  if (room.state === 'waiting') {
    view.hand = null;
    if (!isSelf) {
      view.tileCount = 0;
    }
    return view;
  }
  if (isSelf || room.state === 'finished') {
    view.hand = player.hand ? player.hand.map(cloneTile) : null;
  } else {
    view.hand = null;
    view.tileCount = player.hand?.length ?? 0;
  }
  return view;
}

function successWithSeat(room, player, token, now) {
  assertInvariants(room);
  return {
    ok: true,
    roomCode: room.code,
    playerId: player.id,
    token,
    view: createRoomStoreView(room, player.id, now)
  };
}

function createRoomStoreView(room, playerId, now) {
  room.serverTime = new Date(now).toISOString();
  const baseView = roomView(room, playerId);
  const { self, opponent } = buildSelfOpponentView(room, playerId);
  return {
    ...baseView,
    state: baseView.phase,
    self,
    opponent,
    isOwner: room.ownerId === playerId,
    isActivePlayer: room.activePlayerId === playerId,
    activePlayerName: getPlayer(room, room.activePlayerId)?.name ?? null,
    questionMarket: baseView.availableQuestions,
    winnerName: getPlayer(room, room.winnerId)?.name ?? null
  };
}

function touch(room, now, expiryMs = DEFAULT_EXPIRY_MS) {
  room.updatedAt = Math.max(room.updatedAt, now);
  room.expiresAt = room.updatedAt + expiryMs;
  room.serverTime = new Date(now).toISOString();
}

function addHistory(room, type, actorId, text, createdAt) {
  room.history.push({
    id: room.nextHistoryId,
    type,
    actorId,
    text,
    createdAt
  });
  room.nextHistoryId += 1;
}

function passTurn(room, playerId) {
  const opponent = getOpponent(room, playerId);
  room.activePlayerId = opponent.id;
  room.turnPlayerId = opponent.id;
}

function getPlayer(room, playerId) {
  return room?.players.find((player) => player.id === playerId) ?? null;
}

function getOpponent(room, playerId) {
  return room.players.find((player) => player.id !== playerId) ?? null;
}

function findRoomCode(roomCode) {
  return String(roomCode ?? '').trim().toUpperCase();
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 24 ? trimmed : null;
}

function findRoomFromMap(rooms, roomCode) {
  return rooms.get(findRoomCode(roomCode)) ?? null;
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function nextId(idFactory, prefix) {
  return idFactory(prefix);
}

function defaultIdFactory(prefix) {
  if (prefix === 'room') {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function shuffle(items, rng = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function publicCard(card) {
  return {
    id: card.id,
    text: card.text,
    prompt: card.prompt ?? card.text,
    family: card.family,
    params: { ...(card.params || {}) },
    answerType: card.answerType
  };
}

function cloneTile(tile) {
  return {
    number: tile.number,
    color: tile.color,
    revealed: tile.revealed === true
  };
}

function formatGuess(tiles) {
  return tiles.map((tile) => `${tile.number} ${tile.color}`).join(', ');
}

function assertInvariants(room) {
  if (room.players.length < 0 || room.players.length > 2) {
    throw new Error('Invariant I01 failed.');
  }
  if (!room.players.some((player) => player.id === room.ownerId)) {
    throw new Error('Invariant I03 failed.');
  }
  if (room.state === 'waiting' && room.players.some((player) => player.hand !== null)) {
    throw new Error('Invariant I04 failed.');
  }
  if (room.state === 'playing') {
    if (room.players.length !== 2 || room.players.some((player) => !Array.isArray(player.hand) || player.hand.length !== 5)) {
      throw new Error('Invariant I05 failed.');
    }
    const keys = room.players.flatMap((player) => player.hand.map((tile) => `${tile.number}:${tile.color}`));
    if (new Set(keys).size !== keys.length) {
      throw new Error('Invariant I07 failed.');
    }
    for (const player of room.players) {
      const sorted = sortHand(player.hand);
      if (JSON.stringify(sorted) !== JSON.stringify(player.hand)) {
        throw new Error('Invariant I05 sort failed.');
      }
    }
  }
  if (room.state === 'finished' && !room.players.some((player) => player.id === room.winnerId)) {
    throw new Error('Invariant I06 failed.');
  }
  if (room.questionMarket.length > 6) {
    throw new Error('Invariant I08 failed.');
  }
  if (room.activePlayerId !== null && !room.players.some((player) => player.id === room.activePlayerId)) {
    throw new Error('Invariant I10 failed.');
  }
  for (let index = 1; index < room.history.length; index += 1) {
    if (room.history[index].id <= room.history[index - 1].id) {
      throw new Error('Invariant I12 failed.');
    }
  }
}

module.exports = {
  createRoomStore
};
