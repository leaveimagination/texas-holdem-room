# GGpoker-Style Commercial Table Design

## Benchmark

The attached GGpoker-style screenshot is the hard visual benchmark. The table must read as a poker client, not a web dashboard.

## Critical Gates

- Local player is always bottom-center for 2-6 seats.
- Hero cards, hero name, and hero stack read as one foreground composition on the bottom rail.
- Desktop action console is lower-right, compact, and visually dominated by `Fold`, `Call`, and `Raise to`.
- Quick bet row contains `33%`, `50%`, `75%`, and `100%`.
- Join UI is modal/page-like before entry and disappears after join.
- Rebuy success creates visible table feedback for all players.
- No overlap between hero cards, hero plate, action console, utilities, and seat plates at desktop and mobile viewports.

## Layout Model

Bottom center belongs to the local player. The hero seat owns the large hole cards, avatar/seat plate, name, stack, and timer/status bar.

Lower-right belongs to betting decisions. The action console has a top row for quick bet sizing and amount adjustment, then a bottom row of large red action buttons.

Lower-left belongs to secondary utilities. Chat, emoji, sit-out, add chips, and host tools must stay visually subordinate.

The table center belongs to public hand state: pot, board, current actor, and committed chip markers.

Seats around the rail use circular avatar medallions plus compact dark player plates. Fold/dealer/blind/acting/winner/disconnected states appear as badges near the plate.

## First Iteration Scope

- Move hero presentation out of the action dock and into the local bottom seat composition.
- Rebuild the action dock into a lower-right GGpoker-style console.
- Make all live action buttons red peers, including fold.
- Replace loose rebuy feedback with a visible table toast/event.
- Add tests that protect the new markup contract and pre-join cleanliness.

## Acceptance Screens

- 1440x900 pre-join modal over dimmed table.
- 1440x900 joined six-seat table, waiting state.
- 1440x900 hero-turn state with `Fold`, `Call`, `Raise to`, and quick bet row visible.
- 390x844 mobile joined state with no bottom overlap.
