const { COLORS } = require('./game-core');

const MESSAGE_TYPES = new Set([
  'createRoom',
  'joinRoom',
  'startGame',
  'askQuestion',
  'makeGuess',
  'submitGuess',
  'leaveRoom',
  'reconnect'
]);

function makeError(code, message, details) {
  const payload = { code, message };
  if (details !== undefined) {
    payload.details = details;
  }
  return { type: 'error', payload };
}

function publicEvent(type, payload = {}, requestId) {
  const event = { type };
  if (requestId !== undefined) {
    event.requestId = requestId;
  }
  event.payload = payload;
  return event;
}

function validateClientMessage(raw) {
  let message;
  try {
    message = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return invalidMessage();
  }

  if (!isPlainObject(message) || !MESSAGE_TYPES.has(message.type) || typeof message.requestId !== 'string') {
    return invalidMessage();
  }

  if (!isPlainObject(message.payload)) {
    return invalidMessage();
  }

  const payload = message.payload;
  if (message.type === 'createRoom') {
    const name = normalizeName(payload.name);
    if (!name) {
      return nameRequired();
    }
    return validMessage(message, { name });
  }

  if (message.type === 'joinRoom') {
    const name = normalizeName(payload.name);
    if (!name) {
      return nameRequired();
    }
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode) {
      return invalidMessage();
    }
    return validMessage(message, { roomCode, name });
  }

  if (message.type === 'reconnect') {
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode || typeof payload.playerId !== 'string' || typeof payload.token !== 'string') {
      return invalidMessage();
    }
    return validMessage(message, {
      roomCode,
      playerId: payload.playerId,
      token: payload.token
    });
  }

  if (['startGame', 'leaveRoom'].includes(message.type)) {
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode) {
      return invalidMessage();
    }
    return validMessage(message, { roomCode });
  }

  if (message.type === 'askQuestion') {
    const roomCode = normalizeRoomCode(payload.roomCode);
    if (!roomCode || typeof payload.cardId !== 'string') {
      return invalidMessage();
    }
    return validMessage(message, { roomCode, cardId: payload.cardId });
  }

  const roomCode = normalizeRoomCode(payload.roomCode);
  const tiles = normalizeGuessTiles(payload.tiles);
  if (!roomCode || !tiles) {
    return {
      ok: false,
      error: makeError('INVALID_GUESS', 'Invalid guess.')
    };
  }
  return validMessage(message, { roomCode, tiles });
}

function roomView(room, viewerPlayerId) {
  const phase = room.phase ?? room.state;
  const players = normalizePlayers(room.players).map((player) => publicPlayer(player, viewerPlayerId, phase));

  return {
    roomId: room.id ?? room.roomId ?? room.code,
    code: room.code,
    phase,
    ownerId: room.ownerId,
    turnPlayerId: room.turnPlayerId ?? room.activePlayerId ?? null,
    players,
    availableQuestions: clonePublic(room.availableQuestions ?? room.questionMarket ?? []),
    currentQuestion: clonePublic(room.currentQuestion ?? null),
    history: clonePublic(room.history ?? []),
    winnerPlayerId: room.winnerPlayerId ?? room.winnerId ?? null,
    expiresAt: room.expiresAt ?? null,
    serverTime: room.serverTime ?? new Date().toISOString()
  };
}

function publicPlayer(player, viewerPlayerId, phase) {
  const publicPlayerView = {
    id: player.id,
    name: player.name,
    connected: player.connected === true,
    tileCount: Array.isArray(player.hand) ? player.hand.length : 0
  };

  if (phase === 'finished' || player.id === viewerPlayerId) {
    publicPlayerView.hand = clonePublic(player.hand ?? []);
  }

  return publicPlayerView;
}

function validMessage(message, payload) {
  return {
    ok: true,
    message: {
      type: message.type,
      requestId: message.requestId,
      payload
    }
  };
}

function invalidMessage() {
  return {
    ok: false,
    error: makeError('INVALID_MESSAGE', 'Invalid message.')
  };
}

function nameRequired() {
  return {
    ok: false,
    error: makeError('NAME_REQUIRED', 'Name is required.')
  };
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 24) {
    return null;
  }
  return trimmed;
}

function normalizeRoomCode(roomCode) {
  if (typeof roomCode !== 'string') {
    return null;
  }
  const normalized = roomCode.trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(normalized) ? normalized : null;
}

function normalizeGuessTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 5) {
    return null;
  }

  return tiles.every(isValidTile)
    ? tiles.map((tile) => ({ number: tile.number, color: tile.color }))
    : null;
}

function isValidTile(tile) {
  return isPlainObject(tile)
    && Number.isInteger(tile.number)
    && tile.number >= 0
    && tile.number <= 9
    && COLORS.includes(tile.color);
}

function normalizePlayers(players) {
  if (Array.isArray(players)) {
    return players;
  }
  if (players instanceof Map) {
    return [...players.values()];
  }
  if (isPlainObject(players)) {
    return Object.values(players);
  }
  return [];
}

function clonePublic(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  validateClientMessage,
  makeError,
  publicEvent,
  roomView
};
