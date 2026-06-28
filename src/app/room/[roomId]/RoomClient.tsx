"use client";

import { useState } from "react";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { PokerTable } from "@/components/table/PokerTable";
import { SystemLog } from "@/components/table/SystemLog";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";

export function RoomClient({ roomId }: { roomId: string }) {
  const { connected, error, messages, send } = useRoomSocket(roomId);
  const [displayName, setDisplayName] = useState("Player");
  const [hasParticipantToken, setHasParticipantToken] = useState(() => Boolean(getParticipantToken(roomId)));
  const roomView = findLatestPayload(messages, ["room_snapshot", "table_update"]);
  const legalActions = findLatestPayload(messages, ["legal_actions"]);
  const hostToken = readHostToken();

  function joinRoom(displayName: string, participantToken: string | null) {
    setDisplayName(displayName);
    setHasParticipantToken(Boolean(participantToken));
    send({ type: "join_room", roomId, participantToken, displayName });
  }

  function claimSeat(seatNumber: number) {
    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "claim_seat", roomId, participantToken, displayName, seatNumber });
  }

  function startRoom() {
    if (!hostToken) {
      return;
    }

    send({ type: "start_room", roomId, hostToken });
  }

  function sendPlayerAction(action: Extract<ClientMessage, { type: "player_action" }>["action"]) {
    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "player_action", roomId, participantToken, action });
  }

  function rebuy(amount: number) {
    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "rebuy", roomId, participantToken, amount });
  }

  function handleDisconnect(participantId: string) {
    if (!hostToken) {
      return;
    }

    send({ type: "handle_disconnect", roomId, hostToken, participantId, handling: "pause" });
  }

  function sendQuickPhrase(phrase: "think" | "nice_hand" | "well_played" | "another_hand") {
    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "quick_phrase", roomId, participantToken, phrase });
  }

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
        <JoinRoomForm roomId={roomId} onJoin={joinRoom} />
        {error ? <p className="inline-alert" role="status">{error}</p> : null}
      </section>

      <PokerTable
        view={roomView}
        legalActions={legalActions}
        hostControls={Boolean(hostToken)}
        playerControls={hasParticipantToken}
        onClaimSeat={claimSeat}
        onStartRoom={startRoom}
        onPlayerAction={sendPlayerAction}
        onRebuy={rebuy}
        onHandleDisconnect={handleDisconnect}
      />
      <SystemLog messages={messages} onQuickPhrase={sendQuickPhrase} />
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

function getParticipantToken(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(`holdem:${roomId}:participantToken`);
}

function readHostToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("host");
}
