# Logic Duel Online Spec

Date: 2026-07-07
Status: v3.3, split executable engineering contract

This file is the entry point for the Logic Duel online multiplayer spec. The detailed contract is split into focused sub-specs so agents can load only the sections needed for a task.

## Source Of Truth

The source of truth is the full spec set in `docs/superpowers/specs/logic-duel-online/`. This entry file is an index and high-level contract. If a detailed sub-spec conflicts with this entry file, stop and reconcile the specs before implementation.

## Spec Set

- [00-overview-and-agent-contract.md](logic-duel-online/00-overview-and-agent-contract.md): product intent, maintenance rules, scope, boundaries, commands, project structure, code style, Git workflow, architecture.
- [01-game-rules-and-state.md](logic-duel-online/01-game-rules-and-state.md): data model, tile rules, question cards, room flow, state machine.
- [02-protocol-visibility-and-security.md](logic-duel-online/02-protocol-visibility-and-security.md): WebSocket protocol, `RoomView`, error codes, validation, visibility, security, fair play.
- [03-frontend-ux.md](logic-duel-online/03-frontend-ux.md): interface states, UX rules, accessibility and responsive requirements.
- [04-verification.md](logic-duel-online/04-verification.md): testing strategy, conformance cases, manual verification, acceptance criteria.
- [05-decisions-and-roadmap.md](logic-duel-online/05-decisions-and-roadmap.md): decision log, open questions, future extensions.
- [06-traceability-and-plan-slices.md](logic-duel-online/06-traceability-and-plan-slices.md): requirement traceability, implementation slices, review checkpoints.
- [07-operations-and-invariants.md](logic-duel-online/07-operations-and-invariants.md): runtime invariants, fixtures, observability, deployment and cleanup.

## Global Constraints

- The app lives in a standalone `logic-duel/` directory.
- Frontend uses plain HTML, CSS, and JavaScript; no frontend build step.
- Backend uses Node.js HTTP plus WebSocket.
- Server owns all authoritative state.
- Clients render only filtered `RoomView` data.
- Never send opponent hands or unused tiles to any client before `state === "finished"`.
- Tests must cover game core, room actions, protocol validation, visibility filtering, and invalid actions.
- Do not modify unrelated existing project files.
- Do not copy commercial game text or assets.

## Implementation Loading Guide

- Planning: read this file, `00-overview-and-agent-contract.md`, and `04-verification.md`.
- Game rules work: read `01-game-rules-and-state.md` plus `04-verification.md`.
- WebSocket/server work: read `02-protocol-visibility-and-security.md`, `01-game-rules-and-state.md`, and relevant verification cases.
- Frontend work: read `03-frontend-ux.md`, `02-protocol-visibility-and-security.md`, and relevant verification cases.
- Implementation planning: read `06-traceability-and-plan-slices.md` after the relevant domain specs.
- Deployment or final hardening: read `07-operations-and-invariants.md`.
- Final review: read every file in the spec set.

## Update Rule

Any change to protocol, data model, visibility, game rules, commands, acceptance criteria, or scope must update the relevant sub-spec and this index if the loading guide or global constraints change.
