# Logic Duel Online - Traceability And Plan Slices

Date: 2026-07-07
Status: v3.2, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Requirement Traceability

| Requirement ID | Requirement | Canonical Spec | Primary Implementation Files | Verification |
|---|---|---|---|---|
| R01 | Create and join two-player rooms by code. | `00-overview-and-agent-contract.md`, `01-game-rules-and-state.md` | `server.js`, `src/rooms.js`, `src/protocol.js`, `public/app.js` | C01, C02, C14 |
| R02 | Host starts only when two seats exist. | `01-game-rules-and-state.md` | `src/rooms.js`, `public/app.js` | C03, C04, C05 |
| R03 | Server deals and sorts hidden hands. | `01-game-rules-and-state.md` | `src/game-core.js`, `src/rooms.js` | C05, unit tests |
| R04 | Question market supports ask, answer, discard, and refill. | `01-game-rules-and-state.md` | `src/questions.js`, `src/game-core.js`, `src/rooms.js` | C07, C09, unit tests |
| R05 | Ordered guesses finish on exact match and pass turn on mismatch. | `01-game-rules-and-state.md` | `src/game-core.js`, `src/rooms.js` | C10, C11, C12 |
| R06 | WebSocket messages follow canonical envelopes and errors. | `02-protocol-visibility-and-security.md` | `server.js`, `src/protocol.js` | C01-C15, integration tests |
| R07 | Hidden information never leaks before finish. | `02-protocol-visibility-and-security.md` | `src/protocol.js`, `src/rooms.js`, `public/app.js` | C06, C11, C12, visibility tests |
| R08 | Same-browser reconnect restores the same seat. | `01-game-rules-and-state.md`, `02-protocol-visibility-and-security.md` | `server.js`, `src/rooms.js`, `public/app.js` | C13 |
| R09 | UI exposes legal actions and room state clearly. | `03-frontend-ux.md` | `public/index.html`, `public/styles.css`, `public/app.js` | Manual verification steps 4-16 |
| R10 | Accessibility and responsive constraints hold. | `03-frontend-ux.md` | `public/index.html`, `public/styles.css`, `public/app.js` | Manual viewport and keyboard checks |
| R11 | Automated and manual verification gates are documented and pass. | `04-verification.md` | `package.json`, `test/*.test.js`, `README.md` | `npm test`, manual verification |

Every implementation task should name the requirement IDs and conformance cases it satisfies.

## Implementation Slices

Use these slices when creating an implementation plan. Each slice should be independently testable and reviewable.

| Slice | Goal | Required Specs | Expected Deliverable |
|---|---|---|---|
| S01 Core rules | Pure tile, deal, sort, question, guess, and turn logic. | `01-game-rules-and-state.md`, `04-verification.md` | `src/game-core.js`, `src/questions.js`, unit tests. |
| S02 Room state | Server-side room lifecycle, seats, reconnect token model, expiry, state transitions. | `01-game-rules-and-state.md`, `02-protocol-visibility-and-security.md`, `04-verification.md` | `src/rooms.js`, room tests. |
| S03 Protocol | Message validation, error helpers, `RoomView` filtering, visibility tests. | `02-protocol-visibility-and-security.md`, `04-verification.md` | `src/protocol.js`, protocol tests. |
| S04 WebSocket server | HTTP static server, `/ws`, connection mapping, broadcasting, integration flows. | `00-overview-and-agent-contract.md`, `02-protocol-visibility-and-security.md`, `04-verification.md` | `server.js`, integration tests. |
| S05 Frontend shell | HTML structure, connection forms, room state rendering, action controls. | `03-frontend-ux.md`, `02-protocol-visibility-and-security.md` | `public/index.html`, `public/app.js`, `public/styles.css`. |
| S06 Frontend gameplay | Question actions, guess form, history, reconnect, final reveal, responsive polish. | `03-frontend-ux.md`, `04-verification.md` | Playable UI passing manual checks. |
| S07 Docs and final verification | README, commands, manual checklist run, final acceptance. | `00-overview-and-agent-contract.md`, `04-verification.md` | `README.md`, final verification evidence. |

## Review Checkpoints

Before approving a slice:

- Confirm the slice names its covered requirement IDs.
- Confirm the tests include the relevant conformance case IDs.
- Confirm no hidden state is exposed in public payloads.
- Confirm any spec ambiguity found during work was resolved in the relevant sub-spec before implementation continued.
- Confirm unrelated workspace files were not staged.

## Canonical Ownership

When information appears to belong in more than one file, use this ownership rule:

- Product scope, commands, project structure, code style, Git workflow: `00-overview-and-agent-contract.md`.
- Game entities, rules, room lifecycle, state machine: `01-game-rules-and-state.md`.
- Message envelopes, validation, visibility, errors, security: `02-protocol-visibility-and-security.md`.
- UI layout, interaction, accessibility, responsive behavior: `03-frontend-ux.md`.
- Tests, conformance IDs, manual verification, acceptance: `04-verification.md`.
- Decisions, non-blocking questions, roadmap: `05-decisions-and-roadmap.md`.
- Requirement-to-test-to-task mapping: `06-traceability-and-plan-slices.md`.

If two files conflict, stop and update the canonical owner first, then update references in other files.
