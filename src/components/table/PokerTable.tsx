import React from "react";
import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { PlayingCard } from "./PlayingCard";
import { SeatRing } from "./SeatRing";
import type { ClientMessage } from "@/lib/realtime/messages";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];
type InsuranceDecision = (accepted: boolean) => void;

export function PokerTable({
  view,
  legalActions,
  hostControls = false,
  playerControls = false,
  connected = true,
  localParticipantId,
  localDisplayName,
  onClaimSeat,
  onStartRoom,
  onPlayerAction,
  onInsuranceDecision,
  onRebuy,
  onHandleDisconnect
}: {
  view: unknown;
  legalActions?: unknown;
  hostControls?: boolean;
  playerControls?: boolean;
  connected?: boolean;
  localParticipantId?: string | null;
  localDisplayName?: string | null;
  onClaimSeat?: (seatNumber: number) => void;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onInsuranceDecision?: InsuranceDecision;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const board = readBoard(view);
  const pot = readPot(view);
  const currentBet = readCurrentBet(view);
  const settings = readSettings(view);
  const tableStatus = readTableStatus(view);
  const actorId = readActorId(view);
  const actorName = readActorName(view);
  const heroCards = readHeroCards(view, localParticipantId);
  const heroSeat = readLocalSeat(view, localParticipantId, localDisplayName);
  const heroStreetCommitted = readHeroStreetCommitted(view, localParticipantId);
  const canStartRoom = readCanStartRoom(view);
  const showHostControls = hostControls || readHostControls(view);
  const snapshotLegalActions = readLegalActions(view);
  const resolvedLegalActions = snapshotLegalActions ?? legalActions;
  const insuranceOffer = readInsuranceOffer(view);

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
          canClaimSeat={playerControls && connected}
          onClaimSeat={onClaimSeat}
        />

        <div className="table-center">
          <div className="table-watermark" aria-hidden="true">
            <span>PRIVATE</span>
            <strong>HOLD'EM</strong>
          </div>
          {pot > 0 ? (
            <div className="pot-chip pot-display" aria-label={`Pot ${formatBb(pot, settings.bigBlind)}`}>
              <span className="pot-chip-stack" aria-hidden="true" />
              <span className="pot-label">Total Pot</span>
              <strong className="pot-amount">{formatBb(pot, settings.bigBlind)}</strong>
              <span className="sr-only pot-screen-reader-text">Total Pot : {formatBb(pot, settings.bigBlind)}</span>
            </div>
          ) : null}
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
        currentBet={currentBet}
        heroStreetCommitted={heroStreetCommitted}
        canStartRoom={canStartRoom}
        hostControls={showHostControls}
        playerControls={playerControls}
        connected={connected}
        onStartRoom={onStartRoom}
        onPlayerAction={onPlayerAction}
        onRebuy={onRebuy}
        onHandleDisconnect={onHandleDisconnect}
      />
      <InsurancePanel
        bigBlind={settings.bigBlind}
        connected={connected}
        localParticipantId={localParticipantId}
        offer={insuranceOffer}
        playerControls={playerControls}
        onDecision={onInsuranceDecision}
      />
      <HandResultPanel view={view} />
    </section>
  );
}

function InsurancePanel({
  offer,
  localParticipantId,
  playerControls,
  connected,
  bigBlind,
  onDecision
}: {
  offer: ReturnType<typeof readInsuranceOffer>;
  localParticipantId?: string | null;
  playerControls: boolean;
  connected: boolean;
  bigBlind?: number | null;
  onDecision?: InsuranceDecision;
}) {
  if (!offer || offer.status !== "pending") {
    return null;
  }

  const canDecide = Boolean(playerControls && connected && localParticipantId === offer.offeredTo);

  return (
    <div className="insurance-backdrop">
      <section className="insurance-panel" role="dialog" aria-label="All-in insurance">
        <div className="insurance-copy">
          <span>All-in insurance</span>
          <strong>{formatPercent(offer.equityPct)} to hold</strong>
          <p>{canDecide ? `Pay ${formatBb(offer.premium, bigBlind)} now to protect this all-in before the river is dealt.` : "Waiting for the favorite to choose insurance."}</p>
        </div>
        <div className="insurance-terms" aria-label="Insurance terms">
          <span><small>Pot</small><strong>{formatBb(offer.potAmount, bigBlind)}</strong></span>
          <span><small>Coverage</small><strong>{formatBb(offer.coverage, bigBlind)}</strong></span>
          <span><small>Premium</small><strong>{formatBb(offer.premium, bigBlind)}</strong></span>
        </div>
        <div className="insurance-explainer">
          <span>If you get outdrawn, receive {formatBb(offer.coverage, bigBlind)} compensation.</span>
          <span>If you still win, collect the pot and pay the {formatBb(offer.premium, bigBlind)} premium.</span>
        </div>
        <div className="insurance-actions">
          <button type="button" onClick={() => onDecision?.(true)} disabled={!canDecide}>Buy insurance</button>
          <button type="button" onClick={() => onDecision?.(false)} disabled={!canDecide}>Run it</button>
        </div>
      </section>
    </div>
  );
}

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
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

function readCurrentBet(view: unknown): number {
  const hand = readObject(readObject(view)?.hand);
  return typeof hand?.currentBet === "number" ? hand.currentBet : 0;
}

function readHeroStreetCommitted(view: unknown, localParticipantId?: string | null): number {
  const hand = readObject(readObject(view)?.hand);
  if (!localParticipantId || !Array.isArray(hand?.seats)) {
    return 0;
  }

  for (const candidate of hand.seats) {
    const seat = readObject(candidate);
    if (seat?.participantId === localParticipantId && typeof seat.streetCommitted === "number") {
      return seat.streetCommitted;
    }
  }

  return 0;
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

function readInsuranceOffer(view: unknown): null | {
  status: string;
  offeredTo: string;
  potAmount: number;
  equityPct: number;
  coverage: number;
  premium: number;
} {
  const hand = readObject(readObject(view)?.hand);
  const offer = readObject(hand?.insuranceOffer);
  if (
    typeof offer?.status !== "string" ||
    typeof offer.offeredTo !== "string" ||
    typeof offer.potAmount !== "number" ||
    typeof offer.equityPct !== "number" ||
    typeof offer.coverage !== "number" ||
    typeof offer.premium !== "number"
  ) {
    return null;
  }

  return {
    status: offer.status,
    offeredTo: offer.offeredTo,
    potAmount: offer.potAmount,
    equityPct: offer.equityPct,
    coverage: offer.coverage,
    premium: offer.premium
  };
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
