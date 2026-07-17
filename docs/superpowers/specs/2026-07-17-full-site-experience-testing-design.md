# Full-Site Poker Experience Testing Design

**Status:** Approved design
**Date:** 2026-07-17
**Scope:** On-demand, fully automated, 20–30 minute experience acceptance for the Docker-deployed private Texas Hold'em website

## 1. Problem

The existing suite is strong at proving poker rules, protocol contracts, persistence, and component rendering. It does not yet prove that a real player experiences a clear, correctly paced, synchronized journey from room creation through final accounting.

The new workflow must detect failures such as:

- a logically correct action that gives no timely visible feedback;
- an all-in board that appears too quickly or skips the intended reveal sequence;
- controls, cards, bets, or popovers that overlap on desktop or mobile;
- different players seeing incompatible actors, pots, boards, or hand numbers;
- a correct final balance preceded by confusing, duplicated, or stale intermediate states;
- a reconnect that leaks private cards, repeats an action, or skips presentation phases.

This is an experience acceptance workflow, not a replacement for the rule-engine and integration suites.

## 2. Decisions

- The workflow runs only when the user explicitly requests a full-site test.
- The default run is the complete 20–30 minute suite.
- The browser matrix is desktop Chrome at `1440x900` and mobile Chrome emulation at `390x844`.
- The primary technology is Playwright with multiple isolated browser contexts.
- Version 1 does not add Artillery, k6, scheduled runs, commit hooks, or large-scale load generation.
- The workflow judges measurable experience properties. It does not claim to decide whether poker is subjectively fun.

## 3. External Practice

The design combines established test categories rather than inventing a poker-specific testing framework:

- Playwright supports multiple isolated browser contexts in one scenario for multi-user applications: <https://playwright.dev/docs/browser-contexts>
- Playwright Trace records actions, timing, DOM snapshots, screenshots, console output, and network activity: <https://playwright.dev/docs/trace-viewer>
- Playwright records per-context test videos: <https://playwright.dev/docs/videos>
- Playwright visual comparisons produce expected, actual, and diff images: <https://playwright.dev/docs/test-snapshots>
- Artillery's Playwright engine demonstrates browser-level user-journey timing and Web Vitals collection, but is deferred from version 1: <https://www.artillery.io/docs/reference/engines/playwright>
- k6 and Artillery provide WebSocket load testing when a future scale-testing layer is needed: <https://grafana.com/docs/k6/latest/using-k6/protocols/websockets/> and <https://www.artillery.io/docs/reference/engines/websocket>

No general-purpose tool supplies deterministic Texas Hold'em scenarios, pot accounting, or reveal timing. Those fixtures are project-specific.

## 4. Invocation Contract

The repository exposes one entry point:

```bash
npm run test:site
```

When the user asks Codex to run a complete website test, Codex invokes this command, waits for a terminal verdict, opens the generated HTML report, and summarizes failures with direct artifact links.

The command must:

1. create a unique `runId`;
2. capture Git revision, image identity, environment, browser version, and configured thresholds before execution;
3. enforce a 30-minute overall deadline;
4. preserve partial evidence for every failure or timeout;
5. clean only resources created by the current `runId` after evidence is durable.

## 5. Test Architecture

### 5.1 Preflight and isolation

The runner starts an isolated test stack using the same application image and production startup path as the deployed site, but with:

- a separate Compose project name;
- a separate host port;
- fresh PostgreSQL and Redis volumes;
- run-scoped room IDs and participant names;
- no reuse of production room data.

The preflight verifies application, PostgreSQL, and Redis health before any product assertion. A failed dependency produces an environment verdict, not a product failure.

### 5.2 Deterministic poker fixtures

The runner prepares exact room states through project-internal fixture builders and repository/store adapters. It must not add a public test endpoint, browser-visible testing token, or production backdoor.

Each fixture declares:

- room settings and seats;
- participant identities and starting stacks;
- button and actor positions;
- exact deck or deterministic seed;
- expected action sequence;
- expected pots, awards, balances, and presentation phases;
- prohibited observations, including private-card leaks and duplicate settlements.

The browser still performs every user-facing action through the real UI and WebSocket connection. Fixture setup may establish the starting state; it may not fabricate the user-visible outcome.

### 5.3 Multi-user browser model

A scenario creates independent browser contexts for:

- one host;
- four to six seated players;
- one spectator where visibility or synchronization is relevant.

Every context has independent cookies, storage, viewport, trace, video, event stream, console capture, and role metadata. The test coordinator supplies barriers so concurrent views can be compared at the same logical phase.

### 5.4 Production smoke

After isolated acceptance passes, the runner exercises the currently deployed `http://localhost:3000` through normal public entry points:

- health endpoint;
- home and create pages;
- room creation;
- host link and invite link;
- player join and seat claim;
- one basic host/player WebSocket operation.

The smoke test does not inject fixtures into the deployed stack. It tracks the exact room it creates and removes only that run-scoped test data through an internal cleanup utility. If safe cleanup cannot be proven, the room is retained and reported rather than deleted broadly.

## 6. Scenario Matrix

### EXP-001 — Room creation and roles

- Create a cash room through the UI.
- Verify invite and host links.
- Join as player and spectator.
- Verify host-only controls and rejection of forged host or participant authority.

### EXP-002 — Seating and start comprehension

- Exercise 2-, 6-, and 9-seat layouts.
- Verify the local player is bottom-centered.
- Verify seat ordering and readable empty/occupied states.
- Verify a blocked start explains why it is blocked.

### EXP-003 — Normal betting journey

- Complete preflop, flop, turn, and river with check, call, bet, raise, fold, and all-in opportunities.
- Assert that only context-valid primary actions are offered.
- Compare actor, pot, street, board, and committed amounts across all views after every action.

### EXP-004 — Four-player all-in presentation

- Enter a four-player all-in before the board is complete.
- Observe showdown before settlement.
- Verify community cards are revealed one at a time in the configured sequence.
- Verify no player can act during presentation.
- Verify winner highlighting and collection occur only after the final board.

### EXP-005 — Main pot, side pots, and split pot

- Exercise unequal stacks and multiple eligible winner sets.
- Verify a folded player never wins a pot.
- Verify every visible pot award and ending stack.
- Verify total chips are conserved, excluding recorded top-ups.

### EXP-006 — Cumulative next-hand top-up

- Open the persistent lower-left top-up control while chips remain.
- Queue `300`, then `200`.
- Verify `Pending +500` locally and table-wide notifications for both submissions.
- Verify the current hand stack does not change.
- Verify exactly `500` is applied at the next hand boundary.

### EXP-007 — Per-hand and final accounting

- Verify every player appears in the hand result.
- Verify starting chips, ending chips, and signed net values.
- Verify the hand result is visible for approximately two seconds.
- Request room end during a live hand and verify that the hand completes first.
- Verify the final accounting remains visible and includes initial chips, applied top-ups, final chips, and net chips.

### EXP-008 — Disconnect and recovery

- Disconnect the acting player, host, and spectator in separate cases.
- Reconnect before and after a presentation deadline.
- Verify no action is duplicated, no result is repeated, no phase is skipped, and no future or private cards leak.

### EXP-009 — Mobile critical journey

- Repeat room join, seat claim, betting controls, top-up, host controls, all-in presentation, hand result, and final result at `390x844`.
- Verify scroll, hit targets, popovers, and overlays mechanically.

### EXP-010 — Deployed production smoke

- Execute the public-entry smoke described in section 5.4 after isolated acceptance succeeds.

## 7. Mechanical Experience Gates

### 7.1 Responsiveness and synchronization

- A user action must produce visible local or authoritative feedback within `800ms` on the local Docker stack.
- All connected views must converge on hand number, street, board, pot, actor, and room phase within `1000ms` after an authoritative transition.
- An unexplained state with no actor, no presentation deadline, no visible result, and no user guidance may not persist longer than `3000ms`.

### 7.2 Cinematic timing

The runner reads the authoritative phase and records the first visible frame of every reveal. It verifies:

- showdown reveal precedes remaining board cards;
- board length increases by exactly one per reveal event;
- the configured card gaps and street holds are observed;
- the per-hand result remains visible for approximately `2000ms`;
- individual timed phases tolerate `±400ms` of browser scheduling variance;
- all remaining cards never appear in the same rendered frame.

Timing is judged from the event and rendering timeline, not from a final screenshot.

### 7.3 Layout and interaction

- `documentElement.scrollWidth` must not exceed the viewport width in tested room states.
- Required controls and overlays must remain within the viewport or a documented scroll container.
- Mobile primary controls must expose a hit area of at least `44x44` CSS pixels.
- The center point of every enabled required control must hit that control or one of its descendants.
- Required cards, bets, stacks, player names, action controls, top-up controls, host controls, and result panels must not be hidden by another interactive layer.
- Visual baselines are used only for stable checkpoints; animation is judged by geometry and event timing to avoid flaky pixel diffs.

### 7.4 Accounting and privacy

- Per-hand player net values sum to zero.
- Final net values equal `finalChips - initialChips - appliedTopUpChips`.
- Pending top-ups are excluded from current-hand and final applied accounting until their target boundary.
- Spectators never receive private hole cards.
- Folded private cards remain hidden unless a documented showdown rule reveals them.
- Host and participant tokens never appear in evidence artifacts.

### 7.5 Browser health

- No unhandled page error or unhandled promise rejection.
- No unexpected WebSocket close, duplicate transition event, or malformed server message.
- Expected authorization failures are asserted and classified, not counted as browser-health failures.

## 8. Evidence Model

Each run writes:

```text
outputs/site-test/<runId>/
  case-manifest.json
  events.json
  report.json
  report.html
  videos/
    <caseId>-<role>.webm
  traces/
    <caseId>-<role>.zip
  screenshots/
    <caseId>-<checkpoint>-<role>.png
  visual-diffs/
  diagnostics/
    docker.txt
    server.log
    browser-console.json
    websocket-events.json
```

Every structured event contains:

- `runId`, `caseId`, `attemptId`, and actor role;
- monotonically increasing `seq`;
- wall-clock and monotonic timestamps;
- stage, type, status, and redacted details;
- related hand number, flow sequence, and artifact paths where applicable.

The evidence schema is derived from the evidence-driven testing templates for case manifests, events, and reports. A validator runs before the final verdict. Missing required artifacts make the harness fail or the result inconclusive.

## 9. Verdicts and Failure Discipline

The report judges three planes independently:

- `product`: the website satisfied the scenario and experience gates;
- `harness`: browsers, assertions, timelines, and evidence capture were trustworthy;
- `environment`: Docker, storage, ports, binaries, and dependencies were healthy.

Overall verdicts:

- `PASS`: all required cases pass and all three planes pass;
- `FAIL`: the product is proven to violate at least one required assertion;
- `INCONCLUSIVE`: harness or environment failure prevents a trustworthy product judgment.

Rules:

- Every stage has a deadline; the suite never waits indefinitely.
- The overall deadline is 30 minutes.
- Real-time success paths run twice with the same fixture to expose intermittent ordering failures.
- Failures are not blindly retried. The first failure preserves the complete scene before any second attempt.
- A failure report identifies the earliest divergent stage and links the relevant video, trace, screenshot, and events.
- Every confirmed product defect is reduced to the smallest reproducible permanent regression test.

## 10. Cleanup and Safety

- Cleanup operates only on exact resources recorded under the current `runId`.
- No wildcard database deletion, broad Redis scan-and-delete, recursive project deletion, or volume deletion is permitted.
- Evidence is durable before cleanup begins.
- A cleanup failure is reported as an environment/harness issue and does not erase evidence.
- Host tokens, participant tokens, database credentials, and full private-card payloads are redacted from reports and logs.
- The isolated test stack may be destroyed after evidence validation; the deployed production stack is never restarted or replaced by the experience runner.

## 11. Repository Shape

The implementation is expected to add focused units resembling:

```text
tests/experience/
  fixtures/
  scenarios/
  assertions/
  page-objects/
  evidence/
scripts/run-full-site-test.ts
playwright.experience.config.ts
docs/qa-test-checklist.md
```

The exact filenames may change during implementation planning, but responsibilities must remain separated: fixture construction, actor control, experience assertions, evidence writing, and orchestration may not collapse into one large script.

## 12. Completion Criteria

Version 1 is complete only when:

- `npm run test:site` executes the entire on-demand workflow;
- all EXP-001 through EXP-010 cases have deterministic manifests and mechanical assertions;
- desktop and mobile Chrome evidence is generated;
- a forced product failure produces `FAIL` with usable artifacts;
- a forced environment failure produces `INCONCLUSIVE`, not `FAIL`;
- evidence validation rejects incomplete or unredacted packs;
- cleanup is proven to affect only run-scoped resources;
- the existing unit, integration, E2E, long-run, typecheck, build, and Docker health checks remain green.
