import { deckWithTopCards } from "./deck";
import { sanitizeSiteTestRunId } from "../../../scripts/site-test/contracts";
import type {
  ExpectedPot,
  ExpectedTransition,
  FixtureBuildInput,
  FixtureParticipant,
  FixturePlayerAction,
  FixtureScenarioAction,
  PokerFixture
} from "./types";

type NormalRole = "button" | "small" | "big";
type RankedRole = "aces" | "kings" | "queens" | "jacks";
type SplitRole = "left" | "right";
type TopUpRole = "target" | "opponent";
type ReconnectPlayerRole = "actor" | "opponent";

const BOARD = ["2c", "7d", "9h", "3s", "4c"] as const;
const FOUR_WAY_TOP_CARDS = [
  "As", "Kh", "Qc", "Jd", "Ah", "Kd", "Qh", "Js",
  ...BOARD
] as const;

export function buildNormalBettingFixture(
  input: FixtureBuildInput<NormalRole>
): PokerFixture<NormalRole, {
  holeCardsByRole: Record<NormalRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  transitions: readonly ExpectedTransition<NormalRole>[];
}> {
  const topCards = [
    "Kc", "Qc", "As", "Kd", "Qd", "Ah",
    ...BOARD
  ] as const;
  const actionPlan: FixturePlayerAction<NormalRole>[] = [
    playerAction("normal-01", "button", "preflop", { type: "call" }),
    playerAction("normal-02", "small", "preflop", { type: "call" }),
    playerAction("normal-03", "big", "preflop", { type: "check" }),
    playerAction("normal-04", "small", "flop", { type: "check" }),
    playerAction("normal-05", "big", "flop", { type: "bet", amountTo: 20 }),
    playerAction("normal-06", "button", "flop", { type: "raise", amountTo: 40 }),
    playerAction("normal-07", "small", "flop", { type: "fold" }),
    playerAction("normal-08", "big", "flop", { type: "call" }),
    playerAction("normal-09", "big", "turn", { type: "check" }),
    playerAction("normal-10", "button", "turn", { type: "check" }),
    playerAction("normal-11", "big", "river", { type: "bet", amountTo: 20 }),
    playerAction("normal-12", "button", "river", { type: "call" })
  ];

  return {
    id: "normal-betting",
    settings: cashSettings(3, 200),
    participants: [
      participant(input, "button", 1, 200),
      participant(input, "small", 2, 200),
      participant(input, "big", 3, 200)
    ],
    topCards,
    deck: deckWithTopCards(topCards),
    startHand: true,
    actionPlan,
    oracle: {
      holeCardsByRole: {
        button: ["As", "Ah"],
        small: ["Kc", "Kd"],
        big: ["Qc", "Qd"]
      },
      expectedBoard: BOARD,
      transitions: [
        expectedTransition("normal-01", "small", "preflop", 50, 0, ["fold", "call", "raise", "all-in"]),
        expectedTransition("normal-02", "big", "preflop", 60, 0, ["check", "raise", "all-in"]),
        expectedTransition("normal-03", "small", "flop", 60, 3, ["check", "bet", "all-in"]),
        expectedTransition("normal-04", "big", "flop", 60, 3, ["check", "bet", "all-in"]),
        expectedTransition("normal-05", "button", "flop", 80, 3, ["fold", "call", "raise", "all-in"]),
        expectedTransition("normal-06", "small", "flop", 120, 3, ["fold", "call", "raise", "all-in"]),
        expectedTransition("normal-07", "big", "flop", 120, 3, ["fold", "call", "raise", "all-in"]),
        expectedTransition("normal-08", "big", "turn", 140, 4, ["check", "bet", "all-in"]),
        expectedTransition("normal-09", "button", "turn", 140, 4, ["check", "bet", "all-in"]),
        expectedTransition("normal-10", "big", "river", 140, 5, ["check", "bet", "all-in"]),
        expectedTransition("normal-11", "button", "river", 160, 5, ["fold", "call", "raise", "all-in"]),
        expectedTransition<NormalRole>("normal-12", null, "river", 180, 5, [])
      ]
    }
  };
}

export function buildFourPlayerAllInFixture(
  input: FixtureBuildInput<RankedRole>
): PokerFixture<RankedRole, {
  holeCardsByRole: Record<RankedRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  pots: readonly ExpectedPot<RankedRole>[];
}> {
  return {
    id: "four-player-all-in",
    settings: tournamentSettings(4, 100),
    participants: rankedParticipants(input, [100, 100, 100, 100]),
    topCards: FOUR_WAY_TOP_CARDS,
    deck: deckWithTopCards(FOUR_WAY_TOP_CARDS),
    startHand: true,
    actionPlan: fourWayAllInActions(),
    oracle: {
      holeCardsByRole: rankedHoleCards(),
      expectedBoard: BOARD,
      pots: [{
        amount: 400,
        eligibleRoles: ["jacks", "aces", "kings", "queens"],
        awardsByRole: { aces: 400 }
      }]
    }
  };
}

export function buildSidePotFixture(
  input: FixtureBuildInput<RankedRole>
): PokerFixture<RankedRole, {
  holeCardsByRole: Record<RankedRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  stackTiers: readonly number[];
  pots: readonly ExpectedPot<RankedRole>[];
  totalAwardsByRole: Record<RankedRole, number>;
}> {
  return {
    id: "side-pot",
    settings: tournamentSettings(4, 300),
    participants: rankedParticipants(input, [100, 200, 300, 300]),
    topCards: FOUR_WAY_TOP_CARDS,
    deck: deckWithTopCards(FOUR_WAY_TOP_CARDS),
    startHand: true,
    actionPlan: fourWayAllInActions(),
    oracle: {
      holeCardsByRole: rankedHoleCards(),
      expectedBoard: BOARD,
      stackTiers: [100, 200, 300, 300],
      pots: [
        {
          amount: 400,
          eligibleRoles: ["jacks", "aces", "kings", "queens"],
          awardsByRole: { aces: 400 }
        },
        {
          amount: 300,
          eligibleRoles: ["jacks", "kings", "queens"],
          awardsByRole: { kings: 300 }
        },
        {
          amount: 200,
          eligibleRoles: ["jacks", "queens"],
          awardsByRole: { queens: 200 }
        }
      ],
      totalAwardsByRole: { aces: 400, kings: 300, queens: 200, jacks: 0 }
    }
  };
}

export function buildSplitPotFixture(
  input: FixtureBuildInput<SplitRole>
): PokerFixture<SplitRole, {
  holeCardsByRole: Record<SplitRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  boardHand: string;
  pots: readonly ExpectedPot<SplitRole>[];
}> {
  const topCards = ["As", "Kd", "Ah", "Qd", "5c", "6d", "7h", "8s", "9c"] as const;
  return {
    id: "split-pot",
    settings: tournamentSettings(2, 100),
    participants: [
      participant(input, "left", 1, 100),
      participant(input, "right", 2, 100)
    ],
    topCards,
    deck: deckWithTopCards(topCards),
    startHand: true,
    actionPlan: [
      playerAction("split-01", "left", "preflop", { type: "all-in" }),
      playerAction("split-02", "right", "preflop", { type: "call" })
    ],
    oracle: {
      holeCardsByRole: { left: ["Kd", "Qd"], right: ["As", "Ah"] },
      expectedBoard: ["5c", "6d", "7h", "8s", "9c"],
      boardHand: "nine-high straight",
      pots: [{
        amount: 200,
        eligibleRoles: ["left", "right"],
        awardsByRole: { left: 100, right: 100 }
      }]
    }
  };
}

export function buildTopUpAccountingFixture(
  input: FixtureBuildInput<TopUpRole>
): PokerFixture<TopUpRole, {
  holeCardsByRole: Record<TopUpRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  queuedAmounts: readonly number[];
  pendingTotal: number;
  currentHandTargetStackBeforeQueue: number;
  currentHandTargetStackAfterQueue: number;
  nextHandTargetCumulativeBuyIn: number;
  appliedAtHandNumber: number;
  applicationCount: number;
  handAwards: ReadonlyArray<{ handNumber: number; pot: number; awardsByRole: Partial<Record<TopUpRole, number>> }>;
  finalRows: ReadonlyArray<{ role: TopUpRole; initialChips: number; topUpChips: number; finalChips: number; netChips: number }>;
  finalChipTotal: number;
}, FixtureScenarioAction<TopUpRole>> {
  const topCards = ["As", "Kh", "Ah", "Kd", ...BOARD] as const;
  return {
    id: "top-up-accounting",
    settings: cashSettings(2, 1_000),
    participants: [
      participant(input, "target", 1, 1_000),
      participant(input, "opponent", 2, 1_000)
    ],
    topCards,
    deck: deckWithTopCards(topCards),
    startHand: true,
    actionPlan: [
      { kind: "top-up", id: "topup-01", actorRole: "target", handNumber: 1, amount: 300 },
      { kind: "top-up", id: "topup-02", actorRole: "target", handNumber: 1, amount: 200 },
      playerAction("topup-03", "target", "preflop", { type: "fold" }),
      {
        kind: "wait-for-state",
        id: "topup-04",
        actorRole: "harness",
        handNumber: 2,
        phase: "betting",
        pendingTopUpByRole: { target: 0 }
      },
      { kind: "request-room-end", id: "topup-05", actorRole: "host", handNumber: 2 },
      playerAction("topup-06", "opponent", "preflop", { type: "fold" }, 2)
    ],
    oracle: {
      holeCardsByRole: { target: ["Kh", "Kd"], opponent: ["As", "Ah"] },
      expectedBoard: BOARD,
      queuedAmounts: [300, 200],
      pendingTotal: 500,
      currentHandTargetStackBeforeQueue: 990,
      currentHandTargetStackAfterQueue: 990,
      nextHandTargetCumulativeBuyIn: 1_500,
      appliedAtHandNumber: 2,
      applicationCount: 1,
      handAwards: [
        { handNumber: 1, pot: 30, awardsByRole: { opponent: 30 } },
        { handNumber: 2, pot: 30, awardsByRole: { target: 30 } }
      ],
      finalRows: [
        { role: "target", initialChips: 1_000, topUpChips: 500, finalChips: 1_500, netChips: 0 },
        { role: "opponent", initialChips: 1_000, topUpChips: 0, finalChips: 1_000, netChips: 0 }
      ],
      finalChipTotal: 2_500
    }
  };
}

export function buildReconnectFixture(
  input: FixtureBuildInput<ReconnectPlayerRole>
): PokerFixture<ReconnectPlayerRole, {
  holeCardsByRole: Record<ReconnectPlayerRole, readonly [string, string]>;
  expectedBoard: readonly string[];
  presentation: ReadonlyArray<{
    phase: "showdown-reveal" | "runout" | "hand-summary";
    sequence: number;
    deadlineAtMs: number;
    board: readonly string[];
  }>;
  subcases: ReadonlyArray<{
    role: "actor" | "host" | "spectator";
    timing: "before-action" | "before-deadline" | "after-deadline";
    disconnectAtMs: number;
    expectedHandNumber: number;
    expectedFlowSequence: number;
    expectedActionIds: readonly string[];
    expectedBoard: readonly string[];
  }>;
}> {
  const topCards = ["As", "Kh", "Ah", "Kd", ...BOARD] as const;
  return {
    id: "reconnect",
    settings: tournamentSettings(2, 100),
    participants: [
      participant(input, "actor", 1, 100),
      participant(input, "opponent", 2, 100)
    ],
    topCards,
    deck: deckWithTopCards(topCards),
    startHand: true,
    actionPlan: [
      playerAction("H1-A001", "actor", "preflop", { type: "all-in" }),
      playerAction("H1-A002", "opponent", "preflop", { type: "call" })
    ],
    oracle: {
      holeCardsByRole: { actor: ["Kh", "Kd"], opponent: ["As", "Ah"] },
      expectedBoard: BOARD,
      presentation: [
        { phase: "showdown-reveal", sequence: 1, deadlineAtMs: 2_000, board: [] },
        { phase: "runout", sequence: 2, deadlineAtMs: 3_000, board: ["2c"] },
        { phase: "runout", sequence: 3, deadlineAtMs: 4_000, board: ["2c", "7d"] },
        { phase: "runout", sequence: 4, deadlineAtMs: 6_000, board: ["2c", "7d", "9h"] },
        { phase: "runout", sequence: 5, deadlineAtMs: 8_000, board: ["2c", "7d", "9h", "3s"] },
        { phase: "runout", sequence: 6, deadlineAtMs: 10_000, board: [...BOARD] },
        { phase: "hand-summary", sequence: 7, deadlineAtMs: 12_000, board: [...BOARD] }
      ],
      subcases: [
        {
          role: "actor",
          timing: "before-action",
          disconnectAtMs: 0,
          expectedHandNumber: 1,
          expectedFlowSequence: 0,
          expectedActionIds: [],
          expectedBoard: []
        },
        {
          role: "host",
          timing: "before-deadline",
          disconnectAtMs: 1_500,
          expectedHandNumber: 1,
          expectedFlowSequence: 1,
          expectedActionIds: ["H1-A001", "H1-A002"],
          expectedBoard: []
        },
        {
          role: "spectator",
          timing: "after-deadline",
          disconnectAtMs: 2_001,
          expectedHandNumber: 1,
          expectedFlowSequence: 2,
          expectedActionIds: ["H1-A001", "H1-A002"],
          expectedBoard: ["2c"]
        }
      ]
    }
  };
}

function cashSettings(seats: number, initialChips: number) {
  return {
    mode: "cash" as const,
    seats,
    initialChips,
    smallBlind: 10,
    bigBlind: 20,
    actionTimerSeconds: null
  };
}

function tournamentSettings(seats: number, initialChips: number) {
  return {
    mode: "tournament" as const,
    seats,
    initialChips,
    smallBlind: 10,
    bigBlind: 20,
    actionTimerSeconds: null,
    blindIncrease: { type: "hands" as const, interval: 5 }
  };
}

function participant<Role extends string>(
  input: FixtureBuildInput<Role>,
  role: Role,
  seatNumber: number,
  startingChips: number
): FixtureParticipant<Role> {
  const sanitizedRunId = sanitizeSiteTestRunId(input.runId);
  if (sanitizedRunId !== input.runId) {
    throw new Error(`Fixture run ID must use its sanitized form: ${sanitizedRunId}`);
  }
  const participantId = input.participantIds[role];
  if (typeof participantId !== "string" || participantId.length === 0) {
    throw new Error(`Missing participant ID for fixture role: ${role}`);
  }
  const displayName = `SITE-${input.runId}-${role}`;
  if (displayName.length > 24) {
    throw new Error(`Ownership marker exceeds the 24-character nickname limit: ${displayName}`);
  }
  return { role, participantId, displayName, seatNumber, startingChips };
}

function rankedParticipants(
  input: FixtureBuildInput<RankedRole>,
  stacks: readonly [number, number, number, number]
): FixtureParticipant<RankedRole>[] {
  return [
    participant(input, "aces", 2, stacks[0]),
    participant(input, "kings", 3, stacks[1]),
    participant(input, "queens", 4, stacks[2]),
    participant(input, "jacks", 1, stacks[3])
  ];
}

function rankedHoleCards(): Record<RankedRole, readonly [string, string]> {
  return {
    aces: ["As", "Ah"],
    kings: ["Kh", "Kd"],
    queens: ["Qc", "Qh"],
    jacks: ["Jd", "Js"]
  };
}

function fourWayAllInActions(): FixturePlayerAction<RankedRole>[] {
  return [
    playerAction("allin-01", "queens", "preflop", { type: "all-in" }),
    playerAction("allin-02", "jacks", "preflop", { type: "all-in" }),
    playerAction("allin-03", "aces", "preflop", { type: "all-in" }),
    playerAction("allin-04", "kings", "preflop", { type: "call" })
  ];
}

function playerAction<Role extends string>(
  id: string,
  actorRole: Role,
  street: FixturePlayerAction<Role>["street"],
  action: FixturePlayerAction<Role>["action"],
  handNumber = 1
): FixturePlayerAction<Role> {
  return { kind: "player-action", id, actorRole, handNumber, street, action };
}

function expectedTransition<Role extends string>(
  afterActionId: string,
  actorRole: Role | null,
  street: ExpectedTransition<Role>["street"],
  pot: number,
  boardLength: number,
  legalPrimaryActions: ExpectedTransition<Role>["legalPrimaryActions"]
): ExpectedTransition<Role> {
  return { afterActionId, actorRole, street, pot, boardLength, legalPrimaryActions };
}
