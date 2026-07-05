# Poker Room QA Test Checklist

Use this checklist before sharing a build or after any change to poker rules, realtime messages, room links, rebuy, insurance, or the table UI.

## Required Automated Commands

- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `LONG_RUN_SECONDS=600 ACTION_DELAY_MS=0 npm run test:long-run`
- `npm run build`

For release candidates, run the long-run simulation at `LONG_RUN_SECONDS=3600`.

## 1. Room Creation And Sharing

- Create a cash room with 2 seats, 6 seats, and 9 seats.
- Create a tournament room with blind increases by minutes and by hand count.
- Verify invite links use the public app origin in production, not `127.0.0.1`, `localhost`, or `0.0.0.0`.
- Verify host links work when opened on another browser profile and expose host controls only to the host token holder.
- Verify invite-only players can join without accounts by nickname.
- Verify a spectator can open the room without claiming a seat.

## 2. Seating And Start Flow

- Empty cash-table seats can be claimed before and between hands.
- Tournament seats cannot be claimed after the first hand starts.
- Host can start a room when at least two seated players have chips.
- Start is blocked with one seated player.
- Local player is always displayed at bottom-center after joining.
- Seat order remains logical for 2, 6, and 9 players.

## 3. Core Betting State Machine

- Heads-up blinds post correctly and the small blind acts first preflop.
- Six-handed blinds and button rotate correctly across at least 12 hands.
- Legal actions show only valid options: fold, check, call, bet, raise, all-in.
- Check is disabled or hidden when facing a bet.
- Call is shown instead of check when money is owed.
- Bet is shown instead of raise when no bet exists on the street.
- Raise is shown instead of bet when facing an existing bet.
- Raise-to amounts respect min raise and max all-in limits.
- Short all-in raises do not incorrectly reopen action.
- Full blind completion after a short blind keeps the configured blind as the future raise unit.
- Streets advance preflop -> flop -> turn -> river -> showdown when betting rounds close.

## 4. All-In And Showdown

- Heads-up preflop all-in runs out five board cards before settlement.
- Heads-up postflop all-in runs out remaining board cards before settlement.
- If all remaining players are all-in, no actor remains stuck with zero legal actions.
- All-in action has a visible animation, but it must not block cards, bets, or player names.
- Showdown reveals involved players' cards.
- Winner result and pot collection are visible before the next hand starts.
- If one player busts in cash mode, the busted player sees the add-chips modal.
- After the busted player adds chips, the service automatically starts the next hand when two or more players have chips.
- If fewer than two players have chips after settlement, the table waits without showing invalid action buttons.

## 5. Pots And Side Pots

- Three-player all-in with different stack sizes creates main and side pots.
- A folded player cannot win any pot.
- Side pots are awarded only to eligible players.
- Split pots divide chips evenly and distribute odd chips by seat order.
- Total chips after settlement equals total chips before settlement plus recorded rebuys.

## 6. Insurance

- Insurance is offered only in eligible cash-game all-in spots before the river.
- Only the offered player can accept or decline insurance.
- While insurance is pending, player actions are rejected and UI actions are disabled.
- Declining insurance runs out the board and settles normally.
- Accepting insurance deducts premium if the covered player wins.
- Accepting insurance pays coverage if the covered player loses.
- Insurance modal blocks table clicks until resolved.

## 7. Rebuy And Buy-In Records

- Cash players can add chips only after their stack reaches zero.
- Cash players cannot add chips while still active in a live hand.
- Tournament players cannot add chips.
- Rebuy increments `cumulativeBuyIn`.
- Rebuy broadcasts a system message to the room.
- Rebuy after a finished hand can restart the next hand automatically.
- Rebuy must not expose payment, cash-out, wallet, or real-money language.

## 8. Realtime And Recovery

- Forged participant tokens are rejected before private cards are revealed.
- Forged host tokens are rejected before host actions.
- A player cannot submit actions for another participant.
- Invalid JSON and unsupported message types return errors without crashing the server.
- Joining a second room clears previous session state.
- Disconnect handling can pause the room when an active player disconnects.
- Paused rooms do not auto-start new hands.
- Room snapshots are participant-filtered: spectators cannot see private hole cards.

## 9. UI/UX Regression

- Acting seat is clear without the removed `TO ACT` label/ring animation.
- Cards do not cover player bet labels or stack text.
- Community cards are large enough to read on desktop and mobile.
- The action dock stays in the bottom-right pattern: preset row, amount slider/value, primary action buttons.
- When call is available, check is not displayed as the primary middle action.
- When check is available, call is not displayed as the primary middle action.
- The slider-side mystery all-in icon is not present; all-in is a separate button.
- Add chips appears as a modal only when the player is eligible.
- Mobile layout has no overlapping cards, buttons, bets, or player panels.

## 10. Long-Run Simulation Requirements

- Run six-player cash simulation for at least 10 minutes before routine UI releases.
- Run six-player cash simulation for 1 hour before release candidates.
- The simulation must include folds, calls, bets, raises, all-ins, rebuys, insurance accept/decline, and multi-street showdowns.
- The simulation fails if an active hand has no valid actor, an actor is folded/all-in, legal actions are empty, board has more than five cards, chips become negative, or duplicate participants appear.
- The simulation result must report zero errors and at least one finished hand.

