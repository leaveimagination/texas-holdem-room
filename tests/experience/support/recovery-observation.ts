import type { TelemetryEvent } from "./telemetry";

export interface ObservedFlowFrame { phase: string | null; sequence: number; board: string[]; actionIds: string[]; resultId: string | null; privateCardCount: number }

export function observedTimeline(events: readonly TelemetryEvent[], actor: string, since: number): ObservedFlowFrame[] {
  const projections = events.slice(since).filter((event) => event.kind === "websocket-message" && event.details.actor === actor).map((event) => event.details.projection as Partial<ObservedFlowFrame> & { privateCardVisibility?: { cardCount?: unknown } }).filter((projection) => typeof projection.phase === "string" && typeof projection.sequence === "number" && projection.sequence >= 1 && projection.sequence <= 7);
  const frames: ObservedFlowFrame[] = [];
  for (const projection of projections) {
    const visibility = projection.privateCardVisibility as { cardCount?: unknown } | undefined;
    const frame = { phase: projection.phase ?? null, sequence: projection.sequence!, board: Array.isArray(projection.board) ? projection.board : [], actionIds: Array.isArray(projection.actionIds) ? projection.actionIds : [], resultId: projection.resultId ?? null, privateCardCount: typeof visibility?.cardCount === "number" ? visibility.cardCount : 0 };
    const existing = frames.find(({ sequence }) => sequence === frame.sequence);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(frame)) frames.push(frame);
  }
  return frames;
}

export function privacySamples(events: readonly TelemetryEvent[], actor: string, since: number) {
  return events.slice(since).filter((event) => event.kind === "websocket-message" && event.details.actor === actor).map((event) => event.details.projection as { board?: unknown; privateCardVisibility?: { cardCount?: unknown } }).map((projection) => ({ board: Array.isArray(projection.board) ? projection.board.filter((card): card is string => typeof card === "string") : [], privateCardCount: typeof projection.privateCardVisibility?.cardCount === "number" ? projection.privateCardVisibility.cardCount : 0 }));
}

export function exactJourneyMatches(input: { frames: readonly ObservedFlowFrame[]; sequences: readonly number[]; phases: readonly string[]; boards: readonly (readonly string[])[]; actionIds: readonly string[]; resultIds: readonly string[] }) {
  const observedActions = [...new Set(input.frames.flatMap(({ actionIds }) => actionIds))];
  const observedResults = [...new Set(input.frames.map(({ resultId }) => resultId).filter((id): id is string => id !== null))];
  return input.frames.length > 0 && JSON.stringify(input.frames.map(({ sequence }) => sequence)) === JSON.stringify(input.sequences) && JSON.stringify(input.frames.map(({ phase }) => phase)) === JSON.stringify(input.phases) && JSON.stringify(input.frames.map(({ board }) => board)) === JSON.stringify(input.boards) && JSON.stringify(observedActions) === JSON.stringify(input.actionIds) && JSON.stringify(observedResults) === JSON.stringify(input.resultIds);
}

export function privacyTimelineIsSafe(samples: readonly { board: readonly string[]; privateCardCount: number }[], oracleBoard: readonly string[], spectator: boolean) {
  return samples.length > 0 && samples.every((sample) => sample.board.length <= oracleBoard.length && sample.board.every((card, index) => card === oracleBoard[index]) && (!spectator || sample.privateCardCount === 0));
}

export function requiredCountsPresent(counts: readonly { count: number; minimum: number }[]) {
  return counts.length > 0 && counts.every(({ count, minimum }) => count >= minimum);
}
