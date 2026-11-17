import { test, expect, type Page } from "@playwright/test";
const receiving = "0x1111111111111111111111111111111111111111";
const payment = "TManualPaymentAddress12345678901234";
async function setup(
  page: Page,
  theme = "light",
  unknown = false,
  completed = false,
  fundingMode = "disabled",
) {
  const calls: string[] = [];
  let stored: any = null;
  let fundingJob: any = null;
  const prepared = () => ({
    intent_id: "a".repeat(32),
    state: "prepared",
    from_network: "TRON",
    to_network: "BSC",
    amount: "100",
    rate_type: "float",
    to_address: receiving,
    to_tag: null,
    quote_expires_at: Date.now() / 1000 + 20,
    quote: { to_amount: "99" },
    order: null,
    error: null,
    next_check_at: 0,
  });
  await page.addInitScript((theme) => {
    localStorage.setItem("wpay:intro:v1", "seen");
    localStorage.setItem("ui-theme", theme);
  }, theme);
  await page.route("**/api/**", (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      action = url.pathname.split("/").pop();
    if (request.method() !== "GET") calls.push(action!);
    if (action === "status")
      return route.fulfill({
        json: { configured: true, asset_routes: { USDT: ["TRON", "BSC"] } },
      });
    if (action === "overview")
      return route.fulfill({
        json: {
          balances: [{ asset: "USDT", available: "25", reserved: "0" }],
          rates: [],
          transactions: [],
        },
      });
    if (action === "exchange-status")
      return route.fulfill({
        json: {
          configured: true,
          orders_enabled: true,
          networks: [
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
          ],
        },
      });
    if (action === "exchange-quote")
      return route.fulfill({
        json: {
          available: true,
          to_amount: "99",
          difference: "1",
          quoted_at: Date.now() / 1000,
          refresh_after_seconds: 20,
          execution_enabled: false,
        },
      });
    if (action === "exchange-funding")
      return route.fulfill({
        json: {
          enabled: fundingMode !== "disabled",
          signer_online: true,
          job: fundingJob,
        },
      });
    if (action === "exchange-funding-prepare") {
      expect(request.postDataJSON()).toEqual({ intent_id: "a".repeat(32) });
      fundingJob = {
        job_id: "b".repeat(32),
        state: fundingMode === "empty" ? "failed" : "quoted",
        tx_hash: null,
        error: fundingMode === "empty" ? "NO_FUNDS" : null,
        detail:
          fundingMode === "empty"
            ? "На собственном адресе недостаточно USDT. Баланс приложения здесь не используется."
            : null,
        quote:
          fundingMode === "empty"
            ? null
            : {
                approval_id: "c".repeat(32),
                amount: "100",
                max_fee: "20",
                fee_currency: "TRX",
                source_address: "TOwnAddress",
                expires_at: Date.now() / 1000 + 60,
              },
      };
      return route.fulfill({ json: fundingJob });
    }
    if (action === "exchange-funding-confirm") {
      expect(request.postDataJSON()).toEqual({
        job_id: "b".repeat(32),
        approval_id: "c".repeat(32),
      });
      fundingJob = {
        ...fundingJob,
        state: "broadcast",
        tx_hash: "durable-signed-transaction-hash",
      };
      return route.fulfill({ json: fundingJob });
    }
    if (action === "exchange-orders")
      return route.fulfill({ json: { items: stored ? [stored] : [] } });
    if (action === "exchange-prepare") {
      expect(request.postDataJSON()).toEqual({
        from_network: "TRON",
        to_network: "BSC",
        amount: "100",
        rate_type: "float",
        to_address: receiving,
      });
      stored = prepared();
      return route.fulfill({ json: stored });
    }
    if (action === "exchange-create") {
      expect(request.postDataJSON()).toEqual({ intent_id: "a".repeat(32) });
      stored = {
        ...stored,
        state: unknown ? "unknown" : "ready",
        error: unknown ? "OUTCOME_UNKNOWN" : null,
        order: unknown
          ? null
          : {
              provider_id: "ABC123",
              status: "NEW",
              from_amount: "100",
              to_amount: "99",
              pay_address: payment,
              pay_tag: null,
              to_address: receiving,
              expires_at: Date.now() / 1000 + 1800,
              pay_tx_hash: null,
              payout_tx_hash: null,
            },
      };
      if (unknown)
        return route.fulfill({
          status: 503,
          json: { detail: "Ответ обменника не получен" },
        });
      return route.fulfill({ json: stored });
    }
    if (action === "exchange-order") {
      if (completed && stored?.order)
        stored = {
          ...stored,
          order: {
            ...stored.order,
            status: "DONE",
            payout_tx_hash: "payout-proof-hash",
          },
        };
      return route.fulfill({ json: stored });
    }
    return route.fulfill({ json: { items: [], data: [] } });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto("/wallet");
  const open = async () => {
    await page
      .locator(".wpay-wallet-home")
      .getByRole("button", { name: "Обменять", exact: true })
      .click();
    await expect(
      page.getByRole("main", { name: "Межсетевой обмен USDT" }),
    ).toBeVisible();
  };
  await open();
  return { calls, open };
}
async function confirm(page: Page) {
  const panel = page.getByRole("main", { name: "Межсетевой обмен USDT" });
  await panel.getByRole("button", { name: "Рассчитать", exact: true }).click();
  await panel.getByLabel("Адрес получения обмена").fill(receiving);
  await panel
    .getByRole("button", { name: "Продолжить обмен", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Проверьте обмен", exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText("Автоматического списания нет");
  return panel;
}
for (const theme of ["light", "dark"]) {
  test(`${theme}: exchange requires explicit order creation then displays real payment requisites`, async ({
    page,
  }) => {
    const state = await setup(page, theme);
    const panel = await confirm(page);
    expect(state.calls.filter((x) => x === "exchange-create")).toHaveLength(0);
    await panel
      .getByRole("button", { name: "Создать обмен", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Ожидаем оплату", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText(payment);
    await expect(panel).toContainText(receiving);
    await expect(
      panel.getByRole("button", {
        name: "Скопировать адрес оплаты",
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel).toContainText("Отправьте ровно");
    expect(state.calls).toEqual([
      "exchange-quote",
      "exchange-prepare",
      "exchange-create",
    ]);
  });
}
test("unknown outcome is restored from history after reload without a second create", async ({
  page,
}) => {
  const state = await setup(page, "light", true);
  const panel = await confirm(page);
  await panel
    .getByRole("button", { name: "Создать обмен", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Уточняем создание заявки",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Скопировать адрес оплаты" }),
  ).toHaveCount(0);
  await page.reload();
  await state.open();
  await page
    .getByRole("button")
    .filter({ hasText: "Исход уточняется" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Уточняем создание заявки",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.calls.filter((x) => x === "exchange-create")).toHaveLength(1);
});
test("confirmed payout hides pay-in QR and shows transaction proof", async ({
  page,
}) => {
  await setup(page, "dark", false, true);
  const panel = await confirm(page);
  await panel
    .getByRole("button", { name: "Создать обмен", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Обмен завершён", exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText("payout-proof-hash");
  await expect(
    panel.getByRole("button", { name: "Скопировать адрес оплаты" }),
  ).toHaveCount(0);
});

test("wallet payment shows fee and requires a separate confirmation; manual QR stays hidden after send", async ({
  page,
}) => {
  const state = await setup(page, "light", false, false, "funded");
  const panel = await confirm(page);
  await panel
    .getByRole("button", { name: "Создать обмен", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Проверить баланс и комиссию", exact: true })
    .click();
  await expect(panel).toContainText("Комиссия сети — не более 20 TRX");
  expect(
    state.calls.filter((v) => v === "exchange-funding-confirm"),
  ).toHaveLength(0);
  await expect(
    panel.getByRole("button", {
      name: "Скопировать адрес оплаты",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Подтвердить и отправить", exact: true })
    .click();
  await expect(panel).toContainText("durable-signed-transaction-hash");
  await expect(
    panel.getByRole("button", { name: "Подтвердить и отправить", exact: true }),
  ).toHaveCount(0);
  expect(
    state.calls.filter((v) => v === "exchange-funding-confirm"),
  ).toHaveLength(1);
});

test("empty owned mainnet wallet does not spend the displayed test ledger balance", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, false, "empty");
  const panel = await confirm(page);
  await panel
    .getByRole("button", { name: "Создать обмен", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Проверить баланс и комиссию", exact: true })
    .click();
  await expect(panel).toContainText("На собственном адресе недостаточно USDT");
  await expect(
    panel.getByRole("button", { name: "Подтвердить и отправить", exact: true }),
  ).toHaveCount(0);
  expect(
    state.calls.filter((v) => v === "exchange-funding-confirm"),
  ).toHaveLength(0);
});
