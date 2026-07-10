import { expect, test } from "@playwright/test";

test("keyboard pin lifecycle prevents duplicates, survives reload, and enforces the limit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "osu!auth Login" }).click();
  await page.goto("/dan/test?course=2nd");

  const control = page.locator(".course-pin-control");
  await expect(control).toHaveAttribute("data-ready", "true");
  let releaseRequest: (() => void) | undefined;
  let requestCount = 0;
  await page.route("**/api/settings/pinned", async (route) => {
    requestCount += 1;
    await new Promise<void>((resolve) => { releaseRequest = resolve; });
    await route.continue();
  });
  const pinSecond = page.getByRole("button", { name: "Pin pinned clear for 2nd" });
  await pinSecond.focus();
  await pinSecond.press("Enter");
  await expect(pinSecond).toBeDisabled();
  await expect(pinSecond).toHaveText("Saving…");
  expect(requestCount).toBe(1);
  releaseRequest?.();
  await expect(page.getByRole("status")).toContainText("Clear pinned.");
  await page.unroute("**/api/settings/pinned");

  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin pinned clear for 2nd" })).toBeVisible();

  await page.goto("/dan/test?course=1st");
  const replace = page.getByRole("button", { name: "Replace pinned clear for 1st" });
  await replace.focus();
  await replace.press(" ");
  await expect(page.getByRole("status")).toContainText("Pinned clear replaced.");
  const unpin = page.getByRole("button", { name: "Unpin pinned clear for 1st" });
  await unpin.focus();
  await unpin.press("Enter");
  await expect(page.getByRole("status")).toContainText("Pinned clear removed.");

  await page.route("**/api/settings/pinned", (route) => route.fulfill({ status: 500, body: "{}" }));
  const pinFirst = page.getByRole("button", { name: "Pin pinned clear for 1st" });
  await pinFirst.focus();
  await pinFirst.press(" ");
  await expect(page.getByRole("status")).toContainText("Could not update the pinned clear.");
  await page.unroute("**/api/settings/pinned");
  await pinFirst.press("Enter");
  await expect(page.getByRole("status")).toContainText("Clear pinned.");

  await page.goto("/dan/e2e-pins?course=6th");
  await page.getByRole("button", { name: "Pin pinned clear for 6th" }).click();
  await expect(page.getByRole("status")).toContainText("You can pin up to five courses.");
});
