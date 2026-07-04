import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("SeatRing CSS", () => {
  it("keeps the local action label above the hero cards", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .seat.is-local-seat .seat-last-action");
    expect(css).toMatch(/\.poker-client-shell \.seat\.is-local-seat \.seat-last-action\s*{[^}]*top:\s*-58px[^}]*z-index:\s*9/s);
  });
});
