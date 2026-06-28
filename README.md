# Texas Hold'em Friends Room

A private Texas Hold'em room for friends. The app uses virtual chips for play only; chips have no external value and cannot be recharged, withdrawn, exchanged, settled, or redeemed for prizes.

## Development

Install dependencies:

```bash
npm install
```

Generate Prisma client if needed:

```bash
npm run prisma:generate
```

Run the development server:

```bash
npm run dev
```

The custom server entry point is `src/server/index.ts`. Local realtime and persistence flows may require Redis, Postgres, and the environment variables expected by the server and Prisma configuration.

## Verification

Run the core checks before sharing or launching:

```bash
npm test
npm run typecheck
npm run test:e2e
npm run build
```

Also run the unsafe-copy search:

```bash
rg -n "money|cash|cash out|withdraw|recharge|prize|reward|settlement|gambl|public lobby|public matchmaking|casino|wallet|payment|exchange|redeem|redemption|bonus|payout|赢钱|提现|充值|奖金|赌博|现金|真钱|兑换|奖品|公开大厅" src docs README.md
```

Expected matches are allowed only when they are guardrails saying the product does not support those concepts.

## Product Boundaries

- Private friends rooms only; no public lobby or public matchmaking.
- Virtual chips only; no money movement or external-value token flow.
- No recharge, withdrawal, cash out, settlement, prizes, rewards, or redemption.
- Copy should emphasize private play, practice, virtual chips, and hand review.
- Launch readiness and copy guardrails live in `docs/launch-checklist.md`.
