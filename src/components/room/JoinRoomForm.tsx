"use client";

import type { FormEvent } from "react";

export function JoinRoomForm({
  roomId,
  onJoin
}: {
  roomId: string;
  onJoin?: (displayName: string, participantToken: string | null) => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!displayName) {
      return;
    }

    onJoin?.(displayName, window.localStorage.getItem(`holdem:${roomId}:participantToken`));
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <button type="submit">Join</button>
        <button type="button" onClick={spectate}>Spectate</button>
      </div>
    </form>
  );
}
