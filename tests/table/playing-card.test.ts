import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlayingCard } from "@/components/table/PlayingCard";

describe("PlayingCard", () => {
  it("renders a suited card with rank and deal animation", () => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { card: "Ah", variant: "board", dealIndex: 1 }));

    expect(html).toContain("poker-card");
    expect(html).toContain("is-red");
    expect(html).toContain("is-heart");
    expect(html).toContain("is-dealing");
    expect(html).toContain("style=\"--deal-index:1\"");
    expect(html).toContain("A");
  });

  it("renders a black suited compact card", () => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { card: "Ts", variant: "mini" }));

    expect(html).toContain("is-black");
    expect(html).toContain("is-spade");
    expect(html).toContain("is-mini");
    expect(html).toContain("T");
  });

  it("marks cards with four-color deck suit classes", () => {
    const hearts = renderToStaticMarkup(createElement(PlayingCard, { card: "Ah" }));
    const diamonds = renderToStaticMarkup(createElement(PlayingCard, { card: "Kd" }));
    const clubs = renderToStaticMarkup(createElement(PlayingCard, { card: "Qc" }));
    const spades = renderToStaticMarkup(createElement(PlayingCard, { card: "Js" }));

    expect(hearts).toContain("is-heart");
    expect(diamonds).toContain("is-diamond");
    expect(clubs).toContain("is-club");
    expect(spades).toContain("is-spade");
  });

  it("uses a slower staggered deal animation for one-by-one card reveals", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

    expect(css).toContain("--card-deal-duration: 620ms");
    expect(css).toContain("--card-deal-stagger: 160ms");
    expect(css).toContain("animation-delay: calc(var(--deal-index, 0) * var(--card-deal-stagger))");
    expect(css).toContain("@keyframes deal-card");
  });
});
