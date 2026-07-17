# Full-Site Poker Experience Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand `npm run test:site` workflow that proves the real desktop and mobile poker journey, produces a trustworthy evidence pack, and distinguishes product failures from harness or environment failures.

**Architecture:** A TypeScript runner starts a run-scoped Docker Compose stack from the deployed application image, then invokes a dedicated Playwright configuration. Project-internal fixture builders seed exact poker states into only that stack's Redis after browser identities have been created through the normal UI/API. Multi-context Playwright scenarios drive the real UI and WebSocket path, record redacted evidence, and aggregate three-plane verdicts before exact resource cleanup. A final smoke test touches the already deployed `http://localhost:3000` only after isolated acceptance passes.

**Tech Stack:** TypeScript, Vitest, Playwright/Chromium, Docker Compose, PostgreSQL/Prisma, Redis/ioredis, Zod, fflate for inspecting trace ZIP contents.

## Global Constraints

- Run every command from the repository root. Do not stage or modify the pre-existing untracked `.superpowers/` directory.
- Do not add a public test API, browser-visible test token, production feature flag, scheduled job, commit hook, Artillery, k6, or subjective AI scoring.
- Keep Playwright `retries: 0` and `workers: 1`. Repeating a real-time success path twice is a declared case attempt, not an automatic retry.
- Keep the measured thresholds in one exported object: local feedback `800ms`, cross-view convergence `1000ms`, unexplained dead state `3000ms`, timed-phase tolerance `400ms`, hand-summary target `2000ms`, and mobile hit target `44px`.
- Never start tracing until host and participant credentials have been bootstrapped and sensitive URLs have been removed from browser history. Evidence validation must inspect ordinary files and decompressed trace entries for known secrets.
- Cleanup may use only exact resource IDs recorded for the current `runId`. If an ownership check fails, retain the resource and report cleanup as inconclusive; never broaden the deletion.
- Do not restart, rebuild, replace, or stop the deployed `texas-holdem` Compose project. The isolated project name must match `holdem-site-<runId>` and the runner must verify that exact name before `docker compose down --volumes`.
- The production smoke base URL defaults to `http://localhost:3000` and may be overridden only with `SITE_TEST_SMOKE_URL`.
- Preserve partial manifests, events, screenshots, traces, video, browser diagnostics, Docker diagnostics, and resource records before cleanup.
- Each task below follows red-green-refactor: add the focused failing test, observe the named failure, add the minimum implementation, rerun the focused test, then commit.

---

## Task 1: Define the evidence contracts, recorder, redaction, and validator

**Files:**

- Create: `tests/experience/evidence/contracts.ts`
- Create: `tests/experience/evidence/redaction.ts`
- Create: `tests/experience/evidence/recorder.ts`
- Create: `tests/experience/evidence/validator.ts`
- Create: `tests/experience/evidence/evidence.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add `fflate` as a development dependency with `npm install --save-dev fflate` so the validator can inspect every text entry inside Playwright trace ZIPs instead of trusting a raw-byte search.
- [ ] In `evidence.test.ts`, write failing tests for: monotonic event sequence numbers; required `runId`, `caseId`, `attemptId`, actor, wall-clock, and monotonic timestamps; token/credential redaction in nested objects and URLs; rejection of a missing artifact; and rejection when a known host or participant token appears in a decompressed trace entry.
- [ ] Run `npm test -- tests/experience/evidence/evidence.test.ts` and verify it fails because the evidence modules do not exist.
- [ ] Define Zod-backed contracts for `ExperienceCaseManifest`, `EvidenceEvent`, `ArtifactRecord`, `PlaneResult`, `CaseReport`, `RunReport`, `RunResourceRecord`, `OverallVerdict`, and `ExperienceThresholds`. Keep the source-template fields (`schemaVersion`, objective, entrypoint, fixture, assertions, forbidden outcomes, acceptable alternatives, stop conditions) and extend events with `attemptId`, actor, `monotonicMs`, hand number, flow sequence, and artifact IDs.
- [ ] Export `EXPERIENCE_THRESHOLDS` with the six approved numeric gates from the global constraints.
- [ ] Implement `redactForEvidence(value, knownSecrets)` to replace token-like keys, PostgreSQL/Redis credentials, `host=` query values, participant tokens, and known secret byte strings while retaining safe diagnostic structure. Never store full private-card payloads; store visibility booleans and card counts instead.
- [ ] Implement `EvidenceRecorder` with `recordEvent`, `recordArtifact`, `finishCase`, and atomic JSON writes. It must assign `seq` itself and write partial evidence after every stage transition.
- [ ] Implement `validateEvidencePack(outputRoot, knownSecrets)` to parse every manifest/report/event, verify referenced artifacts exist under `outputRoot`, reject path traversal, check event ordering, scan ordinary text files, and inflate/scan trace ZIP entries with `fflate`.
- [ ] Run `npm test -- tests/experience/evidence/evidence.test.ts` and verify all evidence/redaction tests pass.
- [ ] Commit with `git add package.json package-lock.json tests/experience/evidence && git commit -m "test: define site experience evidence contracts"`.

## Task 2: Add the complete case catalog and three-plane report aggregation

**Files:**

- Create: `tests/experience/case-catalog.ts`
- Create: `tests/experience/evidence/verdict.ts`
- Create: `tests/experience/evidence/report-writer.ts`
- Create: `tests/experience/evidence/verdict.test.ts`
- Create: `tests/experience/evidence/report-writer.test.ts`

- [ ] Add a failing catalog test that requires exactly `EXP-001` through `EXP-010`, unique assertion IDs, non-empty forbidden outcomes, explicit stop conditions, and fixture names for every deterministic poker case.
- [ ] Add failing verdict tests proving: all planes pass gives `PASS`; a proven product assertion gives `FAIL`; harness or environment uncertainty gives `INCONCLUSIVE`; and `INCONCLUSIVE` takes precedence when a product judgment is not trustworthy.
- [ ] Add a failing report test that expects `case-manifest.json`, `events.json`, `report.json`, and an escaped `report.html` containing per-case status, all three planes, the earliest divergent event, and relative links to artifacts.
- [ ] Run `npm test -- tests/experience/evidence/verdict.test.ts tests/experience/evidence/report-writer.test.ts` and verify missing-module failures.
- [ ] Populate `EXPERIENCE_CASES` with the approved objectives and mechanical assertions for room/roles, seating, normal betting, cinematic four-way all-in, pots, cumulative top-up, accounting, reconnect, mobile, and deployed smoke. Mark `EXP-003`, `EXP-004`, `EXP-006`, and `EXP-008` as two-attempt real-time cases.
- [ ] Implement `deriveCaseVerdict` and `deriveRunVerdict` without reading Playwright exit codes as product truth. Only a recorded product assertion may produce `FAIL`; unexpected runner/browser/dependency loss produces `INCONCLUSIVE`.
- [ ] Implement the root aggregator so `case-manifest.json` contains run metadata plus all ten immutable manifests, `events.json` is sorted by case/attempt/sequence, and report artifact paths remain relative to the run directory.
- [ ] Run the focused tests and verify they pass. Then run `npm test -- tests/experience/evidence` to confirm the evidence layer is green as a unit.
- [ ] Commit with `git add tests/experience/case-catalog.ts tests/experience/evidence && git commit -m "test: aggregate three-plane experience verdicts"`.

## Task 3: Extract internal storage adapters and implement exact room cleanup

**Files:**

- Create: `src/server/redis-key-value-store.ts`
- Create: `src/server/site-test-cleanup.ts`
- Modify: `src/server/index.ts`
- Modify: `src/app/api/rooms/route.ts`
- Modify: `src/server/repositories/room-repository.ts`
- Create: `tests/realtime/redis-key-value-store.test.ts`
- Modify: `tests/server/room-repository.test.ts`
- Create: `tests/server/site-test-cleanup.test.ts`

- [ ] Add a failing adapter test that verifies Redis `get`, TTL `set`, plain `set`, and `del` calls map exactly to `KeyValueStore` without changing values.
- [ ] Add failing repository tests for `deleteExactRoom(roomId)`: it must delete pots, hand actions, hand players, hands, buy-ins, tournament results, participants, and finally the exact room inside one transaction, with every `where` clause anchored to the provided room ID.
- [ ] Add failing cleanup-command tests requiring all of: an exact room ID, an exact `runId`, a participant whose display name starts with `SITE-<runId>-`, and an exact app-container context marker `SITE_TEST_CLEANUP_ALLOWED=1`. Verify a mismatch performs zero deletes.
- [ ] Run `npm test -- tests/realtime/redis-key-value-store.test.ts tests/server/room-repository.test.ts tests/server/site-test-cleanup.test.ts` and observe missing export/module failures.
- [ ] Move the duplicated Redis adapter from `src/server/index.ts` and the room route into `createRedisKeyValueStore(client)` and update both production callers.
- [ ] Implement `RoomRepository.deleteExactRoom(roomId)` with a Prisma transaction and relation-safe deletion order. Do not accept arrays, prefixes, globs, or optional room IDs.
- [ ] Implement the container-only CLI so it verifies the marker participant before deleting `room:<roomId>` from Redis and the exact durable room from PostgreSQL. Print one JSON result with `deleted`, `retainedReason`, `roomId`, and `runId`; never print credentials.
- [ ] Rerun the focused tests and `npm run typecheck`.
- [ ] Commit with `git add src/server tests/realtime/redis-key-value-store.test.ts tests/server && git commit -m "feat: add exact run-scoped room cleanup"`.

## Task 4: Build the isolated Docker stack controller and safe process runner

**Files:**

- Create: `docker-compose.experience.yml`
- Create: `scripts/site-test/contracts.ts`
- Create: `scripts/site-test/ports.ts`
- Create: `scripts/site-test/process-runner.ts`
- Create: `scripts/site-test/docker-stack.ts`
- Create: `tests/scripts/site-test-stack.test.ts`
- Modify: `tests/deployment/docker-config.test.ts`

- [ ] Add failing tests for run IDs and Compose project names, three distinct loopback port reservations, child-process timeout/partial-output preservation, exact Docker command arguments, production-image identity checks, and refusal to tear down any project that does not match the recorded `holdem-site-<runId>` value.
- [ ] Extend the deployment config test to render the production file plus `docker-compose.experience.yml`; assert PostgreSQL and Redis bind only to `127.0.0.1`, the app image comes from `SITE_TEST_IMAGE`, and every service carries `com.texas-holdem.site-test-run=<runId>`.
- [ ] Run `npm test -- tests/scripts/site-test-stack.test.ts tests/deployment/docker-config.test.ts` and verify it fails because the override/controller do not exist.
- [ ] In the Compose override, publish the isolated app, PostgreSQL, and Redis on runner-selected loopback ports; keep fresh project-scoped volumes; add the run label; and do not alter the production Compose file's normal isolation.
- [ ] Implement `reserveLoopbackPorts(3)`, `runProcess` with an abort deadline and streamed redacted logs, and `DockerSiteTestStack.start/inspect/collectDiagnostics/stop`.
- [ ] Before `up`, inspect `texas-holdem-friends-room:latest` (or `SITE_TEST_IMAGE`) and record its immutable image ID. Start with `--project-name <exact> --no-build --pull never`, wait for all three health states, and verify the isolated app container uses the recorded image ID.
- [ ] Before `down --volumes`, compare the recorded project name, run label, container IDs, and Compose project labels. If any check differs, retain the stack and return an environment cleanup failure.
- [ ] Rerun the focused tests and `npm run typecheck`.
- [ ] Commit with `git add docker-compose.experience.yml scripts/site-test tests/scripts/site-test-stack.test.ts tests/deployment/docker-config.test.ts && git commit -m "test: orchestrate an isolated site test stack"`.

## Task 5: Create deterministic browser identities and poker fixture builders

**Files:**

- Create: `tests/experience/fixtures/types.ts`
- Create: `tests/experience/fixtures/deck.ts`
- Create: `tests/experience/fixtures/api-client.ts`
- Create: `tests/experience/fixtures/runtime.ts`
- Create: `tests/experience/fixtures/builders.ts`
- Create: `tests/experience/fixtures/builders.test.ts`

- [ ] Add failing tests for `deckWithTopCards`, normal-betting, four-player all-in, side-pot, split-pot, top-up/accounting, and reconnect fixtures. Assert unique cards, exact participant/seat mapping, starting chip totals, action order, expected boards, explicit pot totals, and expected awards.
- [ ] Use these independent oracle facts in the tests: unequal stacks `100/200/300/300` create pots `400/300/200`; the short stack with aces receives `400`, the medium stack with kings receives `300`, and the first deep stack with queens receives `200`; the split fixture divides a `200` pot into `100/100` on a board-made straight.
- [ ] For the four-way all-in fixture, use tournament mode and top cards `As Kh Qc Jd Ah Kd Qh Js 2c 7d 9h 3s 4c`, which deal pairs of aces/kings/queens/jacks and then the complete board without invoking cash-game insurance.
- [ ] For the normal betting fixture, define three players and the exact UI action plan: call, call, check; check, bet 20, raise to 40, fold, call; check, check; bet 20, call. The case oracle must list the actor, street, pot, board length, and legal primary actions after each transition.
- [ ] Run `npm test -- tests/experience/fixtures/builders.test.ts` and verify missing-module failures.
- [ ] Implement `ExperienceApiClient.createRoom/joinPlayer` through the ordinary HTTP endpoints. Extract host credentials only in memory, register them with the evidence secret set, and never write them to the resource file.
- [ ] Implement browser identity bootstrap through the visible join flow. Read only the non-secret participant ID for fixture mapping, remove `?host=` with `history.replaceState`, and start trace collection only after the sensitive POST/navigation has completed.
- [ ] Implement `FixtureRuntime.seedRoom` with `createInitialRoomState`, `claimSeat`, `startHand`, `LiveRoomStore`, and the extracted Redis adapter against the isolated Redis URL. Fixture setup may establish the starting state but all scenario actions and outcomes must still travel through the UI/WebSocket path.
- [ ] Implement exact run-resource recording with room ID, participant IDs, target environment, and ownership marker names `SITE-<runId>-<role>`; omit every token and credential.
- [ ] Rerun the focused fixture tests and `npm run typecheck`.
- [ ] Commit with `git add tests/experience/fixtures && git commit -m "test: add deterministic poker experience fixtures"`.

## Task 6: Add multi-actor instrumentation, page objects, and mechanical UX assertions

**Files:**

- Create: `tests/experience/support/telemetry.ts`
- Create: `tests/experience/support/actor-pool.ts`
- Create: `tests/experience/support/experience-test.ts`
- Create: `tests/experience/support/run-case.ts`
- Create: `tests/experience/page-objects/create-room-page.ts`
- Create: `tests/experience/page-objects/room-page.ts`
- Create: `tests/experience/assertions/synchronization.ts`
- Create: `tests/experience/assertions/timing.ts`
- Create: `tests/experience/assertions/layout.ts`
- Create: `tests/experience/assertions/accounting.ts`
- Create: `tests/experience/assertions/privacy.ts`
- Create: `tests/experience/assertions/assertions.test.ts`
- Modify: `src/components/table/PokerTable.tsx`
- Modify: `src/components/table/SeatRing.tsx`
- Modify: `src/components/table/ActionControls.tsx`
- Modify: `src/components/table/HandResultPanel.tsx`
- Modify: `src/components/table/SessionResultPanel.tsx`
- Modify: `tests/table/poker-table.test.ts`
- Modify: `tests/table/action-controls.test.ts`

- [ ] Add failing pure-function tests for synchronized view projections, `800ms/1000ms/3000ms` boundary decisions, `±400ms` phase timing, `44x44` hit boxes, viewport overflow, center-point hit testing, chip conservation, net accounting, and private-card visibility classification.
- [ ] Extend component tests to require stable non-secret observability attributes: table flow phase/sequence/hand number; board card count; seat number/participant/status/local marker; action type; pending top-up; hand-result hand number; and session-result state.
- [ ] Run `npm test -- tests/experience/assertions/assertions.test.ts tests/table/poker-table.test.ts tests/table/action-controls.test.ts` and observe the missing helpers/attributes.
- [ ] Add only semantic `data-*` attributes; do not add test-only buttons, state mutation hooks, tokens, or alternate behavior.
- [ ] Implement a pre-navigation telemetry init script that projects WebSocket messages into safe fields (`type`, phase, sequence, hand, street, board length, pot, actor, private-card key present) and never retains the raw frame. Capture console error, page error, request failure, WebSocket close, DOM checkpoint, and monotonic/wall time.
- [ ] Implement `ActorPool` for host, four-to-six players, and spectator contexts. Each actor owns a context, page, manual trace, video directory, screenshot namespace, and role metadata; `closeAll` must stop every trace even after a failure.
- [ ] Implement page objects around accessible roles/names plus the semantic attributes. Include `join`, `claimSeat`, `openHostControls`, `startRoom`, `performAction`, `queueTopUp`, `requestRoomEnd`, `waitForPhase`, `readProjection`, and `captureCheckpoint`.
- [ ] Implement `runExperienceCase` so declared real-time cases always preserve attempt 1, execute attempt 2 as a separate fixture, and throw only after both attempt reports are durable. Unexpected Playwright/runtime errors classify the harness as inconclusive; `ProductAssertionError` classifies only the failed product assertion.
- [ ] Implement the mechanical assertions and ensure failure messages include case, attempt, actor, earliest divergent projection, measured value, threshold, and artifact IDs.
- [ ] Rerun the focused tests and `npm run typecheck`.
- [ ] Commit with `git add tests/experience/support tests/experience/page-objects tests/experience/assertions src/components/table tests/table && git commit -m "test: instrument multi-actor poker journeys"`.

## Task 7: Wire the isolated on-demand runner and dedicated Playwright configuration

**Files:**

- Create: `scripts/run-full-site-test.ts`
- Create: `scripts/site-test/playwright-group.ts`
- Create: `playwright.experience.config.ts`
- Create: `tests/scripts/run-full-site-test.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Add failing runner tests for stage order, case filtering, a hard 30-minute deadline, isolated-failure smoke skip, partial-evidence finalization, normal `PASS`, injected product `FAIL`, injected environment `INCONCLUSIVE`, evidence validation before cleanup, and cleanup only after report durability.
- [ ] Run `npm test -- tests/scripts/run-full-site-test.test.ts` and verify it fails because the runner modules do not exist.
- [ ] Configure Playwright with `testDir: tests/experience/scenarios`, Chromium only, `workers: 1`, `retries: 0`, manual per-actor context traces/videos, a line reporter, and run-scoped standard output under `outputs/site-test/<runId>/diagnostics/playwright`.
- [ ] Implement `runPlaywrightGroup` with explicit case IDs and environment variables for run ID, output root, isolated base URL, Redis URL, database URL, and smoke base URL. Preserve stdout/stderr and never interpolate an argument through a shell.
- [ ] Implement the runner stages: allocate run/write metadata; inspect image; start isolated stack; preflight app/PostgreSQL/Redis; run selected isolated cases; validate isolated evidence; run EXP-010 only when selected and every selected isolated case passed; aggregate reports; validate final evidence; persist diagnostics; clean exact resources; update cleanup status; and return exit `0` for `PASS`, `1` for `FAIL`, or `2` for `INCONCLUSIVE`.
- [ ] Support `--cases=EXP-001,EXP-002` for focused TDD runs. With no filter, select EXP-001 through EXP-010. A filtered run omitting EXP-010 must not touch the deployed stack.
- [ ] Add private harness-verification flags `--inject-product-failure=EXP-001/A-001` and `--inject-environment-failure=postgres-health`. The product injection creates a recorded failed assertion plus artifact; the environment injection fails preflight, skips all browsers/smoke, and preserves Docker diagnostics.
- [ ] Add `"test:site": "tsx scripts/run-full-site-test.ts"` and ignore `outputs/site-test/` plus temporary run env files. Do not add an automatic invocation.
- [ ] Rerun the focused tests and `npm run typecheck`.
- [ ] Commit with `git add .gitignore package.json package-lock.json scripts/run-full-site-test.ts scripts/site-test/playwright-group.ts playwright.experience.config.ts tests/scripts/run-full-site-test.test.ts && git commit -m "test: wire isolated site experience runner"`.

## Task 8: Implement EXP-001 through EXP-003 for room, seating, and normal betting

**Files:**

- Create: `tests/experience/scenarios/room-seating-betting.spec.ts`

- [ ] Write EXP-001 first and run `npm run test:site -- --cases=EXP-001`; verify the initial case report records the first unimplemented product assertion before completing the scenario body.
- [ ] Drive cash-room creation through `/create`, assert host/invite links, join a player and spectator through visible controls, verify host controls exist only for the host, and use a disposable raw WebSocket client to prove forged host and participant authority returns the expected coded error without leaking state.
- [ ] Implement EXP-002 for 2-, 6-, and 9-seat rooms. Assert seat order, occupied/empty comprehension, and that the local seat's center is bottom-most and horizontally centered within 10% of the table center. With one seated player, assert start is disabled and the visible explanation says at least two funded players are required.
- [ ] Implement EXP-003 from the declared normal-betting action plan. After every click, require local feedback within `800ms` and all actor views to converge within `1000ms` on hand, street, board, pot, actor, and committed amounts. Assert only context-valid primary actions are enabled.
- [ ] Run `npm run test:site -- --cases=EXP-001,EXP-002,EXP-003` from clean isolated room fixtures and inspect one desktop video, trace, screenshot, and event timeline from each case. The catalog makes EXP-003 execute two declared attempts.
- [ ] Run `npm test -- tests/experience` and fix only harness defects revealed by the new cases; do not weaken a product assertion to make the scenario green.
- [ ] Commit with `git add tests/experience/scenarios/room-seating-betting.spec.ts && git commit -m "test: cover room seating and betting experience"`.

## Task 9: Implement EXP-004 through EXP-007 for cinematic runout, pots, top-ups, and accounting

**Files:**

- Create: `tests/experience/scenarios/cinematic-accounting.spec.ts`

- [ ] Implement EXP-004 with four independent player contexts executing all-in actions. Record first visible frames for showdown and each board-length mutation; assert intervals `2000, 1000, 1000, 2000, 2000ms` within `±400ms`, board length increases by exactly one, no action remains enabled, and settlement appears only after five cards.
- [ ] Add a mutation-frame assertion that fails if board length jumps by more than one or multiple remaining cards appear in one rendered animation frame. Run only EXP-004 and confirm a full timeline is emitted even if a timing assertion fails.
- [ ] Implement EXP-005 with the explicit `400/300/200` side-pot oracle and the `100/100` split oracle. Assert folded players receive zero, every visible award matches the independent fixture expectation, and ending stacks conserve chips.
- [ ] Implement EXP-006 by opening the persistent lower-left add-chips control while chips remain, submitting `300` and then `200`, asserting local `Pending +500`, two room-wide notifications, unchanged current-hand stack, and one exact `500` application at the next hand boundary.
- [ ] Implement EXP-007 by verifying every player's start/end/signed net row, hand-result visibility for `2000±400ms`, end-room request during a live hand, completion of that hand before session end, and persistent final rows satisfying `net = final - initial - applied top-ups`.
- [ ] Run `npm run test:site -- --cases=EXP-004,EXP-005,EXP-006,EXP-007` and inspect event timelines rather than relying on final screenshots for animation assertions.
- [ ] Run the evidence validator against the generated run directory and confirm no host/participant token or full private-card payload appears in JSON, HTML, logs, or decompressed traces.
- [ ] Commit with `git add tests/experience/scenarios/cinematic-accounting.spec.ts && git commit -m "test: cover cinematic runout and chip accounting"`.

## Task 10: Implement EXP-008 and EXP-009 for reconnect and mobile experience

**Files:**

- Create: `tests/experience/scenarios/recovery-mobile.spec.ts`

- [ ] Implement EXP-008 as separate acting-player, host, and spectator disconnect cases. Close the actor socket/context, use the real host disconnect control when applicable, reconnect both before and after a presentation deadline, and compare flow sequences and action IDs before/after recovery.
- [ ] Assert recovery never duplicates an action/result, skips a phase, rewinds a board, exposes a future card, or gives spectator/private-card visibility. Require an explanatory paused/reconnecting state within `800ms` and no unexplained dead state longer than `3000ms`.
- [ ] Implement EXP-009 in Chromium contexts with viewport `390x844`, touch enabled, and mobile user agent. Repeat join, seat, betting, top-up, host controls, all-in presentation, hand result, and final result.
- [ ] At every mobile checkpoint, assert no horizontal overflow, required controls are inside the viewport or their documented scroll container, enabled required controls have at least `44x44` CSS-pixel hit areas, center-point hit tests reach the intended control, and interactive layers do not cover cards, bets, stacks, names, or result panels.
- [ ] Capture stable visual baselines only for lobby, active betting, top-up open, hand result, and session result. Mask clocks/transient toast text and use geometry/timeline assertions for animation.
- [ ] Run `npm run test:site -- --cases=EXP-008,EXP-009` from fresh fixtures and inspect both declared EXP-008 attempt artifacts.
- [ ] Commit with `git add tests/experience/scenarios/recovery-mobile.spec.ts tests/experience/scenarios/recovery-mobile.spec.ts-snapshots && git commit -m "test: cover reconnect and mobile poker journeys"`.

## Task 11: Implement EXP-010 production smoke and ownership-proven cleanup

**Files:**

- Create: `tests/experience/scenarios/production-smoke.spec.ts`
- Create: `scripts/site-test/production-smoke.ts`
- Create: `tests/scripts/production-smoke.test.ts`

- [ ] Add failing tests that identify exactly one running container with Compose labels `project=texas-holdem` and `service=app`, reject zero/multiple matches, verify its health and image ID, and build an exact `docker exec` cleanup command without shell interpolation.
- [ ] Run `npm test -- tests/scripts/production-smoke.test.ts` and observe missing-module failures.
- [ ] Implement EXP-010 against `SITE_TEST_SMOKE_URL`: health, home, create page, UI room creation, host/invite link navigation, player join, seat claim, spectator join, and one ordinary host/player WebSocket operation. Do not seed Redis or call internal fixture builders.
- [ ] Record the exact production room ID and `SITE-<runId>-smoke-player` ownership marker before any action that could fail. Do not record host or participant credentials.
- [ ] Implement container discovery through Docker labels and invoke `src/server/site-test-cleanup.ts` inside the exact healthy app container with argument arrays and `SITE_TEST_CLEANUP_ALLOWED=1`.
- [ ] If the deployed image lacks the cleanup CLI or ownership proof fails, retain the room, add its exact ID to `report.json`, and classify cleanup as an environment/harness issue; do not turn a proven smoke product failure into a pass.
- [ ] Rerun the focused unit test. Execute EXP-010 against a disposable local deployment and query the exact room afterward to prove it alone was removed.
- [ ] Commit with `git add tests/experience/scenarios/production-smoke.spec.ts scripts/site-test/production-smoke.ts tests/scripts/production-smoke.test.ts && git commit -m "test: add deployed poker smoke journey"`.

## Task 12: Complete integration, documentation, fault checks, and final verification

**Files:**

- Create: `docs/site-experience-testing.md`
- Modify: `scripts/run-full-site-test.ts`
- Modify: `playwright.experience.config.ts`
- Modify: `tests/scripts/run-full-site-test.test.ts`
- Modify: `package.json`
- Modify: `docs/qa-test-checklist.md`
- Modify: `.gitignore`

- [ ] Extend the runner tests so the real production-smoke executor is invoked only after isolated `PASS`, its exact room record is available to cleanup even after a browser failure, and retained-room cleanup changes the harness/environment plane to inconclusive without erasing an already proven product assertion.
- [ ] Rerun `npm test -- tests/scripts/run-full-site-test.test.ts tests/scripts/production-smoke.test.ts` and fix integration boundaries without weakening verdict rules.
- [ ] Confirm the final Playwright configuration discovers all ten cases exactly once and that only catalog-declared cases run a second attempt.
- [ ] Update the QA checklist to replace busted-only/modal rebuy wording with persistent lower-left cumulative next-hand top-up behavior, add per-hand/final accounting and cinematic timing checks, and identify `npm run test:site` as the explicit full-site command.
- [ ] Document prerequisites, 20–30 minute expectation, environment variables, exit codes, artifact layout, safe cleanup behavior, trace opening, and failure triage. Include exact commands for normal and both injected-verdict checks.
- [ ] Rerun the focused runner tests, then run `npm run typecheck`, `npm test`, `npm run test:e2e`, `LONG_RUN_SECONDS=600 ACTION_DELAY_MS=0 npm run test:long-run`, and `npm run build`.
- [ ] Run `npm run test:site -- --inject-product-failure=EXP-001/A-001`; verify exit `1`, overall `FAIL`, a product-plane assertion, and usable screenshot/events without secrets.
- [ ] Run `npm run test:site -- --inject-environment-failure=postgres-health`; verify exit `2`, overall `INCONCLUSIVE`, environment diagnostics, no production smoke, and exact isolated cleanup.
- [ ] Run the complete `npm run test:site`; verify it completes within 30 minutes, EXP-001 through EXP-010 are present, desktop/mobile evidence exists, the final evidence validator passes, and only run-scoped resources were removed.
- [ ] Search for unfinished text with `rg -n "TODO|TBD|placeholder|implement later|coming soon" scripts tests/experience playwright.experience.config.ts docs/site-experience-testing.md docs/qa-test-checklist.md`; resolve every hit that represents unfinished work.
- [ ] Commit with `git add .gitignore package.json package-lock.json scripts/run-full-site-test.ts playwright.experience.config.ts tests/scripts/run-full-site-test.test.ts docs/site-experience-testing.md docs/qa-test-checklist.md && git commit -m "test: finish on-demand full-site experience acceptance"`.

## Final Review Gate

- [ ] Compare every section of `docs/superpowers/specs/2026-07-17-full-site-experience-testing-design.md` against the implementation and record a passing mapping for EXP-001 through EXP-010, every mechanical gate, the evidence layout, three-plane verdicts, and cleanup rules.
- [ ] Verify the implementation adds no public route, test token, scheduler, commit hook, load generator, broad delete, production restart, or secret-bearing artifact.
- [ ] Open `report.html`, one desktop trace/video, one mobile trace/video, a four-way runout event timeline, and both injected-failure reports. Confirm the artifacts explain the earliest divergence without needing console archaeology.
- [ ] Run `git status --short` and ensure only intentional files are committed while `.superpowers/` remains untouched and untracked.
