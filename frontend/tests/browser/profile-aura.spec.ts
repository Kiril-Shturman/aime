import { test, expect, type Page } from "@playwright/test";
async function setup(
  page: Page,
  enabled = true,
  theme = "light",
  nativeBack = false,
) {
  const state = {
    contact: null as null | { phone: string; email: string },
    verified: false,
    posts: [] as { action: string; body: unknown }[],
  };
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
  }, theme);
  await page.route("https://verify.example/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><title>Identity check</title><h1>Защищённая проверка</h1><input aria-label="Документ">',
    }),
  );
  await page.route("**/api/**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    if (route.request().method() === "POST")
      state.posts.push({ action, body: route.request().postDataJSON() });
    if (action === "status")
      return route.fulfill({
        json: {
          configured: true,
          providers: { aura: { enabled, configured: enabled } },
        },
      });
    if (action === "aura-customer") {
      if (route.request().method() === "POST") {
        state.contact = route.request().postDataJSON();
        return route.fulfill({ json: { registered: true } });
      }
      return state.contact
        ? route.fulfill({ json: state.contact })
        : route.fulfill({
            status: 404,
            json: { error: { name: "CUSTOMER_NOT_REGISTERED" } },
          });
    }
    if (action === "aura-kyc")
      return route.fulfill({
        json: {
          status: state.verified ? "verified" : "pending",
          verified: state.verified,
          terminal: state.verified,
          ...(route.request().method() === "POST"
            ? { session_url: "https://verify.example/session-private" }
            : {}),
        },
      });
    return route.fulfill({
      json: {
        items: [],
        balances: [],
        rates: [],
        transactions: [],
        configured: false,
      },
    });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto(
    nativeBack ? "/wallet#tgWebAppVersion=6.1&tgWebAppPlatform=ios" : "/wallet",
  );
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  return state;
}
test("contacts persist through server, hosted KYC updates from pending to verified", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("link", { name: "Личные данные Имя и контакты" })
    .click();
  await page.locator("#profile-first-name").fill("Кирилл");
  await page.locator("#profile-phone").fill("8 (999) 123-45-67");
  await page.locator("#profile-email").fill("hello@example.com");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Телефон и почта сохранены" }),
  ).toBeVisible();
  expect(state.posts).toEqual([
    {
      action: "aura-customer",
      body: { phone: "+79991234567", email: "hello@example.com" },
    },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await page
    .getByRole("link", { name: "Личные данные Имя и контакты" })
    .click();
  await expect(page.locator("#profile-phone")).toHaveValue("+79991234567");
  await expect(page.locator("#profile-email")).toHaveValue("hello@example.com");
  await page.reload();
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(page.locator("#verification-phone")).toHaveValue("+79991234567");
  await expect(page.locator("#verification-email")).toHaveValue(
    "hello@example.com",
  );
  await expect(page.locator(".wpay-contact-telephone")).toBeVisible();
  await expect(page.locator(".wpay-contact-mailbox")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();

  await expect(page.getByTitle("Проверка личности Aura")).toHaveAttribute(
    "src",
    "https://verify.example/session-private",
  );
  expect(state.posts.at(-1)).toEqual({ action: "aura-kyc", body: {} });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "session-private",
  );
  state.verified = true;
  await page.reload();
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Личность подтверждена" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Начать" })).toHaveCount(0);
});
test("invalid contacts never post; viewing KYC never registers a customer", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ваши контакты" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 667 });
  const next = await page
    .getByRole("button", { name: "Продолжить", exact: true })
    .boundingBox();
  expect(next!.y + next!.height).toBeGreaterThan(627);
  expect(next!.y + next!.height).toBeLessThanOrEqual(667);
  await page.screenshot({
    path: test.info().outputPath("verification-contacts.png"),
  });

  expect(state.posts).toHaveLength(0);
  await page.locator("#verification-phone").fill("123");
  await page.locator("#verification-email").fill("hello@example.com");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("+7");
  expect(state.posts).toHaveLength(0);
  await page.locator("#verification-phone").fill("8 (999) 123-45-67");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByTitle("Проверка личности Aura")).toHaveAttribute(
    "src",
    "https://verify.example/session-private",
  );
  expect(state.posts).toEqual([
    {
      action: "aura-customer",
      body: { phone: "+79991234567", email: "hello@example.com" },
    },
    { action: "aura-kyc", body: {} },
  ]);
});
test("provider unavailable cannot fake a saved profile", async ({ page }) => {
  const state = await setup(page, false);
  await page
    .getByRole("link", { name: "Личные данные Имя и контакты" })
    .click();
  await expect(page.getByRole("alert")).toContainText("недоступно");
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

for (const theme of ["light", "dark"]) {
  test(`verification composition: ${theme}, pinned action and layered artwork`, async ({
    page,
  }, info) => {
    await setup(page, true, theme);
    await page
      .getByRole("link", { name: "Верификация Подтверждение личности" })
      .click();
    const screen = page.getByRole("region", {
      name: "Проверка личности",
      exact: true,
    });
    await expect(screen).toBeVisible();
    const images = screen.locator("img");
    await expect(images).toHaveCount(2);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("src", /\/assets\/.*\.webp$/);
      await expect
        .poll(() =>
          image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    for (const size of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(size);
      const button = page.getByRole("button", { name: "Начать", exact: true });
      await expect(button).toBeVisible();
      const rect = await button.boundingBox();
      expect(rect!.y + rect!.height).toBeGreaterThan(size.height - 40);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath(`verification-${theme}.png`),
      animations: "disabled",
    });
  });
}

test("verification uses Telegram back and a plain Start button", async ({
  page,
}) => {
  await setup(page, true, "light", true);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  const screen = page.getByRole("region", {
    name: "Проверка личности",
    exact: true,
  });
  await expect(screen).toBeVisible();
  await expect(
    screen.getByRole("button", { name: "Начать", exact: true }).locator("svg"),
  ).toHaveCount(0);
  const view = screen.locator(
    'xpath=ancestor::section[contains(@class,"wpay-viewport")]',
  );
  await expect(view.locator(".k-navbar")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).Telegram.WebApp.BackButton.isVisible),
    )
    .toBe(true);
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(
    page.getByRole("region", { name: "Проверка личности", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).Telegram.WebApp.BackButton.isVisible),
    )
    .toBe(false);
});

test("Telegram back from contacts returns to verification start before closing", async ({
  page,
}) => {
  await setup(page, true, "light", true);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ваши контакты" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(
    page.getByRole("button", { name: "Начать", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Контакты для верификации", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(
    page.getByRole("region", { name: "Проверка личности", exact: true }),
  ).toHaveCount(0);
});

test("embedded verification stays inside app, back resumes contacts, and polling detects completion", async ({
  page,
}) => {
  const state = await setup(page, true, "light", true);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page.locator("#verification-phone").fill("+79991234567");
  await page.locator("#verification-email").fill("hello@example.com");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  const frame = page.getByTitle("Проверка личности Aura");
  await expect(frame).toBeVisible();

  await expect(
    page
      .frameLocator('iframe[title="Проверка личности Aura"]')
      .getByRole("heading", { name: "Защищённая проверка" }),
  ).toBeVisible();
  for (const size of [
    { width: 375, height: 667 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(size);
    const rect = await frame.boundingBox();
    expect(rect!.height).toBeGreaterThan(size.height - 160);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height);
  }
  const posts = state.posts.length;
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(frame).toHaveCount(0);
  await expect(page.locator("#verification-email")).toHaveValue(
    "hello@example.com",
  );
  await page
    .getByRole("button", { name: "Продолжить проверку", exact: true })
    .click();
  await expect(frame).toBeVisible();
  expect(state.posts.length).toBe(posts);
  state.verified = true;
  await expect(
    page.getByRole("heading", { name: "Личность подтверждена" }),
  ).toBeVisible({ timeout: 12000 });
  await expect(frame).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "session-private",
  );
});
