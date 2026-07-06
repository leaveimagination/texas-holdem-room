const COLORS = ['red', 'blue'];
const COLOR_ORDER = new Map([
  ['red', 0],
  ['blue', 1]
]);

function createTiles() {
  const tiles = [];
  for (let number = 0; number <= 9; number += 1) {
    for (const color of COLORS) {
      tiles.push({ number, color });
    }
  }
  return tiles;
}

function normalizeTile(tile) {
  return {
    number: tile.number,
    color: tile.color,
    revealed: tile.revealed === true
  };
}

function sortHand(hand) {
  return [...hand].sort((left, right) => {
    if (left.number !== right.number) {
      return left.number - right.number;
    }
    return COLOR_ORDER.get(left.color) - COLOR_ORDER.get(right.color);
  });
}

function dealHands(tiles, handSize = 5, rng = Math.random) {
  const shuffled = [...tiles];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return {
    players: [
      sortHand(shuffled.slice(0, handSize).map(normalizeTile)),
      sortHand(shuffled.slice(handSize, handSize * 2).map(normalizeTile))
    ],
    remaining: shuffled.slice(handSize * 2).map(normalizeTile)
  };
}

function isSameTile(left, right) {
  return left?.number === right?.number && left?.color === right?.color;
}

function isValidTile(tile) {
  return Number.isInteger(tile?.number)
    && tile.number >= 0
    && tile.number <= 9
    && COLORS.includes(tile.color);
}

function validateGuessTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) {
    return { ok: false, error: 'Guess must include at least one tile.' };
  }

  const seen = new Set();
  for (const tile of tiles) {
    if (!isValidTile(tile)) {
      return { ok: false, error: 'Guess contains an invalid tile.' };
    }
    const key = `${tile.number}:${tile.color}`;
    if (seen.has(key)) {
      return { ok: false, error: 'Guess contains duplicate tiles.' };
    }
    seen.add(key);
  }

  return {
    ok: true,
    tiles: sortHand(tiles.map((tile) => ({ number: tile.number, color: tile.color })))
  };
}

function isCorrectGuess(guess, targetHand) {
  const normalizedGuess = validateGuessTiles(guess);
  if (!normalizedGuess.ok || normalizedGuess.tiles.length !== targetHand.length) {
    return false;
  }

  const sortedTarget = sortHand(targetHand);
  return normalizedGuess.tiles.every((tile, index) => isSameTile(tile, sortedTarget[index]));
}

function getPublicTile(tile) {
  const publicTile = {
    number: tile.number,
    revealed: tile.revealed === true
  };
  if (publicTile.revealed) {
    publicTile.color = tile.color;
  }
  return publicTile;
}

module.exports = {
  COLORS,
  createTiles,
  sortHand,
  dealHands,
  isSameTile,
  validateGuessTiles,
  isCorrectGuess,
  getPublicTile
};
