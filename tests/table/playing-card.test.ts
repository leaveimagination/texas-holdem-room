import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayingCard } from "@/components/table/PlayingCard";

describe("PlayingCard", () => {
  it("renders a red suited card with rank, suit, and deal animation", () => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { card: "Ah", variant: "board", dealIndex: 1 }));

    expect(html).toContain("poker-card");
    expect(html).toContain("is-red");
    expect(html).toContain("is-dealing");
    expect(html).toContain("style=\"--deal-index:1\"");
    expect(html).toContain("A");
    expect(html).toContain("♥");
  });

  it("renders a black suited compact card", () => {
    const html = renderToStaticMarkup(createElement(PlayingCard, { card: "Ts", variant: "mini" }));

    expect(html).toContain("is-black");
    expect(html).toContain("is-mini");
    expect(html).toContain("T");
    expect(html).toContain("♠");
  });
});
