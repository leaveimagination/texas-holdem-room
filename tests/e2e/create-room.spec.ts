import { expect, test } from "@playwright/test";

test("host can open create room form", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "Create private room" })).toBeVisible();
  await expect(page.getByLabel("Seats")).toBeVisible();
  await expect(page.getByLabel("Seats")).toContainText("9");
});

test("host can submit room settings and see invite links", async ({ page }) => {
  await page.route("**/api/rooms", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        roomId: "room_test",
        inviteUrl: "http://127.0.0.1:3000/room/room_test",
        hostUrl: "http://127.0.0.1:3000/room/room_test?host=host_test"
      })
    });
  });

  await page.goto("/create");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("link", { name: "Invite link" })).toHaveAttribute("href", /\/room\/room_test$/);
  await expect(page.getByRole("link", { name: "Host link" })).toHaveAttribute("href", /\?host=host_test$/);
  await expect(page.getByRole("link", { name: "Invite link" })).toContainText("http://127.0.0.1:3000/room/room_test");
  await expect(page.getByRole("link", { name: "Host link" })).toContainText("http://127.0.0.1:3000/room/room_test?host=host_test");
  await expect(page.getByText("Local preview only. Do not send this to friends.")).toBeVisible();
  await expect(page.getByText("Create the room from your Railway domain to get a shareable invite.")).toBeVisible();
  await expect(page.getByText("Local preview only. A shareable host link is available on the Railway site.")).toBeVisible();
  await expect(page.getByText(/^Send this to friends\.$/)).toHaveCount(0);
  await expect(page.getByText(/^Share with trusted co-hosts\./)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
});

test("join form exposes player and spectator controls", async ({ page }) => {
  await page.goto("/create");

  await expect(page.getByLabel("Nickname")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Spectate" })).toBeVisible();
});
