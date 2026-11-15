import { test, expect, type Page } from "@playwright/test";
async function setup(
  page: Page,
  theme = "light",
  verified = true,
  existing = false,
) {
  const state = {
    posts: [] as { action: string; body: unknown; key?: string }[],
    fail: false,
    status: "awaiting_payment",
  };
  const quote = {
    quote_token: "private-quote",
    fiat_amount: "1000",
    provider_fee: "10",
    fiat_net: "990",
    crypto_amount: "10.702703",
    rate: "92.5",
    expires_at: new Date(Date.now() + 120000).toISOString(),
  };
  const order = () => ({
    ...quote,
    id: "test-order",
    status: state.status,
    qr_url: "https://qr.nspk.ru/test",
    payer_phone_masked: "+7•••1234",
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
  }, theme);
  await page.route("**/api/**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (route.request().method() === "POST")
      state.posts.push({
        action: action!,
        body: route.request().postDataJSON(),
        key: route.request().headers()["idempotency-key"],
      });
    if (action === "status")
      return route.fulfill({
        json: {
          configured: true,
          capabilities: {
            sbp_buy: true,
            crypto_processing: true,
            cards: false,
            qr_pay: false,
          },
          providers: { aura: { enabled: true, configured: true } },
          asset_routes: { USDT: ["BSC"] },
        },
      });
    if (action === "overview")
      return route.fulfill({
        json: { balances: [], rates: [], transactions: [] },
      });
    if (action === "aura-sbp-rate")
      return route.fulfill({
        json: {
          rate: "92.5",
          min_fiat_amount: "1000",
          max_fiat_amount: "100000",
        },
      });
    if (action === "aura-kyc")
      return route.fulfill({
        json: {
          verified,
          status: verified ? "verified" : "none",
          terminal: verified,
        },
      });
    if (action === "aura-customer")
      return route.fulfill({
        json: { email: "hello@example.com", phone: "+79991234567" },
      });
    if (action === "aura-sbp-orders")
      return route.fulfill({
        json: {
          data: existing
            ? [{ order_id: "test-order", status: "awaiting_payment" }]
            : [],
          pending_creation: false,
        },
      });
    if (action === "aura-sbp-quote") return route.fulfill({ json: quote });
    if (action === "aura-sbp-order") {
      if (route.request().method() === "POST" && state.fail) {
        state.fail = false;
        return route.fulfill({
          status: 503,
          json: { error: { name: "unavailable" } },
        });
      }
      return route.fulfill({ json: order() });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto("/wallet#tgWebAppVersion=6.1&tgWebAppPlatform=ios");
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  await page
    .getByRole("main", { name: "Способы пополнения" })
    .getByText("Рубли", { exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Пополнение через СБП" }),
  ).toBeVisible();
  return state;
}
for (const theme of ["light", "dark"])
  test(`${theme}: SBP quote needs confirmation and retry keeps identical intent`, async ({
    page,
  }) => {
    const state = await setup(page, theme);
    await expect(page.getByLabel("Сумма в рублях")).toBeVisible();
    expect(state.posts).toHaveLength(0);
    await page.screenshot({
      path: test.info().outputPath(`sbp-amount-${theme}.png`),
    });
    await page.getByLabel("Сумма в рублях").fill("999");
    await page.getByRole("button", { name: "Рассчитать пополнение" }).click();
    await expect(page.getByRole("alert")).toContainText("1,000");
    expect(state.posts).toHaveLength(0);
    await page.getByLabel("Сумма в рублях").fill("1000");
    await page.getByRole("button", { name: "Рассчитать пополнение" }).click();
    await expect(page.getByLabel("Расчёт пополнения")).toContainText(
      "10.702703 USDT",
    );
    expect(state.posts.map((p) => p.action)).toEqual(["aura-sbp-quote"]);
    state.fail = true;
    await page
      .getByRole("button", { name: "Подтвердить и получить QR" })
      .click();
    await expect(page.getByRole("alert")).toContainText("Ответ не получен");
    await page.getByRole("button", { name: "Проверить заявку" }).click();
    await expect(
      page.getByRole("heading", { name: "Оплатите по QR-коду" }),
    ).toBeVisible();
    const submissions = state.posts.filter(
      (p) => p.action === "aura-sbp-order",
    );
    expect(submissions).toHaveLength(2);
    expect(submissions[0].key).toBeTruthy();
    expect(submissions[0]).toEqual(submissions[1]);
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("private-quote");
    await page.screenshot({ path: test.info().outputPath(`sbp-${theme}.png`) });
    state.status = "completed";
    await expect(
      page.getByRole("heading", { name: "Пополнение зачислено" }),
    ).toBeVisible({ timeout: 12000 });
  });
test("SBP requires verified KYC and opens verification without creating orders", async ({
  page,
}) => {
  const state = await setup(page, "light", false);
  await expect(
    page.getByRole("heading", { name: "Подтвердите личность" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Открыть верификацию" }).click();
  await expect(
    page.getByRole("region", { name: "Проверка личности", exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(0);
});
test("SBP resumes an existing payment without another POST", async ({
  page,
}) => {
  const state = await setup(page, "light", true, true);
  await expect(
    page.getByRole("heading", { name: "Оплатите по QR-коду" }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Открыть оплату" }),
  ).toBeVisible();
});
