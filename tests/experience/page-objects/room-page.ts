import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { ViewProjection } from "../assertions/synchronization";
import type { BrowserTelemetry, TelemetryEvent } from "../support/telemetry";

export type RoomAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface RoomPageOptions {
  actor: string;
  screenshotNamespace: string;
  telemetry?: BrowserTelemetry;
}

export interface CapturedCheckpoint {
  artifactId: string;
  path: string;
  projection: ViewProjection;
  telemetryEvent: TelemetryEvent | null;
}

export class RoomPage {
  constructor(
    private readonly page: Page,
    private readonly options: RoomPageOptions
  ) {}

  async join(displayName: string, role: "player" | "spectator" = "player"): Promise<void> {
    if (role === "spectator") {
      await this.page.getByRole("button", { name: "Spectate" }).click();
      return;
    }
    await this.page.getByRole("textbox", { name: "Nickname" }).fill(displayName);
    await this.page.getByRole("button", { name: "Join" }).click();
  }

  async claimSeat(seatNumber: number): Promise<void> {
    await this.page.getByRole("button", { name: `Claim seat ${seatNumber}` }).click();
  }

  async openHostControls(): Promise<void> {
    const popover = this.page.locator("details.host-popover");
    if (await popover.getAttribute("open") === null) {
      await this.page.getByText("Host tools", { exact: true }).click();
    }
  }

  async startRoom(): Promise<void> {
    await this.page.getByRole("button", { name: "Start room" }).click();
  }

  async performAction(action: RoomAction, amountTo?: number): Promise<void> {
    if ((action === "bet" || action === "raise") && amountTo !== undefined) {
      await this.page.getByRole("slider", { name: "Bet amount slider" }).fill(String(amountTo));
    }
    await this.page.locator(`[data-action-type="${action}"]`).click();
  }

  async queueTopUp(amount: number): Promise<void> {
    const popover = this.page.locator("details.top-up-popover");
    if (await popover.getAttribute("open") === null) {
      await this.page.getByText("Add chips", { exact: true }).click();
    }
    await this.page.getByRole("spinbutton", { name: "Add chips amount" }).fill(String(amount));
    await this.page.getByRole("button", { name: "Add next hand" }).click();
  }

  async requestRoomEnd(): Promise<void> {
    await this.openHostControls();
    await this.page.getByRole("button", { name: "End room" }).click();
  }

  async waitForPhase(
    phase: string,
    options: { sequence?: number; timeout?: number } = {}
  ): Promise<void> {
    const sequenceSelector = options.sequence === undefined
      ? ""
      : `[data-flow-sequence="${options.sequence}"]`;
    await this.page
      .locator(`[aria-label="Table"][data-flow-phase="${phase}"]${sequenceSelector}`)
      .waitFor({ state: "visible", timeout: options.timeout });
  }

  async readProjection(): Promise<ViewProjection> {
    return this.page.locator('[aria-label="Table"]').evaluate((table) => {
      const element = table as HTMLElement;
      return {
        phase: element.dataset.flowPhase ?? null,
        sequence: numberValue(element.dataset.flowSequence),
        handNumber: numberValue(element.dataset.handNumber),
        street: element.dataset.street ?? null,
        boardLength: numberValue(element.dataset.boardCardCount) ?? 0,
        pot: numberValue(element.dataset.pot) ?? 0,
        actor: element.dataset.actorId ?? null
      };

      function numberValue(value: string | undefined): number | null {
        if (value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
    });
  }

  async captureCheckpoint(checkpoint: string): Promise<CapturedCheckpoint> {
    const slug = slugify(checkpoint);
    const path = join(this.options.screenshotNamespace, `${slug}.png`);
    const projection = await this.readProjection();
    const telemetryEvent = this.options.telemetry
      ? await this.options.telemetry.captureDomCheckpoint(checkpoint)
      : null;
    await this.page.screenshot({ path, fullPage: true });
    return {
      artifactId: `screenshot-${slugify(this.options.actor)}-${slug}`,
      path,
      projection,
      telemetryEvent
    };
  }
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) {
    throw new Error("Checkpoint name must contain a letter or number");
  }
  return slug;
}
