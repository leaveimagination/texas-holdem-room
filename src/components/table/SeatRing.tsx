import React from "react";
import { PlayingCard } from "./PlayingCard";

interface SeatView {
  seatNumber: number;
  participantId: string | null;
  displayName: string | null;
  chips: number;
  status: string;
  occupied: boolean;
  holeCards: string[];
  isActing: boolean;
  role: string | null;
  committed: number;
  streetCommitted: number;
  recentAction: string | null;
}

export function SeatRing({
  view,
  localParticipantId,
  localDisplayName,
  bigBlind,
  canClaimSeat = false,
  onClaimSeat
}: {
  view: unknown;
  localParticipantId?: string | null;
  localDisplayName?: string | null;
  bigBlind?: number | null;
  canClaimSeat?: boolean;
  onClaimSeat?: (seatNumber: number) => void;
}) {
  const seats = readSeats(view);
  const displaySeats = arrangeSeatsForViewer(seats.length > 0 ? seats : emptySeats(9), localParticipantId, localDisplayName);
  const winnerIds = readWinnerIds(view);
  const dealIndexBySeat = readDealIndexBySeat(displaySeats.map(({ seat }) => seat));

  return (
    <div className="seat-ring" aria-label="Seats">
      {displaySeats.map(({ seat, slot, local }) => {
        const allInAction = isAllInAction(seat.recentAction);
        const isWinner = Boolean(seat.participantId && winnerIds.has(seat.participantId));
        const seatDealIndex = dealIndexBySeat.get(seat.seatNumber) ?? 0;
        const seatClassName = [
          "seat",
          `seat-slot-${slot}`,
          seat.occupied ? "is-occupied" : "",
          seat.occupied ? "" : "is-empty-seat",
          seat.isActing ? "is-acting" : "",
          isWinner ? "is-pot-winner" : "",
          local ? "is-local-seat" : ""
        ].filter(Boolean).join(" ");
        const panelStatus = allInAction ? (
          <span className="seat-last-action is-all-in-action-label seat-status-strip">
            {seat.recentAction}
          </span>
        ) : null;

        return (
          <button
            type="button"
            className={seatClassName}
            key={seat.seatNumber}
            onClick={() => {
              if (!seat.occupied && canClaimSeat) {
                onClaimSeat?.(seat.seatNumber);
              }
            }}
            aria-label={seat.isActing ? `Seat ${seat.seatNumber} is acting` : seat.occupied ? `Seat ${seat.seatNumber} occupied by ${seat.displayName ?? "player"}` : `Claim seat ${seat.seatNumber}`}
            disabled={seat.occupied || !canClaimSeat}
          >
            {local ? (
              <span className="hero-seat-cluster">
                <span className="seat-avatar" aria-hidden="true">{avatarInitial(seat.displayName, seat.seatNumber)}</span>
              <span className="seat-panel seat-nameplate">
                <span className="seat-number">Seat {seat.seatNumber}</span>
                {seat.role ? <span className="seat-badge">{seat.role}</span> : null}
                <strong>{seat.displayName ?? "Open"}</strong>
                <span className="seat-stack">{seat.occupied ? formatBb(seat.chips, bigBlind) : "Available"}</span>
                <small>{seat.status}</small>
                {panelStatus}
              </span>
              <span className="hero-hole-cards">
                {seat.holeCards.length > 0 ? (
                  <span className="hole-card-row" aria-label={`Seat ${seat.seatNumber} hole cards`}>
                    {seat.holeCards.map((card, index) => (
                      <PlayingCard card={card} variant="hero" dealIndex={seatDealIndex + index} key={card} />
                    ))}
                  </span>
                ) : seat.occupied ? (
                  <span className="card-back-row" aria-hidden="true">
                    <span className="card-back is-dealing" style={{ "--deal-index": seatDealIndex } as React.CSSProperties} />
                    <span className="card-back is-dealing" style={{ "--deal-index": seatDealIndex + 1 } as React.CSSProperties} />
                  </span>
                ) : null}
              </span>
            </span>
          ) : (
            <>
              <span className="seat-avatar" aria-hidden="true">{avatarInitial(seat.displayName, seat.seatNumber)}</span>
              <span className="seat-panel seat-nameplate">
                <span className="seat-number">Seat {seat.seatNumber}</span>
                {seat.role ? <span className="seat-badge">{seat.role}</span> : null}
                <strong>{seat.displayName ?? "Open"}</strong>
                <span className="seat-stack">{seat.occupied ? formatBb(seat.chips, bigBlind) : "Available"}</span>
                <small>{seat.status}</small>
                {panelStatus}
              </span>
            </>
          )}
          {isWinner ? (
            <span className="winner-smile-badge" aria-label={`${seat.displayName ?? `Seat ${seat.seatNumber}`} collected the pot`}>
              :)
            </span>
          ) : null}
          {seat.streetCommitted > 0 ? (
            <span className="seat-bet">
              <span className="chip-tower" style={{ "--chip-layers": chipTowerLayers(seat.streetCommitted, bigBlind) } as React.CSSProperties} aria-hidden="true" />
              <span className="seat-bet-amount">{formatBb(seat.streetCommitted, bigBlind)}</span>
            </span>
          ) : null}
          {local ? null : (
            <span className="seat-cards">
              {seat.holeCards.length > 0 ? (
                <span className="hole-card-row" aria-label={`Seat ${seat.seatNumber} hole cards`}>
                  {seat.holeCards.map((card, index) => (
                    <PlayingCard card={card} variant="mini" dealIndex={seatDealIndex + index} key={card} />
                  ))}
                </span>
              ) : seat.occupied ? (
                <span className="card-back-row" aria-hidden="true">
                  <span className="card-back is-dealing" style={{ "--deal-index": seatDealIndex } as React.CSSProperties} />
                  <span className="card-back is-dealing" style={{ "--deal-index": seatDealIndex + 1 } as React.CSSProperties} />
                </span>
              ) : null}
            </span>
          )}
          {seat.isActing ? <span className="seat-timer" aria-hidden="true" /> : null}
        </button>
        );
      })}
    </div>
  );
}

function readDealIndexBySeat(seats: SeatView[]): Map<number, number> {
  const result = new Map<number, number>();
  const occupiedSeats = seats.filter((seat) => seat.occupied);
  occupiedSeats.forEach((seat, index) => {
    result.set(seat.seatNumber, index * 2);
  });
  return result;
}

function avatarInitial(displayName: string | null, seatNumber: number): string {
  const trimmed = displayName?.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : String(seatNumber);
}

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
}

function chipTowerLayers(amount: number, bigBlind?: number | null): number {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const bb = amount / blind;
  if (bb >= 10) {
    return 5;
  }
  if (bb >= 5) {
    return 4;
  }
  if (bb >= 2.5) {
    return 3;
  }
  if (bb >= 1) {
    return 2;
  }
  return 1;
}

function isAllInAction(action: string | null): boolean {
  return Boolean(action?.startsWith("All in"));
}

function readSeats(view: unknown): SeatView[] {
  const value = typeof view === "object" && view !== null && "seats" in view ? (view as { seats: unknown }).seats : null;
  const holeCardsBySeat = readHoleCardsBySeat(view);
  const handMetaBySeat = readHandMetaBySeat(view);
  const actingSeatNumber = readActingSeatNumber(view);
  const recentActionBySeat = readRecentActionBySeat(view);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      return [];
    }

    const seat = candidate as Record<string, unknown>;
    if (typeof seat.seatNumber !== "number") {
      return [];
    }

    return [{
      seatNumber: seat.seatNumber,
      participantId: typeof seat.participantId === "string"
        ? seat.participantId
        : typeof seat.id === "string"
          ? seat.id
          : handMetaBySeat.get(seat.seatNumber)?.participantId ?? null,
      displayName: typeof seat.displayName === "string" ? seat.displayName : null,
      chips: typeof seat.chips === "number" ? seat.chips : 0,
      status: typeof seat.status === "string" ? seat.status : "empty",
      occupied: typeof seat.occupied === "boolean" ? seat.occupied : seat.displayName !== null,
      holeCards: holeCardsBySeat.get(seat.seatNumber) ?? [],
      isActing: actingSeatNumber === seat.seatNumber,
      role: handMetaBySeat.get(seat.seatNumber)?.role ?? null,
      committed: handMetaBySeat.get(seat.seatNumber)?.committed ?? 0,
      streetCommitted: handMetaBySeat.get(seat.seatNumber)?.streetCommitted ?? 0,
      recentAction: recentActionBySeat.get(seat.seatNumber) ?? null
    }];
  });
}

function readActingSeatNumber(view: unknown): number | null {
  const hand = readObject(readObject(view)?.hand);
  const actorId = typeof hand?.actorId === "string" ? hand.actorId : null;
  const handSeats = hand?.seats;
  if (!actorId || !Array.isArray(handSeats)) {
    return null;
  }

  for (const candidate of handSeats) {
    const seat = readObject(candidate);
    if (seat?.participantId === actorId && typeof seat.seatNumber === "number") {
      return seat.seatNumber;
    }
  }

  return null;
}

function readHoleCardsBySeat(view: unknown): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const hand = readObject(readObject(view)?.hand);
  const handSeats = hand?.seats;
  if (!Array.isArray(handSeats)) {
    return result;
  }

  for (const candidate of handSeats) {
    const seat = readObject(candidate);
    if (!seat || typeof seat.seatNumber !== "number" || !Array.isArray(seat.holeCards)) {
      continue;
    }

    const holeCards = seat.holeCards.filter((card): card is string => typeof card === "string");
    if (holeCards.length > 0) {
      result.set(seat.seatNumber, holeCards);
    }
  }

  return result;
}

function readHandMetaBySeat(view: unknown): Map<number, { participantId: string | null; role: string | null; committed: number; streetCommitted: number }> {
  const result = new Map<number, { participantId: string | null; role: string | null; committed: number; streetCommitted: number }>();
  const hand = readObject(readObject(view)?.hand);
  const handSeats = hand?.seats;
  if (!Array.isArray(handSeats)) {
    return result;
  }

  for (const candidate of handSeats) {
    const seat = readObject(candidate);
    if (!seat || typeof seat.seatNumber !== "number") {
      continue;
    }

    result.set(seat.seatNumber, {
      participantId: typeof seat.participantId === "string" ? seat.participantId : null,
      role: typeof seat.role === "string" ? seat.role : null,
      committed: typeof seat.committed === "number" ? seat.committed : 0,
      streetCommitted: typeof seat.streetCommitted === "number" ? seat.streetCommitted : 0
    });
  }

  return result;
}

function readRecentActionBySeat(view: unknown): Map<number, string> {
  const result = new Map<number, string>();
  const hand = readObject(readObject(view)?.hand);
  const actions = hand?.actions;
  const handSeats = hand?.seats;
  if (!Array.isArray(actions) || actions.length === 0 || !Array.isArray(handSeats)) {
    return result;
  }

  const handSeatObjects = handSeats.map(readObject);
  for (const candidate of actions) {
    const action = readObject(candidate);
    if (!action) {
      continue;
    }

    const playerId = typeof action?.playerId === "string" ? action.playerId : null;
    const type = typeof action?.type === "string" ? action.type : null;
    if (!playerId || !type) {
      continue;
    }

    const seat = handSeatObjects.find((handSeat) => handSeat?.participantId === playerId);
    if (!seat || typeof seat.seatNumber !== "number") {
      continue;
    }

    const amount = typeof action.amountTo === "number"
      ? action.amountTo
      : typeof action.amount === "number"
        ? action.amount
        : null;
    result.set(seat.seatNumber, formatRecentAction(type, amount, readBigBlind(view)));
  }
  return result;
}

function readWinnerIds(view: unknown): Set<string> {
  const result = new Set<string>();
  const viewObject = readObject(view);
  const hand = readObject(viewObject?.hand);
  const handResult = readObject(viewObject?.handResult);
  const source = handResult && !isStaleHandResult(handResult, hand) ? handResult : hand?.finished === true ? hand : null;
  const winners = source?.winners;
  if (!Array.isArray(winners)) {
    return result;
  }

  for (const winner of winners) {
    if (typeof winner === "string") {
      result.add(winner);
      continue;
    }

    const winnerObject = readObject(winner);
    if (typeof winnerObject?.participantId === "string") {
      result.add(winnerObject.participantId);
    }
  }

  return result;
}

function isStaleHandResult(result: Record<string, unknown>, hand: Record<string, unknown> | null): boolean {
  if (!hand || hand.finished === true) {
    return false;
  }

  const resultHandNumber = typeof result.handNumber === "number" ? result.handNumber : null;
  const currentHandNumber = typeof hand.number === "number" ? hand.number : null;
  return resultHandNumber !== null && currentHandNumber !== null && resultHandNumber !== currentHandNumber;
}

function formatRecentAction(type: string, amount: number | null, bigBlind?: number | null): string {
  const label = type === "all-in"
    ? "All in"
    : type === "raise"
      ? "Raise"
      : type === "bet"
        ? "Bet"
        : type === "call"
          ? "Call"
          : type === "check"
            ? "Check"
            : type === "fold"
              ? "Fold"
              : type;

  return amount ? `${label} ${formatBb(amount, bigBlind)}` : label;
}

function readBigBlind(view: unknown): number | null {
  const settings = readObject(readObject(view)?.settings);
  return typeof settings?.bigBlind === "number" ? settings.bigBlind : null;
}

function arrangeSeatsForViewer(
  seats: SeatView[],
  localParticipantId?: string | null,
  localDisplayName?: string | null
): Array<{ seat: SeatView; slot: number; local: boolean }> {
  const orderedSeats = [...seats].sort((left, right) => left.seatNumber - right.seatNumber);
  const localIndex = findLocalSeatIndex(orderedSeats, localParticipantId, localDisplayName);
  if (localIndex === -1) {
    return orderedSeats.map((seat, index) => ({ seat, slot: defaultSlotForIndex(index, orderedSeats.length), local: false }));
  }

  const rotated = [...orderedSeats.slice(localIndex), ...orderedSeats.slice(0, localIndex)];
  return rotated.map((seat, index) => ({
    seat,
    slot: playerSlotForIndex(index, rotated.length),
    local: index === 0
  }));
}

function findLocalSeatIndex(seats: SeatView[], localParticipantId?: string | null, localDisplayName?: string | null): number {
  if (localParticipantId) {
    const byParticipant = seats.findIndex((seat) => seat.participantId === localParticipantId);
    if (byParticipant !== -1) {
      return byParticipant;
    }
  }

  const trimmedName = localDisplayName?.trim();
  return trimmedName ? seats.findIndex((seat) => seat.displayName === trimmedName) : -1;
}

function playerSlotForIndex(index: number, count: number): number {
  const slotsByCount: Record<number, number[]> = {
    2: [5, 2],
    3: [5, 1, 3],
    4: [5, 6, 2, 4],
    5: [5, 6, 1, 3, 4],
    6: [5, 6, 1, 2, 3, 4],
    7: [5, 6, 7, 1, 2, 3, 4],
    8: [5, 6, 7, 1, 2, 3, 8, 4],
    9: [5, 6, 7, 1, 2, 8, 3, 4, 9]
  };

  return (slotsByCount[count] ?? slotsByCount[9])[index] ?? index + 1;
}

function defaultSlotForIndex(index: number, count: number): number {
  const slotsByCount: Record<number, number[]> = {
    2: [5, 2],
    3: [5, 1, 3],
    4: [5, 6, 2, 4],
    5: [5, 6, 1, 3, 4],
    6: [1, 2, 3, 4, 5, 6],
    7: [1, 2, 3, 4, 5, 6, 7],
    8: [1, 2, 3, 4, 5, 6, 7, 8],
    9: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  };

  return (slotsByCount[count] ?? slotsByCount[9])[index] ?? index + 1;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function emptySeats(count: number): SeatView[] {
  return Array.from({ length: count }, (_, index) => ({
    seatNumber: index + 1,
    participantId: null,
    displayName: null,
    chips: 0,
    status: "empty",
    occupied: false,
    holeCards: [],
    isActing: false,
    role: null,
    committed: 0,
    streetCommitted: 0,
    recentAction: null
  }));
}
