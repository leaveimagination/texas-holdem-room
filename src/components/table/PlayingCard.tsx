import React from "react";

type CardVariant = "board" | "hero" | "mini";

const SUIT_SYMBOLS = new Map([
  ["h", "♥"],
  ["d", "♦"],
  ["c", "♣"],
  ["s", "♠"]
]);

export function PlayingCard({
  card,
  variant = "board",
  dealIndex = 0
}: {
  card: string;
  variant?: CardVariant;
  dealIndex?: number;
}) {
  const parsed = parseCardLabel(card);
  const suitColor = parsed.suit === "♥" || parsed.suit === "♦" ? "is-red" : "is-black";

  return (
    <span
      className={["poker-card", `is-${variant}`, suitColor, "is-dealing"].join(" ")}
      style={{ "--deal-index": dealIndex } as React.CSSProperties}
      aria-label={card}
    >
      <span className="card-corner">
        <span className="card-rank">{parsed.rank}</span>
        <span className="card-suit">{parsed.suit}</span>
      </span>
      <span className="card-center-suit" aria-hidden="true">{parsed.suit}</span>
      <span className="card-corner is-bottom" aria-hidden="true">
        <span className="card-rank">{parsed.rank}</span>
        <span className="card-suit">{parsed.suit}</span>
      </span>
    </span>
  );
}

function parseCardLabel(card: string): { rank: string; suit: string } {
  const rank = card.slice(0, -1).toUpperCase();
  const suit = SUIT_SYMBOLS.get(card.slice(-1).toLowerCase()) ?? card.slice(-1);

  return { rank, suit };
}
