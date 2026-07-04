import process from "node:process";
import { applyInsuranceDecision, applyPlayerAction, claimSeat, createInitialRoomState, rebuy, startHand, type RoomState } from "../src/lib/poker/engine";
import { getLegalActions } from "../src/lib/poker/betting";
import type { BettingAction, LegalAction } from "../src/lib/poker/types";

type BotProfile = {
  id: string;
  name: string;
  seat: number;
  looseness: number;
  aggression: number;
  allInPressure: number;
};

type SessionStats = {
  actions: number;
  handsStarted: number;
  handsFinished: number;
  insuranceOffers: number;
  insuranceAccepted: number;
  rebuys: number;
  errors: string[];
};

const durationSeconds = readNumber("LONG_RUN_SECONDS", 3600);
const actionDelayMs = readNumber("ACTION_DELAY_MS", 20);
const seed = readNumber("LONG_RUN_SEED", 20260705);
const rng = createRng(seed);
const profiles: BotProfile[] = [
  { id: "p1", name: "Aki", seat: 1, looseness: 0.38, aggression: 0.44, allInPressure: 0.015 },
  { id: "p2", name: "Bo", seat: 2, looseness: 0.25, aggression: 0.28, allInPressure: 0.006 },
  { id: "p3", name: "Chen", seat: 3, looseness: 0.52, aggression: 0.62, allInPressure: 0.026 },
  { id: "p4", name: "Dia", seat: 4, looseness: 0.31, aggression: 0.51, allInPressure: 0.012 },
  { id: "p5", name: "Eli", seat: 5, looseness: 0.46, aggression: 0.36, allInPressure: 0.018 },
  { id: "p6", name: "Fan", seat: 6, looseness: 0.58, aggression: 0.72, allInPressure: 0.033 }
];

let state = createInitialRoomState(
  { mode: "cash", seats: 6, initialChips: 2000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
  "long-run-six-max"
);
for (const profile of profiles) {
  state = claimSeat(state, profile.id, profile.name, profile.seat);
}

const stats: SessionStats = {
  actions: 0,
  handsStarted: 0,
  handsFinished: 0,
  insuranceOffers: 0,
  insuranceAccepted: 0,
  rebuys: 0,
  errors: []
};
const recentActions: string[] = [];
const startedAt = Date.now();
const endsAt = startedAt + durationSeconds * 1000;
let lastProgressAt = 0;

await main();

async function main(): Promise<void> {
  console.log(JSON.stringify({ event: "long-run-start", durationSeconds, actionDelayMs, seed }));

  try {
    startNextHand();
    while (Date.now() < endsAt) {
      verifyState(state);

      if (state.hand?.insuranceOffer?.status === "pending") {
        decideInsurance();
      } else if (!state.hand || state.hand.finished) {
        handleFinishedHand();
        startNextHand();
      } else {
        takeBotAction();
      }

      maybeLogProgress();
      if (actionDelayMs > 0) {
        await sleep(actionDelayMs);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    stats.errors.push(message);
    console.error(JSON.stringify({ event: "long-run-error", message, recentActions }, null, 2));
    process.exitCode = 1;
  } finally {
    console.log(JSON.stringify({ event: "long-run-finished", elapsedSeconds: elapsedSeconds(), stats, state: summarizeState(state) }, null, 2));
  }
}

function startNextHand(): void {
  state = startHand(state);
  stats.handsStarted += 1;
  note(`hand ${state.hand?.number} started button=${state.buttonSeat} actor=${state.hand?.actorId}`);
}

function handleFinishedHand(): void {
  if (!state.hand?.finished) {
    return;
  }

  stats.handsFinished = Math.max(stats.handsFinished, state.hand.number);
  note(`hand ${state.hand.number} finished winners=${state.hand.winners.join(",")} board=${state.hand.board.map((card) => card.rank + card.suit).join(" ")}`);

  for (const seat of state.seats) {
    if (seat.participantId && seat.chips === 0) {
      state = rebuy(state, seat.participantId, 2000);
      stats.rebuys += 1;
      note(`${seat.participantId} rebuy 2000`);
    }
  }
}

function decideInsurance(): void {
  const offer = state.hand?.insuranceOffer;
  if (!offer) {
    return;
  }

  const accepted = rng() < 0.58;
  state = applyInsuranceDecision(state, offer.offeredTo, accepted);
  stats.insuranceOffers += 1;
  if (accepted) {
    stats.insuranceAccepted += 1;
  }
  note(`${offer.offeredTo} insurance ${accepted ? "accepted" : "declined"} premium=${offer.premium} coverage=${offer.coverage}`);
}

function takeBotAction(): void {
  const hand = state.hand;
  if (!hand) {
    throw new Error("Expected an active hand");
  }

  const actor = profiles.find((profile) => profile.id === hand.actorId);
  if (!actor) {
    throw new Error(`Unknown actor ${hand.actorId}`);
  }

  const legalActions = getLegalActions(hand.betting, actor.id);
  if (legalActions.length === 0) {
    throw new Error(`Actor ${actor.id} has no legal actions on ${hand.street}`);
  }

  const action = chooseAction(actor, legalActions, hand.street);
  state = applyPlayerAction(state, action);
  stats.actions += 1;
  note(`${actor.id} ${describeAction(action)}`);
}

function chooseAction(profile: BotProfile, legalActions: LegalAction[], street: string): BettingAction {
  const allIn = legalActions.find((action): action is Extract<LegalAction, { type: "all-in" }> => action.type === "all-in");
  const raise = legalActions.find((action): action is Extract<LegalAction, { type: "raise" }> => action.type === "raise");
  const bet = legalActions.find((action): action is Extract<LegalAction, { type: "bet" }> => action.type === "bet");
  const call = legalActions.find((action): action is Extract<LegalAction, { type: "call" }> => action.type === "call");
  const check = legalActions.find((action): action is Extract<LegalAction, { type: "check" }> => action.type === "check");
  const fold = legalActions.find((action): action is Extract<LegalAction, { type: "fold" }> => action.type === "fold");

  if (allIn && rng() < profile.allInPressure + (street === "river" ? 0.012 : 0)) {
    return { type: "all-in", playerId: profile.id };
  }

  if (raise && rng() < profile.aggression * 0.18) {
    return { type: "raise", playerId: profile.id, amountTo: chooseAmountTo(raise.minAmountTo, raise.maxAmountTo, profile.aggression) };
  }

  if (bet && rng() < profile.aggression * 0.34) {
    return { type: "bet", playerId: profile.id, amountTo: chooseAmountTo(bet.minAmountTo, bet.maxAmountTo, profile.aggression) };
  }

  if (call) {
    const callBias = street === "preflop" ? profile.looseness : profile.looseness + 0.1;
    if (!fold || rng() < callBias) {
      return { type: "call", playerId: profile.id };
    }
  }

  if (check) {
    return { type: "check", playerId: profile.id };
  }

  if (fold) {
    return { type: "fold", playerId: profile.id };
  }

  if (allIn) {
    return { type: "all-in", playerId: profile.id };
  }

  throw new Error(`No action selected for ${profile.id}`);
}

function chooseAmountTo(minAmountTo: number, maxAmountTo: number, aggression: number): number {
  if (maxAmountTo <= minAmountTo) {
    return minAmountTo;
  }

  const span = maxAmountTo - minAmountTo;
  const pressure = Math.min(1, Math.max(0, aggression * (0.35 + rng() * 0.7)));
  const raw = minAmountTo + Math.floor(span * pressure * 0.35);
  return Math.max(minAmountTo, Math.min(maxAmountTo, roundToChip(raw)));
}

function verifyState(room: RoomState): void {
  const seenParticipants = new Set<string>();
  for (const seat of room.seats) {
    if (seat.chips < 0 || !Number.isFinite(seat.chips)) {
      throw new Error(`Invalid chips for seat ${seat.seatNumber}: ${seat.chips}`);
    }
    if (seat.cumulativeBuyIn < 0 || !Number.isFinite(seat.cumulativeBuyIn)) {
      throw new Error(`Invalid buy-in for seat ${seat.seatNumber}: ${seat.cumulativeBuyIn}`);
    }
    if (seat.participantId) {
      if (seenParticipants.has(seat.participantId)) {
        throw new Error(`Duplicate participant ${seat.participantId}`);
      }
      seenParticipants.add(seat.participantId);
    }
  }

  if (!room.hand || room.hand.finished) {
    return;
  }

  if (room.hand.board.length > 5) {
    throw new Error(`Board has too many cards: ${room.hand.board.length}`);
  }
  if (room.hand.insuranceOffer?.status === "pending") {
    const offer = room.hand.insuranceOffer;
    if (!seenParticipants.has(offer.offeredTo) || offer.coverage <= 0 || offer.premium <= 0) {
      throw new Error(`Invalid pending insurance offer ${JSON.stringify(offer)}`);
    }
    return;
  }

  const actor = room.hand.betting.players.find((player) => player.id === room.hand?.actorId);
  if (!actor) {
    throw new Error(`Active hand actor missing from betting players: ${room.hand.actorId}`);
  }
  if (actor.folded || actor.allIn) {
    throw new Error(`Actor cannot act: ${room.hand.actorId} folded=${actor.folded} allIn=${actor.allIn}`);
  }
  const legalActions = getLegalActions(room.hand.betting, actor.id);
  if (legalActions.length === 0) {
    throw new Error(`No legal actions for active actor ${actor.id}`);
  }
}

function maybeLogProgress(): void {
  const elapsed = elapsedSeconds();
  if (elapsed - lastProgressAt < 30) {
    return;
  }

  lastProgressAt = elapsed;
  console.log(JSON.stringify({ event: "long-run-progress", elapsedSeconds: elapsed, stats, state: summarizeState(state) }));
}

function summarizeState(room: RoomState): unknown {
  return {
    handCounter: room.handCounter,
    status: room.status,
    hand: room.hand
      ? {
          number: room.hand.number,
          street: room.hand.street,
          board: room.hand.board.length,
          actorId: room.hand.actorId,
          finished: room.hand.finished,
          winners: room.hand.winners,
          insurance: room.hand.insuranceOffer?.status ?? null
        }
      : null,
    seats: room.seats.map((seat) => ({
      seat: seat.seatNumber,
      id: seat.participantId,
      chips: seat.chips,
      buyIn: seat.cumulativeBuyIn,
      status: seat.status
    }))
  };
}

function note(message: string): void {
  recentActions.push(message);
  if (recentActions.length > 30) {
    recentActions.shift();
  }
}

function describeAction(action: BettingAction): string {
  if ("amountTo" in action) {
    return `${action.type} ${action.amountTo}`;
  }
  return action.type;
}

function roundToChip(value: number): number {
  return Math.max(1, Math.round(value));
}

function elapsedSeconds(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRng(initialSeed: number): () => number {
  let value = initialSeed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
