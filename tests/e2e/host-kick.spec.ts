import { expect, test } from "@playwright/test";

test("host kicks the acting player, revokes the old token, and allows a fresh rejoin", async ({ browser, request, baseURL }) => {
  const created = await request.post("/api/rooms", {
    data: { mode: "cash", seats: 3, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null }
  });
  expect(created.status()).toBe(201);
  const links = await created.json() as { hostUrl: string; inviteUrl: string };
  const hostUrl = new URL(links.hostUrl, baseURL).toString();
  const inviteUrl = new URL(links.inviteUrl, baseURL).toString();

  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const aliceContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const bobContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await host.goto(hostUrl);
    await host.getByRole("button", { name: "Spectate" }).click();
    await joinAndSeat(alice, inviteUrl, "Alice", 1);
    await joinAndSeat(bob, inviteUrl, "Bob", 2);
    const aliceIdentity = await readIdentity(alice, links.inviteUrl);
    const bobIdentity = await readIdentity(bob, links.inviteUrl);

    await expect(host.getByRole("button", { name: "Kick Alice" })).toBeVisible();
    await expect(host.getByRole("button", { name: "Kick Bob" })).toBeVisible();
    await openHostTools(host);
    await host.getByRole("button", { name: "Start room" }).click();
    const table = host.getByRole("region", { name: "Table" });
    await expect(table).toHaveAttribute("data-actor-id", /.+/);
    const actorId = await table.getAttribute("data-actor-id");
    expect(actorId).toBeTruthy();
    const target = actorId === aliceIdentity.participantId
      ? { name: "Alice", page: alice, identity: aliceIdentity }
      : { name: "Bob", page: bob, identity: bobIdentity };
    const remaining = target.name === "Alice" ? bob : alice;

    await host.getByRole("button", { name: `Kick ${target.name}` }).click();
    const dialog = host.getByRole("alertdialog", { name: `Kick ${target.name}` });
    await expect(dialog).toContainText(`Remove ${target.name} from this room?`);
    await dialog.getByRole("button", { name: "Kick player" }).click();

    await expect(target.page.getByRole("alert").filter({ hasText: "You were removed from the room by the host" })).toBeVisible();
    await expect(remaining.getByRole("status").filter({ hasText: `${target.name} was removed by the host` })).toBeVisible();
    await expect(host.getByRole("button", { name: `Kick ${target.name}` })).toHaveCount(0);

    await target.page.reload();
    await expect(target.page.getByLabel("Nickname")).toBeVisible();
    await target.page.evaluate(({ roomId, token, participantId }) => {
      localStorage.setItem(`holdem:${roomId}:participantToken`, token);
      localStorage.setItem(`holdem:${roomId}:participantId`, participantId);
    }, target.identity);
    await target.page.getByLabel("Nickname").fill(`${target.name}-stale`);
    await target.page.getByRole("button", { name: "Join" }).click();
    await expect(target.page.getByRole("status").filter({ hasText: "Invalid participant token" })).toBeVisible();

    await target.page.evaluate(({ roomId }) => {
      localStorage.removeItem(`holdem:${roomId}:participantToken`);
      localStorage.removeItem(`holdem:${roomId}:participantId`);
    }, target.identity);
    await target.page.reload();
    await target.page.getByLabel("Nickname").fill(`${target.name}-returned`);
    await target.page.getByRole("button", { name: "Join" }).click();
    await expect(target.page.getByRole("button", { name: /Claim seat/ }).first()).toBeVisible();
  } finally {
    await Promise.all([hostContext.close(), aliceContext.close(), bobContext.close()]);
  }
});

async function joinAndSeat(page: import("@playwright/test").Page, inviteUrl: string, name: string, seatNumber: number) {
  await page.goto(inviteUrl);
  await page.getByLabel("Nickname").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await page.getByRole("button", { name: `Claim seat ${seatNumber}` }).click();
  await expect(page.getByLabel(`Seat ${seatNumber} occupied by ${name}`)).toBeVisible();
}

async function readIdentity(page: import("@playwright/test").Page, inviteUrl: string) {
  const roomId = new URL(inviteUrl).pathname.split("/").filter(Boolean).at(-1)!;
  return await page.evaluate((id) => ({
    roomId: id,
    token: localStorage.getItem(`holdem:${id}:participantToken`)!,
    participantId: localStorage.getItem(`holdem:${id}:participantId`)!
  }), roomId);
}

async function openHostTools(page: import("@playwright/test").Page) {
  await page.locator(".host-popover").evaluate((details) => {
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
}
