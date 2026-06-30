import React from "react";
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
  localDisplayName,
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
  localDisplayName?: string | null;
  onClaimSeat?: (seatNumber: number) => void;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const board = readBoard(view);
  const pot = readPot(view);
  const settings = readSettings(view);
  const tableStatus = readTableStatus(view);
  const actorId = readActorId(view);
  const actorName = readActorName(view);
  const heroCards = readHeroCards(view, localParticipantId);
  const heroSeat = readLocalSeat(view, localParticipantId, localDisplayName);
  const canStartRoom = readCanStartRoom(view);
  const showHostControls = hostControls || readHostControls(view);
  const resolvedLegalActions = legalActions ?? readLegalActions(view);

  return (
    <section className="table-surface poker-client-shell" aria-label="Table">
      <div className="poker-client-backdrop" aria-hidden="true" />
      <div className="table-topline table-status-bar" aria-label="Table status">
        <div>
          <p className="eyebrow">Private table</p>
          <h2>{tableStatus === "playing" ? "Hand live" : "Waiting"}</h2>
        </div>
        <span>{settings.bigBlind ? "BB view" : "Virtual chips"}</span>
      </div>

      <div className="felt-stage">
        <SeatRing
          view={view}
          localParticipantId={localParticipantId}
          localDisplayName={localDisplayName}
          bigBlind={settings.bigBlind}
          canClaimSeat={playerControls}
          onClaimSeat={onClaimSeat}
        />

        <div className="table-center">
          <div className="table-watermark" aria-hidden="true">GG</div>
          {pot > 0 ? <div className="pot-chip" aria-label="Pot">Total Pot : {formatBb(pot, settings.bigBlind)}</div> : null}
          {board.length > 0 ? (
            <div className="board is-featured-board" aria-label="Board">
              {board.map((card, index) => <PlayingCard card={card} dealIndex={index} key={`${card}-${index}`} />)}
            </div>
          ) : null}
          {actorId ? <p className="actor-callout is-live">{actorName ?? "Player"} to act</p> : null}
        </div>
      </div>

      <ActionControls
        legalActions={resolvedLegalActions}
        actorId={actorId}
        actorName={actorName}
        localParticipantId={localParticipantId}
        heroCards={heroCards}
        heroName={readSeatName(heroSeat)}
        heroStack={readSeatStack(heroSeat)}
        tableStatus={tableStatus}
        bigBlind={settings.bigBlind}
        pot={pot}
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

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
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

function readSettings(view: unknown): { bigBlind: number | null } {
  const settings = readObject(readObject(view)?.settings);
  return {
    bigBlind: typeof settings?.bigBlind === "number" ? settings.bigBlind : null
  };
}

function readTableStatus(view: unknown): string | null {
  const status = readObject(view)?.status;
  return typeof status === "string" ? status : null;
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

function readLocalSeat(view: unknown, localParticipantId?: string | null, localDisplayName?: string | null): Record<string, unknown> | null {
  const seats = readObject(view)?.seats;
  if (!Array.isArray(seats)) {
    return null;
  }

  const readableSeats = seats.map(readObject);
  const byId = localParticipantId
    ? readableSeats.find((seat) => seat?.participantId === localParticipantId || seat?.id === localParticipantId)
    : null;
  if (byId) {
    return byId;
  }

  const trimmedName = localDisplayName?.trim();
  return trimmedName ? readableSeats.find((seat) => seat?.displayName === trimmedName) ?? null : null;
}

function readSeatName(seat: Record<string, unknown> | null): string | null {
  return typeof seat?.displayName === "string" ? seat.displayName : null;
}

function readSeatStack(seat: Record<string, unknown> | null): number | null {
  if (typeof seat?.stack === "number") {
    return seat.stack;
  }

  return typeof seat?.chips === "number" ? seat.chips : null;
}

function readHostControls(view: unknown): boolean {
  const value = readObject(view)?.hostControls;
  return value === true;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
