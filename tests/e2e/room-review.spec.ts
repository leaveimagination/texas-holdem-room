import { expect, test } from "@playwright/test";

test("review page opens with hand history section", async ({ page }) => {
  await page.goto("/room/test-room/review");

  await expect(page.getByRole("heading", { name: "Room review" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Hand history" })).toBeVisible();
});
