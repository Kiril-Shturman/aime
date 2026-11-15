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
    if (path.endsWith("/financial-capabilities"))
      return route.fulfill({
        json: { can_withdraw: true, can_transfer: true, currencies: [] },
      });
    if (path.endsWith("/custody-status"))
      return route.fulfill({
        json: {
          configured: false,
          generation_enabled: false,
          chain_env: "mainnet",
          creation_fee: "0",
          networks: [],
        },
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

async function openTelegramTransfer(page: import("@playwright/test").Page) {
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
    .getByText("По Telegram ID", { exact: true })
    .click();
}

test("disabled transfers show unavailable and never send money", async ({
  page,
}) => {
  await setup(page, "light");
  let posts = 0;
  await page.route("**/api/wallet/financial-capabilities", (route) =>
    route.fulfill({ json: { can_transfer: false, currencies: [] } }),
  );
  await page.route("**/api/wallet/transfer-*", (route) => {
    posts++;
    return route.fulfill({ json: {} });
  });
  await openTelegramTransfer(page);
  await expect(
    page.getByText("Переводы в Telegram недоступны", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
});

test("transfer confirms a server intent and retains it after timeout", async ({
  page,
}) => {
  await setup(page, "dark");
  let sends = 0,
    prepares = 0;
  await page.route("**/api/wallet/financial-capabilities", (route) =>
    route.fulfill({ json: { can_transfer: true, currencies: [] } }),
  );
  await page.route("**/api/wallet/transfer-prepare", (route) => {
    prepares++;
    expect(route.request().postDataJSON()).toEqual({
      recipient_id: "777",
      asset: "USDT",
      amount: "10",
    });
    return route.fulfill({ json: { intent_id: "server-transfer" } });
  });
  await page.route("**/api/wallet/transfer-send", (route) => {
    sends++;
    expect(route.request().postDataJSON()).toEqual({
      intent_id: "server-transfer",
    });
    return sends === 1
      ? route.fulfill({ status: 504, json: { detail: "Ответ потерян" } })
      : route.fulfill({ json: { status: "completed" } });
  });
  await openTelegramTransfer(page);
  await page.getByLabel("Telegram ID получателя", { exact: true }).fill("777");
  await page.getByLabel("Сумма перевода USDT", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Проверить перевод", exact: true })
    .click();
  expect(sends).toBe(0);
  await page
    .getByRole("button", { name: "Подтвердить перевод", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Ответ потерян" }),
  ).toHaveText("Ответ потерян");
  await page
    .getByRole("button", { name: "Подтвердить перевод", exact: true })
    .click();
  await expect(
    page.getByText("Перевод получен", { exact: true }),
  ).toBeVisible();
  expect(prepares).toBe(1);
  expect(sends).toBe(2);
});

test("invoice creation keeps server ownership and rechecks the same intent", async ({
  page,
}) => {
  await setup(page, "light");
  let creates = 0,
    prepares = 0;
  await page.route("**/api/wallet/invoice-prepare", (route) => {
    prepares++;
    expect(route.request().postDataJSON()).toEqual({
      asset: "USDT",
      amount: "10",
      description: "Подписка",
    });
    return route.fulfill({ json: { intent_id: "server-invoice" } });
  });
  await page.route("**/api/wallet/invoice-create", (route) => {
    creates++;
    expect(route.request().postDataJSON()).toEqual({
      intent_id: "server-invoice",
    });
    return creates === 1
      ? route.fulfill({ status: 504, json: { detail: "Ответ потерян" } })
      : route.fulfill({
          json: {
            invoice_id: "1000",
            status: "active",
            bot_invoice_url: "https://t.me/goswap?start=invoice",
          },
        });
  });
  await page.getByRole("link", { name: "История", exact: true }).click();
  await page
    .getByLabel("Фильтр операций")
    .getByRole("button", { name: "Счета", exact: true })
    .click();
  await page.getByLabel("Сумма счёта", { exact: true }).fill("10");
  await page.getByLabel("Описание счёта", { exact: true }).fill("Подписка");
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Ответ потерян" }),
  ).toHaveText("Ответ потерян");
  await page
    .getByRole("button", { name: "Проверить созданный счёт", exact: true })
    .click();
  await expect(
    page.getByText("Счёт № 1000 · active", { exact: true }),
  ).toBeVisible();
  expect(prepares).toBe(1);
  expect(creates).toBe(2);
});

test("organization without withdrawal capability sees unavailable", async ({
  page,
}) => {
  await setup(page, "light");
  let moneyCalls = 0;
  await page.route("**/api/wallet/financial-capabilities", (route) =>
    route.fulfill({ json: { can_withdraw: false } }),
  );
  await page.route("**/api/wallet/withdrawal-estimate", (route) => {
    moneyCalls++;
    return route.fulfill({ json: {} });
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
  await expect(
    page.getByText("Вывод в сеть недоступен", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Сумма вывода USDT", { exact: true }),
  ).toHaveCount(0);
  expect(moneyCalls).toBe(0);
});

test("definitive invoice rejection unlocks a new intent", async ({ page }) => {
  await setup(page, "light");
  let prepares = 0,
    creates = 0;
  await page.route("**/api/wallet/invoice-prepare", (route) => {
    prepares++;
    return route.fulfill({ json: { intent_id: "new-" + prepares } });
  });
  await page.route("**/api/wallet/invoice-create", (route) => {
    creates++;
    expect(route.request().postDataJSON()).toEqual({
      intent_id: "new-" + creates,
    });
    return creates === 1
      ? route.fulfill({
          status: 422,
          json: {
            error: { name: "INVOICE_REJECTED" },
            detail: "Сумма отклонена",
          },
        })
      : route.fulfill({ json: { invoice_id: "1001", status: "active" } });
  });
  await page.getByRole("link", { name: "История", exact: true }).click();
  await page
    .getByLabel("Фильтр операций")
    .getByRole("button", { name: "Счета", exact: true })
    .click();
  await page.getByLabel("Сумма счёта", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(page.getByLabel("Сумма счёта", { exact: true })).toBeEnabled();
  await page.getByLabel("Сумма счёта", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(
    page.getByText("Счёт № 1001 · active", { exact: true }),
  ).toBeVisible();
  expect(prepares).toBe(2);
});

const exchangeNetworks = [
  {
    network: "TRON",
    name: "Tron",
    standard: "TRC20",
    can_send: true,
    can_receive: true,
  },
  {
    network: "BSC",
    name: "BNB Smart Chain",
    standard: "BEP20",
    can_send: true,
    can_receive: true,
  },
  {
    network: "ETH",
    name: "Ethereum",
    standard: "ERC20",
    can_send: true,
    can_receive: true,
  },
  {
    network: "SOL",
    name: "Solana",
    standard: "SPL",
    can_send: true,
    can_receive: true,
  },
  {
    network: "TON",
    name: "TON",
    standard: "Jetton",
    can_send: false,
    can_receive: false,
  },
];
const exchangeQuote = (amount = "99.192") => ({
  provider: "fixedfloat",
  available: true,
  to_amount: amount,
  difference: "0.808",
  reasons: [],
  quoted_at: Date.now() / 1000,
  refresh_after_seconds: 20,
  execution_enabled: false,
});
async function openNetworkExchange(
  page: import("@playwright/test").Page,
  theme = "light",
) {
  await setup(page, theme);
  await page.route("**/api/wallet/exchange-status", (route) =>
    route.fulfill({ json: { configured: true, networks: exchangeNetworks } }),
  );
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Обменять", exact: true })
    .click();
  return page.getByRole("main", { name: "Межсетевой обмен USDT" });
}
for (const theme of ["light", "dark"])
  test(`${theme}: real exchange quote shows payout and no money action`, async ({
    page,
  }) => {
    const panel = await openNetworkExchange(page, theme);
    let calls = 0;
    await page.route("**/api/wallet/exchange-quote", (route) => {
      calls++;
      expect(route.request().postDataJSON()).toEqual({
        from_network: "TRON",
        to_network: "BSC",
        amount: "100",
        rate_type: "float",
      });
      expect(route.request().headers()["x-api-key"]).toBeUndefined();
      return route.fulfill({ json: exchangeQuote() });
    });
    await panel
      .getByRole("button", { name: "Рассчитать", exact: true })
      .click();
    await expect(
      panel.getByLabel("Сумма получения USDT", { exact: true }),
    ).toHaveText("99.192 USDT");
    await expect(
      panel.getByText("Разница: 0.808 USDT", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Продолжить", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByText(/Обмен и списание средств пока недоступны/),
    ).toBeVisible();
    await expect(
      panel.getByLabel("Сеть получения USDT").locator('option[value="TON"]'),
    ).toBeDisabled();
    expect(calls).toBe(1);
  });

test("exchange maintenance response never displays a payout", async ({
  page,
}) => {
  const panel = await openNetworkExchange(page);
  await page.route("**/api/wallet/exchange-quote", (route) =>
    route.fulfill({
      json: {
        ...exchangeQuote("99.182"),
        available: false,
        reasons: ["MAINTENANCE_TO"],
      },
    }),
  );
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await expect(
    panel.getByText("Сеть получения на обслуживании", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByLabel("Сумма получения USDT", { exact: true }),
  ).toHaveCount(0);
});

test("changing amount invalidates exchange payout and ignores stale response", async ({
  page,
}) => {
  const panel = await openNetworkExchange(page);
  let release: () => void = () => {};
  await page.route("**/api/wallet/exchange-quote", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: exchangeQuote() }).catch(() => {});
  });
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Рассчитываем…", exact: true }),
  ).toBeVisible();
  await panel
    .getByLabel("Сумма межсетевого обмена USDT", { exact: true })
    .fill("200");
  release();
  await expect(
    panel.getByRole("button", { name: "Рассчитать", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByLabel("Сумма получения USDT", { exact: true }),
  ).toHaveCount(0);
});

test("exchange error does not fall back to reference or demo prices", async ({
  page,
}) => {
  const panel = await openNetworkExchange(page);
  await page.route("**/api/wallet/exchange-quote", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Сервис обмена недоступен" },
    }),
  );
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Сервис обмена недоступен");
  await expect(
    panel.getByLabel("Сумма получения USDT", { exact: true }),
  ).toHaveCount(0);
});

test("closing an in-flight exchange calculation allows a fresh quote on reopen", async ({
  page,
}) => {
  const panel = await openNetworkExchange(page);
  let release: () => void = () => {};
  await page.route("**/api/wallet/exchange-quote", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: exchangeQuote() }).catch(() => {});
  });
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Рассчитываем…", exact: true }),
  ).toBeVisible();
  await panel
    .locator("xpath=ancestor::section[1]")
    .getByLabel("Назад", { exact: true })
    .click();
  release();
  await page.route("**/api/wallet/exchange-quote", (route) =>
    route.fulfill({ json: exchangeQuote() }),
  );
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Обменять", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Рассчитать", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await expect(
    panel.getByLabel("Сумма получения USDT", { exact: true }),
  ).toBeVisible();
});

const custodyNetworks = [
  { network: "BTC", name: "Bitcoin", asset: "BTC" },
  { network: "ETH", name: "Ethereum", asset: "ETH" },
  { network: "BSC", name: "BNB Smart Chain", asset: "BNB" },
  { network: "TON", name: "TON", asset: "TON" },
  { network: "SOL", name: "Solana", asset: "SOL" },
];
const custodyStatus = {
  configured: true,
  generation_enabled: true,
  chain_env: "testnet",
  creation_fee: "0",
  deposit_enabled: false,
  withdraw_enabled: false,
  networks: custodyNetworks,
};
const publicCustodyWallet = (network = "BTC") => ({
  id: "wallet-" + network,
  network,
  chain_env: "testnet",
  asset: custodyNetworks.find((item) => item.network === network)?.asset,
  address:
    network === "BTC"
      ? "tb1q05fktjrqrr5ze7ntzukj0g0wrj5he0xmdk7a5j"
      : network === "SOL"
        ? "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"
        : network === "TON"
          ? "0QDTcUOcJvwtMx4R6Vbb-uYCtJELCzAAvdD439fc2Y0UNiNG"
          : "0x919538116b4F25f1CE01429fd9Ed7964556bf565",
  provider: "wpay",
  deposit_enabled: false,
  withdraw_enabled: false,
});
async function openCustody(page: import("@playwright/test").Page) {
  await page.goto("/wallet");
  return page.getByRole("region", { name: "Собственные кошельки WPay" });
}
for (const theme of ["light", "dark"])
  test(`${theme}: create an owned wallet for free and keep it on reopen`, async ({
    page,
  }) => {
    await setup(page, theme);
    let creates = 0;
    const wallets: ReturnType<typeof publicCustodyWallet>[] = [];
    await page.route("**/api/wallet/custody-status", (route) =>
      route.fulfill({ json: custodyStatus }),
    );
    await page.route("**/api/wallet/custody-wallets", (route) =>
      route.fulfill({ json: { items: wallets } }),
    );
    await page.route("**/api/wallet/custody-wallet", (route) => {
      creates++;
      expect(route.request().postDataJSON()).toEqual({ network: "BTC" });
      wallets.push(publicCustodyWallet());
      return route.fulfill({ json: wallets[0] });
    });
    const panel = await openCustody(page);
    await expect(
      panel.getByText("Тестовые сети. Не отправляйте реальные средства.", {
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Создать кошелёк Bitcoin", exact: true })
      .click();
    await expect(panel.getByLabel("Адрес Bitcoin", { exact: true })).toHaveText(
      publicCustodyWallet().address,
    );
    await expect(
      panel.getByRole("button", {
        name: "Создать кошелёк Bitcoin",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "Скопировать адрес Bitcoin",
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.getByText("$2.00", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    await expect(page.getByRole("link", { name: /Мои кошельки/ })).toHaveCount(
      0,
    );
    await expect(panel).toHaveCount(0);
    await page.getByRole("link", { name: "Кошелёк", exact: true }).click();
    await expect(panel.getByLabel("Адрес Bitcoin", { exact: true })).toHaveText(
      publicCustodyWallet().address,
    );
    expect(creates).toBe(1);
  });

test("wallet creation supports all five networks without secret parameters", async ({
  page,
}) => {
  await setup(page, "light");
  const requested: string[] = [];
  await page.route("**/api/wallet/custody-status", (route) =>
    route.fulfill({ json: custodyStatus }),
  );
  await page.route("**/api/wallet/custody-wallets", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/wallet/custody-wallet", (route) => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(["network"]);
    requested.push(body.network);
    return route.fulfill({ json: publicCustodyWallet(body.network) });
  });
  const panel = await openCustody(page);
  for (const network of custodyNetworks) {
    await panel
      .getByRole("button", {
        name: "Создать кошелёк " + network.name,
        exact: true,
      })
      .click();
    await expect(
      panel.getByLabel("Адрес " + network.name, { exact: true }),
    ).toBeVisible();
  }
  expect(requested).toEqual(["BTC", "ETH", "BSC", "TON", "SOL"]);
});

test("wallet generation failure never displays a fake address", async ({
  page,
}) => {
  await setup(page, "light");
  await page.route("**/api/wallet/custody-status", (route) =>
    route.fulfill({ json: custodyStatus }),
  );
  await page.route("**/api/wallet/custody-wallets", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/wallet/custody-wallet", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Создание кошелька недоступно" },
    }),
  );
  const panel = await openCustody(page);
  await panel
    .getByRole("button", { name: "Создать кошелёк Bitcoin", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Создание кошелька недоступно",
  );
  await expect(panel.getByLabel("Адрес Bitcoin", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    panel.getByRole("button", { name: "Создать кошелёк Bitcoin", exact: true }),
  ).toBeEnabled();
});

test("unconfigured custody disables generation", async ({ page }) => {
  await setup(page, "dark");
  await page.route("**/api/wallet/custody-status", (route) =>
    route.fulfill({
      json: { ...custodyStatus, configured: false, generation_enabled: false },
    }),
  );
  await page.route("**/api/wallet/custody-wallets", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  const panel = await openCustody(page);
  await expect(
    panel.getByText("Создание кошельков пока недоступно", { exact: true }),
  ).toBeVisible();
  for (const network of custodyNetworks)
    await expect(
      panel.getByRole("button", {
        name: "Создать кошелёк " + network.name,
        exact: true,
      }),
    ).toBeDisabled();
});

for (const theme of ["light", "dark"])
  test(`${theme}: owned wallet menu is aligned and hides without destroying the address`, async ({
    page,
  }) => {
    await setup(page, theme);
    let hidden = false,
      hides = 0;
    await page.route("**/api/wallet/custody-status", (route) =>
      route.fulfill({ json: { ...custodyStatus, chain_env: "mainnet" } }),
    );
    const row = { ...publicCustodyWallet("SOL"), chain_env: "mainnet" };
    await page.route("**/api/wallet/custody-wallets", (route) =>
      route.fulfill({ json: { items: hidden ? [] : [row] } }),
    );
    await page.route("**/api/wallet/custody-wallet-hide", (route) => {
      expect(route.request().postDataJSON()).toEqual({ wallet_id: row.id });
      hidden = true;
      hides++;
      return route.fulfill({ json: { id: row.id, hidden: true } });
    });
    await page.route("**/api/wallet/custody-wallet", (route) => {
      hidden = false;
      return route.fulfill({ json: row });
    });
    const panel = await openCustody(page);
    await panel
      .getByRole("button", { name: "Открыть кошелёк Solana", exact: true })
      .click();
    const details = page.getByRole("main", {
      name: "Собственный кошелёк",
      exact: true,
    });
    const surface = details.locator(
      "xpath=ancestor::section[@data-wallet-surface][1]",
    );
    await expect(
      details.getByText("Баланс сети ещё не подключён", { exact: true }),
    ).toBeVisible();
    await expect(details.getByText("425.5", { exact: true })).toHaveCount(0);
    await details
      .getByRole("button", { name: "Пополнить", exact: true })
      .click();
    await expect(
      details.getByRole("region", { name: "QR-код собственного кошелька" }),
    ).toBeVisible();
    await details.getByRole("button", { name: "Вывести", exact: true }).click();
    await expect(
      page.getByText("Вывод для собственных кошельков ещё не подключён", {
        exact: true,
      }),
    ).toBeVisible();
    const trigger = surface.getByLabel("Ещё", { exact: true });
    await trigger.click();
    const menu = page.locator('[aria-label="Меню кошелька"]:visible');
    for (const title of ["Пополнить", "Вывести", "Обменять", "Удалить кошелёк"])
      await expect(menu.getByText(title, { exact: true })).toBeVisible();
    const triggerBox = (await trigger.boundingBox())!,
      menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await menu.getByText("Удалить кошелёк", { exact: true }).click();
    await page
      .locator(".dialog.modal-in .dialog-button")
      .filter({ hasText: /^Отмена$/ })
      .click();
    expect(hides).toBe(0);
    await trigger.click();
    await menu.getByText("Удалить кошелёк", { exact: true }).click();
    await page
      .locator(".dialog.modal-in .dialog-button")
      .filter({ hasText: /^Удалить$/ })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Создать кошелёк Solana",
        exact: true,
      }),
    ).toBeVisible();
    expect(hides).toBe(1);
    await panel
      .getByRole("button", { name: "Создать кошелёк Solana", exact: true })
      .click();
    await expect(panel.getByLabel("Адрес Solana", { exact: true })).toHaveText(
      row.address,
    );
  });

test("address details menu contains wallet actions and no illustrative balance", async ({
  page,
}) => {
  await setup(page, "light");
  const address = "0x" + "b".repeat(40);
  await page.route("**/api/wallet/addresses", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            asset: "USDT",
            assets: ["USDT"],
            network: "BSC",
            address,
            min_deposit: "1",
          },
        ],
      },
    }),
  );
  await page
    .locator(".wpay-wallet-home span.font-semibold")
    .filter({ hasText: /^Tether$/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Открыть адрес BSC", exact: true })
    .click();
  const details = page
    .locator('[data-wallet-surface="grouped"][aria-hidden="false"]')
    .filter({
      has: page.getByRole("region", {
        name: "Реквизиты кошелька",
        exact: true,
      }),
    });
  await expect(
    details.getByRole("region", { name: "Баланс адреса", exact: true }),
  ).not.toContainText("425.5");
  await details.getByLabel("Ещё", { exact: true }).click();
  const menu = page.locator('[aria-label="Меню кошелька"]:visible');
  for (const title of ["Пополнить", "Вывести", "Обменять", "Удалить кошелёк"])
    await expect(menu.getByText(title, { exact: true })).toBeVisible();
  await expect(menu.getByText("Тёмная тема", { exact: true })).toHaveCount(0);
  await details.getByLabel("Назад", { exact: true }).click();
  await expect(menu).toHaveCount(0);
});
