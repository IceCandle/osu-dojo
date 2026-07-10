import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "osu!auth Login" }).click();
  await expect(page.locator(".account-disclosure")).toHaveAttribute("data-ready", "true");
});

test("account disclosure supports keyboard, outside close, and account links", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "E2EPlayer" });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("link", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "My uploads" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("link", { name: "My profile" })).toHaveCount(0);

  await trigger.press(" ");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("link", { name: "My profile" })).toHaveCount(0);

  await trigger.click();
  await page.getByRole("link", { name: "My profile" }).click();
  await expect(page).toHaveURL(/\/players\/77$/);
  await page.getByRole("button", { name: "E2EPlayer" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("account disclosure stays open while focus is inside and closes when focus leaves", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "E2EPlayer" });
  const profileLink = page.getByRole("link", { name: "My profile" });

  await trigger.focus();
  await trigger.press("Enter");
  await trigger.press("Tab");
  await expect(profileLink).toBeFocused();
  await expect(profileLink).toBeVisible();

  await profileLink.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await expect(profileLink).toBeVisible();

  await trigger.press("Shift+Tab");
  await expect(trigger).not.toBeFocused();
  await expect(profileLink).toHaveCount(0);
});
