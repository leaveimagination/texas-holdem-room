import { describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { CreateRoomPage } from "./create-room-page";
import { RoomPage } from "./room-page";

describe("experience page objects", () => {
  it("creates a room through accessible form names and reads the two visible links", async () => {
    const calls: string[] = [];
    const controls = new Map<string, ReturnType<typeof control>>();
    const lookup = (key: string) => {
      let value = controls.get(key);
      if (!value) {
        value = control(key, calls);
        controls.set(key, value);
      }
      return value;
    };
    lookup("link:Invite link").getAttribute.mockResolvedValue("http://site/room/r1");
    lookup("link:Host link").getAttribute.mockResolvedValue("http://site/room/r1?host=secret");
    const page = {
      goto: vi.fn(async (url: string) => { calls.push(`goto:${url}`); }),
      getByLabel: vi.fn((name: string) => lookup(`label:${name}`)),
      getByRole: vi.fn((role: string, options: { name: string }) => lookup(`${role}:${options.name}`))
    } as unknown as Page;

    const createRoom = new CreateRoomPage(page, "http://site/");
    await createRoom.goto();
    const links = await createRoom.create({
      mode: "cash",
      seats: 6,
      initialChips: 2_000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null
    });

    expect(links).toEqual({
      inviteUrl: "http://site/room/r1",
      hostUrl: "http://site/room/r1?host=secret"
    });
    expect(calls).toEqual([
      "goto:http://site/create",
      "select:label:Mode:cash",
      "select:label:Seats:6",
      "fill:label:Initial chips:2000",
      "fill:label:Small blind:10",
      "fill:label:Big blind:20",
      "fill:label:Action timer seconds:",
      "click:button:Create"
    ]);
  });

  it("drives room actions through accessible names and semantic attributes", async () => {
    const calls: string[] = [];
    const lookup = (key: string) => control(key, calls);
    const page = {
      getByRole: vi.fn((role: string, options: { name: string }) => lookup(`${role}:${options.name}`)),
      getByText: vi.fn((text: string) => lookup(`text:${text}`)),
      locator: vi.fn((selector: string) => lookup(`locator:${selector}`))
    } as unknown as Page;
    const room = new RoomPage(page, {
      actor: "player-1",
      screenshotNamespace: "outputs/screenshots/player-1"
    });

    await room.join("Alice");
    await room.claimSeat(3);
    await room.openHostControls();
    await room.startRoom();
    await room.performAction("raise", 120);
    await room.queueTopUp(300);
    await room.requestRoomEnd();
    await room.waitForPhase("betting", { sequence: 7 });

    expect(calls).toEqual([
      "fill:textbox:Nickname:Alice",
      "click:button:Join",
      "click:button:Claim seat 3",
      "click:text:Host tools",
      "click:button:Start room",
      "fill:slider:Bet amount slider:120",
      "click:locator:[data-action-type=\"raise\"]",
      "click:text:Add chips",
      "fill:spinbutton:Add chips amount:300",
      "click:button:Add next hand",
      "click:text:Host tools",
      "click:button:End room",
      "wait:locator:[aria-label=\"Table\"][data-flow-phase=\"betting\"][data-flow-sequence=\"7\"]:visible"
    ]);
  });

  it("reads a safe projection and captures a checkpoint in the actor namespace", async () => {
    const projection = {
      phase: "betting",
      sequence: 7,
      handNumber: 3,
      street: "flop",
      boardLength: 3,
      pot: 180,
      actor: "p2"
    };
    const table = control("table", []);
    table.evaluate.mockResolvedValue(projection);
    const screenshot = vi.fn(async () => undefined);
    const page = {
      locator: vi.fn(() => table),
      screenshot
    } as unknown as Page;
    const telemetry = {
      captureDomCheckpoint: vi.fn(async () => ({
        kind: "dom-checkpoint" as const,
        wallTime: "2026-07-17T00:00:00.000Z",
        monotonicMs: 10,
        details: { checkpoint: "after-flop" }
      })),
      flush: vi.fn(async () => undefined)
    };
    const room = new RoomPage(page, {
      actor: "player-1",
      screenshotNamespace: "outputs/screenshots/player-1",
      telemetry
    });

    await expect(room.readProjection()).resolves.toEqual(projection);
    await expect(room.captureCheckpoint("after flop")).resolves.toMatchObject({
      artifactId: "screenshot-player-1-after-flop",
      path: "outputs\\screenshots\\player-1\\after-flop.png",
      projection
    });
    expect(screenshot).toHaveBeenCalledWith({
      path: "outputs\\screenshots\\player-1\\after-flop.png",
      fullPage: true
    });
    expect(telemetry.captureDomCheckpoint).toHaveBeenCalledWith("after flop");
  });
});

function control(key: string, calls: string[]) {
  return {
    click: vi.fn(async () => { calls.push(`click:${key}`); }),
    fill: vi.fn(async (value: string) => { calls.push(`fill:${key}:${value}`); }),
    selectOption: vi.fn(async (value: string) => { calls.push(`select:${key}:${value}`); }),
    waitFor: vi.fn(async (options: { state: string }) => { calls.push(`wait:${key}:${options.state}`); }),
    getAttribute: vi.fn<() => Promise<string | null>>(async () => null),
    evaluate: vi.fn<() => Promise<unknown>>(async () => null)
  };
}
