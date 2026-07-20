import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData } from "ws";
import {
  ClientMessageSchema,
  type ClientMessage,
  type RealtimeErrorCode,
  type ServerMessage
} from "@/lib/realtime/messages";
import {
  applyInsuranceDecision,
  applyPendingTopUps,
  applyPlayerAction,
  claimSeat,
  finalizeSession,
  getApplicableTopUps,
  kickParticipant as kickRoomParticipant,
  markDisconnected,
  queueTopUp,
  requestRoomEnd,
  startHand,
  type RoomState
} from "@/lib/poker/engine";
import { serializeCard } from "@/lib/poker/cards";
import { toParticipantView } from "@/lib/poker/visibility";
import type { LiveRoomStore } from "@/server/live-room-store";
import { RoomCommandCoordinator, RoomCommandError } from "@/server/room-command-coordinator";
import { RoomFlowController, type FlowTimerToken } from "@/server/room-flow-controller";
import { RoomRepository } from "@/server/repositories/room-repository";
import { SessionRegistry, type Session } from "./session-registry";

type GameRoomRepository = Pick<
  RoomRepository,
  "recordHand" | "recordBuyIn" | "recordTopUp" | "finishRoom" | "kickParticipant"
>;

export interface GameServerOptions {
  server: HttpServer;
  liveRooms: LiveRoomStore;
  auth: RealtimeAuth;
  roomRepository?: GameRoomRepository;
  path?: string;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  coordinator?: RoomCommandCoordinator;
}

export interface RealtimeAuth {
  verifyParticipantToken(roomId: string, token: string): Promise<string | null>;
  verifyHostToken(roomId: string, token: string): Promise<boolean>;
}

interface ScheduledRoomTimer {
  handle: unknown;
  token: FlowTimerToken;
}

interface GameContext {
  liveRooms: LiveRoomStore;
  auth: RealtimeAuth;
  roomRepository: GameRoomRepository;
  sessions: SessionRegistry;
  coordinator: RoomCommandCoordinator;
  flowController: RoomFlowController;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  timers: Map<string, ScheduledRoomTimer>;
}

class RealtimeCommandError extends Error {
  constructor(readonly code: RealtimeErrorCode, message: string) {
    super(message);
    this.name = "RealtimeCommandError";
  }
}

export function createGameServer(options: GameServerOptions): WebSocketServer {
  const path = options.path ?? "/ws";
  const now = options.now ?? Date.now;
  const context: GameContext = {
    liveRooms: options.liveRooms,
    auth: options.auth,
    roomRepository: options.roomRepository ?? new RoomRepository(),
    sessions: new SessionRegistry(),
    coordinator: options.coordinator ?? new RoomCommandCoordinator(),
    flowController: new RoomFlowController(now),
    now,
    setTimer: options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    timers: new Map()
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  wss.on("connection", (socket) => {
    const session = context.sessions.add("", null, socket);

    socket.on("message", (data) => {
      void handleIncomingMessage(context, session, data);
    });

    socket.on("close", () => {
      const previousRoomId = session.roomId;
      context.sessions.remove(session);
      clearTimerIfRoomEmpty(context, previousRoomId);
    });
  });

  Object.defineProperty(wss, "__gameServerPath", { value: path });
  return wss;
}

export function handleGameServerUpgrade(
  wss: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  path = "/ws"
): boolean {
  const pathname = new URL(request.url ?? "", "http://localhost").pathname;
  if (pathname !== path) {
    return false;
  }

  wss.handleUpgrade(request, socket, head, (upgradedSocket) => {
    wss.emit("connection", upgradedSocket, request);
  });
  return true;
}

async function handleIncomingMessage(context: GameContext, session: Session, data: RawData): Promise<void> {
  const message = parseClientMessage(data);
  if (!message) {
    sendError(session, "INVALID_MESSAGE", "Invalid message");
    return;
  }
  if (!isSupportedMessage(message)) {
    sendError(session, "INVALID_MESSAGE", `Unsupported message type: ${message.type}`);
    return;
  }

  try {
    await context.coordinator.run(
      message.roomId,
      () => handleClientCommand(context, session, message),
      "client"
    );
  } catch (error) {
    const coded = toCodedError(error);
    sendError(session, coded.code, coded.message);
  }
}

async function handleClientCommand(
  context: GameContext,
  session: Session,
  message: SupportedClientMessage
): Promise<void> {
  let room = await context.liveRooms.getRoom(message.roomId);
  if (!room) {
    throw new RealtimeCommandError("ROOM_NOT_FOUND", "Room not found");
  }

  room = await catchUpRoom(context, room, context.now());
  const previousSessionRoomId = session.roomId;
  await authenticateAndUpdateSession(context, session, message);
  if (previousSessionRoomId && previousSessionRoomId !== session.roomId) {
    clearTimerIfRoomEmpty(context, previousSessionRoomId);
  }

  if (message.type === "quick_phrase") {
    context.sessions.broadcast(room.roomId, () => ({
      type: "system_message",
      payload: { message: message.phrase }
    }));
    return;
  }

  switch (message.type) {
    case "join_room":
      broadcastSnapshot(context.sessions, room);
      scheduleRoomTimer(context, room);
      return;
    case "claim_seat": {
      const participantId = requireParticipant(session);
      const updated = claimSeat(room, participantId, message.displayName, message.seatNumber);
      await saveBroadcastAndSchedule(context, updated, []);
      return;
    }
    case "start_room": {
      requireHost(session);
      ensureRoomOpen(room);
      if (room.hand && !room.hand.finished) {
        throw new RealtimeCommandError("PRESENTATION_IN_PROGRESS", "A hand is already in progress");
      }
      const applicable = getApplicableTopUps(room);
      await persistTopUps(context, room, applicable);
      const applied = applyPendingTopUps(room);
      const started = startHand(applied, undefined, context.now());
      const events: ServerMessage[] = [
        ...buildTopUpAppliedEvents(room, applicable, started.hand!.number),
        { type: "hand_started", payload: { handNumber: started.hand!.number } }
      ];
      await saveBroadcastAndSchedule(context, started, events);
      return;
    }
    case "player_action": {
      ensurePlayableAction(room);
      validatePlayerAction(message, room, session);
      const updated = applyPlayerAction(room, message.action, context.now());
      if (updated.hand?.finished && !room.hand?.finished) {
        await context.roomRepository.recordHand(updated);
      }
      const events: ServerMessage[] = [
        {
          type: "action_recorded",
          payload: buildActionNotice(updated, message.action)
        },
        ...buildFlowTransitionEvents(room, updated)
      ];
      await saveBroadcastAndSchedule(context, updated, events);
      return;
    }
    case "insurance_decision": {
      if (room.flow.phase !== "insurance-pending") {
        throw new RealtimeCommandError("PRESENTATION_IN_PROGRESS", "Insurance is not awaiting a decision");
      }
      const participantId = requireParticipant(session);
      const updated = applyInsuranceDecision(room, participantId, message.accepted, context.now());
      if (updated.hand?.finished && !room.hand?.finished) {
        await context.roomRepository.recordHand(updated);
      }
      await saveBroadcastAndSchedule(context, updated, buildFlowTransitionEvents(room, updated));
      return;
    }
    case "rebuy": {
      const participantId = requireParticipant(session);
      const queued = queueTopUp(room, participantId, message.amount);
      const pending = queued.pendingTopUps[participantId];
      const events: ServerMessage[] = [{
        type: "top_up_queued",
        payload: {
          participantId,
          displayName: displayNameForParticipant(queued, participantId),
          submittedAmount: message.amount,
          pendingTotal: pending.amount,
          targetHandNumber: pending.targetHandNumber
        }
      }];

      if (queued.flow.phase === "betting" && queued.hand?.finished) {
        const applicable = getApplicableTopUps(queued);
        if (applicable.length > 0) {
          await persistTopUps(context, queued, applicable);
          const started = context.flowController.completeHandBoundary(queued, context.now());
          events.push(
            ...buildTopUpAppliedEvents(queued, applicable, started.hand!.number),
            { type: "hand_started", payload: { handNumber: started.hand!.number } }
          );
          await saveBroadcastAndSchedule(context, started, events);
          return;
        }
      }

      await saveBroadcastAndSchedule(context, queued, events);
      return;
    }
    case "end_room": {
      requireHost(session);
      ensureRoomOpen(room);
      const requested = requestRoomEnd(room);
      if (requested === room) {
        broadcastSnapshot(context.sessions, room);
        return;
      }
      const requestEvent: ServerMessage = {
        type: "room_end_requested",
        payload: { finalHandNumber: room.hand?.number ?? null }
      };
      if (!room.hand || room.hand.finished) {
        if (room.hand?.finished && room.flow.handResult === null) {
          await context.roomRepository.recordHand(room);
        }
        const finalized = finalizeSession(requested, context.now());
        await persistFinalSession(context, finalized);
        await saveBroadcastAndSchedule(context, finalized, [
          requestEvent,
          { type: "room_finished", payload: { players: finalized.sessionSummary ?? [] } }
        ]);
        return;
      }
      await saveBroadcastAndSchedule(context, requested, [requestEvent]);
      return;
    }
    case "kick_player": {
      requireHost(session);
      const targetSeat = room.seats.find((seat) => seat.participantId === message.participantId);
      if (!targetSeat) {
        throw new RealtimeCommandError("PARTICIPANT_NOT_FOUND", "Participant is not in the room");
      }
      const displayName = targetSeat.displayName ?? "A player";
      const updated = kickRoomParticipant(room, message.participantId, context.now());
      const revoked = await context.roomRepository.kickParticipant(
        room.roomId,
        message.participantId,
        new Date(context.now())
      );
      if (!revoked) {
        throw new RealtimeCommandError("PARTICIPANT_NOT_FOUND", "Participant is not in the room");
      }
      if (updated.hand?.finished && !room.hand?.finished) {
        await context.roomRepository.recordHand(updated);
      }
      await context.liveRooms.saveRoom(updated);
      context.sessions.evictParticipant(room.roomId, message.participantId, {
        type: "player_kicked",
        payload: { participantId: message.participantId, displayName }
      });
      broadcastSnapshot(context.sessions, updated);
      context.sessions.broadcast(room.roomId, () => ({
        type: "system_message",
        payload: { message: `${displayName} was removed by the host` }
      }));
      scheduleRoomTimer(context, updated);
      return;
    }
    case "handle_disconnect": {
      requireHost(session);
      if (message.handling !== "pause") {
        throw new RealtimeCommandError("INVALID_MESSAGE", `Unsupported disconnect handling: ${message.handling}`);
      }
      const updated = markDisconnected(room, message.participantId);
      await saveBroadcastAndSchedule(context, updated, []);
      return;
    }
  }
}

async function authenticateAndUpdateSession(
  context: GameContext,
  session: Session,
  message: SupportedClientMessage
): Promise<void> {
  const switchingRooms = session.roomId !== "" && session.roomId !== message.roomId;
  let participantId = switchingRooms ? null : session.participantId;
  let host = switchingRooms ? false : session.host;
  const participantToken = getParticipantToken(message);

  if (participantToken) {
    const verifiedParticipantId = await context.auth.verifyParticipantToken(message.roomId, participantToken);
    if (!verifiedParticipantId || (participantId && participantId !== verifiedParticipantId)) {
      throw new RealtimeCommandError("INVALID_PARTICIPANT_TOKEN", "Invalid participant token");
    }
    participantId = verifiedParticipantId;
  }

  if (hasHostToken(message)) {
    const verifiedHost = await context.auth.verifyHostToken(message.roomId, message.hostToken);
    if (!verifiedHost) {
      throw new RealtimeCommandError("INVALID_HOST_TOKEN", "Invalid host token");
    }
    host = true;
  }

  session.roomId = message.roomId;
  session.participantId = participantId;
  session.host = host;
}

async function catchUpRoom(context: GameContext, room: RoomState, now: number): Promise<RoomState> {
  let current = room;
  const caughtUp = context.flowController.catchUpDuePhases(current, now);
  if (caughtUp !== current) {
    if (caughtUp.hand?.finished && !current.hand?.finished) {
      await context.roomRepository.recordHand(caughtUp);
    }
    const events = buildFlowTransitionEvents(current, caughtUp);
    await saveBroadcastAndSchedule(context, caughtUp, events);
    current = caughtUp;
  }

  if (context.flowController.isHandBoundaryDue(current, now)) {
    current = await completeDueHandBoundary(context, current, now);
  }
  return current;
}

async function completeDueHandBoundary(context: GameContext, room: RoomState, now: number): Promise<RoomState> {
  if (room.hand?.finished && room.flow.handResult === null) {
    await context.roomRepository.recordHand(room);
  }

  if (room.endAfterCurrentHand) {
    const finalized = finalizeSession(room, now);
    await persistFinalSession(context, finalized);
    await saveBroadcastAndSchedule(context, finalized, [{
      type: "room_finished",
      payload: { players: finalized.sessionSummary ?? [] }
    }]);
    return finalized;
  }

  const applicable = getApplicableTopUps(room);
  await persistTopUps(context, room, applicable);
  const completed = context.flowController.completeHandBoundary(room, now);
  const events: ServerMessage[] = [];
  if (completed.hand?.number !== room.hand?.number) {
    events.push(
      ...buildTopUpAppliedEvents(room, applicable, completed.hand!.number),
      { type: "hand_started", payload: { handNumber: completed.hand!.number } }
    );
  }
  await saveBroadcastAndSchedule(context, completed, events);
  return completed;
}

async function persistTopUps(
  context: GameContext,
  room: RoomState,
  pendingTopUps: ReturnType<typeof getApplicableTopUps>
): Promise<void> {
  for (const pending of pendingTopUps) {
    await context.roomRepository.recordTopUp(room.roomId, pending);
  }
}

async function persistFinalSession(context: GameContext, room: RoomState): Promise<void> {
  if (room.sessionEndedAt === null || room.sessionSummary === null) {
    throw new Error("Final session state is incomplete");
  }
  await context.roomRepository.finishRoom(
    room.roomId,
    new Date(room.sessionEndedAt),
    room.sessionSummary
  );
}

async function saveBroadcastAndSchedule(
  context: GameContext,
  room: RoomState,
  events: ServerMessage[]
): Promise<void> {
  await context.liveRooms.saveRoom(room);
  broadcastSnapshot(context.sessions, room);
  for (const event of events) {
    context.sessions.broadcast(room.roomId, () => event);
  }
  scheduleRoomTimer(context, room);
}

function scheduleRoomTimer(context: GameContext, room: RoomState, minimumDelayMs = 0): void {
  clearRoomTimer(context, room.roomId);
  if (!context.sessions.hasRoom(room.roomId)) {
    return;
  }
  const token = context.flowController.timerToken(room);
  if (!token) {
    return;
  }

  const delay = Math.max(minimumDelayMs, token.deadlineAt - context.now(), 0);
  let handle: unknown;
  handle = context.setTimer(() => {
    const scheduled = context.timers.get(room.roomId);
    if (!scheduled || scheduled.handle !== handle) {
      return;
    }
    context.timers.delete(room.roomId);
    void context.coordinator.run(room.roomId, async () => {
      const latest = await context.liveRooms.getRoom(room.roomId);
      if (!latest || !context.flowController.matchesToken(latest, token)) {
        return;
      }
      await catchUpRoom(context, latest, context.now());
    }, "timer").catch(async () => {
      const latest = await context.liveRooms.getRoom(room.roomId).catch(() => null);
      if (latest && context.flowController.matchesToken(latest, token)) {
        scheduleRoomTimer(context, latest, 1_000);
      }
    });
  }, delay);
  context.timers.set(room.roomId, { handle, token });
}

function clearRoomTimer(context: GameContext, roomId: string): void {
  const scheduled = context.timers.get(roomId);
  if (!scheduled) {
    return;
  }
  context.clearTimer(scheduled.handle);
  context.timers.delete(roomId);
}

function clearTimerIfRoomEmpty(context: GameContext, roomId: string): void {
  if (roomId && !context.sessions.hasRoom(roomId)) {
    clearRoomTimer(context, roomId);
  }
}

function buildFlowTransitionEvents(previous: RoomState, next: RoomState): ServerMessage[] {
  const events: ServerMessage[] = [];
  if (
    next.flow.phase === "showdown-reveal" &&
    (previous.flow.phase !== "showdown-reveal" || previous.flow.sequence !== next.flow.sequence) &&
    next.hand &&
    next.flow.deadlineAt !== null
  ) {
    events.push({
      type: "showdown_started",
      payload: {
        handNumber: next.hand.number,
        phaseSequence: next.flow.sequence,
        revealedParticipantIds: next.hand.betting.players
          .filter((player) => !player.folded && (next.hand!.holeCardsByParticipantId[player.id]?.length ?? 0) === 2)
          .map((player) => player.id),
        deadline: next.flow.deadlineAt
      }
    });
  }

  const previousBoardLength = previous.hand?.board.length ?? 0;
  const nextBoardLength = next.hand?.board.length ?? 0;
  if (
    next.hand &&
    nextBoardLength === previousBoardLength + 1 &&
    next.flow.phase === "runout" &&
    next.flow.deadlineAt !== null
  ) {
    const boardIndex = nextBoardLength - 1;
    const street = boardIndex < 3 ? "flop" : boardIndex === 3 ? "turn" : "river";
    events.push({
      type: "runout_card_revealed",
      payload: {
        handNumber: next.hand.number,
        phaseSequence: next.flow.sequence,
        street,
        cardIndex: street === "flop" ? boardIndex : 0,
        card: serializeCard(next.hand.board[boardIndex]),
        deadline: next.flow.deadlineAt
      }
    });
  }

  if (next.hand?.finished && !previous.hand?.finished) {
    events.push({ type: "hand_finished", payload: buildHandFinishedNotice(next) });
  }
  return events;
}

function buildTopUpAppliedEvents(
  room: RoomState,
  topUps: ReturnType<typeof getApplicableTopUps>,
  handNumber: number
): ServerMessage[] {
  return topUps.map((pending) => ({
    type: "top_up_applied" as const,
    payload: {
      participantId: pending.participantId,
      displayName: displayNameForParticipant(room, pending.participantId),
      amount: pending.amount,
      handNumber
    }
  }));
}

function buildActionNotice(
  room: RoomState,
  action: Extract<ClientMessage, { type: "player_action" }>["action"]
): unknown {
  return {
    playerId: action.playerId,
    displayName: displayNameForParticipant(room, action.playerId),
    action
  };
}

function buildHandFinishedNotice(room: RoomState): unknown {
  const hand = room.hand;
  const result = room.flow.handResult;
  if (!hand || !result) {
    return null;
  }
  const showdownPlayers = hand.betting.players
    .filter((player) => !player.folded && (hand.holeCardsByParticipantId[player.id]?.length ?? 0) === 2)
    .map((player) => ({
      participantId: player.id,
      displayName: displayNameForParticipant(room, player.id),
      seatNumber: room.seats.find((seat) => seat.participantId === player.id)?.seatNumber ?? null,
      holeCards: hand.holeCardsByParticipantId[player.id].map(serializeCard)
    }));
  return {
    handNumber: result.handNumber,
    pot: result.pots.reduce((sum, pot) => sum + pot.amount, 0),
    board: result.board,
    players: result.players,
    pots: result.pots,
    ...(showdownPlayers.length >= 2 ? { showdownPlayers } : {}),
    winners: result.winnerParticipantIds.map((participantId) => ({
      participantId,
      displayName: displayNameForParticipant(room, participantId),
      seatNumber: room.seats.find((seat) => seat.participantId === participantId)?.seatNumber ?? null,
      amount: result.pots.reduce(
        (sum, pot) => sum + (pot.awardsByParticipantId[participantId] ?? 0),
        0
      )
    }))
  };
}

function parseClientMessage(data: RawData): ClientMessage | null {
  try {
    const result = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

type SupportedClientMessage = Extract<
  ClientMessage,
  {
    type:
      | "join_room"
      | "claim_seat"
      | "start_room"
      | "end_room"
      | "kick_player"
      | "player_action"
      | "insurance_decision"
      | "rebuy"
      | "quick_phrase"
      | "handle_disconnect";
  }
>;

function isSupportedMessage(message: ClientMessage): message is SupportedClientMessage {
  return [
    "join_room",
    "claim_seat",
    "start_room",
    "end_room",
    "kick_player",
    "player_action",
    "insurance_decision",
    "rebuy",
    "quick_phrase",
    "handle_disconnect"
  ].includes(message.type);
}

function getParticipantToken(message: SupportedClientMessage): string | null {
  return "participantToken" in message ? message.participantToken : null;
}

function hasHostToken(message: SupportedClientMessage): message is SupportedClientMessage & { hostToken: string } {
  return "hostToken" in message;
}

function requireParticipant(session: Session): string {
  if (!session.participantId) {
    throw new RealtimeCommandError("INVALID_PARTICIPANT_TOKEN", "Invalid participant token");
  }
  return session.participantId;
}

function requireHost(session: Session): void {
  if (!session.host) {
    throw new RealtimeCommandError("INVALID_HOST_TOKEN", "Invalid host token");
  }
}

function ensureRoomOpen(room: RoomState): void {
  if (room.status === "finished" || room.flow.phase === "session-summary") {
    throw new RealtimeCommandError("ROOM_FINISHED", "The room has already ended");
  }
}

function ensurePlayableAction(room: RoomState): void {
  ensureRoomOpen(room);
  if (room.flow.phase !== "betting" || !room.hand || room.hand.finished) {
    throw new RealtimeCommandError("PRESENTATION_IN_PROGRESS", "Wait for the current presentation to finish");
  }
}

function validatePlayerAction(
  message: Extract<ClientMessage, { type: "player_action" }>,
  room: RoomState,
  session: Session
): void {
  if (!session.participantId || session.participantId !== message.action.playerId) {
    throw new RealtimeCommandError("INVALID_PARTICIPANT_TOKEN", "Participant token does not match player action");
  }
  if (!room.seats.some((seat) => seat.participantId === session.participantId)) {
    throw new RealtimeCommandError("INVALID_PARTICIPANT_TOKEN", "Participant is not seated");
  }
}

function broadcastSnapshot(sessions: SessionRegistry, room: RoomState): void {
  sessions.broadcast(room.roomId, (target) => ({
    type: "room_snapshot",
    payload: toParticipantView(room, {
      participantId: target.participantId,
      role: target.participantId ? "player" : "spectator",
      host: target.host
    })
  }));
}

function displayNameForParticipant(room: RoomState, participantId: string): string {
  return room.seats.find((seat) => seat.participantId === participantId)?.displayName ?? "A player";
}

function toCodedError(error: unknown): { code: RealtimeErrorCode; message: string } {
  if (error instanceof RealtimeCommandError || error instanceof RoomCommandError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    const prefixedCode = /^([A-Z_]+):/.exec(error.message)?.[1] as RealtimeErrorCode | undefined;
    if (prefixedCode && isRealtimeErrorCode(prefixedCode)) {
      return { code: prefixedCode, message: error.message.replace(/^[A-Z_]+:\s*/, "") };
    }
  }
  return { code: "SERVER_BUSY", message: "The room is temporarily unavailable; please retry" };
}

function isRealtimeErrorCode(value: string): value is RealtimeErrorCode {
  return [
    "INVALID_MESSAGE",
    "ROOM_NOT_FOUND",
    "INVALID_PARTICIPANT_TOKEN",
    "INVALID_HOST_TOKEN",
    "PRESENTATION_IN_PROGRESS",
    "TOP_UP_NOT_ALLOWED",
    "TOP_UP_AMOUNT_INVALID",
    "ROOM_FINISHED",
    "SERVER_BUSY"
  ].includes(value);
}

function sendError(session: Session, code: RealtimeErrorCode, message: string): void {
  sendMessage(session.socket, { type: "error", payload: { code, message } });
}

function sendMessage(socket: { send(data: string): void }, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}
