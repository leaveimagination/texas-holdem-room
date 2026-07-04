import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("SeatRing CSS", () => {
  it("keeps the local action label above the hero cards", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .seat.is-local-seat .seat-last-action");
    expect(css).toMatch(/\.poker-client-shell \.seat\.is-local-seat \.seat-last-action\s*{[^}]*top:\s*-58px[^}]*z-index:\s*9/s);
  });

  it("makes the current actor seat highly visible", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .seat-to-act-label");
    expect(css).toContain("animation: to-act-label-pop");
    expect(css).toContain("@keyframes to-act-ring-pulse");
    expect(css).toContain("@keyframes to-act-panel-glow");
  });

  it("keeps quick bet amounts visible in the poker client shell", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const quickBetAmountRule = css.match(/\.poker-client-shell \.quick-bet-row button strong\s*{[^}]*}/s)?.[0] ?? "";

    expect(quickBetAmountRule).toContain("display: block");
    expect(quickBetAmountRule).not.toContain("display: none");
  });

  it("blocks table clicks behind a pending insurance decision", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const insuranceBackdropRule = css.match(/\.poker-client-shell \.insurance-backdrop\s*{[^}]*}/s)?.[0] ?? "";

    expect(insuranceBackdropRule).toContain("pointer-events: auto");
    expect(insuranceBackdropRule).not.toContain("pointer-events: none");
  });
});
