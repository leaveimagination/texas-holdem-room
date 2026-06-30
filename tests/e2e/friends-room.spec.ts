import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test("room page shows join flow and table surface", async ({ page }) => {
  const webSocketPromise = waitForRoomSocket(page);
  await page.goto("/room/test-room");
  const webSocket = await webSocketPromise;
  const joinFrame = new Promise<string>((resolve) => {
    webSocket.on("framesent", (event) => {
      const payload = event.payload.toString();
      if (payload.includes("\"join_room\"")) {
        resolve(payload);
      }
    });
  });

  await expect(page.getByLabel("Nickname")).toBeVisible();
  await expect(page.getByText("Table")).toBeVisible();
  await expect(page.getByText("Waiting for deal")).toBeVisible();
  await expect(page.getByRole("region", { name: "Actions" })).toHaveCount(0);
  expect(new URL(webSocket.url()).pathname).toBe("/ws");

  await page.getByRole("button", { name: "Spectate" }).click();
  await expect(joinFrame).resolves.toContain("\"participantToken\":null");
});

test("table controls send room websocket commands", async ({ page }) => {
  const webSocketPromise = waitForRoomSocket(page);
  await page.addInitScript(() => {
    const originalSend = WebSocket.prototype.send;
    window.__sentRoomFrames = [];
    WebSocket.prototype.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === "string") {
        (window.__sentRoomFrames ??= []).push(data);
      }

      return originalSend.call(this, data);
    };
    window.localStorage.setItem("holdem:test-room:participantToken", "participant-token");
  });
  await page.goto("/room/test-room?host=host-token");
  await webSocketPromise;

  await page.getByLabel("Nickname").fill("Alice");
  await page.getByRole("button", { name: "Join" }).click();
  await page.getByRole("button", { name: "Claim seat 1" }).click();
  await expect.poll(() => findFrame(page, "claim_seat")).toContain("\"seatNumber\":1");

  await page.locator(".host-popover").evaluate((details) => {
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
    }
  });
  await page.getByRole("button", { name: "Start room" }).click();
  await expect.poll(() => findFrame(page, "start_room")).toContain("\"hostToken\":\"host-token\"");

  await expect(page.getByRole("dialog", { name: "Add chips" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Add chips" })).toHaveCount(0);

  await page.getByLabel("Disconnected participant").fill("p1");
  await page.getByRole("button", { name: "Pause for disconnect" }).click();
  await expect.poll(() => findFrame(page, "handle_disconnect")).toContain("\"participantId\":\"p1\"");
});

async function findFrame(page: Page, type: string, fragment?: string): Promise<string> {
  const frames = await page.evaluate(() => window.__sentRoomFrames ?? []);
  return frames.find((frame) => frame.includes(`"type":"${type}"`) && (!fragment || frame.includes(fragment))) ?? "";
}

function waitForRoomSocket(page: Page) {
  return page.waitForEvent("websocket", (webSocket) => new URL(webSocket.url()).pathname === "/ws");
}

declare global {
  interface Window {
    __sentRoomFrames?: string[];
  }
}
