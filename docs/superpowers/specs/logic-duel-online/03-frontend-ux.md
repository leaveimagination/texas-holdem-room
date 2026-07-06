# Logic Duel Online - Frontend Ux

Date: 2026-07-07
Status: v3.3, split executable engineering contract

Source set: `docs/superpowers/specs/logic-duel-online/`

## Interface

The first screen is the playable game surface, not a landing page.

Layout:

- Room panel: name input, room code input, create/join controls, copy room code, players, connection state, start button.
- Table panel: current turn, question cards, selected action feedback.
- Player panel: own hand, opponent placeholder tiles, ordered guess controls.
- History panel: public questions, answers, failed guesses, result, local notes.

States:

- Not connected: show name, create, and join controls.
- Waiting: show room code, seats, and start readiness.
- Playing: show turn, question cards, own hand, opponent placeholders, guess form, history.
- Finished: show winner, both hands, history, and new room option.


## UX Requirements

- Disable start until two players are seated.
- Disable start for non-owner.
- Disable question cards and guess submission when not active player.
- Make active player name visible.
- Show both players' connection state.
- Keep room code copyable.
- Preserve local notes across normal re-renders.
- Keep latest error visible until next successful action or dismissal.
- Show final reveal area after finish.
- Do not rely on long instructional paragraphs.


## Accessibility And Responsive Requirements

- All buttons and inputs must have accessible labels.
- Question cards must be keyboard-focusable buttons.
- Disabled controls must use actual `disabled` where applicable.
- Color cannot be the only indicator of tile color; include text labels or symbols.
- Layout must remain usable at 360px viewport width.
- Text must not overflow fixed controls.
- Dynamic history updates should not steal focus from active form controls.
