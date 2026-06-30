import React from "react";

type CardVariant = "board" | "hero" | "mini";

const SUIT_SYMBOLS = new Map([
  ["h", "\u2665"],
  ["d", "\u2666"],
  ["c", "\u2663"],
  ["s", "\u2660"]
]);

const SUIT_TONES = new Map([
  ["h", "is-heart"],
  ["d", "is-diamond"],
  ["c", "is-club"],
  ["s", "is-spade"]
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
  const suitKey = card.slice(-1).toLowerCase();
  const suitColor = suitKey === "h" || suitKey === "d" ? "is-red" : "is-black";
  const suitTone = SUIT_TONES.get(suitKey) ?? "is-unknown-suit";

  return (
    <span
      className={["poker-card", `is-${variant}`, suitColor, suitTone, "is-dealing"].join(" ")}
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
