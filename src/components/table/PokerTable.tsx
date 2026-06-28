import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { SeatRing } from "./SeatRing";
import type { ClientMessage } from "@/lib/realtime/messages";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];

export function PokerTable({
  view,
  legalActions,
  hostControls = false,
  playerControls = false,
  onClaimSeat,
  onStartRoom,
  onPlayerAction,
  onRebuy,
  onHandleDisconnect
}: {
  view: unknown;
  legalActions?: unknown;
  hostControls?: boolean;
  playerControls?: boolean;
  onClaimSeat?: (seatNumber: number) => void;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const board = readBoard(view);
  const pot = readPot(view);
  const actorId = readActorId(view);
  const showHostControls = hostControls || readHostControls(view);

  return (
    <section className="table-surface" aria-label="Table">
      <div className="table-topline">
        <div>
          <p className="eyebrow">Live felt</p>
          <h2>Table</h2>
        </div>
        <span>{pot > 0 ? `Pot ${pot}` : "Virtual chips"}</span>
      </div>

      <SeatRing view={view} canClaimSeat={playerControls} onClaimSeat={onClaimSeat} />

      <div className="board" aria-label="Board">
        {board.length > 0 ? (
          board.map((card, index) => <span className="card" key={`${card}-${index}`}>{card}</span>)
        ) : (
          <span className="board-empty">Board waiting</span>
        )}
      </div>

      <ActionControls
        legalActions={legalActions}
        actorId={actorId}
        hostControls={showHostControls}
        playerControls={playerControls}
        onStartRoom={onStartRoom}
        onPlayerAction={onPlayerAction}
        onRebuy={onRebuy}
        onHandleDisconnect={onHandleDisconnect}
      />
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

function readActorId(view: unknown): string | null {
  const hand = readObject(readObject(view)?.hand);
  return typeof hand?.actorId === "string" ? hand.actorId : null;
}

function readHostControls(view: unknown): boolean {
  const value = readObject(view)?.hostControls;
  return value === true;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
