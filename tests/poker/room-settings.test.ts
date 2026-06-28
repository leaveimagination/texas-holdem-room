import { describe, expect, it } from "vitest";
import { validateRoomSettings } from "@/lib/room/settings";

const validCashSettings = {
  mode: "cash",
  seats: 6,
  initialChips: 2000,
  smallBlind: 10,
  bigBlind: 20,
  actionTimerSeconds: null
};

const validTournamentSettings = {
  ...validCashSettings,
  mode: "tournament",
  blindIncrease: { type: "hands", interval: 10 }
};

describe("room settings", () => {
  it("accepts cash settings without blind increases", () => {
    const settings = validateRoomSettings(validCashSettings);

    expect(settings.mode).toBe("cash");
    expect(settings.actionTimerSeconds).toBeNull();
  });

  it("accepts tournament blind increases by hands", () => {
    const settings = validateRoomSettings(validTournamentSettings);

    expect(settings.mode).toBe("tournament");
    if (settings.mode === "tournament") {
      expect(settings.blindIncrease).toEqual({ type: "hands", interval: 10 });
    }
  });

  it("rejects fewer than two seats", () => {
    expect(() => validateRoomSettings({ ...validCashSettings, seats: 1 })).toThrow();
  });

  it("rejects cash mode with blind increases", () => {
    expect(() =>
      validateRoomSettings({
        ...validCashSettings,
        blindIncrease: { type: "hands", interval: 10 }
      })
    ).toThrow();
  });

  it("rejects tournament mode without blind increases", () => {
    expect(() =>
      validateRoomSettings({
        ...validCashSettings,
        mode: "tournament"
      })
    ).toThrow();
  });
});
