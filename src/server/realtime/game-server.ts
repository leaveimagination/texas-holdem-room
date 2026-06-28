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
}

export function createGameServer(options: GameServerOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: options.server });
  const sessions = new SessionRegistry();

  wss.on("connection", (socket) => {
    const session = sessions.add("", null, socket);

    socket.on("message", (data) => {
      void handleIncomingMessage(options.liveRooms, sessions, session, data);
    });

    socket.on("close", () => {
      sessions.remove(session);
    });
  });

  return wss;
}

async function handleIncomingMessage(
  liveRooms: LiveRoomStore,
  sessions: SessionRegistry,
  session: Session,
  data: RawData
): Promise<void> {
  const message = parseClientMessage(data);
  if (!message) {
    sendMessage(session.socket, { type: "error", payload: { message: "Invalid message" } });
    return;
  }

  session.roomId = message.roomId;

  const room = await liveRooms.getRoom(message.roomId);
  if (!room) {
    sendMessage(session.socket, { type: "error", payload: { message: "Room not found" } });
    return;
  }

  const participantToken = getParticipantToken(message);
  if (participantToken) {
    if (session.participantId && session.participantId !== participantToken) {
      sendMessage(session.socket, { type: "error", payload: { message: "Participant token mismatch" } });
      return;
    }

    session.participantId = participantToken;
  }

  if (hasHostToken(message)) {
    session.host = true;
  }

  if (message.type === "quick_phrase") {
    sessions.broadcast(message.roomId, () => ({
      type: "system_message",
      payload: { message: message.phrase }
    }));
    return;
  }

  let updatedRoom = room;

  try {
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
      default:
        sendMessage(session.socket, { type: "error", payload: { message: `Unsupported message type: ${message.type}` } });
        return;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unable to process message";
    sendMessage(session.socket, { type: "error", payload: { message: messageText } });
    return;
  }

  broadcastSnapshot(sessions, updatedRoom);
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

function hasHostToken(message: ClientMessage): boolean {
  return "hostToken" in message;
}

function validatePlayerAction(message: Extract<ClientMessage, { type: "player_action" }>, room: RoomState, session: Session): void {
  if (message.participantToken !== message.action.playerId) {
    throw new Error("Participant token does not match player action");
  }

  const seat = room.seats.find((candidate) => candidate.participantId === message.participantToken);
  if (!seat) {
    throw new Error("Participant is not seated");
  }

  if (session.participantId !== message.participantToken) {
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
