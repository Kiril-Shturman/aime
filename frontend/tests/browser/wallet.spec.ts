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
    if (path.endsWith("/status"))
      return route.fulfill({
        json: {
          configured: true,
          asset_routes: {
            USDT: ["BSC", "ETH", "TON", "SOL", "TRON"],
            TRX: ["TRON"],
            BNB: ["BSC"],
            ETH: ["ETH"],
            GRAM: ["TON"],
            SOL: ["SOL"],
            BTC: ["BTC"],
            XAUT: ["ETH"],
          },
        },
      });
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
  // Without a trusted asset-route response no actionable assets are shown.
  await expect(
    page
      .locator(".wpay-wallet-home span.font-semibold")
      .filter({ hasText: /^Tether$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Открыть адрес BSC", exact: true }),
  ).toHaveCount(0);
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

test("Aura TRON deposit opens permanent QR without requesting an exact amount", async ({
  page,
}) => {
  await setup(page, "light");
  await page.route("**/api/wallet/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        asset_routes: { USDT: ["TRON"] },
        deposit_modes: { USDT: { TRON: "address" } },
        capabilities: {
          cards: false,
          sbp_buy: true,
          crypto_processing: true,
          qr_pay: false,
        },
      },
    }),
  );
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/wallet/deposit", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({
      asset: "USDT",
      network: "TRON",
    });
    await pending;
    return route.fulfill({
      json: {
        provider: "aura",
        network: "TRON",
        chain: "mainnet",
        address: "T" + "a".repeat(33),
      },
    });
  });
  await page.reload();
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  const flow = page.locator('[aria-hidden="false"]').last();
  await flow.locator("li").filter({ hasText: "USDT" }).first().click();
  await flow.getByText("USDT · TRC20", { exact: true }).click();
  try {
    await expect(
      flow.getByRole("status", { name: "Загрузка реквизитов", exact: true }),
    ).toBeVisible();
    await expect(flow.getByText("Валюта", { exact: true })).toHaveCount(0);
    await expect(
      flow.getByRole("button", { name: "Получаем реквизиты…", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }

  await expect(
    flow.getByLabel("QR-код пополнения", { exact: true }),
  ).toBeVisible();
  await expect(
    flow.getByLabel("Сумма пополнения USDT", { exact: true }),
  ).toHaveCount(0);
  await expect(flow.getByText("Отправьте ровно", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    flow.getByRole("button", { name: "Скопировать адрес", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test("Aura deposit choices exclude TRX and other unsupported coins while keeping holdings", async ({
  page,
}) => {
  await setup(page, "dark");
  await page.route("**/api/wallet/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        asset_routes: {
          USDT: ["TRON", "BSC"],
          TRX: ["TRON"],
          BNB: ["BSC"],
          BTC: ["BTC"],
        },
        providers: { goswap: { configured: false } },
        deposit_modes: { USDT: { TRON: "address" } },
        capabilities: {
          sbp_buy: true,
          crypto_processing: true,
          cards: false,
          qr_pay: false,
        },
      },
    }),
  );
  await page.reload();
  await expect(
    page.locator(".wpay-wallet-home").getByText("TRON", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".wpay-wallet-home")
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  const flow = page.getByRole("main", { name: "Способы пополнения" });
  await expect(flow.getByText("Рубли", { exact: true })).toBeVisible();
  await expect(flow.locator("span.block").filter({ hasText: /^Tether$/ })).toBeVisible();
  await expect(flow.locator("li").filter({ hasText: "TRX" })).toHaveCount(0);
  await expect(flow.locator("li").filter({ hasText: "BNB" })).toHaveCount(0);
  await expect(flow.locator("li").filter({ hasText: "BTC" })).toHaveCount(0);
});

test("home promo carousel switches slides and opens referral and deposit flows", async ({ page }) => {
  await setup(page, "dark");
  const carousel = page.getByRole("region", { name: "Возможности wPay" });
  await expect(carousel).toBeVisible();
  await carousel.getByRole("button", { name: /Баннер 2:/ }).click();
  await expect(carousel.getByRole("button", { name: /Баннер 2:/ })).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: /Пополнить кошелёк/ }).click();
  await expect(page.getByRole("main", { name: "Способы пополнения" })).toBeVisible();
  await page.locator('[aria-label="Назад"]').last().click();
  await carousel.getByRole("button", { name: /Баннер 1:/ }).click();
  await expect(carousel.getByRole("button", { name: /Баннер 1:/ })).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: /Пригласить друзей/ }).click();
  await expect(page.getByLabel("Реферальная ссылка", { exact: true })).toBeVisible();
});
