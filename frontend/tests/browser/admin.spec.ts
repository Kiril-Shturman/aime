import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, theme = "dark") {
  const posts: string[] = [];
  await page.addInitScript(
    (theme) => localStorage.setItem("ui-theme", theme),
    theme,
  );
  await page.route("**/api/**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (route.request().method() !== "GET") {
      posts.push(action!);
      return route.abort();
    }
    let data: unknown = { items: [] };
    if (action === "admin-overview")
      data = {
        users: 128,
        events: 462,
        liabilities: [
          {
            asset: "USDT",
            available: "1250.50",
            reserved: "25",
            total: "1275.50",
          },
        ],
        states: { quotes: { completed: 32 } },
        recent: [
          {
            type: "deposit",
            user_id: "user-1",
            asset: "USDT",
            amount: "50",
            created_at: "2026-11-16T08:00:00Z",
          },
        ],
        provider: { balance: [{ currency_code: "USDT", available: "1400" }] },
      };
    if (action === "admin-users")
      data = {
        items: [
          {
            user_id: "user-1",
            first_name: "Александр",
            username: "alex_test",
            status: "active",
            balance: "50",
            event_count: 3,
            address_count: 1,
            referral_count: 2,
          },
        ],
        total: 1,
      };
    if (action === "admin-database")
      data = {
        tables: { wallet_accounts: 1 },
        table: "wallet_accounts",
        columns: ["user_id", "asset", "available"],
        items: [{ user_id: "user-1", asset: "USDT", available: "50" }],
        offset: 0,
        count: 100,
      };
    if (action === "admin-payments")
      data = {
        events: [
          { event_id: "topup-101", user_id: "tg:123", asset: "USDT", amount: "-18.225002", type: "card_topup", created_at: new Date().toISOString(), detail: { status: "completed" } },
          { event_id: "qr-102", user_id: "tg:456", asset: "USDT", amount: "0", type: "qr_failed", created_at: new Date().toISOString(), detail: { status: "failed" } },
        ],
        as_of: "2026-11-21",
        daily: [{ day: "2026-11-21", asset: "USDT", volume: "18.225002", revenue: "3", count: 1 }],
        quotes: [],
        invoices: [],
        transfers: [],
        withdrawals: [],
      };
    if (action === "admin-notifications")
      data = {
        settings: [],
        counts: { sent: 4 },
        recent: [],
        eligible_users: 1,
      };
    return route.fulfill({ json: data });
  });
  await page.goto("http://wallet.localhost:4187/admin");
  await expect(
    page.getByRole("heading", { name: "Всё под контролем.", exact: true }),
  ).toBeVisible();
  return posts;
}
for (const theme of ["dark", "light"]) {
  test(`${theme}: admin overview and navigation stay read-only at desktop`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const posts = await setup(page, theme);
    await expect(
      page.getByRole("region", { name: "Основные показатели" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Пользователи", exact: true })
      .last()
      .click();
    await expect(
      page
        .locator(".wpay-admin-desktop-only")
        .getByText("Александр", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Разделы админки" })
      .getByRole("link", { name: "Операции", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Операции", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Оборот по дням, USDT" })).toBeVisible();
    await page.getByLabel("Показатель графика").selectOption("revenue");
    await expect(page.getByRole("img", { name: "Доход от комиссий по дням, USDT" })).toBeVisible();
    await page.getByRole("textbox", { name: "Поиск" }).fill("topup-101");
    await expect(page.getByRole("table").getByText("Пополнение карты", { exact: true })).toBeVisible();
    await expect(page.getByRole("table").getByText("Ошибка оплаты по QR", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Пополнение карты" }).click();
    const details = page.getByRole("dialog", { name: "Детали операции" });
    await expect(details.getByText("topup-101", { exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Закрыть детали операции" }).click();
    await expect(details).toBeHidden();
    await page.getByRole("button", { name: "Фильтры" }).click();
    await expect(page.getByLabel("Статус", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Сбросить" }).click();
    await expect(page.getByRole("table").getByText("Ошибка оплаты по QR", { exact: true })).toBeVisible();
    expect(posts).toHaveLength(0);
  });
  test(`${theme}: admin menu and content fit narrow screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const posts = await setup(page, theme);
    await page.getByLabel("Открыть меню", { exact: true }).click();
    const nav = page.getByRole("navigation", { name: "Разделы админки" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Уведомления", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Уведомления", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".wpay-admin-sidebar")).not.toHaveClass(
      /is-open/,
    );
    const overflow = await page
      .locator(".wpay-admin-content")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(posts).toHaveLength(0);
  });
}
