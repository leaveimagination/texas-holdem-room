"use client";

import React from "react";
import { useState } from "react";
import type { ClientMessage } from "@/lib/realtime/messages";
import { PlayingCard } from "./PlayingCard";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];
type ActionType = PlayerAction["type"];

const FALLBACK_ACTIONS: ActionType[] = ["fold", "check", "call", "raise", "all-in"];
const PRIMARY_ACTIONS = new Set<ActionType>(["call", "check", "bet", "raise", "all-in"]);
export function ActionControls({
  legalActions,
  actorId,
  localParticipantId,
  actorName,
  heroCards = [],
  heroName,
  heroStack,
  tableStatus,
  bigBlind = 20,
  pot = 0,
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
  actorName?: string | null;
  heroCards?: string[];
  heroName?: string | null;
  heroStack?: number | null;
  tableStatus?: string | null;
  bigBlind?: number | null;
  pot?: number | null;
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
  const actionButtons = visibleActions.filter((type) => type !== "all-in");
  const raiseLimits = readRaiseLimits(actions);
  const quickBets = buildQuickBets({ bigBlind, pot, raiseLimits });
  const activeActorId = actorId ?? "pending-player";
  const hasActiveTurn = Boolean(actorId);
  const isPlayerTurn = Boolean(playerControls && localParticipantId && actorId && localParticipantId === actorId);
  const canUsePlayerActions = playerControls && (!hasActiveTurn || isPlayerTurn);
  const showBettingControls = hasActiveTurn && (tableStatus ?? "playing") === "playing";
  const statusText = isPlayerTurn
    ? "YOUR TURN"
    : hasActiveTurn
      ? `Waiting for ${actorName ?? "another player"}`
      : "Waiting for host to deal";

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
      <div className="hud-main">
        <div className="hero-pocket" aria-label="Your hand">
          <div className="hero-meta">
            <span className="hud-label">Your hand</span>
            <strong>{heroName ?? "Take a seat"}</strong>
            <small>{typeof heroStack === "number" ? `${heroStack.toLocaleString()} chips` : "Join to play"}</small>
          </div>
          <div className="hero-cards">
            {heroCards.length > 0
              ? heroCards.map((card, index) => <PlayingCard card={card} variant="hero" dealIndex={index} key={card} />)
              : <span className="board-empty">No cards</span>}
          </div>
        </div>

        <div className="bet-console">
          <div className={isPlayerTurn ? "turn-banner is-your-turn" : "turn-banner"} role="status">
            {statusText}
          </div>
          {showBettingControls ? (
            <>
              <div className="quick-bet-row" aria-label="Quick bet controls">
                {quickBets.map((bet) => (
                  <button type="button" key={bet.label} onClick={() => setRaiseAmount(String(bet.amount))} disabled={!canUsePlayerActions}>
                    <span>{bet.label}</span>
                    <strong>{bet.amount.toLocaleString()}</strong>
                  </button>
                ))}
                <button type="button" onClick={() => sendAction("all-in")} disabled={!canUsePlayerActions || !visibleActions.includes("all-in")}>
                  All in
                </button>
              </div>
              <label className="amount-control">
                <span>Bet amount</span>
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
            </>
          ) : (
            <div className="hud-waiting-note">Actions appear here when a hand is live.</div>
          )}
        </div>

        {showBettingControls ? (
          <div className={`action-grid action-count-${actionButtons.length}`}>
            {actionButtons.map((type) => (
              <button
                type="button"
                className={PRIMARY_ACTIONS.has(type) ? "is-primary-action" : "is-secondary-action"}
                key={type}
                onClick={() => sendAction(type)}
                disabled={!canUsePlayerActions}
              >
                {formatAction(type)}
              </button>
            ))}
          </div>
        ) : (
          <div className="action-placeholder">
            <strong>{canStartRoom ? "Ready to deal" : "Hand in progress"}</strong>
            <span>{playerControls ? "Take a seat and wait for the next hand." : "Join the room to play."}</span>
          </div>
        )}
      </div>

      <div className="table-tools" aria-label="Table tools">
        {hostControls ? (
          <details className="host-popover">
            <summary>Host tools</summary>
            <div className="popover-body host-controls" aria-label="Host controls">
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
          </details>
        ) : null}

        <details className="rebuy-popover">
          <summary>Add chips</summary>
          <div className="popover-body rebuy-strip" aria-label="Add chips controls">
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
        </details>
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
    return isActionType(type) ? [{ ...(action as Record<string, unknown>), type } as { type: ActionType }] : [];
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

function readRaiseLimits(actions: Array<{ type: ActionType }>): { min: number; max: number | null } | null {
  const raiseAction = actions.find((action) => action.type === "raise" || action.type === "bet") as { minAmountTo?: unknown; maxAmountTo?: unknown } | undefined;
  if (!raiseAction || typeof raiseAction.minAmountTo !== "number") {
    return null;
  }

  return {
    min: raiseAction.minAmountTo,
    max: typeof raiseAction.maxAmountTo === "number" ? raiseAction.maxAmountTo : null
  };
}

function buildQuickBets({
  bigBlind,
  pot,
  raiseLimits
}: {
  bigBlind?: number | null;
  pot?: number | null;
  raiseLimits: { min: number; max: number | null } | null;
}): Array<{ label: string; amount: number }> {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const potSize = typeof pot === "number" && pot > 0 ? pot : blind * 5;
  const rawBets = [
    { label: "2BB", amount: blind * 2 },
    { label: "3BB", amount: blind * 3 },
    { label: "1/2 Pot", amount: Math.max(blind, Math.round(potSize / 2)) },
    { label: "Pot", amount: Math.max(blind, potSize) }
  ];

  return rawBets.map((bet) => ({
    ...bet,
    amount: clampBetAmount(bet.amount, raiseLimits)
  }));
}

function clampBetAmount(amount: number, raiseLimits: { min: number; max: number | null } | null): number {
  if (!raiseLimits) {
    return amount;
  }

  const minClamped = Math.max(amount, raiseLimits.min);
  return raiseLimits.max === null ? minClamped : Math.min(minClamped, raiseLimits.max);
}
