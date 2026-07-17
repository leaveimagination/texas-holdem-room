import React from "react";
import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { PlayingCard } from "./PlayingCard";
import { SeatRing } from "./SeatRing";
import { SessionResultPanel } from "./SessionResultPanel";
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
  onEndRoom,
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
  onEndRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onInsuranceDecision?: InsuranceDecision;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const board = readBoard(view);
  const pot = readPot(view);
  const street = readStreet(view);
  const handNumber = readHandNumber(view);
  const boardDealOffset = readBoardDealOffset(view);
  const currentBet = readCurrentBet(view);
  const settings = readSettings(view);
  const tableStatus = readTableStatus(view);
  const tableMode = readTableMode(view);
  const flowPhase = readFlowPhase(view);
  const flowSequence = readFlowSequence(view);
  const actorId = readActorId(view);
  const actorName = readActorName(view);
  const heroCards = readHeroCards(view, localParticipantId);
  const heroSeat = readLocalSeat(view, localParticipantId, localDisplayName);
  const heroStreetCommitted = readHeroStreetCommitted(view, localParticipantId);
  const canStartRoom = readCanStartRoom(view);
  const showHostControls = hostControls || readHostControls(view);
  const snapshotLegalActions = readLegalActions(view);
  const resolvedLegalActions = snapshotLegalActions ?? legalActions;
  const isSettlementHold = flowPhase === "hand-summary" || flowPhase === "session-summary";
  const insuranceOffer = readInsuranceOffer(view);
  const showdown = readShowdown(view);
  const isRunoutReveal = flowPhase === "runout";
  const collectPot = readCollectPot(view, localParticipantId, localDisplayName);
  const pendingTopUp = readPendingTopUp(view, localParticipantId);
  const endAfterCurrentHand = readEndAfterCurrentHand(view);
  const roomFinished = tableStatus === "finished" || flowPhase === "session-summary";

  return (
    <section
      className="table-surface poker-client-shell"
      aria-label="Table"
      data-flow-phase={flowPhase ?? undefined}
      data-flow-sequence={flowSequence ?? undefined}
      data-hand-number={handNumber ?? undefined}
      data-board-card-count={board.length}
      data-street={street ?? undefined}
      data-pot={pot}
      data-actor-id={actorId ?? undefined}
    >
      <div className="poker-client-backdrop" aria-hidden="true" />
      <div className="table-topline table-status-bar" aria-label="Table status">
        <div>
          <p className="eyebrow">Private table</p>
          <h2>{tableStatus === "playing" ? "Hand live" : "Waiting"}</h2>
        </div>
        <span>{settings.bigBlind ? "BB view" : "Virtual chips"}</span>
      </div>

      <div
        className={["felt-stage", handNumber ? "deal-sequence" : "", isRunoutReveal ? "is-runout-reveal" : ""].filter(Boolean).join(" ")}
        data-hand-number={handNumber ?? undefined}
      >
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
            <div
              className={["board", "is-featured-board", isRunoutReveal ? "is-runout-board" : ""].filter(Boolean).join(" ")}
              aria-label="Board"
              style={{ "--board-deal-offset": boardDealOffset } as React.CSSProperties}
            >
              {board.map((card, index) => <PlayingCard card={card} dealIndex={boardDealOffset + index} key={`${handNumber ?? "hand"}-${card}-${index}`} />)}
            </div>
          ) : null}
          {actorId && !isSettlementHold ? <p className="actor-callout is-live">{actorName ?? "Player"} to act</p> : null}
        </div>
        {showdown ? <ShowdownOverlay showdown={showdown} /> : null}
        {collectPot ? <CollectPotBurst collectPot={collectPot} /> : null}
      </div>

      <ActionControls
        legalActions={isSettlementHold ? { actions: [] } : resolvedLegalActions}
        actorId={isSettlementHold ? null : actorId}
        actorName={isSettlementHold ? null : actorName}
        localParticipantId={localParticipantId}
        heroCards={heroCards}
        heroName={readSeatName(heroSeat)}
        heroStack={readSeatStack(heroSeat)}
        mode={tableMode}
        pendingTopUp={pendingTopUp}
        endAfterCurrentHand={endAfterCurrentHand}
        roomFinished={roomFinished}
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
        onEndRoom={onEndRoom}
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
      <SessionResultPanel view={view} />
    </section>
  );
}

function ShowdownOverlay({ showdown }: { showdown: { players: Array<{ name: string; cards: string[]; winner: boolean }> } }) {
  return (
    <section className="showdown-overlay" aria-label="Showdown reveal">
      <span className="showdown-kicker">Showdown</span>
      <div className="showdown-card-strip">
        {showdown.players.map((player, index) => (
          <div className={player.winner ? "showdown-player is-showdown-winner" : "showdown-player"} key={`${player.name}-${index}`}>
            <strong>{player.name}</strong>
            <span className="showdown-cards">
              {player.cards.map((card, cardIndex) => (
                <PlayingCard card={card} variant="mini" dealIndex={cardIndex} key={`${card}-${cardIndex}`} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CollectPotBurst({ collectPot }: { collectPot: { winners: Array<{ name: string; slot: number }> } }) {
  return (
    <div className="collect-pot-burst" aria-label={`Pot collected by ${collectPot.winners.map((winner) => winner.name).join(", ")}`}>
      {collectPot.winners.map((winner, index) => (
        <span
          className={`collect-pot-flight collect-pot-flight-${index} collect-pot-to-slot-${winner.slot}`}
          aria-hidden="true"
          key={`${winner.name}-${index}`}
        >
          <span />
          <span />
          <span />
        </span>
      ))}
    </div>
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

function readShowdown(view: unknown): null | { players: Array<{ name: string; cards: string[]; winner: boolean }> } {
  const viewObject = readObject(view);
  const hand = readObject(viewObject?.hand);
  const phase = readFlowPhase(view);
  const isLegacyFinishedSnapshot = phase === null && hand?.finished === true;
  if (!["showdown-reveal", "runout", "hand-summary"].includes(phase ?? "") && !isLegacyFinishedSnapshot) {
    return null;
  }

  const handSeats = hand?.seats;
  if (!Array.isArray(handSeats)) {
    return null;
  }

  const winnerIds = readWinnerIdSet(viewObject, hand, phase);
  const players = handSeats.flatMap((candidate) => {
    const seat = readObject(candidate);
    if (!seat || typeof seat.participantId !== "string" || !Array.isArray(seat.holeCards)) {
      return [];
    }

    const cards = seat.holeCards.filter((card): card is string => typeof card === "string");
    if (cards.length !== 2) {
      return [];
    }

    return [{
      name: displayNameForParticipant(viewObject, seat.participantId),
      cards,
      winner: winnerIds.has(seat.participantId)
    }];
  });

  return players.length >= 2 ? { players } : null;
}

function readCollectPot(
  view: unknown,
  localParticipantId?: string | null,
  localDisplayName?: string | null
): null | { winners: Array<{ name: string; slot: number }> } {
  const viewObject = readObject(view);
  const hand = readObject(viewObject?.hand);
  const phase = readFlowPhase(view);
  const flowResult = readObject(readObject(viewObject?.flow)?.handResult);
  const rawWinners = phase === "hand-summary"
    ? flowResult?.winnerParticipantIds
    : phase === null && hand?.finished === true
      ? hand.winners
      : null;
  if (!Array.isArray(rawWinners) || rawWinners.length === 0) {
    return null;
  }

  const winners = rawWinners.flatMap((winner) => {
    const participantId = typeof winner === "string" ? winner : typeof readObject(winner)?.participantId === "string" ? readObject(winner)!.participantId as string : null;
    const displayName = typeof readObject(winner)?.displayName === "string" ? readObject(winner)!.displayName as string : null;
    if (!participantId && !displayName) {
      return [];
    }

    return [{
      name: displayName ?? (participantId ? displayNameForParticipant(viewObject, participantId) : "Winner"),
      slot: participantId ? displaySlotForParticipant(viewObject, participantId, localParticipantId, localDisplayName) : 0
    }];
  });

  return winners.length > 0 ? { winners } : null;
}

function readWinnerIdSet(
  view: Record<string, unknown> | null,
  hand: Record<string, unknown> | null,
  phase: string | null
): Set<string> {
  const result = new Set<string>();
  const flowResult = readObject(readObject(view?.flow)?.handResult);
  const winners = phase === "hand-summary"
    ? flowResult?.winnerParticipantIds
    : phase === null && hand?.finished === true
      ? hand.winners
      : null;
  if (!Array.isArray(winners)) {
    return result;
  }

  for (const winner of winners) {
    if (typeof winner === "string") {
      result.add(winner);
      continue;
    }

    const winnerObject = readObject(winner);
    if (typeof winnerObject?.participantId === "string") result.add(winnerObject.participantId);
  }

  return result;
}

function displayNameForParticipant(view: Record<string, unknown> | null, participantId: string): string {
  const handSeats = readObject(view?.hand)?.seats;
  const handSeat = Array.isArray(handSeats) ? handSeats.map(readObject).find((candidate) => candidate?.participantId === participantId) : null;
  const seats = view?.seats;
  if (!Array.isArray(seats)) {
    return participantId;
  }

  for (const candidate of seats) {
    const seat = readObject(candidate);
    if (seat?.participantId === participantId && typeof seat.displayName === "string") {
      return seat.displayName;
    }

    if (typeof handSeat?.seatNumber === "number" && seat?.seatNumber === handSeat.seatNumber && typeof seat.displayName === "string") {
      return seat.displayName;
    }
  }

  if (typeof handSeat?.displayName === "string") {
    return handSeat.displayName;
  }

  return participantId;
}

function displaySlotForParticipant(
  view: Record<string, unknown> | null,
  participantId: string,
  localParticipantId?: string | null,
  localDisplayName?: string | null
): number {
  const handSeats = readObject(view?.hand)?.seats;
  const seatNumber = Array.isArray(handSeats)
    ? handSeats.map(readObject).find((seat) => seat?.participantId === participantId)?.seatNumber
    : null;
  if (typeof seatNumber !== "number") {
    return 0;
  }

  const seats = view?.seats;
  if (!Array.isArray(seats)) {
    return 0;
  }

  const occupied = seats
    .map(readObject)
    .filter((seat): seat is Record<string, unknown> => Boolean(seat && typeof seat.seatNumber === "number" && seat.occupied !== false))
    .sort((left, right) => (left.seatNumber as number) - (right.seatNumber as number));
  const localIndex = findLocalSeatIndex(occupied, localParticipantId, localDisplayName);
  const arranged = localIndex === -1 ? occupied : [...occupied.slice(localIndex), ...occupied.slice(0, localIndex)];
  const index = arranged.findIndex((seat) => seat.seatNumber === seatNumber);
  const defaultSlotsByCount: Record<number, number[]> = {
    2: [5, 2],
    3: [5, 1, 3],
    4: [5, 6, 2, 4],
    5: [5, 6, 1, 3, 4],
    6: [1, 2, 3, 4, 5, 6],
    7: [1, 2, 3, 4, 5, 6, 7],
    8: [1, 2, 3, 4, 5, 6, 7, 8],
    9: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  };
  const playerSlotsByCount: Record<number, number[]> = {
    2: [5, 2],
    3: [5, 1, 3],
    4: [5, 6, 2, 4],
    5: [5, 6, 1, 3, 4],
    6: [5, 6, 1, 2, 3, 4],
    7: [5, 6, 7, 1, 2, 3, 4],
    8: [5, 6, 7, 1, 2, 3, 8, 4],
    9: [5, 6, 7, 1, 2, 8, 3, 4, 9]
  };
  const slotsByCount = localIndex === -1 ? defaultSlotsByCount : playerSlotsByCount;
  return index === -1 ? 0 : (slotsByCount[occupied.length] ?? slotsByCount[9])[index] ?? 0;
}

function findLocalSeatIndex(
  seats: Array<Record<string, unknown>>,
  localParticipantId?: string | null,
  localDisplayName?: string | null
): number {
  if (localParticipantId) {
    const byParticipant = seats.findIndex((seat) => seat.participantId === localParticipantId);
    if (byParticipant !== -1) {
      return byParticipant;
    }
  }

  const trimmedName = localDisplayName?.trim();
  return trimmedName ? seats.findIndex((seat) => seat.displayName === trimmedName) : -1;
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

function readHandNumber(view: unknown): number | null {
  const hand = readObject(readObject(view)?.hand);
  return typeof hand?.number === "number" ? hand.number : null;
}

function readBoardDealOffset(view: unknown): number {
  const hand = readObject(readObject(view)?.hand);
  const handSeats = hand?.seats;
  if (!Array.isArray(handSeats)) {
    return 0;
  }

  return handSeats
    .map(readObject)
    .filter((seat) => typeof seat?.seatNumber === "number" && typeof seat?.participantId === "string")
    .length * 2;
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

function readStreet(view: unknown): string | null {
  const street = readObject(readObject(view)?.hand)?.street;
  return typeof street === "string" ? street : null;
}

function readTableMode(view: unknown): "cash" | "tournament" | null {
  const mode = readObject(view)?.mode;
  return mode === "cash" || mode === "tournament" ? mode : null;
}

function readFlowPhase(view: unknown): string | null {
  const phase = readObject(readObject(view)?.flow)?.phase;
  return typeof phase === "string" ? phase : null;
}

function readFlowSequence(view: unknown): number | null {
  const sequence = readObject(readObject(view)?.flow)?.sequence;
  return typeof sequence === "number" ? sequence : null;
}

function readPendingTopUp(view: unknown, localParticipantId?: string | null): number {
  if (!localParticipantId) {
    return 0;
  }

  const pending = readObject(readObject(view)?.pendingTopUps);
  const localPending = readObject(pending?.[localParticipantId]);
  return typeof localPending?.amount === "number" ? localPending.amount : 0;
}

function readEndAfterCurrentHand(view: unknown): boolean {
  return readObject(view)?.endAfterCurrentHand === true;
}

function readActorId(view: unknown): string | null {
  const hand = readObject(readObject(view)?.hand);
  if (hand?.finished === true) {
    return null;
  }
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
