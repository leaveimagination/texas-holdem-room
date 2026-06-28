import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Private room</p>
        <h1>Room not found</h1>
        <p>This private virtual-chip table may have ended or the link may be incomplete.</p>
        <Link className="primary-link" href="/create">
          Create room
        </Link>
      </section>
    </main>
  );
}
