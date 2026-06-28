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
  it("offers fold, call, raise, and all-in when facing a bet", () => {
    const actions = getLegalActions(state(), "p3").map((action) => action.type);

    expect(actions).toEqual(["fold", "call", "raise", "all-in"]);
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
