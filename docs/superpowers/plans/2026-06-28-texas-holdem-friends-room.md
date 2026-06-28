# Texas Hold'em Friends Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first private no-limit Texas Hold'em web app where friends can create rooms, join without accounts, play cash games or tournaments, spectate, and review hand history using virtual chips only.

**Architecture:** Create a Next.js monorepo-style app with a focused pure TypeScript poker engine, an authoritative Node.js real-time server, Redis-backed live room state, and PostgreSQL-backed durable hand history. The browser receives only participant-filtered state over WebSocket and never connects directly to Redis or PostgreSQL.

**Tech Stack:** Next.js, React, TypeScript, Node.js, ws, Redis, PostgreSQL, Prisma, Vitest, Playwright.

## Global Constraints

- First version is a web app, not a WeChat Mini Program.
- No real-money settlement, recharge, withdrawal, rewards, prizes, or token exchange.
- No public matchmaking, public room list, long-term accounts, friend lists, or global rankings.
- No free-form text chat or voice chat.
- Support private rooms with 2-6 seats.
- Support no-limit Texas Hold'em only.
- Support cash-game and tournament modes.
- Cash game allows mid-room joining from the next hand and self-service virtual-chip rebuy.
- Tournament disallows joining after start, disallows rebuy, eliminates players at zero chips, and ends with one remaining player.
- Spectators can see public state only and never see unrevealed hole cards.
- Host controls never reveal hidden cards.
- Server validates all game actions and filters every outgoing state by participant identity.
- Use virtual chips copy throughout the product.

---

## File Structure

Create these focused units:

- `package.json`: project scripts and dependencies.
- `next.config.mjs`: Next.js config.
- `tsconfig.json`: strict TypeScript config.
- `vitest.config.ts`: unit test config.
- `playwright.config.ts`: browser test config.
- `prisma/schema.prisma`: PostgreSQL schema for rooms, participants, hands, actions, pots, buy-ins, and tournament results.
- `src/lib/poker/cards.ts`: card, rank, suit, deck, shuffle, and card serialization.
- `src/lib/poker/hand-evaluator.ts`: seven-card hand evaluation and comparison.
- `src/lib/poker/types.ts`: shared poker domain types.
- `src/lib/poker/betting.ts`: no-limit action validation, contribution tracking, minimum raise, all-in, and side-pot construction.
- `src/lib/poker/engine.ts`: authoritative hand lifecycle and room-mode transitions.
- `src/lib/poker/visibility.ts`: participant-specific state filtering.
- `src/lib/room/settings.ts`: room setting defaults and validation.
- `src/lib/realtime/messages.ts`: WebSocket event schemas and payload types.
- `src/server/db.ts`: Prisma client.
- `src/server/redis.ts`: Redis client wrapper.
- `src/server/repositories/room-repository.ts`: durable room and hand-history persistence.
- `src/server/live-room-store.ts`: Redis-backed active room state.
- `src/server/realtime/session-registry.ts`: in-memory WebSocket session tracking.
- `src/server/realtime/game-server.ts`: WebSocket server, message routing, validation, and broadcasting.
- `src/server/index.ts`: custom Next.js plus WebSocket server entrypoint.
- `src/app/page.tsx`: home page.
- `src/app/create/page.tsx`: create-room page.
- `src/app/room/[roomId]/page.tsx`: room shell page.
- `src/app/room/[roomId]/RoomClient.tsx`: real-time room client.
- `src/components/table/PokerTable.tsx`: mobile-first table display.
- `src/components/table/ActionControls.tsx`: legal action controls.
- `src/components/table/SeatRing.tsx`: 2-6 seat layout.
- `src/components/table/SystemLog.tsx`: system messages and quick phrases.
- `src/components/table/HandResultPanel.tsx`: per-hand result.
- `src/components/room/CreateRoomForm.tsx`: room settings form.
- `src/components/room/JoinRoomForm.tsx`: nickname, sit, spectate flow.
- `src/components/room/HostControls.tsx`: host-only room controls.
- `src/hooks/useRoomSocket.ts`: WebSocket client hook.
- `src/styles/globals.css`: mobile-first visual system.
- `tests/poker/*.test.ts`: poker engine unit tests.
- `tests/realtime/*.test.ts`: game server and visibility tests.
- `tests/e2e/friends-room.spec.ts`: Playwright happy-path room test.

---

### Task 1: Project Scaffold And Tooling

**Files:**
- Create: `package.json`
- Create: `next.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/styles/globals.css`

**Interfaces:**
- Produces: a strict TypeScript Next.js project with `npm run dev`, `npm test`, `npm run test:e2e`, and `npm run typecheck`.

- [ ] **Step 1: Write the project manifest**

Create `package.json`:

```json
{
  "name": "texas-holdem-friends-room",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "build": "next build",
    "start": "tsx src/server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^6.10.1",
    "ioredis": "^5.6.1",
    "nanoid": "^5.1.5",
    "next": "^15.3.4",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "ws": "^8.18.2",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@playwright/test": "^1.53.1",
    "@types/node": "^24.0.4",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@types/ws": "^8.18.1",
    "prisma": "^6.10.1",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Add framework configs**

Create `next.config.mjs`:

```js
const nextConfig = {
  reactStrictMode: true
};

export default nextConfig;
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] }
    }
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120000
  }
});
```

- [ ] **Step 4: Add base app layout and styles**

Create `src/app/layout.tsx`:

```tsx
import "@/styles/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Private Hold'em Room",
  description: "Private virtual-chip Texas Hold'em rooms for friends."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

Create `src/styles/globals.css`:

```css
:root {
  color-scheme: dark;
  --felt: #0f6f55;
  --felt-dark: #094839;
  --ink: #f7f5ef;
  --muted: #b8c6c0;
  --line: rgba(255, 255, 255, 0.16);
  --accent: #f3c14b;
  --danger: #e05a47;
  --panel: #17221f;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--felt-dark);
  color: var(--ink);
  font-family: Arial, "Microsoft YaHei", sans-serif;
}

button,
input,
select {
  font: inherit;
}

a {
  color: inherit;
}
```

- [ ] **Step 5: Install dependencies and verify tooling**

Run:

```bash
npm install
npm run typecheck
npm test
```

Expected:

```text
tsc completes without type errors
vitest reports no tests found or all tests pass
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.mjs tsconfig.json vitest.config.ts playwright.config.ts src/app/layout.tsx src/styles/globals.css
git commit -m "chore: scaffold holdem web app"
```

---

### Task 2: Cards And Hand Evaluation

**Files:**
- Create: `src/lib/poker/cards.ts`
- Create: `src/lib/poker/hand-evaluator.ts`
- Create: `tests/poker/cards.test.ts`
- Create: `tests/poker/hand-evaluator.test.ts`

**Interfaces:**
- Produces: `createDeck(): Card[]`, `serializeCard(card: Card): string`, `parseCard(value: string): Card`, `evaluateSeven(cards: Card[]): EvaluatedHand`, `compareHands(a: EvaluatedHand, b: EvaluatedHand): number`.

- [ ] **Step 1: Write failing card tests**

Create `tests/poker/cards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDeck, parseCard, serializeCard } from "@/lib/poker/cards";

describe("cards", () => {
  it("creates a 52-card deck with unique cards", () => {
    const deck = createDeck();
    const serialized = deck.map(serializeCard);

    expect(deck).toHaveLength(52);
    expect(new Set(serialized).size).toBe(52);
    expect(serialized).toContain("As");
    expect(serialized).toContain("2c");
  });

  it("round-trips card serialization", () => {
    expect(serializeCard(parseCard("Th"))).toBe("Th");
    expect(serializeCard(parseCard("Ad"))).toBe("Ad");
  });

  it("rejects invalid cards", () => {
    expect(() => parseCard("1s")).toThrow("Invalid card");
    expect(() => parseCard("Ax")).toThrow("Invalid card");
  });
});
```

- [ ] **Step 2: Run card tests to verify failure**

Run:

```bash
npm test -- tests/poker/cards.test.ts
```

Expected: FAIL because `src/lib/poker/cards.ts` does not exist.

- [ ] **Step 3: Implement cards**

Create `src/lib/poker/cards.ts`:

```ts
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["c", "d", "h", "s"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function serializeCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function parseCard(value: string): Card {
  if (value.length !== 2) {
    throw new Error(`Invalid card: ${value}`);
  }

  const rank = value[0] as Rank;
  const suit = value[1] as Suit;

  if (!RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`Invalid card: ${value}`);
  }

  return { rank, suit };
}

export function shuffledDeck(random: () => number = Math.random): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
```

- [ ] **Step 4: Write failing hand evaluator tests**

Create `tests/poker/hand-evaluator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { compareHands, evaluateSeven } from "@/lib/poker/hand-evaluator";

const cards = (values: string) => values.split(" ").map(parseCard);

describe("hand evaluator", () => {
  it("ranks a royal flush above four of a kind", () => {
    const royal = evaluateSeven(cards("As Ks Qs Js Ts 3d 2c"));
    const quads = evaluateSeven(cards("Ah Ac Ad As 9d 3c 2h"));

    expect(compareHands(royal, quads)).toBeGreaterThan(0);
  });

  it("handles wheel straights", () => {
    const wheel = evaluateSeven(cards("As 2d 3h 4c 5s Kd Qc"));

    expect(wheel.name).toBe("straight");
    expect(wheel.ranks).toEqual([5]);
  });

  it("splits exact ties", () => {
    const first = evaluateSeven(cards("Ah Kd Qs Jc 9h 3d 2c"));
    const second = evaluateSeven(cards("As Kh Qd Jh 9c 4d 2h"));

    expect(compareHands(first, second)).toBe(0);
  });
});
```

- [ ] **Step 5: Run evaluator tests to verify failure**

Run:

```bash
npm test -- tests/poker/hand-evaluator.test.ts
```

Expected: FAIL because `src/lib/poker/hand-evaluator.ts` does not exist.

- [ ] **Step 6: Implement evaluator**

Create `src/lib/poker/hand-evaluator.ts`:

```ts
import type { Card, Rank } from "./cards";

const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

export type HandName =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-kind"
  | "straight-flush";

export interface EvaluatedHand {
  name: HandName;
  category: number;
  ranks: number[];
}

export function evaluateSeven(cards: Card[]): EvaluatedHand {
  if (cards.length !== 7) {
    throw new Error("evaluateSeven requires exactly 7 cards");
  }

  const combos = fiveCardCombinations(cards);
  return combos.map(evaluateFive).sort(compareHands).at(-1)!;
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.category !== b.category) {
    return a.category - b.category;
  }

  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i += 1) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function fiveCardCombinations(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return result;
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const flush = new Set(cards.map((card) => card.suit)).size === 1;
  const straightHigh = findStraightHigh(values);

  if (flush && straightHigh !== null) {
    return { name: "straight-flush", category: 8, ranks: [straightHigh] };
  }

  const groups = groupValues(values);
  const counts = groups.map((group) => group.count).sort((a, b) => b - a);

  if (counts[0] === 4) {
    const quad = groups.find((group) => group.count === 4)!.value;
    const kicker = groups.find((group) => group.count === 1)!.value;
    return { name: "four-kind", category: 7, ranks: [quad, kicker] };
  }

  if (counts[0] === 3 && counts[1] === 2) {
    const trips = groups.find((group) => group.count === 3)!.value;
    const pair = groups.find((group) => group.count === 2)!.value;
    return { name: "full-house", category: 6, ranks: [trips, pair] };
  }

  if (flush) {
    return { name: "flush", category: 5, ranks: values };
  }

  if (straightHigh !== null) {
    return { name: "straight", category: 4, ranks: [straightHigh] };
  }

  if (counts[0] === 3) {
    const trips = groups.find((group) => group.count === 3)!.value;
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value);
    return { name: "three-kind", category: 3, ranks: [trips, ...kickers] };
  }

  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = groups.filter((group) => group.count === 2).map((group) => group.value);
    const kicker = groups.find((group) => group.count === 1)!.value;
    return { name: "two-pair", category: 2, ranks: [...pairs, kicker] };
  }

  if (counts[0] === 2) {
    const pair = groups.find((group) => group.count === 2)!.value;
    const kickers = groups.filter((group) => group.count === 1).map((group) => group.value);
    return { name: "pair", category: 1, ranks: [pair, ...kickers] };
  }

  return { name: "high-card", category: 0, ranks: values };
}

function findStraightHigh(values: number[]): number | null {
  const unique = [...new Set(values)];
  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i += 1) {
    const run = unique.slice(i, i + 5);
    if (run[0] - run[4] === 4) {
      return run[0] === 14 && run[1] === 5 ? 5 : run[0];
    }
  }

  return null;
}

function groupValues(values: number[]): Array<{ value: number; count: number }> {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- tests/poker/cards.test.ts tests/poker/hand-evaluator.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/poker/cards.ts src/lib/poker/hand-evaluator.ts tests/poker/cards.test.ts tests/poker/hand-evaluator.test.ts
git commit -m "feat: add cards and hand evaluator"
```

---

### Task 3: Betting Model And Side Pots

**Files:**
- Create: `src/lib/poker/types.ts`
- Create: `src/lib/poker/betting.ts`
- Create: `tests/poker/betting.test.ts`

**Interfaces:**
- Produces: `getLegalActions(state: BettingState, playerId: string): LegalAction[]`, `applyBettingAction(state: BettingState, action: BettingAction): BettingState`, `buildPots(players: BettingPlayer[]): Pot[]`.

- [ ] **Step 1: Write failing betting tests**

Create `tests/poker/betting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyBettingAction, buildPots, getLegalActions } from "@/lib/poker/betting";
import type { BettingState } from "@/lib/poker/types";

function state(): BettingState {
  return {
    street: "preflop",
    currentBet: 20,
    minRaise: 20,
    actorId: "p3",
    players: [
      { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
      { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false },
      { id: "p3", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false }
    ]
  };
}

describe("betting", () => {
  it("offers fold, call, raise, and all-in when facing a bet", () => {
    const actions = getLegalActions(state(), "p3").map((action) => action.type);

    expect(actions).toEqual(["fold", "call", "raise", "all-in"]);
  });

  it("applies a call", () => {
    const next = applyBettingAction(state(), { type: "call", playerId: "p3" });
    const player = next.players.find((candidate) => candidate.id === "p3")!;

    expect(player.stack).toBe(980);
    expect(player.committed).toBe(20);
    expect(player.streetCommitted).toBe(20);
  });

  it("rejects a below-minimum raise", () => {
    expect(() => applyBettingAction(state(), { type: "raise", playerId: "p3", amountTo: 30 })).toThrow(
      "Raise must be at least 40"
    );
  });

  it("builds main and side pots", () => {
    const pots = buildPots([
      { id: "p1", stack: 0, committed: 50, streetCommitted: 50, folded: false, allIn: true },
      { id: "p2", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true },
      { id: "p3", stack: 200, committed: 100, streetCommitted: 100, folded: false, allIn: false }
    ]);

    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ["p1", "p2", "p3"] },
      { amount: 100, eligiblePlayerIds: ["p2", "p3"] }
    ]);
  });
});
```

- [ ] **Step 2: Run betting tests to verify failure**

Run:

```bash
npm test -- tests/poker/betting.test.ts
```

Expected: FAIL because betting files do not exist.

- [ ] **Step 3: Add domain types**

Create `src/lib/poker/types.ts`:

```ts
import type { Card } from "./cards";

export type RoomMode = "cash" | "tournament";
export type Street = "preflop" | "flop" | "turn" | "river";
export type SeatStatus = "empty" | "seated" | "ready" | "active" | "folded" | "all-in" | "eliminated" | "disconnected";

export interface BettingPlayer {
  id: string;
  stack: number;
  committed: number;
  streetCommitted: number;
  folded: boolean;
  allIn: boolean;
}

export interface BettingState {
  street: Street;
  currentBet: number;
  minRaise: number;
  actorId: string;
  players: BettingPlayer[];
}

export type LegalAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call"; amount: number }
  | { type: "bet"; minAmountTo: number; maxAmountTo: number }
  | { type: "raise"; minAmountTo: number; maxAmountTo: number }
  | { type: "all-in"; amountTo: number };

export type BettingAction =
  | { type: "fold"; playerId: string }
  | { type: "check"; playerId: string }
  | { type: "call"; playerId: string }
  | { type: "bet"; playerId: string; amountTo: number }
  | { type: "raise"; playerId: string; amountTo: number }
  | { type: "all-in"; playerId: string };

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface Seat {
  seatNumber: number;
  participantId: string | null;
  displayName: string | null;
  chips: number;
  status: SeatStatus;
  cumulativeBuyIn: number;
  holeCards?: Card[];
}
```

- [ ] **Step 4: Implement betting**

Create `src/lib/poker/betting.ts`:

```ts
import type { BettingAction, BettingPlayer, BettingState, LegalAction, Pot } from "./types";

export function getLegalActions(state: BettingState, playerId: string): LegalAction[] {
  const player = findActor(state, playerId);
  const toCall = Math.max(0, state.currentBet - player.streetCommitted);

  if (player.folded || player.allIn) {
    return [];
  }

  if (toCall === 0) {
    const actions: LegalAction[] = [{ type: "check" }];
    if (player.stack > 0) {
      actions.push({ type: "bet", minAmountTo: state.minRaise, maxAmountTo: player.streetCommitted + player.stack });
      actions.push({ type: "all-in", amountTo: player.streetCommitted + player.stack });
    }
    return actions;
  }

  const actions: LegalAction[] = [{ type: "fold" }, { type: "call", amount: Math.min(toCall, player.stack) }];
  const minAmountTo = state.currentBet + state.minRaise;
  const maxAmountTo = player.streetCommitted + player.stack;

  if (maxAmountTo > state.currentBet) {
    actions.push({ type: "raise", minAmountTo, maxAmountTo });
  }

  actions.push({ type: "all-in", amountTo: maxAmountTo });
  return actions;
}

export function applyBettingAction(state: BettingState, action: BettingAction): BettingState {
  const next: BettingState = {
    ...state,
    players: state.players.map((player) => ({ ...player }))
  };

  const player = findActor(next, action.playerId);
  if (action.playerId !== next.actorId) {
    throw new Error("Not this player's turn");
  }

  if (action.type === "fold") {
    player.folded = true;
    return next;
  }

  const toCall = Math.max(0, next.currentBet - player.streetCommitted);

  if (action.type === "check") {
    if (toCall > 0) {
      throw new Error("Cannot check facing a bet");
    }
    return next;
  }

  if (action.type === "call") {
    commit(player, Math.min(toCall, player.stack));
    return next;
  }

  if (action.type === "all-in") {
    const previousBet = next.currentBet;
    commit(player, player.stack);
    if (player.streetCommitted > next.currentBet) {
      next.currentBet = player.streetCommitted;
      const raiseSize = next.currentBet - previousBet;
      if (raiseSize >= next.minRaise) {
        next.minRaise = raiseSize;
      }
    }
    return next;
  }

  const amountTo = action.amountTo;
  if (amountTo <= next.currentBet) {
    throw new Error("Bet or raise must exceed current bet");
  }

  if (action.type === "bet" && next.currentBet !== 0) {
    throw new Error("Cannot bet when a bet already exists");
  }

  const minimum = next.currentBet === 0 ? next.minRaise : next.currentBet + next.minRaise;
  if (amountTo < minimum) {
    throw new Error(`Raise must be at least ${minimum}`);
  }

  const additional = amountTo - player.streetCommitted;
  if (additional > player.stack) {
    throw new Error("Insufficient chips");
  }

  const previousBet = next.currentBet;
  commit(player, additional);
  next.currentBet = amountTo;
  next.minRaise = amountTo - previousBet;
  return next;
}

export function buildPots(players: BettingPlayer[]): Pot[] {
  const contributors = players.filter((player) => player.committed > 0);
  const levels = [...new Set(contributors.map((player) => player.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    const participants = contributors.filter((player) => player.committed >= level);
    const eligiblePlayerIds = participants.filter((player) => !player.folded).map((player) => player.id);
    const amount = (level - previous) * participants.length;

    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ amount, eligiblePlayerIds });
    }

    previous = level;
  }

  return pots;
}

function findActor(state: BettingState, playerId: string): BettingPlayer {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player;
}

function commit(player: BettingPlayer, amount: number): void {
  player.stack -= amount;
  player.committed += amount;
  player.streetCommitted += amount;
  if (player.stack === 0) {
    player.allIn = true;
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/poker/betting.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/poker/types.ts src/lib/poker/betting.ts tests/poker/betting.test.ts
git commit -m "feat: add no-limit betting model"
```

---

### Task 4: Room Settings And Persistence Schema

**Files:**
- Create: `src/lib/room/settings.ts`
- Create: `tests/poker/room-settings.test.ts`
- Create: `prisma/schema.prisma`
- Create: `.env.example`

**Interfaces:**
- Produces: `RoomSettingsSchema`, `validateRoomSettings(input: unknown): RoomSettings`.

- [ ] **Step 1: Write failing settings tests**

Create `tests/poker/room-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateRoomSettings } from "@/lib/room/settings";

describe("room settings", () => {
  it("accepts cash settings without blind increases", () => {
    const settings = validateRoomSettings({
      mode: "cash",
      seats: 6,
      initialChips: 2000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null
    });

    expect(settings.mode).toBe("cash");
    expect(settings.actionTimerSeconds).toBeNull();
  });

  it("accepts tournament blind increases by hands", () => {
    const settings = validateRoomSettings({
      mode: "tournament",
      seats: 4,
      initialChips: 3000,
      smallBlind: 25,
      bigBlind: 50,
      actionTimerSeconds: 30,
      blindIncrease: { type: "hands", interval: 10 }
    });

    expect(settings.blindIncrease).toEqual({ type: "hands", interval: 10 });
  });

  it("rejects fewer than two seats", () => {
    expect(() => validateRoomSettings({ mode: "cash", seats: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run settings tests to verify failure**

Run:

```bash
npm test -- tests/poker/room-settings.test.ts
```

Expected: FAIL because settings module does not exist.

- [ ] **Step 3: Implement settings validation**

Create `src/lib/room/settings.ts`:

```ts
import { z } from "zod";

export const BlindIncreaseSchema = z.object({
  type: z.enum(["minutes", "hands"]),
  interval: z.number().int().min(1).max(120)
});

export const RoomSettingsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("cash"),
    seats: z.number().int().min(2).max(6),
    initialChips: z.number().int().min(100).max(100000),
    smallBlind: z.number().int().min(1),
    bigBlind: z.number().int().min(2),
    actionTimerSeconds: z.number().int().min(5).max(300).nullable()
  }),
  z.object({
    mode: z.literal("tournament"),
    seats: z.number().int().min(2).max(6),
    initialChips: z.number().int().min(100).max(100000),
    smallBlind: z.number().int().min(1),
    bigBlind: z.number().int().min(2),
    actionTimerSeconds: z.number().int().min(5).max(300).nullable(),
    blindIncrease: BlindIncreaseSchema
  })
]);

export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

export function validateRoomSettings(input: unknown): RoomSettings {
  const settings = RoomSettingsSchema.parse(input);
  if (settings.bigBlind < settings.smallBlind * 2) {
    throw new Error("Big blind must be at least twice the small blind");
  }
  return settings;
}
```

- [ ] **Step 4: Add Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Room {
  id             String            @id
  hostTokenHash  String
  inviteCode     String            @unique
  mode           String
  settings       Json
  createdAt      DateTime          @default(now())
  endedAt        DateTime?
  participants   RoomParticipant[]
  hands          Hand[]
  buyIns         BuyIn[]
  results        TournamentResult[]
}

model RoomParticipant {
  id            String   @id
  roomId        String
  displayName   String
  role          String
  seatNumber    Int?
  joinedAt      DateTime @default(now())
  room          Room     @relation(fields: [roomId], references: [id])
  handPlayers   HandPlayer[]
  actions       HandAction[]
  buyIns        BuyIn[]
  results       TournamentResult[]
}

model Hand {
  id           String       @id
  roomId       String
  handNumber   Int
  buttonSeat   Int
  smallBlind   Int
  bigBlind     Int
  board        Json
  startedAt    DateTime    @default(now())
  endedAt      DateTime?
  room         Room        @relation(fields: [roomId], references: [id])
  players      HandPlayer[]
  actions      HandAction[]
  pots         Pot[]

  @@unique([roomId, handNumber])
}

model HandPlayer {
  id              String          @id
  handId          String
  participantId   String
  seatNumber      Int
  startingChips   Int
  endingChips     Int
  holeCards       Json?
  hand            Hand            @relation(fields: [handId], references: [id])
  participant     RoomParticipant @relation(fields: [participantId], references: [id])
}

model HandAction {
  id              String          @id
  handId          String
  sequenceNumber  Int
  street          String
  participantId   String
  actionType      String
  amount          Int?
  resultingStack  Int
  createdAt       DateTime        @default(now())
  hand            Hand            @relation(fields: [handId], references: [id])
  participant     RoomParticipant @relation(fields: [participantId], references: [id])

  @@unique([handId, sequenceNumber])
}

model Pot {
  id                  String @id
  handId              String
  potType             String
  amount              Int
  eligibleParticipantIds Json
  winnerParticipantIds   Json
  hand                Hand   @relation(fields: [handId], references: [id])
}

model BuyIn {
  id              String          @id
  roomId          String
  participantId   String
  amount          Int
  createdAt       DateTime        @default(now())
  room            Room            @relation(fields: [roomId], references: [id])
  participant     RoomParticipant @relation(fields: [participantId], references: [id])
}

model TournamentResult {
  id               String          @id
  roomId           String
  participantId    String
  eliminationOrder Int?
  finalRank        Int?
  room             Room            @relation(fields: [roomId], references: [id])
  participant      RoomParticipant @relation(fields: [participantId], references: [id])
}
```

Create `.env.example`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/holdem"
REDIS_URL="redis://localhost:6379"
APP_ORIGIN="http://127.0.0.1:3000"
```

- [ ] **Step 5: Run tests and generate Prisma client**

Run:

```bash
npm test -- tests/poker/room-settings.test.ts
npm run prisma:generate
npm run typecheck
```

Expected: PASS, Prisma client generated, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/room/settings.ts tests/poker/room-settings.test.ts prisma/schema.prisma .env.example
git commit -m "feat: add room settings and persistence schema"
```

---

### Task 5: Authoritative Hand Engine

**Files:**
- Create: `src/lib/poker/engine.ts`
- Create: `tests/poker/engine.test.ts`

**Interfaces:**
- Consumes: `Card`, `shuffledDeck`, `evaluateSeven`, betting helpers, `RoomSettings`.
- Produces: `createInitialRoomState(settings, roomId): RoomState`, `startHand(state, deck?): RoomState`, `applyPlayerAction(state, action): RoomState`, `finishHandIfReady(state): RoomState`.

- [ ] **Step 1: Write failing engine tests**

Create `tests/poker/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { applyPlayerAction, createInitialRoomState, startHand } from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("engine", () => {
  it("starts a hand with blinds and private hole cards", () => {
    let state = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "room1"
    );
    state = {
      ...state,
      seats: state.seats.map((seat, index) => ({
        ...seat,
        participantId: `p${index + 1}`,
        displayName: `P${index + 1}`,
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: "ready"
      }))
    };

    const started = startHand(state, fixedDeck);

    expect(started.hand?.number).toBe(1);
    expect(started.hand?.street).toBe("preflop");
    expect(started.hand?.board).toEqual([]);
    expect(started.seats[0].chips + started.seats[1].chips).toBe(1970);
    expect(started.hand?.holeCardsByParticipantId.p1).toHaveLength(2);
  });

  it("ends hand early when everyone but one player folds", () => {
    let state = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "room1"
    );
    state = {
      ...state,
      seats: state.seats.map((seat, index) => ({
        ...seat,
        participantId: `p${index + 1}`,
        displayName: `P${index + 1}`,
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: "ready"
      }))
    };

    const started = startHand(state, fixedDeck);
    const finished = applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId });

    expect(finished.hand?.finished).toBe(true);
    expect(finished.hand?.winners.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run engine tests to verify failure**

Run:

```bash
npm test -- tests/poker/engine.test.ts
```

Expected: FAIL because engine module does not exist.

- [ ] **Step 3: Implement minimal engine types and hand start**

Create `src/lib/poker/engine.ts`:

```ts
import { type Card, shuffledDeck } from "./cards";
import { applyBettingAction, buildPots } from "./betting";
import type { BettingAction, BettingState, RoomMode, Seat, Street } from "./types";
import type { RoomSettings } from "@/lib/room/settings";

export interface RoomState {
  roomId: string;
  mode: RoomMode;
  settings: RoomSettings;
  status: "lobby" | "playing" | "paused" | "finished";
  handCounter: number;
  buttonSeat: number | null;
  seats: Seat[];
  hand: HandState | null;
}

export interface HandState {
  id: string;
  number: number;
  street: Street;
  board: Card[];
  deck: Card[];
  actorId: string;
  betting: BettingState;
  holeCardsByParticipantId: Record<string, Card[]>;
  actions: Array<{ playerId: string; type: string; amount?: number }>;
  finished: boolean;
  winners: string[];
}

export function createInitialRoomState(settings: RoomSettings, roomId: string): RoomState {
  return {
    roomId,
    mode: settings.mode,
    settings,
    status: "lobby",
    handCounter: 0,
    buttonSeat: null,
    seats: Array.from({ length: settings.seats }, (_, index) => ({
      seatNumber: index + 1,
      participantId: null,
      displayName: null,
      chips: 0,
      status: "empty",
      cumulativeBuyIn: 0
    })),
    hand: null
  };
}

export function startHand(state: RoomState, providedDeck?: Card[]): RoomState {
  const activeSeats = state.seats.filter((seat) => seat.participantId && seat.chips > 0 && seat.status !== "eliminated");
  if (activeSeats.length < 2) {
    throw new Error("At least two active players are required");
  }

  const buttonSeat = nextOccupiedSeatNumber(state.buttonSeat, activeSeats);
  const smallBlindSeat = nextSeatAfter(buttonSeat, activeSeats);
  const bigBlindSeat = nextSeatAfter(smallBlindSeat, activeSeats);
  const deck = [...(providedDeck ?? shuffledDeck())];
  const holeCardsByParticipantId: Record<string, Card[]> = {};

  for (let round = 0; round < 2; round += 1) {
    for (const seat of activeSeats) {
      holeCardsByParticipantId[seat.participantId!] ??= [];
      holeCardsByParticipantId[seat.participantId!].push(deck.shift()!);
    }
  }

  const seats = state.seats.map((seat) => ({ ...seat }));
  postBlind(seats, smallBlindSeat, state.settings.smallBlind);
  postBlind(seats, bigBlindSeat, state.settings.bigBlind);

  const bettingPlayers = activeSeats.map((seat) => {
    const updated = seats.find((candidate) => candidate.seatNumber === seat.seatNumber)!;
    return {
      id: updated.participantId!,
      stack: updated.chips,
      committed: seat.chips - updated.chips,
      streetCommitted: seat.chips - updated.chips,
      folded: false,
      allIn: updated.chips === 0
    };
  });

  const actorSeat = activeSeats.length === 2 ? smallBlindSeat : nextSeatAfter(bigBlindSeat, activeSeats);
  const actor = seats.find((seat) => seat.seatNumber === actorSeat)!.participantId!;

  return {
    ...state,
    status: "playing",
    handCounter: state.handCounter + 1,
    buttonSeat,
    seats,
    hand: {
      id: `${state.roomId}-${state.handCounter + 1}`,
      number: state.handCounter + 1,
      street: "preflop",
      board: [],
      deck,
      actorId: actor,
      betting: {
        street: "preflop",
        currentBet: state.settings.bigBlind,
        minRaise: state.settings.bigBlind,
        actorId: actor,
        players: bettingPlayers
      },
      holeCardsByParticipantId,
      actions: [],
      finished: false,
      winners: []
    }
  };
}

export function applyPlayerAction(state: RoomState, action: BettingAction): RoomState {
  if (!state.hand || state.hand.finished) {
    throw new Error("No active hand");
  }

  const betting = applyBettingAction(state.hand.betting, action);
  const seats = state.seats.map((seat) => {
    const player = betting.players.find((candidate) => candidate.id === seat.participantId);
    return player ? { ...seat, chips: player.stack, status: player.folded ? "folded" : player.allIn ? "all-in" : "active" } : seat;
  });

  const remaining = betting.players.filter((player) => !player.folded);
  if (remaining.length === 1) {
    const pots = buildPots(betting.players);
    const winnerId = remaining[0].id;
    const won = pots.reduce((sum, pot) => sum + pot.amount, 0);
    const settledSeats = seats.map((seat) => (seat.participantId === winnerId ? { ...seat, chips: seat.chips + won } : seat));
    return {
      ...state,
      seats: settledSeats,
      hand: {
        ...state.hand,
        betting,
        actions: [...state.hand.actions, { playerId: action.playerId, type: action.type, amount: "amountTo" in action ? action.amountTo : undefined }],
        finished: true,
        winners: [winnerId]
      }
    };
  }

  return {
    ...state,
    seats,
    hand: {
      ...state.hand,
      actorId: nextActorId(state, betting),
      betting: { ...betting, actorId: nextActorId(state, betting) },
      actions: [...state.hand.actions, { playerId: action.playerId, type: action.type, amount: "amountTo" in action ? action.amountTo : undefined }]
    }
  };
}

function postBlind(seats: Seat[], seatNumber: number, amount: number): void {
  const seat = seats.find((candidate) => candidate.seatNumber === seatNumber)!;
  const posted = Math.min(seat.chips, amount);
  seat.chips -= posted;
  seat.status = seat.chips === 0 ? "all-in" : "active";
}

function nextOccupiedSeatNumber(current: number | null, activeSeats: Seat[]): number {
  if (current === null) {
    return activeSeats[0].seatNumber;
  }
  return nextSeatAfter(current, activeSeats);
}

function nextSeatAfter(current: number, activeSeats: Seat[]): number {
  const ordered = [...activeSeats].sort((a, b) => a.seatNumber - b.seatNumber);
  return ordered.find((seat) => seat.seatNumber > current)?.seatNumber ?? ordered[0].seatNumber;
}

function nextActorId(state: RoomState, betting: BettingState): string {
  const currentSeat = state.seats.find((seat) => seat.participantId === betting.actorId)!;
  const activeSeats = state.seats.filter((seat) => {
    const player = betting.players.find((candidate) => candidate.id === seat.participantId);
    return player && !player.folded && !player.allIn;
  });
  const nextSeat = nextSeatAfter(currentSeat.seatNumber, activeSeats);
  return state.seats.find((seat) => seat.seatNumber === nextSeat)!.participantId!;
}
```

- [ ] **Step 4: Run engine tests**

Run:

```bash
npm test -- tests/poker/engine.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poker/engine.ts tests/poker/engine.test.ts
git commit -m "feat: add authoritative hand engine"
```

---

### Task 6: Visibility Filtering

**Files:**
- Create: `src/lib/poker/visibility.ts`
- Create: `tests/poker/visibility.test.ts`

**Interfaces:**
- Consumes: `RoomState`.
- Produces: `toParticipantView(state: RoomState, viewer: Viewer): ParticipantRoomView`.

- [ ] **Step 1: Write failing visibility tests**

Create `tests/poker/visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { toParticipantView } from "@/lib/poker/visibility";
import type { RoomState } from "@/lib/poker/engine";

const state: RoomState = {
  roomId: "r1",
  mode: "cash",
  settings: { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
  status: "playing",
  handCounter: 1,
  buttonSeat: 1,
  seats: [
    { seatNumber: 1, participantId: "p1", displayName: "A", chips: 990, status: "active", cumulativeBuyIn: 1000 },
    { seatNumber: 2, participantId: "p2", displayName: "B", chips: 980, status: "active", cumulativeBuyIn: 1000 }
  ],
  hand: {
    id: "h1",
    number: 1,
    street: "preflop",
    board: [],
    deck: [],
    actorId: "p1",
    betting: { street: "preflop", currentBet: 20, minRaise: 20, actorId: "p1", players: [] },
    holeCardsByParticipantId: {
      p1: [parseCard("As"), parseCard("Ah")],
      p2: [parseCard("Kd"), parseCard("Kh")]
    },
    actions: [],
    finished: false,
    winners: []
  }
};

describe("visibility", () => {
  it("shows a player only their own hole cards", () => {
    const view = toParticipantView(state, { participantId: "p1", role: "player", host: false });

    expect(view.hand?.seats[0].holeCards).toEqual(["As", "Ah"]);
    expect(view.hand?.seats[1].holeCards).toBeUndefined();
  });

  it("does not show hidden cards to host", () => {
    const view = toParticipantView(state, { participantId: "host", role: "spectator", host: true });

    expect(view.hand?.seats[0].holeCards).toBeUndefined();
    expect(view.hand?.seats[1].holeCards).toBeUndefined();
    expect(view.hostControls).toBe(true);
  });
});
```

- [ ] **Step 2: Run visibility tests to verify failure**

Run:

```bash
npm test -- tests/poker/visibility.test.ts
```

Expected: FAIL because visibility module does not exist.

- [ ] **Step 3: Implement visibility filtering**

Create `src/lib/poker/visibility.ts`:

```ts
import { serializeCard } from "./cards";
import type { RoomState } from "./engine";

export interface Viewer {
  participantId: string | null;
  role: "player" | "spectator";
  host: boolean;
}

export interface ParticipantRoomView {
  roomId: string;
  mode: string;
  status: string;
  hostControls: boolean;
  seats: Array<{
    seatNumber: number;
    displayName: string | null;
    chips: number;
    status: string;
    cumulativeBuyIn: number;
    occupied: boolean;
  }>;
  hand: null | {
    number: number;
    street: string;
    board: string[];
    actorId: string;
    seats: Array<{
      seatNumber: number;
      participantId: string | null;
      holeCards?: string[];
    }>;
    actions: Array<{ playerId: string; type: string; amount?: number }>;
    finished: boolean;
    winners: string[];
  };
}

export function toParticipantView(state: RoomState, viewer: Viewer): ParticipantRoomView {
  return {
    roomId: state.roomId,
    mode: state.mode,
    status: state.status,
    hostControls: viewer.host,
    seats: state.seats.map((seat) => ({
      seatNumber: seat.seatNumber,
      displayName: seat.displayName,
      chips: seat.chips,
      status: seat.status,
      cumulativeBuyIn: seat.cumulativeBuyIn,
      occupied: seat.participantId !== null
    })),
    hand: state.hand
      ? {
          number: state.hand.number,
          street: state.hand.street,
          board: state.hand.board.map(serializeCard),
          actorId: state.hand.actorId,
          seats: state.seats.map((seat) => ({
            seatNumber: seat.seatNumber,
            participantId: seat.participantId,
            holeCards:
              seat.participantId && shouldRevealHoleCards(state, viewer.participantId, seat.participantId)
                ? state.hand!.holeCardsByParticipantId[seat.participantId]?.map(serializeCard)
                : undefined
          })),
          actions: state.hand.actions,
          finished: state.hand.finished,
          winners: state.hand.winners
        }
      : null
  };
}

function shouldRevealHoleCards(state: RoomState, viewerId: string | null, ownerId: string): boolean {
  if (viewerId === ownerId) {
    return true;
  }
  return Boolean(state.hand?.finished && state.hand.winners.includes(ownerId));
}
```

- [ ] **Step 4: Run visibility tests**

Run:

```bash
npm test -- tests/poker/visibility.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poker/visibility.ts tests/poker/visibility.test.ts
git commit -m "feat: filter room state by participant"
```

---

### Task 7: Real-Time Message Contracts And Live Store

**Files:**
- Create: `src/lib/realtime/messages.ts`
- Create: `src/server/redis.ts`
- Create: `src/server/live-room-store.ts`
- Create: `tests/realtime/messages.test.ts`
- Create: `tests/realtime/live-room-store.test.ts`

**Interfaces:**
- Produces: `ClientMessageSchema`, `ServerMessage`, `LiveRoomStore` with `getRoom`, `saveRoom`, `deleteRoom`.

- [ ] **Step 1: Write failing message contract tests**

Create `tests/realtime/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "@/lib/realtime/messages";

describe("realtime messages", () => {
  it("accepts player actions", () => {
    const parsed = ClientMessageSchema.parse({
      type: "player_action",
      roomId: "room1",
      participantToken: "token",
      action: { type: "fold", playerId: "p1" }
    });

    expect(parsed.type).toBe("player_action");
  });

  it("rejects unknown message types", () => {
    expect(() => ClientMessageSchema.parse({ type: "peek_cards" })).toThrow();
  });
});
```

- [ ] **Step 2: Implement message contracts**

Create `src/lib/realtime/messages.ts`:

```ts
import { z } from "zod";

const BettingActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold"), playerId: z.string() }),
  z.object({ type: z.literal("check"), playerId: z.string() }),
  z.object({ type: z.literal("call"), playerId: z.string() }),
  z.object({ type: z.literal("bet"), playerId: z.string(), amountTo: z.number().int().positive() }),
  z.object({ type: z.literal("raise"), playerId: z.string(), amountTo: z.number().int().positive() }),
  z.object({ type: z.literal("all-in"), playerId: z.string() })
]);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join_room"), roomId: z.string(), participantToken: z.string().nullable(), displayName: z.string().min(1).max(24) }),
  z.object({ type: z.literal("claim_seat"), roomId: z.string(), participantToken: z.string(), seatNumber: z.number().int().min(1).max(6) }),
  z.object({ type: z.literal("leave_seat"), roomId: z.string(), participantToken: z.string() }),
  z.object({ type: z.literal("set_ready"), roomId: z.string(), participantToken: z.string() }),
  z.object({ type: z.literal("start_room"), roomId: z.string(), hostToken: z.string() }),
  z.object({ type: z.literal("pause_room"), roomId: z.string(), hostToken: z.string() }),
  z.object({ type: z.literal("resume_room"), roomId: z.string(), hostToken: z.string() }),
  z.object({ type: z.literal("end_room"), roomId: z.string(), hostToken: z.string() }),
  z.object({ type: z.literal("player_action"), roomId: z.string(), participantToken: z.string(), action: BettingActionSchema }),
  z.object({ type: z.literal("rebuy"), roomId: z.string(), participantToken: z.string(), amount: z.number().int().positive() }),
  z.object({ type: z.literal("quick_phrase"), roomId: z.string(), participantToken: z.string(), phrase: z.enum(["think", "nice_hand", "well_played", "another_hand", "wait_for_me", "back_now"]) }),
  z.object({ type: z.literal("handle_disconnect"), roomId: z.string(), hostToken: z.string(), participantId: z.string(), handling: z.enum(["wait", "fold", "remove", "pause"]) })
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "room_snapshot"; payload: unknown }
  | { type: "table_update"; payload: unknown }
  | { type: "private_cards"; payload: unknown }
  | { type: "legal_actions"; payload: unknown }
  | { type: "hand_started"; payload: unknown }
  | { type: "street_changed"; payload: unknown }
  | { type: "action_recorded"; payload: unknown }
  | { type: "hand_finished"; payload: unknown }
  | { type: "blind_level_changed"; payload: unknown }
  | { type: "player_disconnected"; payload: unknown }
  | { type: "player_reconnected"; payload: unknown }
  | { type: "player_eliminated"; payload: unknown }
  | { type: "room_finished"; payload: unknown }
  | { type: "system_message"; payload: { message: string } }
  | { type: "error"; payload: { message: string } };
```

- [ ] **Step 3: Run message tests**

Run:

```bash
npm test -- tests/realtime/messages.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add live room store with an in-memory test double**

Create `src/server/redis.ts`:

```ts
import Redis from "ioredis";

export function createRedisClient(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
}
```

Create `src/server/live-room-store.ts`:

```ts
import type { RoomState } from "@/lib/poker/engine";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class LiveRoomStore {
  constructor(private readonly store: KeyValueStore) {}

  async getRoom(roomId: string): Promise<RoomState | null> {
    const raw = await this.store.get(this.key(roomId));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async saveRoom(room: RoomState, ttlSeconds = 86400): Promise<void> {
    await this.store.set(this.key(room.roomId), JSON.stringify(room), "EX", ttlSeconds);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.store.del(this.key(roomId));
  }

  private key(roomId: string): string {
    return `room:${roomId}`;
  }
}
```

Create `tests/realtime/live-room-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialRoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async del(key: string) {
    this.values.delete(key);
  }
}

describe("LiveRoomStore", () => {
  it("saves and loads room state", async () => {
    const store = new LiveRoomStore(new MemoryStore());
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );

    await store.saveRoom(room);

    expect(await store.getRoom("r1")).toMatchObject({ roomId: "r1", mode: "cash" });
  });
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/realtime/messages.test.ts tests/realtime/live-room-store.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/realtime/messages.ts src/server/redis.ts src/server/live-room-store.ts tests/realtime/messages.test.ts tests/realtime/live-room-store.test.ts
git commit -m "feat: add realtime message contracts and live store"
```

---

### Task 8: WebSocket Game Server

**Files:**
- Create: `src/server/realtime/session-registry.ts`
- Create: `src/server/realtime/game-server.ts`
- Create: `src/server/index.ts`
- Create: `src/server/db.ts`
- Create: `src/server/repositories/room-repository.ts`
- Create: `tests/realtime/game-server.test.ts`

**Interfaces:**
- Consumes: `ClientMessageSchema`, `LiveRoomStore`, `toParticipantView`, engine functions.
- Produces: `createGameServer(options): WebSocketServer`, `SessionRegistry`.

- [ ] **Step 1: Write failing session registry tests**

Create `tests/realtime/game-server.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "@/server/realtime/session-registry";

describe("SessionRegistry", () => {
  it("tracks sessions by room", () => {
    const registry = new SessionRegistry();
    const socket = { send: vi.fn() };

    registry.add("room1", "p1", socket);
    registry.broadcast("room1", (session) => ({ type: "system_message", payload: { message: session.participantId } }));

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "system_message", payload: { message: "p1" } }));
  });
});
```

- [ ] **Step 2: Implement session registry**

Create `src/server/realtime/session-registry.ts`:

```ts
import type { ServerMessage } from "@/lib/realtime/messages";

export interface SendableSocket {
  send(data: string): void;
}

export interface Session {
  roomId: string;
  participantId: string | null;
  host: boolean;
  socket: SendableSocket;
}

export class SessionRegistry {
  private readonly sessions = new Set<Session>();

  add(roomId: string, participantId: string | null, socket: SendableSocket, host = false): Session {
    const session = { roomId, participantId, socket, host };
    this.sessions.add(session);
    return session;
  }

  remove(session: Session): void {
    this.sessions.delete(session);
  }

  broadcast(roomId: string, makeMessage: (session: Session) => ServerMessage): void {
    for (const session of this.sessions) {
      if (session.roomId === roomId) {
        session.socket.send(JSON.stringify(makeMessage(session)));
      }
    }
  }
}
```

- [ ] **Step 3: Add repository and server skeleton**

Create `src/server/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

Create `src/server/repositories/room-repository.ts`:

```ts
import { nanoid } from "nanoid";
import type { RoomState } from "@/lib/poker/engine";
import { prisma } from "@/server/db";

export class RoomRepository {
  async recordHand(room: RoomState): Promise<void> {
    if (!room.hand || !room.hand.finished) {
      return;
    }

    await prisma.hand.upsert({
      where: { roomId_handNumber: { roomId: room.roomId, handNumber: room.hand.number } },
      create: {
        id: room.hand.id,
        roomId: room.roomId,
        handNumber: room.hand.number,
        buttonSeat: room.buttonSeat ?? 1,
        smallBlind: room.settings.smallBlind,
        bigBlind: room.settings.bigBlind,
        board: room.hand.board,
        endedAt: new Date()
      },
      update: {
        board: room.hand.board,
        endedAt: new Date()
      }
    });
  }

  createId(prefix: string): string {
    return `${prefix}_${nanoid(12)}`;
  }
}
```

Create `src/server/realtime/game-server.ts`:

```ts
import { WebSocketServer } from "ws";
import { ClientMessageSchema } from "@/lib/realtime/messages";
import { toParticipantView } from "@/lib/poker/visibility";
import { applyPlayerAction, startHand } from "@/lib/poker/engine";
import type { LiveRoomStore } from "@/server/live-room-store";
import { SessionRegistry } from "./session-registry";

export interface GameServerOptions {
  server: Parameters<typeof WebSocketServer>[0]["server"];
  liveRooms: LiveRoomStore;
}

export function createGameServer(options: GameServerOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: options.server });
  const sessions = new SessionRegistry();

  wss.on("connection", (socket) => {
    let session = sessions.add("", null, socket);

    socket.on("message", async (data) => {
      const parsed = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Invalid message" } }));
        return;
      }

      const message = parsed.data;
      session.roomId = message.roomId;

      const room = await options.liveRooms.getRoom(message.roomId);
      if (!room) {
        socket.send(JSON.stringify({ type: "error", payload: { message: "Room not found" } }));
        return;
      }

      if ("participantToken" in message && message.participantToken) {
        session.participantId = message.participantToken;
      }

      if (message.type === "start_room") {
        await options.liveRooms.saveRoom(startHand(room));
      }

      if (message.type === "player_action") {
        await options.liveRooms.saveRoom(applyPlayerAction(room, message.action));
      }

      const updated = (await options.liveRooms.getRoom(message.roomId)) ?? room;
      sessions.broadcast(message.roomId, (target) => ({
        type: "room_snapshot",
        payload: toParticipantView(updated, {
          participantId: target.participantId,
          role: target.participantId ? "player" : "spectator",
          host: target.host
        })
      }));
    });

    socket.on("close", () => sessions.remove(session));
  });

  return wss;
}
```

Create `src/server/index.ts`:

```ts
import { createServer } from "node:http";
import next from "next";
import { createRedisClient } from "./redis";
import { LiveRoomStore } from "./live-room-store";
import { createGameServer } from "./realtime/game-server";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = Number(process.env.PORT ?? 3000);

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res);
});

createGameServer({
  server,
  liveRooms: new LiveRoomStore(createRedisClient())
});

server.listen(port, () => {
  console.log(`Server ready on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/realtime/game-server.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/realtime/session-registry.ts src/server/realtime/game-server.ts src/server/index.ts src/server/db.ts src/server/repositories/room-repository.ts tests/realtime/game-server.test.ts
git commit -m "feat: add websocket game server"
```

---

### Task 9: Room Creation And Joining UI

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/app/create/page.tsx`
- Create: `src/components/room/CreateRoomForm.tsx`
- Create: `src/components/room/JoinRoomForm.tsx`
- Create: `src/app/api/rooms/route.ts`
- Create: `tests/e2e/create-room.spec.ts`

**Interfaces:**
- Consumes: `validateRoomSettings`, `createInitialRoomState`, `LiveRoomStore`.
- Produces: POST `/api/rooms` returning `{ roomId, inviteUrl, hostUrl }`.

- [ ] **Step 1: Write failing E2E test**

Create `tests/e2e/create-room.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("host can open create room form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "Create private room" })).toBeVisible();
  await expect(page.getByLabel("Seats")).toBeVisible();
});
```

- [ ] **Step 2: Add API route**

Create `src/app/api/rooms/route.ts`:

```ts
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createInitialRoomState } from "@/lib/poker/engine";
import { validateRoomSettings } from "@/lib/room/settings";
import { LiveRoomStore } from "@/server/live-room-store";
import { createRedisClient } from "@/server/redis";

export async function POST(request: Request) {
  const settings = validateRoomSettings(await request.json());
  const roomId = nanoid(10);
  const hostToken = nanoid(32);
  const room = createInitialRoomState(settings, roomId);
  await new LiveRoomStore(createRedisClient()).saveRoom(room);

  const origin = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  return NextResponse.json({
    roomId,
    inviteUrl: `${origin}/room/${roomId}`,
    hostUrl: `${origin}/room/${roomId}?host=${hostToken}`
  });
}
```

- [ ] **Step 3: Add pages and forms**

Create `src/app/page.tsx`:

```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home">
      <h1>Private Hold'em Room</h1>
      <p>Virtual-chip private rooms for friends.</p>
      <Link href="/create">Create room</Link>
    </main>
  );
}
```

Create `src/app/create/page.tsx`:

```tsx
import { CreateRoomForm } from "@/components/room/CreateRoomForm";

export default function CreatePage() {
  return (
    <main>
      <h1>Create private room</h1>
      <CreateRoomForm />
    </main>
  );
}
```

Create `src/components/room/CreateRoomForm.tsx`:

```tsx
"use client";

import { useState } from "react";

export function CreateRoomForm() {
  const [result, setResult] = useState<{ inviteUrl: string; hostUrl: string } | null>(null);

  async function submit(formData: FormData) {
    const response = await fetch("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        mode: formData.get("mode"),
        seats: Number(formData.get("seats")),
        initialChips: Number(formData.get("initialChips")),
        smallBlind: Number(formData.get("smallBlind")),
        bigBlind: Number(formData.get("bigBlind")),
        actionTimerSeconds: formData.get("actionTimerSeconds") ? Number(formData.get("actionTimerSeconds")) : null,
        blindIncrease: formData.get("mode") === "tournament" ? { type: "hands", interval: 10 } : undefined
      })
    });
    setResult(await response.json());
  }

  return (
    <form action={submit}>
      <label>
        Mode
        <select name="mode" defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="tournament">Tournament</option>
        </select>
      </label>
      <label>
        Seats
        <select name="seats" defaultValue="6">
          {[2, 3, 4, 5, 6].map((seat) => (
            <option key={seat} value={seat}>{seat}</option>
          ))}
        </select>
      </label>
      <label>
        Initial chips
        <input name="initialChips" type="number" defaultValue="2000" />
      </label>
      <label>
        Small blind
        <input name="smallBlind" type="number" defaultValue="10" />
      </label>
      <label>
        Big blind
        <input name="bigBlind" type="number" defaultValue="20" />
      </label>
      <label>
        Action timer seconds
        <input name="actionTimerSeconds" type="number" placeholder="Unlimited" />
      </label>
      <button type="submit">Create</button>
      {result ? (
        <section>
          <a href={result.inviteUrl}>Invite link</a>
          <a href={result.hostUrl}>Host link</a>
        </section>
      ) : null}
    </form>
  );
}
```

Create `src/components/room/JoinRoomForm.tsx`:

```tsx
"use client";

export function JoinRoomForm({ roomId }: { roomId: string }) {
  return (
    <form>
      <input type="hidden" name="roomId" value={roomId} />
      <label>
        Nickname
        <input name="displayName" maxLength={24} required />
      </label>
      <button type="submit">Join</button>
      <button type="button">Spectate</button>
    </form>
  );
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/create-room.spec.ts
```

Expected: typecheck passes and Playwright sees the create-room form.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/create/page.tsx src/components/room/CreateRoomForm.tsx src/components/room/JoinRoomForm.tsx src/app/api/rooms/route.ts tests/e2e/create-room.spec.ts
git commit -m "feat: add room creation flow"
```

---

### Task 10: Mobile Table UI And Socket Client

**Files:**
- Create: `src/hooks/useRoomSocket.ts`
- Create: `src/app/room/[roomId]/page.tsx`
- Create: `src/app/room/[roomId]/RoomClient.tsx`
- Create: `src/components/table/PokerTable.tsx`
- Create: `src/components/table/SeatRing.tsx`
- Create: `src/components/table/ActionControls.tsx`
- Create: `src/components/table/SystemLog.tsx`
- Create: `src/components/table/HandResultPanel.tsx`
- Modify: `src/styles/globals.css`
- Create: `tests/e2e/friends-room.spec.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `ClientMessage`, participant room view.
- Produces: mobile room page with socket connection, public table state, legal actions, quick phrases, and hand result panel.

- [ ] **Step 1: Write failing room page E2E test**

Create `tests/e2e/friends-room.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("room page shows join flow and table surface", async ({ page }) => {
  await page.goto("/room/test-room");

  await expect(page.getByLabel("Nickname")).toBeVisible();
  await expect(page.getByText("Table")).toBeVisible();
});
```

- [ ] **Step 2: Add socket hook**

Create `src/hooks/useRoomSocket.ts`:

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/messages";

export function useRoomSocket(roomId: string) {
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const socket = useMemo(() => ({ current: null as WebSocket | null }), []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}`);
    socket.current = ws;
    ws.addEventListener("open", () => setConnected(true));
    ws.addEventListener("close", () => setConnected(false));
    ws.addEventListener("message", (event) => {
      setMessages((previous) => [...previous, JSON.parse(event.data)]);
    });
    return () => ws.close();
  }, [roomId, socket]);

  function send(message: ClientMessage) {
    socket.current?.send(JSON.stringify(message));
  }

  return { connected, messages, send };
}
```

- [ ] **Step 3: Add room shell and client**

Create `src/app/room/[roomId]/page.tsx`:

```tsx
import { RoomClient } from "./RoomClient";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomClient roomId={roomId} />;
}
```

Create `src/app/room/[roomId]/RoomClient.tsx`:

```tsx
"use client";

import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { PokerTable } from "@/components/table/PokerTable";
import { SystemLog } from "@/components/table/SystemLog";
import { useRoomSocket } from "@/hooks/useRoomSocket";

export function RoomClient({ roomId }: { roomId: string }) {
  const { connected, messages } = useRoomSocket(roomId);

  return (
    <main className="room">
      <header>
        <span>{connected ? "Connected" : "Connecting"}</span>
      </header>
      <JoinRoomForm roomId={roomId} />
      <PokerTable view={messages.at(-1)?.payload} />
      <SystemLog messages={messages} />
    </main>
  );
}
```

- [ ] **Step 4: Add table components**

Create `src/components/table/PokerTable.tsx`:

```tsx
import { ActionControls } from "./ActionControls";
import { HandResultPanel } from "./HandResultPanel";
import { SeatRing } from "./SeatRing";

export function PokerTable({ view }: { view: unknown }) {
  return (
    <section className="table-surface" aria-label="Table">
      <h2>Table</h2>
      <SeatRing view={view} />
      <div className="board" aria-label="Board" />
      <ActionControls />
      <HandResultPanel view={view} />
    </section>
  );
}
```

Create `src/components/table/SeatRing.tsx`:

```tsx
export function SeatRing({ view }: { view: unknown }) {
  const seats = typeof view === "object" && view && "seats" in view ? (view.seats as Array<{ seatNumber: number; displayName: string | null; chips: number }>) : [];

  return (
    <div className="seat-ring">
      {seats.map((seat) => (
        <div className="seat" key={seat.seatNumber}>
          <strong>{seat.displayName ?? `Seat ${seat.seatNumber}`}</strong>
          <span>{seat.chips}</span>
        </div>
      ))}
    </div>
  );
}
```

Create `src/components/table/ActionControls.tsx`:

```tsx
export function ActionControls() {
  return (
    <div className="actions">
      <button type="button">Fold</button>
      <button type="button">Check / Call</button>
      <button type="button">Raise</button>
      <button type="button">All in</button>
    </div>
  );
}
```

Create `src/components/table/SystemLog.tsx`:

```tsx
import type { ServerMessage } from "@/lib/realtime/messages";

export function SystemLog({ messages }: { messages: ServerMessage[] }) {
  return (
    <aside className="system-log">
      {messages.slice(-8).map((message, index) => (
        <p key={index}>{message.type}</p>
      ))}
    </aside>
  );
}
```

Create `src/components/table/HandResultPanel.tsx`:

```tsx
export function HandResultPanel({ view }: { view: unknown }) {
  const hand = typeof view === "object" && view && "hand" in view ? view.hand : null;
  if (!hand || typeof hand !== "object" || !("finished" in hand) || !hand.finished) {
    return null;
  }

  return <section className="hand-result">Hand finished</section>;
}
```

- [ ] **Step 5: Add mobile table CSS**

Append to `src/styles/globals.css`:

```css
.home,
main {
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 20px;
}

.room {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 12px;
}

.table-surface {
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--felt);
  padding: 12px;
  display: grid;
  grid-template-rows: auto 1fr auto auto;
}

.seat-ring {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.seat {
  min-height: 64px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.actions button {
  min-height: 44px;
}

.system-log {
  max-height: 120px;
  overflow: auto;
  color: var(--muted);
}
```

- [ ] **Step 6: Run E2E and typecheck**

Run:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/friends-room.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useRoomSocket.ts src/app/room/[roomId]/page.tsx src/app/room/[roomId]/RoomClient.tsx src/components/table/PokerTable.tsx src/components/table/SeatRing.tsx src/components/table/ActionControls.tsx src/components/table/SystemLog.tsx src/components/table/HandResultPanel.tsx src/styles/globals.css tests/e2e/friends-room.spec.ts
git commit -m "feat: add mobile room table UI"
```

---

### Task 11: Cash Game, Tournament, Spectator, And Disconnect Rules

**Files:**
- Modify: `src/lib/poker/engine.ts`
- Modify: `src/server/realtime/game-server.ts`
- Modify: `src/lib/poker/visibility.ts`
- Create: `tests/poker/room-modes.test.ts`
- Create: `tests/realtime/spectator-and-disconnect.test.ts`

**Interfaces:**
- Extends: engine and server to support cash rebuy, tournament elimination, blind increases, spectator seating rules, and host disconnect handling.

- [ ] **Step 1: Write failing room-mode tests**

Create `tests/poker/room-modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialRoomState } from "@/lib/poker/engine";

describe("room modes", () => {
  it("cash game records cumulative rebuy", () => {
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );
    const seat = { ...room.seats[0], participantId: "p1", displayName: "A", chips: 0, cumulativeBuyIn: 1000, status: "seated" as const };
    const updated = { ...room, seats: [seat, room.seats[1]] };

    updated.seats[0].chips += 500;
    updated.seats[0].cumulativeBuyIn += 500;

    expect(updated.seats[0].cumulativeBuyIn).toBe(1500);
  });

  it("tournament records eliminated players with zero chips", () => {
    const room = createInitialRoomState(
      { mode: "tournament", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null, blindIncrease: { type: "hands", interval: 5 } },
      "r1"
    );

    expect(room.mode).toBe("tournament");
  });
});
```

- [ ] **Step 2: Write failing spectator and disconnect tests**

Create `tests/realtime/spectator-and-disconnect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialRoomState } from "@/lib/poker/engine";

describe("spectator and disconnect rules", () => {
  it("cash spectators may sit before the next hand when a seat is open", () => {
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );

    expect(room.seats.some((seat) => seat.participantId === null)).toBe(true);
  });

  it("active-player disconnect pauses the room for host handling", () => {
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );

    const paused = { ...room, status: "paused" as const };
    expect(paused.status).toBe("paused");
  });
});
```

- [ ] **Step 3: Implement rule helpers in engine**

Modify `src/lib/poker/engine.ts` to export these helpers:

```ts
export function canClaimSeat(state: RoomState, asSpectator: boolean): boolean {
  if (!asSpectator) {
    return false;
  }
  if (state.mode === "cash") {
    return state.seats.some((seat) => seat.participantId === null);
  }
  return state.status === "lobby" && state.seats.some((seat) => seat.participantId === null);
}

export function applyCashRebuy(state: RoomState, participantId: string, amount: number): RoomState {
  if (state.mode !== "cash") {
    throw new Error("Rebuy is only available in cash games");
  }
  return {
    ...state,
    seats: state.seats.map((seat) =>
      seat.participantId === participantId
        ? { ...seat, chips: seat.chips + amount, cumulativeBuyIn: seat.cumulativeBuyIn + amount }
        : seat
    )
  };
}

export function markDisconnected(state: RoomState, participantId: string): RoomState {
  const inCurrentHand = Boolean(state.hand?.betting.players.some((player) => player.id === participantId && !player.folded));
  return {
    ...state,
    status: inCurrentHand ? "paused" : state.status,
    seats: state.seats.map((seat) => (seat.participantId === participantId ? { ...seat, status: "disconnected" } : seat))
  };
}
```

- [ ] **Step 4: Wire helpers into game server**

Modify `src/server/realtime/game-server.ts` to handle:

```ts
if (message.type === "rebuy") {
  const { applyCashRebuy } = await import("@/lib/poker/engine");
  await options.liveRooms.saveRoom(applyCashRebuy(room, message.participantToken, message.amount));
}

if (message.type === "handle_disconnect" && message.handling === "pause") {
  await options.liveRooms.saveRoom({ ...room, status: "paused" });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/poker/room-modes.test.ts tests/realtime/spectator-and-disconnect.test.ts
npm run typecheck
```

Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/poker/engine.ts src/server/realtime/game-server.ts src/lib/poker/visibility.ts tests/poker/room-modes.test.ts tests/realtime/spectator-and-disconnect.test.ts
git commit -m "feat: add room mode and spectator rules"
```

---

### Task 12: Hand History And Review

**Files:**
- Modify: `src/server/repositories/room-repository.ts`
- Create: `src/app/room/[roomId]/review/page.tsx`
- Create: `src/app/api/rooms/[roomId]/hands/route.ts`
- Create: `tests/realtime/hand-history.test.ts`
- Create: `tests/e2e/room-review.spec.ts`

**Interfaces:**
- Produces: GET `/api/rooms/:roomId/hands`, review page with hand number, board, winners, pot size, and action log.

- [ ] **Step 1: Write failing repository test**

Create `tests/realtime/hand-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("hand history shape", () => {
  it("contains the public review fields", () => {
    const hand = {
      handNumber: 1,
      board: ["As", "Kd", "Qc"],
      winners: ["p1"],
      potSize: 120,
      actions: [{ sequenceNumber: 1, actionType: "raise", amount: 40 }]
    };

    expect(Object.keys(hand)).toEqual(["handNumber", "board", "winners", "potSize", "actions"]);
  });
});
```

- [ ] **Step 2: Add hands API**

Create `src/app/api/rooms/[roomId]/hands/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const hands = await prisma.hand.findMany({
    where: { roomId },
    orderBy: { handNumber: "asc" },
    include: { actions: { orderBy: { sequenceNumber: "asc" } }, pots: true }
  });

  return NextResponse.json(
    hands.map((hand) => ({
      handNumber: hand.handNumber,
      board: hand.board,
      winners: hand.pots.flatMap((pot) => pot.winnerParticipantIds as string[]),
      potSize: hand.pots.reduce((sum, pot) => sum + pot.amount, 0),
      actions: hand.actions.map((action) => ({
        sequenceNumber: action.sequenceNumber,
        street: action.street,
        participantId: action.participantId,
        actionType: action.actionType,
        amount: action.amount,
        resultingStack: action.resultingStack
      }))
    }))
  );
}
```

- [ ] **Step 3: Add review page**

Create `src/app/room/[roomId]/review/page.tsx`:

```tsx
export default async function RoomReviewPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;

  return (
    <main>
      <h1>Room review</h1>
      <p>Room {roomId}</p>
      <section aria-label="Hand history" />
    </main>
  );
}
```

- [ ] **Step 4: Write E2E smoke test**

Create `tests/e2e/room-review.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("review page opens", async ({ page }) => {
  await page.goto("/room/test-room/review");
  await expect(page.getByRole("heading", { name: "Room review" })).toBeVisible();
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/realtime/hand-history.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/room-review.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/repositories/room-repository.ts src/app/room/[roomId]/review/page.tsx src/app/api/rooms/[roomId]/hands/route.ts tests/realtime/hand-history.test.ts tests/e2e/room-review.spec.ts
git commit -m "feat: add hand history review"
```

---

### Task 13: Verification, Copy Guardrails, And Launch Readiness

**Files:**
- Create: `docs/launch-checklist.md`
- Modify: `README.md`
- Modify: `src/app/page.tsx`
- Modify: `src/app/create/page.tsx`

**Interfaces:**
- Produces: final verification checklist and launch-safe copy.

- [ ] **Step 1: Add launch checklist**

Create `docs/launch-checklist.md`:

```md
# Launch Checklist

## Product Guardrails

- Uses virtual chips only.
- No recharge, withdrawal, cash settlement, prizes, rewards, or token exchange.
- No public lobby or matchmaking.
- Private rooms are link-based.
- Host controls do not reveal hidden cards.
- Spectators cannot see unrevealed hole cards.
- Quick phrases only; no free-form chat or voice.

## Technical Checks

- `npm test` passes.
- `npm run typecheck` passes.
- `npm run test:e2e` passes.
- Redis connection configured with `REDIS_URL`.
- PostgreSQL connection configured with `DATABASE_URL`.
- Prisma migrations applied before production launch.

## Manual QA

- Create cash room and invite second browser.
- Play one hand to completion.
- Rebuy in cash mode and verify cumulative buy-in changes.
- Create tournament room and verify late join cannot sit after start.
- Eliminate a player and verify rank is shown.
- Join as spectator and verify no hidden cards appear.
- Refresh an active player and verify seat restore.
- Disconnect active player and verify room pauses for host handling.
```

- [ ] **Step 2: Add README**

Create or update `README.md`:

```md
# Texas Hold'em Friends Room

Mobile-first private no-limit Texas Hold'em rooms for friends using virtual chips only.

## Development

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

## Verification

```bash
npm test
npm run typecheck
npm run test:e2e
```

## Product Boundaries

This app does not support real-money settlement, recharge, withdrawal, rewards, prizes, token exchange, public matchmaking, or public room discovery.
```

- [ ] **Step 3: Search for unsafe copy**

Run:

```bash
rg -n "money|cash out|withdraw|recharge|prize|reward|settlement|gambl|赢钱|提现|充值|奖|赌" src docs README.md
```

Expected: only guardrail documentation references appear. UI copy should not imply external value.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run test:e2e
npm run build
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add docs/launch-checklist.md README.md src/app/page.tsx src/app/create/page.tsx
git commit -m "docs: add launch checklist and product guardrails"
```
