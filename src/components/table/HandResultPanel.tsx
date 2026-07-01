import React from "react";

export function HandResultPanel({ view }: { view: unknown }) {
  const result = readResult(view);
  if (!result) {
    return null;
  }

  return (
    <section className="hand-result hand-result-card" aria-label="Hand result">
      <div>
        <span>Hand finished</span>
        <strong>{result.winnerText}</strong>
      </div>
      <div className="hand-result-detail">
        <span>{result.potText}</span>
        {result.boardText ? <small>{result.boardText}</small> : null}
      </div>
    </section>
  );
}

function readResult(view: unknown): { winnerText: string; potText: string; boardText: string | null } | null {
  const viewObject = readObject(view);
  const hand = readObject(viewObject?.hand);
  const eventPayload = readObject(viewObject?.handResult);
  if (eventPayload && isStaleHandResult(eventPayload, hand)) {
    return null;
  }

  const source = eventPayload ?? hand;
  if (!source || (eventPayload ? false : hand?.finished !== true)) {
    return null;
  }

  const winners = readWinners(source, viewObject);
  const pot = typeof source.pot === "number" ? source.pot : 0;
  const bigBlind = readBigBlind(viewObject);
  const board = Array.isArray(source.board) ? source.board.filter((card): card is string => typeof card === "string") : [];

  return {
    winnerText: winners.length > 0 ? `${winners.join(", ")} wins` : "Result pending",
    potText: pot > 0 ? formatBb(pot, bigBlind) : "Pot settled",
    boardText: board.length > 0 ? board.join(" ") : null
  };
}

function isStaleHandResult(result: Record<string, unknown>, hand: Record<string, unknown> | null): boolean {
  if (!hand || hand.finished === true) {
    return false;
  }

  const resultHandNumber = typeof result.handNumber === "number" ? result.handNumber : null;
  const currentHandNumber = typeof hand.number === "number" ? hand.number : null;
  return resultHandNumber !== null && currentHandNumber !== null && resultHandNumber !== currentHandNumber;
}

function readWinners(source: Record<string, unknown>, view: Record<string, unknown> | null): string[] {
  const rawWinners = source.winners;
  if (!Array.isArray(rawWinners)) {
    return [];
  }

  return rawWinners.flatMap((winner) => {
    if (typeof winner === "string") {
      return [displayNameForParticipant(view, winner)];
    }

    const winnerObject = readObject(winner);
    if (!winnerObject) {
      return [];
    }

    if (typeof winnerObject.displayName === "string") {
      return [winnerObject.displayName];
    }

    return typeof winnerObject.participantId === "string" ? [displayNameForParticipant(view, winnerObject.participantId)] : [];
  });
}

function displayNameForParticipant(view: Record<string, unknown> | null, participantId: string): string {
  const seats = view?.seats;
  if (!Array.isArray(seats)) {
    return participantId;
  }

  for (const candidate of seats) {
    const seat = readObject(candidate);
    if (seat?.participantId === participantId && typeof seat.displayName === "string") {
      return seat.displayName;
    }
  }

  return participantId;
}

function readBigBlind(view: Record<string, unknown> | null): number | null {
  const settings = readObject(view?.settings);
  return typeof settings?.bigBlind === "number" ? settings.bigBlind : null;
}

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
