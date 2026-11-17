import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"]) {
  test(`${theme}: owned mainnet wallets are separate from provider funds`, async ({
    page,
  }) => {
    const created: string[] = [];
    const rows = ["BSC", "ETH", "TON", "SOL", "TRON"].map((network) => ({
      id: network,
      network,
      chain_env: "mainnet",
      address: `owned-${network}-12345678901234567890`,
      balance: {
        status: network === "TRON" ? "unavailable" : "ok",
        amount: network === "TRON" ? null : "0",
      },
    }));
    await page.addInitScript((theme) => {
      localStorage.setItem("ui-theme", theme);
      localStorage.setItem("wpay:intro:v1", "seen");
    }, theme);
    await page.route("**/api/**", (route) => {
      const action = new URL(route.request().url()).pathname.split("/").pop();
      if (action === "status")
        return route.fulfill({
          json: {
            configured: true,
            asset_routes: { USDT: ["BSC", "ETH", "TON", "SOL", "TRON"] },
          },
        });
      if (action === "overview")
        return route.fulfill({
          json: {
            balances: [{ asset: "USDT", available: "42", reserved: "0" }],
            rates: [],
            transactions: [],
          },
        });
      if (action === "custody-status")
        return route.fulfill({
          json: { configured: true, chain_env: "mainnet" },
        });
      if (action === "custody-wallet") {
        const body = route.request().postDataJSON();
        expect(Object.keys(body)).toEqual(["network"]);
        created.push(body.network);
        return route.fulfill({
          json: rows.find((row) => row.network === body.network),
        });
      }
      if (action === "custody-asset-balances")
        return route.fulfill({ json: { items: rows } });
      return route.fulfill({ json: { items: [], configured: false } });
    });
    await page.route(
      /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
      (route) => route.abort(),
    );
    await page.goto("/wallet");
    await page
      .locator(".wpay-wallet-home span.font-semibold")
      .filter({ hasText: /^Tether$/ })
      .first()
      .click();
    const own = page.getByRole("region", { name: "Собственные кошельки" });
    await expect(own).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Мои адреса в сети" }),
    ).toHaveCount(0);
    await expect(own.getByRole("button")).toHaveCount(5);
    await expect(own.getByRole("button").first()).toContainText("owned-BSC");
    expect(created).toEqual(["BSC", "ETH", "TON", "SOL", "TRON"]);
    await expect(
      own.getByRole("button", {
        name: "Открыть собственный адрес TRON",
        exact: true,
      }),
    ).toContainText("—");
    await own
      .getByRole("button", {
        name: "Открыть собственный адрес TRON",
        exact: true,
      })
      .click();
    const hero = page.getByRole("region", {
      name: "Баланс адреса",
      exact: true,
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText("—");
    await expect(
      page.getByText("wPay · Mainnet · Баланс в сети", { exact: true }),
    ).toBeVisible();
    const requisites = page.getByRole("region", {
      name: "Реквизиты кошелька",
      exact: true,
    });
    await expect(requisites).toContainText("Tron");
    await expect(
      requisites.getByRole("button", { name: "Скопировать полный адрес" }),
    ).toBeVisible();
    await expect(page.locator(".sheet-modal.modal-in")).toHaveCount(0);
    const details = hero.locator("..");
    await details
      .getByRole("button", { name: "Пополнить", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "QR-код адреса" }).locator("svg"),
    ).toBeVisible();
    await details.getByRole("button", { name: "Вывести", exact: true }).click();
    await expect(
      page.getByText("Вывод с собственного кошелька ещё не подключён", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(details).toContainText(
      "История блокчейн-операций ещё не подключена",
    );
  });
}
