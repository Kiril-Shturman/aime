import { test, expect } from "@playwright/test";

const address = "UQ" + "a".repeat(46);
async function setup(
  page: import("@playwright/test").Page,
  theme: string,
  outage = false,
) {
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
  }, theme);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (outage && path.startsWith("/api/wallet/"))
      return route.fulfill({
        status: 503,
        json: { detail: "Сервис недоступен" },
      });
    if (path.endsWith("/status"))
      return route.fulfill({ json: { configured: true } });
    if (path.endsWith("/overview"))
      return route.fulfill({
        json: {
          balances: [{ asset: "USDT", available: "1250", reserved: "0" }],
          rates: [
            { source: "USD", target: "RUB", rate: "92.5", is_valid: true },
          ],
          transactions: [],
        },
      });
    if (path.endsWith("/withdrawal-estimate"))
      return route.fulfill({
        json: {
          intent_id: "estimate-one",
          fee: "1",
          total: "26.5",
          expires_at: Date.now() / 1000 + 120,
        },
      });
    if (path.endsWith("/withdrawal-create"))
      return route.fulfill({
        json: { status: "processing", spend_id: "payout-one" },
      });
    if (path.endsWith("/addresses"))
      return route.fulfill({ json: { items: [] } });

    return route.fulfill({ json: { items: [] } });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto("/wallet");
}
for (const theme of ["light", "dark"]) {
  test(`${theme}: withdrawal network is independent of deposit addresses`, async ({
    page,
  }) => {
    await setup(page, theme);
    await page
      .locator(".wpay-wallet-home span.font-semibold")
      .filter({ hasText: /^Tether$/ })
      .first()
      .click();
    await page
      .locator('[data-wallet-surface="asset"]')
      .getByRole("button", { name: "Вывести", exact: true })
      .click();
    await page
      .locator('[aria-hidden="false"]')
      .last()
      .getByText("Tether", { exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("group", { name: "Адрес списания" }),
    ).toHaveCount(0);
    await page.getByLabel("Сеть вывода", { exact: true }).selectOption("TON");
    await page.getByLabel("Адрес кошелька", { exact: true }).fill(address);
    await page.getByLabel("Сумма вывода USDT", { exact: true }).fill("25.5");
    await page
      .getByRole("button", { name: "Проверить реквизиты", exact: true })
      .click();
    await expect(page.getByText("26.5 USDT", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Сеть вывода", { exact: true })).toHaveValue(
      "TON",
    );
    await expect(
      page.getByLabel("Сумма вывода USDT", { exact: true }),
    ).toHaveValue("25.5");
  });
  test(`${theme}: back closes asset menu`, async ({ page }) => {
    await setup(page, theme);
    await page
      .locator(".wpay-wallet-home span.font-semibold")
      .filter({ hasText: /^Tether$/ })
      .first()
      .click();
    const asset = page.locator('[data-wallet-surface="asset"]');
    await asset.getByLabel("Ещё", { exact: true }).click();
    await expect(
      page.locator(".k-popover").getByText("AML проверка", { exact: true }),
    ).toBeVisible();
    await asset.getByLabel("Назад", { exact: true }).click();
    await expect(asset.locator('[aria-label="Ещё"]')).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
}
test("provider failure does not create demo balances or addresses", async ({
  page,
}) => {
  await setup(page, "light", true);
  await page
    .locator(".wpay-wallet-home span.font-semibold")
    .filter({ hasText: /^Tether$/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть адрес BSC", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("1,234.56 USDT", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0x8e908…0a268", { exact: true })).toHaveCount(0);
});

test("live deposit requests the chosen asset and never shows sample QR data", async ({
  page,
}) => {
  await setup(page, "light");
  let requested: unknown;
  await page.route("**/api/wallet/deposit", (route) => {
    requested = route.request().postDataJSON();
    return route.fulfill({
      json: { address: "0x" + "a".repeat(40), network: "ETH" },
    });
  });
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  const flow = page.locator('[aria-hidden="false"]').last();
  await flow.getByText("Ethereum", { exact: true }).last().click();
  await expect(
    flow.getByLabel("QR-код пополнения", { exact: true }),
  ).toBeVisible();
  expect(requested).toEqual({ asset: "ETH", network: "ETH" });
  await expect(page.getByText("Пример QR-кода", { exact: true })).toHaveCount(
    0,
  );
});

test("opening a portfolio does not allocate addresses; selected network shows its minimum", async ({
  page,
}) => {
  await setup(page, "light");
  let issued = 0;
  await page.route("**/api/wallet/address", (route) => {
    issued++;
    return route.fulfill({
      json: {
        asset: "USDT",
        assets: ["USDT"],
        address: "0x" + "b".repeat(40),
        network: "BSC",
        min_deposit: "5",
      },
    });
  });
  await page
    .locator(".wpay-wallet-home span.font-semibold")
    .filter({ hasText: /^Tether$/ })
    .first()
    .click();
  expect(issued).toBe(0);
  await page
    .locator('[data-wallet-surface="asset"]')
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  await page
    .locator(".wpay-deposit-method-sheet.modal-in")
    .getByText("USDT · BEP20", { exact: true })
    .click();
  await expect(
    page.getByLabel("QR-код пополнения", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Минимум пополнения: 5 USDT. Переводы меньше минимума не зачисляются.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(issued).toBe(1);
});

test("withdrawal is sent only after accepting the server fee", async ({
  page,
}) => {
  await setup(page, "light");
  let sent = 0;
  await page.route("**/api/wallet/withdrawal-create", (route) => {
    sent++;
    expect(route.request().postDataJSON()).toEqual({
      intent_id: "estimate-one",
    });
    return route.fulfill({
      json: { spend_id: "payout-one", status: "processing" },
    });
  });
  await page
    .locator(".wpay-wallet-home span.font-semibold")
    .filter({ hasText: /^Tether$/ })
    .first()
    .click();
  await page
    .locator('[data-wallet-surface="asset"]')
    .getByRole("button", { name: "Вывести", exact: true })
    .click();
  await page
    .locator('[aria-hidden="false"]')
    .last()
    .getByText("Tether", { exact: true })
    .last()
    .click();
  await page.getByLabel("Сеть вывода", { exact: true }).selectOption("TON");
  await page.getByLabel("Адрес кошелька", { exact: true }).fill(address);
  await page.getByLabel("Сумма вывода USDT", { exact: true }).fill("25.5");
  await page
    .getByRole("button", { name: "Проверить реквизиты", exact: true })
    .click();
  await expect(page.getByText("26.5 USDT", { exact: true })).toBeVisible();
  expect(sent).toBe(0);
  await page
    .getByRole("button", { name: "Подтвердить вывод", exact: true })
    .click();
  await expect(
    page.getByText("Вывод принят. Ожидаем отправку в сеть.", { exact: true }),
  ).toBeVisible();
  expect(sent).toBe(1);
});

test("TRON displays the exact amount returned by the provider", async ({
  page,
}) => {
  await setup(page, "light");
  await page.route("**/api/wallet/deposit", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      asset: "USDT",
      network: "TRON",
      amount: "10",
    });
    return route.fulfill({
      json: {
        network: "TRON",
        address: "T" + "a".repeat(33),
        amount: "10.3725",
        requested: "10",
        claim_id: 5123,
        expires_at: new Date(Date.now() + 1500000).toISOString(),
      },
    });
  });
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  const flow = page.locator('[aria-hidden="false"]').last();
  await flow.locator("li").filter({ hasText: "USDT" }).first().click();
  await flow.getByText("USDT · TRC20", { exact: true }).click();
  await flow.getByLabel("Сумма пополнения USDT", { exact: true }).fill("10");
  await flow
    .getByRole("button", { name: "Получить реквизиты", exact: true })
    .click();
  await expect(flow.getByText("10.3725 USDT", { exact: true })).toBeVisible();
});

test("TRC20 withdrawal works with no deposit address and sends no source_address", async ({
  page,
}) => {
  await setup(page, "light");
  let allocations = 0,
    estimateBody: Record<string, unknown> | null = null;
  await page.route("**/api/wallet/address", (route) => {
    allocations++;
    return route.fulfill({
      status: 400,
      json: { detail: "Address allocation is not needed" },
    });
  });
  await page.route("**/api/wallet/withdrawal-estimate", (route) => {
    estimateBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
        intent_id: "tron-one",
        fee: "1",
        total: "26.5",
        expires_at: Date.now() / 1000 + 120,
      },
    });
  });
  await page
    .locator(".wpay-wallet-home span.font-semibold")
    .filter({ hasText: /^Tether$/ })
    .first()
    .click();
  await page
    .locator('[data-wallet-surface="asset"]')
    .getByRole("button", { name: "Вывести", exact: true })
    .click();
  await page
    .locator('[aria-hidden="false"]')
    .last()
    .getByText("Tether", { exact: true })
    .last()
    .click();
  await page.getByLabel("Сеть вывода", { exact: true }).selectOption("TRON");
  await page
    .getByLabel("Адрес кошелька", { exact: true })
    .fill("T" + "a".repeat(33));
  await page.getByLabel("Сумма вывода USDT", { exact: true }).fill("25.5");
  await page
    .getByRole("button", { name: "Проверить реквизиты", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Подтвердить вывод", exact: true }),
  ).toBeEnabled();
  expect(estimateBody).toEqual({
    asset: "USDT",
    network: "TRON",
    address: "T" + "a".repeat(33),
    amount: "25.5",
  });
  expect(allocations).toBe(0);
});
