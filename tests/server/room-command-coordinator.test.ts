import { describe, expect, it } from "vitest";
import { RoomCommandCoordinator } from "@/server/room-command-coordinator";

describe("RoomCommandCoordinator", () => {
  it("serializes operations for one room while allowing another room to proceed", async () => {
    const coordinator = new RoomCommandCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    const first = coordinator.run("r1", async () => {
      order.push("a-start");
      markStarted();
      await gate;
      order.push("a-end");
    }, "client");
    const second = coordinator.run("r1", async () => {
      order.push("b");
    }, "client");
    const otherRoom = coordinator.run("r2", async () => {
      order.push("other");
    }, "client");

    await started;
    await otherRoom;
    expect(order).toEqual(["a-start", "other"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["a-start", "other", "a-end", "b"]);
  });

  it("continues the queue after an operation fails", async () => {
    const coordinator = new RoomCommandCoordinator();
    const order: string[] = [];

    const failure = coordinator.run("r1", async () => {
      order.push("failed");
      throw new Error("boom");
    }, "client");
    const recovery = coordinator.run("r1", async () => {
      order.push("recovered");
      return 42;
    }, "client");

    await expect(failure).rejects.toThrow("boom");
    await expect(recovery).resolves.toBe(42);
    expect(order).toEqual(["failed", "recovered"]);
  });

  it("rejects the 257th pending client command but never rejects timer work", async () => {
    const coordinator = new RoomCommandCoordinator();
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    const clientWork = Array.from({ length: 256 }, (_, index) => coordinator.run("busy-room", async () => {
      if (index === 0) {
        markStarted();
        await gate;
      }
    }, "client"));
    await started;

    await expect(coordinator.run("busy-room", async () => undefined, "client")).rejects.toMatchObject({
      code: "SERVER_BUSY"
    });
    const timerWork = coordinator.run("busy-room", async () => "timer-ran", "timer");

    release();
    await expect(Promise.all(clientWork)).resolves.toHaveLength(256);
    await expect(timerWork).resolves.toBe("timer-ran");

    await expect(coordinator.run("busy-room", async () => "available", "client")).resolves.toBe("available");
  });
});
