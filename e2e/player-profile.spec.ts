import { expect, test } from "@playwright/test";

test("player profile renders seeded full-map run aggregates", async ({ page }) => {
  await page.goto("/players/77");

  await expect(page.getByRole("heading", { name: "E2EPlayer" })).toBeVisible();
  await expect(page.getByText("Play count").locator("..")).toContainText("7");
  await expect(page.getByRole("heading", { name: "Highest official dan" })).toBeVisible();
  await expect(page.getByLabel("Acquired dan badges").getByText("1st")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pinned clears" })).toBeVisible();
  await expect(page.locator(".player-clear-card").filter({ hasText: "1st" })).toContainText(
    "1,999,999",
  );
  await expect(page.locator(".player-clear-card").filter({ hasText: "1st" })).not.toContainText(
    "#1",
  );
  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most played courses" })).toBeVisible();
});

test("dan page leaderboard renders seeded course ranking", async ({ page }) => {
  await page.goto("/dan/test?course=2nd");

  await expect(page.getByRole("heading", { name: "Top runs" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Course Acc" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2EPlayer" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "99.00%" })).toBeVisible();
});
