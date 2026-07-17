import { randomBytes } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { test, type Browser, type Page } from "@playwright/test";
import WebSocket from "ws";

import { assertSynchronizedViews, type ViewProjection } from "../assertions/synchronization";
import { assertSeatingLayoutRendered } from "../assertions/layout";
import {
  assertCrossViewConvergence,
  assertDeadStateDuration,
  assertLocalFeedback
} from "../assertions/timing";
import { EXPERIENCE_CASES } from "../case-catalog";
import type { ArtifactRecord, EvidenceEvent } from "../evidence/contracts";
import { EvidenceRecorder, type FinishCaseInput } from "../evidence/recorder";
import { ExperienceApiClient, bootstrapBrowserIdentity } from "../fixtures/api-client";
import { buildNormalBettingFixture } from "../fixtures/builders";
import {
  consumeFixtureSeedBrokerForPlaywrightWorker,
  seedNormalBettingThroughBroker
} from "../fixtures/seed-broker-client";
import type {
  FixturePlayerAction,
  FixturePrimaryAction,
  KnownSecretRegistry
} from "../fixtures/types";
import { CreateRoomPage } from "../page-objects/create-room-page";
import { RoomPage } from "../page-objects/room-page";
import { ActorPool, type ActorHandle } from "../support/actor-pool";
import {
  ProductAssertionError,
  assertProductCondition,
  observeProduct
} from "../support/experience-test";
import { runExperienceCase, type AttemptCoordinates } from "../support/run-case";
import type { TelemetryEvent } from "../support/telemetry";

const CASH_SETTINGS = {
  mode: "cash" as const,
  seats: 6,
  initialChips: 200,
  smallBlind: 10,
  bigBlind: 20,
  actionTimerSeconds: null
};
const PRODUCT_ASSERTION_IDS = {
  "EXP-001": ["EXP-001-A01", "EXP-001-A02", "EXP-001-A03", "EXP-001-A04"],
  "EXP-002": ["EXP-002-A01", "EXP-002-A02", "EXP-002-A03"],
  "EXP-003": ["EXP-003-A01", "EXP-003-A02", "EXP-003-A03", "EXP-003-A04", "EXP-003-A05"]
} as const;
const FIXTURE_SEED_BROKER = consumeFixtureSeedBrokerForPlaywrightWorker();

test("EXP-001 creates a room and enforces host, player, and spectator authority", async ({ browser, page }) => {
  test.setTimeout(caseTimeout("EXP-001"));
  const environment = readScenarioEnvironment();

  await runActorCase(environment, browser, "EXP-001", async ({ fixture, coordinates }) => {
    const createPage = new CreateRoomPage(page, environment.baseUrl);
    await createPage.goto();
    const links = await observeProduct(
      async () => await createPage.create(CASH_SETTINGS),
      productContext(coordinates, "EXP-001-A01", "host", { roomCreated: false }, { roomCreated: true })
    );
    const inviteUrl = new URL(links.inviteUrl, environment.baseUrl);
    const hostUrl = new URL(links.hostUrl, environment.baseUrl);
    const hostToken = hostUrl.searchParams.get("host");
    if (hostToken) fixture.secrets.add(hostToken);
    const roomId = roomIdFromUrl(inviteUrl);
    const linkFacts = {
      distinct: inviteUrl.toString() !== hostUrl.toString(),
      sameRoom: inviteUrl.pathname === hostUrl.pathname,
      inviteIsCredentialFree: !inviteUrl.searchParams.has("host"),
      hostCredentialPresent: Boolean(hostToken)
    };
    await page.goto(environment.baseUrl);
    assertProductCondition(Object.values(linkFacts).every(Boolean), productContext(
      coordinates,
      "EXP-001-A01",
      "host",
      linkFacts,
      "distinct invite/host links for one room with credentials only on the host link"
    ));
    await recordAssertionPass(fixture, "EXP-001-A01", "host", linkFacts);

    if (!hostToken) throw new Error("Host link did not contain an in-memory credential");
    const host = fixture.pool.get("host");
    const player = fixture.pool.get("player-1");
    const spectator = fixture.pool.get("spectator");
    const hostIdentity = await bootstrapObservedIdentity({
      page: host.page,
      baseUrl: environment.baseUrl,
      roomId,
      role: "host",
      displayName: ownershipName(environment.runId, "host"),
      hostToken,
      knownSecrets: fixture.secrets
    }, productContext(coordinates, "EXP-001-A02", "host", { joined: false }, { joined: true }));
    const playerIdentity = await bootstrapObservedIdentity({
      page: player.page,
      baseUrl: environment.baseUrl,
      roomId,
      role: "player",
      displayName: ownershipName(environment.runId, "player"),
      knownSecrets: fixture.secrets
    }, productContext(coordinates, "EXP-001-A02", "player", { joined: false }, { joined: true }));
    const hostRoom = roomPage(host);
    const playerRoom = roomPage(player);
    const spectatorRoom = roomPage(spectator);
    await spectator.page.goto(inviteUrl.toString());
    await observeProduct(
      async () => await spectatorRoom.join("Spectator", "spectator"),
      productContext(coordinates, "EXP-001-A02", "spectator", { joinControlUsable: false }, { joinControlUsable: true })
    );
    await waitForJoinFlowHidden(
      spectator.page,
      productContext(coordinates, "EXP-001-A02", "spectator", { joinFlowHidden: false }, { joinFlowHidden: true })
    );
    await fixture.pool.startTraceAfterBootstrap("spectator", { traceReady: true });
    fixture.evidenceActor = spectator;

    await observeProduct(
      async () => await playerRoom.claimSeat(1),
      productContext(coordinates, "EXP-001-A02", "player", { seatClaimUsable: false }, { seatClaimUsable: true })
    );
    await waitForSeat(
      player.page,
      1,
      playerIdentity.displayName,
      productContext(coordinates, "EXP-001-A02", "player", { seatVisible: false }, { seatVisible: true })
    );
    await waitForSeat(
      host.page,
      1,
      playerIdentity.displayName,
      productContext(coordinates, "EXP-001-A02", "host", { seatVisible: false }, { seatVisible: true })
    );
    const roleFacts = {
      playerLocalSeat: await player.page.locator('[data-seat-number="1"]').getAttribute("data-local-seat"),
      spectatorLocalSeats: await spectator.page.locator('[data-local-seat="true"]').count(),
      playerCanAddChips: await player.page.locator('[data-control-panel="top-up"]').count(),
      spectatorCanAddChips: await spectator.page.locator('[data-control-panel="top-up"]').count(),
      hostIdentity: hostIdentity.role
    };
    assertProductCondition(
      roleFacts.playerLocalSeat === "true" &&
        roleFacts.spectatorLocalSeats === 0 &&
        roleFacts.playerCanAddChips === 1 &&
        roleFacts.spectatorCanAddChips === 0,
      productContext(coordinates, "EXP-001-A02", "roles", roleFacts, {
        playerLocalSeat: "true",
        spectatorLocalSeats: 0,
        playerCanAddChips: 1,
        spectatorCanAddChips: 0
      })
    );
    await recordAssertionPass(fixture, "EXP-001-A02", "roles", roleFacts);

    const hostControlFacts = {
      host: await host.page.locator('[data-control-panel="host"]').count(),
      player: await player.page.locator('[data-control-panel="host"]').count(),
      spectator: await spectator.page.locator('[data-control-panel="host"]').count()
    };
    assertProductCondition(
      hostControlFacts.host === 1 && hostControlFacts.player === 0 && hostControlFacts.spectator === 0,
      productContext(coordinates, "EXP-001-A03", "host", hostControlFacts, {
        host: 1,
        player: 0,
        spectator: 0
      })
    );

    const authorityObservation = productContext(
      coordinates,
      "EXP-001-A04",
      "raw-websocket",
      { safeRoomStateObserved: false },
      { safeRoomStateObserved: true }
    );
    const beforeForgery = await readSafeRoomState(spectatorRoom, spectator.page, authorityObservation);
    const forgedHost = await observeProduct(
      async () => await sendDisposableCommand(environment.baseUrl, {
        type: "end_room",
        roomId,
        hostToken: `forged-host-${randomBytes(6).toString("hex")}`
      }),
      authorityObservation
    );
    await delay(100);
    const afterForgedHost = await readSafeRoomState(spectatorRoom, spectator.page, authorityObservation);
    const forgedParticipant = await observeProduct(
      async () => await sendDisposableCommand(environment.baseUrl, {
        type: "claim_seat",
        roomId,
        participantToken: `forged-player-${randomBytes(6).toString("hex")}`,
        displayName: "Forged",
        seatNumber: 2
      }),
      authorityObservation
    );
    await delay(100);
    const afterForgery = await readSafeRoomState(spectatorRoom, spectator.page, authorityObservation);
    const authorityFacts = {
      forgedHostCode: forgedHost.code,
      forgedParticipantCode: forgedParticipant.code,
      forgedHostPayloadKeys: forgedHost.payloadKeys,
      forgedParticipantPayloadKeys: forgedParticipant.payloadKeys,
      stateUnchangedAfterHost: JSON.stringify(beforeForgery) === JSON.stringify(afterForgedHost),
      stateUnchangedAfterParticipant: JSON.stringify(beforeForgery) === JSON.stringify(afterForgery)
    };
    assertProductCondition(
      authorityFacts.forgedHostCode === "INVALID_HOST_TOKEN" &&
        authorityFacts.forgedParticipantCode === "INVALID_PARTICIPANT_TOKEN" &&
        JSON.stringify(authorityFacts.forgedHostPayloadKeys) === JSON.stringify(["code", "message"]) &&
        JSON.stringify(authorityFacts.forgedParticipantPayloadKeys) === JSON.stringify(["code", "message"]) &&
        authorityFacts.stateUnchangedAfterHost &&
        authorityFacts.stateUnchangedAfterParticipant,
      productContext(coordinates, "EXP-001-A04", "raw-websocket", authorityFacts, {
        forgedHostCode: "INVALID_HOST_TOKEN",
        forgedParticipantCode: "INVALID_PARTICIPANT_TOKEN",
        errorPayloadKeys: ["code", "message"],
        stateUnchangedAfterEachCommand: true
      })
    );
    await recordAssertionPass(fixture, "EXP-001-A04", "raw-websocket", authorityFacts);

    await observeProduct(
      async () => await hostRoom.requestRoomEnd(),
      productContext(coordinates, "EXP-001-A03", "host", { endRoomControlUsable: false }, { endRoomControlUsable: true })
    );
    await observeProduct(
      async () => await hostRoom.waitForPhase("session-summary", { timeout: 3_000 }),
      productContext(
        coordinates,
        "EXP-001-A03",
        "host",
        { phase: "not observed before deadline" },
        { phase: "session-summary" }
      )
    );
    const hostScreenshot = await captureAndRegister(fixture, hostRoom, "host-authority-complete");
    assertProductCondition(
      (await host.page.locator('[data-session-result-state="visible"]').count()) === 1,
      productContext(
        coordinates,
        "EXP-001-A03",
        "host",
        "host command completed",
        "host-only room state transition",
        [hostScreenshot.id]
      )
    );
    await recordAssertionPass(
      fixture,
      "EXP-001-A03",
      "host",
      { hostControls: hostControlFacts, effectiveCommand: "session-summary" },
      [hostScreenshot.id]
    );
    return finishPassingCase(fixture, "EXP-001");
  });
});

test("EXP-002 keeps 2-, 6-, and 9-seat rooms understandable and blocks a one-player start", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-002"));
  const environment = readScenarioEnvironment();

  await runActorCase(environment, browser, "EXP-002", async ({ fixture, coordinates }) => {
    const api = new ExperienceApiClient({
      baseUrl: environment.baseUrl,
      knownSecrets: fixture.secrets
    });
    const configurations = [
      { seats: 2, actorId: "player-1", role: "two" },
      { seats: 6, actorId: "player-2", role: "six" },
      { seats: 9, actorId: "player-3", role: "nine" }
    ] as const;
    const layouts: SeatingLayout[] = [];
    let twoSeatRoom: Awaited<ReturnType<ExperienceApiClient["createRoom"]>> | null = null;
    let nineSeatRoom: Awaited<ReturnType<ExperienceApiClient["createRoom"]>> | null = null;
    let twoSeatPlayerName = "";

    for (const configuration of configurations) {
      const room = await api.createRoom({ ...CASH_SETTINGS, seats: configuration.seats });
      const actor = fixture.pool.get(configuration.actorId);
      const identity = await bootstrapObservedIdentity({
        page: actor.page,
        baseUrl: environment.baseUrl,
        roomId: room.roomId,
        role: configuration.role,
        displayName: ownershipName(environment.runId, configuration.role),
        knownSecrets: fixture.secrets
      }, productContext(coordinates, "EXP-002-A01", configuration.actorId, { joined: false }, { joined: true }));
      const actorRoom = roomPage(actor);
      await observeProduct(
        async () => await actorRoom.claimSeat(1),
        productContext(coordinates, "EXP-002-A01", configuration.actorId, { seatClaimUsable: false }, { seatClaimUsable: true })
      );
      await waitForSeat(
        actor.page,
        1,
        identity.displayName,
        productContext(coordinates, "EXP-002-A01", configuration.actorId, { seatVisible: false }, { seatVisible: true })
      );
      const layout = await observeProduct(
        async () => await readSeatingLayout(actor.page, configuration.seats),
        productContext(
          coordinates,
          "EXP-002-A01",
          configuration.actorId,
          { renderedSeatCount: "not observed" },
          { renderedSeatCount: configuration.seats }
        )
      );
      assertSeatingLayoutRendered({
        expectedSeatCount: configuration.seats,
        feltRendered: layout.feltRendered,
        renderedSeatCount: layout.renderedSeatCount,
        localSeatRendered: layout.local !== null
      }, mechanicalContext(coordinates, "EXP-002-A01", configuration.actorId, []));
      layouts.push(layout);
      if (configuration.seats === 2) {
        twoSeatRoom = room;
        twoSeatPlayerName = identity.displayName;
      }
      if (configuration.seats === 9) nineSeatRoom = room;
    }

    if (!nineSeatRoom) throw new Error("Nine-seat room was not created");
    const spectator = fixture.pool.get("spectator");
    await spectator.page.goto(nineSeatRoom.inviteUrl);
    const spectatorRoom = roomPage(spectator);
    await observeProduct(
      async () => await spectatorRoom.join("Spectator", "spectator"),
      productContext(coordinates, "EXP-002-A01", "spectator", { joinControlUsable: false }, { joinControlUsable: true })
    );
    await waitForJoinFlowHidden(
      spectator.page,
      productContext(coordinates, "EXP-002-A01", "spectator", { joinFlowHidden: false }, { joinFlowHidden: true })
    );
    await fixture.pool.startTraceAfterBootstrap("spectator", { traceReady: true });
    fixture.evidenceActor = spectator;

    const occupancyReadable = layouts.every((layout) =>
      layout.order.join(",") === Array.from({ length: layout.seatCount }, (_, index) => index + 1).join(",") &&
      layout.seats.filter(({ occupied }) => occupied).length === 1 &&
      layout.seats.filter(({ occupied }) => occupied).every(({ text }) => /SITE-/i.test(text) && /BB/i.test(text)) &&
      layout.seats.filter(({ occupied }) => !occupied).every(({ text, accessibleName, seatNumber }) =>
        /Open/i.test(text) && accessibleName === `Claim seat ${seatNumber}`
      ) &&
      !hasOverlappingSeats(layout.seats)
    );
    assertProductCondition(
      occupancyReadable,
      productContext(coordinates, "EXP-002-A01", "players", layouts, {
        stableSeatOrder: true,
        oneOccupiedSeat: true,
        occupiedSeatShowsNameAndStack: true,
        emptySeatsSayOpenAndExposeClaimLabel: true,
        overlap: false
      })
    );
    await recordAssertionPass(fixture, "EXP-002-A01", "players", {
      seatCounts: layouts.map(({ seatCount }) => seatCount),
      stableOrderAndReadableOccupancy: true
    });

    const localSeatPlacement = layouts.map((layout) => ({
      seatCount: layout.seatCount,
      bottomMost: layout.local !== null &&
        layout.local.centerY >= Math.max(...layout.seats.map(({ centerY }) => centerY)) - 1,
      horizontalOffset: layout.local === null
        ? null
        : Math.abs(layout.local.centerX - layout.tableCenterX),
      allowedOffset: layout.tableWidth * 0.1
    }));
    assertProductCondition(
      localSeatPlacement.every(({ bottomMost, horizontalOffset, allowedOffset }) =>
        bottomMost && horizontalOffset !== null && horizontalOffset <= allowedOffset
      ),
      productContext(coordinates, "EXP-002-A02", "players", localSeatPlacement, {
        bottomMost: true,
        maxHorizontalOffset: "10% of table width"
      })
    );
    await recordAssertionPass(fixture, "EXP-002-A02", "players", { localSeatPlacement });

    if (!twoSeatRoom) throw new Error("Two-seat room was not created");
    const host = fixture.pool.get("host");
    await bootstrapObservedIdentity({
      page: host.page,
      baseUrl: environment.baseUrl,
      roomId: twoSeatRoom.roomId,
      role: "host",
      displayName: ownershipName(environment.runId, "host"),
      hostToken: twoSeatRoom.hostToken,
      knownSecrets: fixture.secrets
    }, productContext(coordinates, "EXP-002-A03", "host", { joined: false }, { joined: true }));
    await waitForSeat(
      host.page,
      1,
      twoSeatPlayerName,
      productContext(coordinates, "EXP-002-A03", "host", { seatVisible: false }, { seatVisible: true })
    );
    const hostRoom = roomPage(host);
    await observeProduct(
      async () => await hostRoom.openHostControls(),
      productContext(coordinates, "EXP-002-A03", "host", { hostControlsUsable: false }, { hostControlsUsable: true })
    );

    await spectator.page.goto(twoSeatRoom.inviteUrl);
    await observeProduct(
      async () => await spectatorRoom.join("Spectator", "spectator"),
      productContext(coordinates, "EXP-002-A03", "single-player-spectator", { joinControlUsable: false }, { joinControlUsable: true })
    );
    await waitForJoinFlowHidden(
      spectator.page,
      productContext(coordinates, "EXP-002-A03", "single-player-spectator", { joinFlowHidden: false }, { joinFlowHidden: true })
    );
    const screenshot = await captureAndRegister(fixture, hostRoom, "one-funded-player-start");
    const startButton = host.page.getByRole("button", { name: /Start room|Hand in progress/ });
    const startButtonPresent = await startButton.count();
    const startFacts = {
      present: startButtonPresent === 1,
      disabled: startButtonPresent === 1
        ? await observeProduct(
            async () => await startButton.isDisabled(),
            productContext(coordinates, "EXP-002-A03", "host", { startButtonObserved: false }, { startButtonObserved: true })
          )
        : false,
      explanationVisible: await host.page.getByText(/at least two funded players/i).count() > 0
    };
    assertProductCondition(
      startFacts.present && startFacts.disabled && startFacts.explanationVisible,
      productContext(coordinates, "EXP-002-A03", "host", startFacts, {
        present: true,
        disabled: true,
        explanation: "at least two funded players are required"
      }, [screenshot.id])
    );
    await recordAssertionPass(fixture, "EXP-002-A03", "host", startFacts, [screenshot.id]);
    return finishPassingCase(fixture, "EXP-002");
  });
});

test("EXP-003 completes the declared normal betting plan with prompt synchronized feedback", async ({ browser }) => {
  test.setTimeout(caseTimeout("EXP-003") * 2 + 30_000);
  const environment = readScenarioEnvironment();

  await runActorCase(environment, browser, "EXP-003", async ({ fixture, coordinates }) => {
    const api = new ExperienceApiClient({
      baseUrl: environment.baseUrl,
      knownSecrets: fixture.secrets
    });
    const room = await api.createRoom({ ...CASH_SETTINGS, seats: 3 });
    const actorByRole = {
      button: fixture.pool.get("player-1"),
      small: fixture.pool.get("player-2"),
      big: fixture.pool.get("player-3")
    } as const;
    const participantIds = {} as Record<keyof typeof actorByRole, string>;

    for (const role of Object.keys(actorByRole) as Array<keyof typeof actorByRole>) {
      const identity = await bootstrapObservedIdentity({
        page: actorByRole[role].page,
        baseUrl: environment.baseUrl,
        roomId: room.roomId,
        role,
        displayName: ownershipName(environment.runId, role),
        knownSecrets: fixture.secrets
      }, productContext(coordinates, "EXP-003-A01", role, { joined: false }, { joined: true }));
      participantIds[role] = identity.participantId;
    }

    const normalFixture = buildNormalBettingFixture({
      runId: environment.runId,
      participantIds
    });
    await seedNormalBettingThroughBroker({
      broker: environment.fixtureSeedBroker,
      runId: environment.runId,
      roomId: room.roomId,
      participantIds
    });

    const roomByRole = {} as Record<keyof typeof actorByRole, RoomPage>;
    for (const role of Object.keys(actorByRole) as Array<keyof typeof actorByRole>) {
      const actor = actorByRole[role];
      await actor.page.reload();
      roomByRole[role] = roomPage(actor);
      await observeProduct(
        async () => await roomByRole[role].join(ownershipName(environment.runId, role)),
        productContext(coordinates, "EXP-003-A01", role, { joinControlUsable: false }, { joinControlUsable: true })
      );
      await waitForJoinFlowHidden(
        actor.page,
        productContext(coordinates, "EXP-003-A01", role, { joinFlowHidden: false }, { joinFlowHidden: true })
      );
    }
    const spectator = fixture.pool.get("spectator");
    await spectator.page.goto(room.inviteUrl);
    const spectatorRoom = roomPage(spectator);
    await observeProduct(
      async () => await spectatorRoom.join("Spectator", "spectator"),
      productContext(coordinates, "EXP-003-A01", "spectator", { joinControlUsable: false }, { joinControlUsable: true })
    );
    await waitForJoinFlowHidden(
      spectator.page,
      productContext(coordinates, "EXP-003-A01", "spectator", { joinFlowHidden: false }, { joinFlowHidden: true })
    );
    await fixture.pool.startTraceAfterBootstrap("spectator", { traceReady: true });
    fixture.evidenceActor = spectator;

    const synchronizedViews = [
      ...Object.entries(roomByRole).map(([role, roomPage]) => ({
        actor: role,
        participantId: participantIds[role as keyof typeof participantIds],
        roomPage,
        page: actorByRole[role as keyof typeof actorByRole].page
      })),
      { actor: "spectator", participantId: null, roomPage: spectatorRoom, page: spectator.page }
    ];
    const initialDeadline = performance.now() + 3_000;
    const initialExpected: ExpectedView = {
      handNumber: 1,
      street: "preflop",
      boardLength: 0,
      pot: 30,
      actor: participantIds.button
    };
    const initial = await observeProduct(
      async () => await waitForConvergedViews(synchronizedViews, initialExpected, initialDeadline),
      productContext(coordinates, "EXP-003-A03", "all-actors", { synchronizedViewsObserved: false }, { synchronizedViewsObserved: true })
    );
    assertDeadStateDuration(
      initial.elapsedMs,
      mechanicalContext(coordinates, "EXP-003-A05", "all-actors", [])
    );

    const transitionTimings: Array<{ actionId: string; localMs: number; convergenceMs: number }> = [];
    for (let index = 0; index < normalFixture.actionPlan.length; index += 1) {
      const action = normalFixture.actionPlan[index];
      const transition = normalFixture.oracle.transitions[index];
      const actor = actorByRole[action.actorRole];
      const actionRoom = roomByRole[action.actorRole];
      const legalBefore = index === 0
        ? (["fold", "call", "raise", "all-in"] as const)
        : normalFixture.oracle.transitions[index - 1].legalPrimaryActions;
      await assertContextValidActions(
        synchronizedViews,
        participantIds[action.actorRole],
        legalBefore,
        coordinates,
        action.id
      );
      const before = await observeProduct(
        async () => await actionRoom.readProjection(),
        productContext(coordinates, "EXP-003-A01", action.actorRole, { projectionObserved: false }, { projectionObserved: true })
      );
      assertProductCondition(
        before.actor === participantIds[action.actorRole] && before.street === action.street,
        productContext(coordinates, "EXP-003-A01", action.actorRole, before, {
          actor: participantIds[action.actorRole],
          street: action.street,
          actionId: action.id
        })
      );

      const clickedAt = performance.now();
      await observeProduct(
        async () => await performFixtureAction(actionRoom, action),
        productContext(
          coordinates,
          "EXP-003-A04",
          action.actorRole,
          { actionId: action.id, controlUsable: false },
          { actionId: action.id, controlUsable: true }
        )
      );
      const expected: ExpectedView = {
        handNumber: 1,
        street: transition.street,
        boardLength: transition.boardLength,
        pot: transition.pot,
        actor: transition.actorRole === null ? null : participantIds[transition.actorRole]
      };
      const local = await observeProduct(
        async () => await waitForLocalProjection(actionRoom, expected, clickedAt + 800),
        productContext(coordinates, "EXP-003-A02", action.actorRole, { localProjectionObserved: false }, { localProjectionObserved: true })
      );
      const localMs = local.observedAtMs - clickedAt;
      assertLocalFeedback(
        localMs,
        mechanicalContext(coordinates, "EXP-003-A02", action.actorRole, []),
        local.projection
      );
      const converged = await observeProduct(
        async () => await waitForConvergedViews(
          synchronizedViews,
          expected,
          clickedAt + 1_000
        ),
        productContext(coordinates, "EXP-003-A03", "all-actors", { synchronizedViewsObserved: false }, { synchronizedViewsObserved: true })
      );
      const convergenceMs = converged.observedAtMs - clickedAt;
      assertCrossViewConvergence(
        convergenceMs,
        mechanicalContext(coordinates, "EXP-003-A03", "all-actors", []),
        converged.earliestDivergence
      );
      assertSynchronizedViews(
        [{
          monotonicMs: convergenceMs,
          projections: converged.views.map(({ actor: viewActor, projection }) => ({
            actor: viewActor,
            projection
          }))
        }],
        synchronizedViews.map(({ actor: viewActor }) => viewActor),
        mechanicalContext(coordinates, "EXP-003-A03", "all-actors", [])
      );
      assertProductCondition(
        converged.commitmentsEqual,
        productContext(
          coordinates,
          "EXP-003-A03",
          "all-actors",
          converged.views.map(({ actor: viewActor, commitments }) => ({ actor: viewActor, commitments })),
          "exact street-commitment equality across every view"
        )
      );
      assertDeadStateDuration(
        convergenceMs,
        mechanicalContext(coordinates, "EXP-003-A05", action.actorRole, [])
      );
      transitionTimings.push({ actionId: action.id, localMs, convergenceMs });
      await fixture.recorder.recordEvent({
        actor: action.actorRole,
        stage: action.id,
        type: "betting-transition",
        status: "pass",
        details: {
          action: action.action.type,
          street: expected.street,
          boardLength: expected.boardLength,
          pot: expected.pot,
          nextActorRole: transition.actorRole,
          localFeedbackMs: localMs,
          convergenceMs
        },
        handNumber: 1
      });
      if (index === 5) {
        await captureAndRegister(fixture, spectatorRoom, "normal-betting-flop-raise");
      }
    }

    await assertContextValidActions(
      synchronizedViews,
      null,
      [],
      coordinates,
      "normal-plan-complete"
    );
    const finalScreenshot = await captureAndRegister(fixture, spectatorRoom, "normal-betting-complete");
    await recordAssertionPass(fixture, "EXP-003-A01", "all-actors", {
      completedActionIds: normalFixture.actionPlan.map(({ id }) => id)
    }, [finalScreenshot.id]);
    await recordAssertionPass(fixture, "EXP-003-A02", "all-actors", { transitionTimings });
    await recordAssertionPass(fixture, "EXP-003-A03", "all-actors", {
      transitionTimings,
      synchronizedFields: ["handNumber", "street", "boardLength", "pot", "actor", "streetCommitments"]
    });
    await recordAssertionPass(fixture, "EXP-003-A04", "all-actors", {
      checkedBeforeEveryAction: true,
      checkedAfterCompletion: true
    });
    await recordAssertionPass(fixture, "EXP-003-A05", "all-actors", {
      maximumTransitionMs: Math.max(...transitionTimings.map(({ convergenceMs }) => convergenceMs))
    });
    return finishPassingCase(fixture, "EXP-003");
  });
});

interface ScenarioEnvironment {
  runId: string;
  baseUrl: string;
  outputRoot: string;
  caseOutputRoot: string;
  fixtureSeedBroker: {
    endpoint: string;
    authorizationToken: string;
  };
}

class ScenarioSecrets implements KnownSecretRegistry {
  readonly values: string[];

  constructor(initial: readonly string[]) {
    this.values = [...initial];
  }

  add(secret: string | Uint8Array): void {
    const value = typeof secret === "string" ? secret : Buffer.from(secret).toString("utf8");
    if (value.length > 0 && !this.values.includes(value)) this.values.push(value);
  }
}

interface ActorCaseFixture {
  environment: ScenarioEnvironment;
  pool: ActorPool;
  recorder: EvidenceRecorder;
  secrets: ScenarioSecrets;
  outputRoot: string;
  assertionEvents: Map<string, EvidenceEvent[]>;
  artifactIds: Set<string>;
  evidenceActor: ActorHandle | null;
}

interface ActorCaseExecution {
  fixture: ActorCaseFixture;
  coordinates: AttemptCoordinates;
}

async function runActorCase(
  environment: ScenarioEnvironment,
  browser: Browser,
  caseId: keyof typeof PRODUCT_ASSERTION_IDS,
  execute: (input: ActorCaseExecution) => Promise<FinishCaseInput>
): Promise<void> {
  const recorders = new Map<string, EvidenceRecorder>();
  const secrets = new ScenarioSecrets([
    environment.fixtureSeedBroker.authorizationToken
  ]);

  await runExperienceCase({
    runId: environment.runId,
    caseId,
    recorderFactory: (coordinates) => {
      const recorder = createRecorder(environment, coordinates, secrets.values);
      recorders.set(attemptKey(coordinates.caseId, coordinates.attemptId), recorder);
      return recorder;
    },
    createFixture: async (coordinates) => {
      const recorder = requiredRecorder(recorders, coordinates);
      const outputRoot = join(
        environment.outputRoot,
        "cases",
        coordinates.caseId,
        coordinates.attemptId
      );
      const pool = new ActorPool({
        browser,
        outputRoot,
        telemetrySink: async (event) => await recordTelemetry(recorder, event)
      });
      await pool.createActors({ playerCount: 4, includeSpectator: true });
      return {
        environment,
        pool,
        recorder,
        secrets,
        outputRoot,
        assertionEvents: new Map(),
        artifactIds: new Set(),
        evidenceActor: null
      } satisfies ActorCaseFixture;
    },
    execute: async ({ runId, caseId: executingCase, attemptId, fixture }) => {
      try {
        return await execute({
          fixture,
          coordinates: { runId, caseId: executingCase, attemptId }
        });
      } catch (error) {
        const artifact = await captureFailureScreenshot(environment, fixture).catch(() => null);
        if (error instanceof ProductAssertionError && artifact) {
          throw new ProductAssertionError({
            ...error.context,
            artifactIds: [...new Set([...error.context.artifactIds, artifact.id])]
          });
        }
        throw error;
      }
    },
    disposeFixture: async (fixture) => await disposeActorFixture(environment, fixture),
    persistFallbackReport: async (coordinates, input) =>
      await createRecorder(environment, coordinates, secrets.values).finishCase(input)
  });
}

function createRecorder(
  environment: ScenarioEnvironment,
  coordinates: AttemptCoordinates,
  knownSecrets: readonly string[]
): EvidenceRecorder {
  return new EvidenceRecorder({
    outputRoot: join(environment.caseOutputRoot, coordinates.caseId, coordinates.attemptId),
    runId: coordinates.runId,
    caseId: coordinates.caseId,
    attemptId: coordinates.attemptId,
    actor: "scenario",
    knownSecrets
  });
}

async function disposeActorFixture(
  environment: ScenarioEnvironment,
  fixture: ActorCaseFixture
): Promise<void> {
  const evidenceActor = fixture.evidenceActor;
  let closeError: unknown;
  try {
    await fixture.pool.closeAll();
  } catch (error) {
    closeError = error;
  }
  if (evidenceActor) {
    if (await isFile(evidenceActor.tracePath)) {
      await recordArtifact(fixture, environment, {
        id: `${slug(relative(environment.outputRoot, fixture.outputRoot))}-trace`,
        path: artifactPath(environment.outputRoot, evidenceActor.tracePath),
        description: `Tokenless spectator trace for ${relative(environment.outputRoot, fixture.outputRoot)}`,
        kind: "trace",
        mediaType: "application/zip"
      });
    }
    const videoFiles = (await readdir(evidenceActor.videoDirectory).catch(() => []))
      .filter((name) => name.endsWith(".webm"));
    if (videoFiles[0]) {
      const videoPath = join(evidenceActor.videoDirectory, videoFiles[0]);
      await recordArtifact(fixture, environment, {
        id: `${slug(relative(environment.outputRoot, fixture.outputRoot))}-video`,
        path: artifactPath(environment.outputRoot, videoPath),
        description: `Desktop spectator video for ${relative(environment.outputRoot, fixture.outputRoot)}`,
        kind: "video",
        mediaType: "video/webm"
      });
    }
  }
  if (closeError) throw closeError;
}

async function recordTelemetry(recorder: EvidenceRecorder, event: TelemetryEvent): Promise<void> {
  await recorder.recordEvent({
    actor: typeof event.details.actor === "string" ? event.details.actor : "browser",
    stage: "browser-telemetry",
    type: event.kind,
    status: event.kind.includes("error") || event.kind === "request-failure" ? "observed-error" : "observed",
    details: { browserMonotonicMs: event.monotonicMs, ...event.details }
  });
}

async function recordAssertionPass(
  fixture: ActorCaseFixture,
  assertionId: string,
  actor: string,
  details: Record<string, unknown>,
  artifactIds: string[] = []
): Promise<void> {
  const event = await fixture.recorder.recordEvent({
    actor,
    stage: assertionId,
    type: "product-assertion",
    status: "pass",
    details,
    artifactIds
  });
  const events = fixture.assertionEvents.get(assertionId) ?? [];
  events.push(event);
  fixture.assertionEvents.set(assertionId, events);
}

function finishPassingCase(
  fixture: ActorCaseFixture,
  caseId: keyof typeof PRODUCT_ASSERTION_IDS
): FinishCaseInput {
  const assertions = PRODUCT_ASSERTION_IDS[caseId].map((id) => {
    const events = fixture.assertionEvents.get(id) ?? [];
    if (events.length === 0) throw new Error(`Passing case omitted assertion evidence: ${id}`);
    return {
      id,
      outcome: "pass" as const,
      evidenceEventIds: events.map(({ id: eventId }) => eventId),
      summary: `${id} passed through the rendered UI and authoritative WebSocket path.`
    };
  });
  const evidenceEventIds = assertions.flatMap(({ evidenceEventIds }) => evidenceEventIds);
  return {
    verdict: "PASS",
    results: {
      product: { status: "pass", summary: "Every declared product assertion passed.", evidenceEventIds: [...evidenceEventIds] },
      harness: { status: "pass", summary: "Browser, fixture, telemetry, and evidence capture completed.", evidenceEventIds: [...evidenceEventIds] },
      environment: { status: "pass", summary: "The verified isolated stack remained available.", evidenceEventIds: [] }
    },
    assertions,
    failures: []
  };
}

function roomPage(actor: ActorHandle): RoomPage {
  return new RoomPage(actor.page, {
    actor: actor.metadata.id,
    screenshotNamespace: actor.screenshotNamespace,
    telemetry: actor.telemetry
  });
}

async function captureAndRegister(
  fixture: ActorCaseFixture,
  page: RoomPage,
  checkpoint: string
): Promise<ArtifactRecord> {
  const captured = await page.captureCheckpoint(checkpoint);
  const { environment } = fixture;
  return await recordArtifact(fixture, environment, {
    id: `${slug(relative(environment.outputRoot, fixture.outputRoot))}-${captured.artifactId}`,
    path: artifactPath(environment.outputRoot, captured.path),
    description: `Rendered checkpoint: ${checkpoint}`,
    kind: "screenshot",
    mediaType: "image/png",
    metadata: { projection: captured.projection }
  });
}

async function captureFailureScreenshot(
  environment: ScenarioEnvironment,
  fixture: ActorCaseFixture
): Promise<ArtifactRecord> {
  const actor = fixture.evidenceActor ?? fixture.pool.list()[0];
  if (!actor) throw new Error("No actor exists for failure evidence");
  const path = join(actor.screenshotNamespace, "scenario-failure.png");
  await mkdir(actor.screenshotNamespace, { recursive: true });
  await actor.page.screenshot({ path, fullPage: true });
  return await recordArtifact(fixture, environment, {
    id: `${slug(relative(environment.outputRoot, fixture.outputRoot))}-failure`,
    path: artifactPath(environment.outputRoot, path),
    description: "Scenario failure checkpoint",
    kind: "screenshot",
    mediaType: "image/png"
  });
}

async function recordArtifact(
  fixture: ActorCaseFixture,
  environment: ScenarioEnvironment,
  artifact: Omit<ArtifactRecord, "required"> & { required?: boolean }
): Promise<ArtifactRecord> {
  if (fixture.artifactIds.has(artifact.id)) {
    throw new Error(`Duplicate scenario artifact: ${artifact.id}`);
  }
  const recorded = await fixture.recorder.recordArtifact({ ...artifact, required: artifact.required ?? true });
  fixture.artifactIds.add(recorded.id);
  return recorded;
}

interface SeatState {
  seatNumber: number;
  participantId: string | null;
  status: string | null;
}

async function readSeatState(page: Page): Promise<SeatState[]> {
  return await page.locator("[data-seat-number]").evaluateAll((seats) => seats.map((seat) => {
    const element = seat as HTMLElement;
    return {
      seatNumber: Number(element.dataset.seatNumber),
      participantId: element.dataset.participantId ?? null,
      status: element.dataset.seatStatus ?? null
    };
  }).sort((left, right) => left.seatNumber - right.seatNumber));
}

async function readSafeRoomState(
  room: RoomPage,
  page: Page,
  context: Parameters<typeof observeProduct>[1]
): Promise<{
  projection: ViewProjection;
  seats: SeatState[];
}> {
  return await observeProduct(async () => {
    const [projection, seats] = await Promise.all([
      room.readProjection(),
      readSeatState(page)
    ]);
    return { projection, seats };
  }, context);
}

interface SeatingLayout {
  seatCount: number;
  feltRendered: boolean;
  renderedSeatCount: number;
  order: number[];
  tableCenterX: number;
  tableWidth: number;
  local: { centerX: number; centerY: number } | null;
  seats: Array<{
    seatNumber: number;
    occupied: boolean;
    accessibleName: string;
    text: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    centerX: number;
    centerY: number;
  }>;
}

async function readSeatingLayout(page: Page, seatCount: number): Promise<SeatingLayout> {
  return await page.locator('[aria-label="Table"]').evaluate((table, expectedSeatCount) => {
    const felt = table.querySelector<HTMLElement>(".felt-stage");
    const tableRect = (felt ?? table).getBoundingClientRect();
    const seats = Array.from(table.querySelectorAll<HTMLElement>("[data-seat-number]")).map((seat) => {
      const rect = seat.getBoundingClientRect();
      return {
        seatNumber: Number(seat.dataset.seatNumber),
        occupied: seat.dataset.seatStatus !== "empty",
        accessibleName: seat.getAttribute("aria-label") ?? "",
        text: seat.innerText,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        local: seat.dataset.localSeat === "true"
      };
    });
    const local = seats.find((seat) => seat.local);
    return {
      seatCount: expectedSeatCount,
      feltRendered: felt !== null,
      renderedSeatCount: seats.length,
      order: seats.map(({ seatNumber }) => seatNumber),
      tableCenterX: tableRect.left + tableRect.width / 2,
      tableWidth: tableRect.width,
      local: local === undefined ? null : { centerX: local.centerX, centerY: local.centerY },
      seats: seats.map(({ local: _local, ...seat }) => seat)
    };
  }, seatCount);
}

function hasOverlappingSeats(seats: SeatingLayout["seats"]): boolean {
  for (let left = 0; left < seats.length; left += 1) {
    for (let right = left + 1; right < seats.length; right += 1) {
      const a = seats[left];
      const b = seats[right];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) return true;
    }
  }
  return false;
}

interface ExpectedView {
  handNumber: number;
  street: string;
  boardLength: number;
  pot: number;
  actor: string | null;
}

interface SynchronizedView {
  actor: string;
  participantId: string | null;
  roomPage: RoomPage;
  page: Page;
}

interface ObservedView {
  actor: string;
  projection: ViewProjection;
  commitments: Array<{ seatNumber: number; amount: string }>;
}

async function waitForLocalProjection(
  room: RoomPage,
  expected: ExpectedView,
  deadline: number
): Promise<{ projection: ViewProjection; observedAtMs: number }> {
  let projection = await room.readProjection();
  let observedAtMs = performance.now();
  while (performance.now() <= deadline) {
    if (matchesExpectedView(projection, expected)) return { projection, observedAtMs };
    await delay(20);
    projection = await room.readProjection();
    observedAtMs = performance.now();
  }
  return { projection, observedAtMs };
}

async function waitForConvergedViews(
  views: SynchronizedView[],
  expected: ExpectedView,
  deadline: number
): Promise<{
  elapsedMs: number;
  observedAtMs: number;
  views: ObservedView[];
  commitmentsEqual: boolean;
  earliestDivergence: unknown;
}> {
  const startedAt = performance.now();
  let observed = await readObservedViews(views);
  let observedAtMs = performance.now();
  while (observedAtMs <= deadline) {
    const commitmentsEqual = sameCommitments(observed);
    if (commitmentsEqual && observed.every(({ projection }) => matchesExpectedView(projection, expected))) {
      return {
        elapsedMs: observedAtMs - startedAt,
        observedAtMs,
        views: observed,
        commitmentsEqual,
        earliestDivergence: null
      };
    }
    await delay(20);
    observed = await readObservedViews(views);
    observedAtMs = performance.now();
  }
  const commitmentsEqual = sameCommitments(observed);
  return {
    elapsedMs: observedAtMs - startedAt,
    observedAtMs,
    views: observed,
    commitmentsEqual,
    earliestDivergence: {
      expected,
      observed: observed.map(({ actor, projection, commitments }) => ({ actor, projection, commitments }))
    }
  };
}

async function readObservedViews(views: SynchronizedView[]): Promise<ObservedView[]> {
  return await Promise.all(views.map(async (view) => ({
    actor: view.actor,
    projection: await view.roomPage.readProjection(),
    commitments: await readCommitments(view.page)
  })));
}

async function readCommitments(page: Page): Promise<Array<{ seatNumber: number; amount: string }>> {
  return await page.locator("[data-seat-number]").evaluateAll((seats) => seats.map((seat) => {
    const element = seat as HTMLElement;
    return {
      seatNumber: Number(element.dataset.seatNumber),
      amount: element.querySelector<HTMLElement>(".seat-bet-amount")?.innerText.trim() ?? "0"
    };
  }).sort((left, right) => left.seatNumber - right.seatNumber));
}

function sameCommitments(views: ObservedView[]): boolean {
  const first = JSON.stringify(views[0]?.commitments ?? []);
  return views.length > 0 && views.every(({ commitments }) => JSON.stringify(commitments) === first);
}

function matchesExpectedView(projection: ViewProjection, expected: ExpectedView): boolean {
  return projection.handNumber === expected.handNumber &&
    projection.street === expected.street &&
    projection.boardLength === expected.boardLength &&
    projection.pot === expected.pot &&
    projection.actor === expected.actor;
}

async function assertContextValidActions(
  views: SynchronizedView[],
  expectedActorId: string | null,
  expectedActions: readonly FixturePrimaryAction[],
  coordinates: AttemptCoordinates,
  checkpoint: string
): Promise<void> {
  const observed = await observeProduct(
    async () => await Promise.all(views.map(async (view) => ({
      actor: view.actor,
      participantId: view.participantId,
      enabled: await view.page.locator("[data-action-type]:not([disabled])").evaluateAll((buttons) =>
        buttons.map((button) => (button as HTMLElement).dataset.actionType ?? "").filter(Boolean).sort()
      )
    }))),
    productContext(
      coordinates,
      "EXP-003-A04",
      checkpoint,
      { validActionsObserved: false },
      { validActionsObserved: true }
    )
  );
  const expectedSorted = [...expectedActions].sort();
  const valid = observed.every(({ participantId, enabled }) => {
    const expected = participantId === expectedActorId ? expectedSorted : [];
    return JSON.stringify(enabled) === JSON.stringify(expected);
  });
  assertProductCondition(
    valid,
    productContext(coordinates, "EXP-003-A04", checkpoint, observed, {
      expectedActorId,
      expectedActions: expectedSorted,
      allOtherViews: []
    })
  );
}

async function performFixtureAction(room: RoomPage, action: FixturePlayerAction): Promise<void> {
  const amountTo = "amountTo" in action.action ? action.action.amountTo : undefined;
  await room.performAction(action.action.type, amountTo);
}

async function waitForSeat(
  page: Page,
  seatNumber: number,
  displayName: string,
  context: Parameters<typeof observeProduct>[1]
): Promise<void> {
  await observeProduct(
    async () => await page.getByRole("button", {
      name: `Seat ${seatNumber} occupied by ${displayName}`,
      exact: true
    }).waitFor({ state: "visible", timeout: 3_000 }),
    context
  );
}

async function waitForJoinFlowHidden(
  page: Page,
  context: Parameters<typeof observeProduct>[1]
): Promise<void> {
  await observeProduct(
    async () => await page.getByRole("dialog", { name: "Join flow" })
      .waitFor({ state: "hidden", timeout: 3_000 }),
    context
  );
}

async function bootstrapObservedIdentity(
  options: Parameters<typeof bootstrapBrowserIdentity>[0],
  context: Parameters<typeof observeProduct>[1]
): ReturnType<typeof bootstrapBrowserIdentity> {
  return await observeProduct(
    async () => await bootstrapBrowserIdentity(options),
    context
  );
}

async function sendDisposableCommand(
  baseUrl: string,
  message: Record<string, unknown>
): Promise<{ code: string; message: string; payloadKeys: string[] }> {
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(Object.assign(new Error("Disposable authority WebSocket timed out"), {
        name: "TimeoutError"
      }));
    }, 3_000);
    socket.once("open", () => socket.send(JSON.stringify(message)));
    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isRecord(parsed) || parsed.type !== "error" || !isRecord(parsed.payload)) return;
      const code = parsed.payload.code;
      const errorMessage = parsed.payload.message;
      if (typeof code !== "string" || typeof errorMessage !== "string") return;
      const payloadKeys = Object.keys(parsed.payload).sort();
      clearTimeout(timer);
      socket.close();
      resolve({ code, message: errorMessage, payloadKeys });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function productContext(
  coordinates: AttemptCoordinates,
  assertionId: string,
  actor: string,
  measuredValue: unknown,
  threshold: unknown,
  artifactIds: readonly string[] = []
) {
  return {
    assertionId,
    caseId: coordinates.caseId,
    attemptId: coordinates.attemptId,
    actor,
    earliestDivergentProjection: null,
    measuredValue,
    threshold,
    artifactIds
  };
}

function mechanicalContext(
  coordinates: AttemptCoordinates,
  assertionId: string,
  actor: string,
  artifactIds: readonly string[]
) {
  return {
    assertionId,
    caseId: coordinates.caseId,
    attemptId: coordinates.attemptId,
    actor,
    artifactIds
  };
}

function readScenarioEnvironment(): ScenarioEnvironment {
  if (!FIXTURE_SEED_BROKER) {
    throw new Error("Fixture seed broker was not provided to the isolated scenario worker");
  }
  return {
    runId: requiredEnvironment("SITE_TEST_RUN_ID"),
    baseUrl: requiredEnvironment("SITE_TEST_ISOLATED_BASE_URL"),
    outputRoot: requiredEnvironment("SITE_TEST_OUTPUT_ROOT"),
    caseOutputRoot: requiredEnvironment("SITE_TEST_CASE_OUTPUT_ROOT"),
    fixtureSeedBroker: FIXTURE_SEED_BROKER
  };
}

function requiredRecorder(
  recorders: ReadonlyMap<string, EvidenceRecorder>,
  coordinates: AttemptCoordinates
): EvidenceRecorder {
  const recorder = recorders.get(attemptKey(coordinates.caseId, coordinates.attemptId));
  if (!recorder) throw new Error(`Recorder was not initialized for ${coordinates.caseId}/${coordinates.attemptId}`);
  return recorder;
}

function caseTimeout(caseId: string): number {
  const manifest = EXPERIENCE_CASES.find((candidate) => candidate.caseId === caseId);
  if (!manifest) throw new Error(`Unknown experience case: ${caseId}`);
  return manifest.stopConditions.overallTimeoutMs + 15_000;
}

function roomIdFromUrl(url: URL): string {
  const match = url.pathname.match(/^\/room\/([^/]+)$/);
  if (!match) throw new Error("Rendered invite link did not target a room");
  return decodeURIComponent(match[1]);
}

function ownershipName(runId: string, role: string): string {
  const name = `SITE-${runId}-${role}`;
  if (name.length > 24) throw new Error(`Ownership marker exceeds nickname limit: ${name}`);
  return name;
}

function artifactPath(outputRoot: string, absolutePath: string): string {
  const result = relative(outputRoot, absolutePath);
  if (result.startsWith("..")) throw new Error(`Artifact escaped the run root: ${absolutePath}`);
  return result.replaceAll("\\", "/");
}

function attemptKey(caseId: string, attemptId: string): string {
  return `${caseId}/${attemptId}`;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required scenario environment: ${name}`);
  return value;
}
