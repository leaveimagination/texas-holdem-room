import type { RoomSettings } from "@/lib/room/settings";
import type {
  BrowserFixtureIdentity,
  BrowserJoinPage,
  CreatedRoomIdentity,
  JoinedPlayerCredential,
  KnownSecretRegistry
} from "./types";

interface ExperienceApiClientOptions {
  baseUrl: string;
  knownSecrets: KnownSecretRegistry;
  fetch?: typeof fetch;
}

export class ExperienceApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ExperienceApiClientOptions) {
    this.baseUrl = withoutTrailingSlash(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createRoom(settings: RoomSettings): Promise<CreatedRoomIdentity> {
    const body = await this.postJson("/api/rooms", settings);
    const roomId = requiredString(body, "roomId", "Create-room response");
    const inviteUrl = absoluteUrl(
      requiredString(body, "inviteUrl", "Create-room response"),
      this.baseUrl
    );
    const hostUrl = new URL(
      requiredString(body, "hostUrl", "Create-room response"),
      this.baseUrl
    );
    const hostToken = hostUrl.searchParams.get("host");
    if (!hostToken) {
      throw new Error("Create-room response did not include a host credential");
    }

    this.options.knownSecrets.add(hostToken);
    return { roomId, inviteUrl, hostToken };
  }

  async joinPlayer(roomId: string, displayName: string): Promise<JoinedPlayerCredential> {
    const body = await this.postJson(
      `/api/rooms/${encodeURIComponent(roomId)}/participants`,
      { displayName }
    );
    const participantId = requiredString(body, "participantId", "Join response");
    const participantToken = requiredString(body, "participantToken", "Join response");

    this.options.knownSecrets.add(participantToken);
    return { participantId, participantToken, displayName };
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const parsed = await response.json() as unknown;
    if (!response.ok) {
      const message = isRecord(parsed) && typeof parsed.error === "string"
        ? parsed.error
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (!isRecord(parsed)) {
      throw new Error("HTTP endpoint returned a non-object response");
    }
    return parsed;
  }
}

export async function bootstrapBrowserIdentity(options: {
  page: BrowserJoinPage;
  baseUrl: string;
  roomId: string;
  role: string;
  displayName: string;
  hostToken?: string;
  knownSecrets: KnownSecretRegistry;
}): Promise<BrowserFixtureIdentity> {
  const baseUrl = withoutTrailingSlash(options.baseUrl);
  const roomPath = `/room/${encodeURIComponent(options.roomId)}`;
  const roomUrl = new URL(`${baseUrl}${roomPath}`);
  if (options.hostToken) {
    options.knownSecrets.add(options.hostToken);
    roomUrl.searchParams.set("host", options.hostToken);
  }

  let participantId: string | null = null;
  try {
    await options.page.goto(roomUrl.toString());
    await options.page.getByRole("textbox", { name: "Nickname" }).fill(options.displayName);

    const endpoint = `${baseUrl}/api/rooms/${encodeURIComponent(options.roomId)}/participants`;
    const participantResponse = options.page.waitForResponse((response) =>
      response.url() === endpoint && response.request().method() === "POST"
    );
    await options.page.getByRole("button", { name: "Join" }).click();

    const body = await (await participantResponse).json();
    participantId = requiredString(body, "participantId", "Visible join response");
    const participantToken = requiredString(body, "participantToken", "Visible join response");
    options.knownSecrets.add(participantToken);

    await options.page.getByRole("dialog", { name: "Join flow" }).waitFor({ state: "hidden" });
  } finally {
    await scrubHostQuery(options.page);
  }
  if (participantId === null) {
    throw new Error("Visible join did not produce a participant identity");
  }
  const safeUrl = options.page.url();
  if (new URL(safeUrl).searchParams.has("host")) {
    throw new Error("Host credential remained in browser history after identity bootstrap");
  }

  return {
    role: options.role,
    participantId,
    displayName: options.displayName,
    traceReady: true,
    safeUrl
  };
}

async function scrubHostQuery(page: BrowserJoinPage): Promise<void> {
  await page.evaluate(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  });
}

function requiredString(input: unknown, key: string, context: string): string {
  if (!isRecord(input) || typeof input[key] !== "string" || input[key].length === 0) {
    throw new Error(`${context} did not include ${key}`);
  }
  return input[key];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function absoluteUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}
