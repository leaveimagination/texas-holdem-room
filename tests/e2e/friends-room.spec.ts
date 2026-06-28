import { expect, test } from "@playwright/test";

test("room page shows join flow and table surface", async ({ page }) => {
  const webSocketPromise = page.waitForEvent("websocket");
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
  await expect(page.getByRole("button", { name: "Fold" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nice hand" })).toBeVisible();
  expect(new URL(webSocket.url()).pathname).toBe("/ws");

  await page.getByRole("button", { name: "Spectate" }).click();
  await expect(joinFrame).resolves.toContain("\"participantToken\":null");
});
