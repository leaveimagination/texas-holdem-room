import React from "react";

type SessionPlayer = {
  participantId: string;
  displayName: string;
  initialChips: number;
  topUpChips: number;
  finalChips: number;
  netChips: number;
};

export function SessionResultPanel({ view }: { view: unknown }) {
  const players = readSessionPlayers(view);
  if (!players) {
    return null;
  }

  return (
    <div className="session-result-overlay">
      <section className="session-result-panel" aria-label="Session results" data-session-result-state="visible">
        <header>
          <span>Room complete</span>
          <h2>Session results</h2>
          <p>Final chip accounting for every player.</p>
        </header>
        <div className="session-result-table" role="table" aria-label="Final chip accounting">
          <div className="session-result-row is-heading" role="row">
            <strong role="columnheader">Player</strong>
            <strong role="columnheader">Initial</strong>
            <strong role="columnheader">Top-ups</strong>
            <strong role="columnheader">Final</strong>
            <strong role="columnheader">Net</strong>
          </div>
          {players.map((player) => (
            <div className="session-result-row" role="row" key={player.participantId}>
              <strong role="cell">{player.displayName}</strong>
              <span role="cell">{formatChips(player.initialChips)}</span>
              <span role="cell">{formatChips(player.topUpChips)}</span>
              <span role="cell">{formatChips(player.finalChips)}</span>
              <strong
                role="cell"
                className={player.netChips > 0 ? "is-positive" : player.netChips < 0 ? "is-negative" : "is-even"}
              >{formatSigned(player.netChips)}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function readSessionPlayers(view: unknown): SessionPlayer[] | null {
  const viewObject = readObject(view);
  const flow = readObject(viewObject?.flow);
  if (flow?.phase !== "session-summary" || !Array.isArray(viewObject?.sessionSummary)) {
    return null;
  }

  return viewObject.sessionSummary.flatMap((candidate) => {
    const player = readObject(candidate);
    if (
      typeof player?.participantId !== "string" ||
      typeof player.displayName !== "string" ||
      typeof player.initialChips !== "number" ||
      typeof player.topUpChips !== "number" ||
      typeof player.finalChips !== "number" ||
      typeof player.netChips !== "number"
    ) {
      return [];
    }

    return [{
      participantId: player.participantId,
      displayName: player.displayName,
      initialChips: player.initialChips,
      topUpChips: player.topUpChips,
      finalChips: player.finalChips,
      netChips: player.netChips
    }];
  });
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
