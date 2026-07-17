import {
  createDeck,
  parseCard,
  serializeCard,
  type Card
} from "@/lib/poker/cards";

export function deckWithTopCards(topCards: readonly (string | Card)[]): Card[] {
  const parsedTopCards = topCards.map((card) =>
    typeof card === "string" ? parseCard(card) : { ...card }
  );
  const seen = new Set<string>();

  for (const card of parsedTopCards) {
    const serialized = serializeCard(card);
    if (seen.has(serialized)) {
      throw new Error(`Duplicate top card: ${serialized}`);
    }
    seen.add(serialized);
  }

  return [
    ...parsedTopCards,
    ...createDeck().filter((card) => !seen.has(serializeCard(card)))
  ];
}
