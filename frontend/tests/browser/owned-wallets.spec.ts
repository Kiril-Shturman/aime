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
    await expect(own).toContainText("wPay · Mainnet");
    await expect(own.getByRole("button")).toHaveCount(5);
    expect(created).toEqual(["BSC", "ETH", "TON", "SOL", "TRON"]);
    await expect(
      own.getByRole("button").filter({ hasText: "USDT · TRON" }),
    ).toContainText("—");
    await own.getByRole("button").filter({ hasText: "USDT · TRON" }).click();
    const sheet = page.locator(".sheet-modal.modal-in");
    await expect(sheet).toContainText(rows[4].address);
    await expect(sheet).toContainText("Mainnet · wPay");
    await expect(sheet.locator("svg")).not.toHaveCount(0);
    await expect(sheet).toContainText("пока нельзя использовать");
    await expect(
      sheet.getByRole("button", { name: "Вывести", exact: true }),
    ).toHaveCount(0);
  });
}
