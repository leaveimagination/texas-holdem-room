import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionControls } from "@/components/table/ActionControls";

describe("ActionControls", () => {
  it("disables betting actions when the local participant is not the actor", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p2",
        localParticipantId: "p1",
        playerControls: true
      })
    );

    expect(html).toContain("Waiting for another player");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("shows a turn prompt when the local participant is the actor", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        heroCards: ["As", "Kh"],
        heroName: "home",
        heroStack: 1980
      })
    );

    expect(html).toContain("YOUR TURN");
    expect(html).not.toContain("Your hand");
    expect(html).not.toContain("hero-pocket");
    expect(html).not.toContain("hero-cards");
    expect(html).not.toContain("home");
    expect(html).not.toContain("99 BB");
    expect(html).not.toContain("As");
    expect(html).not.toContain("Kh");
  });

  it("renders quick bet controls without a persistent add chips tool while stacked", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        heroStack: 2000,
        bigBlind: 20,
        pot: 80,
        legalActions: { actions: [{ type: "fold" }, { type: "call", amount: 30 }, { type: "raise", minAmountTo: 80, maxAmountTo: 2000 }] }
      })
    );

    expect(html).toContain("action-console");
    expect(html).toContain("quick-bet-row");
    expect(html).toContain("33%");
    expect(html).toContain("50%");
    expect(html).toContain("75%");
    expect(html).toContain("100%");
    expect(html).toContain("4 BB");
    expect(html).toContain("Call");
    expect(html).toContain("1.5 BB");
    expect(html).toContain("Raise to");
    expect(html).toContain("4 BB");
    expect(html).not.toContain("Add chips");
    expect(html).not.toContain("rebuy-popover");
    expect(html).not.toContain("rebuy-modal");
  });

  it("shows add chips as a modal only after the player is out of chips", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: null,
        localParticipantId: "p1",
        playerControls: true,
        heroStack: 0,
        tableStatus: "lobby"
      })
    );

    expect(html).toContain("rebuy-modal");
    expect(html).toContain("Add chips");
    expect(html).toContain("Add chips amount");
  });

  it("renders live action buttons with client-style action weights", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        legalActions: {
          actions: [
            { type: "fold" },
            { type: "call", amount: 40 },
            { type: "raise", minAmountTo: 120, maxAmountTo: 1000 }
          ]
        }
      })
    );

    expect(html).toContain("primary-action-row");
    expect(html).toContain(">Fold<");
    expect(html).toContain(">Call<");
    expect(html).toContain(">Raise to<");
    expect(html).toContain("is-fold-action");
    expect(html).toContain("is-call-action");
    expect(html).toContain("is-raise-action");
    expect(html).toContain("class=\"is-primary-action is-fold-action\"");
    expect(html).not.toContain("is-secondary-action");
  });

  it("renders the legal raise amount as a draggable bet slider", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        bigBlind: 20,
        playerControls: true,
        legalActions: {
          actions: [{ type: "raise", minAmountTo: 240, maxAmountTo: 2000 }]
        }
      })
    );

    expect(html).toContain("bet-slider-control");
    expect(html).toContain("aria-label=\"Bet amount slider\"");
    expect(html).toContain("type=\"range\"");
    expect(html).toContain("min=\"240\"");
    expect(html).toContain("max=\"2000\"");
    expect(html).toContain("step=\"20\"");
    expect(html).toContain("value=\"240\"");
    expect(html).toContain("12 BB");
    expect(html).not.toContain("value=\"100\"");
    expect(html).not.toContain("aria-label=\"Raise amount\"");
  });

  it("keeps all-in as an explicit action button instead of a slider-side icon", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        legalActions: {
          actions: [
            { type: "fold" },
            { type: "call", amount: 40 },
            { type: "raise", minAmountTo: 120, maxAmountTo: 1000 },
            { type: "all-in", amountTo: 1000 }
          ]
        }
      })
    );

    expect(html).toContain(">All in<");
    expect(html).toContain("50 BB");
    expect(html).toContain("is-all-in-action");
    expect(html).not.toContain("all-in-chip");
  });

  it("does not invent fallback legal actions during a live hand when actions are absent", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        tableStatus: "playing"
      })
    );

    expect(html).toContain("action-console");
    expect(html).not.toContain(">Fold<");
    expect(html).not.toContain(">Check<");
    expect(html).not.toContain(">Call<");
    expect(html).not.toContain(">Raise<");
    expect(html).not.toContain(">All in<");
  });

  it("keeps a disabled betting console shape while waiting for the host to start", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: null,
        localParticipantId: "p1",
        playerControls: true,
        tableStatus: "lobby"
      })
    );

    expect(html).toContain("Waiting for host to deal");
    expect(html).toContain("bet-console is-waiting");
    expect(html).toContain("bet-slider-control is-disabled");
    expect(html).toContain("bet-slider-track");
    expect(html).toContain("<span>Fold</span>");
    expect(html).toContain("<span>Call</span>");
    expect(html).toContain("<span>Raise to</span>");
    expect(html).not.toContain("value=\"--\"");
    expect(html).not.toContain(">--<");
    expect(html).toContain("disabled");
  });

  it("keeps room management behind a host tools menu", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: null,
        hostControls: true,
        playerControls: true,
        localParticipantId: "p1",
        tableStatus: "lobby"
      })
    );

    expect(html).toContain("<summary>Host tools</summary>");
    expect(html).toContain(">Start room<");
  });
});
