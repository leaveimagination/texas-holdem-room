import type { RoomSettings } from "@/lib/room/settings";
import { applyBettingAction, buildPots } from "./betting";
import { serializeCard, type Card, shuffledDeck } from "./cards";
import { compareHands, evaluateSeven } from "./hand-evaluator";
import type {
  BettingAction,
  BettingState,
  HandResult,
  PendingTopUp,
  PotAward,
  RoomMode,
  Seat,
  SessionPlayerResult,
  Street,
  TableFlowState
} from "./types";

type ActiveSeat = Seat & { participantId: string };

export const SHOWDOWN_REVEAL_MS = 2_000;
export const FLOP_CARD_GAP_MS = 1_000;
export const FLOP_HOLD_MS = 2_000;
export const TURN_HOLD_MS = 2_000;
export const RIVER_HOLD_MS = 2_000;
export const HAND_SUMMARY_MS = 2_000;

export interface RoomState {
  roomId: string;
  mode: RoomMode;
  settings: RoomSettings;
  status: "lobby" | "playing" | "paused" | "finished";
  handCounter: number;
  buttonSeat: number | null;
  seats: Seat[];
  hand: HandState | null;
  flow: TableFlowState;
  pendingTopUps: Record<string, PendingTopUp>;
  endAfterCurrentHand: boolean;
  sessionEndedAt: number | null;
  sessionSummary: SessionPlayerResult[] | null;
}

export interface HandActionRecord {
  playerId: string;
  type: BettingAction["type"];
  street: Street;
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
  startingChipsByParticipantId: Record<string, number>;
  actions: HandActionRecord[];
  insuranceOffer?: InsuranceOffer;
  finished: boolean;
  winners: string[];
}

export interface InsuranceOffer {
  id: string;
  status: "pending" | "accepted" | "declined";
  offeredTo: string;
  potAmount: number;
  equityPct: number;
  coverage: number;
  premium: number;
  paidOut?: boolean;
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
    hand: null,
    flow: {
      phase: "betting",
      sequence: 0,
      deadlineAt: null,
      nextRunoutStep: null,
      handResult: null
    },
    pendingTopUps: {},
    endAfterCurrentHand: false,
    sessionEndedAt: null,
    sessionSummary: null
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
    throw new Error("Adding chips is only available at flexible tables");
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Chip amount must be positive");
  }

  const seat = state.seats.find((candidate) => candidate.participantId === participantId);
  if (!seat) {
    throw new Error("Participant is not seated");
  }

  if (seat.chips > 0) {
    throw new Error("Adding chips is only available after your stack reaches zero");
  }

  const activeHandPlayer = state.hand?.finished === false ? state.hand.betting.players.find((player) => player.id === participantId) : null;
  if (activeHandPlayer && !activeHandPlayer.folded) {
    throw new Error("Adding chips is only available after the current hand");
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

export function startHand(state: RoomState, providedDeck?: Card[], now = 0): RoomState {
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
  const startingChipsByParticipantId = Object.fromEntries(
    activeSeats.map((seat) => [seat.participantId, seat.chips])
  );

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
  const firstActorId = findNextEligibleActorId(seats, bettingPlayers, preferredActorSeat);
  const actorId = firstActorId ?? bettingPlayers[0]!.id;

  const startedState: RoomState = {
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
      startingChipsByParticipantId,
      actions: [],
      finished: false,
      winners: []
    }
  };

  return firstActorId ? startedState : finishHandIfReady(startedState, now);
}

export function applyPlayerAction(state: RoomState, action: BettingAction, now = 0): RoomState {
  if (!state.hand || state.hand.finished) {
    throw new Error("No active hand");
  }

  if (state.hand.insuranceOffer?.status === "pending") {
    throw new Error("Insurance decision is pending");
  }

  if (state.flow.phase !== "betting") {
    throw new Error("Hand presentation is in progress");
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
      actions: [...state.hand.actions, toActionRecord(action, state.hand.street)],
      actorId: state.hand.actorId
    }
  };

  const finishedState = finishHandIfReady(nextState, now);
  if (!finishedState.hand || finishedState.hand.finished) {
    return finishedState;
  }

  if (finishedState.hand.street !== state.hand.street) {
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

export function applyInsuranceDecision(state: RoomState, participantId: string, accepted: boolean, now = 0): RoomState {
  const offer = state.hand?.insuranceOffer;
  if (!state.hand || state.hand.finished || !offer || offer.status !== "pending") {
    throw new Error("No pending insurance offer");
  }

  if (offer.offeredTo !== participantId) {
    throw new Error("Insurance is not offered to this player");
  }

  const decidedState: RoomState = {
    ...state,
    hand: {
      ...state.hand,
      insuranceOffer: {
        ...offer,
        status: accepted ? "accepted" : "declined"
      }
    }
  };

  return beginShowdown(decidedState, now);
}

export function finishHandIfReady(state: RoomState, now = 0): RoomState {
  if (!state.hand || state.hand.finished) {
    return state;
  }

  const remainingPlayers = state.hand.betting.players.filter((player) => !player.folded);
  const hasAllInPlayer = remainingPlayers.some((player) => player.allIn);
  if (remainingPlayers.length !== 1) {
    if (!isBettingRoundComplete(state.hand)) {
      return state;
    }

    if (hasAllInPlayer || state.hand.street === "river") {
      if (hasAllInPlayer) {
        const insuranceState = maybeOfferInsurance(state);
        if (insuranceState !== state) {
          return insuranceState;
        }
      }

      return beginShowdown(state, now);
    }

    return advanceStreet(state, now);
  }

  return settleFoldWin(state, remainingPlayers[0].id, now);
}

function isBettingRoundComplete(hand: HandState): boolean {
  const remainingPlayers = hand.betting.players.filter((player) => !player.folded);
  const playersWithPendingResponse = remainingPlayers.filter(
    (player) => !player.allIn && player.streetCommitted < hand.betting.currentBet
  );
  if (playersWithPendingResponse.length > 0) {
    return false;
  }

  const actionablePlayers = remainingPlayers.filter((player) => !player.allIn);
  if (actionablePlayers.length === 0) {
    return true;
  }

  const streetActions = hand.actions.filter((action) => action.street === hand.street);
  return actionablePlayers.every(
    (player) =>
      player.streetCommitted === hand.betting.currentBet &&
      streetActions.some((action) => action.playerId === player.id)
  );
}

function advanceStreet(state: RoomState, now: number): RoomState {
  if (!state.hand) {
    return state;
  }

  const street = nextStreet(state.hand.street);
  if (!street) {
    return beginShowdown(state, now);
  }

  const deck = [...state.hand.deck];
  const board = [...state.hand.board];
  const cardsToDeal = street === "flop" ? 3 : 1;
  for (let index = 0; index < cardsToDeal; index += 1) {
    board.push(drawCard(deck));
  }

  const players = state.hand.betting.players.map((player) => ({
    ...player,
    streetCommitted: 0
  }));
  const actorId = firstActorForStreet(state.seats, players, state.buttonSeat);
  const betting: BettingState = {
    street,
    currentBet: 0,
    minRaise: state.settings.bigBlind,
    actorId: actorId ?? state.hand.actorId,
    players
  };
  const advancedState: RoomState = {
    ...state,
    hand: {
      ...state.hand,
      street,
      board,
      deck,
      actorId: betting.actorId,
      betting
    }
  };

  return actorId ? advancedState : beginShowdown(advancedState, now);
}

function nextStreet(street: Street): Street | null {
  if (street === "preflop") {
    return "flop";
  }

  if (street === "flop") {
    return "turn";
  }

  if (street === "turn") {
    return "river";
  }

  return null;
}

function firstActorForStreet(seats: Seat[], players: BettingState["players"], buttonSeat: number | null): string | null {
  const eligibleSeats = seats.filter((seat) => {
    const player = players.find((candidate) => candidate.id === seat.participantId);
    return player && !player.folded && !player.allIn;
  });
  if (eligibleSeats.length === 0) {
    return null;
  }

  const startingSeat = buttonSeat === null ? eligibleSeats[0].seatNumber : nextSeatAfter(buttonSeat, seats);
  const actorSeatNumber = nextSeatOnOrAfter(startingSeat, eligibleSeats);
  return seats.find((seat) => seat.seatNumber === actorSeatNumber)?.participantId ?? null;
}

export function beginShowdown(state: RoomState, now: number): RoomState {
  if (!state.hand || state.hand.finished) {
    return state;
  }

  return {
    ...state,
    flow: {
      phase: "showdown-reveal",
      sequence: state.flow.sequence + 1,
      deadlineAt: now + SHOWDOWN_REVEAL_MS,
      nextRunoutStep: nextRunoutStep(state.hand.board.length),
      handResult: null
    }
  };
}

export function advanceDuePhase(state: RoomState, now: number): RoomState {
  const deadline = state.flow.deadlineAt;
  if (!state.hand || deadline === null || deadline > now) {
    return state;
  }

  if (state.flow.phase !== "showdown-reveal" && state.flow.phase !== "runout") {
    return state;
  }

  if (state.hand.board.length >= 5) {
    return settleShowdown(state, deadline);
  }

  const deck = [...state.hand.deck];
  const board = [...state.hand.board, drawCard(deck)];
  const street = streetForBoardLength(board.length);
  return {
    ...state,
    hand: {
      ...state.hand,
      board,
      deck,
      street,
      betting: {
        ...state.hand.betting,
        street
      }
    },
    flow: {
      phase: "runout",
      sequence: state.flow.sequence + 1,
      deadlineAt: deadline + holdAfterBoardLength(board.length),
      nextRunoutStep: nextRunoutStep(board.length),
      handResult: null
    }
  };
}

function nextRunoutStep(boardLength: number): TableFlowState["nextRunoutStep"] {
  if (boardLength < 3) {
    return { street: "flop", cardIndexOnStreet: boardLength };
  }
  if (boardLength === 3) {
    return { street: "turn", cardIndexOnStreet: 0 };
  }
  if (boardLength === 4) {
    return { street: "river", cardIndexOnStreet: 0 };
  }
  return null;
}

function streetForBoardLength(boardLength: number): Street {
  if (boardLength <= 3) {
    return "flop";
  }
  return boardLength === 4 ? "turn" : "river";
}

function holdAfterBoardLength(boardLength: number): number {
  if (boardLength < 3) {
    return FLOP_CARD_GAP_MS;
  }
  if (boardLength === 3) {
    return FLOP_HOLD_MS;
  }
  if (boardLength === 4) {
    return TURN_HOLD_MS;
  }
  return RIVER_HOLD_MS;
}

function maybeOfferInsurance(state: RoomState): RoomState {
  if (!state.hand || state.mode !== "cash" || state.hand.finished || state.hand.insuranceOffer) {
    return state;
  }

  if (state.hand.board.length < 3 || state.hand.board.length >= 5) {
    return state;
  }

  const remainingPlayers = state.hand.betting.players.filter((player) => !player.folded);
  if (remainingPlayers.length !== 2 || !remainingPlayers.every((player) => player.allIn)) {
    return state;
  }

  const equity = calculateHeadsUpEquity(state.hand, remainingPlayers.map((player) => player.id));
  const favorite = equity.find((candidate) => candidate.equity > 0.5);
  const tiedFavorite = equity.filter((candidate) => candidate.equity === favorite?.equity);
  if (!favorite || tiedFavorite.length !== 1) {
    return state;
  }

  const potAmount = buildPots(state.hand.betting.players).reduce((sum, pot) => sum + pot.amount, 0);
  if (potAmount <= 0) {
    return state;
  }

  const losingProbability = Math.max(0, 1 - favorite.equity);
  const coverage = Math.max(1, Math.floor(potAmount * favorite.equity));
  const premium = Math.max(1, Math.ceil((coverage * losingProbability / favorite.equity) * 1.05));

  return {
    ...state,
    flow: {
      phase: "insurance-pending",
      sequence: state.flow.sequence + 1,
      deadlineAt: null,
      nextRunoutStep: null,
      handResult: null
    },
    hand: {
      ...state.hand,
      insuranceOffer: {
        id: `${state.hand.id}-insurance`,
        status: "pending",
        offeredTo: favorite.playerId,
        potAmount,
        equityPct: Math.round(favorite.equity * 1000) / 10,
        coverage,
        premium
      }
    }
  };
}

function calculateHeadsUpEquity(hand: HandState, playerIds: string[]): Array<{ playerId: string; equity: number }> {
  const cardsNeeded = 5 - hand.board.length;
  const runouts = combinations(hand.deck, cardsNeeded);
  const wins = new Map(playerIds.map((playerId) => [playerId, 0]));
  let totalShares = 0;

  for (const runout of runouts) {
    const board = [...hand.board, ...runout];
    const values = playerIds.map((playerId) => ({
      playerId,
      value: evaluateSeven([...(hand.holeCardsByParticipantId[playerId] ?? []), ...board])
    }));
    const best = values.reduce((currentBest, candidate) => compareHands(candidate.value, currentBest.value) > 0 ? candidate : currentBest);
    const winners = values.filter((candidate) => compareHands(candidate.value, best.value) === 0);
    const share = 1 / winners.length;
    totalShares += 1;
    for (const winner of winners) {
      wins.set(winner.playerId, (wins.get(winner.playerId) ?? 0) + share);
    }
  }

  return playerIds.map((playerId) => ({
    playerId,
    equity: totalShares > 0 ? (wins.get(playerId) ?? 0) / totalShares : 0
  }));
}

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) {
    return [[]];
  }

  const result: T[][] = [];
  for (let index = 0; index <= values.length - count; index += 1) {
    for (const suffix of combinations(values.slice(index + 1), count - 1)) {
      result.push([values[index], ...suffix]);
    }
  }
  return result;
}

function settleShowdown(state: RoomState, summaryStartedAt: number): RoomState {
  if (!state.hand) {
    return state;
  }

  const handValues = new Map<string, ReturnType<typeof evaluateSeven>>();
  const remainingPlayers = state.hand.betting.players.filter((player) => !player.folded);
  for (const player of remainingPlayers) {
    const holeCards = state.hand.holeCardsByParticipantId[player.id];
    if (!holeCards || holeCards.length !== 2) {
      throw new Error(`Missing hole cards for ${player.id}`);
    }

    handValues.set(player.id, evaluateSeven([...holeCards, ...state.hand.board]));
  }

  const seatOrder = state.seats
    .filter((seat): seat is Seat & { participantId: string } => seat.participantId !== null)
    .map((seat) => seat.participantId);
  const winningsByPlayerId = new Map<string, number>();
  const winners = new Set<string>();
  const potAwards: PotAward[] = [];

  for (const [potIndex, pot] of buildPots(state.hand.betting.players).entries()) {
    const eligible = pot.eligiblePlayerIds.filter((playerId) => handValues.has(playerId));
    if (eligible.length === 0) {
      continue;
    }

    const best = eligible.reduce((currentBest, playerId) => {
      const comparison = compareHands(handValues.get(playerId)!, handValues.get(currentBest)!)
      return comparison > 0 ? playerId : currentBest;
    });
    const potWinners = eligible.filter((playerId) => compareHands(handValues.get(playerId)!, handValues.get(best)!) === 0);
    const share = Math.floor(pot.amount / potWinners.length);
    let remainder = pot.amount % potWinners.length;
    const orderedWinners = [...potWinners].sort((left, right) => seatOrder.indexOf(left) - seatOrder.indexOf(right));
    const awardsByParticipantId: Record<string, number> = {};

    for (const playerId of orderedWinners) {
      const extraChip = remainder > 0 ? 1 : 0;
      const award = share + extraChip;
      winningsByPlayerId.set(playerId, (winningsByPlayerId.get(playerId) ?? 0) + award);
      awardsByParticipantId[playerId] = award;
      winners.add(playerId);
      remainder -= extraChip;
    }

    potAwards.push({
      potIndex,
      amount: pot.amount,
      eligibleParticipantIds: [...pot.eligiblePlayerIds],
      awardsByParticipantId
    });
  }

  const seatsBeforeInsurance = state.seats.map((seat) => {
    if (!seat.participantId) {
      return seat;
    }

    const chips = seat.chips + (winningsByPlayerId.get(seat.participantId) ?? 0);
    const player = state.hand!.betting.players.find((candidate) => candidate.id === seat.participantId);
    const status: Seat["status"] = player?.folded ? "folded" : chips === 0 ? "all-in" : "active";
    return {
      ...seat,
      chips,
      status
    };
  });

  const orderedWinners = [...winners].sort((left, right) => seatOrder.indexOf(left) - seatOrder.indexOf(right));
  const insuranceResult = applyInsuranceSettlement(seatsBeforeInsurance, state.hand.insuranceOffer, orderedWinners);
  const insuranceDeltaByParticipantId = new Map<string, number>();
  for (const settledSeat of insuranceResult.seats) {
    if (!settledSeat.participantId) {
      continue;
    }
    const before = seatsBeforeInsurance.find((seat) => seat.participantId === settledSeat.participantId);
    insuranceDeltaByParticipantId.set(settledSeat.participantId, settledSeat.chips - (before?.chips ?? settledSeat.chips));
  }
  const settled = applyPostHandRules({
    ...state,
    seats: insuranceResult.seats,
    hand: {
      ...state.hand,
      insuranceOffer: insuranceResult.offer,
      finished: true,
      winners: orderedWinners
    }
  });

  return enterHandSummary(
    settled,
    summaryStartedAt,
    buildHandResult(settled, potAwards, insuranceDeltaByParticipantId)
  );
}

function settleFoldWin(state: RoomState, winnerId: string, summaryStartedAt: number): RoomState {
  if (!state.hand) {
    return state;
  }

  const potAwards = buildPots(state.hand.betting.players).map((pot, potIndex): PotAward => ({
    potIndex,
    amount: pot.amount,
    eligibleParticipantIds: [...pot.eligiblePlayerIds],
    awardsByParticipantId: { [winnerId]: pot.amount }
  }));
  const winnings = potAwards.reduce((sum, pot) => sum + pot.amount, 0);
  const seats = state.seats.map((seat) => {
    if (seat.participantId !== winnerId) {
      return seat;
    }

    return {
      ...seat,
      chips: seat.chips + winnings,
      status: "active" as const
    };
  });
  const settled = applyPostHandRules({
    ...state,
    seats,
    hand: {
      ...state.hand,
      finished: true,
      winners: [winnerId]
    }
  });

  return enterHandSummary(settled, summaryStartedAt, buildHandResult(settled, potAwards, new Map()));
}

function enterHandSummary(state: RoomState, summaryStartedAt: number, handResult: HandResult): RoomState {
  return {
    ...state,
    flow: {
      phase: "hand-summary",
      sequence: state.flow.sequence + 1,
      deadlineAt: summaryStartedAt + HAND_SUMMARY_MS,
      nextRunoutStep: null,
      handResult
    }
  };
}

function buildHandResult(
  state: RoomState,
  pots: PotAward[],
  insuranceDeltaByParticipantId: ReadonlyMap<string, number>
): HandResult {
  const hand = state.hand;
  if (!hand) {
    throw new Error("Cannot build a result without a hand");
  }

  const players = hand.betting.players.map((player) => {
    const seat = state.seats.find((candidate) => candidate.participantId === player.id);
    if (!seat) {
      throw new Error(`Missing seat for ${player.id}`);
    }
    const startingChips = hand.startingChipsByParticipantId[player.id];
    if (!Number.isSafeInteger(startingChips)) {
      throw new Error(`Missing starting chips for ${player.id}`);
    }
    const potAward = pots.reduce((sum, pot) => sum + (pot.awardsByParticipantId[player.id] ?? 0), 0);
    const insuranceDelta = insuranceDeltaByParticipantId.get(player.id) ?? 0;

    return {
      participantId: player.id,
      displayName: seat.displayName ?? player.id,
      seatNumber: seat.seatNumber,
      startingChips,
      committedChips: player.committed,
      potAward,
      insuranceDelta,
      endingChips: seat.chips,
      netChips: seat.chips - startingChips
    };
  }).sort((left, right) => right.netChips - left.netChips || left.seatNumber - right.seatNumber);

  return {
    handNumber: hand.number,
    board: hand.board.map(serializeCard),
    winnerParticipantIds: [...hand.winners],
    players,
    pots
  };
}

function applyInsuranceSettlement(
  seats: Seat[],
  offer: InsuranceOffer | undefined,
  winners: string[]
): { seats: Seat[]; offer: InsuranceOffer | undefined } {
  if (!offer || offer.status !== "accepted") {
    return { seats, offer };
  }

  const insuredWon = winners.includes(offer.offeredTo);
  const settledSeats = seats.map((seat) => {
    if (seat.participantId !== offer.offeredTo) {
      return seat;
    }

    const chips = insuredWon ? Math.max(0, seat.chips - offer.premium) : seat.chips + offer.coverage;
    return {
      ...seat,
      chips,
      status: chips > 0 ? "active" as const : seat.status
    };
  });

  return {
    seats: settledSeats,
    offer: {
      ...offer,
      paidOut: !insuredWon
    }
  };
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

function findNextEligibleActorId(seats: Seat[], players: BettingState["players"], startingSeatNumber: number): string | null {
  const eligibleSeats = seats.filter((seat) => {
    const player = players.find((candidate) => candidate.id === seat.participantId);
    return player && !player.folded && !player.allIn;
  });

  if (eligibleSeats.length === 0) {
    return null;
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

function toActionRecord(action: BettingAction, street: Street): HandActionRecord {
  return {
    playerId: action.playerId,
    type: action.type,
    street,
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

  if (state.hand.winners.length === 0) {
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
