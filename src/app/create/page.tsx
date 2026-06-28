import { CreateRoomForm } from "@/components/room/CreateRoomForm";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";

export default function CreateRoomPage() {
  return (
    <main
      style={{
        width: "min(100%, 760px)",
        margin: "0 auto",
        padding: 20,
        display: "grid",
        gap: 24
      }}
    >
      <header style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>Private table setup</p>
        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>Create private room</h1>
      </header>
      <CreateRoomForm />
      <section aria-label="Join preview" style={{ borderTop: "1px solid var(--line)", paddingTop: 20 }}>
        <JoinRoomForm roomId="preview-room" />
      </section>
    </main>
  );
}
