import { describe, expect, it } from "vitest";
import { applyBettingAction, buildPots, getLegalActions } from "@/lib/poker/betting";
import type { BettingState } from "@/lib/poker/types";

function state(): BettingState {
  return {
    street: "preflop",
    currentBet: 20,
    minRaise: 20,
    actorId: "p3",
    players: [
      { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
      { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false },
      { id: "p3", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false }
    ]
  };
}

describe("betting", () => {
  it("rejects call when no outstanding bet exists", () => {
    const actions = {
      ...state(),
      currentBet: 0
    };

    expect(() => applyBettingAction(actions, { type: "call", playerId: "p3" })).toThrow(
      "Cannot call without a bet to match"
    );
  });

  it("rejects raise when no outstanding bet exists", () => {
    const actions = {
      ...state(),
      currentBet: 0
    };

    expect(() => applyBettingAction(actions, { type: "raise", playerId: "p3", amountTo: 20 })).toThrow(
      "Use bet when there is no existing bet"
    );
  });

  it("offers fold, call, raise, and all-in when facing a bet", () => {
    const actions = getLegalActions(state(), "p3").map((action) => action.type);

    expect(actions).toEqual(["fold", "call", "raise", "all-in"]);
  });

  it("offers raise instead of bet when the big blind has option after a call", () => {
    const actions = getLegalActions(
      {
        ...state(),
        actorId: "p2",
        currentBet: 20,
        minRaise: 20,
        players: [
          { id: "p1", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false },
          { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false }
        ]
      },
      "p2"
    );

    expect(actions).toContainEqual({ type: "raise", minAmountTo: 40, maxAmountTo: 1000 });
    expect(actions).not.toContainEqual(expect.objectContaining({ type: "bet" }));
  });

  it("does not offer a regular bet when actor is short-stacked", () => {
    const actions = getLegalActions(
      {
        ...state(),
        currentBet: 0,
        minRaise: 20,
        players: [
          { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
          { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false },
          { id: "p3", stack: 10, committed: 0, streetCommitted: 0, folded: false, allIn: false }
        ]
      },
      "p3"
    ).map((action) => action.type);

    expect(actions).toEqual(["check", "all-in"]);
  });

  it("does not offer a regular raise when actor cannot reach minimum raise amount", () => {
    const actions = getLegalActions(
      {
        ...state(),
        currentBet: 40,
        minRaise: 20,
        actorId: "p3",
        players: [
          { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
          { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false },
          { id: "p3", stack: 25, committed: 20, streetCommitted: 20, folded: false, allIn: false }
        ]
      },
      "p3"
    ).map((action) => action.type);

    expect(actions).toEqual(["fold", "call", "all-in"]);
  });

  it("applies a call", () => {
    const next = applyBettingAction(state(), { type: "call", playerId: "p3" });
    const player = next.players.find((candidate) => candidate.id === "p3")!;

    expect(player.stack).toBe(980);
    expect(player.committed).toBe(20);
    expect(player.streetCommitted).toBe(20);
  });

  it("rejects a below-minimum raise", () => {
    expect(() => applyBettingAction(state(), { type: "raise", playerId: "p3", amountTo: 30 })).toThrow(
      "Raise must be at least 40"
    );
  });

  it("builds main and side pots", () => {
    const pots = buildPots([
      { id: "p1", stack: 0, committed: 50, streetCommitted: 50, folded: false, allIn: true },
      { id: "p2", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true },
      { id: "p3", stack: 200, committed: 100, streetCommitted: 100, folded: false, allIn: false }
    ]);

    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ["p1", "p2", "p3"] },
      { amount: 100, eligiblePlayerIds: ["p2", "p3"] }
    ]);
  });
});
