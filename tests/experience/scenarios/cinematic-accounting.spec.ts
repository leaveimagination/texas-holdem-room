import { mkdir, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { test, type Browser, type Page } from "@playwright/test";

import { assertChipConservation, assertSessionNetAccounting } from "../assertions/accounting";
import { assertTimedPhaseDuration } from "../assertions/timing";
import { EXPERIENCE_CASES } from "../case-catalog";
import type { ArtifactRecord, EvidenceEvent } from "../evidence/contracts";
import { EvidenceRecorder, type FinishCaseInput } from "../evidence/recorder";
import { ExperienceApiClient, bootstrapBrowserIdentity } from "../fixtures/api-client";
import { buildFourPlayerAllInFixture, buildSidePotFixture, buildSplitPotFixture, buildTopUpAccountingFixture } from "../fixtures/builders";
import { consumeFixtureSeedBrokerForPlaywrightWorker, seedFixtureThroughBroker, type SeedFixtureDescriptor } from "../fixtures/seed-broker-client";
import type { FixturePlayerAction, KnownSecretRegistry, PokerFixture } from "../fixtures/types";
import { RoomPage } from "../page-objects/room-page";
import { ActorPool, type ActorHandle } from "../support/actor-pool";
import { settleBrowserMonitors, type BrowserMonitor } from "../support/browser-monitor";
import { ProductAssertionError, assertProductCondition, observeProduct } from "../support/experience-test";
import { runExperienceCase, type AttemptCoordinates } from "../support/run-case";
import type { TelemetryEvent } from "../support/telemetry";

const BROKER = consumeFixtureSeedBrokerForPlaywrightWorker();
const ASSERTIONS = {
  "EXP-004": ["EXP-004-A01", "EXP-004-A02", "EXP-004-A03", "EXP-004-A04", "EXP-004-A05"],
  "EXP-005": ["EXP-005-A01", "EXP-005-A02", "EXP-005-A03", "EXP-005-A04", "EXP-005-A05"],
  "EXP-006": ["EXP-006-A01", "EXP-006-A02", "EXP-006-A03", "EXP-006-A04", "EXP-006-A05"],
  "EXP-007": ["EXP-007-A01", "EXP-007-A02", "EXP-007-A03", "EXP-007-A04"]
} as const;

test("EXP-004 renders a four-way all-in as a complete cinematic timeline", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-004"));
  await runCase(browser, "EXP-004", async ({ fixture: f, coordinates }) => {
    const fixture = buildFourPlayerAllInFixture({ runId: env().runId, participantIds: placeholderIds(["aces", "kings", "queens", "jacks"]) });
    const room = await provision(f, fixture, ["aces", "kings", "queens", "jacks"], coordinates, "EXP-004-A01");
    const spectator = f.pool.get("spectator");
    f.evidenceActor = spectator;
    for (const action of fixture.actionPlan.slice(0, -1)) await perform(room.pages[action.actorRole], action);
    const timelineMonitor = await startRunoutTimeline(spectator.page);
    const actionMonitors = await Promise.all(["player-1", "player-2", "player-3", "player-4"].map((id) => startRunoutActionMonitor(f.pool.get(id).page)));
    let timeline: Frame[];
    let playerActionMaxima: number[];
    try {
      const finalAction = fixture.actionPlan.at(-1)!;
      await perform(room.pages[finalAction.actorRole], finalAction);
      timeline = await expected(timelineMonitor.result, coordinates, "EXP-004-A03", "spectator", "complete runout timeline");
      playerActionMaxima = await Promise.all(actionMonitors.map((monitor) => expected(monitor.result, coordinates, "EXP-004-A04", "all-players", "disabled actions through settlement")));
    } finally {
      await settleBrowserMonitors([timelineMonitor, ...actionMonitors]);
    }
    await f.recorder.recordEvent({ stage: "EXP-004-timeline", type: "rendered-frame-timeline", status: "observed", details: { timeline } });

    const counts = timeline.filter((entry) => entry.kind === "board").map((entry) => entry.boardLength);
    const exactMutations = counts.length === 5 && counts.every((count, index) => count === index + 1);
    product(exactMutations, coordinates, "EXP-004-A02", "spectator", counts, [1, 2, 3, 4, 5]);
    await pass(f, "EXP-004-A02", { counts });
    const showdown = timeline.find((entry) => entry.kind === "showdown");
    product(Boolean(showdown) && (timeline.find((entry) => entry.kind === "board")?.at ?? 0) > (showdown?.at ?? Infinity), coordinates, "EXP-004-A01", "spectator", timeline, "showdown before board");
    await pass(f, "EXP-004-A01", { showdown });
    const marks = [showdown, ...timeline.filter((entry) => entry.kind === "board"), timeline.find((entry) => entry.kind === "settlement")].filter(Boolean) as Frame[];
    const intervals = marks.slice(1).map((mark, index) => mark.at - marks[index].at);
    [2000, 1000, 1000, 2000, 2000].forEach((expected, index) => assertTimedPhaseDuration(intervals[index], expected, mechanical(coordinates, "EXP-004-A03", "spectator"), { timeline }));
    await pass(f, "EXP-004-A03", { intervals });
    product(playerActionMaxima.every((count) => count === 0), coordinates, "EXP-004-A04", "all-players", playerActionMaxima, [0, 0, 0, 0]);
    await pass(f, "EXP-004-A04", { playerActionMaxima });
    const settlement = timeline.find((entry) => entry.kind === "settlement");
    product(settlement?.boardLength === 5, coordinates, "EXP-004-A05", "spectator", settlement, { boardLength: 5 });
    await pass(f, "EXP-004-A05", { settlement });
    await capture(f, spectator, "cinematic-settlement");
    return finish(f, "EXP-004");
  });
});

test("EXP-005 matches independent side-pot and split-pot oracles", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-005"));
  await runCase(browser, "EXP-005", async ({ fixture: f, coordinates }) => {
    const side = buildSidePotFixture({ runId: env().runId, participantIds: placeholderIds(["aces", "kings", "queens", "jacks"]) });
    const sideRoom = await provision(f, side, ["aces", "kings", "queens", "jacks"], coordinates, "EXP-005-A01");
    for (const action of side.actionPlan) await perform(sideRoom.pages[action.actorRole], action);
    const sideResult = await expected(readHandResult(f.pool.get("spectator").page), coordinates, "EXP-005-A01", "spectator", "side-pot hand result");
    const pots = sideResult.pots.map((pot) => pot.amount);
    product(JSON.stringify(pots) === JSON.stringify([400, 300, 200]), coordinates, "EXP-005-A01", "spectator", pots, [400, 300, 200]);
    await pass(f, "EXP-005-A01", { pots });
    const awards = awardsByName(sideResult);
    const expectedAwards = Object.fromEntries(side.participants.map((p) => [p.displayName, side.oracle.totalAwardsByRole[p.role]]));
    product(JSON.stringify(awards) === JSON.stringify(expectedAwards), coordinates, "EXP-005-A02", "spectator", awards, expectedAwards);
    await pass(f, "EXP-005-A02", { awards });
    product(awards[side.participants.find((p) => p.role === "jacks")!.displayName] === 0, coordinates, "EXP-005-A03", "spectator", awards, { jacks: 0 });
    await pass(f, "EXP-005-A03", { foldedAward: 0 });
    assertChipConservation({ startingChips: side.participants.map((p) => p.startingChips), appliedTopUps: [], endingChips: sideResult.players.map((p) => p.end) }, mechanical(coordinates, "EXP-005-A05", "spectator"));

    const split = buildSplitPotFixture({ runId: env().runId, participantIds: placeholderIds(["left", "right"]) });
    const splitRoom = await provision(f, split, ["left", "right"], coordinates, "EXP-005-A04");
    for (const action of split.actionPlan) await perform(splitRoom.pages[action.actorRole], action);
    const splitResult = await expected(readHandResult(f.pool.get("spectator").page), coordinates, "EXP-005-A04", "spectator", "split-pot hand result");
    const splitAwards = Object.values(awardsByName(splitResult)).sort((a, b) => a - b);
    product(JSON.stringify(splitAwards) === JSON.stringify([100, 100]), coordinates, "EXP-005-A04", "spectator", splitAwards, [100, 100]);
    await pass(f, "EXP-005-A04", { splitAwards });
    assertChipConservation({ startingChips: split.participants.map((p) => p.startingChips), appliedTopUps: [], endingChips: splitResult.players.map((p) => p.end) }, mechanical(coordinates, "EXP-005-A05", "spectator"));
    await pass(f, "EXP-005-A05", { sideTotal: 900, splitTotal: 200 });
    await capture(f, f.pool.get("spectator"), "split-pot-result");
    return finish(f, "EXP-005");
  });
});

test("EXP-006 accumulates queued chips and applies them once at the next hand", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-006"));
  await runCase(browser, "EXP-006", async ({ fixture: f, coordinates }) => {
    const oracle = buildTopUpAccountingFixture({ runId: env().runId, participantIds: placeholderIds(["target", "opponent"]) });
    const room = await provision(f, oracle, ["target", "opponent"], coordinates, "EXP-006-A04");
    const target = f.pool.get("player-1");
    const before = await stackFor(target.page, room.ids.target);
    product(before === oracle.oracle.currentHandTargetStackBeforeQueue, coordinates, "EXP-006-A04", "target", before, oracle.oracle.currentHandTargetStackBeforeQueue);
    const box = await target.page.locator('[data-control-panel="top-up"]').boundingBox();
    product(Boolean(box) && box!.x < target.page.viewportSize()!.width / 2 && box!.y > target.page.viewportSize()!.height / 2, coordinates, "EXP-006-A01", "target", box, "persistent lower-left control");
    await pass(f, "EXP-006-A01", { box });
    const notificationPages = [target.page, f.pool.get("player-2").page, f.pool.get("spectator").page];
    await room.pages.target.queueTopUp(300);
    const observedNotifications = [await Promise.all(notificationPages.map(async (page) => { await expected(page.getByText(/queued 300 chips/).waitFor({ state: "visible", timeout: 8_000 }), coordinates, "EXP-006-A03", "room", "300-chip notification"); return 300; }))];
    await room.pages.target.queueTopUp(200);
    observedNotifications.push(await Promise.all(notificationPages.map(async (page) => { await expected(page.getByText(/queued 200 chips/).waitFor({ state: "visible", timeout: 8_000 }), coordinates, "EXP-006-A03", "room", "200-chip notification"); return 200; })));
    await expected(target.page.locator('[data-pending-top-up="500"]').waitFor({ state: "visible", timeout: 8_000 }), coordinates, "EXP-006-A02", "target", "pending total 500");
    await pass(f, "EXP-006-A02", { pending: 500 });
    product(JSON.stringify(observedNotifications) === JSON.stringify([[300, 300, 300], [200, 200, 200]]), coordinates, "EXP-006-A03", "room", observedNotifications, [[300, 300, 300], [200, 200, 200]]);
    await pass(f, "EXP-006-A03", { observedNotifications });
    const queued = await stackFor(target.page, room.ids.target);
    product(queued === oracle.oracle.currentHandTargetStackAfterQueue, coordinates, "EXP-006-A04", "target", queued, oracle.oracle.currentHandTargetStackAfterQueue);
    await pass(f, "EXP-006-A04", { before, queued });
    await room.pages.target.performAction("fold");
    const settled = await expected(readHandResult(target.page), coordinates, "EXP-006-A05", "target", "hand-one result");
    const settledTarget = settled.players.find((player) => player.name === room.names.target);
    product(Boolean(settledTarget) && settledTarget!.end - queued === oracle.oracle.handOneTargetSettlementDelta, coordinates, "EXP-006-A05", "target", { endingStack: settledTarget?.end, queued }, { settlementDelta: oracle.oracle.handOneTargetSettlementDelta });
    await expected(target.page.locator('[aria-label="Table"][data-flow-phase="betting"][data-hand-number="2"]').waitFor({ state: "visible", timeout: 8_000 }), coordinates, "EXP-006-A05", "target", "hand two betting");
    const next = await stackFor(target.page, room.ids.target);
    const nextCommitted = await committedFor(target.page, room.ids.target);
    const applied = next + nextCommitted - queued;
    product(next === oracle.oracle.handTwoTargetStackAfterBlind && nextCommitted === oracle.oracle.handTwoTargetBlind && applied === oracle.oracle.appliedTopUpChips && await target.page.locator('[data-pending-top-up="0"]').count() === 1, coordinates, "EXP-006-A05", "target", { handOnePostBlind: before, handOneEnding: settledTarget?.end, handOneSettlementDelta: (settledTarget?.end ?? NaN) - queued, handTwoStackAfterBlind: next, handTwoBlind: nextCommitted, applied }, { handOnePostBlind: oracle.oracle.currentHandTargetStackBeforeQueue, handOneSettlementDelta: oracle.oracle.handOneTargetSettlementDelta, handTwoStackAfterBlind: oracle.oracle.handTwoTargetStackAfterBlind, handTwoBlind: oracle.oracle.handTwoTargetBlind, applied: oracle.oracle.appliedTopUpChips, pending: 0 });
    await room.pages.opponent.performAction("fold");
    await expected(target.page.locator('[aria-label="Table"][data-flow-phase="betting"][data-hand-number="3"]').waitFor({ state: "visible", timeout: 10_000 }), coordinates, "EXP-006-A05", "target", "third hand boundary without duplicate top-up");
    const handThreeStack = await stackFor(target.page, room.ids.target);
    const handThreeCommitted = await committedFor(target.page, room.ids.target);
    const pendingAtHandThree = await target.page.locator('[data-pending-top-up="0"]').count();
    product(handThreeStack + handThreeCommitted === oracle.oracle.nextHandTargetCumulativeBuyIn && pendingAtHandThree === 1, coordinates, "EXP-006-A05", "target", { handThreeStack, handThreeCommitted, pendingAtHandThree }, { cumulativeBuyIn: 1_500, pending: 0, applicationCount: 1 });
    await pass(f, "EXP-006-A05", { applied: 500, applicationCount: 1 });
    await capture(f, target, "top-up-applied");
    return finish(f, "EXP-006");
  });
});

test("EXP-007 preserves hand and session accounting through a live-hand end request", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-007"));
  await runCase(browser, "EXP-007", async ({ fixture: f, coordinates }) => {
    const oracle = buildTopUpAccountingFixture({ runId: env().runId, participantIds: placeholderIds(["target", "opponent"]) });
    const room = await provision(f, oracle, ["target", "opponent"], coordinates, "EXP-007-A01");
    await room.pages.target.queueTopUp(300); await room.pages.target.queueTopUp(200); const handResultPromise = watchHandResult(f.pool.get("spectator").page); await room.pages.target.performAction("fold");
    const handOne = await expected(handResultPromise, coordinates, "EXP-007-A01", "spectator", "hand-one result and dismissal");
    const actualHandRows = handOne.result.players.map((row) => ({ name: row.name, startChips: row.start, endChips: row.end, netChips: row.netChips })).sort((a, b) => a.name.localeCompare(b.name));
    const expectedHandRows = oracle.oracle.handResults[0].rows.map((row) => ({ name: room.names[row.role], startChips: row.startChips, endChips: row.endChips, netChips: row.netChips })).sort((a, b) => a.name.localeCompare(b.name));
    product(JSON.stringify(actualHandRows) === JSON.stringify(expectedHandRows), coordinates, "EXP-007-A01", "spectator", actualHandRows, expectedHandRows);
    await pass(f, "EXP-007-A01", { players: handOne.result.players });
    assertTimedPhaseDuration(handOne.visibleMs, 2000, mechanical(coordinates, "EXP-007-A02", "spectator"));
    await pass(f, "EXP-007-A02", { visibleMs: handOne.visibleMs });
    await expected(f.pool.get("host").page.locator('[aria-label="Table"][data-flow-phase="betting"][data-hand-number="2"]').waitFor({ state: "visible", timeout: 8_000 }), coordinates, "EXP-007-A03", "host", "live hand two");
    await room.pages.host.requestRoomEnd();
    product((await room.pages.host.readProjection()).handNumber === 2, coordinates, "EXP-007-A03", "host", await room.pages.host.readProjection(), "live hand remains active");
    await room.pages.opponent.performAction("fold");
    await expected(room.pages.host.waitForPhase("session-summary", { timeout: 8_000 }), coordinates, "EXP-007-A03", "host", "session summary after live hand");
    await pass(f, "EXP-007-A03", { completedHand: 2, then: "session-summary" });
    const rows = await readSessionRows(f.pool.get("spectator").page);
    const expectedRows = oracle.oracle.finalRows.map((row) => ({ name: room.names[row.role], initialChips: row.initialChips, appliedTopUpChips: row.topUpChips, finalChips: row.finalChips, netChips: row.netChips })).sort((a, b) => a.name.localeCompare(b.name));
    const sortedRows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    product(JSON.stringify(sortedRows) === JSON.stringify(expectedRows), coordinates, "EXP-007-A04", "spectator", sortedRows, expectedRows);
    for (const row of sortedRows) assertSessionNetAccounting(row, mechanical(coordinates, "EXP-007-A04", row.name));
    await delay(500);
    product(JSON.stringify(await readSessionRows(f.pool.get("spectator").page)) === JSON.stringify(rows), coordinates, "EXP-007-A04", "spectator", rows, "persistent rows");
    await pass(f, "EXP-007-A04", { rows });
    await capture(f, f.pool.get("spectator"), "session-accounting");
    return finish(f, "EXP-007");
  });
});

type CaseId = keyof typeof ASSERTIONS;
interface Env { runId: string; baseUrl: string; outputRoot: string; caseOutputRoot: string; broker: NonNullable<typeof BROKER> }
interface Fx { pool: ActorPool; recorder: EvidenceRecorder; outputRoot: string; events: Map<string, EvidenceEvent[]>; evidenceActor: ActorHandle | null; secrets: Secrets }
class Secrets implements KnownSecretRegistry { values: string[] = []; add(v: string | Uint8Array) { const s = typeof v === "string" ? v : Buffer.from(v).toString(); if (s && !this.values.includes(s)) this.values.push(s); } }

async function runCase(browser: Browser, caseId: CaseId, execute: (input: { fixture: Fx; coordinates: AttemptCoordinates }) => Promise<FinishCaseInput>) {
  const e = env(); const recorders = new Map<string, EvidenceRecorder>(); const secrets = new Secrets(); secrets.add(e.broker.authorizationToken);
  await runExperienceCase({ runId: e.runId, caseId, recorderFactory(c) { const r = recorder(e, c, secrets.values); recorders.set(`${c.caseId}/${c.attemptId}`, r); return r; },
    async createFixture(c): Promise<Fx> { const outputRoot = join(e.outputRoot, "cases", c.caseId, c.attemptId); const r = recorders.get(`${c.caseId}/${c.attemptId}`)!; const pool = new ActorPool({ browser, outputRoot, telemetrySink: async (event) => recordTelemetry(r, event) }); await pool.createActors({ playerCount: 4, includeSpectator: true }); return { pool, recorder: r, outputRoot, events: new Map(), evidenceActor: null, secrets }; },
    async execute({ runId, caseId, attemptId, fixture }) { return await execute({ fixture, coordinates: { runId, caseId, attemptId } }); },
    async disposeFixture(f) { const actor = f.evidenceActor; const prefix = artifactPrefix(e.outputRoot, f.outputRoot); await f.pool.closeAll(); if (actor) { if (await isFile(actor.tracePath)) await f.recorder.recordArtifact({ id: `${prefix}-${actor.metadata.id}-trace`, path: artifactPath(e.outputRoot, actor.tracePath), description: "Tokenless spectator trace", kind: "trace", mediaType: "application/zip", required: true }); const video = (await readdir(actor.videoDirectory).catch(() => [])).find((name) => name.endsWith(".webm")); if (video) await f.recorder.recordArtifact({ id: `${prefix}-${actor.metadata.id}-video`, path: artifactPath(e.outputRoot, join(actor.videoDirectory, video)), description: "Spectator journey video", kind: "video", mediaType: "video/webm", required: true }); } }, async persistFallbackReport(c, input) { return await recorder(e, c, secrets.values).finishCase(input); } });
}

async function provision<Role extends string>(f: Fx, poker: PokerFixture<Role, any, any>, roles: readonly Role[], coordinates: AttemptCoordinates, assertionId: string) {
  const e = env(); const api = new ExperienceApiClient({ baseUrl: e.baseUrl, knownSecrets: f.secrets }); const created = await api.createRoom(poker.settings); f.secrets.add(created.hostToken);
  const pages = {} as Record<Role | "host", RoomPage>; const names = {} as Record<Role, string>; const ids = {} as Record<Role, string>;
  for (const [index, role] of roles.entries()) { const actor = f.pool.get(`player-${index + 1}`); const identity = await bootstrapBrowserIdentity({ page: actor.page, baseUrl: e.baseUrl, roomId: created.roomId, role, displayName: owner(e.runId, role), knownSecrets: f.secrets }); pages[role] = roomPage(actor); names[role] = identity.displayName; ids[role] = identity.participantId; }
  const host = f.pool.get("host"); await bootstrapBrowserIdentity({ page: host.page, baseUrl: e.baseUrl, roomId: created.roomId, role: "host", displayName: owner(e.runId, "host"), hostToken: created.hostToken, knownSecrets: f.secrets }); pages.host = roomPage(host);
  const descriptor = { kind: poker.id, participantIds: ids } as SeedFixtureDescriptor; await seedFixtureThroughBroker({ broker: e.broker, runId: e.runId, roomId: created.roomId, fixture: descriptor });
  for (const [index, role] of roles.entries()) { const actor = f.pool.get(`player-${index + 1}`); await actor.page.reload(); pages[role] = roomPage(actor); await pages[role].join(names[role]); await actor.page.getByRole("dialog", { name: "Join flow" }).waitFor({ state: "hidden" }); }
  await host.page.goto(new URL(`/room/${encodeURIComponent(created.roomId)}?host=${encodeURIComponent(created.hostToken)}`, e.baseUrl).toString()); pages.host = roomPage(host); await pages.host.join(owner(e.runId, "host")); await host.page.getByRole("dialog", { name: "Join flow" }).waitFor({ state: "hidden" }); await host.page.evaluate(() => history.replaceState(null, "", location.pathname));
  const spectator = f.pool.get("spectator"); await spectator.page.goto(created.inviteUrl); await roomPage(spectator).join("Spectator", "spectator"); await spectator.page.getByRole("dialog", { name: "Join flow" }).waitFor({ state: "hidden" }); if (!f.evidenceActor) await f.pool.startTraceAfterBootstrap("spectator", { traceReady: true }); f.evidenceActor = spectator;
  await expected(roomPage(spectator).waitForPhase("betting", { timeout: 8_000 }), coordinates, assertionId, "spectator", "seeded betting projection"); return { pages, names, ids };
}

interface Frame { kind: "showdown" | "board" | "settlement"; at: number; boardLength: number; enabledActions: number }
async function startRunoutTimeline(page: Page): Promise<BrowserMonitor<Frame[]>> {
  const key = `__siteTimeline_${Math.random().toString(36).slice(2)}`;
  await page.evaluate((stateKey) => {
    const scope = window as unknown as Record<string, any>; const start = performance.now();
    const state: any = scope[stateKey] = { done: false, cancelled: false, error: null, value: [], lastBoard: 0, showdown: false };
    const tick = () => { if (state.cancelled) { delete scope[stateKey]; return; } const now = performance.now(); const table = document.querySelector<HTMLElement>('[aria-label="Table"]'); const phase = table?.dataset.flowPhase ?? ""; const board = Number(table?.dataset.boardCardCount ?? 0); const enabled = document.querySelectorAll('[data-action-type]:not([disabled])').length; if (phase === "showdown-reveal" && !state.showdown) { state.showdown = true; state.value.push({ kind: "showdown", at: now - start, boardLength: board, enabledActions: enabled }); } if (board !== state.lastBoard) { state.value.push({ kind: "board", at: now - start, boardLength: board, enabledActions: enabled }); state.lastBoard = board; } if (phase === "hand-summary" || document.querySelector('[data-hand-result-number]')) { state.value.push({ kind: "settlement", at: now - start, boardLength: board, enabledActions: enabled }); state.done = true; return; } if (now - start > 20_000) { state.error = "runout timeline timeout"; state.done = true; return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  }, key);
  return monitorHandle<Frame[]>(page, key, 21_000);
}
async function startRunoutActionMonitor(page: Page): Promise<BrowserMonitor<number>> {
  const key = `__siteActions_${Math.random().toString(36).slice(2)}`;
  await page.evaluate((stateKey) => { const scope = window as unknown as Record<string, any>; const start = performance.now(); const state: any = scope[stateKey] = { done: false, cancelled: false, error: null, value: 0, armed: false }; const tick = () => { if (state.cancelled) { delete scope[stateKey]; return; } const phase = document.querySelector<HTMLElement>('[aria-label="Table"]')?.dataset.flowPhase ?? ""; if (phase !== "betting") state.armed = true; if (state.armed) state.value = Math.max(state.value, document.querySelectorAll('[data-action-type]:not([disabled])').length); if (phase === "hand-summary" || document.querySelector('[data-hand-result-number]')) { state.done = true; return; } if (performance.now() - start > 20_000) { state.error = "disabled-action monitor timeout"; state.done = true; return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, key);
  return monitorHandle<number>(page, key, 21_000);
}
function monitorHandle<T>(page: Page, key: string, timeout: number): BrowserMonitor<T> {
  const result = (async () => {
    const deadline = performance.now() + timeout;
    while (performance.now() <= deadline) {
      const outcome = await page.evaluate((stateKey) => { const state = (window as unknown as Record<string, any>)[stateKey]; return state?.done ? { done: true, error: state.error, value: state.value } : { done: false }; }, key);
      if (outcome.done) { await page.evaluate((stateKey) => { delete (window as unknown as Record<string, any>)[stateKey]; }, key); if (outcome.error) throw Object.assign(new Error(String(outcome.error)), { name: "TimeoutError" }); return outcome.value as T; }
      await delay(16);
    }
    throw Object.assign(new Error(`browser monitor exceeded ${timeout}ms`), { name: "TimeoutError" });
  })();
  return { result, cancel: async () => { await page.evaluate((stateKey) => { const state = (window as unknown as Record<string, any>)[stateKey]; if (state) { state.cancelled = true; state.done = true; } }, key).catch(() => undefined); } };
}
async function perform(room: RoomPage, action: FixturePlayerAction) { await room.performAction(action.action.type, "amountTo" in action.action ? action.action.amountTo : undefined); }
async function readHandResult(page: Page) { await page.locator('[data-hand-result-number]').waitFor({ state: "visible", timeout: 15_000 }); return await page.locator('[aria-label="Hand result"]').evaluate((root) => ({ players: Array.from(root.querySelectorAll('.hand-result-player')).map((p) => ({ name: p.querySelector('span')?.textContent?.trim() ?? "", text: p.querySelector('small')?.textContent?.trim() ?? "", net: p.querySelector('strong')?.textContent?.trim() ?? "", end: Number((p.querySelector('small')?.textContent ?? "").split('→')[1]?.replaceAll(',', '').trim()) })), pots: Array.from(root.querySelectorAll('.hand-result-pots > div')).map((p) => ({ amount: Number((p.querySelector('span')?.textContent ?? '').match(/[\d,]+$/)?.[0].replaceAll(',', '')), awards: p.querySelector('strong')?.textContent ?? "" })) })); }
function awardsByName(result: Awaited<ReturnType<typeof readHandResult>>) { const output: Record<string, number> = Object.fromEntries(result.players.map((p) => [p.name, 0])); for (const pot of result.pots) for (const part of pot.awards.split('·')) { const match = part.trim().match(/^(.*?) \+([\d,]+)$/); if (match) output[match[1]] = (output[match[1]] ?? 0) + Number(match[2].replaceAll(',', '')); } return output; }
async function watchHandResult(page: Page) { return await page.evaluate(async () => await new Promise<{ result: { players: Array<{ name: string; text: string; net: string; start: number; end: number; netChips: number }>; pots: Array<{ amount: number; awards: string }> }; visibleMs: number }>((resolve, reject) => { const deadline = performance.now() + 15_000; let shownAt: number | null = null; let captured: any = null; const tick = () => { const root = document.querySelector<HTMLElement>('[aria-label="Hand result"]'); if (root && shownAt === null) { shownAt = performance.now(); captured = { players: Array.from(root.querySelectorAll('.hand-result-player')).map((p) => { const text = p.querySelector('small')?.textContent?.trim() ?? ""; const [start, end] = text.split('→').map((value) => Number(value.replaceAll(',', '').trim())); const net = p.querySelector('strong')?.textContent?.trim() ?? ""; return { name: p.querySelector('span')?.textContent?.trim() ?? "", text, net, start, end, netChips: Number(net.replaceAll(',', '').replace('+', '')) }; }), pots: Array.from(root.querySelectorAll('.hand-result-pots > div')).map((p) => ({ amount: Number((p.querySelector('span')?.textContent ?? '').match(/[\d,]+$/)?.[0].replaceAll(',', '')), awards: p.querySelector('strong')?.textContent ?? "" })) }; } if (!root && shownAt !== null && captured) { resolve({ result: captured, visibleMs: performance.now() - shownAt }); return; } if (performance.now() > deadline) { reject(Object.assign(new Error("hand result observation timeout"), { name: "TimeoutError" })); return; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); })); }
async function stackFor(page: Page, participantId: string) { const text = await page.locator(`[data-participant-id="${participantId}"] .seat-stack`).textContent(); return Number(text?.match(/([\d,.]+) BB/)?.[1].replaceAll(',', '')) * 20; }
async function committedFor(page: Page, participantId: string) { const text = await page.locator(`[data-participant-id="${participantId}"] .seat-bet-amount`).textContent(); return Number(text?.match(/([\d,.]+) BB/)?.[1].replaceAll(',', '')) * 20; }
async function readSessionRows(page: Page) { return await page.locator('.session-result-row:not(.is-heading)').evaluateAll((rows) => rows.map((row) => { const cells = Array.from(row.querySelectorAll('[role="cell"]')).map((c) => c.textContent?.trim() ?? ""); const n = (v: string) => Number(v.replaceAll(',', '').replace('+', '')); return { name: cells[0], initialChips: n(cells[1]), appliedTopUpChips: n(cells[2]), finalChips: n(cells[3]), netChips: n(cells[4]) }; })); }

async function pass(f: Fx, id: string, details: Record<string, unknown>) { const event = await f.recorder.recordEvent({ stage: id, type: "product-assertion", status: "pass", details }); const list = f.events.get(id) ?? []; list.push(event); f.events.set(id, list); }
async function capture(f: Fx, actor: ActorHandle, name: string) { await mkdir(actor.screenshotNamespace, { recursive: true }); const path = join(actor.screenshotNamespace, `${name}.png`); await actor.page.screenshot({ path, fullPage: true }); await f.recorder.recordArtifact({ id: `${artifactPrefix(env().outputRoot, f.outputRoot)}-${name}-${actor.metadata.id}`, path: artifactPath(env().outputRoot, path), description: name, kind: "screenshot", mediaType: "image/png", required: true }); }
function finish(f: Fx, caseId: CaseId): FinishCaseInput { const assertions = ASSERTIONS[caseId].map((id) => { const ids = (f.events.get(id) ?? []).map((e) => e.id); if (!ids.length) throw new Error(`Missing assertion evidence ${id}`); return { id, outcome: "pass" as const, evidenceEventIds: ids, summary: `${id} passed` }; }); const ids = assertions.flatMap((a) => a.evidenceEventIds); return { verdict: "PASS", results: { product: { status: "pass", summary: "All product assertions passed", evidenceEventIds: [...ids] }, harness: { status: "pass", summary: "Browser and evidence capture completed", evidenceEventIds: [...ids] }, environment: { status: "pass", summary: "Isolated target remained available", evidenceEventIds: [] } }, assertions, failures: [] }; }
function product(ok: unknown, c: AttemptCoordinates, id: string, actor: string, measured: unknown, threshold: unknown) { assertProductCondition(Boolean(ok), { ...mechanical(c, id, actor), earliestDivergentProjection: measured, measuredValue: measured, threshold }); }
async function expected<T>(operation: Promise<T>, c: AttemptCoordinates, id: string, actor: string, threshold: unknown): Promise<T> { return await observeProduct(() => operation, { ...mechanical(c, id, actor), earliestDivergentProjection: null, measuredValue: "not observed before bounded deadline", threshold }); }
function mechanical(c: AttemptCoordinates, assertionId: string, actor: string) { return { caseId: c.caseId, attemptId: c.attemptId, assertionId, actor, artifactIds: [] }; }
function roomPage(actor: ActorHandle) { return new RoomPage(actor.page, { actor: actor.metadata.id, screenshotNamespace: actor.screenshotNamespace, telemetry: actor.telemetry }); }
function recorder(e: Env, c: AttemptCoordinates, secrets: string[]) { return new EvidenceRecorder({ outputRoot: join(e.caseOutputRoot, c.caseId, c.attemptId), runId: c.runId, caseId: c.caseId, attemptId: c.attemptId, actor: "scenario", knownSecrets: secrets }); }
async function recordTelemetry(r: EvidenceRecorder, event: TelemetryEvent) { await r.recordEvent({ actor: String(event.details.actor ?? "browser"), stage: "browser-telemetry", type: event.kind, status: event.kind.includes("error") ? "observed-error" : "observed", details: { browserMonotonicMs: event.monotonicMs, ...event.details } }); }
function env(): Env { if (!BROKER) throw new Error("Fixture seed broker was not provided to isolated worker"); return { runId: required("SITE_TEST_RUN_ID"), baseUrl: required("SITE_TEST_ISOLATED_BASE_URL"), outputRoot: required("SITE_TEST_OUTPUT_ROOT"), caseOutputRoot: required("SITE_TEST_CASE_OUTPUT_ROOT"), broker: BROKER }; }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
function artifactPath(root: string, path: string) { const value = relative(root, path); if (value.startsWith("..")) throw new Error("Artifact escaped run root"); return value.replaceAll("\\", "/"); }
function artifactPrefix(root: string, path: string) { return artifactPath(root, path).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }
async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }
function owner(runId: string, role: string) { return `SITE-${runId}-${role}`; }
function placeholderIds<Role extends string>(roles: readonly Role[]) { return Object.fromEntries(roles.map((role) => [role, role])) as unknown as Record<Role, string>; }
function caseTimeout(id: string) { return EXPERIENCE_CASES.find((c) => c.caseId === id)!.stopConditions.overallTimeoutMs + 15_000; }
