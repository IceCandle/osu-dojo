import { expect, test } from "@playwright/test";

test("home page shows a recent pass from a featured official course", async ({ page }) => {
  await page.goto("/");

  const section = page.locator(".notable-pass-section");
  await expect(
    section.getByRole("heading", { name: "Recent notable passes" }),
  ).toBeVisible();
  await expect(section.getByText("osu!standard")).toBeVisible();

  const cards = section.locator(".notable-pass-card");
  await expect(cards.filter({ hasText: "NotableE2E" })).toHaveCount(1);

  const card = cards.first();
  await expect(card.getByRole("link", { name: "NotableE2E" })).toHaveAttribute(
    "href",
    "/players/451",
  );
  await expect(card).toContainText("1st");
  await expect(card).toContainText("test");
  await expect(card.getByText("Passed")).toBeVisible();
  await expect(card.locator("time")).toBeVisible();
});
