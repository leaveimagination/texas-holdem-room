import type { Page } from "@playwright/test";
import { redactForEvidence } from "../evidence/redaction";

export interface SafeWebSocketProjection {
  type: string;
  phase: string | null;
  sequence: number | null;
  handNumber: number | null;
  street: string | null;
  boardLength: number | null;
  pot: number | null;
  actor: string | null;
  privateCardKeyPresent: boolean;
}

export interface TelemetryEvent {
  kind:
    | "websocket-message"
    | "websocket-close"
    | "console-error"
    | "page-error"
    | "request-failure"
    | "dom-checkpoint";
  wallTime: string;
  monotonicMs: number;
  details: Record<string, unknown>;
}

export type TelemetrySink = (event: TelemetryEvent) => void | Promise<void>;

export interface BrowserTelemetry {
  captureDomCheckpoint(checkpoint: string): Promise<TelemetryEvent>;
  flush(): Promise<void>;
}

export function projectWebSocketPayload(payload: unknown): SafeWebSocketProjection {
  const malformed = emptyProjection("malformed");
  if (typeof payload !== "string") {
    return malformed;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return malformed;
  }
  const message = record(parsed);
  if (!message) {
    return malformed;
  }
  const body = record(message.payload) ?? message;
  const flow = record(body.flow) ?? record(message.flow);
  const hand = record(body.hand) ?? record(message.hand);
  const board = hand?.board;
  return {
    type: stringField(message.type) ?? "unknown",
    phase: stringField(flow?.phase) ?? stringField(body.phase),
    sequence: numberField(flow?.sequence) ?? numberField(body.phaseSequence) ?? numberField(body.sequence),
    handNumber: numberField(hand?.number) ?? numberField(body.handNumber),
    street: stringField(hand?.street) ?? stringField(body.street),
    boardLength: Array.isArray(board)
      ? board.length
      : numberField(body.boardLength) ??
        (numberField(body.cardIndex) === null ? null : numberField(body.cardIndex)! + 1),
    pot: numberField(hand?.pot) ?? numberField(body.pot),
    actor: stringField(hand?.actorId) ?? stringField(body.actorId) ?? stringField(body.actor),
    privateCardKeyPresent: hasPrivateCardKey(parsed)
  };
}

export async function installBrowserTelemetry(
  page: Page,
  actor: string,
  sink: TelemetrySink
): Promise<BrowserTelemetry> {
  const pending = new Set<Promise<void>>();
  const sinkFailures: unknown[] = [];
  const enqueue = (event: TelemetryEvent) => {
    const operation = Promise.resolve().then(() => sink(event));
    pending.add(operation);
    void operation.then(
      () => pending.delete(operation),
      (error) => {
        sinkFailures.push(error);
        pending.delete(operation);
      }
    );
  };
  const emitNodeEvent = (kind: TelemetryEvent["kind"], details: Record<string, unknown>) => {
    enqueue({ kind, wallTime: new Date().toISOString(), monotonicMs: performance.now(), details: { actor, ...details } });
  };
  const bindingName = `__experienceTelemetry_${actor.replace(/[^a-z\d_]/gi, "_")}`;

  await page.exposeBinding(bindingName, (_source, event: unknown) => {
    const sanitized = sanitizeBrowserTelemetryEvent(event, actor);
    if (sanitized) {
      enqueue(sanitized);
    }
  });
  await page.addInitScript(browserTelemetryInitScript, { bindingName });

  page.on("console", (message) => {
    if (message.type() === "error") {
      emitNodeEvent("console-error", { message: sanitizeDiagnosticString(message.text()) });
    }
  });
  page.on("pageerror", (error) => emitNodeEvent("page-error", {
    message: sanitizeDiagnosticString(error.message)
  }));
  page.on("requestfailed", (request) => emitNodeEvent("request-failure", {
    method: request.method(),
    url: safeUrl(request.url()),
    failure: sanitizeDiagnosticString(request.failure()?.errorText ?? "unknown")
  }));

  return {
    async captureDomCheckpoint(checkpoint: string): Promise<TelemetryEvent> {
      const details = await page.evaluate((serializedCheckpoint) => {
        const table = document.querySelector<HTMLElement>('[aria-label="Table"]');
        const seats = Array.from(document.querySelectorAll<HTMLElement>("[data-seat-number]")).map((seat) => ({
          seatNumber: numberFromDataset(seat.dataset.seatNumber),
          participantId: seat.dataset.participantId ?? null,
          status: seat.dataset.seatStatus ?? null,
          local: seat.dataset.localSeat === "true"
        }));
        const actions = Array.from(document.querySelectorAll<HTMLElement>("[data-action-type]"))
          .map((action) => action.dataset.actionType ?? null)
          .filter((action): action is string => action !== null);
        const pendingTopUp = document.querySelector<HTMLElement>("[data-pending-top-up]")?.dataset.pendingTopUp;
        return {
          checkpoint: serializedCheckpoint,
          phase: table?.dataset.flowPhase ?? null,
          sequence: numberFromDataset(table?.dataset.flowSequence),
          handNumber: numberFromDataset(table?.dataset.handNumber),
          boardLength: numberFromDataset(table?.dataset.boardCardCount),
          seats,
          actions,
          pendingTopUp: numberFromDataset(pendingTopUp),
          handResultNumber: numberFromDataset(document.querySelector<HTMLElement>("[data-hand-result-number]")?.dataset.handResultNumber),
          sessionResultState: document.querySelector<HTMLElement>("[data-session-result-state]")?.dataset.sessionResultState ?? null
        };

        function numberFromDataset(value: string | undefined): number | null {
          if (value === undefined || value === "") return null;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        }
      }, checkpoint);
      const event: TelemetryEvent = {
        kind: "dom-checkpoint",
        wallTime: new Date().toISOString(),
        monotonicMs: performance.now(),
        details: { actor, ...details }
      };
      enqueue(event);
      return event;
    },
    async flush(): Promise<void> {
      await Promise.allSettled([...pending]);
      if (sinkFailures.length > 0) {
        const failures = sinkFailures.splice(0);
        throw new AggregateError(
          failures,
          `Telemetry sink failed: ${failures.map(errorMessage).join("; ")}`
        );
      }
    }
  };
}

function browserTelemetryInitScript({ bindingName }: { bindingName: string }): void {
  const NativeWebSocket = window.WebSocket;
  const emit = (event: TelemetryEvent) => {
    const binding = (window as unknown as Record<string, unknown>)[bindingName];
    if (typeof binding === "function") {
      void (binding as (value: TelemetryEvent) => Promise<void>)(event);
    }
  };
  const event = (kind: TelemetryEvent["kind"], details: Record<string, unknown>): TelemetryEvent => ({
    kind,
    wallTime: new Date().toISOString(),
    monotonicMs: performance.now(),
    details
  });
  const project = (text: string): SafeWebSocketProjection => {
    const empty = (): SafeWebSocketProjection => ({
      type: "malformed", phase: null, sequence: null, handNumber: null,
      street: null, boardLength: null, pot: null, actor: null,
      privateCardKeyPresent: false
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return empty();
    }
    const asRecord = (value: unknown): Record<string, unknown> | null =>
      typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
    const stringValue = (value: unknown): string | null => typeof value === "string" ? value : null;
    const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
    const containsPrivateKey = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(containsPrivateKey);
      const object = asRecord(value);
      if (!object) return false;
      return Object.entries(object).some(([key, nested]) =>
        key === "holeCards" || key === "privateCards" || containsPrivateKey(nested)
      );
    };
    const message = asRecord(parsed);
    if (!message) return empty();
    const body = asRecord(message.payload) ?? message;
    const flow = asRecord(body.flow) ?? asRecord(message.flow);
    const hand = asRecord(body.hand) ?? asRecord(message.hand);
    const cardIndex = numberValue(body.cardIndex);
    return {
      type: stringValue(message.type) ?? "unknown",
      phase: stringValue(flow?.phase) ?? stringValue(body.phase),
      sequence: numberValue(flow?.sequence) ?? numberValue(body.phaseSequence) ?? numberValue(body.sequence),
      handNumber: numberValue(hand?.number) ?? numberValue(body.handNumber),
      street: stringValue(hand?.street) ?? stringValue(body.street),
      boardLength: Array.isArray(hand?.board) ? hand.board.length : numberValue(body.boardLength) ?? (cardIndex === null ? null : cardIndex + 1),
      pot: numberValue(hand?.pot) ?? numberValue(body.pot),
      actor: stringValue(hand?.actorId) ?? stringValue(body.actorId) ?? stringValue(body.actor),
      privateCardKeyPresent: containsPrivateKey(parsed)
    };
  };
  const readText = async (data: unknown): Promise<string | null> => {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
    return null;
  };

  class InstrumentedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", (message) => {
        void readText(message.data).then((text) => {
          if (text !== null) emit(event("websocket-message", { projection: project(text) }));
        });
      });
      this.addEventListener("close", (close) => {
        emit(event("websocket-close", { code: close.code, wasClean: close.wasClean }));
      });
    }
  }
  window.WebSocket = InstrumentedWebSocket;
}

function emptyProjection(type: string): SafeWebSocketProjection {
  return {
    type,
    phase: null,
    sequence: null,
    handNumber: null,
    street: null,
    boardLength: null,
    pot: null,
    actor: null,
    privateCardKeyPresent: false
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasPrivateCardKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasPrivateCardKey);
  }
  const object = record(value);
  if (!object) {
    return false;
  }
  return Object.entries(object).some(([key, nested]) =>
    key === "holeCards" || key === "privateCards" || hasPrivateCardKey(nested)
  );
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function sanitizeBrowserTelemetryEvent(
  value: unknown,
  actor: string
): TelemetryEvent | null {
  const input = record(value);
  const details = record(input?.details);
  if (!input || !details) {
    return null;
  }
  const wallTime = typeof input.wallTime === "string"
    ? input.wallTime
    : new Date().toISOString();
  const monotonicMs = typeof input.monotonicMs === "number" &&
      Number.isFinite(input.monotonicMs) && input.monotonicMs >= 0
    ? input.monotonicMs
    : performance.now();

  if (input.kind === "websocket-message") {
    const projection = record(details.projection);
    if (!projection) {
      return null;
    }
    return {
      kind: "websocket-message",
      wallTime,
      monotonicMs,
      details: {
        actor,
        projection: {
          type: stringField(projection.type) ?? "malformed",
          phase: stringField(projection.phase),
          sequence: numberField(projection.sequence),
          handNumber: numberField(projection.handNumber),
          street: stringField(projection.street),
          boardLength: numberField(projection.boardLength),
          pot: numberField(projection.pot),
          actor: stringField(projection.actor),
          privateCardKeyPresent: projection.privateCardKeyPresent === true
        }
      }
    };
  }

  if (input.kind === "websocket-close") {
    return {
      kind: "websocket-close",
      wallTime,
      monotonicMs,
      details: {
        actor,
        code: numberField(details.code),
        wasClean: details.wasClean === true
      }
    };
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDiagnosticString(value: string): string {
  const structurallyRedacted = redactForEvidence(value);
  const diagnostic = typeof structurallyRedacted === "string"
    ? structurallyRedacted
    : JSON.stringify(structurallyRedacted);
  return diagnostic
    .replace(
      /((?:["']?(?:hole|private)[ _-]?cards?["']?)\s*[:=]\s*)(?:\[[^\]\r\n]*\]|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/gi,
      "$1[PRIVATE CARDS REDACTED]"
    )
    .replace(
      /((?:["']?(?:hostToken|participantToken|token|secret|password|passwd|authorization|api[ _-]?key|cookie|credential)["']?)\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/gi,
      "$1[REDACTED]"
    );
}
