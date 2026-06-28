import type { RoomSettings } from "@/lib/room/settings";
import { applyBettingAction, buildPots } from "./betting";
import { type Card, shuffledDeck } from "./cards";
import type { BettingAction, BettingState, RoomMode, Seat, Street } from "./types";

type ActiveSeat = Seat & { participantId: string };

export interface RoomState {
  roomId: string;
  mode: RoomMode;
  settings: RoomSettings;
  status: "lobby" | "playing" | "paused" | "finished";
  handCounter: number;
  buttonSeat: number | null;
  seats: Seat[];
  hand: HandState | null;
}

export interface HandActionRecord {
  playerId: string;
  type: BettingAction["type"];
  amount?: number;
}

export interface HandState {
  id: string;
  number: number;
  street: Street;
  board: Card[];
  deck: Card[];
  actorId: string;
  betting: BettingState;
  holeCardsByParticipantId: Record<string, Card[]>;
  actions: HandActionRecord[];
  finished: boolean;
  winners: string[];
}

export function createInitialRoomState(settings: RoomSettings, roomId: string): RoomState {
  return {
    roomId,
    mode: settings.mode,
    settings,
    status: "lobby",
    handCounter: 0,
    buttonSeat: null,
    seats: Array.from({ length: settings.seats }, (_, index) => ({
      seatNumber: index + 1,
      participantId: null,
      displayName: null,
      chips: 0,
      status: "empty",
      cumulativeBuyIn: 0
    })),
    hand: null
  };
}

export function canClaimSeat(state: RoomState, participantId: string, seatNumber: number): boolean {
  const seat = state.seats.find((candidate) => candidate.seatNumber === seatNumber);
  if (!seat || seat.participantId !== null || seat.status !== "empty") {
    return false;
  }

  if (state.seats.some((candidate) => candidate.participantId === participantId)) {
    return false;
  }

  if (state.mode === "tournament") {
    return state.status === "lobby" && state.handCounter === 0 && state.hand === null;
  }

  return state.status !== "finished";
}

export function claimSeat(state: RoomState, participantId: string, displayName: string, seatNumber: number): RoomState {
  if (!canClaimSeat(state, participantId, seatNumber)) {
    throw new Error("Seat cannot be claimed now");
  }

  return {
    ...state,
    seats: state.seats.map((seat) =>
      seat.seatNumber === seatNumber
        ? {
            ...seat,
            participantId,
            displayName,
            chips: state.settings.initialChips,
            cumulativeBuyIn: state.settings.initialChips,
            status: "seated"
          }
        : seat
    )
  };
}

export function rebuy(state: RoomState, participantId: string, amount: number): RoomState {
  if (state.mode !== "cash") {
    throw new Error("Rebuys are only allowed in cash games");
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Rebuy amount must be positive");
  }

  const seat = state.seats.find((candidate) => candidate.participantId === participantId);
  if (!seat) {
    throw new Error("Participant is not seated");
  }

  if (seat.chips > 0) {
    throw new Error("Rebuy is only available after busting");
  }

  const activeHandPlayer = state.hand?.finished === false ? state.hand.betting.players.find((player) => player.id === participantId) : null;
  if (activeHandPlayer && !activeHandPlayer.folded) {
    throw new Error("Rebuy is only available after the current hand");
  }

  return {
    ...state,
    seats: state.seats.map((candidate) =>
      candidate.participantId === participantId
        ? {
            ...candidate,
            chips: candidate.chips + amount,
            cumulativeBuyIn: candidate.cumulativeBuyIn + amount,
            status: candidate.status === "eliminated" ? "seated" : candidate.status
          }
        : candidate
    )
  };
}

export function markDisconnected(state: RoomState, participantId: string): RoomState {
  const seat = state.seats.find((candidate) => candidate.participantId === participantId);
  if (!seat) {
    throw new Error("Participant is not seated");
  }

  const disconnectedIsInActiveHand =
    state.hand !== null &&
    !state.hand.finished &&
    state.hand.betting.players.some((player) => player.id === participantId && !player.folded && !player.allIn);

  return {
    ...state,
    status: state.status === "playing" && disconnectedIsInActiveHand ? "paused" : state.status,
    seats: state.seats.map((candidate) =>
      candidate.participantId === participantId
        ? {
            ...candidate,
            status: "disconnected"
          }
        : candidate
    )
  };
}

export function startHand(state: RoomState, providedDeck?: Card[]): RoomState {
  if (state.hand && !state.hand.finished) {
    throw new Error("Hand already in progress");
  }

  const activeSeats = getActiveSeats(state.seats);
  if (activeSeats.length < 2) {
    throw new Error("At least two active players are required");
  }

  const buttonSeat = nextButtonSeat(state.buttonSeat, activeSeats);
  const smallBlindSeat = activeSeats.length === 2 ? buttonSeat : nextSeatAfter(buttonSeat, activeSeats);
  const bigBlindSeat = nextSeatAfter(smallBlindSeat, activeSeats);
  const firstDealtSeat = nextSeatAfter(buttonSeat, activeSeats);
  const deck = [...(providedDeck ?? shuffledDeck())];
  const seats = state.seats.map((seat) => ({ ...seat }));
  const holeCardsByParticipantId: Record<string, Card[]> = {};

  for (const seat of activeSeats) {
    const updatedSeat = seats.find((candidate) => candidate.seatNumber === seat.seatNumber)!;
    updatedSeat.status = updatedSeat.chips === 0 ? "all-in" : "active";
  }

  const dealOrder = orderSeatsFrom(firstDealtSeat, activeSeats);

  for (let round = 0; round < 2; round += 1) {
    for (const seat of dealOrder) {
      holeCardsByParticipantId[seat.participantId!] ??= [];
      holeCardsByParticipantId[seat.participantId!].push(drawCard(deck));
    }
  }

  postBlind(seats, smallBlindSeat, state.settings.smallBlind);
  postBlind(seats, bigBlindSeat, state.settings.bigBlind);

  const bettingPlayers = activeSeats.map((seat) => {
    const updatedSeat = seats.find((candidate) => candidate.seatNumber === seat.seatNumber)!;
    const committed = seat.chips - updatedSeat.chips;

    return {
      id: updatedSeat.participantId!,
      stack: updatedSeat.chips,
      committed,
      streetCommitted: committed,
      folded: false,
      allIn: updatedSeat.chips === 0
    };
  });

  const currentBet = bettingPlayers.reduce((max, player) => Math.max(max, player.streetCommitted), 0);
  const minRaise = currentBet > 0 && currentBet < state.settings.bigBlind ? state.settings.bigBlind - currentBet : state.settings.bigBlind;
  const preferredActorSeat = activeSeats.length === 2 ? smallBlindSeat : nextSeatAfter(bigBlindSeat, activeSeats);
  const actorId = findNextEligibleActorId(seats, bettingPlayers, preferredActorSeat);

  return {
    ...state,
    status: "playing",
    handCounter: state.handCounter + 1,
    buttonSeat,
    seats,
    hand: {
      id: `${state.roomId}-${state.handCounter + 1}`,
      number: state.handCounter + 1,
      street: "preflop",
      board: [],
      deck,
      actorId,
      betting: {
        street: "preflop",
        currentBet,
        minRaise,
        actorId,
        players: bettingPlayers
      },
      holeCardsByParticipantId,
      actions: [],
      finished: false,
      winners: []
    }
  };
}

export function applyPlayerAction(state: RoomState, action: BettingAction): RoomState {
  if (!state.hand || state.hand.finished) {
    throw new Error("No active hand");
  }

  const betting = normalizeBlindCompletionMinRaise(state, action, applyBettingAction(state.hand.betting, action));
  const seats = state.seats.map((seat) => {
    const player = betting.players.find((candidate) => candidate.id === seat.participantId);
    if (!player) {
      return { ...seat };
    }

    const status: Seat["status"] = player.folded ? "folded" : player.allIn ? "all-in" : "active";

    return {
      ...seat,
      chips: player.stack,
      status
    };
  });

  const nextState: RoomState = {
    ...state,
    seats,
    hand: {
      ...state.hand,
      betting,
      actions: [...state.hand.actions, toActionRecord(action)],
      actorId: state.hand.actorId
    }
  };

  const finishedState = finishHandIfReady(nextState);
  if (!finishedState.hand || finishedState.hand.finished) {
    return finishedState;
  }

  const actorId = nextActorId(seats, state.hand.actorId, betting);
  if (!actorId) {
    return finishedState;
  }

  return {
    ...finishedState,
    hand: {
      ...finishedState.hand,
      actorId,
      betting: {
        ...finishedState.hand.betting,
        actorId
      }
    }
  };
}

export function finishHandIfReady(state: RoomState): RoomState {
  if (!state.hand || state.hand.finished) {
    return state;
  }

  const remainingPlayers = state.hand.betting.players.filter((player) => !player.folded);
  const hasAllInPlayer = remainingPlayers.some((player) => player.allIn);
  if (remainingPlayers.length !== 1) {
    const playersWithPendingResponse = remainingPlayers.filter(
      (player) => !player.allIn && player.streetCommitted < state.hand!.betting.currentBet
    );
    if (playersWithPendingResponse.length > 0) {
      return state;
    }

    const actionablePlayers = remainingPlayers.filter((player) => !player.allIn);
    if (actionablePlayers.length > 1 && !hasAllInPlayer) {
      return state;
    }

    return applyPostHandRules({
      ...state,
      hand: {
        ...state.hand,
        finished: true
      }
    });
  }

  const winnerId = remainingPlayers[0].id;
  const winnings = buildPots(state.hand.betting.players).reduce((sum, pot) => sum + pot.amount, 0);
  const seats = state.seats.map((seat) => {
    if (seat.participantId !== winnerId) {
      return seat;
    }

    const chips = seat.chips + winnings;
    const status: Seat["status"] = chips === 0 ? "all-in" : "active";

    return {
      ...seat,
      chips,
      status
    };
  });

  return applyPostHandRules({
    ...state,
    seats,
    hand: {
      ...state.hand,
      finished: true,
      winners: [winnerId]
    }
  });
}

function getActiveSeats(seats: Seat[]): ActiveSeat[] {
  return seats
    .filter(
      (seat): seat is ActiveSeat =>
        seat.participantId !== null &&
        seat.chips > 0 &&
        seat.status !== "empty" &&
        seat.status !== "eliminated" &&
        seat.status !== "disconnected"
    )
    .sort((left, right) => left.seatNumber - right.seatNumber);
}

function nextButtonSeat(currentButton: number | null, activeSeats: ActiveSeat[]): number {
  if (currentButton === null) {
    return activeSeats[0].seatNumber;
  }

  return nextSeatAfter(currentButton, activeSeats);
}

function nextSeatAfter(currentSeat: number, activeSeats: ReadonlyArray<Seat>): number {
  const orderedSeats = [...activeSeats].sort((left, right) => left.seatNumber - right.seatNumber);
  return orderedSeats.find((seat) => seat.seatNumber > currentSeat)?.seatNumber ?? orderedSeats[0].seatNumber;
}

function postBlind(seats: Seat[], seatNumber: number, blindAmount: number): void {
  const seat = seats.find((candidate) => candidate.seatNumber === seatNumber);
  if (!seat) {
    throw new Error(`Seat ${seatNumber} not found`);
  }

  const posted = Math.min(seat.chips, blindAmount);
  seat.chips -= posted;
  seat.status = seat.chips === 0 ? "all-in" : "active";
}

function drawCard(deck: Card[]): Card {
  const card = deck.shift();
  if (!card) {
    throw new Error("Deck exhausted");
  }
  return card;
}

function findNextEligibleActorId(seats: Seat[], players: BettingState["players"], startingSeatNumber: number): string {
  const eligibleSeats = seats.filter((seat) => {
    const player = players.find((candidate) => candidate.id === seat.participantId);
    return player && !player.folded && !player.allIn;
  });

  if (eligibleSeats.length === 0) {
    throw new Error("No player can act after blinds");
  }

  const actorSeatNumber = nextSeatOnOrAfter(startingSeatNumber, eligibleSeats);
  const actorId = seats.find((seat) => seat.seatNumber === actorSeatNumber)?.participantId;
  if (!actorId) {
    throw new Error("Unable to determine first actor");
  }

  return actorId;
}

function nextActorId(seats: Seat[], previousActorId: string, betting: BettingState): string | null {
  const eligibleSeats = seats.filter((seat) => {
    const player = betting.players.find((candidate) => candidate.id === seat.participantId);
    return player && !player.folded && !player.allIn;
  });

  if (eligibleSeats.length === 0) {
    return null;
  }

  const currentSeat = seats.find((seat) => seat.participantId === previousActorId);
  if (!currentSeat) {
    throw new Error(`Unknown actor: ${previousActorId}`);
  }

  const nextSeatNumber = nextSeatAfter(currentSeat.seatNumber, eligibleSeats);
  return seats.find((seat) => seat.seatNumber === nextSeatNumber)?.participantId ?? null;
}

function nextSeatOnOrAfter(currentSeat: number, seats: ReadonlyArray<Seat>): number {
  const orderedSeats = [...seats].sort((left, right) => left.seatNumber - right.seatNumber);
  return orderedSeats.find((seat) => seat.seatNumber >= currentSeat)?.seatNumber ?? orderedSeats[0].seatNumber;
}

function orderSeatsFrom(startingSeat: number, seats: ReadonlyArray<Seat>): Seat[] {
  const orderedSeats = [...seats].sort((left, right) => left.seatNumber - right.seatNumber);
  const startingIndex = orderedSeats.findIndex((seat) => seat.seatNumber === startingSeat);
  if (startingIndex === -1) {
    throw new Error(`Seat ${startingSeat} not found in deal order`);
  }

  return [...orderedSeats.slice(startingIndex), ...orderedSeats.slice(0, startingIndex)];
}

function toActionRecord(action: BettingAction): HandActionRecord {
  return {
    playerId: action.playerId,
    type: action.type,
    amount: "amountTo" in action ? action.amountTo : undefined
  };
}

function normalizeBlindCompletionMinRaise(state: RoomState, action: BettingAction, betting: BettingState): BettingState {
  if (
    state.hand?.street === "preflop" &&
    (action.type === "raise" || action.type === "all-in") &&
    state.hand.betting.currentBet < state.settings.bigBlind &&
    betting.currentBet === state.settings.bigBlind &&
    betting.minRaise < state.settings.bigBlind
  ) {
    return {
      ...betting,
      minRaise: state.settings.bigBlind
    };
  }

  return betting;
}

function applyPostHandRules(state: RoomState): RoomState {
  if (state.mode !== "tournament" || !state.hand?.finished) {
    return state;
  }

  const seats = state.seats.map((seat) => {
    if (seat.participantId && seat.chips === 0 && seat.status !== "empty" && seat.status !== "disconnected") {
      return { ...seat, status: "eliminated" as const };
    }

    return seat;
  });
  const remainingPlayers = seats.filter((seat) => seat.participantId && seat.chips > 0 && seat.status !== "eliminated" && seat.status !== "disconnected");
  const status: RoomState["status"] = remainingPlayers.length <= 1 ? "finished" : state.status;
  const settings =
    status !== "finished" && shouldIncreaseBlindsAfterHand(state)
      ? {
          ...state.settings,
          smallBlind: state.settings.smallBlind * 2,
          bigBlind: state.settings.bigBlind * 2
        }
      : state.settings;

  return {
    ...state,
    status,
    settings,
    seats
  };
}

function shouldIncreaseBlindsAfterHand(state: RoomState): boolean {
  if (state.mode !== "tournament" || !("blindIncrease" in state.settings) || state.settings.blindIncrease.type !== "hands") {
    return false;
  }

  return state.hand !== null && state.hand.number > 0 && state.hand.number % state.settings.blindIncrease.interval === 0;
}
