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

  it("deals cards from a central deck with staggered one-by-one motion", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain(".poker-client-shell .deal-sequence .poker-card.is-dealing");
    expect(css).toContain(".poker-client-shell .deal-sequence .card-back.is-dealing");
    expect(css).toContain("animation: deal-card-from-deck");
    expect(css).toContain("translate3d(var(--deal-from-x, 0px), var(--deal-from-y, -42px), 0)");
    expect(css).toContain("@keyframes deal-card-from-deck");
  });

  it("keeps the upper seats natural without relying on external action labels", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const topLeftSeatRule = css.match(/\.poker-client-shell \.seat-slot-2\s*{[^}]*}/s)?.[0] ?? "";
    const topRightSeatRule = css.match(/\.poker-client-shell \.seat-slot-8\s*{[^}]*}/s)?.[0] ?? "";

    expect(topLeftSeatRule).toContain("top: -2%");
    expect(topRightSeatRule).toContain("top: -2%");
    expect(topLeftSeatRule).not.toContain("top: -8%");
    expect(topRightSeatRule).not.toContain("top: -8%");
    expect(css).not.toContain(".poker-client-shell .seat-slot-2 .seat-last-action,\n.poker-client-shell .seat-slot-8 .seat-last-action");
  });

  it("styles the dealer button as a standalone gold table marker", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const dealerRule = css.match(/\.poker-client-shell \.dealer-button\s*{[^}]*}/s)?.[0] ?? "";

    expect(dealerRule).toContain("position: absolute");
    expect(dealerRule).toContain("border-radius: 999px");
    expect(dealerRule).toContain("background:");
    expect(dealerRule).toContain("color: #211306");
    expect(dealerRule).toContain("animation: dealer-button-pop");
    expect(css).toContain("@keyframes dealer-button-pop");
  });

  it("places the dealer button on the felt toward table center instead of on the nameplate edge", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    const topDealerRule = css.match(/\.poker-client-shell \.seat-slot-1 \.dealer-button,\n\.poker-client-shell \.seat-slot-2 \.dealer-button,\n\.poker-client-shell \.seat-slot-3 \.dealer-button,\n\.poker-client-shell \.seat-slot-8 \.dealer-button\s*{[^}]*}/s)?.[0] ?? "";
    const leftDealerRule = css.match(/\.poker-client-shell \.seat-slot-6 \.dealer-button,\n\.poker-client-shell \.seat-slot-7 \.dealer-button\s*{[^}]*}/s)?.[0] ?? "";
    const rightDealerRule = css.match(/\.poker-client-shell \.seat-slot-4 \.dealer-button,\n\.poker-client-shell \.seat-slot-9 \.dealer-button\s*{[^}]*}/s)?.[0] ?? "";
    const localDealerRule = css.match(/\.poker-client-shell \.seat\.is-local-seat \.dealer-button\s*{[^}]*}/s)?.[0] ?? "";

    expect(topDealerRule).toContain("top: calc(100% + 12px)");
    expect(leftDealerRule).toContain("left: calc(100% + 12px)");
    expect(rightDealerRule).toContain("right: calc(100% + 12px)");
    expect(localDealerRule).toContain("top: -48px");
    expect(localDealerRule).toContain("left: calc(50% + 106px)");
    expect(localDealerRule).not.toContain("bottom: 36px");
  });
});
