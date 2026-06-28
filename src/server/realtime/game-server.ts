import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";
import { ClientMessageSchema } from "@/lib/realtime/messages";
import { applyPlayerAction, startHand, type RoomState } from "@/lib/poker/engine";
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

  options.server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "", "http://localhost").pathname;
    if (pathname !== path) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (upgradedSocket) => {
      wss.emit("connection", upgradedSocket, request);
    });
  });

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
      case "start_room":
        updatedRoom = startHand(room);
        await liveRooms.saveRoom(updatedRoom);
        break;
      case "player_action":
        validatePlayerAction(message, room, session);
        updatedRoom = applyPlayerAction(room, message.action);
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
): message is Extract<ClientMessage, { type: "join_room" | "start_room" | "player_action" | "quick_phrase" }> {
  return message.type === "join_room" || message.type === "start_room" || message.type === "player_action" || message.type === "quick_phrase";
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
