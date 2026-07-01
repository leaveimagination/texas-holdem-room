"use client";

import React from "react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

export function JoinRoomForm({
  roomId,
  connected = true,
  onJoin
}: {
  roomId: string;
  connected?: boolean;
  onJoin?: (displayName: string, participantToken: string | null, participantId?: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const connectedRef = useRef(connected);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!displayName) {
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const storageKey = `holdem:${roomId}:participantToken`;
      const participantStorageKey = `holdem:${roomId}:participantId`;
      const existingToken = window.localStorage.getItem(storageKey);
      const existingParticipantId = window.localStorage.getItem(participantStorageKey);
      const participant = existingToken
        ? { participantToken: existingToken, participantId: existingParticipantId }
        : await createParticipant(roomId, displayName);

      if (!canCompleteJoinAfterParticipantCreated(connectedRef.current)) {
        setError("Connecting to room");
        return;
      }

      window.localStorage.setItem(storageKey, participant.participantToken);
      if (participant.participantId) {
        window.localStorage.setItem(participantStorageKey, participant.participantId);
      }
      onJoin?.(displayName, participant.participantToken, participant.participantId);
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : "Unable to join room";
      setError(message);
    } finally {
      setJoining(false);
    }
  }

  function spectate() {
    if (!connected) {
      return;
    }

    onJoin?.("Spectator", null);
  }

  return (
    <form className="join-room-form" aria-label="Join room" onSubmit={handleSubmit}>
      <input type="hidden" name="roomId" value={roomId} />
      <label className="join-name-field">
        <span>Nickname</span>
        <input name="displayName" maxLength={24} required />
      </label>
      {!connected ? <p className="inline-alert" role="status">Connecting to room</p> : null}
      {error ? <p className="inline-alert" role="status">{error}</p> : null}
      <div className="join-room-actions">
        <button type="submit" disabled={joining || !connected}>{joining ? "Joining" : "Join"}</button>
        <button type="button" onClick={spectate} disabled={!connected}>Spectate</button>
      </div>
    </form>
  );
}

export function canCompleteJoinAfterParticipantCreated(connected: boolean): boolean {
  return connected;
}

async function createParticipant(roomId: string, displayName: string): Promise<{ participantId: string; participantToken: string }> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName })
  });

  const body = await response.json() as { participantId?: unknown; participantToken?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Unable to join room");
  }

  if (typeof body.participantToken !== "string") {
    throw new Error("Join response did not include a participant token");
  }

  if (typeof body.participantId !== "string") {
    throw new Error("Join response did not include a participant id");
  }

  return { participantId: body.participantId, participantToken: body.participantToken };
}
