"use client";

import React from "react";
import { useEffect, useState } from "react";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { PokerTable } from "@/components/table/PokerTable";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";

export const HAND_RESULT_ANIMATION_MS = 6200;

export function RoomClient({ roomId }: { roomId: string }) {
  const { connected, error, messages, send } = useRoomSocket(roomId);
  const [displayName, setDisplayName] = useState("Player");
  const [hasParticipantToken, setHasParticipantToken] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const roomView = findLatestPayload(messages, ["room_snapshot", "table_update"]);
  const legalActions = findLatestPayload(messages, ["legal_actions"]);
  const latestHandResult = findLatestPayload(messages, ["hand_finished"]);
  const [visibleHandResult, setVisibleHandResult] = useState<unknown>(null);
  const tableView = attachHandResult(roomView, visibleHandResult);

  useEffect(() => {
    setHasParticipantToken(Boolean(getParticipantToken(roomId)));
    setParticipantId(getParticipantId(roomId));
    setHostToken(readHostToken());
  }, [roomId]);

  useEffect(() => {
    if (!latestHandResult) {
      return;
    }

    setVisibleHandResult(latestHandResult);
    const timeout = window.setTimeout(() => setVisibleHandResult(null), HAND_RESULT_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [latestHandResult]);

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
    if (!connected) {
      return;
    }

    setDisplayName(displayName);
    setHasParticipantToken(Boolean(participantToken));
    setParticipantId(joinedParticipantId ?? getParticipantId(roomId));
    setHasJoinedRoom(true);
    send({ type: "join_room", roomId, participantToken, displayName });
  }

  function claimSeat(seatNumber: number) {
    if (!connected) {
      return;
    }

    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "claim_seat", roomId, participantToken, displayName, seatNumber });
  }

  function startRoom() {
    if (!connected) {
      return;
    }

    if (!hostToken) {
      return;
    }

    send({ type: "start_room", roomId, hostToken });
  }

  function sendPlayerAction(action: Extract<ClientMessage, { type: "player_action" }>["action"]) {
    if (!connected) {
      return;
    }

    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "player_action", roomId, participantToken, action });
  }

  function rebuy(amount: number) {
    if (!connected) {
      return;
    }

    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "rebuy", roomId, participantToken, amount });
  }

  function sendInsuranceDecision(accepted: boolean) {
    if (!connected) {
      return;
    }

    const participantToken = getParticipantToken(roomId);
    if (!participantToken) {
      return;
    }

    send({ type: "insurance_decision", roomId, participantToken, accepted });
  }

  function handleDisconnect(participantId: string) {
    if (!connected) {
      return;
    }

    if (!hostToken) {
      return;
    }

    send({ type: "handle_disconnect", roomId, hostToken, participantId, handling: "pause" });
  }

  return (
    <main className={hasJoinedRoom ? "room-page game-room-page is-joined" : "room-page game-room-page"}>
      <header className="room-header">
        <div>
          <p className="eyebrow">Private room</p>
          <h1>Room {roomId}</h1>
        </div>
        <div className="room-header-actions">
          <RoomShare roomId={roomId} />
          <span className={connected ? "status-pill is-connected" : "status-pill"}>{connected ? "Connected" : "Connecting"}</span>
        </div>
      </header>

      {!hasJoinedRoom ? (
        <div className="join-modal-backdrop">
          <section className="join-panel" aria-label="Join flow" role="dialog" aria-modal="true">
            <JoinRoomForm roomId={roomId} connected={connected} onJoin={joinRoom} />
            {error ? <p className="inline-alert" role="status">{error}</p> : null}
          </section>
        </div>
      ) : error ? (
        <p className="inline-alert" role="status">{error}</p>
      ) : null}

      <PokerTable
        view={tableView}
        legalActions={legalActions}
        hostControls={Boolean(hostToken)}
        playerControls={hasParticipantToken}
        connected={connected}
        localParticipantId={participantId}
        localDisplayName={displayName}
        onClaimSeat={claimSeat}
        onStartRoom={startRoom}
        onPlayerAction={sendPlayerAction}
        onInsuranceDecision={sendInsuranceDecision}
        onRebuy={rebuy}
        onHandleDisconnect={handleDisconnect}
      />
      <TableEventToast messages={messages} />
    </main>
  );
}

export function RoomShare({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/room/${encodeURIComponent(roomId)}`;

  async function copyInvite() {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const inviteUrl = `${origin}${path}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="room-share" aria-label="Invite link">
      <a href={path}>Invite</a>
      <button type="button" onClick={() => void copyInvite()}>{copied ? "Copied" : "Copy invite"}</button>
    </div>
  );
}

export function TableEventToast({ messages }: { messages: ServerMessage[] }) {
  const event = findLatestTableEvent(messages);
  if (!event) {
    return null;
  }

  return (
    <aside className="table-event-toast" role="status" aria-live="polite">
      <span className="table-event-icon" aria-hidden="true">+</span>
      <strong>{event}</strong>
    </aside>
  );
}

function findLatestTableEvent(messages: ServerMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "action_recorded") {
      return formatActionEvent(message.payload);
    }

    if (message.type === "hand_finished") {
      return formatHandFinishedEvent(message.payload);
    }

    if (message.type === "system_message" && /\badded \d+ chips\b/i.test(message.payload.message)) {
      return message.payload.message;
    }
  }

  return null;
}

function formatActionEvent(payload: unknown): string | null {
  const value = readObject(payload);
  const displayName = typeof value?.displayName === "string" ? value.displayName : "Player";
  const action = readObject(value?.action);
  const type = typeof action?.type === "string" ? action.type : null;
  if (!type) {
    return null;
  }

  const label = type === "all-in"
    ? "all in"
    : type === "raise"
      ? "raises"
      : type === "bet"
        ? "bets"
        : type === "call"
          ? "calls"
          : type === "check"
            ? "checks"
            : type === "fold"
              ? "folds"
              : type;
  return `${displayName} ${label}`;
}

function formatHandFinishedEvent(payload: unknown): string | null {
  const value = readObject(payload);
  const winners = value?.winners;
  if (!Array.isArray(winners)) {
    return null;
  }

  const names = winners.flatMap((winner) => {
    const winnerObject = readObject(winner);
    return typeof winnerObject?.displayName === "string" ? [winnerObject.displayName] : [];
  });
  return names.length > 0 ? `${names.join(", ")} wins the pot` : null;
}

function attachHandResult(roomView: unknown, handResult: unknown): unknown {
  const view = readObject(roomView);
  if (!view || !handResult) {
    return roomView;
  }

  return { ...view, handResult };
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

export function readVisibleParticipantId(view: unknown): string | null {
  if (typeof view !== "object" || view === null || !("hand" in view)) {
    return null;
  }

  const hand = (view as { hand?: unknown }).hand;
  if (typeof hand !== "object" || hand === null || !("seats" in hand) || !Array.isArray((hand as { seats: unknown }).seats)) {
    return null;
  }

  const visibleSeats = (hand as { seats: unknown[] }).seats.filter((seat) => {
    return (
      typeof seat === "object" &&
      seat !== null &&
      "participantId" in seat &&
      "holeCards" in seat &&
      Array.isArray((seat as { holeCards?: unknown }).holeCards)
    );
  });

  if (visibleSeats.length !== 1) {
    return null;
  }

  const visibleSeat = visibleSeats[0];
  if (typeof visibleSeat !== "object" || visibleSeat === null || !("participantId" in visibleSeat)) {
    return null;
  }

  return typeof visibleSeat.participantId === "string" ? visibleSeat.participantId : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readHostToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("host");
}
