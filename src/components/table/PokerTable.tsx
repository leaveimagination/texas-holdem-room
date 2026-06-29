import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { PlayingCard } from "./PlayingCard";
import { SeatRing } from "./SeatRing";
import type { ClientMessage } from "@/lib/realtime/messages";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];

export function PokerTable({
  view,
  legalActions,
  hostControls = false,
  playerControls = false,
  localParticipantId,
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
  localParticipantId?: string | null;
  onClaimSeat?: (seatNumber: number) => void;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const board = readBoard(view);
  const pot = readPot(view);
  const actorId = readActorId(view);
  const actorName = readActorName(view);
  const heroCards = readHeroCards(view, localParticipantId);
  const canStartRoom = readCanStartRoom(view);
  const showHostControls = hostControls || readHostControls(view);
  const resolvedLegalActions = legalActions ?? readLegalActions(view);

  return (
    <section className="table-surface" aria-label="Table">
      <div className="table-topline">
        <div>
          <p className="eyebrow">Live felt</p>
          <h2>Table</h2>
        </div>
        <span>{pot > 0 ? `Pot ${pot}` : "Virtual chips"}</span>
      </div>

      <div className="felt-stage">
        <SeatRing view={view} canClaimSeat={playerControls} onClaimSeat={onClaimSeat} />

        <div className="table-center">
          <div className="pot-chip" aria-label="Pot">{pot > 0 ? `Pot ${pot}` : "No pot yet"}</div>
          <div className="board" aria-label="Board">
            {board.length > 0 ? (
              board.map((card, index) => <PlayingCard card={card} dealIndex={index} key={`${card}-${index}`} />)
            ) : (
              <span className="board-empty">Board waiting</span>
            )}
          </div>
          <p className={actorId ? "actor-callout is-live" : "actor-callout"}>{actorId ? `${actorName ?? "Player"} to act` : "Waiting for deal"}</p>
        </div>
      </div>

      <div className="hero-hand" aria-label="Your hand">
        <span>Your hand</span>
        <div className="hero-cards">
          {heroCards.length > 0 ? heroCards.map((card, index) => <PlayingCard card={card} variant="hero" dealIndex={index} key={card} />) : <span className="board-empty">Join and start a hand</span>}
        </div>
      </div>

      <ActionControls
        legalActions={resolvedLegalActions}
        actorId={actorId}
        localParticipantId={localParticipantId}
        canStartRoom={canStartRoom}
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

function readActorName(view: unknown): string | null {
  const actingSeat = readActingSeat(view);
  if (!actingSeat) {
    return null;
  }

  return typeof actingSeat.displayName === "string" ? actingSeat.displayName : null;
}

function readHeroCards(view: unknown, localParticipantId?: string | null): string[] {
  const hand = readObject(readObject(view)?.hand);
  const handSeats = hand?.seats;
  if (!localParticipantId || !Array.isArray(handSeats)) {
    return [];
  }

  for (const candidate of handSeats) {
    const seat = readObject(candidate);
    if (seat?.participantId === localParticipantId && Array.isArray(seat.holeCards)) {
      return seat.holeCards.filter((card): card is string => typeof card === "string");
    }
  }

  return [];
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

function readCanStartRoom(view: unknown): boolean {
  const hand = readObject(readObject(view)?.hand);
  return hand === null || hand?.finished === true;
}

function readLegalActions(view: unknown): unknown {
  const hand = readObject(readObject(view)?.hand);
  return hand?.legalActions;
}

function readActingSeat(view: unknown): Record<string, unknown> | null {
  const actorId = readActorId(view);
  const hand = readObject(readObject(view)?.hand);
  const handSeats = hand?.seats;
  const seats = readObject(view)?.seats;
  if (!actorId || !Array.isArray(handSeats) || !Array.isArray(seats)) {
    return null;
  }

  const handSeat = handSeats.map(readObject).find((seat) => seat?.participantId === actorId);
  const seatNumber = handSeat && typeof handSeat.seatNumber === "number" ? handSeat.seatNumber : null;
  if (!seatNumber) {
    return null;
  }

  return seats.map(readObject).find((seat) => seat?.seatNumber === seatNumber) ?? null;
}

function readHostControls(view: unknown): boolean {
  const value = readObject(view)?.hostControls;
  return value === true;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
