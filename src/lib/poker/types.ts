import type { Card } from "./cards";

export type RoomMode = "cash" | "tournament";
export type Street = "preflop" | "flop" | "turn" | "river";
export type SeatStatus = "empty" | "seated" | "ready" | "active" | "folded" | "all-in" | "eliminated" | "disconnected";

export interface BettingPlayer {
  id: string;
  stack: number;
  committed: number;
  streetCommitted: number;
  folded: boolean;
  allIn: boolean;
}

export interface BettingState {
  street: Street;
  currentBet: number;
  minRaise: number;
  actorId: string;
  players: BettingPlayer[];
}

export type LegalAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call"; amount: number }
  | { type: "bet"; minAmountTo: number; maxAmountTo: number }
  | { type: "raise"; minAmountTo: number; maxAmountTo: number }
  | { type: "all-in"; amountTo: number };

export type BettingAction =
  | { type: "fold"; playerId: string }
  | { type: "check"; playerId: string }
  | { type: "call"; playerId: string }
  | { type: "bet"; playerId: string; amountTo: number }
  | { type: "raise"; playerId: string; amountTo: number }
  | { type: "all-in"; playerId: string };

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface Seat {
  seatNumber: number;
  participantId: string | null;
  displayName: string | null;
  chips: number;
  status: SeatStatus;
  cumulativeBuyIn: number;
  holeCards?: Card[];
}

export type TableFlowPhase =
  | "betting"
  | "insurance-pending"
  | "showdown-reveal"
  | "runout"
  | "hand-summary"
  | "session-summary";

export interface RunoutStep {
  street: "flop" | "turn" | "river";
  cardIndexOnStreet: number;
}

export interface PendingTopUp {
  participantId: string;
  targetHandNumber: number;
  amount: number;
  requestCount: number;
}

export interface PotAward {
  potIndex: number;
  amount: number;
  eligibleParticipantIds: string[];
  awardsByParticipantId: Record<string, number>;
}

export interface HandPlayerResult {
  participantId: string;
  displayName: string;
  seatNumber: number;
  startingChips: number;
  committedChips: number;
  potAward: number;
  insuranceDelta: number;
  endingChips: number;
  netChips: number;
}

export interface HandResult {
  handNumber: number;
  board: string[];
  winnerParticipantIds: string[];
  players: HandPlayerResult[];
  pots: PotAward[];
}

export interface SessionPlayerResult {
  participantId: string;
  displayName: string;
  initialChips: number;
  topUpChips: number;
  finalChips: number;
  netChips: number;
}

export interface TableFlowState {
  phase: TableFlowPhase;
  sequence: number;
  deadlineAt: number | null;
  nextRunoutStep: RunoutStep | null;
  handResult: HandResult | null;
}
