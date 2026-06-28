export function HandResultPanel({ view }: { view: unknown }) {
  const hand = readHand(view);
  if (!hand || hand.finished !== true) {
    return null;
  }

  const winners = Array.isArray(hand.winners) ? hand.winners.filter((winner): winner is string => typeof winner === "string") : [];

  return (
    <section className="hand-result" aria-label="Hand result">
      <strong>Hand finished</strong>
      <span>{winners.length > 0 ? `Winner: ${winners.join(", ")}` : "Result pending"}</span>
    </section>
  );
}

function readHand(view: unknown): Record<string, unknown> | null {
  if (typeof view !== "object" || view === null || !("hand" in view)) {
    return null;
  }

  const hand = (view as { hand: unknown }).hand;
  return typeof hand === "object" && hand !== null ? hand as Record<string, unknown> : null;
}
