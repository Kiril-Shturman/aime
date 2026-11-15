import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, saved = false) {
  const vault = {
    token: saved ? "device-marker" : "",
    authorized: true,
    posts: [] as string[],
  };
  await page.exposeFunction("nativeBiometry", (type: string, raw: string) => {
    vault.posts.push(type);
    if (
      type === "web_app_biometry_get_info" ||
      type === "web_app_biometry_request_access"
    )
      return {
        event: "biometry_info_received",
        data: {
          available: true,
          type: "face",
          access_requested: true,
          access_granted: true,
          token_saved: Boolean(vault.token),
          device_id: "test-device",
        },
      };
    if (type === "web_app_biometry_request_auth")
      return {
        event: "biometry_auth_requested",
        data: {
          status: vault.authorized ? "authorized" : "failed",
          token: vault.authorized ? vault.token : "",
        },
      };
    if (type === "web_app_biometry_update_token") {
      vault.token = JSON.parse(raw).token;
      return {
        event: "biometry_token_updated",
        data: { status: vault.token ? "updated" : "removed" },
      };
    }
    return null;
  });
  await page.addInitScript(() => {
    localStorage.setItem("ui-theme", "light");
    localStorage.setItem("wpay:intro:v1", "seen");
    const w = window as any;
    w.TelegramWebviewProxy = {
      postEvent(type: string, data: string) {
        void w.nativeBiometry(type, data).then((result: any) => {
          if (result)
            w.Telegram.WebView.receiveEvent(result.event, result.data);
        });
      },
    };
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        configured: true,
        balances: [],
        rates: [],
        items: [],
        transactions: [],
      },
    }),
  );
  const hash = new URLSearchParams({
    tgWebAppVersion: "9.6",
    tgWebAppPlatform: "ios",
    tgWebAppData: new URLSearchParams({
      user: JSON.stringify({ id: 123, first_name: "Test" }),
    }).toString(),
  });
  await page.goto("/wallet#" + hash);
  return vault;
}
async function profile(page: Page) {
  await page.getByText("Профиль", { exact: true }).last().click();
}
test("native Face ID: enable, cancel disable, then confirm disable", async ({
  page,
}) => {
  const vault = await setup(page);
  await profile(page);
  const rows = page.locator(".wpay-f7-profile .list").first().locator("li");
  await expect(rows.nth(1)).toContainText("Верификация");
  vault.authorized = false;
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(page.locator('input[name="biometric-lock"]')).toBeEnabled();
  await expect(page.locator('input[name="biometric-lock"]')).not.toBeChecked();
  expect(vault.token).toBe("");
  vault.authorized = true;
  const toggle = page.locator('input[name="biometric-lock"]');
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => vault.token).toMatch(/^wpay-lock-v1:/);
  vault.authorized = false;
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  expect(vault.token).not.toBe("");
  vault.authorized = true;
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => vault.token).toBe("");
});
test("saved native marker locks on reload even without local hint; cancellation does not reveal wallet", async ({
  page,
}) => {
  const vault = await setup(page, true);
  await profile(page);
  vault.authorized = false;
  await page.evaluate(() =>
    localStorage.removeItem("wpay:biometric-lock:v1:123"),
  );
  await page.reload();
  await expect(
    page.getByRole("main", { name: "Блокировка WPay" }),
  ).toBeVisible();
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  await expect(page.locator(".wpay-lock-aurora")).toBeVisible();
  await expect(page.getByLabel("Бейдж профиля")).toBeVisible();
  await expect(page.locator(".wpay-lock-badge-fallback img")).toHaveAttribute(
    "src",
    /^data:image/,
  );
  const unlockBox = await page
    .getByRole("button", { name: "Разблокировать", exact: true })
    .boundingBox();
  expect(unlockBox!.y + unlockBox!.height).toBeGreaterThan(
    page.viewportSize()!.height - 65,
  );
  for (const size of [
    { width: 375, height: 667 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(size);
    const copy = await page.locator(".wpay-lock-copy").boundingBox();
    const actions = await page.locator(".wpay-lock-actions").boundingBox();
    expect(copy!.y + copy!.height).toBeLessThan(actions!.y);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  vault.authorized = true;
  await page
    .getByRole("button", { name: "Разблокировать", exact: true })
    .click();
  await expect(page.getByRole("main", { name: "Блокировка WPay" })).toHaveCount(
    0,
  );
  await expect(page.locator(".wpay-biometric-content")).toBeVisible();
  vault.authorized = false;
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("visibility_changed", {
      is_visible: false,
    }),
  );
  await expect(
    page.getByRole("main", { name: "Блокировка WPay" }),
  ).toBeVisible();
  await expect(page.locator(".wpay-biometric-content")).not.toBeVisible();
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("visibility_changed", {
      is_visible: true,
    }),
  );
  await expect(page.getByRole("alert")).toContainText("Подтверждение отменено");
});
