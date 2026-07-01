"use client";

import React from "react";
import { useEffect, useState } from "react";
import type { ClientMessage } from "@/lib/realtime/messages";

type PlayerAction = Extract<ClientMessage, { type: "player_action" }>["action"];
type ActionType = PlayerAction["type"];
type ActionItem = { type: ActionType; amount?: number; amountTo?: number; minAmountTo?: number; maxAmountTo?: number };

const FALLBACK_ACTIONS: ActionType[] = ["fold", "check", "call", "raise", "all-in"];
export function ActionControls({
  legalActions,
  actorId,
  localParticipantId,
  actorName,
  heroCards: _heroCards = [],
  heroName: _heroName,
  heroStack,
  tableStatus,
  bigBlind = 20,
  pot = 0,
  canStartRoom = true,
  hostControls = false,
  playerControls = false,
  connected = true,
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
  connected?: boolean;
  onStartRoom?: () => void;
  onPlayerAction?: (action: PlayerAction) => void;
  onRebuy?: (amount: number) => void;
  onHandleDisconnect?: (participantId: string) => void;
}) {
  const actions = readActions(legalActions);
  const raiseLimits = readRaiseLimits(actions);
  const [raiseAmount, setRaiseAmount] = useState(() => String(raiseLimits?.min ?? 100));
  const [rebuyAmount, setRebuyAmount] = useState("500");
  const [disconnectedParticipantId, setDisconnectedParticipantId] = useState("");
  const quickBets = buildQuickBets({ bigBlind, pot, raiseLimits });
  const sliderStep = getBetSliderStep(bigBlind);
  const sliderBounds = getBetSliderBounds({ raiseLimits, raiseAmount, bigBlind });
  const selectedRaiseAmount = clampBetAmount(readPositiveAmount(raiseAmount) ?? sliderBounds.min, {
    min: sliderBounds.min,
    max: sliderBounds.max
  });
  const sliderProgress = Math.round(((selectedRaiseAmount - sliderBounds.min) / Math.max(sliderBounds.max - sliderBounds.min, 1)) * 100);
  const activeActorId = actorId ?? "pending-player";
  const hasActiveTurn = Boolean(actorId);
  const showBettingControls = hasActiveTurn && (tableStatus ?? "playing") === "playing";
  const visibleActions = actions.length > 0 ? actions.map((action) => action.type) : showBettingControls ? [] : FALLBACK_ACTIONS;
  const actionButtons = visibleActions;
  const isPlayerTurn = Boolean(playerControls && localParticipantId && actorId && localParticipantId === actorId);
  const canUsePlayerActions = connected && playerControls && (!hasActiveTurn || isPlayerTurn);
  const showRebuyModal = Boolean(playerControls && typeof heroStack === "number" && heroStack <= 0);
  const statusText = !connected
    ? "Reconnecting to table"
    : isPlayerTurn
    ? "YOUR TURN"
    : hasActiveTurn
      ? `Waiting for ${actorName ?? "another player"}`
      : "Waiting for host to deal";

  useEffect(() => {
    setRaiseAmount((currentAmount) => {
      if (typeof raiseLimits?.min !== "number") {
        return currentAmount === "100" ? currentAmount : "100";
      }

      const parsedAmount = readPositiveAmount(currentAmount);
      if (parsedAmount === null || parsedAmount < raiseLimits.min) {
        return String(raiseLimits.min);
      }

      if (typeof raiseLimits.max === "number" && parsedAmount > raiseLimits.max) {
        return String(raiseLimits.max);
      }

      return currentAmount;
    });
  }, [raiseLimits?.min, raiseLimits?.max]);

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
        <div className="action-console">
          <div className={isPlayerTurn ? "turn-banner is-your-turn" : "turn-banner"} role="status">
            {statusText}
          </div>
          {showBettingControls ? (
            <div className="bet-console">
              <div className="quick-bet-row" aria-label="Quick bet controls">
                {quickBets.map((bet) => (
                  <button type="button" key={bet.label} onClick={() => setRaiseAmount(String(bet.amount))} disabled={!canUsePlayerActions}>
                    <span>{bet.label}</span>
                    <strong>{formatBb(bet.amount, bigBlind)}</strong>
                  </button>
                ))}
              </div>
              <label className="amount-control bet-slider-control" style={{ "--bet-progress": `${sliderProgress}%` } as React.CSSProperties}>
                <span className="bet-slider-value">{formatBb(selectedRaiseAmount, bigBlind)}</span>
                <input
                  aria-label="Bet amount slider"
                  min={sliderBounds.min}
                  max={sliderBounds.max}
                  step={sliderStep}
                  type="range"
                  value={selectedRaiseAmount}
                  disabled={!canUsePlayerActions || !raiseLimits}
                  onChange={(event) => setRaiseAmount(event.target.value)}
                />
              </label>
              <div className={`primary-action-row action-grid action-count-${actionButtons.length}`}>
                {actionButtons.map((type) => {
                  const label = formatActionLabel(type, actions, bigBlind, selectedRaiseAmount);
                  return (
                    <button
                      type="button"
                      className={["is-primary-action", actionToneClass(type)].join(" ")}
                      key={type}
                      onClick={() => sendAction(type)}
                      disabled={!canUsePlayerActions}
                    >
                      <span>{label.title}</span>
                      {label.detail ? <strong>{label.detail}</strong> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bet-console is-waiting">
              <div className="quick-bet-row" aria-label="Quick bet controls">
                {["33%", "50%", "75%", "100%"].map((label) => (
                  <button type="button" key={label} disabled>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="amount-control bet-slider-control is-disabled" aria-label="Bet amount slider">
                <span className="bet-slider-value" aria-hidden="true" />
                <span className="bet-slider-track" aria-hidden="true" />
              </div>
              <div className="primary-action-row action-grid action-count-3">
                <button type="button" className="is-primary-action is-fold-action" disabled>
                  <span>Fold</span>
                </button>
                <button type="button" className="is-primary-action is-call-action" disabled>
                  <span>Call</span>
                </button>
                <button type="button" className="is-primary-action is-raise-action" disabled>
                  <span>Raise to</span>
                </button>
              </div>
              <div className="action-placeholder">
                <strong>{canStartRoom ? "Ready to deal" : "Hand in progress"}</strong>
                <span>{playerControls ? "Take a seat and wait for the next hand." : "Join the room to play."}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {hostControls ? (
        <div className="table-tools" aria-label="Table tools">
          <details className="host-popover">
            <summary>Host tools</summary>
            <div className="popover-body host-controls is-anchored-host-controls" aria-label="Host controls">
              <button type="button" onClick={onStartRoom} disabled={!connected || !canStartRoom}>{canStartRoom ? "Start room" : "Hand in progress"}</button>
              <label>
                Disconnected participant
                <input
                  aria-label="Disconnected participant"
                  value={disconnectedParticipantId}
                  onChange={(event) => setDisconnectedParticipantId(event.target.value)}
                  placeholder="participant id"
                />
              </label>
              <button type="button" onClick={sendDisconnectHandling} disabled={!connected}>Pause for disconnect</button>
            </div>
          </details>
        </div>
      ) : null}

      {showRebuyModal ? (
        <div className="rebuy-modal-backdrop">
          <section className="rebuy-modal" role="dialog" aria-label="Add chips">
            <div className="rebuy-modal-copy">
              <span>Stack empty</span>
              <strong>Add chips</strong>
              <p>{tableStatus === "playing" ? "Top up now and return when the next hand is ready." : "Add virtual chips to sit back in."}</p>
            </div>
            <label>
              Add chips amount
              <input
                aria-label="Add chips amount"
                inputMode="numeric"
                min={1}
                type="number"
                value={rebuyAmount}
                disabled={!connected || !playerControls}
                onChange={(event) => setRebuyAmount(event.target.value)}
              />
            </label>
            <button type="button" onClick={sendRebuy} disabled={!connected || !playerControls}>Add chips</button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function readActions(legalActions: unknown): ActionItem[] {
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
    if (!isActionType(type)) {
      return [];
    }

    const record = action as Record<string, unknown>;
    return [{
      type,
      amount: typeof record.amount === "number" ? record.amount : undefined,
      amountTo: typeof record.amountTo === "number" ? record.amountTo : undefined,
      minAmountTo: typeof record.minAmountTo === "number" ? record.minAmountTo : undefined,
      maxAmountTo: typeof record.maxAmountTo === "number" ? record.maxAmountTo : undefined
    }];
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

function formatActionLabel(
  type: ActionType,
  actions: ActionItem[],
  bigBlind?: number | null,
  selectedRaiseAmount?: number
): { title: string; detail: string | null } {
  const action = actions.find((candidate) => candidate.type === type);
  if (type === "call" && typeof action?.amount === "number") {
    return { title: "Call", detail: formatBb(action.amount, bigBlind) };
  }

  if ((type === "raise" || type === "bet") && typeof action?.minAmountTo === "number") {
    return { title: type === "bet" ? "Bet" : "Raise to", detail: formatBb(selectedRaiseAmount ?? action.minAmountTo, bigBlind) };
  }

  if (type === "all-in" && typeof action?.amountTo === "number") {
    return { title: "All in", detail: formatBb(action.amountTo, bigBlind) };
  }

  return { title: formatAction(type), detail: null };
}

function actionToneClass(type: ActionType): string {
  if (type === "fold") {
    return "is-fold-action";
  }

  if (type === "all-in") {
    return "is-all-in-action";
  }

  if (type === "call" || type === "check") {
    return "is-call-action";
  }

  return "is-raise-action";
}

function readRaiseLimits(actions: ActionItem[]): { min: number; max: number | null } | null {
  const raiseAction = actions.find((action) => action.type === "raise" || action.type === "bet");
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
  const rawBets = [0.33, 0.5, 0.75, 1].map((ratio) => ({
    label: `${Math.round(ratio * 100)}%`,
    amount: Math.max(blind, Math.round(potSize * ratio))
  }));

  return rawBets.map((bet) => ({
    ...bet,
    amount: clampBetAmount(bet.amount, raiseLimits)
  }));
}

function formatBb(amount: number, bigBlind?: number | null): string {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const value = amount / blind;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} BB`;
}

function clampBetAmount(amount: number, raiseLimits: { min: number; max: number | null } | null): number {
  if (!raiseLimits) {
    return amount;
  }

  const minClamped = Math.max(amount, raiseLimits.min);
  return raiseLimits.max === null ? minClamped : Math.min(minClamped, raiseLimits.max);
}

function getBetSliderStep(bigBlind?: number | null): number {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  return Math.max(1, Math.round(blind));
}

function getBetSliderBounds({
  raiseLimits,
  raiseAmount,
  bigBlind
}: {
  raiseLimits: { min: number; max: number | null } | null;
  raiseAmount: string;
  bigBlind?: number | null;
}): { min: number; max: number } {
  const blind = typeof bigBlind === "number" && bigBlind > 0 ? bigBlind : 20;
  const parsedAmount = readPositiveAmount(raiseAmount);
  const min = raiseLimits?.min ?? blind;
  const fallbackMax = Math.max(min, parsedAmount ?? min, blind * 100);
  const max = typeof raiseLimits?.max === "number" ? Math.max(raiseLimits.max, min) : fallbackMax;

  return { min, max };
}
