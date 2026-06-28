"use client";

import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { PokerTable } from "@/components/table/PokerTable";
import { SystemLog } from "@/components/table/SystemLog";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import type { ServerMessage } from "@/lib/realtime/messages";

export function RoomClient({ roomId }: { roomId: string }) {
  const { connected, error, messages } = useRoomSocket(roomId);
  const roomView = findLatestPayload(messages, ["room_snapshot", "table_update"]);
  const legalActions = findLatestPayload(messages, ["legal_actions"]);

  return (
    <main className="room-page">
      <header className="room-header">
        <div>
          <p className="eyebrow">Private room</p>
          <h1>Room {roomId}</h1>
        </div>
        <span className={connected ? "status-pill is-connected" : "status-pill"}>{connected ? "Connected" : "Connecting"}</span>
      </header>

      <section className="join-panel" aria-label="Join flow">
        <JoinRoomForm roomId={roomId} />
        {error ? <p className="inline-alert" role="status">{error}</p> : null}
      </section>

      <PokerTable view={roomView} legalActions={legalActions} />
      <SystemLog messages={messages} />
    </main>
  );
}

function findLatestPayload(messages: ServerMessage[], types: ServerMessage["type"][]): unknown {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (types.includes(message.type)) {
      return message.payload;
    }
  }

  return null;
}
