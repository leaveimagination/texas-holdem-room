const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');

async function withServer(testFn, options = {}) {
  const app = createServer({ enableFixtures: true, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  try {
    await testFn({ ...app, baseUrl: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws` });
  } finally {
    await new Promise((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
  }
}

function openSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.testMessages = [];
    socket.testWaiters = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiterIndex = socket.testWaiters.findIndex((waiter) => !waiter.type || waiter.type === message.type);
      if (waiterIndex === -1) {
        socket.testMessages.push(message);
        return;
      }
      const [waiter] = socket.testWaiters.splice(waiterIndex, 1);
      waiter.resolve(message);
    });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket, type) {
  const queuedIndex = socket.testMessages.findIndex((message) => !type || message.type === type);
  if (queuedIndex !== -1) {
    const [message] = socket.testMessages.splice(queuedIndex, 1);
    return Promise.resolve(message);
  }
  return new Promise((resolve) => {
    socket.testWaiters.push({ type, resolve });
  });
}

function send(socket, type, requestId, payload) {
  socket.send(JSON.stringify({ type, requestId, payload }));
}

test('GET /healthz reports process and room metrics', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.version, 'string');
    assert.equal(typeof body.uptimeSeconds, 'number');
    assert.equal(body.activeRooms, 0);
    assert.equal(body.activeConnections, 0);
    assert.equal(body.expiredRoomsCleaned, 0);
  });
});

test('websocket clients can create, join, start, ask, and guess with filtered views', async () => {
  await withServer(async ({ wsUrl }) => {
    const alice = await openSocket(wsUrl);
    const bob = await openSocket(wsUrl);

    send(alice, 'createRoom', 'req-1', { name: 'Alice' });
    const created = await nextMessage(alice, 'roomCreated');
    assert.equal(created.requestId, 'req-1');
    assert.equal(created.payload.view.state, 'waiting');
    assert.equal(created.payload.view.self.name, 'Alice');
    assert.equal(created.payload.view.self.hand, null);

    send(bob, 'joinRoom', 'req-2', { roomCode: created.payload.roomCode, name: 'Bob' });
    const joined = await nextMessage(bob, 'roomJoined');
    assert.equal(joined.payload.view.opponent.name, 'Alice');
    await nextMessage(alice, 'roomUpdated');
    await nextMessage(bob, 'roomUpdated');

    send(alice, 'startGame', 'req-3', { roomCode: created.payload.roomCode });
    const startAccepted = await nextMessage(alice, 'actionAccepted');
    assert.equal(startAccepted.requestId, 'req-3');
    const aliceStarted = await nextMessage(alice, 'roomUpdated');
    const bobStarted = await nextMessage(bob, 'roomUpdated');
    assert.equal(aliceStarted.payload.view.self.hand.length, 5);
    assert.equal(aliceStarted.payload.view.opponent.hand, null);
    assert.equal(bobStarted.payload.view.self.hand.length, 5);
    assert.equal(bobStarted.payload.view.opponent.hand, null);

    const cardId = aliceStarted.payload.view.questionMarket[0].id;
    send(alice, 'askQuestion', 'req-4', { roomCode: created.payload.roomCode, cardId });
    const askAccepted = await nextMessage(alice, 'actionAccepted');
    assert.equal(askAccepted.requestId, 'req-4');
    const aliceAfterAsk = await nextMessage(alice, 'roomUpdated');
    await nextMessage(bob, 'roomUpdated');
    assert.equal(aliceAfterAsk.payload.view.history.at(-1).type, 'question');
    assert.equal(aliceAfterAsk.payload.view.isActivePlayer, false);

    send(bob, 'submitGuess', 'req-5', {
      roomCode: created.payload.roomCode,
      tiles: [
        { number: 0, color: 'red' },
        { number: 2, color: 'red' },
        { number: 2, color: 'blue' },
        { number: 7, color: 'red' },
        { number: 9, color: 'blue' }
      ]
    });
    const guessAccepted = await nextMessage(bob, 'actionAccepted');
    assert.equal(guessAccepted.requestId, 'req-5');
    const bobFinished = await nextMessage(bob, 'roomUpdated');
    const aliceFinished = await nextMessage(alice, 'roomUpdated');
    assert.equal(bobFinished.payload.view.state, 'finished');
    assert.equal(bobFinished.payload.view.opponent.hand.length, 5);
    assert.equal(aliceFinished.payload.view.opponent.hand.length, 5);

    alice.close();
    bob.close();
  });
});
