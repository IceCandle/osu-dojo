import { expect, test } from "@playwright/test";

test("owner manages visibility and course-page pinned clears", async ({
  browser,
  page,
}) => {
  const anonymous = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  const anonymousPage = await anonymous.newPage();

  try {
    await anonymousPage.goto("/dan/test?course=1st");
    const leaderboardBefore = await anonymousPage
      .locator(".ranking-table")
      .textContent();

    await page.goto("/");
    await page.getByRole("button", { name: "osu!auth Login" }).click();
    await page.goto("/settings");

    const visibility = page.getByRole("checkbox", {
      name: /프로필 상세 기록 공개/,
    });
    await expect(visibility).toBeChecked();
    await expect(
      page.getByRole("heading", { name: "대표 클리어" }),
    ).toHaveCount(0);
    await visibility.uncheck();
    await expect(page.getByRole("status")).toContainText("저장했습니다");

    await page.goto("/dan/test?course=2nd");
    await page
      .getByRole("button", { name: "Pin pinned clear for 2nd" })
      .click();
    await expect(page.getByRole("status")).toContainText("Clear pinned.");

    await page.goto("/players/77");
    await expect(page.getByText("Play count").locator("..")).toContainText("7");
    await expect(
      page.locator(".player-clear-card").filter({ hasText: "2nd" }),
    ).toHaveCount(1);

    await page.goto("/dan/test?course=1st");
    await page
      .getByRole("button", { name: "Replace pinned clear for 1st" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Pinned clear replaced.",
    );
    await page
      .getByRole("button", { name: "Unpin pinned clear for 1st" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Pinned clear removed.",
    );

    await page.goto("/players/77");
    await expect(
      page.locator(".player-clear-card").filter({ hasText: "1st" }),
    ).toHaveCount(0);

    await page.goto("/dan/test?course=1st");
    await page
      .getByRole("button", { name: "Pin pinned clear for 1st" })
      .click();
    await page.goto("/dan/e2e-pins?course=6th");
    await page
      .getByRole("button", { name: "Pin pinned clear for 6th" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "You can pin up to five courses.",
    );

    await anonymousPage.goto("/players/77");
    await expect(
      anonymousPage.getByRole("heading", { name: "E2EPlayer" }),
    ).toBeVisible();
    await expect(anonymousPage.getByLabel("Acquired dan badges")).toContainText(
      "1st",
    );
    await expect(
      anonymousPage.getByText("프로필 상세 기록이 비공개입니다."),
    ).toBeVisible();
    await expect(
      anonymousPage.getByRole("heading", { name: "Pinned clears" }),
    ).toHaveCount(0);
    await expect(anonymousPage.getByText("Play count")).toHaveCount(0);

    const searchResponse = await anonymousPage.request.get(
      "/api/search?q=E2EPlayer",
    );
    expect(searchResponse.ok()).toBe(true);
    expect((await searchResponse.json()).players).toEqual([
      expect.objectContaining({ userId: 77, username: "E2EPlayer" }),
    ]);

    await anonymousPage.goto("/dan/test?course=1st");
    expect(await anonymousPage.locator(".ranking-table").textContent()).toBe(
      leaderboardBefore,
    );

    await anonymousPage.goto("/players/999999");
    await expect(
      anonymousPage.getByRole("heading", {
        name: "로컬 osu!dojo 기록이 없습니다",
      }),
    ).toBeVisible();

    await page.goto("/settings");
    await page
      .getByRole("checkbox", { name: /프로필 상세 기록 공개/ })
      .check();
    await expect(page.getByRole("status")).toContainText("저장했습니다");
  } finally {
    await anonymous.close();
  }
});
