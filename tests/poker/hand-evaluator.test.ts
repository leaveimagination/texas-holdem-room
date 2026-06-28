import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { compareHands, evaluateSeven } from "@/lib/poker/hand-evaluator";

const cards = (values: string) => values.split(" ").map(parseCard);

describe("hand evaluator", () => {
  it("ranks a royal flush above four of a kind", () => {
    const royal = evaluateSeven(cards("As Ks Qs Js Ts 3d 2c"));
    const quads = evaluateSeven(cards("Ah Ac Ad As 9d 3c 2h"));

    expect(compareHands(royal, quads)).toBeGreaterThan(0);
  });

  it("handles wheel straights", () => {
    const wheel = evaluateSeven(cards("As 2d 3h 4c 5s Kd Qc"));

    expect(wheel.name).toBe("straight");
    expect(wheel.ranks).toEqual([5]);
  });

  it("splits exact ties", () => {
    const first = evaluateSeven(cards("Ah Kd Qs Jc 9h 3d 2c"));
    const second = evaluateSeven(cards("As Kh Qd Jh 9c 4d 2h"));

    expect(compareHands(first, second)).toBe(0);
  });
});
