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
  const displaySeats = arrangeSeatsForViewer(seats.length > 0 ? seats : emptySeats(6), localParticipantId, localDisplayName);

  return (
    <div className="seat-ring" aria-label="Seats">
      {displaySeats.map(({ seat, slot, local }) => (
        <button
          type="button"
          className={[
            "seat",
            `seat-slot-${slot}`,
            seat.occupied ? "is-occupied" : "",
            seat.occupied ? "" : "is-empty-seat",
            seat.isActing ? "is-acting" : "",
            local ? "is-local-seat" : ""
          ].filter(Boolean).join(" ")}
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
              </span>
              <span className="hero-hole-cards">
                {seat.holeCards.length > 0 ? (
                  <span className="hole-card-row" aria-label={`Seat ${seat.seatNumber} hole cards`}>
                    {seat.holeCards.map((card, index) => (
                      <PlayingCard card={card} variant="hero" dealIndex={index} key={card} />
                    ))}
                  </span>
                ) : seat.occupied ? (
                  <span className="card-back-row" aria-hidden="true">
                    <span className="card-back is-dealing" style={{ "--deal-index": 0 } as React.CSSProperties} />
                    <span className="card-back is-dealing" style={{ "--deal-index": 1 } as React.CSSProperties} />
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
              </span>
            </>
          )}
          {seat.streetCommitted > 0 ? (
            <span className="seat-bet">
              <span className="chip-stack" aria-hidden="true" />
              <span>{formatBb(seat.streetCommitted, bigBlind)}</span>
            </span>
          ) : null}
          {local ? null : (
            <span className="seat-cards">
              {seat.holeCards.length > 0 ? (
                <span className="hole-card-row" aria-label={`Seat ${seat.seatNumber} hole cards`}>
                  {seat.holeCards.map((card, index) => (
                    <PlayingCard card={card} variant="mini" dealIndex={index} key={card} />
                  ))}
                </span>
              ) : seat.occupied ? (
                <span className="card-back-row" aria-hidden="true">
                  <span className="card-back is-dealing" style={{ "--deal-index": 0 } as React.CSSProperties} />
                  <span className="card-back is-dealing" style={{ "--deal-index": 1 } as React.CSSProperties} />
                </span>
              ) : null}
            </span>
          )}
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

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
}

function readSeats(view: unknown): SeatView[] {
  const value = typeof view === "object" && view !== null && "seats" in view ? (view as { seats: unknown }).seats : null;
  const holeCardsBySeat = readHoleCardsBySeat(view);
  const handMetaBySeat = readHandMetaBySeat(view);
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
      streetCommitted: handMetaBySeat.get(seat.seatNumber)?.streetCommitted ?? 0
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
    6: [5, 6, 1, 2, 3, 4]
  };

  return (slotsByCount[count] ?? slotsByCount[6])[index] ?? index + 1;
}

function defaultSlotForIndex(index: number, count: number): number {
  const slotsByCount: Record<number, number[]> = {
    2: [5, 2],
    3: [5, 1, 3],
    4: [5, 6, 2, 4],
    5: [5, 6, 1, 3, 4],
    6: [1, 2, 3, 4, 5, 6]
  };

  return (slotsByCount[count] ?? slotsByCount[6])[index] ?? index + 1;
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
    streetCommitted: 0
  }));
}
