import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import {
  installBrowserTelemetry,
  type BrowserTelemetry,
  type TelemetrySink
} from "./telemetry";

export type ActorRole = "host" | "player" | "spectator";

export interface ActorMetadata {
  id: string;
  role: ActorRole;
  playerIndex: number | null;
}

export interface ActorHandle {
  metadata: ActorMetadata;
  context: BrowserContext;
  page: Page;
  telemetry: BrowserTelemetry;
  videoDirectory: string;
  screenshotNamespace: string;
  tracePath: string;
  traceStarted: boolean;
}

export interface ActorPoolOptions {
  browser: Browser;
  outputRoot: string;
  telemetrySink: TelemetrySink;
  contextOptions?: BrowserContextOptions;
}

export class ActorPool {
  private readonly actors = new Map<string, ActorHandle>();
  private readonly partialContexts = new Set<BrowserContext>();

  constructor(private readonly options: ActorPoolOptions) {}

  async createActors(input: {
    playerCount: number;
    includeSpectator?: boolean;
  }): Promise<readonly ActorHandle[]> {
    if (!Number.isInteger(input.playerCount) || input.playerCount < 4 || input.playerCount > 6) {
      throw new Error("ActorPool requires four to six players");
    }
    if (this.actors.size > 0) {
      throw new Error("ActorPool actors have already been created");
    }

    const metadata: ActorMetadata[] = [
      { id: "host", role: "host", playerIndex: null },
      ...Array.from({ length: input.playerCount }, (_, index) => ({
        id: `player-${index + 1}`,
        role: "player" as const,
        playerIndex: index + 1
      })),
      ...(input.includeSpectator === false
        ? []
        : [{ id: "spectator", role: "spectator" as const, playerIndex: null }])
    ];

    try {
      for (const actor of metadata) {
        await this.createActor(actor);
      }
    } catch (creationError) {
      try {
        await this.closeAll();
      } catch (cleanupError) {
        throw new AggregateError(
          [creationError, cleanupError],
          `ActorPool creation and cleanup failed: ${errorMessage(creationError)}; ${errorMessage(cleanupError)}`
        );
      }
      throw creationError;
    }
    return this.list();
  }

  list(): readonly ActorHandle[] {
    return [...this.actors.values()];
  }

  get(actorId: string): ActorHandle {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Unknown actor: ${actorId}`);
    }
    return actor;
  }

  async recreateActor(actorId: string): Promise<ActorHandle> {
    const actor = this.get(actorId);
    const storageState = await actor.context.storageState();
    const failures: unknown[] = [];
    if (actor.traceStarted) {
      try {
        await actor.context.tracing.stop({ path: actor.tracePath });
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await actor.context.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await actor.telemetry.flush();
    } catch (error) {
      failures.push(error);
    }
    this.actors.delete(actorId);
    if (failures.length > 0) {
      throw new AggregateError(failures, `Actor ${actorId} could not be closed for recreation`);
    }
    await this.createActor(actor.metadata, { storageState });
    return this.get(actorId);
  }

  async startTraceAfterBootstrap(
    actorId: string,
    identity: { traceReady: true }
  ): Promise<void> {
    if (identity.traceReady !== true) {
      throw new Error(`Actor ${actorId} identity is not traceReady`);
    }
    const actor = this.get(actorId);
    if (actor.traceStarted) {
      throw new Error(`Actor ${actorId} trace already started`);
    }
    await actor.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    actor.traceStarted = true;
  }

  async startJourneyTraceBeforeNavigation(actorId: string): Promise<void> {
    const actor = this.get(actorId);
    if (actor.traceStarted) throw new Error(`Actor ${actorId} trace already started`);
    // Action/screenshot-only trace covers visible join without retaining response
    // bodies that contain the participant credential created by that join.
    await actor.context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    actor.traceStarted = true;
  }

  async closeAll(): Promise<void> {
    const failures: unknown[] = [];
    await Promise.all(this.list().map(async (actor) => {
      if (actor.traceStarted) {
        try {
          await actor.context.tracing.stop({ path: actor.tracePath });
        } catch (error) {
          failures.push(error);
        } finally {
          actor.traceStarted = false;
        }
      }
      try {
        await actor.context.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await actor.telemetry.flush();
      } catch (error) {
        failures.push(error);
      }
    }));
    this.actors.clear();
    await Promise.all([...this.partialContexts].map(async (context) => {
      try {
        await context.close();
        this.partialContexts.delete(context);
      } catch (error) {
        failures.push(error);
      }
    }));
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `ActorPool closeAll failed: ${failures.map(errorMessage).join("; ")}`
      );
    }
  }

  private async createActor(metadata: ActorMetadata, overrides: BrowserContextOptions = {}): Promise<void> {
    const videoDirectory = join(this.options.outputRoot, "videos", metadata.id);
    const screenshotNamespace = join(this.options.outputRoot, "screenshots", metadata.id);
    const tracePath = join(this.options.outputRoot, "traces", `${metadata.id}.zip`);
    await Promise.all([
      mkdir(videoDirectory, { recursive: true }),
      mkdir(screenshotNamespace, { recursive: true }),
      mkdir(join(this.options.outputRoot, "traces"), { recursive: true })
    ]);
    const context = await this.options.browser.newContext({
      ...this.options.contextOptions,
      ...overrides,
      recordVideo: { dir: videoDirectory }
    });
    this.partialContexts.add(context);
    try {
      const page = await context.newPage();
      const telemetry = await installBrowserTelemetry(
        page,
        metadata.id,
        this.options.telemetrySink
      );
      this.actors.set(metadata.id, {
        metadata,
        context,
        page,
        telemetry,
        videoDirectory,
        screenshotNamespace,
        tracePath,
        traceStarted: false
      });
      this.partialContexts.delete(context);
    } catch (error) {
      try {
        await context.close();
        this.partialContexts.delete(context);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Actor context creation failed: ${errorMessage(error)}; cleanup failed: ${errorMessage(cleanupError)}`
        );
      }
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
