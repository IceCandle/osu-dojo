import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "osu!auth Login" }).click();
});

test("shows own rank and highlights a top-ten row", async ({ page }) => {
  await page.goto("/dan/test?course=2nd");
  await expect(page.locator(".course-pin-panel")).toContainText("#1");
  await expect(page.locator(".ranking-row-you")).toContainText("E2EPlayer");
  await expect(page.locator(".ranking-personal-body")).toHaveCount(0);
});

test("appends an eleventh-place own row after the top ten", async ({ page }) => {
  await page.goto("/dan/e2e-pins?course=crowded");
  await expect(page.locator(".course-pin-panel")).toContainText("#11");
  await expect(page.locator(".ranking-table tbody").first().locator("tr")).toHaveCount(10);
  await expect(page.locator(".ranking-personal-body .ranking-row-you")).toContainText("E2EPlayer");
});

test("disables pinning when the viewer has no passing run", async ({ page }) => {
  await page.goto("/dan/e2e-pins?course=fail-only");
  await expect(page.locator(".course-pin-control")).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("button", { name: "Pin pinned clear for Fail only" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pin pinned clear for Fail only" })).toHaveText("Pass required");
});
