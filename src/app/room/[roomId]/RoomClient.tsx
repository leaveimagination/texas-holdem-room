"use client";

import { useEffect, useState } from "react";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { PokerTable } from "@/components/table/PokerTable";
import { SystemLog } from "@/components/table/SystemLog";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";

export function RoomClient({ roomId }: { roomId: string }) {
  const { connected, error, messages, send } = useRoomSocket(roomId);
  const [displayName, setDisplayName] = useState("Player");
  const [hasParticipantToken, setHasParticipantToken] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const roomView = findLatestPayload(messages, ["room_snapshot", "table_update"]);
  const legalActions = findLatestPayload(messages, ["legal_actions"]);

  useEffect(() => {
    setHasParticipantToken(Boolean(getParticipantToken(roomId)));
    setParticipantId(getParticipantId(roomId));
    setHostToken(readHostToken());
  }, [roomId]);

  useEffect(() => {
    const visibleParticipantId = readVisibleParticipantId(roomView);
    if (!visibleParticipantId || participantId === visibleParticipantId) {
      return;
    }

    setParticipantId(visibleParticipantId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`holdem:${roomId}:participantId`, visibleParticipantId);
    }
  }, [participantId, roomId, roomView]);

  function joinRoom(displayName: string, participantToken: string | null, joinedParticipantId?: string | null) {
    setDisplayName(displayName);
    setHasParticipantToken(Boolean(participantToken));
    setParticipantId(joinedParticipantId ?? getParticipantId(roomId));
    setHasJoinedRoom(true);
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

      {!hasJoinedRoom ? (
        <section className="join-panel" aria-label="Join flow">
          <JoinRoomForm roomId={roomId} onJoin={joinRoom} />
          {error ? <p className="inline-alert" role="status">{error}</p> : null}
        </section>
      ) : error ? (
        <p className="inline-alert" role="status">{error}</p>
      ) : null}

      <PokerTable
        view={roomView}
        legalActions={legalActions}
        hostControls={Boolean(hostToken)}
        playerControls={hasParticipantToken}
        localParticipantId={participantId}
        localDisplayName={displayName}
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

function getParticipantId(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(`holdem:${roomId}:participantId`);
}

function readVisibleParticipantId(view: unknown): string | null {
  if (typeof view !== "object" || view === null || !("hand" in view)) {
    return null;
  }

  const hand = (view as { hand?: unknown }).hand;
  if (typeof hand !== "object" || hand === null || !("seats" in hand) || !Array.isArray((hand as { seats: unknown }).seats)) {
    return null;
  }

  const visibleSeat = (hand as { seats: unknown[] }).seats.find((seat) => {
    return (
      typeof seat === "object" &&
      seat !== null &&
      "participantId" in seat &&
      "holeCards" in seat &&
      Array.isArray((seat as { holeCards?: unknown }).holeCards)
    );
  });

  if (typeof visibleSeat !== "object" || visibleSeat === null || !("participantId" in visibleSeat)) {
    return null;
  }

  return typeof visibleSeat.participantId === "string" ? visibleSeat.participantId : null;
}

function readHostToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("host");
}
