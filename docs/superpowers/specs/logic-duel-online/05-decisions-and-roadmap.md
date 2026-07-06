# Logic Duel Online - Decisions And Roadmap

Date: 2026-07-07
Status: v3.2, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Decision Log

- 2026-07-06: Use standalone `logic-duel/` app instead of modifying existing `demo/`.
- 2026-07-06: Use Node.js plus WebSocket for real-time rooms and deployability.
- 2026-07-06: Limit version 1 to two players.
- 2026-07-06: Use an original custom question deck instead of commercial card text.
- 2026-07-06: Use in-memory rooms for version 1.
- 2026-07-06: Use same-browser reconnect tokens instead of accounts.
- 2026-07-07: Make spec English-only because code-facing contracts are canonical and the user no longer needs Chinese.
- 2026-07-07: Harden spec using agent-oriented PRD/SRS practices: six core areas, three-tier boundaries, conformance cases, and spec index.
- 2026-07-07: Split the spec into focused files and add traceability so implementation agents can load only relevant contracts.


## Open Questions

None blocking version 1 implementation.

Non-blocking choices for implementation planning:

- Whether to add a small debug-only helper for manual correct-guess verification.
- Whether room codes should avoid ambiguous characters such as `0`, `O`, `1`, and `I`.
- Whether failed guess history should display the full guessed sequence or only that a guess was attempted. Current default: display the public guessed sequence.


## Future Extensions

- Three- or four-player variants.
- AI opponent.
- Public deployment with share links.
- Persistent room links.
- Database-backed rooms.
- Cross-device reconnect.
- Spectator mode with delayed or finished-only reveal.
- Fuller custom question deck.
- Replay export.
- Cryptographic shuffle proof.
