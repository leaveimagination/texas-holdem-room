import { expect, test } from "@playwright/test";

test("room page shows join flow and table surface", async ({ page }) => {
  const webSocketPromise = page.waitForEvent("websocket");
  await page.goto("/room/test-room");
  const webSocket = await webSocketPromise;

  await expect(page.getByLabel("Nickname")).toBeVisible();
  await expect(page.getByText("Table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fold" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nice hand" })).toBeVisible();
  expect(new URL(webSocket.url()).pathname).toBe("/ws");
});
