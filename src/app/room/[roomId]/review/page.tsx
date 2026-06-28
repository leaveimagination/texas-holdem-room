import React from "react";
import { RoomRepository } from "@/server/repositories/room-repository";

export default async function RoomReviewPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const hands = await new RoomRepository().listPublicHandReviews(roomId).catch(() => []);

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
        {hands.length > 0 ? (
          <ol className="review-list">
            {hands.map((hand) => (
              <li className="review-hand" key={hand.handNumber}>
                <h3>Hand {hand.handNumber}</h3>
                <p>Board: {Array.isArray(hand.board) && hand.board.length > 0 ? hand.board.join(" ") : "No board"}</p>
                <p>Pot: {hand.potSize}</p>
                <p>
                  Winners:{" "}
                  {hand.winners.length > 0
                    ? hand.winners.map((winner) => winner.displayName).join(", ")
                    : "Pending"}
                </p>
                <ol>
                  {hand.actions.map((action) => (
                    <li key={action.sequenceNumber}>
                      {action.street} · {action.participantId} · {action.actionType}
                      {action.amount ? ` ${action.amount}` : ""}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        ) : (
          <p className="review-empty">Finished hands will appear here for public review.</p>
        )}
      </section>
    </main>
  );
}
