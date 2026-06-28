import { expect, test } from "@playwright/test";

test("host can open create room form", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "Create private room" })).toBeVisible();
  await expect(page.getByLabel("Seats")).toBeVisible();
});

test("join form exposes player and spectator controls", async ({ page }) => {
  await page.goto("/create");

  await expect(page.getByLabel("Nickname")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Spectate" })).toBeVisible();
});
