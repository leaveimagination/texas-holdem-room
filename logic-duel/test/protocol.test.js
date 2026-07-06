const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateClientMessage,
  makeError,
  publicEvent,
  roomView
} = require('../src/protocol');

test('validateClientMessage accepts supported client actions with normalized payloads', () => {
  const cases = [
    [
      { type: 'createRoom', requestId: 'req-1', payload: { name: ' Alice ' } },
      { type: 'createRoom', requestId: 'req-1', payload: { name: 'Alice' } }
    ],
    [
      { type: 'joinRoom', requestId: 'req-2', payload: { roomCode: ' ab12 ', name: ' Bob ' } },
      { type: 'joinRoom', requestId: 'req-2', payload: { roomCode: 'AB12', name: 'Bob' } }
    ],
    [
      { type: 'startGame', requestId: 'req-3', payload: { roomCode: 'room9' } },
      { type: 'startGame', requestId: 'req-3', payload: { roomCode: 'ROOM9' } }
    ],
    [
      { type: 'askQuestion', requestId: 'req-4', payload: { roomCode: 'ABCD', cardId: 'sum-all' } },
      { type: 'askQuestion', requestId: 'req-4', payload: { roomCode: 'ABCD', cardId: 'sum-all' } }
    ],
    [
      {
        type: 'makeGuess',
        requestId: 'req-5',
        payload: {
          roomCode: 'ABCD',
          tiles: [
            { number: 0, color: 'red' },
            { number: 1, color: 'blue' },
            { number: 2, color: 'red' },
            { number: 3, color: 'blue' },
            { number: 4, color: 'red' }
          ]
        }
      },
      {
        type: 'makeGuess',
        requestId: 'req-5',
        payload: {
          roomCode: 'ABCD',
          tiles: [
            { number: 0, color: 'red' },
            { number: 1, color: 'blue' },
            { number: 2, color: 'red' },
            { number: 3, color: 'blue' },
            { number: 4, color: 'red' }
          ]
        }
      }
    ],
    [
      { type: 'leaveRoom', requestId: 'req-6', payload: { roomCode: 'ABCD' } },
      { type: 'leaveRoom', requestId: 'req-6', payload: { roomCode: 'ABCD' } }
    ],
    [
      {
        type: 'reconnect',
        requestId: 'req-7',
        payload: { roomCode: ' abcd ', playerId: 'player_1', token: 'secret-token' }
      },
      {
        type: 'reconnect',
        requestId: 'req-7',
        payload: { roomCode: 'ABCD', playerId: 'player_1', token: 'secret-token' }
      }
    ]
  ];

  for (const [rawMessage, expected] of cases) {
    assert.deepEqual(validateClientMessage(JSON.stringify(rawMessage)), { ok: true, message: expected });
  }
});

test('validateClientMessage accepts submitGuess as the protocol spec alias', () => {
  assert.deepEqual(validateClientMessage(JSON.stringify({
    type: 'submitGuess',
    requestId: 'req-8',
    payload: {
      roomCode: 'ABCD',
      tiles: [
        { number: 0, color: 'red' },
        { number: 1, color: 'blue' },
        { number: 2, color: 'red' },
        { number: 3, color: 'blue' },
        { number: 4, color: 'red' }
      ]
    }
  })), {
    ok: true,
    message: {
      type: 'submitGuess',
      requestId: 'req-8',
      payload: {
        roomCode: 'ABCD',
        tiles: [
          { number: 0, color: 'red' },
          { number: 1, color: 'blue' },
          { number: 2, color: 'red' },
          { number: 3, color: 'blue' },
          { number: 4, color: 'red' }
        ]
      }
    }
  });
});

test('validateClientMessage rejects invalid JSON and unknown envelopes', () => {
  assert.deepEqual(validateClientMessage('{nope'), {
    ok: false,
    error: makeError('INVALID_MESSAGE', 'Invalid message.')
  });
  assert.deepEqual(validateClientMessage(JSON.stringify({ type: 'dance', requestId: 'req-1', payload: {} })), {
    ok: false,
    error: makeError('INVALID_MESSAGE', 'Invalid message.')
  });
});

test('validateClientMessage rejects missing player names with NAME_REQUIRED', () => {
  assert.deepEqual(validateClientMessage(JSON.stringify({
    type: 'createRoom',
    requestId: 'req-1',
    payload: { name: '   ' }
  })), {
    ok: false,
    error: makeError('NAME_REQUIRED', 'Name is required.')
  });
});

test('makeError and publicEvent produce stable server envelopes', () => {
  assert.deepEqual(makeError('GAME_ALREADY_STARTED', 'Game already started.'), {
    type: 'error',
    payload: {
      code: 'GAME_ALREADY_STARTED',
      message: 'Game already started.'
    }
  });
  assert.deepEqual(publicEvent('actionAccepted', { message: 'OK' }, 'req-1'), {
    type: 'actionAccepted',
    requestId: 'req-1',
    payload: { message: 'OK' }
  });
});

test('roomView hides opponent hand and reconnect tokens while playing', () => {
  const view = roomView(makeRoom('playing'), 'player_1');

  assert.equal(view.roomId, 'room-1');
  assert.equal(view.phase, 'playing');
  assert.equal(view.ownerId, 'player_1');
  assert.equal(view.turnPlayerId, 'player_2');
  assert.equal(typeof view.serverTime, 'string');
  assert.equal(JSON.stringify(view).includes('reconnectToken'), false);
  assert.equal('remainingTiles' in view, false);
  assert.deepEqual(view.players[0].hand, [
    { number: 0, color: 'red', revealed: false },
    { number: 1, color: 'blue', revealed: false }
  ]);
  assert.equal(view.players[1].hand, undefined);
  assert.equal(view.players[1].tileCount, 2);
});

test('roomView reveals both hands only after finish', () => {
  const view = roomView(makeRoom('finished'), 'player_1');

  assert.equal(view.winnerPlayerId, 'player_1');
  assert.deepEqual(view.players[1].hand, [
    { number: 2, color: 'red', revealed: false },
    { number: 3, color: 'blue', revealed: true }
  ]);
});

function makeRoom(phase) {
  return {
    id: 'room-1',
    code: 'ABCD',
    phase,
    ownerId: 'player_1',
    turnPlayerId: phase === 'playing' ? 'player_2' : null,
    players: [
      {
        id: 'player_1',
        name: 'Alice',
        connected: true,
        reconnectToken: 'alice-secret',
        hand: [
          { number: 0, color: 'red', revealed: false },
          { number: 1, color: 'blue', revealed: false }
        ]
      },
      {
        id: 'player_2',
        name: 'Bob',
        connected: true,
        reconnectToken: 'bob-secret',
        hand: [
          { number: 2, color: 'red', revealed: false },
          { number: 3, color: 'blue', revealed: true }
        ]
      }
    ],
    availableQuestions: [{ id: 'sum-all', prompt: 'Sum all tiles' }],
    currentQuestion: { id: 'sum-all', prompt: 'Sum all tiles' },
    history: [{ id: 1, type: 'questionAnswered', playerId: 'player_1' }],
    winnerPlayerId: phase === 'finished' ? 'player_1' : null,
    expiresAt: '2026-07-07T12:00:00.000Z',
    serverTime: '2026-07-07T11:00:00.000Z',
    remainingTiles: [{ number: 9, color: 'blue', revealed: false }]
  };
}
