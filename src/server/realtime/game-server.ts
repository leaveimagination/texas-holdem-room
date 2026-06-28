import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";
import { ClientMessageSchema } from "@/lib/realtime/messages";
import { applyPlayerAction, claimSeat, markDisconnected, rebuy, startHand, type RoomState } from "@/lib/poker/engine";
import { toParticipantView } from "@/lib/poker/visibility";
import type { LiveRoomStore } from "@/server/live-room-store";
import { SessionRegistry, type Session } from "./session-registry";

export interface GameServerOptions {
  server: HttpServer;
  liveRooms: LiveRoomStore;
  auth: RealtimeAuth;
  path?: string;
}

export interface RealtimeAuth {
  verifyParticipantToken(roomId: string, token: string): Promise<string | null>;
  verifyHostToken(roomId: string, token: string): Promise<boolean>;
}

export function createGameServer(options: GameServerOptions): WebSocketServer {
  const path = options.path ?? "/ws";
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new SessionRegistry();

  wss.on("connection", (socket) => {
    const session = sessions.add("", null, socket);

    socket.on("message", (data) => {
      void handleIncomingMessage(options.liveRooms, options.auth, sessions, session, data);
    });

    socket.on("close", () => {
      sessions.remove(session);
    });
  });

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

async function handleIncomingMessage(
  liveRooms: LiveRoomStore,
  auth: RealtimeAuth,
  sessions: SessionRegistry,
  session: Session,
  data: RawData
): Promise<void> {
  const message = parseClientMessage(data);
  if (!message) {
    sendMessage(session.socket, { type: "error", payload: { message: "Invalid message" } });
    return;
  }

  let updatedRoom: RoomState | null = null;

  try {
    const room = await liveRooms.getRoom(message.roomId);
    if (!room) {
      sendMessage(session.socket, { type: "error", payload: { message: "Room not found" } });
      return;
    }

    if (!isSupportedMessage(message)) {
      sendMessage(session.socket, { type: "error", payload: { message: `Unsupported message type: ${message.type}` } });
      return;
    }

    const switchingRooms = session.roomId !== "" && session.roomId !== message.roomId;
    const nextSession = {
      roomId: message.roomId,
      participantId: switchingRooms ? null : session.participantId,
      host: switchingRooms ? false : session.host
    };

    const participantToken = getParticipantToken(message);
    if (participantToken) {
      const participantId = await auth.verifyParticipantToken(message.roomId, participantToken);
      if (!participantId) {
        sendMessage(session.socket, { type: "error", payload: { message: "Invalid participant token" } });
        return;
      }

      if (nextSession.participantId && nextSession.participantId !== participantId) {
        sendMessage(session.socket, { type: "error", payload: { message: "Participant token mismatch" } });
        return;
      }

      nextSession.participantId = participantId;
    }

    if (hasHostToken(message)) {
      const host = await auth.verifyHostToken(message.roomId, message.hostToken);
      if (!host) {
        sendMessage(session.socket, { type: "error", payload: { message: "Invalid host token" } });
        return;
      }

      nextSession.host = true;
    }

    session.roomId = nextSession.roomId;
    session.participantId = nextSession.participantId;
    session.host = nextSession.host;

    if (message.type === "quick_phrase") {
      sessions.broadcast(message.roomId, () => ({
        type: "system_message",
        payload: { message: message.phrase }
      }));
      return;
    }

    updatedRoom = room;

    switch (message.type) {
      case "join_room":
        break;
      case "claim_seat":
        if (!session.participantId) {
          throw new Error("Participant token mismatch");
        }
        updatedRoom = claimSeat(room, session.participantId, message.displayName, message.seatNumber);
        await liveRooms.saveRoom(updatedRoom);
        break;
      case "start_room":
        updatedRoom = startHand(room);
        await liveRooms.saveRoom(updatedRoom);
        break;
      case "player_action":
        validatePlayerAction(message, room, session);
        updatedRoom = applyPlayerAction(room, message.action);
        await liveRooms.saveRoom(updatedRoom);
        break;
      case "rebuy":
        if (!session.participantId) {
          throw new Error("Participant token mismatch");
        }
        updatedRoom = rebuy(room, session.participantId, message.amount);
        await liveRooms.saveRoom(updatedRoom);
        break;
      case "handle_disconnect":
        if (!session.host) {
          throw new Error("Host token required");
        }
        if (message.handling !== "pause") {
          throw new Error(`Unsupported disconnect handling: ${message.handling}`);
        }
        updatedRoom = markDisconnected(room, message.participantId);
        await liveRooms.saveRoom(updatedRoom);
        break;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unable to process message";
    sendMessage(session.socket, { type: "error", payload: { message: messageText } });
    return;
  }

  if (updatedRoom) {
    broadcastSnapshot(sessions, updatedRoom);
  }
}

function parseClientMessage(data: RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(data.toString());
    const result = ClientMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function getParticipantToken(message: ClientMessage): string | null {
  return "participantToken" in message ? message.participantToken : null;
}

function hasHostToken(message: ClientMessage): message is ClientMessage & { hostToken: string } {
  return "hostToken" in message;
}

function isSupportedMessage(
  message: ClientMessage
): message is Extract<
  ClientMessage,
  { type: "join_room" | "claim_seat" | "start_room" | "player_action" | "rebuy" | "quick_phrase" | "handle_disconnect" }
> {
  return (
    message.type === "join_room" ||
    message.type === "claim_seat" ||
    message.type === "start_room" ||
    message.type === "player_action" ||
    message.type === "rebuy" ||
    message.type === "quick_phrase" ||
    message.type === "handle_disconnect"
  );
}

function validatePlayerAction(message: Extract<ClientMessage, { type: "player_action" }>, room: RoomState, session: Session): void {
  if (session.participantId !== message.action.playerId) {
    throw new Error("Participant token does not match player action");
  }

  const seat = room.seats.find((candidate) => candidate.participantId === session.participantId);
  if (!seat) {
    throw new Error("Participant is not seated");
  }

  if (!session.participantId) {
    throw new Error("Participant token mismatch");
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

function sendMessage(socket: { send(data: string): void }, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}
