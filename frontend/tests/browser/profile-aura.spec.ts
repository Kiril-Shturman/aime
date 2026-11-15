import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, enabled = true) {
  const state = {
    contact: null as null | { phone: string; email: string },
    verified: false,
    posts: [] as { action: string; body: unknown }[],
  };
  await page.addInitScript(() => {
    localStorage.setItem("ui-theme", "light");
    localStorage.setItem("wpay:intro:v1", "seen");
  });
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
  await page.goto("/wallet");
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
  await page
    .getByRole("button", { name: "Пройти проверку", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Продолжить проверку" }),
  ).toHaveAttribute("href", "https://verify.example/session-private");
  expect(state.posts.at(-1)).toEqual({ action: "aura-kyc", body: {} });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "session-private",
  );
  state.verified = true;
  await page.getByRole("button", { name: "Обновить статус" }).click();
  await expect(
    page.getByRole("heading", { name: "Личность подтверждена" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Пройти проверку" }),
  ).toHaveCount(0);
});
test("invalid contacts never post; viewing KYC never registers a customer", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Куда отправлять важное?" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await page.getByPlaceholder("name@example.com").fill("hello@example.com");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "На какой номер привязать СБП?" }),
  ).toBeVisible();
  await page.getByPlaceholder("+7 999 123-45-67").fill("123");
  await page
    .getByRole("button", { name: "Сохранить и пройти проверку" })
    .click();
  await expect(page.getByRole("alert")).toContainText("+7");
  expect(state.posts).toHaveLength(0);
});

test("two-step contact onboarding saves contacts and opens hosted KYC", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByPlaceholder("name@example.com").fill("hello@example.com");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.getByPlaceholder("+7 999 123-45-67").fill("8 (999) 123-45-67");
  await page
    .getByRole("button", { name: "Сохранить и пройти проверку" })
    .click();
  await expect(
    page.getByRole("link", { name: "Продолжить проверку" }),
  ).toHaveAttribute("href", "https://verify.example/session-private");
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
