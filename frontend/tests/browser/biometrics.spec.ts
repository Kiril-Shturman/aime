import { test, expect, type Page } from "@playwright/test";

async function setup(
  page: Page,
  saved = false,
  avatar?: Buffer,
  infoResponsive = true,
  platform = "ios",
  available = true,
) {
  // These scenarios exercise the lock and its fallback without depending on a GPU.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, options?: unknown) {
      if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
      return Reflect.apply(getContext, this, [kind, options]);
    } as typeof getContext;
  });
  const vault = {
    token: saved ? "device-marker" : "",
    authorized: true,
    rejectRemoval: false,
    infoResponsive,
    posts: [] as string[],
  };
  await page.exposeFunction("nativeBiometry", (type: string, raw: string) => {
    vault.posts.push(type);
    if (type === "web_app_biometry_get_info" && !vault.infoResponsive)
      return null;
    if (
      type === "web_app_biometry_get_info" ||
      type === "web_app_biometry_request_access"
    )
      return {
        event: "biometry_info_received",
        data: {
          available,
          type: available ? "face" : "unknown",
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
      if (!JSON.parse(raw).token && vault.rejectRemoval)
        return { event: "biometry_token_updated", data: { status: "failed" } };
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
  if (avatar)
    await page.route("**/api/wallet/profile-avatar", (route) =>
      route.fulfill({ body: avatar, contentType: "image/png" }),
    );
  const hash = new URLSearchParams({
    tgWebAppVersion: "9.6",
    tgWebAppPlatform: platform,
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
  vault.rejectRemoval = true;
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  expect(vault.token).not.toBe("");
  await expect(
    page.getByText("Telegram не сохранил настройку. Попробуйте ещё раз.", {
      exact: true,
    }),
  ).toBeVisible();
  vault.rejectRemoval = false;
  await page.locator(".wpay-biometric-row .toggle").click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => vault.token).toBe("");
  const authCalls = () =>
    vault.posts.filter((type) => type === "web_app_biometry_request_auth")
      .length;
  const before = authCalls();
  await page.evaluate(() => {
    (window as any).Telegram.WebView.receiveEvent("deactivated", {});
    (window as any).Telegram.WebView.receiveEvent("activated", {});
  });
  await expect(page.getByRole("main", { name: "Блокировка WPay" })).toHaveCount(
    0,
  );
  vault.infoResponsive = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Профиль", exact: true }),
  ).toBeVisible({ timeout: 2000 });
  await expect(
    page.getByText("Проверяем защиту устройства…", { exact: true }),
  ).toHaveCount(0);
  expect(authCalls()).toBe(before);
});
test("saved native marker locks on reload even without local hint; cancellation does not reveal wallet", async ({
  page,
}) => {
  const vault = await setup(page, true);
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Открыть", exact: true }).locator("svg"),
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        vault.posts.filter((type) => type === "web_app_request_fullscreen")
          .length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
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
  await expect(page.locator(".wpay-lock-badge-fallback")).toHaveCSS(
    "animation-name",
    "wpay-badge-fallback",
  );
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
    const badge = await page.getByLabel("Бейдж профиля").boundingBox();
    expect(badge!.height).toBeCloseTo(size.height, 2);
    const copy = await page.locator(".wpay-lock-copy").boundingBox();
    const actions = await page.locator(".wpay-lock-actions").boundingBox();
    expect(copy!.y + copy!.height).toBeLessThan(actions!.y);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("white-badge.png"),
    animations: "disabled",
  });
  vault.authorized = true;
  await page
    .getByRole("button", { name: "Разблокировать", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  await expect(page.getByLabel("Бейдж профиля")).toBeVisible();

  await page.getByRole("button", { name: "Открыть", exact: true }).click();
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

test("badge respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page, true);
  await expect(
    page.getByRole("button", { name: "Открыть", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".wpay-lock-badge-fallback")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("badge paints the authenticated same-origin avatar into its texture", async ({
  page,
}) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    return canvas.toDataURL().split(",")[1];
  });
  await setup(page, true, Buffer.from(png, "base64"));
  await expect
    .poll(() =>
      page.locator(".wpay-lock-badge-fallback img").evaluate(async (node) => {
        const img = node as HTMLImageElement;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1440;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(512, 650, 1, 1).data).slice(0, 3);
      }),
      { timeout: 15000 },
    )
    .toEqual([255, 0, 0]);
});

test("late native information recovers startup without bypassing an unknown lock", async ({
  page,
}) => {
  const vault = await setup(page, false, undefined, false);
  await expect(
    page.getByRole("button", { name: "Повторить проверку", exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("biometry_info_received", {
      available: true,
      type: "face",
      access_requested: true,
      access_granted: true,
      token_saved: false,
      device_id: "test-device",
    }),
  );
  await expect(
    page.getByRole("button", { name: "Профиль", exact: true }),
  ).toBeVisible();
  expect(
    vault.posts.filter((type) => type === "web_app_biometry_request_auth"),
  ).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Профиль", exact: true }),
  ).toBeVisible({ timeout: 2000 });
});
test("retry initializes a saved native lock and still requires authentication and Open", async ({
  page,
}) => {
  const vault = await setup(page, true, undefined, false);
  await expect(
    page.getByRole("button", { name: "Повторить проверку", exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  vault.infoResponsive = true;
  await page
    .getByRole("button", { name: "Повторить проверку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Профиль", exact: true }),
  ).toBeVisible();
});

for (const platform of ["tdesktop", "macos", "webk"]) {
  test(`${platform}: unavailable biometrics do not block desktop with a saved lock hint`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("wpay:biometric-lock:v1:123", "enabled"),
    );
    const vault = await setup(page, true, undefined, true, platform, false);
    await expect(page.locator(".wpay-biometric-content")).toBeVisible();
    await expect(
      page.getByRole("main", { name: "Блокировка WPay" }),
    ).toHaveCount(0);
    expect(vault.posts).not.toContain("web_app_biometry_request_auth");
    expect(vault.posts).not.toContain("web_app_biometry_update_token");
    expect(vault.token).toBe("device-marker");
    await profile(page);
    await expect(page.locator(".wpay-biometric-row")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("wpay:biometric-lock:v1:123"),
      ),
    ).toBe("enabled");
  });
}

test("desktop without a native biometric response opens instead of trapping the user", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("wpay:biometric-lock:v1:123", "enabled"),
  );
  const vault = await setup(page, false, undefined, false, "tdesktop", false);
  await expect(page.locator(".wpay-biometric-content")).toBeVisible({
    timeout: 8000,
  });
  expect(vault.posts).not.toContain("web_app_biometry_request_auth");
});

test("desktop reporting available biometrics retains its existing lock", async ({
  page,
}) => {
  const vault = await setup(page, true, undefined, true, "macos", true);
  vault.authorized = false;
  await expect(
    page.getByRole("main", { name: "Блокировка WPay" }),
  ).toBeVisible();
  await expect(page.locator(".wpay-biometric-content")).toHaveCount(0);
  expect(vault.posts).toContain("web_app_biometry_request_auth");
});

test("late desktop capability restores the saved lock when biometry becomes available", async ({
  page,
}) => {
  const vault = await setup(page, true, undefined, false, "macos", false);
  await expect(page.locator(".wpay-biometric-content")).toBeVisible({
    timeout: 8000,
  });
  vault.authorized = false;
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("biometry_info_received", {
      available: true,
      type: "finger",
      access_requested: true,
      access_granted: true,
      token_saved: true,
      device_id: "test-device",
    }),
  );
  await expect(
    page.getByRole("main", { name: "Блокировка WPay" }),
  ).toBeVisible();
  await expect(page.locator(".wpay-biometric-content")).not.toBeVisible();
  expect(vault.posts).toContain("web_app_biometry_request_auth");
});

test("protection startup displays the real wordmark and Framework7 loader instead of loading text", async ({
  page,
}) => {
  await setup(page, false, undefined, false);
  const screen = page.getByRole("main", { name: "Блокировка WPay" });
  await expect(
    screen.locator('img[src="/brands/wpay-wordmark.svg"]'),
  ).toBeVisible();
  await expect(
    screen.getByRole("heading", { name: "WPay", exact: true }),
  ).toHaveCount(0);
  await expect(
    screen.getByText("Проверяем защиту устройства…", { exact: true }),
  ).toHaveCount(0);
  const loader = screen.getByRole("status", {
    name: "Проверка защиты устройства",
  });
  await expect(loader.locator(".preloader")).toBeVisible();
  await expect(loader.locator(".preloader-inner-line")).toHaveCount(8);
  const logoBox = await screen.locator(".wpay-startup-wordmark").boundingBox();
  const spinnerBox = await loader.locator(".preloader").boundingBox();
  expect(
    Math.abs(logoBox!.x + logoBox!.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(2);
  expect(logoBox!.y).toBeLessThan(150);
  expect(spinnerBox!.y).toBeGreaterThan(logoBox!.y + logoBox!.height + 60);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(
    screen.locator('img[src="/brands/wpay-wordmark-light.svg"]'),
  ).toBeVisible();
});

test("initial route loading uses a native preloader before wallet code is loaded", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        configured: false,
        items: [],
        balances: [],
        rates: [],
        transactions: [],
      },
    }),
  );
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(/\/assets\/WalletPage-[^/]+\.js$/, async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto("/wallet#tgWebAppVersion=6.1&tgWebAppPlatform=ios", {
    waitUntil: "domcontentloaded",
  });
  const loading = page.getByRole("status", { name: "Загрузка приложения" });
  await expect(loading.locator(".preloader")).toBeVisible();
  await expect(loading.locator(".preloader-inner-line")).toHaveCount(8);
  await expect(loading.locator(".wpay-startup-wordmark")).toBeVisible();
  const logoBox = await loading.locator(".wpay-startup-wordmark").boundingBox();
  const spinnerBox = await loading.locator(".preloader").boundingBox();
  expect(
    Math.abs(logoBox!.x + logoBox!.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(2);
  expect(logoBox!.y).toBeLessThan(150);
  expect(spinnerBox!.y).toBeGreaterThan(logoBox!.y + logoBox!.height + 60);
  expect(
    await loading
      .locator(".preloader-inner")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("ios-preloader-spin");
  await expect(page.getByText("Загрузка…", { exact: true })).toHaveCount(0);
  finish();
  await expect(loading).toHaveCount(0);
});
