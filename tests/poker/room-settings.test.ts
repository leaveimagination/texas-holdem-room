import { describe, expect, it } from "vitest";
import { validateRoomSettings } from "@/lib/room/settings";

describe("room settings", () => {
  it("accepts cash settings without blind increases", () => {
    const settings = validateRoomSettings({
      mode: "cash",
      seats: 6,
      initialChips: 2000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null
    });

    expect(settings.mode).toBe("cash");
    expect(settings.actionTimerSeconds).toBeNull();
  });

  it("accepts tournament blind increases by hands", () => {
    const settings = validateRoomSettings({
      mode: "tournament",
      seats: 4,
      initialChips: 3000,
      smallBlind: 25,
      bigBlind: 50,
      actionTimerSeconds: 30,
      blindIncrease: { type: "hands", interval: 10 }
    });

    expect(settings.mode).toBe("tournament");
    if (settings.mode === "tournament") {
      expect(settings.blindIncrease).toEqual({ type: "hands", interval: 10 });
    }
  });

  it("rejects fewer than two seats", () => {
    expect(() => validateRoomSettings({ mode: "cash", seats: 1 })).toThrow();
  });
});
