import React from "react";

interface SeatView {
  seatNumber: number;
  displayName: string | null;
  chips: number;
  status: string;
  occupied: boolean;
  holeCards: string[];
  isActing: boolean;
}

export function SeatRing({
  view,
  canClaimSeat = false,
  onClaimSeat
}: {
  view: unknown;
  canClaimSeat?: boolean;
  onClaimSeat?: (seatNumber: number) => void;
}) {
  const seats = readSeats(view);
  const displaySeats = seats.length > 0 ? seats : emptySeats(6);

  return (
    <div className="seat-ring" aria-label="Seats">
      {displaySeats.map((seat) => (
        <button
          type="button"
          className={["seat", seat.occupied ? "is-occupied" : "", seat.isActing ? "is-acting" : ""].filter(Boolean).join(" ")}
          key={seat.seatNumber}
          onClick={() => {
            if (!seat.occupied && canClaimSeat) {
              onClaimSeat?.(seat.seatNumber);
            }
          }}
          aria-label={seat.isActing ? `Seat ${seat.seatNumber} is acting` : seat.occupied ? `Seat ${seat.seatNumber} occupied by ${seat.displayName ?? "player"}` : `Claim seat ${seat.seatNumber}`}
          disabled={seat.occupied || !canClaimSeat}
        >
          <span className="seat-avatar" aria-hidden="true">{avatarInitial(seat.displayName, seat.seatNumber)}</span>
          <span className="seat-panel">
            <span className="seat-number">Seat {seat.seatNumber}</span>
            <strong>{seat.displayName ?? "Open"}</strong>
            <span className="seat-stack">{seat.occupied ? `${seat.chips} chips` : "Available"}</span>
            <small>{seat.status}</small>
          </span>
          <span className="seat-cards">
            {seat.holeCards.length > 0 ? (
              <span className="hole-card-row" aria-label={`Seat ${seat.seatNumber} hole cards`}>
                {seat.holeCards.map((card) => (
                  <span className="mini-card" key={card}>{card}</span>
                ))}
              </span>
            ) : seat.occupied ? (
              <span className="card-back-row" aria-hidden="true">
                <span className="card-back" />
                <span className="card-back" />
              </span>
            ) : null}
          </span>
          {seat.isActing ? <span className="seat-timer" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

function avatarInitial(displayName: string | null, seatNumber: number): string {
  const trimmed = displayName?.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : String(seatNumber);
}

function readSeats(view: unknown): SeatView[] {
  const value = typeof view === "object" && view !== null && "seats" in view ? (view as { seats: unknown }).seats : null;
  const holeCardsBySeat = readHoleCardsBySeat(view);
  const actingSeatNumber = readActingSeatNumber(view);
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
      displayName: typeof seat.displayName === "string" ? seat.displayName : null,
      chips: typeof seat.chips === "number" ? seat.chips : 0,
      status: typeof seat.status === "string" ? seat.status : "empty",
      occupied: typeof seat.occupied === "boolean" ? seat.occupied : seat.displayName !== null,
      holeCards: holeCardsBySeat.get(seat.seatNumber) ?? [],
      isActing: actingSeatNumber === seat.seatNumber
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

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function emptySeats(count: number): SeatView[] {
  return Array.from({ length: count }, (_, index) => ({
    seatNumber: index + 1,
    displayName: null,
    chips: 0,
    status: "empty",
    occupied: false,
    holeCards: [],
    isActing: false
  }));
}
