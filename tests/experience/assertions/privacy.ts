import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export type PrivateCardVisibility = "authorized" | "hidden" | "leak";

export function classifyPrivateCardVisibility(input: {
  visible: boolean;
  viewerRole: "host" | "player" | "spectator";
  viewerParticipantId?: string | null;
  ownerParticipantId: string;
  showdown?: boolean;
  ownerFolded?: boolean;
  ruleRevealed?: boolean;
}): PrivateCardVisibility {
  if (!input.visible) {
    return "hidden";
  }
  if (
    input.viewerRole !== "spectator" &&
    input.viewerParticipantId === input.ownerParticipantId
  ) {
    return "authorized";
  }
  return input.showdown && (!input.ownerFolded || input.ruleRevealed)
    ? "authorized"
    : "leak";
}

export function assertPrivateCardsAuthorized(
  input: Parameters<typeof classifyPrivateCardVisibility>[0],
  context: MechanicalAssertionContext
): void {
  const classification = classifyPrivateCardVisibility(input);
  assertProductCondition(classification !== "leak", {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: classification,
    threshold: "authorized or hidden"
  });
}
