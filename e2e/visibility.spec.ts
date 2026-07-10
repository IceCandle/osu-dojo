import { expect, test } from "@playwright/test";

test("visibility rolls back on failure and republishes saved details", async ({ browser, page }) => {
  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto("/dan/test?course=1st");
  const leaderboardBefore = await anonymousPage.locator(".ranking-table").textContent();

  await page.goto("/");
  await page.getByRole("button", { name: "osu!auth Login" }).click();
  await page.goto("/settings");
  const settings = page.locator(".settings-grid");
  await expect(settings).toHaveAttribute("data-ready", "true");
  const visibility = page.getByRole("checkbox", { name: "Show detailed profile history" });

  try {
    if (!(await visibility.isChecked())) await visibility.check();

    await page.route("**/api/settings/visibility", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await visibility.uncheck();
    await expect(page.getByRole("status")).toContainText("Couldn't save visibility settings.");
    await expect(visibility).toBeChecked();
    await page.unroute("**/api/settings/visibility");

    await visibility.uncheck();
    await expect(page.getByRole("status")).toContainText("Saved visibility settings.");
    const ownerProfile = await page.context().newPage();
    await ownerProfile.goto("/players/77");
    await expect(ownerProfile.getByText("Play count").locator("..")).toContainText("9");
    await ownerProfile.close();
    await anonymousPage.goto("/players/77");
    await expect(anonymousPage.getByRole("heading", { name: "Highest official dan" })).toBeVisible();
    await expect(anonymousPage.getByText(/private/i)).toHaveCount(0);
    await expect(anonymousPage.getByRole("heading", { name: "Pinned clears" })).toHaveCount(0);
    await expect(anonymousPage.getByRole("heading", { name: "Recent runs" })).toHaveCount(0);
    await expect(anonymousPage.getByRole("heading", { name: "Most played courses" })).toHaveCount(0);
    await expect(anonymousPage.getByText("Play count")).toHaveCount(0);
    await expect(anonymousPage.getByText(/will appear here/i)).toHaveCount(0);
    const searchResponse = await anonymousPage.request.get("/api/search?q=E2EPlayer");
    expect(searchResponse.ok()).toBe(true);
    expect((await searchResponse.json()).players).toEqual([
      expect.objectContaining({ userId: 77, username: "E2EPlayer" }),
    ]);
    await anonymousPage.goto("/dan/test?course=1st");
    expect(await anonymousPage.locator(".ranking-table").textContent()).toBe(leaderboardBefore);

    await visibility.check();
    await expect(page.getByRole("status")).toContainText("Saved visibility settings.");
    await anonymousPage.goto("/players/77");
    await expect(anonymousPage.getByText("Play count").locator("..")).toContainText("9");
    await expect(anonymousPage.getByRole("heading", { name: "Pinned clears" })).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (await visibility.isVisible().catch(() => false)) {
      if (!(await visibility.isChecked())) await visibility.check();
    }
    await anonymous.close();
  }
});
