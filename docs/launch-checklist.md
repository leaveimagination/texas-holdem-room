# Launch Checklist

Use this checklist before any preview, demo, or public share of the private friends-room build.

## Product Guardrails

- The product is a private Texas Hold'em room for friends using virtual chips only.
- Virtual chips are play tokens for the current room experience and have no external value.
- Rooms are invite-only by link or room identifier. Do not present the app as a public lobby, public matchmaking service, or casino.
- Do not add or imply recharge, withdrawal, cash out, prizes, rewards, exchange, settlement, or other value-transfer flows.
- Do not add wallet, payment, account balance, leaderboard-for-value, promotional bonus, or payout language.
- Keep copy focused on practice, friendly play, private rooms, virtual chips, hand review, and table state.

## Copy Review

- Home page says the app is for a private friends room.
- Create flow says chip values are virtual and have no external value.
- Join and room screens avoid language that implies money, gambling profit, prizes, recharge, withdrawal, settlement, or cash out.
- Any guardrail documentation that mentions prohibited concepts frames them as exclusions.

Run the unsafe-copy search before launch:

```bash
rg -n "money|cash|cash out|withdraw|recharge|prize|reward|settlement|gambl|public lobby|public matchmaking|casino|wallet|payment|exchange|redeem|redemption|bonus|payout|赢钱|提现|充值|奖金|赌博|现金|真钱|兑换|奖品|公开大厅" src docs README.md
```

Expected hits should be limited to guardrail-only documentation that explicitly says those concepts are not supported.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run test:e2e`
- `npm run build`

If end-to-end tests or build need local Redis, Postgres, browser binaries, or environment variables, record the exact missing dependency and rerun after the dependency is available.

## Launch Readiness

- Private-room create and join flows have been manually smoke-tested.
- Reconnection, spectator, and hand-review behavior have fresh automated test coverage or a documented reason for deferral.
- No production environment exposes database, Redis, or WebSocket credentials to the browser.
- Logs and errors do not expose invite secrets or participant tokens.
- Deployment notes include required environment variables and local service dependencies.
