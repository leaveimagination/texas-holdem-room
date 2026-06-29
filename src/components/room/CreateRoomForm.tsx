"use client";

import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

interface CreateRoomResult {
  roomId: string;
  inviteUrl: string;
  hostUrl: string;
}

export function CreateRoomForm() {
  const [mode, setMode] = useState<"cash" | "tournament">("cash");
  const [result, setResult] = useState<CreateRoomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<"invite" | "host" | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const timerValue = String(form.get("actionTimerSeconds") ?? "").trim();
    const settings = {
      mode,
      seats: Number(form.get("seats")),
      initialChips: Number(form.get("initialChips")),
      smallBlind: Number(form.get("smallBlind")),
      bigBlind: Number(form.get("bigBlind")),
      actionTimerSeconds: timerValue === "" ? null : Number(timerValue),
      ...(mode === "tournament"
        ? {
            blindIncrease: {
              type: String(form.get("blindIncreaseType") ?? "hands"),
              interval: Number(form.get("blindIncreaseInterval"))
            }
          }
        : {})
    };

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });

      const payload = (await response.json()) as CreateRoomResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Unable to create room");
      }

      setResult(payload as CreateRoomResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create room");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink(kind: "invite" | "host", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }} aria-label="Room settings">
      <label style={fieldStyle}>
        Mode
        <select name="mode" value={mode} onChange={(event) => setMode(event.currentTarget.value as "cash" | "tournament")}>
          <option value="cash">Flexible table</option>
          <option value="tournament">Tournament</option>
        </select>
      </label>
      <label style={fieldStyle}>
        Seats
        <select name="seats" defaultValue="6">
          {[2, 3, 4, 5, 6].map((seats) => (
            <option value={seats} key={seats}>
              {seats}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        Initial chips
        <input name="initialChips" type="number" min="100" max="100000" defaultValue="2000" required />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <label style={fieldStyle}>
          Small blind
          <input name="smallBlind" type="number" min="1" defaultValue="10" required />
        </label>
        <label style={fieldStyle}>
          Big blind
          <input name="bigBlind" type="number" min="2" defaultValue="20" required />
        </label>
      </div>
      <label style={fieldStyle}>
        Action timer seconds
        <input name="actionTimerSeconds" type="number" min="5" max="300" placeholder="Unlimited" />
      </label>
      {mode === "tournament" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <label style={fieldStyle}>
            Blind increase
            <select name="blindIncreaseType" defaultValue="hands">
              <option value="hands">Hands</option>
              <option value="minutes">Minutes</option>
            </select>
          </label>
          <label style={fieldStyle}>
            Interval
            <input name="blindIncreaseInterval" type="number" min="1" max="120" defaultValue="10" required />
          </label>
        </div>
      ) : null}
      <button type="submit" disabled={submitting} style={buttonStyle}>
        {submitting ? "Creating..." : "Create"}
      </button>
      {error ? <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null}
      {result ? (
        <section aria-label="Room links" className="room-links">
          <LinkRow
            label="Invite link"
            hint={linkHint(result.inviteUrl, "invite")}
            value={result.inviteUrl}
            copied={copied === "invite"}
            onCopy={() => void copyLink("invite", result.inviteUrl)}
          />
          <LinkRow
            label="Host link"
            hint={linkHint(result.hostUrl, "host")}
            value={result.hostUrl}
            copied={copied === "host"}
            onCopy={() => void copyLink("host", result.hostUrl)}
          />
        </section>
      ) : null}
    </form>
  );
}

function linkHint(value: string, kind: "invite" | "host"): string {
  if (isLoopbackUrl(value)) {
    return kind === "invite"
      ? "Local preview only. Do not send this to friends. Create the room from your Railway domain to get a shareable invite."
      : "Local preview only. A shareable host link is available on the Railway site.";
  }

  return kind === "invite"
    ? "Send this to friends."
    : "Share with trusted co-hosts. This link can start and manage the room.";
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  } catch {
    return false;
  }
}

function LinkRow({
  label,
  hint,
  value,
  copied,
  onCopy
}: {
  label: string;
  hint: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="room-link-row">
      <div>
        <strong>{label}</strong>
        <p>{hint}</p>
        <a href={value} aria-label={label}>{value}</a>
      </div>
      <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

const fieldStyle = {
  display: "grid",
  gap: 6
} satisfies CSSProperties;

const buttonStyle = {
  minHeight: 48,
  border: 0,
  borderRadius: 8,
  background: "var(--accent)",
  color: "#17221f",
  fontWeight: 700
} satisfies CSSProperties;
