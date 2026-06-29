import React from "react";
import type { ServerMessage } from "@/lib/realtime/messages";

const QUICK_PHRASES = [
  { label: "Think", value: "think" },
  { label: "Nice hand", value: "nice_hand" },
  { label: "Well played", value: "well_played" },
  { label: "Another hand", value: "another_hand" }
] as const;

export function SystemLog({
  messages,
  onQuickPhrase
}: {
  messages: ServerMessage[];
  onQuickPhrase?: (phrase: (typeof QUICK_PHRASES)[number]["value"]) => void;
}) {
  const entries = messages.slice(-8).map(formatMessage);

  return (
    <aside className="system-log" aria-label="System log">
      <div className="quick-phrases" aria-label="Quick phrases">
        {QUICK_PHRASES.map((phrase) => (
          <button type="button" key={phrase.value} onClick={() => onQuickPhrase?.(phrase.value)}>{phrase.label}</button>
        ))}
      </div>
      <div className="log-entries">
        {entries.length > 0 ? entries.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>) : <p>Waiting for room updates.</p>}
      </div>
    </aside>
  );
}

function formatMessage(message: ServerMessage): string {
  if (message.type === "system_message") {
    return message.payload.message;
  }

  if (message.type === "error") {
    return message.payload.message;
  }

  return message.type.replaceAll("_", " ");
}
