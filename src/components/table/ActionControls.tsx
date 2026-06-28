"use client";

import React from "react";
import { useState } from "react";
import type { ClientMessage } from "@/lib/realtime/messages";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];
type ActionType = PlayerAction["type"];

const FALLBACK_ACTIONS: ActionType[] = ["fold", "check", "call", "raise", "all-in"];

export function ActionControls({
  legalActions,
  actorId,
  localParticipantId,
  canStartRoom = true,
  hostControls = false,
  playerControls = false,
  onStartRoom,
  onPlayerAction,
  onRebuy,
  onHandleDisconnect
}: {
  legalActions?: unknown;
  actorId?: string | null;
  localParticipantId?: string | null;
  canStartRoom?: boolean;
  hostControls?: boolean;
  playerControls?: boolean;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const [raiseAmount, setRaiseAmount] = useState("100");
  const [rebuyAmount, setRebuyAmount] = useState("500");
  const [disconnectedParticipantId, setDisconnectedParticipantId] = useState("");
  const actions = readActions(legalActions);
  const visibleActions = actions.length > 0 ? actions.map((action) => action.type) : FALLBACK_ACTIONS;
  const activeActorId = actorId ?? "pending-player";
  const hasActiveTurn = Boolean(actorId);
  const isPlayerTurn = Boolean(playerControls && localParticipantId && actorId && localParticipantId === actorId);
  const canUsePlayerActions = playerControls && (!hasActiveTurn || isPlayerTurn);

  function sendAction(type: ActionType) {
    if (type === "bet" || type === "raise") {
      const amountTo = readPositiveAmount(raiseAmount);
      if (!amountTo) {
        return;
      }

      onPlayerAction?.({ type, playerId: activeActorId, amountTo });
      return;
    }

    onPlayerAction?.({ type, playerId: activeActorId } as PlayerAction);
  }

  function sendRebuy() {
    const amount = readPositiveAmount(rebuyAmount);
    if (amount) {
      onRebuy?.(amount);
    }
  }

  function sendDisconnectHandling() {
    const participantId = disconnectedParticipantId.trim();
    if (participantId) {
      onHandleDisconnect?.(participantId);
    }
  }

  return (
    <section className="action-dock" aria-label="Actions">
      <div className={isPlayerTurn ? "turn-banner is-your-turn" : "turn-banner"} role="status">
        {isPlayerTurn ? "Your turn" : hasActiveTurn ? "Waiting for another player" : "Waiting for the next hand"}
      </div>

      {hostControls ? (
        <div className="host-controls" aria-label="Host controls">
          <button type="button" onClick={onStartRoom} disabled={!canStartRoom}>{canStartRoom ? "Start room" : "Hand in progress"}</button>
          <label>
            Disconnected participant
            <input
              aria-label="Disconnected participant"
              value={disconnectedParticipantId}
              onChange={(event) => setDisconnectedParticipantId(event.target.value)}
              placeholder="participant id"
            />
          </label>
          <button type="button" onClick={sendDisconnectHandling}>Pause for disconnect</button>
        </div>
      ) : null}

      <div className="action-grid">
        {visibleActions.map((type) => (
          <button type="button" key={type} onClick={() => sendAction(type)} disabled={!canUsePlayerActions}>
            {formatAction(type)}
          </button>
        ))}
      </div>

      <div className="raise-strip" aria-label="Raise controls">
        <label>
          Raise amount
          <input
            aria-label="Raise amount"
            inputMode="numeric"
            min={1}
            type="number"
            value={raiseAmount}
            disabled={!canUsePlayerActions}
            onChange={(event) => setRaiseAmount(event.target.value)}
          />
        </label>
      </div>

      <div className="rebuy-strip" aria-label="Add chips controls">
        <label>
          Add chips amount
          <input
            aria-label="Add chips amount"
            inputMode="numeric"
            min={1}
            type="number"
            value={rebuyAmount}
            disabled={!playerControls}
            onChange={(event) => setRebuyAmount(event.target.value)}
          />
        </label>
        <button type="button" onClick={sendRebuy} disabled={!playerControls}>Add chips</button>
      </div>
    </section>
  );
}

function readActions(legalActions: unknown): Array<{ type: ActionType }> {
  const actions = Array.isArray(legalActions)
    ? legalActions
    : typeof legalActions === "object" && legalActions !== null && "actions" in legalActions
      ? (legalActions as { actions: unknown }).actions
      : null;

  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.flatMap((action) => {
    if (typeof action !== "object" || action === null || !("type" in action)) {
      return [];
    }

    const type = (action as { type: unknown }).type;
    return isActionType(type) ? [{ type }] : [];
  });
}

function isActionType(type: unknown): type is ActionType {
  return type === "fold" || type === "check" || type === "call" || type === "bet" || type === "raise" || type === "all-in";
}

function readPositiveAmount(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatAction(type: ActionType): string {
  switch (type) {
    case "all-in":
      return "All in";
    case "call":
      return "Call";
    case "check":
      return "Check";
    case "raise":
      return "Raise";
    case "bet":
      return "Bet";
    case "fold":
      return "Fold";
  }
}
