export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function serializeCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function parseCard(value: string): Card {
  if (value.length !== 2) {
    throw new Error(`Invalid card: ${value}`);
  }

  const rank = value[0] as Rank;
  const suit = value[1] as Suit;

  if (!RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`Invalid card: ${value}`);
  }

  return { rank, suit };
}

export function shuffledDeck(random: () => number = Math.random): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
