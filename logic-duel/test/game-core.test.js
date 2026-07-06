const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTiles,
  sortHand,
  dealHands,
  isCorrectGuess,
  validateGuessTiles,
  getPublicTile
} = require('../src/game-core');

test('createTiles creates 20 unique red and blue number tiles', () => {
  const tiles = createTiles();
  assert.equal(tiles.length, 20);
  assert.equal(new Set(tiles.map((tile) => `${tile.number}:${tile.color}`)).size, 20);
  assert.deepEqual(
    tiles.filter((tile) => tile.number === 0).map((tile) => tile.color).sort(),
    ['blue', 'red']
  );
});

test('sortHand orders by number with red before blue ties', () => {
  const sorted = sortHand([
    { number: 2, color: 'blue' },
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 9, color: 'blue' },
    { number: 7, color: 'red' }
  ]);
  assert.deepEqual(sorted, [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ]);
});

test('dealHands consumes deterministic rng and returns sorted hands', () => {
  const rngValues = [0.99, 0.01, 0.55, 0.25, 0.75, 0.33, 0.66, 0.12, 0.88, 0.44];
  const rng = () => rngValues.shift() ?? 0;
  const result = dealHands(createTiles(), 5, rng);
  assert.equal(result.players[0].length, 5);
  assert.equal(result.players[1].length, 5);
  assert.equal(result.remaining.length, 10);
  assert.deepEqual(result.players[0], sortHand(result.players[0]));
  assert.deepEqual(result.players[1], sortHand(result.players[1]));
});

test('validateGuessTiles accepts complete sorted tile identities', () => {
  const guess = [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ];
  assert.deepEqual(validateGuessTiles(guess), { ok: true, tiles: guess });
});

test('validateGuessTiles rejects duplicate or invalid tile identities', () => {
  assert.equal(validateGuessTiles([{ number: 1, color: 'green' }]).ok, false);
  assert.equal(validateGuessTiles([{ number: 1, color: 'red' }, { number: 1, color: 'red' }]).ok, false);
});

test('isCorrectGuess compares the full sorted target hand', () => {
  const hand = [
    { number: 0, color: 'red' },
    { number: 2, color: 'red' },
    { number: 2, color: 'blue' },
    { number: 7, color: 'red' },
    { number: 9, color: 'blue' }
  ];
  assert.equal(isCorrectGuess([...hand].reverse(), hand), true);
  assert.equal(isCorrectGuess(hand.slice(0, 4), hand), false);
  assert.equal(isCorrectGuess([{ number: 0, color: 'blue' }, ...hand.slice(1)], hand), false);
});

test('getPublicTile hides color when a tile is hidden', () => {
  assert.deepEqual(getPublicTile({ number: 4, color: 'red', revealed: false }), { number: 4, revealed: false });
  assert.deepEqual(getPublicTile({ number: 4, color: 'red', revealed: true }), { number: 4, color: 'red', revealed: true });
});
