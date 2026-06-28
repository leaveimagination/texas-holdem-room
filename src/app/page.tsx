import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        alignContent: "center",
        gap: 24,
        padding: 24
      }}
    >
      <section style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>Virtual-chip Hold'em with friends</p>
        <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.05 }}>Private Hold'em Room</h1>
        <p style={{ margin: 0, maxWidth: 520, color: "var(--muted)" }}>
          Create a private table, share the invite link, and play no-limit Texas Hold'em with room-scoped tokens.
        </p>
      </section>
      <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }} aria-label="Primary">
        <Link
          href="/create"
          style={{
            minHeight: 48,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#17221f",
            padding: "0 18px",
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Create room
        </Link>
      </nav>
    </main>
  );
}
