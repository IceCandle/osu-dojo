import { expect, test } from "@playwright/test";

test("catalog and dan detail render seeded course data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Stable-hosted course runs/ })).toBeVisible();
  await page.getByRole("link", { name: "View dan systems" }).click();

  await expect(page).toHaveURL(/\/dan$/);
  await expect(page.getByRole("heading", { name: "Dan systems" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "test" })).toBeVisible();

  await page.goto("/dan/test?course=1st");

  await expect(page.getByRole("heading", { name: "1st" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Course sequence" })).toBeVisible();
  await expect(page.getByText("test stage one")).toBeVisible();
  await expect(page.getByText("test stage two")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top runs" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Adjusted Score Total" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2EPlayer" })).toBeVisible();
});

test("player search returns seeded local-run players", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search dan systems, courses, and players").fill("E2EPlayer");

  await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  const playerLink = page.locator('a[href="/players/77"]').filter({ hasText: "E2EPlayer" });
  await expect(playerLink).toBeVisible();

  await playerLink.click();
  await expect(page).toHaveURL(/\/players\/77$/);
  await expect(page.getByRole("heading", { name: "E2EPlayer" })).toBeVisible();
});
