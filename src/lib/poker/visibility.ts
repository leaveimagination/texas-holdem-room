import { serializeCard } from "./cards";
import type { RoomState } from "./engine";

export interface Viewer {
  participantId: string | null;
  role: "player" | "spectator";
  host: boolean;
}

export interface ParticipantRoomView {
  roomId: string;
  mode: string;
  status: string;
  hostControls: boolean;
  seats: Array<{
    seatNumber: number;
    displayName: string | null;
    chips: number;
    status: string;
    cumulativeBuyIn: number;
    occupied: boolean;
  }>;
  hand: null | {
    number: number;
    street: string;
    board: string[];
    actorId: string;
    seats: Array<{
      seatNumber: number;
      participantId: string | null;
      holeCards?: string[];
    }>;
    actions: Array<{ playerId: string; type: string; amount?: number }>;
    finished: boolean;
    winners: string[];
  };
}

export function toParticipantView(state: RoomState, viewer: Viewer): ParticipantRoomView {
  const hand = state.hand;

  return {
    roomId: state.roomId,
    mode: state.mode,
    status: state.status,
    hostControls: viewer.host,
    seats: state.seats.map((seat) => ({
      seatNumber: seat.seatNumber,
      displayName: seat.displayName,
      chips: seat.chips,
      status: seat.status,
      cumulativeBuyIn: seat.cumulativeBuyIn,
      occupied: seat.participantId !== null
    })),
    hand: hand
      ? {
          number: hand.number,
          street: hand.street,
          board: hand.board.map(serializeCard),
          actorId: hand.actorId,
          seats: state.seats.map((seat) => ({
            seatNumber: seat.seatNumber,
            participantId: seat.participantId,
            ...(seat.participantId && shouldRevealHoleCards(hand, seat.participantId, viewer)
              ? { holeCards: hand.holeCardsByParticipantId[seat.participantId]?.map(serializeCard) }
              : {})
          })),
          actions: hand.actions,
          finished: hand.finished,
          winners: hand.winners
        }
      : null
  };
}

function shouldRevealHoleCards(
  hand: RoomState["hand"],
  ownerId: string,
  viewer: Viewer
): boolean {
  if (viewer.role !== "player") {
    return false;
  }

  return viewer.participantId === ownerId;
}
