"use client";

import type { FormEvent } from "react";
import { useState } from "react";

export function JoinRoomForm({
  roomId,
  onJoin
}: {
  roomId: string;
  onJoin?: (displayName: string, participantToken: string | null, participantId?: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    onJoin?.("Spectator", null);
  }

  return (
    <form style={{ display: "grid", gap: 12 }} aria-label="Join room" onSubmit={handleSubmit}>
      <input type="hidden" name="roomId" value={roomId} />
      <label style={{ display: "grid", gap: 6 }}>
        Nickname
        <input name="displayName" maxLength={24} required />
      </label>
      {error ? <p className="inline-alert" role="status">{error}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <button type="submit" disabled={joining}>{joining ? "Joining" : "Join"}</button>
        <button type="button" onClick={spectate}>Spectate</button>
      </div>
    </form>
  );
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
