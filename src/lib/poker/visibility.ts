import { serializeCard } from "./cards";
import { getLegalActions } from "./betting";
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
    pot: number;
    actorId: string;
    seats: Array<{
      seatNumber: number;
      participantId: string | null;
      holeCards?: string[];
    }>;
    actions: Array<{ playerId: string; type: string; amount?: number }>;
    legalActions: Array<{ type: string; amount?: number; minAmountTo?: number; maxAmountTo?: number }>;
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
          pot: hand.betting.players.reduce((sum, player) => sum + player.committed, 0),
          actorId: hand.actorId,
          seats: state.seats.map((seat) => ({
            seatNumber: seat.seatNumber,
            participantId: seat.participantId,
            ...(seat.participantId && shouldRevealHoleCards(hand, seat.participantId, viewer)
              ? { holeCards: hand.holeCardsByParticipantId[seat.participantId]?.map(serializeCard) }
              : {})
          })),
          actions: hand.actions,
          legalActions: hand.finished ? [] : getLegalActions(hand.betting, hand.actorId),
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
