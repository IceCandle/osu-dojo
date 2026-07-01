import { expect, test } from "@playwright/test";

test("dummy OAuth login, authenticated settings, and server-side logout revocation", async ({
  page,
  context,
}) => {
  await page.goto("/dan?q=1st");
  await page.getByRole("button", { name: "osu!auth Login" }).click();

  await expect(page).toHaveURL(/\/dan\?q=1st$/);
  await expect(page.getByRole("link", { name: "E2EPlayer" })).toBeVisible();
  const sessionCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "dojo_session",
  );
  expect(sessionCookie).toBeDefined();

  await page.getByRole("link", { name: "E2EPlayer" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "E2EPlayer" })).toBeVisible();

  await page.getByRole("button", { name: "Logout" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "osu!auth Login" })).toBeVisible();

  await context.addCookies([sessionCookie!]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "osu!auth Login" })).toBeVisible();
});
