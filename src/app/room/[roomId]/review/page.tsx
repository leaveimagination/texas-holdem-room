export default async function RoomReviewPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  return (
    <main className="review-page">
      <header className="room-header">
        <div>
          <p className="eyebrow">Private room</p>
          <h1>Room review</h1>
        </div>
        <a className="status-pill" href={`/room/${roomId}`}>
          Back to room
        </a>
      </header>

      <section className="review-section" aria-label="Hand history">
        <div>
          <p className="eyebrow">Room {roomId}</p>
          <h2>Hand history</h2>
        </div>
        <p className="review-empty">Finished hands will appear here for public review.</p>
      </section>
    </main>
  );
}
