const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { createRoomStore } = require('./src/rooms');
const { validateClientMessage, publicEvent } = require('./src/protocol');

const VERSION = '0.1.0';

function createServer(options = {}) {
  const startedAt = Date.now();
  const store = options.store || createRoomStore(options.storeOptions || {});
  const enableFixtures = options.enableFixtures || process.env.LOGIC_DUEL_ENABLE_FIXTURES === '1';
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
  const maxPayloadBytes = options.maxPayloadBytes ?? 64 * 1024;
  const rateLimit = options.rateLimit || { maxMessages: 30, windowMs: 10_000 };
  const logger = options.logger || console;
  const clientsBySocket = new Map();
  const socketsByPlayer = new Map();
  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(() => runCleanup(), cleanupIntervalMs)
    : null;
  cleanupTimer?.unref?.();

  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      const metrics = store.getMetrics();
      writeJson(response, 200, {
        ok: true,
        status: 'ok',
        version: VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        ...metrics
      });
      return;
    }

    serveStatic(request, response, publicDir);
  });

  serverCleanupOnClose();

  const wss = new WebSocket.Server({ server, path: '/ws', maxPayload: maxPayloadBytes });

  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      const parsed = validateClientMessage(data.toString());
      if (!parsed.ok) {
        send(socket, parsed.error);
        return;
      }
      if (!allowMessage(socket)) {
        send(socket, publicEvent('error', {
          code: 'RATE_LIMITED',
          message: 'Too many messages.'
        }, parsed.message.requestId));
        return;
      }
      handleClientMessage(socket, parsed.message);
    });
    socket.on('error', () => {});

    socket.on('close', () => {
      const session = clientsBySocket.get(socket);
      clientsBySocket.delete(socket);
      if (!session) {
        return;
      }
      const activeSocket = socketsByPlayer.get(session.playerId);
      if (activeSocket === socket) {
        socketsByPlayer.delete(session.playerId);
        store.leaveRoom({ roomCode: session.roomCode, playerId: session.playerId });
        logger.log(`Room ${session.roomCode} disconnected player ${session.playerId}`);
        broadcastRoom(session.roomCode);
      }
    });
  });

  function handleClientMessage(socket, message) {
    runCleanup();
    const { type, requestId, payload } = message;
    const session = clientsBySocket.get(socket);
    let result;

    if (type === 'createRoom') {
      result = store.createRoom({ playerName: payload.name, enableFixture: enableFixtures });
      if (result.ok) {
        logger.log(`Room ${result.roomCode} created; players=1`);
        bindSocket(socket, result.roomCode, result.playerId);
        send(socket, publicEvent('roomCreated', resultPayload(result), requestId));
      } else {
        sendError(socket, result, requestId);
      }
      return;
    }

    if (type === 'joinRoom') {
      result = store.joinRoom({ roomCode: payload.roomCode, playerName: payload.name });
      if (result.ok) {
        logger.log(`Room ${result.roomCode} joined; players=2`);
        bindSocket(socket, result.roomCode, result.playerId);
        send(socket, publicEvent('roomJoined', resultPayload(result), requestId));
        broadcastRoom(result.roomCode);
      } else {
        sendError(socket, result, requestId);
      }
      return;
    }

    if (type === 'reconnect') {
      result = store.reconnect({
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        reconnectToken: payload.token
      });
      if (result.ok) {
        logger.log(`Room ${result.roomCode} reconnected`);
        bindSocket(socket, result.roomCode, result.playerId);
        send(socket, publicEvent('reconnected', { view: result.view }, requestId));
        broadcastRoom(result.roomCode);
      } else {
        sendError(socket, result, requestId);
      }
      return;
    }

    if (!session) {
      send(socket, publicEvent('error', {
        code: 'PLAYER_NOT_IN_ROOM',
        message: 'Player is not in this room.'
      }, requestId));
      return;
    }

    if (type === 'startGame') {
      result = store.startGame({ roomCode: payload.roomCode, playerId: session.playerId });
      if (result.ok) {
        logger.log(`Room ${payload.roomCode} started`);
      }
    } else if (type === 'askQuestion') {
      result = store.askQuestion({ roomCode: payload.roomCode, playerId: session.playerId, cardId: payload.cardId });
    } else if (type === 'makeGuess' || type === 'submitGuess') {
      result = store.makeGuess({ roomCode: payload.roomCode, playerId: session.playerId, guess: payload.tiles });
    } else if (type === 'leaveRoom') {
      result = store.leaveRoom({ roomCode: payload.roomCode, playerId: session.playerId });
    }

    if (!result?.ok) {
      sendError(socket, result, requestId);
      return;
    }

    send(socket, publicEvent('actionAccepted', { message: 'OK' }, requestId));
    broadcastRoom(payload.roomCode);
  }

  function runCleanup() {
    const cleaned = store.cleanupExpiredRooms();
    for (const roomCode of cleaned) {
      logger.log(`Expired room ${roomCode}`);
    }
    notifyExpiredRooms(cleaned);
  }

  function notifyExpiredRooms(roomCodes) {
    for (const roomCode of roomCodes) {
      for (const [socket, session] of [...clientsBySocket.entries()]) {
        if (session.roomCode !== roomCode) {
          continue;
        }
        send(socket, publicEvent('error', {
          code: 'ROOM_EXPIRED',
          message: 'Room expired.'
        }));
        clientsBySocket.delete(socket);
        if (socketsByPlayer.get(session.playerId) === socket) {
          socketsByPlayer.delete(session.playerId);
        }
        socket.close(4001, 'Room expired');
      }
    }
  }

  function serverCleanupOnClose() {
    server.once('close', () => {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
      }
    });
  }

  function allowMessage(socket) {
    const now = Date.now();
    const windowStartedAt = socket.rateWindowStartedAt || now;
    if (now - windowStartedAt >= rateLimit.windowMs) {
      socket.rateWindowStartedAt = now;
      socket.rateMessageCount = 1;
      return true;
    }
    socket.rateWindowStartedAt = windowStartedAt;
    socket.rateMessageCount = (socket.rateMessageCount || 0) + 1;
    return socket.rateMessageCount <= rateLimit.maxMessages;
  }

  function bindSocket(socket, roomCode, playerId) {
    const previous = socketsByPlayer.get(playerId);
    if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) {
      previous.close(4000, 'Reconnected from another socket');
    }
    clientsBySocket.set(socket, { roomCode, playerId });
    socketsByPlayer.set(playerId, socket);
  }

  function broadcastRoom(roomCode) {
    for (const [socket, session] of clientsBySocket.entries()) {
      if (session.roomCode === roomCode && socket.readyState === WebSocket.OPEN) {
        send(socket, publicEvent('roomUpdated', {
          view: store.getView(roomCode, session.playerId)
        }));
      }
    }
  }

  return { server, wss, store };
}

function resultPayload(result) {
  return {
    roomCode: result.roomCode,
    playerId: result.playerId,
    token: result.token,
    view: result.view
  };
}

function sendError(socket, result, requestId) {
  const error = result?.error || {
    code: 'INVALID_MESSAGE',
    message: 'Invalid message.'
  };
  send(socket, publicEvent('error', error, requestId));
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function serveStatic(request, response, publicDir) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const fileName = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
  const safePath = path.normalize(fileName).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath) });
    response.end(content);
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  return 'application/octet-stream';
}

if (require.main === module) {
  const { server } = createServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`Logic Duel server listening on ${port}`);
  });
}

module.exports = {
  createServer
};
