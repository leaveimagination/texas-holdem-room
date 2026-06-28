import type { Card, Rank } from "./cards";

const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

export type HandName =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-kind"
  | "straight-flush";

export interface EvaluatedHand {
  name: HandName;
  category: number;
  ranks: number[];
}

export function evaluateSeven(cards: Card[]): EvaluatedHand {
  if (cards.length !== 7) {
    throw new Error("evaluateSeven requires exactly 7 cards");
  }

  const combos = fiveCardCombinations(cards);
  return combos.map(evaluateFive).sort(compareHands).at(-1)!;
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.category !== b.category) {
    return a.category - b.category;
  }

  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i += 1) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function fiveCardCombinations(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return result;
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const flush = new Set(cards.map((card) => card.suit)).size === 1;
  const straightHigh = findStraightHigh(values);

  if (flush && straightHigh !== null) {
    return { name: "straight-flush", category: 8, ranks: [straightHigh] };
  }

  const groups = groupValues(values);
  const counts = groups.map((group) => group.count).sort((a, b) => b - a);

  if (counts[0] === 4) {
    const quad = groups.find((group) => group.count === 4)!.value;
    const kicker = groups.find((group) => group.count === 1)!.value;
    return { name: "four-kind", category: 7, ranks: [quad, kicker] };
  }

  if (counts[0] === 3 && counts[1] === 2) {
    const trips = groups.find((group) => group.count === 3)!.value;
    const pair = groups.find((group) => group.count === 2)!.value;
    return { name: "full-house", category: 6, ranks: [trips, pair] };
  }

  if (flush) {
    return { name: "flush", category: 5, ranks: values };
  }

  if (straightHigh !== null) {
    return { name: "straight", category: 4, ranks: [straightHigh] };
  }

  if (counts[0] === 3) {
    const trips = groups.find((group) => group.count === 3)!.value;
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value);
    return { name: "three-kind", category: 3, ranks: [trips, ...kickers] };
  }

  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = groups.filter((group) => group.count === 2).map((group) => group.value);
    const kicker = groups.find((group) => group.count === 1)!.value;
    return { name: "two-pair", category: 2, ranks: [...pairs, kicker] };
  }

  if (counts[0] === 2) {
    const pair = groups.find((group) => group.count === 2)!.value;
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value);
    return { name: "pair", category: 1, ranks: [pair, ...kickers] };
  }

  return { name: "high-card", category: 0, ranks: values };
}

function findStraightHigh(values: number[]): number | null {
  const unique = [...new Set(values)];
  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i += 1) {
    const run = unique.slice(i, i + 5);
    if (run[0] - run[4] === 4) {
      return run[0] === 14 && run[1] === 5 ? 5 : run[0];
    }
  }

  return null;
}

function groupValues(values: number[]): Array<{ value: number; count: number }> {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
}
