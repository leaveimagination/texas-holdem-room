import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("six-player long-run simulator", () => {
  it("advances presentation phases instead of sending player actions through them", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/simulate-six-player-session.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ACTION_DELAY_MS: "0",
          LONG_RUN_SECONDS: "0.15"
        },
        timeout: 15_000
      }
    );

    expect(result.stderr).not.toContain("long-run-error");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"handsFinished":');
  });
});
