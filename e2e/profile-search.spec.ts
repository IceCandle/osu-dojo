import { expect, test } from "@playwright/test";

test("users without runs show zero-count sections and current-name-only search results", async ({ page }) => {
  await page.goto("/players/88");
  await expect(page.getByRole("heading", { name: "UsersOnly88" })).toBeVisible();
  await expect(page.getByText("Play count").locator("..")).toContainText("0");
  const highestDanSection = page.locator(".player-profile-section").filter({
    has: page.getByRole("heading", { name: "Highest official dan" }),
  });
  await expect(highestDanSection).toBeVisible();
  await expect(highestDanSection.locator(".player-section-count")).toHaveCount(0);
  for (const heading of ["Pinned clears", "Recent runs", "Most played courses"]) {
    const section = page
      .locator(".player-profile-section")
      .filter({ has: page.getByRole("heading", { name: heading }) });
    await expect(section.getByLabel("0 items")).toHaveText("0");
  }
  await expect(page.getByText(/will appear here/i)).toHaveCount(0);

  async function search(query: string) {
    await page.getByRole("button", { name: "Search" }).click();
    const input = page.getByLabel("Search dan systems, courses, and players");
    await input.fill(query);
    await expect(page.locator(".search-result-group").filter({ hasText: "Players" })).toBeVisible();
  }

  await search("UsersOnly88");
  await expect(page.locator(".search-result-row").filter({ hasText: "UsersOnly88" })).toHaveCount(1);
  await page.getByRole("button", { name: "Close search" }).click();
  await search("OldName99");
  await expect(page.locator(".search-result-row").filter({ hasText: "NewName99" })).toHaveCount(1);
  await expect(page.locator(".search-dialog").getByText("OldName99", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close search" }).click();
  await search("NewName99");
  await expect(page.locator(".search-result-row").filter({ hasText: "NewName99" })).toHaveCount(1);
});

test("numeric and non-numeric missing players use the local-record 404", async ({ page }) => {
  for (const path of ["/players/999999", "/players/abc"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "No local osu!dojo record" })).toBeVisible();
  }
});
