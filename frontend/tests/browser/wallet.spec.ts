import { test, expect } from "@playwright/test";

const address = "UQ" + "a".repeat(46);
async function setup(
  page: import("@playwright/test").Page,
  theme: string,
  outage = false,
  cards = false,
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
    if (path.endsWith("/referrals"))
      return route.fulfill({
        json: {
          link: "https://t.me/Workingpaybot?start=ref_test",
          invited: 3,
          rewards: { USDT: "0" },
          activity: [{ day: new Date().toISOString().slice(0, 10), count: 3 }],
          rewards_enabled: false,
        },
      });
    if (path.endsWith("/financial-capabilities"))
      return route.fulfill({
        json: { can_withdraw: true, can_transfer: true, currencies: [] },
      });
    if (cards && path.endsWith("/rapira-depth"))
      return route.fulfill({ json: { ask: [{ price: "86.39", amount: "32" }], bid: [{ price: "86.38", amount: "20" }] } });
    if (cards && path.endsWith("/cbr-usd"))
      return route.fulfill({ json: { rate: "82.45", date: "18.11.2026" } });
    if (cards && path.endsWith("/aura-cards"))
      return route.fulfill({
        json: { data: [
          { status: "opened", balance: "10.15", currency: "USD" },
          { status: "opened", balance: "5.85", currency: "USDT" },
          { status: "cancelled", balance: "20", currency: "USD" },
        ] },
      });
    if (path.endsWith("/status"))
      return route.fulfill({
        json: {
          configured: true,
          ...(cards ? { capabilities: { cards: true } } : {}),
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
  await expect(
    flow.locator("span.block").filter({ hasText: /^Tether$/ }),
  ).toBeVisible();
  await expect(flow.locator("li").filter({ hasText: "TRX" })).toHaveCount(0);
  await expect(flow.locator("li").filter({ hasText: "BNB" })).toHaveCount(0);
  await expect(flow.locator("li").filter({ hasText: "BTC" })).toHaveCount(0);
});

test("home promo carousel switches slides and routes QR to scanner capability check", async ({
  page,
}) => {
  await setup(page, "dark");
  const carousel = page.getByRole("region", { name: "Возможности wPay" });
  await expect(carousel).toBeVisible();
  await carousel.getByRole("button", { name: /Баннер 2:/ }).click();
  await expect(
    carousel.getByRole("button", { name: /Баннер 2:/ }),
  ).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: /Сканировать QR-код/ }).click();
  await expect(
    page.getByText("Оплата QR сейчас не подключена", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main", { name: "Способы пополнения" }),
  ).toHaveCount(0);
  const bounds = await carousel.locator(".wpay-promos-rail").boundingBox();
  if (!bounds) throw new Error("Missing carousel bounds");
  await page.mouse.move(bounds.x + 70, bounds.y + 38);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 195, bounds.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect(
    carousel.getByRole("button", { name: /Баннер 1:/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByLabel("Реферальная ссылка", { exact: true }),
  ).toHaveCount(0);
  await expect(carousel.locator(".wpay-promos-rail")).toHaveJSProperty(
    "scrollLeft",
    0,
  );
  await page.waitForTimeout(450);
  await expect(
    carousel.getByRole("button", { name: /Баннер 1:/ }),
  ).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: /Пригласить друзей/ }).click();
  await expect(
    page.getByLabel("Реферальная ссылка", { exact: true }),
  ).toHaveValue("https://t.me/Workingpaybot?start=ref_test");
  await expect(
    page.getByRole("button", { name: "Поделиться", exact: true }),
  ).toBeEnabled();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Скопировать", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Скопировано", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://t.me/Workingpaybot?start=ref_test",
  );
});

test("home promo advances automatically without horizontal scrolling", async ({
  page,
}) => {
  await setup(page, "dark");
  const carousel = page.getByRole("region", { name: "Возможности wPay" });
  await expect(
    carousel.getByRole("button", { name: /Баннер 1:/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    carousel.getByRole("button", { name: /Баннер 2:/ }),
  ).toHaveAttribute("aria-current", "true", { timeout: 8000 });
  await expect(carousel.locator(".wpay-promos-rail")).toHaveJSProperty(
    "scrollLeft",
    0,
  );
});

test("gift countdown persists its deadline across reload and expires without restarting", async ({
  page,
}) => {
  await page.clock.install();
  await setup(page, "dark");
  await expect(page.locator(".wpay-promo-countdown")).toBeVisible();
  const deadline = await page.evaluate(() =>
    localStorage.getItem("wpay:gift-banner:deadline:v1"),
  );
  expect(Number(deadline)).toBeGreaterThan(Date.now());
  await page.reload();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("wpay:gift-banner:deadline:v1"),
    ),
  ).toBe(deadline);
  await page.clock.fastForward(24 * 60 * 60 * 1000 + 1000);
  await page.getByRole("button", { name: /Баннер 1:/ }).click();
  await expect(page.locator(".wpay-promo-countdown")).toHaveText(
    "Время истекло",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("wpay:gift-banner:deadline:v1"),
    ),
  ).toBe(deadline);
});

test("oversized banner artwork does not create horizontal wallet scrolling", async ({
  page,
}) => {
  await setup(page, "dark");
  await page.route("**/api/wallet/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        capabilities: { sbp_buy: true, qr_pay: true },
        asset_routes: { USDT: ["TRON"] },
        providers: { goswap: { configured: false } },
        deposit_modes: { USDT: { TRON: "address" } },
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Возможности wPay" }),
  ).toBeVisible();
  for (const width of [375, 390, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page
          .locator(".wpay-desktop-page")
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      )
      .toBeLessThanOrEqual(0);
  }
});

test("promo slides leave left while the next enters from the right without stretching the page", async ({
  page,
}) => {
  await setup(page, "light");
  const carousel = page.getByRole("region", { name: "Возможности wPay" });
  await expect(carousel).toBeVisible();
  await carousel.getByRole("button", { name: /Баннер 2:/ }).click();
  await expect
    .poll(
      () =>
        carousel.evaluate((el) => {
          const rail = el
            .querySelector(".wpay-promos-rail")!
            .getBoundingClientRect();
          const previous = el
            .querySelector(".wpay-promo--friends")
            ?.getBoundingClientRect();
          const next = el
            .querySelector(".wpay-promo--qr")
            ?.getBoundingClientRect();
          return Boolean(
            previous && next && previous.x < rail.x - 1 && next.x > rail.x + 1,
          );
        }),
      { intervals: [10, 20, 30], timeout: 1000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      carousel.evaluate((el) =>
        Math.abs(
          el.querySelector(".wpay-promo--qr")!.getBoundingClientRect().x -
            el.querySelector(".wpay-promos-rail")!.getBoundingClientRect().x,
        ),
      ),
    )
    .toBeLessThan(1);
  await expect(page.locator(".wpay-promo--friends")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".wpay-desktop-page")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeLessThanOrEqual(0);
});

test("holding the promo locks vertical touch scrolling and pull refresh while horizontal swipe still works", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await setup(page, "dark");
  const carousel = page.getByRole("region", { name: "Возможности wPay" });
  await expect(carousel).toBeVisible();
  let refreshes = 0;
  await page.route("**/api/wallet/overview", (route) => {
    refreshes++;
    return route.fulfill({
      json: { balances: [], rates: [], transactions: [] },
    });
  });
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const dragTouch = async (x: number, y: number, dx: number, dy: number) => {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 10; step++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * step) / 10, y: y + (dy * step) / 10 }],
      });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const box = await carousel.boundingBox();
  if (!box) throw new Error("No banner");
  await dragTouch(box.x + 100, box.y + 30, 0, 95);
  await page.waitForTimeout(1000);
  expect(
    await page.locator(".wpay-desktop-page").evaluate((el) => el.scrollTop),
  ).toBe(0);
  expect(refreshes).toBe(0);
  await expect(
    page.getByRole("main", { name: "Способы пополнения" }),
  ).not.toBeVisible();
  await page.locator(".wpay-desktop-page").evaluate((el) => {
    el.scrollTop = 80;
  });
  const moved = await carousel.boundingBox();
  if (!moved) throw new Error("No banner after scroll");
  await dragTouch(moved.x + 100, moved.y + 30, 0, -70);
  expect(
    await page.locator(".wpay-desktop-page").evaluate((el) => el.scrollTop),
  ).toBe(80);
  await dragTouch(moved.x + moved.width - 35, moved.y + 40, -170, 0);
  await expect(
    carousel.getByRole("button", { name: /Баннер 2:/ }),
  ).toHaveAttribute("aria-current", "true");
});

test("first visit opens the wallet directly without automatic intro slides", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/status")
        ? {
            configured: true,
            asset_routes: { USDT: ["TRON"] },
            capabilities: {},
          }
        : { balances: [], rates: [], transactions: [], items: [] },
    }),
  );
  await page.goto("/wallet");
  await expect(page.locator(".wpay-wallet-home")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("wpay:intro:v1")),
  ).toBeNull();
  await expect(page.locator("dialog.wpay-intro")).toHaveCount(0);
});

test("slow first load keeps Exchange in place and banners skeletonized until wallet data arrives", async ({
  page,
}) => {
  await setup(page, "dark");
  let releaseStatus!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route("**/api/wallet/status", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        configured: true,
        asset_routes: { USDT: ["TRON"] },
        capabilities: { qr_pay: true, sbp_buy: true },
      },
    });
  });
  await page.reload();
  const main = page.locator(".wpay-wallet-home");
  const actions = main.getByRole("region", { name: "Действия с кошельком" });
  const exchange = actions.getByRole("button", {
    name: "Обменять",
    exact: true,
  });
  await expect(actions.getByRole("button")).toHaveCount(4);
  await expect(exchange).toBeVisible();
  await expect(exchange).toBeDisabled();
  const before = await exchange.boundingBox();
  const placeholder = main.getByRole("region", { name: "Загрузка баннеров" });
  await expect(placeholder).toBeVisible();
  const bannerBefore = await placeholder.boundingBox();
  await page.waitForTimeout(1100);
  await expect(placeholder).toBeVisible();
  await expect(
    main.getByRole("region", { name: "Возможности wPay" }),
  ).toHaveCount(0);
  releaseStatus();
  await expect(exchange).toBeEnabled();
  await expect(placeholder).toHaveCount(0);
  const banner = main.getByRole("region", { name: "Возможности wPay" });
  await expect(banner).toBeVisible();
  await expect(actions.getByRole("button")).toHaveCount(4);
  const after = await exchange.boundingBox();
  const bannerAfter = await banner.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect(Math.abs(bannerAfter!.y - bannerBefore!.y)).toBeLessThan(1);
  expect(bannerAfter!.height).toBe(bannerBefore!.height);
});

test("owner history never exposes provider console or branding", async ({
  page,
}) => {
  await setup(page, "dark");
  await page.route("**/api/wallet/access", (route) =>
    route.fulfill({ json: { owner: true } }),
  );
  await page.getByRole("link", { name: "История", exact: true }).click();
  await page.getByRole("button", { name: "Счета", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Новый счёт", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/GoSwap/i)).toHaveCount(0);
  await expect(
    page.getByRole("tablist", { name: "Раздел владельца" }),
  ).toHaveCount(0);
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


test("card issuance appears in all history and payments with amount and tariff details", async ({page}) => {
  await setup(page,"light");
  await page.route("**/api/wallet/overview",route=>route.fulfill({json:{balances:[{asset:"USDT",available:"0",reserved:"0"}],rates:[],transactions:[{event_id:"aura:test:card_issue:fixture",asset:"USDT",amount:"-25",type:"card_issue",created_at:new Date().toISOString(),detail:{status:"completed",card:"Виртуальная · •• 4242",plan:"Для подписок",provider_fee:"15",service_fee:"10"}}]}}));
  await page.reload();
  await page.getByRole("link",{name:"История",exact:true}).click();
  await expect(page.getByText("Выпуск карты",{exact:true})).toBeVisible();
  await expect(page.getByText("-$25.00",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Платежи",exact:true}).click();
  await expect(page.getByText("Выпуск карты",{exact:true})).toBeVisible();
  await page.getByText("Выпуск карты",{exact:true}).click();
  await expect(page.getByText("Для подписок",{exact:true})).toBeVisible();
  await expect(page.getByText("Виртуальная · •• 4242",{exact:true})).toBeVisible();
  await page.getByLabel("Закрыть детали операции", { exact: true }).click();
  await expect(page.getByText("Виртуальная · •• 4242", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  const details = page.getByRole("complementary", { name: "Детали операции" });
  await expect(details.getByText("Выберите операцию из списка.")).toBeVisible();
  await page.getByText("Выпуск карты", { exact: true }).click();
  await expect(details.getByText("Виртуальная · •• 4242", { exact: true })).toBeVisible();

});

test("card recharge history shows charged total and separate credited amount", async ({page}) => {
  await setup(page,"light");
  await page.route("**/api/wallet/overview",route=>route.fulfill({json:{balances:[{asset:"USDT",available:"1.774998",reserved:"0"}],rates:[],transactions:[{event_id:"aura:test:card_topup:fixture",asset:"USDT",amount:"-18.225002",type:"card_topup",created_at:new Date().toISOString(),detail:{status:"completed",card:"Виртуальная · •• 7446",card_credit:"15",provider_fee:"0.225002",service_fee:"3"}}]}}));
  await page.reload();
  await page.getByRole("link",{name:"История",exact:true}).click();
  await expect(page.getByText("Пополнение карты",{exact:true})).toBeVisible();
  await expect(page.getByText("-$18.23",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Платежи",exact:true}).click();
  await page.getByText("Пополнение карты",{exact:true}).click();
  await expect(page.getByText("На карту, USDT",{exact:true})).toBeVisible();
  await expect(page.getByText("0.225002",{exact:true})).toBeVisible();
});

test("desktop sidebar navigates and switches the wPay wordmark with the theme", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page, "light", false, true);
  const menu = page.getByRole("navigation", { name: "Основное" });
  const brand = page.getByRole("button", { name: "wPay", exact: true });
  const logo = brand.getByRole("img", { name: "wPay" });
  await expect(logo).toHaveAttribute("src", "/brands/wpay-wordmark.svg");
  await expect(page.locator(".wpay-bottom-menu")).toBeHidden();
  await expect(page.getByRole("region", { name: "Официальный курс ЦБ" }).getByText(/82,45/)).toBeVisible();
  await expect(menu.getByRole("heading", { name: "Основное" })).toBeVisible();
  const playing = menu.locator(".wpay-desktop-nav-icon[data-playing]");
  await expect(playing).toHaveCount(0);
  await menu.getByRole("button", { name: "История" }).click();
  await expect(playing).toHaveCount(1);
  await expect(playing.locator(".clock-minute")).toHaveCSS("animation-name", "minute-tap");
  await expect(menu.getByRole("button", { name: "История" })).toHaveAttribute("aria-current", "page");
  await page.locator(".wpay-desktop-sidebar").getByRole("button", { name: "Тёмная тема" }).click();
  await expect(logo).toHaveAttribute("src", "/brands/wpay-wordmark-light.svg");
  await brand.click();
  await expect(menu.getByRole("button", { name: "Кошелёк" })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("button", { name: "Профиль" }).click();
  await expect(playing).toHaveCount(1);
  await expect(playing.locator(".profile-figure")).toHaveCSS("animation-name", "profile-tap");
  const profileAside = page.getByRole("complementary", { name: "Сводка по балансам" });
  await expect(profileAside).toBeVisible();
  await expect(profileAside.getByRole("button", { name: /Кошелёк.*1,250/ })).toBeVisible();
  await expect(profileAside.getByRole("button", { name: /На картах.*\$16\.00/ })).toBeVisible();
  await expect(profileAside.getByRole("region", { name: "Стакан Rapira" }).getByText(/86,39/)).toBeVisible();
  await expect(menu.getByRole("button", { name: "Партнерка" })).toBeVisible();
  const support = menu.getByRole("button", { name: "Поддержка" });
  await support.click();
  await expect(support).toHaveAttribute("aria-current", "page");
  const thread = page.getByRole("log", { name: "Переписка с поддержкой" });
  const guide = page.getByRole("complementary", { name: "Как описать вопрос" });
  await expect(thread).toBeVisible();
  await expect(guide).toBeVisible();
  expect((await guide.boundingBox())!.x).toBeGreaterThan((await thread.boundingBox())!.x);
  await expect(page.getByRole("textbox", { name: "Сообщение поддержке" })).toBeVisible();
  await menu.getByRole("button", { name: "Профиль" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toBeHidden();
  await expect(profileAside).toBeHidden();
  await expect(page.locator(".wpay-bottom-menu")).toBeVisible();
});

test("desktop cards keep issued cards in the carousel and put new offers in tariffs", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page, "light", false, true);
  await page.route("**/api/wallet/aura-cards", (route) => route.fulfill({
    json: { data: [{ card_id: "test-card", kind: "virtual", status: "opened", masked_pan: "•••• 1234", balance: "10", currency: "USD" },
      { card_id: "test-card-2", kind: "virtual", status: "opened", masked_pan: "•••• 5678", balance: "20", currency: "USD" }] },
  }));
  await page.route("**/api/wallet/aura-card-fees", (route) => route.fulfill({
    json: { currency: "USDT", open_virtual_card_fee: "25", open_physical_card_fee: "50", minimum_recharge_amount: "5", recharge_fee_pct: "2", physical_recharge_fee_pct: "3" },
  }));
  await page.route("**/api/wallet/aura-card-operations?*", (route) => route.fulfill({ json: { data: [] } }));
  await page.getByRole("navigation", { name: "Основное" }).getByRole("button", { name: "Карты", exact: true }).click();
  const carousel = page.locator(".wpay-aura-carousel");
  await expect(carousel.locator(".wpay-aura-carousel-item")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Действия с картой" })).toBeVisible();
  const tariffs = page.getByRole("complementary", { name: "Тарифы карт" });
  await expect(tariffs.getByRole("button", { name: /Для подписок.*25 USDT/ })).toBeVisible();
  expect((await tariffs.boundingBox())!.x).toBeGreaterThan((await carousel.boundingBox())!.x);
  const owned = tariffs.getByRole("region", { name: "Мои карты" });
  await expect(owned.getByRole("button", { name: /1234/ })).toHaveAttribute("aria-pressed", "true");
  await owned.getByRole("button", { name: /5678/ }).click();
  await expect(owned.getByRole("button", { name: /5678/ })).toHaveAttribute("aria-pressed", "true");
  await expect(owned.getByRole("button", { name: /1234/ })).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(carousel.locator(".wpay-aura-carousel-item")).toHaveCount(6);
  await expect(tariffs).toBeHidden();
});

test("desktop verification shows the steps and goes back from contacts", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page, "light", false, true);
  await page.route("**/api/wallet/status", (route) => route.fulfill({
    json: { configured: true, providers: { aura: { enabled: true, configured: true } } },
  }));
  await page.route("**/api/wallet/aura-customer", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/wallet/aura-kyc", (route) => route.fulfill({
    json: { status: "not_started", verified: false, terminal: false },
  }));
  await page.getByRole("navigation", { name: "Основное" }).getByRole("button", { name: "Профиль" }).click();
  await page.getByRole("link", { name: /Верификация/ }).click();
  const verification = page.locator("main.wpay-verification-layout");
  const surface = page.locator(".wpay-verification-surface[aria-hidden=false]");
  await expect(surface).toHaveCSS("top", "0px");
  await expect(surface).toHaveCSS("bottom", "0px");
  await expect(page.locator('.wpay-desktop-body[data-tab="profile"]')).toBeHidden();
  await expect.poll(() => surface.evaluate((panel) =>
    panel.contains(document.elementFromPoint(window.innerWidth - 2, window.innerHeight - 2)),
  )).toBe(true);
  await expect(surface).toHaveCSS("border-top-left-radius", "0px");
  const header = verification.locator(".k-navbar");
  await expect(header.getByText("Верификация", { exact: true })).toBeVisible();
  const steps = verification.getByRole("complementary", { name: "Этапы проверки" });
  await expect(steps).toBeVisible();
  await verification.getByRole("button", { name: "Начать", exact: true }).click();
  await expect(verification.locator("#verification-phone")).toBeVisible();
  await header.getByLabel("Назад", { exact: true }).click();
  await expect(verification.getByRole("button", { name: "Начать", exact: true })).toBeVisible();
  await header.getByLabel("Назад", { exact: true }).click();
  await expect(steps).toBeHidden();
});

test("desktop asset chart fills the page above actions and balances", async ({ page }) => {
  await page.setViewportSize({ width: 1720, height: 860 });
  await setup(page, "light");
  const walletGrid = page.locator(".wpay-desktop-body[data-tab=wallet]");
  for (const [width, rightColumn] of [[1440, 310], [1500, 370], [1560, 430]]) {
    await page.setViewportSize({ width, height: 860 });
    await expect(walletGrid).toHaveCSS("grid-template-columns", new RegExp(` ${rightColumn}px$`));
    const workspace = page.locator(".wpay-desktop-sidebar");
    const sidebar = (await workspace.boundingBox())!;
    const grid = (await walletGrid.boundingBox())!;
    expect(grid.x - sidebar.x - sidebar.width).toBeCloseTo(0);
    await expect(walletGrid).toHaveCSS("padding-left", "48px");
  }
  await page.setViewportSize({ width: 1720, height: 860 });
  const home = await walletGrid.boundingBox();
  expect(home).not.toBeNull();
  await page.locator(".wpay-wallet-home span.font-semibold").filter({ hasText: /^Tether$/ }).first().click();
  const surface = page.locator('[data-wallet-surface="asset"][aria-hidden="false"]');
  const chart = surface.locator(".wpay-asset-chart-card");
  const side = surface.locator(".wpay-asset-sidebar");
  const actions = surface.locator(".wpay-asset-actions");
  await expect(chart).toBeVisible();
  await expect(side.getByText("Баланс приложения", { exact: true })).toBeVisible();
  await expect.poll(async () => (await side.boundingBox())?.width).toBe(home!.width);
  await expect.poll(async () => (await side.boundingBox())?.x).toBe(home!.x);
  await expect(actions).toHaveCSS("position", "static");
  await expect.poll(() => surface.evaluate((node) => {
    const bounds = (selector: string) => node.querySelector(selector)!.getBoundingClientRect();
    const chart = bounds(".wpay-asset-chart-card");
    const sidebar = bounds(".wpay-asset-sidebar");
    const actions = bounds(".wpay-asset-actions");
    const frame = node.getBoundingClientRect();
    return Math.abs(chart.left - frame.left) < 2 &&
      Math.abs(chart.right - frame.right) < 2 &&
      actions.top > chart.bottom && sidebar.top > actions.bottom &&
      frame.right <= window.innerWidth + 1;
  })).toBe(true);
});


test("exchange picker groups USDT networks and searches by network or ticker", async ({ page }) => {
  await setup(page, "dark");
  await page.route("**/api/wallet/exchange-status", (route) => route.fulfill({
    json: { configured: true, orders_enabled: false, networks: [
      { network: "TRON", name: "Tron", standard: "TRC20", can_send: true, can_receive: true },
      { network: "BSC", name: "BNB Smart Chain", standard: "BEP20", can_send: true, can_receive: true },
    ] },
  }));
  await page.route("**/api/wallet/custody-asset-balances?asset=USDT", (route) => route.fulfill({
    json: { items: [
      { network: "TRON", balance: { amount: "12.5", status: "ok" } },
      { network: "BSC", balance: { amount: "0", status: "ok" } },
    ] },
  }));
  await page.getByRole("button", { name: "Обменять", exact: true }).click();
  await page.getByRole("button", { name: "Другие валюты" }).click();
  await page.getByRole("button", { name: "Валюта списания" }).click();
  const picker = page.getByRole("region", { name: "Валюты для обмена" });
  const networks = picker.locator('[aria-label="USDT"]');
  const coins = picker.locator('[aria-label="Другие валюты"]');
  await expect(networks.getByText("12.5", { exact: true })).toBeVisible();
  await expect(coins.getByText("BTC", { exact: true })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Найти валюту" });
  await search.fill("btc");
  await expect(networks).toHaveCount(0);
  await expect(coins.getByText("BTC", { exact: true })).toBeVisible();
  await search.fill("TRC20");
  await expect(coins).toHaveCount(0);
  await expect(networks.getByText("USDT · TRC20", { exact: true })).toBeVisible();
  await networks.getByText("USDT · TRC20", { exact: true }).click();
  await expect(page.getByLabel("Сеть отправления USDT")).toHaveValue("TRON");
});
