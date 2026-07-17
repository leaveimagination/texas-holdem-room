import type { ServerMessage } from "@/lib/realtime/messages";

export interface SendableSocket {
  send(data: string): void;
}

export interface Session {
  roomId: string;
  participantId: string | null;
  host: boolean;
  socket: SendableSocket;
}

export class SessionRegistry {
  private readonly sessions = new Set<Session>();

  add(roomId: string, participantId: string | null, socket: SendableSocket, host = false): Session {
    const session: Session = { roomId, participantId, host, socket };
    this.sessions.add(session);
    return session;
  }

  remove(session: Session): void {
    this.sessions.delete(session);
  }

  hasRoom(roomId: string): boolean {
    for (const session of this.sessions) {
      if (session.roomId === roomId) {
        return true;
      }
    }
    return false;
  }

  broadcast(roomId: string, makeMessage: (session: Session) => ServerMessage): void {
    for (const session of this.sessions) {
      if (session.roomId !== roomId) {
        continue;
      }

      session.socket.send(JSON.stringify(makeMessage(session)));
    }
  }
}
