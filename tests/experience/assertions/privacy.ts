import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export type PrivateCardVisibility = "authorized" | "hidden" | "leak";

export interface PrivateCardVisibilityInput {
  visible: boolean;
  viewerRole: "host" | "player" | "spectator";
  viewerParticipantId?: string | null;
  ownerParticipantId: string;
  showdown: boolean;
  ownerFolded: boolean;
  futureCard: boolean;
  documentedRevealAuthority: boolean;
}

export function classifyPrivateCardVisibility(
  input: PrivateCardVisibilityInput
): PrivateCardVisibility {
  if (!input.visible) {
    return "hidden";
  }
  if (input.futureCard !== false) {
    return "leak";
  }
  if (
    input.viewerRole !== "spectator" &&
    input.viewerParticipantId === input.ownerParticipantId
  ) {
    return "authorized";
  }
  return input.showdown === true &&
      input.ownerFolded === false &&
      input.documentedRevealAuthority === true
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
