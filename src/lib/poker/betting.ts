import type { BettingAction, BettingPlayer, BettingState, LegalAction, Pot } from "./types";

export function getLegalActions(state: BettingState, playerId: string): LegalAction[] {
  const player = findActor(state, playerId);
  const toCall = Math.max(0, state.currentBet - player.streetCommitted);

  if (player.folded || player.allIn) {
    return [];
  }

  if (toCall === 0) {
    const actions: LegalAction[] = [{ type: "check" }];
    const maxAmountTo = player.streetCommitted + player.stack;
    if (maxAmountTo >= state.minRaise) {
      actions.push({ type: "bet", minAmountTo: state.minRaise, maxAmountTo: player.streetCommitted + player.stack });
    }
    actions.push({ type: "all-in", amountTo: player.streetCommitted + player.stack });
    return actions;
  }

  const actions: LegalAction[] = [{ type: "fold" }, { type: "call", amount: Math.min(toCall, player.stack) }];
  const minAmountTo = state.currentBet + state.minRaise;
  const maxAmountTo = player.streetCommitted + player.stack;

  if (maxAmountTo >= minAmountTo) {
    actions.push({ type: "raise", minAmountTo, maxAmountTo });
  }

  actions.push({ type: "all-in", amountTo: maxAmountTo });
  return actions;
}

export function applyBettingAction(state: BettingState, action: BettingAction): BettingState {
  const next: BettingState = {
    ...state,
    players: state.players.map((player) => ({ ...player }))
  };

  const player = findActor(next, action.playerId);
  if (action.playerId !== next.actorId) {
    throw new Error("Not this player's turn");
  }

  if (action.type === "fold") {
    player.folded = true;
    return next;
  }

  const toCall = Math.max(0, next.currentBet - player.streetCommitted);

  if (action.type === "check") {
    if (toCall > 0) {
      throw new Error("Cannot check facing a bet");
    }
    return next;
  }

  if (action.type === "call") {
    if (toCall === 0) {
      throw new Error("Cannot call without a bet to match");
    }
    commit(player, Math.min(toCall, player.stack));
    return next;
  }

  if (action.type === "all-in") {
    const previousBet = next.currentBet;
    commit(player, player.stack);
    if (player.streetCommitted > next.currentBet) {
      next.currentBet = player.streetCommitted;
      const raiseSize = next.currentBet - previousBet;
      if (raiseSize >= next.minRaise) {
        next.minRaise = raiseSize;
      }
    }
    return next;
  }

  const amountTo = action.amountTo;
  if (amountTo <= next.currentBet) {
    throw new Error("Bet or raise must exceed current bet");
  }

  if (action.type === "bet" && next.currentBet !== 0) {
    throw new Error("Cannot bet when a bet already exists");
  }

  if (action.type === "raise" && next.currentBet === 0) {
    throw new Error("Use bet when there is no existing bet");
  }

  const minimum = next.currentBet === 0 ? next.minRaise : next.currentBet + next.minRaise;
  if (amountTo < minimum) {
    throw new Error(`Raise must be at least ${minimum}`);
  }

  const additional = amountTo - player.streetCommitted;
  if (additional > player.stack) {
    throw new Error("Insufficient chips");
  }

  const previousBet = next.currentBet;
  commit(player, additional);
  next.currentBet = amountTo;
  next.minRaise = amountTo - previousBet;
  return next;
}

export function buildPots(players: BettingPlayer[]): Pot[] {
  const contributors = players.filter((player) => player.committed > 0);
  const levels = [...new Set(contributors.map((player) => player.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    const participants = contributors.filter((player) => player.committed >= level);
    const eligiblePlayerIds = participants.filter((player) => !player.folded).map((player) => player.id);
    const amount = (level - previous) * participants.length;

    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ amount, eligiblePlayerIds });
    }

    previous = level;
  }

  return pots;
}

function findActor(state: BettingState, playerId: string): BettingPlayer {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player;
}

function commit(player: BettingPlayer, amount: number): void {
  player.stack -= amount;
  player.committed += amount;
  player.streetCommitted += amount;
  if (player.stack === 0) {
    player.allIn = true;
  }
}
