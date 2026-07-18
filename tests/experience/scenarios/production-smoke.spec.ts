import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  augmentSmokeResultWithRetainedCleanup,
  discoverProductionAppContainer,
  ProductionCleanupError,
  runExactProductionCleanup
} from "../../../scripts/site-test/production-smoke";
import { runProcess } from "../../../scripts/site-test/process-runner";
import { EvidenceRecorder, type FinishCaseInput } from "../evidence/recorder";
import { bootstrapBrowserIdentity } from "../fixtures/api-client";
import type { KnownSecretRegistry } from "../fixtures/types";
import { CreateRoomPage } from "../page-objects/create-room-page";
import { RoomPage } from "../page-objects/room-page";
import { ProductAssertionError, assertProductCondition, observeProduct } from "../support/experience-test";
import { runExperienceCase, type AttemptCoordinates } from "../support/run-case";

const SETTINGS = {
  mode: "cash" as const,
  seats: 6,
  initialChips: 200,
  smallBlind: 10,
  bigBlind: 20,
  actionTimerSeconds: null
};
const ASSERTIONS = ["EXP-010-A01", "EXP-010-A02", "EXP-010-A03", "EXP-010-A04", "EXP-010-A05"] as const;

test("EXP-010 smokes the deployed public poker journey and deletes only its owned room", async ({ browser, page, request }) => {
  test.setTimeout(135_000);
  const environment = readEnvironment();
  const recorders = new Map<string, EvidenceRecorder>();
  const secrets = new SecretRegistry();

  await runExperienceCase({
    runId: environment.runId,
    caseId: "EXP-010",
    recorderFactory: (coordinates) => {
      const recorder = createRecorder(environment, coordinates, secrets.knownSecrets);
      recorders.set(coordinates.attemptId, recorder);
      return recorder;
    },
    createFixture: async (coordinates) => ({
      coordinates,
      recorder: requiredRecorder(recorders, coordinates.attemptId),
      contexts: [] as BrowserContext[],
      secrets,
      assertionEvents: new Map<string, string[]>(),
      roomId: null as string | null,
      ownershipMarker: `SITE-${environment.runId}-smoke-player`,
      cleanup: "pending" as "pending" | "cleaned" | "retained" | "failed"
    }),
    execute: async ({ fixture, ...coordinates }) => {
      let productError: unknown;
      try {
        await assertPublicEntrypoints(request, page, environment.smokeBaseUrl, fixture, coordinates);
        await executePublicJourney(browser, page, environment, fixture, coordinates);
      } catch (error) {
        productError = error;
      }

      await fixture.recorder.recordEvent({
        actor: "production-smoke",
        stage: "pre-cleanup-evidence",
        type: productError instanceof ProductAssertionError ? "product-failure" : "journey-complete",
        status: productError === undefined ? "pass" : "failure-durable",
        details: productError instanceof ProductAssertionError
          ? {
              assertionId: productError.context.assertionId,
              roomId: fixture.roomId,
              ownershipMarker: fixture.ownershipMarker,
              message: productError.message
            }
          : { roomId: fixture.roomId, ownershipMarker: fixture.ownershipMarker }
      });

      const closeErrors = await closeBrowserContexts([
        page.context(),
        ...fixture.contexts.splice(0)
      ]);
      const exactCleanupError = await cleanupExactRoom(environment, fixture).catch((error) => error);
      const cleanupError = closeErrors.length > 0
        ? new ProductionCleanupError(
            `browser quiescence not proven (${closeErrors.join("; ")})${exactCleanupError instanceof Error ? `; exact cleanup: ${exactCleanupError.message}` : ""}`,
            "partial",
            exactCleanupError instanceof Error ? { cause: exactCleanupError } : undefined
          )
        : exactCleanupError;
      if (cleanupError instanceof Error) {
        fixture.cleanup = cleanupError instanceof ProductionCleanupError && cleanupError.cleanupStatus === "partial" ? "failed" : "retained";
        await writeOwnedRoomResource(environment, fixture);
        await fixture.recorder.recordEvent({
          actor: "cleanup",
          stage: "EXP-010-A04",
          type: "environment-cleanup",
          status: "inconclusive",
          details: { roomId: fixture.roomId, ownershipMarker: fixture.ownershipMarker, retainedReason: cleanupError.message }
        });
      }
      if (cleanupError instanceof Error) {
        return augmentSmokeResultWithRetainedCleanup(
          priorSmokeResult(fixture, productError), {
          roomId: fixture.roomId ?? "unrecorded",
          ownershipMarker: fixture.ownershipMarker,
          cleanupReason: cleanupError.message
          ,cleanupStatus: cleanupError instanceof ProductionCleanupError ? cleanupError.cleanupStatus : "retained"
        });
      }
      if (productError instanceof ProductAssertionError) throw productError;
      if (productError !== undefined) throw productError;
      return passingResult(fixture);
    },
    disposeFixture: async (fixture) => {
      await closeBrowserContexts(fixture.contexts.splice(0));
    },
    persistFallbackReport: async (coordinates, input) => await createRecorder(environment, coordinates, secrets.knownSecrets).finishCase(input)
  });
});

async function closeBrowserContexts(contexts: BrowserContext[]): Promise<string[]> {
  const uniqueContexts = [...new Set(contexts)];
  const outcomes = await Promise.allSettled(
    uniqueContexts.map(async (context) => await context.close())
  );
  return outcomes.flatMap((outcome) =>
    outcome.status === "rejected"
      ? [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)]
      : []
  );
}

async function assertPublicEntrypoints(request: { get(url: string): Promise<{ ok(): boolean; status(): number }> }, page: Page, baseUrl: string, fixture: SmokeFixture, c: AttemptCoordinates) {
  const health = await request.get(new URL("/api/health", baseUrl).toString());
  const home = await request.get(new URL("/", baseUrl).toString());
  const create = await request.get(new URL("/create", baseUrl).toString());
  const facts = { health: health.status(), home: home.status(), create: create.status() };
  assertProductCondition(health.ok() && home.ok() && create.ok(), context(c, "EXP-010-A01", "public-entry", facts, { allResponsesOk: true }));
  await page.goto(baseUrl);
  assertProductCondition(await page.getByRole("link", { name: /create/i }).count() > 0, context(c, "EXP-010-A01", "home", { createLink: false }, { createLink: true }));
  await pass(fixture, "EXP-010-A01", "public-entry", facts);
}

async function executePublicJourney(browser: Browser, page: Page, environment: Environment, fixture: SmokeFixture, c: AttemptCoordinates) {
  const createPage = new CreateRoomPage(page, environment.smokeBaseUrl);
  await createPage.goto();
  const links = await observeProduct(() => createPage.create(SETTINGS, async ({ roomId }) => {
    fixture.roomId = roomId;
    await persistOwnedRoom(environment, fixture);
  }), context(c, "EXP-010-A02", "creator", { links: false }, { links: true }));
  const inviteUrl = new URL(links.inviteUrl, environment.smokeBaseUrl);
  const hostUrl = new URL(links.hostUrl, environment.smokeBaseUrl);
  const hostToken = hostUrl.searchParams.get("host");
  const roomId = links.roomId;
  if (hostToken) fixture.secrets.add(hostToken);
  assertProductCondition(Boolean(hostToken) && roomIdFromUrl(inviteUrl) === roomId && !inviteUrl.searchParams.has("host") && inviteUrl.pathname === hostUrl.pathname,
    context(c, "EXP-010-A02", "creator", { roomId, hostTokenPresent: Boolean(hostToken) }, { usableHostAndInviteLinks: true }));
  await pass(fixture, "EXP-010-A02", "creator", { roomId, inviteCredentialFree: true, hostCredentialPresent: true });

  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const spectatorContext = await browser.newContext();
  fixture.contexts.push(hostContext, playerContext, spectatorContext);
  const hostPage = await hostContext.newPage();
  const playerPage = await playerContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  await bootstrapBrowserIdentity({ page: hostPage, baseUrl: environment.smokeBaseUrl, roomId, role: "host", displayName: `SITE-${environment.runId}-smoke-host`, hostToken: hostToken!, knownSecrets: fixture.secrets });
  await bootstrapBrowserIdentity({ page: playerPage, baseUrl: environment.smokeBaseUrl, roomId, role: "player", displayName: fixture.ownershipMarker, knownSecrets: fixture.secrets });
  const playerRoom = new RoomPage(playerPage, { actor: "smoke-player", screenshotNamespace: join(environment.outputRoot, "smoke") });
  await observeProduct(() => playerRoom.claimSeat(1), context(c, "EXP-010-A03", "player", { claimed: false }, { claimed: true }));
  await playerPage.locator('[data-seat-number="1"][data-local-seat="true"]').waitFor({ state: "visible", timeout: 3_000 });
  await spectatorPage.goto(inviteUrl.toString());
  const spectatorRoom = new RoomPage(spectatorPage, { actor: "spectator", screenshotNamespace: join(environment.outputRoot, "smoke") });
  await spectatorRoom.join("Spectator", "spectator");
  await spectatorPage.getByRole("dialog", { name: "Join flow" }).waitFor({ state: "hidden", timeout: 3_000 });
  await pass(fixture, "EXP-010-A03", "roles", { playerJoined: true, seatClaimedThroughWebSocket: true, spectatorJoined: true });
  const gate = process.env.SITE_TEST_ISOLATED_ACCEPTANCE_PASSED === "1";
  assertProductCondition(gate, context(c, "EXP-010-A05", "runner", { isolatedAcceptanceGate: gate }, { isolatedAcceptanceGate: true }));
  await pass(fixture, "EXP-010-A05", "runner", { isolatedAcceptanceGate: "runner-proven" });
}

async function cleanupExactRoom(environment: Environment, fixture: SmokeFixture): Promise<void> {
  if (!fixture.roomId) throw new Error("No exact smoke room ID was recorded");
  const image = process.env.SITE_TEST_IMAGE?.trim() || "texas-holdem-friends-room:latest";
  const inspectedImage = await runProcess("docker", ["image", "inspect", image, "--format", "{{.Id}}"]);
  const expectedImageId = inspectedImage.stdout.trim();
  const container = await discoverProductionAppContainer({
    expectedImageId,
    project: process.env.SITE_TEST_SMOKE_COMPOSE_PROJECT?.trim() || undefined
  });
  await runExactProductionCleanup({ containerId: container.containerId, roomId: fixture.roomId, runId: environment.runId });
  fixture.cleanup = "cleaned";
  await writeOwnedRoomResource(environment, fixture);
  await pass(fixture, "EXP-010-A04", "cleanup", { roomId: fixture.roomId, exactOwnedRoomDeleted: true });
}

async function persistOwnedRoom(environment: Environment, fixture: SmokeFixture): Promise<void> {
  await writeOwnedRoomResource(environment, fixture);
  await fixture.recorder.recordEvent({ actor: "resource-recorder", stage: "room-created", type: "run-resource", status: "recorded", details: { roomId: fixture.roomId, ownershipMarker: fixture.ownershipMarker } });
}

async function writeOwnedRoomResource(environment: Environment, fixture: SmokeFixture): Promise<void> {
  const root = join(environment.caseOutputRoot, "EXP-010", "A-001");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "resources.json"), `${JSON.stringify({
    runId: environment.runId,
    resources: [{ roomId: fixture.roomId, ownershipMarker: fixture.ownershipMarker, cleanupStatus: fixture.cleanup }]
  }, null, 2)}\n`, "utf8");
}

function passingResult(fixture: SmokeFixture): FinishCaseInput {
  const assertions = ASSERTIONS.map((id) => ({ id, outcome: "pass" as const, evidenceEventIds: fixture.assertionEvents.get(id) ?? [], summary: `${id} passed through public UI and WebSocket paths.` }));
  const ids = assertions.flatMap((assertion) => assertion.evidenceEventIds);
  return { verdict: "PASS", results: { product: { status: "pass", summary: "The deployed smoke journey passed.", evidenceEventIds: ids }, harness: { status: "pass", summary: "Smoke evidence and exact cleanup completed.", evidenceEventIds: ids }, environment: { status: "pass", summary: "The deployed app remained healthy.", evidenceEventIds: ids } }, assertions, failures: [] };
}

function priorSmokeResult(fixture: SmokeFixture, error: unknown): FinishCaseInput {
  if (error === undefined) return passingResult(fixture);
  const passed = [...fixture.assertionEvents.entries()].map(([id, evidenceEventIds]) => ({ id, outcome: "pass" as const, evidenceEventIds: [...evidenceEventIds], summary: `${id} passed before the later failure.` }));
  if (error instanceof ProductAssertionError) {
    return { verdict: "FAIL", results: { product: { status: "fail", summary: error.message, evidenceEventIds: [] }, harness: { status: "pass", summary: "The product failure was durably captured.", evidenceEventIds: [] }, environment: { status: "pass", summary: "The deployed app was available.", evidenceEventIds: [] } }, assertions: [...passed, { id: error.context.assertionId, outcome: "fail", evidenceEventIds: [], summary: error.message, details: { actor: error.context.actor, measuredValue: error.context.measuredValue, threshold: error.context.threshold, artifactIds: [...error.context.artifactIds] } }], failures: [{ code: "PRODUCT_ASSERTION_FAILED", summary: error.message, stage: error.context.assertionId, evidenceEventIds: [], details: { actor: error.context.actor, artifactIds: [...error.context.artifactIds] } }] };
  }
  const summary = error instanceof Error ? error.message : String(error);
  return { verdict: "INCONCLUSIVE", results: { product: { status: "inconclusive", summary: "Product behavior could not be fully judged.", evidenceEventIds: passed.flatMap((item) => item.evidenceEventIds) }, harness: { status: "inconclusive", summary, evidenceEventIds: [] }, environment: { status: "pass", summary: "The deployed app was available.", evidenceEventIds: [] } }, assertions: passed, failures: [{ code: error instanceof Error && error.name === "TimeoutError" ? "HARNESS_TIMEOUT" : "HARNESS_RUNTIME_FAILURE", summary, stage: "attempt-runtime", evidenceEventIds: [] }] };
}

async function pass(fixture: SmokeFixture, id: string, actor: string, details: Record<string, unknown>) { const event = await fixture.recorder.recordEvent({ actor, stage: id, type: "product-assertion", status: "pass", details }); fixture.assertionEvents.set(id, [...(fixture.assertionEvents.get(id) ?? []), event.id]); }
function context(c: AttemptCoordinates, assertionId: string, actor: string, measuredValue: unknown, threshold: unknown) { return { assertionId, caseId: c.caseId, attemptId: c.attemptId, actor, earliestDivergentProjection: null, measuredValue, threshold, artifactIds: [] }; }
function roomIdFromUrl(url: URL) { const match = url.pathname.match(/^\/room\/([^/]+)$/u); if (!match) throw new Error("Invite link did not contain an exact room ID"); return decodeURIComponent(match[1]); }
function createRecorder(e: Environment, c: AttemptCoordinates, knownSecrets: readonly string[]) { return new EvidenceRecorder({ outputRoot: join(e.caseOutputRoot, c.caseId, c.attemptId), runId: c.runId, caseId: c.caseId, attemptId: c.attemptId, actor: "production-smoke", knownSecrets }); }
function requiredRecorder(map: Map<string, EvidenceRecorder>, id: string) { const recorder = map.get(id); if (!recorder) throw new Error(`Missing recorder for ${id}`); return recorder; }
function readEnvironment(): Environment { return { runId: requiredEnv("SITE_TEST_RUN_ID"), outputRoot: requiredEnv("SITE_TEST_OUTPUT_ROOT"), caseOutputRoot: requiredEnv("SITE_TEST_CASE_OUTPUT_ROOT"), smokeBaseUrl: requiredEnv("SITE_TEST_SMOKE_URL") }; }
function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing required smoke environment: ${name}`); return value; }

class SecretRegistry implements KnownSecretRegistry { readonly knownSecrets: string[] = []; private readonly values = new Set<string>(); add(secret: string) { if (!this.values.has(secret)) { this.values.add(secret); this.knownSecrets.push(secret); } } }
interface Environment { runId: string; outputRoot: string; caseOutputRoot: string; smokeBaseUrl: string }
interface SmokeFixture { coordinates: AttemptCoordinates; recorder: EvidenceRecorder; contexts: BrowserContext[]; secrets: SecretRegistry; assertionEvents: Map<string, string[]>; roomId: string | null; ownershipMarker: string; cleanup: "pending" | "cleaned" | "retained" | "failed" }
