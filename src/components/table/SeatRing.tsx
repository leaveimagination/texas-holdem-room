interface SeatView {
  seatNumber: number;
  displayName: string | null;
  chips: number;
  status: string;
  occupied: boolean;
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
          className={seat.occupied ? "seat is-occupied" : "seat"}
          key={seat.seatNumber}
          onClick={() => {
            if (!seat.occupied && canClaimSeat) {
              onClaimSeat?.(seat.seatNumber);
            }
          }}
          aria-label={seat.occupied ? `Seat ${seat.seatNumber} occupied by ${seat.displayName ?? "player"}` : `Claim seat ${seat.seatNumber}`}
          disabled={seat.occupied || !canClaimSeat}
        >
          <span className="seat-number">Seat {seat.seatNumber}</span>
          <strong>{seat.displayName ?? "Open"}</strong>
          <span>{seat.occupied ? `${seat.chips} chips` : "Available"}</span>
          <small>{seat.status}</small>
        </button>
      ))}
    </div>
  );
}

function readSeats(view: unknown): SeatView[] {
  const value = typeof view === "object" && view !== null && "seats" in view ? (view as { seats: unknown }).seats : null;
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
      occupied: typeof seat.occupied === "boolean" ? seat.occupied : seat.displayName !== null
    }];
  });
}

function emptySeats(count: number): SeatView[] {
  return Array.from({ length: count }, (_, index) => ({
    seatNumber: index + 1,
    displayName: null,
    chips: 0,
    status: "empty",
    occupied: false
  }));
}
