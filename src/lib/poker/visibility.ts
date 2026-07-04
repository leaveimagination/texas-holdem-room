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
  settings: {
    smallBlind: number;
    bigBlind: number;
    actionTimerSeconds: number | null;
  };
  buttonSeat: number | null;
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
    currentBet: number;
    minRaise: number;
    actorId: string;
    seats: Array<{
      seatNumber: number;
      participantId: string | null;
      role: string | null;
      committed: number;
      streetCommitted: number;
      holeCards?: string[];
    }>;
    actions: Array<{ playerId: string; type: string; amount?: number }>;
    legalActions: Array<{ type: string; amount?: number; minAmountTo?: number; maxAmountTo?: number }>;
    insuranceOffer?: {
      status: string;
      offeredTo: string;
      potAmount: number;
      equityPct: number;
      coverage: number;
      premium: number;
      paidOut?: boolean;
    };
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
    settings: {
      smallBlind: state.settings.smallBlind,
      bigBlind: state.settings.bigBlind,
      actionTimerSeconds: state.settings.actionTimerSeconds
    },
    buttonSeat: state.buttonSeat,
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
          currentBet: hand.betting.currentBet,
          minRaise: hand.betting.minRaise,
          actorId: hand.actorId,
          seats: state.seats.map((seat) => {
            const player = hand.betting.players.find((candidate) => candidate.id === seat.participantId);
            return {
              seatNumber: seat.seatNumber,
              participantId: seat.participantId,
              role: seatRole(state, seat.seatNumber),
              committed: player?.committed ?? 0,
              streetCommitted: player?.streetCommitted ?? 0,
              ...(seat.participantId && shouldRevealHoleCards(hand, seat.participantId, viewer)
                ? { holeCards: hand.holeCardsByParticipantId[seat.participantId]?.map(serializeCard) }
                : {})
            };
          }),
          actions: hand.actions,
          legalActions: hand.finished || hand.insuranceOffer?.status === "pending" ? [] : getLegalActions(hand.betting, hand.actorId),
          ...(hand.insuranceOffer
            ? {
                insuranceOffer: {
                  status: hand.insuranceOffer.status,
                  offeredTo: hand.insuranceOffer.offeredTo,
                  potAmount: hand.insuranceOffer.potAmount,
                  equityPct: hand.insuranceOffer.equityPct,
                  coverage: hand.insuranceOffer.coverage,
                  premium: hand.insuranceOffer.premium,
                  paidOut: hand.insuranceOffer.paidOut
                }
              }
            : {}),
          finished: hand.finished,
          winners: hand.winners
        }
      : null
  };
}

function seatRole(state: RoomState, seatNumber: number): string | null {
  if (!state.hand || state.buttonSeat === null) {
    return null;
  }

  const activeSeats = state.seats.filter((seat) => state.hand?.betting.players.some((player) => player.id === seat.participantId));
  if (activeSeats.length < 2) {
    return null;
  }

  const buttonSeat = state.buttonSeat;
  const smallBlindSeat = activeSeats.length === 2 ? buttonSeat : nextSeatAfter(buttonSeat, activeSeats);
  const bigBlindSeat = nextSeatAfter(smallBlindSeat, activeSeats);

  if (seatNumber === buttonSeat && seatNumber === smallBlindSeat) {
    return "BTN/SB";
  }

  if (seatNumber === buttonSeat) {
    return "BTN";
  }

  if (seatNumber === smallBlindSeat) {
    return "SB";
  }

  if (seatNumber === bigBlindSeat) {
    return "BB";
  }

  return null;
}

function nextSeatAfter(currentSeat: number, seats: ReadonlyArray<{ seatNumber: number }>): number {
  const orderedSeats = [...seats].sort((left, right) => left.seatNumber - right.seatNumber);
  return orderedSeats.find((seat) => seat.seatNumber > currentSeat)?.seatNumber ?? orderedSeats[0].seatNumber;
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
