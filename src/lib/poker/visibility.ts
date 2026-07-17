import { serializeCard } from "./cards";
import { getLegalActions } from "./betting";
import type { RoomState } from "./engine";
import type { HandResult, RunoutStep, SessionPlayerResult, TableFlowPhase } from "./types";

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
  flow: {
    phase: TableFlowPhase;
    sequence: number;
    deadlineAt: number | null;
    nextRunoutStep: RunoutStep | null;
    handResult: HandResult | null;
  };
  pendingTopUps: Record<string, { amount: number; targetHandNumber: number }>;
  endAfterCurrentHand: boolean;
  sessionEndedAt: number | null;
  sessionSummary: SessionPlayerResult[] | null;
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
    flow: {
      phase: state.flow.phase,
      sequence: state.flow.sequence,
      deadlineAt: state.flow.deadlineAt,
      nextRunoutStep: state.flow.nextRunoutStep,
      handResult: state.flow.phase === "hand-summary" ? state.flow.handResult : null
    },
    pendingTopUps: Object.fromEntries(
      Object.entries(state.pendingTopUps).map(([participantId, pending]) => [
        participantId,
        { amount: pending.amount, targetHandNumber: pending.targetHandNumber }
      ])
    ),
    endAfterCurrentHand: state.endAfterCurrentHand,
    sessionEndedAt: state.flow.phase === "session-summary" ? state.sessionEndedAt : null,
    sessionSummary: state.flow.phase === "session-summary" ? state.sessionSummary : null,
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
              ...(seat.participantId && shouldRevealHoleCards(hand, state.flow.phase, seat.participantId, viewer)
                ? { holeCards: hand.holeCardsByParticipantId[seat.participantId]?.map(serializeCard) }
                : {})
            };
          }),
          actions: hand.actions,
          legalActions:
            state.flow.phase !== "betting" || hand.finished || hand.insuranceOffer?.status === "pending"
              ? []
              : getLegalActions(hand.betting, hand.actorId),
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
          winners: state.flow.phase === "hand-summary" || state.flow.phase === "session-summary" ? hand.winners : []
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
  phase: TableFlowPhase,
  ownerId: string,
  viewer: Viewer
): boolean {
  if (viewer.role === "player" && viewer.participantId === ownerId) {
    return true;
  }

  if (!hand || !["showdown-reveal", "runout", "hand-summary"].includes(phase)) {
    return false;
  }
  const contenders = hand.betting.players.filter((player) => !player.folded);
  return contenders.length >= 2 && contenders.some((player) => player.id === ownerId);
}
