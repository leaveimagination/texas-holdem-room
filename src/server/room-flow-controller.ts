import type { Card } from "@/lib/poker/cards";
import {
  advanceDuePhase,
  completeHandBoundary,
  type RoomState
} from "@/lib/poker/engine";

export interface FlowTimerToken {
  roomId: string;
  handId: string | null;
  sequence: number;
  deadlineAt: number;
}

export class RoomFlowController {
  constructor(private readonly clock: () => number = Date.now) {}

  timerToken(room: RoomState): FlowTimerToken | null {
    if (room.flow.deadlineAt === null) {
      return null;
    }
    return {
      roomId: room.roomId,
      handId: room.hand?.id ?? null,
      sequence: room.flow.sequence,
      deadlineAt: room.flow.deadlineAt
    };
  }

  matchesToken(room: RoomState, token: FlowTimerToken): boolean {
    return room.roomId === token.roomId &&
      (room.hand?.id ?? null) === token.handId &&
      room.flow.sequence === token.sequence &&
      room.flow.deadlineAt === token.deadlineAt;
  }

  isHandBoundaryDue(room: RoomState, now = this.clock()): boolean {
    return room.flow.phase === "hand-summary" &&
      room.flow.deadlineAt !== null &&
      room.flow.deadlineAt <= now;
  }

  catchUpDuePhases(room: RoomState, now = this.clock()): RoomState {
    let current = room;
    while (current.flow.deadlineAt !== null && current.flow.deadlineAt <= now) {
      if (this.isHandBoundaryDue(current, now)) {
        return current;
      }
      const advanced = advanceDuePhase(current, now);
      if (advanced === current || advanced.flow.sequence === current.flow.sequence) {
        return current;
      }
      current = advanced;
    }
    return current;
  }

  completeHandBoundary(room: RoomState, now = this.clock(), providedDeck?: Card[]): RoomState {
    if (!this.isHandBoundaryDue(room, now)) {
      return room;
    }
    return completeHandBoundary(room, now, providedDeck);
  }
}
