"use client";

export function JoinRoomForm({ roomId }: { roomId: string }) {
  return (
    <form style={{ display: "grid", gap: 12 }} aria-label="Join room">
      <input type="hidden" name="roomId" value={roomId} />
      <label style={{ display: "grid", gap: 6 }}>
        Nickname
        <input name="displayName" maxLength={24} required />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <button type="submit">Join</button>
        <button type="button">Spectate</button>
      </div>
    </form>
  );
}
