import React from "react";

type HandPlayerResult = {
  participantId: string;
  displayName: string;
  startingChips: number;
  endingChips: number;
  netChips: number;
};

type PotResult = {
  potIndex: number;
  amount: number;
  awardsByParticipantId: Record<string, number>;
};

type VisibleHandResult = {
  handNumber: number;
  board: string[];
  players: HandPlayerResult[];
  pots: PotResult[];
};

export function HandResultPanel({ view }: { view: unknown }) {
  const result = readResult(view);
  if (!result) {
    return null;
  }

  const namesById = new Map(result.players.map((player) => [player.participantId, player.displayName]));
  return (
    <section className="hand-result hand-result-card" aria-label="Hand result" role="status">
      <header className="hand-result-header">
        <div>
          <span>Hand complete</span>
          <strong>Hand {result.handNumber} result</strong>
        </div>
        {result.board.length > 0 ? <p aria-label="Final board">{result.board.join(" ")}</p> : null}
      </header>

      <div className={result.players.length >= 6 ? "hand-result-players is-two-column" : "hand-result-players"}>
        {result.players.map((player) => (
          <div className="hand-result-player" key={player.participantId}>
            <span>{player.displayName}</span>
            <small>{formatChips(player.startingChips)} → {formatChips(player.endingChips)}</small>
            <strong className={player.netChips > 0 ? "is-positive" : player.netChips < 0 ? "is-negative" : "is-even"}>
              {formatSigned(player.netChips)}
            </strong>
          </div>
        ))}
      </div>

      <div className="hand-result-pots" aria-label="Pot awards">
        {result.pots.map((pot) => {
          const awards = Object.entries(pot.awardsByParticipantId).filter(([, amount]) => amount > 0);
          return (
            <div key={pot.potIndex}>
              <span>{pot.potIndex === 0 ? "Main pot" : `Side pot ${pot.potIndex}`} · {formatChips(pot.amount)}</span>
              <strong>
                {awards.map(([participantId, amount]) => `${namesById.get(participantId) ?? participantId} +${formatChips(amount)}`).join(" · ")}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function readResult(view: unknown): VisibleHandResult | null {
  const flow = readObject(readObject(view)?.flow);
  if (flow?.phase !== "hand-summary") {
    return null;
  }

  const source = readObject(flow.handResult);
  if (!source || typeof source.handNumber !== "number" || !Array.isArray(source.players) || !Array.isArray(source.pots)) {
    return null;
  }

  const players = source.players.flatMap((candidate) => {
    const player = readObject(candidate);
    if (
      typeof player?.participantId !== "string" ||
      typeof player.displayName !== "string" ||
      typeof player.startingChips !== "number" ||
      typeof player.endingChips !== "number" ||
      typeof player.netChips !== "number"
    ) {
      return [];
    }

    return [{
      participantId: player.participantId,
      displayName: player.displayName,
      startingChips: player.startingChips,
      endingChips: player.endingChips,
      netChips: player.netChips
    }];
  });

  const pots = source.pots.flatMap((candidate) => {
    const pot = readObject(candidate);
    const awards = readObject(pot?.awardsByParticipantId);
    if (typeof pot?.potIndex !== "number" || typeof pot.amount !== "number" || !awards) {
      return [];
    }

    return [{
      potIndex: pot.potIndex,
      amount: pot.amount,
      awardsByParticipantId: Object.fromEntries(
        Object.entries(awards).filter((entry): entry is [string, number] => typeof entry[1] === "number")
      )
    }];
  });

  return {
    handNumber: source.handNumber,
    board: Array.isArray(source.board) ? source.board.filter((card): card is string => typeof card === "string") : [],
    players,
    pots
  };
}

function formatSigned(amount: number): string {
  return `${amount > 0 ? "+" : ""}${formatChips(amount)}`;
}

function formatChips(amount: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
