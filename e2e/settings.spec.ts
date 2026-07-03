import { expect, test } from "@playwright/test";

test("owner settings hide only profile details and save manual pinned clears", async ({
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
    await page.getByRole("link", { name: "E2EPlayer" }).click();

    const visibility = page.getByRole("checkbox", {
      name: /프로필 상세 기록 공개/,
    });
    await expect(visibility).toBeChecked();
    await visibility.uncheck();
    await expect(page.getByRole("status")).toContainText("저장했습니다");

    await page.getByRole("button", { name: "추가" }).first().click();
    await page.getByRole("button", { name: "수동 선택 저장" }).click();
    await expect(page.getByRole("status")).toContainText("대표 클리어를 저장했습니다");

    await page.goto("/players/77");
    await expect(page.getByText("Play count").locator("..")).toContainText("2");
    await expect(page.getByRole("heading", { name: "Pinned clears" })).toBeVisible();
    await expect(page.locator(".player-clear-card")).toHaveCount(1);

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

    await page.goto("/settings");
    await page
      .getByRole("checkbox", { name: /프로필 상세 기록 공개/ })
      .check();
    await expect(page.getByRole("status")).toContainText("저장했습니다");
  } finally {
    await anonymous.close();
  }
});
