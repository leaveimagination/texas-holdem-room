import type { Card } from "@/lib/poker/cards";
import type { RoomSettings } from "@/lib/room/settings";
import type { RunResourceRecord } from "../evidence/contracts";
import type { KnownSecret } from "../evidence/redaction";

export type FixtureStreet = "preflop" | "flop" | "turn" | "river";
export type FixturePrimaryAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface FixtureBuildInput<Role extends string> {
  runId: string;
  participantIds: Record<Role, string>;
}

export interface FixtureParticipant<Role extends string = string> {
  role: Role;
  participantId: string;
  displayName: string;
  seatNumber: number;
  startingChips: number;
}

export type FixtureBettingAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amountTo: number }
  | { type: "raise"; amountTo: number }
  | { type: "all-in" };

export interface FixturePlayerAction<Role extends string = string> {
  kind: "player-action";
  id: string;
  actorRole: Role;
  handNumber: number;
  street: FixtureStreet;
  action: FixtureBettingAction;
}

export interface FixtureTopUpAction<Role extends string = string> {
  kind: "top-up";
  id: string;
  actorRole: Role;
  handNumber: number;
  amount: number;
}

export interface FixtureRoomEndAction {
  kind: "request-room-end";
  id: string;
  actorRole: "host";
  handNumber: number;
}

export interface FixtureWaitForStateAction<Role extends string = string> {
  kind: "wait-for-state";
  id: string;
  actorRole: "harness";
  handNumber: number;
  phase: "betting";
  pendingTopUpByRole: Readonly<Partial<Record<Role, number>>>;
}

export type FixtureScenarioAction<Role extends string = string> =
  | FixturePlayerAction<Role>
  | FixtureTopUpAction<Role>
  | FixtureRoomEndAction
  | FixtureWaitForStateAction<Role>;

export interface ExpectedPot<Role extends string = string> {
  amount: number;
  eligibleRoles: readonly Role[];
  awardsByRole: Readonly<Partial<Record<Role, number>>>;
}

export interface ExpectedTransition<Role extends string = string> {
  afterActionId: string;
  actorRole: Role | null;
  street: FixtureStreet;
  pot: number;
  boardLength: number;
  legalPrimaryActions: readonly FixturePrimaryAction[];
}

export interface PokerFixture<
  Role extends string = string,
  Oracle = unknown,
  Action extends FixtureScenarioAction<Role> = FixturePlayerAction<Role>
> {
  id: string;
  settings: RoomSettings;
  participants: readonly FixtureParticipant<Role>[];
  topCards: readonly string[];
  deck: Card[];
  startHand: true;
  actionPlan: readonly Action[];
  oracle: Oracle;
}

export interface KnownSecretRegistry {
  add(secret: KnownSecret): unknown;
}

export interface CreatedRoomIdentity {
  roomId: string;
  inviteUrl: string;
  hostToken: string;
}

export interface JoinedPlayerCredential {
  participantId: string;
  participantToken: string;
  displayName: string;
}

export interface JoinedPlayerIdentity extends JoinedPlayerCredential {
  role: string;
}

export interface BrowserJoinRequest {
  method(): string;
}

export interface BrowserJoinResponse {
  url(): string;
  request(): BrowserJoinRequest;
  json(): Promise<unknown>;
}

export interface BrowserJoinLocator {
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  waitFor(options: { state: "hidden" }): Promise<void>;
}

export interface BrowserJoinPage {
  goto(url: string): Promise<unknown>;
  waitForResponse(
    predicate: (response: BrowserJoinResponse) => boolean
  ): Promise<BrowserJoinResponse>;
  getByRole(
    role: "textbox" | "button" | "dialog",
    options: { name: string }
  ): BrowserJoinLocator;
  evaluate(pageFunction: () => unknown): Promise<unknown>;
  url(): string;
}

export interface BrowserFixtureIdentity {
  role: string;
  participantId: string;
  displayName: string;
  traceReady: true;
  safeUrl: string;
}

export interface FixtureTargetEnvironment {
  readonly name: string;
  readonly kind: "isolated";
  readonly runId: string;
  readonly baseUrl: string;
  readonly redisUrl: string;
}

export type FixtureRunResourceRecord = RunResourceRecord;
