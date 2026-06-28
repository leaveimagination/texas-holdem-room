import { describe, expect, it } from "vitest";
import { createDeck, parseCard, serializeCard } from "@/lib/poker/cards";

describe("cards", () => {
  it("creates a 52-card deck with unique cards", () => {
    const deck = createDeck();
    const serialized = deck.map(serializeCard);

    expect(deck).toHaveLength(52);
    expect(new Set(serialized).size).toBe(52);
    expect(serialized).toContain("As");
    expect(serialized).toContain("2c");
  });

  it("round-trips card serialization", () => {
    expect(serializeCard(parseCard("Th"))).toBe("Th");
    expect(serializeCard(parseCard("Ad"))).toBe("Ad");
  });

  it("rejects invalid cards", () => {
    expect(() => parseCard("1s")).toThrow("Invalid card");
    expect(() => parseCard("Ax")).toThrow("Invalid card");
  });
});
