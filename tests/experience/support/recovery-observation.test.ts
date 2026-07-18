import { describe, expect, it } from "vitest";
import { exactJourneyMatches, privacyTimelineIsSafe, requiredControlEvidenceComplete, requiredCountsPresent, type ObservedFlowFrame } from "./recovery-observation";

const frame = (sequence: number, board: string[], actionIds = ["observed-action"]): ObservedFlowFrame => ({ phase: sequence === 7 ? "hand-summary" : "runout", sequence, board, actionIds, resultId: sequence === 7 ? "hand-1" : null, privateCardCount: 0 });

describe("recovery/mobile observation guards", () => {
  it("rejects empty/vacuous evidence collections", () => {
    expect(requiredCountsPresent([])).toBe(false);
    expect(requiredControlEvidenceComplete([], [])).toBe(false);
    expect(requiredControlEvidenceComplete(["fold", "call", "raise"], ["fold", "call"])).toBe(false);
    expect(requiredControlEvidenceComplete(["fold", "call", "raise"], ["fold", "call", "raise"])).toBe(true);
    expect(privacyTimelineIsSafe([], ["2c"], true)).toBe(false);
    expect(exactJourneyMatches({ frames: [], sequences: [], phases: [], boards: [], actionIds: [], resultIds: [] })).toBe(false);
  });
  it("rejects fixture-plan IDs that were not observed and duplicate/skip/board divergence", () => {
    const frames = [frame(6, ["2c"]), frame(6, ["2c", "7d"]), frame(7, ["2c", "7d"])];
    expect(exactJourneyMatches({ frames, sequences: [6, 7], phases: ["runout", "hand-summary"], boards: [["2c"], ["2c", "7d"]], actionIds: ["fixture-plan-id"], resultIds: ["hand-1"] })).toBe(false);
  });
  it("rejects a transient spectator private-card leak and a future/wrong board card", () => {
    expect(privacyTimelineIsSafe([{ board: [], privateCardCount: 0 }, { board: ["2c"], privateCardCount: 2 }], ["2c", "7d"], true)).toBe(false);
    expect(privacyTimelineIsSafe([{ board: ["7d"], privateCardCount: 0 }], ["2c", "7d"], true)).toBe(false);
  });
});
