import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { SeatRing } from "./SeatRing";

export function PokerTable({ view, legalActions }: { view: unknown; legalActions?: unknown }) {
  const board = readBoard(view);
  const pot = readPot(view);

  return (
    <section className="table-surface" aria-label="Table">
      <div className="table-topline">
        <div>
          <p className="eyebrow">Live felt</p>
          <h2>Table</h2>
        </div>
        <span>{pot > 0 ? `Pot ${pot}` : "Virtual chips"}</span>
      </div>

      <SeatRing view={view} />

      <div className="board" aria-label="Board">
        {board.length > 0 ? (
          board.map((card, index) => <span className="card" key={`${card}-${index}`}>{card}</span>)
        ) : (
          <span className="board-empty">Board waiting</span>
        )}
      </div>

      <ActionControls legalActions={legalActions} />
      <HandResultPanel view={view} />
    </section>
  );
}

function readBoard(view: unknown): string[] {
  const hand = readObject(readObject(view)?.hand);
  const board = hand?.board;

  return Array.isArray(board) ? board.filter((card): card is string => typeof card === "string") : [];
}

function readPot(view: unknown): number {
  const hand = readObject(readObject(view)?.hand);
  const pot = hand?.pot;
  const potSize = hand?.potSize;

  return typeof pot === "number" ? pot : typeof potSize === "number" ? potSize : 0;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
