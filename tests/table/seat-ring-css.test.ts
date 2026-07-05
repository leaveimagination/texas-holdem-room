import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("SeatRing CSS", () => {
  it("keeps the local action label above the hero cards", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .seat.is-local-seat .seat-last-action");
    expect(css).toMatch(/\.poker-client-shell \.seat\.is-local-seat \.seat-last-action\s*{[^}]*top:\s*-58px[^}]*z-index:\s*9/s);
  });

  it("does not render the removed to-act animation styles", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).not.toContain(".poker-client-shell .seat-to-act-label");
    expect(css).not.toContain("to-act-label-pop");
    expect(css).not.toContain("to-act-ring-pulse");
    expect(css).not.toContain("to-act-panel-glow");
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

  it("keeps all-in labels inside the seat panel away from committed chip markers", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const allInRule = css.match(/\.poker-client-shell \.seat-last-action\.is-all-in-action-label\s*{[^}]*}/s)?.[0] ?? "";
    const betRule = css.match(/\.poker-client-shell \.seat-bet\s*{[^}]*}/s)?.[0] ?? "";

    expect(allInRule).toContain("position: static");
    expect(allInRule).not.toContain("top:");
    expect(allInRule).not.toContain("animation: all-in-pulse");
    expect(betRule).toContain("z-index: 7");
  });

  it("animates bet chip towers without covering the bet amount", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const chipTowerRule = css.match(/\.poker-client-shell \.chip-tower\s*{[^}]*}/s)?.[0] ?? "";
    const chipAmountRule = css.match(/\.poker-client-shell \.seat-bet-amount\s*{[^}]*}/s)?.[0] ?? "";

    expect(chipTowerRule).toContain("animation: chip-tower-pop 1s");
    expect(chipTowerRule).toContain("--chip-layers");
    expect(chipAmountRule).toContain("z-index: 2");
  });

  it("shows collect-pot winner smile feedback for three seconds", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .winner-smile-badge");
    expect(css).toContain("animation: winner-smile-pop 3s");
    expect(css).toContain("animation: winner-seat-glow 3s");
  });
});
