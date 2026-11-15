import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function openCards(
  page: Page,
  theme: string,
  width = 375,
  response: unknown = { error: { name: "NOT_CONFIGURED" } },
  status = 503,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
  }, theme);
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  const writes: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push(path);
    if (path.endsWith("/aura-cards"))
      return route.fulfill({ status, json: response });
    if (path.endsWith("/status"))
      return route.fulfill({
        json: { configured: false, custody_configured: true },
      });
    if (path.endsWith("/custody-overview"))
      return route.fulfill({
        json: {
          custody: true,
          balances: [],
          rates: [],
          transactions: [],
          unavailable_assets: [],
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/wallet");
  await page
    .getByRole(width >= 1100 ? "button" : "link", {
      name: "Карты",
      exact: true,
    })
    .click();
  const cards = page.getByRole("main", { name: "Карты WPay", exact: true });
  await expect(
    cards.getByRole("group", {
      name: "Выберите оформление карты",
      exact: true,
    }),
  ).toBeVisible();
  return { cards, writes };
}
for (const theme of ["light", "dark"])
  for (const width of [375, 768, 1440, 2560])
    test(`${theme} cards at ${width}: labelled artwork, no fake balances and responsive layout`, async ({
      page,
    }) => {
      const { cards, writes } = await openCards(page, theme, width);
      await expect(
        cards.getByText(
          "Варианты оформления. Это образцы, не выпущенные карты.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        cards.getByRole("heading", {
          name: "Ваша первая карта — впереди",
          exact: true,
        }),
      ).toBeVisible();
      await expect(cards.getByText("$0.00", { exact: true })).toHaveCount(0);
      await expect(cards.getByText("Кофейня", { exact: true })).toHaveCount(0);
      const box = (await cards.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/wpay-cards-${theme}-${width}.png`,
        fullPage: true,
      });
      expect(writes).toEqual([]);
    });
test("cards can be browsed by keyboard and mouse then opened in the original popup", async ({
  page,
}) => {
  const { cards } = await openCards(page, "light");
  const carousel = cards.getByRole("group", {
    name: "Выберите оформление карты",
    exact: true,
  });
  await carousel.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    cards.getByRole("button", { name: "Оформление Travel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await cards
    .getByRole("button", { name: "Оформление Green", exact: true })
    .click();
  await cards
    .getByRole("button", { name: "Посмотреть оформление Green", exact: true })
    .click();
  const modal = page.getByRole("main", {
    name: "Управление картой",
    exact: true,
  });
  await expect(
    modal.getByRole("heading", { name: "Оформление Green", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".wpay-card-popup.popup-push.modal-in"),
  ).toBeVisible();
  await page.getByLabel("Закрыть карта", { exact: true }).click();
  await expect(modal).not.toBeVisible();
  await cards
    .getByRole("button", { name: "Оформление Everyday", exact: true })
    .click();
  await expect
    .poll(() => carousel.evaluate((element) => element.scrollLeft))
    .toBe(0);
  const box = (await carousel.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(
    cards.getByRole("button", { name: "Оформление Travel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("card forms let users inspect top-up and card kind without monetary requests", async ({
  page,
}) => {
  const { cards, writes } = await openCards(page, "dark");
  await cards
    .getByRole("region", { name: "Действия с картами", exact: true })
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  const modal = page.getByRole("main", {
    name: "Управление картой",
    exact: true,
  });
  await expect(
    modal.getByRole("button", { name: "Продолжить", exact: true }),
  ).toBeDisabled();
  await modal
    .getByLabel("Сумма пополнения карты", { exact: true })
    .fill("25,50");
  await expect(
    modal.getByLabel("Сумма пополнения карты", { exact: true }),
  ).toHaveValue("25.50");
  await modal.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByText("Пополнение станет доступно после подключения карт", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Закрыть карта", { exact: true }).click();
  await cards
    .getByRole("button", { name: "Выпустить новую карту", exact: true })
    .click();
  await modal.getByRole("button", { name: /Физическую/ }).click();
  await expect(
    modal.getByRole("button", { name: /Физическую/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(writes).toEqual([]);
});
test("Aura list renders only owned masked cards with frozen and processing status", async ({
  page,
}) => {
  const { cards } = await openCards(
    page,
    "light",
    375,
    {
      data: [
        {
          card_id: "card-owned",
          kind: "virtual",
          status: "active",
          frozen: true,
          masked_pan: "4242424242424242",
          delivery_status: null,
          provider_updated_at: null,
        },
        {
          card_id: "card-pending",
          kind: "physical",
          status: "processing",
          frozen: false,
          masked_pan: null,
          delivery_status: null,
          provider_updated_at: null,
        },
      ],
    },
    200,
  );
  await expect(cards.getByText("Заморожена", { exact: true })).toBeVisible();
  await expect(cards.getByText("Выпускается", { exact: true })).toBeVisible();
  await expect(cards.getByText("•••• 4242", { exact: true })).toBeVisible();
  await expect(
    cards.getByText("4242424242424242", { exact: true }),
  ).toHaveCount(0);
  await cards.getByRole("button", { name: /Виртуальная карта.*4242/ }).click();
  const modal = page.getByRole("main", {
    name: "Управление картой",
    exact: true,
  });
  await expect(
    modal.getByText("Баланс карты ещё не подключён", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Заморожена", { exact: true }).first(),
  ).toBeVisible();
});
test("provider error remains an error instead of becoming an empty collection", async ({
  page,
}) => {
  const { cards } = await openCards(
    page,
    "light",
    375,
    { error: { name: "UNAVAILABLE" }, detail: "Сервис временно недоступен" },
    503,
  );
  await expect(
    cards.getByRole("heading", { name: "Карты не загрузились", exact: true }),
  ).toBeVisible();
  await expect(
    cards.getByText("Сервис временно недоступен", { exact: true }),
  ).toBeVisible();
  await expect(
    cards.getByRole("button", { name: "Повторить загрузку", exact: true }),
  ).toBeEnabled();
  await expect(
    cards.getByRole("heading", {
      name: "Ваша первая карта — впереди",
      exact: true,
    }),
  ).toHaveCount(0);
});
