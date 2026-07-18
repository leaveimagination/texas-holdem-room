import type { Page } from "@playwright/test";
import type { RoomSettings } from "@/lib/room/settings";

export interface CreatedRoomLinks {
  roomId: string;
  inviteUrl: string;
  hostUrl: string;
}

export class CreateRoomPage {
  private readonly createUrl: string;

  constructor(
    private readonly page: Page,
    baseUrl: string
  ) {
    this.createUrl = new URL("/create", baseUrl).toString();
  }

  async goto(): Promise<void> {
    await this.page.goto(this.createUrl);
  }

  async create(
    settings: RoomSettings,
    onRoomCreated?: (identity: { roomId: string }) => Promise<void>
  ): Promise<CreatedRoomLinks> {
    await this.page.getByLabel("Mode").selectOption(settings.mode);
    await this.page.getByLabel("Seats").selectOption(String(settings.seats));
    await this.page.getByLabel("Initial chips").fill(String(settings.initialChips));
    await this.page.getByLabel("Small blind").fill(String(settings.smallBlind));
    await this.page.getByLabel("Big blind").fill(String(settings.bigBlind));
    await this.page.getByLabel("Action timer seconds").fill(
      settings.actionTimerSeconds === null ? "" : String(settings.actionTimerSeconds)
    );
    if (settings.mode === "tournament") {
      await this.page.getByLabel("Blind increase").selectOption(settings.blindIncrease.type);
      await this.page.getByLabel("Interval").fill(String(settings.blindIncrease.interval));
    }
    const creationResponse = this.page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms"
    );
    await this.page.getByRole("button", { name: "Create" }).click();
    const body = await (await creationResponse).json() as unknown;
    const roomId = requiredRoomId(body);
    await onRoomCreated?.({ roomId });

    return {
      roomId,
      inviteUrl: await requiredHref(this.page, "Invite link"),
      hostUrl: await requiredHref(this.page, "Host link")
    };
  }
}

function requiredRoomId(value: unknown): string {
  if (!value || typeof value !== "object" || !("roomId" in value) ||
      typeof value.roomId !== "string" || value.roomId.length === 0) {
    throw new Error("Create-room response did not contain an authoritative room ID");
  }
  return value.roomId;
}

async function requiredHref(page: Page, name: string): Promise<string> {
  const href = await page.getByRole("link", { name }).getAttribute("href");
  if (!href) {
    throw new Error(`${name} was not rendered after room creation`);
  }
  return href;
}
