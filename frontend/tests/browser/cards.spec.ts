import { test, expect, type Page } from "@playwright/test";

async function setup(
  page: Page,
  theme = "dark",
  failRecharge = false,
  noCards = false,
) {
  const state = {
    cards: noCards
      ? []
      : [
          {
            card_id: "card-v",
            kind: "virtual",
            status: "opened",
            frozen: false,
            masked_pan: "•••• 1234",
            delivery_status: null,
          },
          {
            card_id: "card-p",
            kind: "physical",
            status: "opened",
            frozen: false,
            masked_pan: "•••• 5678",
            delivery_status: "out_for_delivery",
          },
        ],
    calls: [] as {
      action: string;
      body: Record<string, unknown>;
      key?: string;
    }[],
    rechargeAttempts: 0,
  };
  await page.addInitScript((theme) => {
    localStorage.setItem("wpay:intro:v1", "seen");
    localStorage.setItem("ui-theme", theme);
  }, theme);
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      action = url.pathname.split("/").pop()!;
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      state.calls.push({ action, body, key: req.headers()["idempotency-key"] });
      if (
        action === "aura-card-recharge" &&
        failRecharge &&
        state.rechargeAttempts++ === 0
      )
        return route.fulfill({
          status: 503,
          json: { detail: "Временно недоступно" },
        });
      if (action === "aura-card-freeze" || action === "aura-card-unfreeze") {
        const card = state.cards.find((c) => c.card_id === body.card_id);
        if (card) card.frozen = action === "aura-card-freeze";
      }
      if (action === "aura-card-activate") {
        const card = state.cards.find((c) => c.card_id === body.card_id);
        if (card) card.delivery_status = "activated";
      }
      if (action === "aura-cards")
        state.cards.unshift({
          card_id: "new-card",
          kind: body.kind,
          status: "processing",
          frozen: false,
          masked_pan: null as unknown as string,
          delivery_status: body.kind === "physical" ? "issuing" : null,
        });
      return route.fulfill({
        json: {
          card_id: body.card_id ?? "new-card",
          status: "processing",
          ok: true,
        },
      });
    }
    if (action === "status")
      return route.fulfill({
        json: {
          configured: true,
          capabilities: { cards: true },
          asset_routes: { USDT: ["TRON"] },
        },
      });
    if (action === "overview")
      return route.fulfill({
        json: {
          balances: [{ asset: "USDT", available: "100", reserved: "0" }],
          rates: [],
          transactions: [],
        },
      });
    if (action === "aura-cards")
      return route.fulfill({ json: { data: state.cards } });
    if (action === "aura-card-fees")
      return route.fulfill({
        json: {
          currency: "USDT",
          minimum_recharge_amount: "5",
          open_virtual_card_fee: "2",
          open_physical_card_fee: "20",
          recharge_fee_pct: "1",
          physical_recharge_fee_pct: "1.5",
        },
      });
    if (action === "aura-card-operations")
      return route.fulfill({
        json: {
          data: [
            {
              operation_id: url.searchParams.get("card_id") + "-payment",
              operation_type: "payment",
              status: "completed",
              asset: "USD",
              amount: "7.50",
              fee: "0",
              merchant:
                url.searchParams.get("card_id") === "card-p"
                  ? "Физическая покупка"
                  : "Онлайн-сервис",
              decline_message: null,
              provider_created_at: new Date().toISOString(),
            },
          ],
        },
      });
    if (action === "aura-card-credentials")
      return route.fulfill({
        json: {
          card_id: url.searchParams.get("card_id"),
          number: "4111111111111234",
          expiry: "12/29",
          cvv: "123",
        },
      });
    if (action === "aura-card-otp-latest")
      return route.fulfill({
        json: {
          card_id: url.searchParams.get("card_id"),
          code: "123456",
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto("/wallet");
  await page.getByRole("link", { name: "Карты", exact: true }).click();
  await expect(page.getByRole("main", { name: "Мои карты" })).toBeVisible();
  await expect(page.locator(".wpay-aura-card-skeleton")).toHaveCount(0);
  return state;
}
const popup = (page: Page) => page.locator(".wpay-aura-card-popup");
async function close(page: Page) {
  await popup(page).getByLabel("Закрыть окно карты").click();
  await expect(popup(page)).not.toBeVisible();
}
for (const theme of ["light", "dark"])
  test(`${theme}: live cards keep old card artwork, actions and private credentials`, async ({
    page,
  }) => {
    const state = await setup(page, theme);
    const main = page.getByRole("main", { name: "Мои карты" });
    await expect(main.locator(".wpay-bank-card")).toHaveCount(6);
    await expect(
      main.getByText("Онлайн-сервис", { exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Карты Aura", { exact: true })).toHaveCount(0);
    await expect(main.locator("input")).toHaveCount(0);
    expect(state.calls).toHaveLength(0);
    await main.getByRole("button", { name: "Реквизиты", exact: true }).click();
    await expect(
      popup(page).getByText("4111111111111234", { exact: true }),
    ).toBeVisible();
    await close(page);
    await expect(
      page.getByText("4111111111111234", { exact: true }),
    ).toHaveCount(0);
    await main.getByRole("button", { name: "Заморозить", exact: true }).click();
    await expect(
      main.getByRole("button", { name: "Разморозить", exact: true }),
    ).toBeVisible();
    expect(state.calls.at(-1)).toMatchObject({
      action: "aura-card-freeze",
      body: { card_id: "card-v" },
    });
  });
test("card recharge preserves idempotency after 503", async ({ page }) => {
  const state = await setup(page, "dark", true);
  await page
    .getByRole("main", { name: "Мои карты" })
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  await popup(page).getByLabel("Сумма пополнения карты").fill("10");
  await popup(page)
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  await expect(popup(page).getByRole("alert")).toBeVisible();
  await popup(page)
    .getByRole("button", { name: "Пополнить", exact: true })
    .click();
  await expect
    .poll(
      () => state.calls.filter((c) => c.action === "aura-card-recharge").length,
    )
    .toBe(2);
  const calls = state.calls.filter((c) => c.action === "aura-card-recharge");
  expect(calls[0].key).toBeTruthy();
  expect(calls[1].key).toBe(calls[0].key);
  expect(calls[1].body).toEqual({ card_id: "card-v", amount: "10" });
});
test("physical card selection drives delivery, activation and 3DS", async ({
  page,
}) => {
  const state = await setup(page);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 2", exact: true }).click();
  await expect(
    main.getByText("Физическая покупка", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Онлайн-сервис", { exact: true })).toHaveCount(0);
  await main.getByText("В доставке", { exact: true }).click();
  await popup(page)
    .getByRole("button", { name: "Карта получена — активировать" })
    .click();
  await popup(page)
    .getByLabel("Код активации из конверта")
    .fill("TEST-ACTIVATION");
  await popup(page)
    .getByRole("button", { name: "Активировать", exact: true })
    .click();
  await expect
    .poll(
      () =>
        state.calls.find((c) => c.action === "aura-card-activate")?.body
          .card_id,
    )
    .toBe("card-p");
  await close(page);
  await main.getByRole("button", { name: "Ещё", exact: true }).click();
  await popup(page)
    .getByRole("button", { name: "Код 3DS", exact: true })
    .click();
  await expect(popup(page).getByText("123456", { exact: true })).toBeVisible();
});
test("physical card order shows delivery fields and cost before charging", async ({
  page,
}) => {
  const state = await setup(page, "light", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main
    .getByRole("button", { name: "Заказать физическую карту" })
    .first()
    .click();
  await expect(
    popup(page).getByRole("button", { name: "Выпустить карту", exact: true }),
  ).toBeDisabled();
  expect(state.calls).toHaveLength(0);
  await popup(page)
    .getByLabel("Получатель", { exact: true })
    .fill("Тестовый получатель");
  await popup(page).getByLabel("Телефон", { exact: true }).fill("+79990000000");
  await popup(page).getByLabel("Код страны", { exact: true }).fill("RU");
  await popup(page).getByLabel("Город", { exact: true }).fill("Москва");
  await popup(page)
    .getByLabel("Улица, дом, квартира", { exact: true })
    .fill("Тестовая, 1");
  await popup(page).getByLabel("Индекс", { exact: true }).fill("101000");
  await expect(popup(page).getByText("20 USDT", { exact: true })).toBeVisible();
  await popup(page)
    .getByRole("button", { name: "Выпустить карту", exact: true })
    .click();
  await expect
    .poll(() => state.calls.filter((c) => c.action === "aura-cards").length)
    .toBe(1);
  const call = state.calls.find((c) => c.action === "aura-cards")!;
  expect(call.key).toBeTruthy();
  expect(call.body).toMatchObject({
    kind: "physical",
    shipping_address: { city: "Москва", full_name: "Тестовый получатель" },
  });
  await expect(popup(page)).not.toBeVisible();
});
test("cards can be dragged with a mouse without opening their popup", async ({
  page,
}) => {
  await setup(page);
  const main = page.getByRole("main", { name: "Мои карты" });
  const bounds = await main.locator(".wpay-aura-carousel").boundingBox();
  if (!bounds) throw new Error("Missing cards carousel");
  await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + 100, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(
    main.getByRole("button", { name: "Карта 2", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(popup(page)).not.toBeVisible();
});

test("four offers are inline: two virtual and two physical without an appearance picker", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await expect(
    page.getByRole("group", { name: "Оформление карты в приложении" }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("button", {
      name: "Заказать виртуальную карту",
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(
    main.getByRole("button", {
      name: "Заказать физическую карту",
      exact: true,
    }),
  ).toHaveCount(2);
  for (const appearance of ["silver", "navy", "ice", "graphite"]) {
    await expect(main.locator(`.wpay-card-skin--${appearance}`)).toHaveCount(1);
  }
  await main.getByRole("button", { name: "Карта 4", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Карта с доставкой", exact: true }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
});

test("first card offer is named For subscriptions and shows provider-backed feature blocks", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await expect(
    main.getByRole("heading", { name: "Для подписок", exact: true }),
  ).toBeVisible();
  const features = main.getByRole("region", {
    name: "Возможности карты для подписок",
  });
  await expect(
    features.getByText("Оплата подписок", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByText("От 5 USDT · комиссия 1%", { exact: true }),
  ).toBeVisible();
  await expect(
    features.getByText("Карта под контролем", { exact: true }),
  ).toBeVisible();
  await expect(features.getByRole("article")).toHaveCount(6);
  expect(state.calls).toHaveLength(0);
  await main.getByRole("button", { name: "Карта 3", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Премиальная", exact: true }),
  ).toBeVisible();
  await expect(features).toHaveCount(0);
});

test("second virtual offer has its own travel content and preserves virtual issuance", async ({
  page,
}) => {
  const state = await setup(page, "light", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 2", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Для путешествий", exact: true }),
  ).toBeVisible();
  const features = main.getByRole("region", {
    name: "Возможности карты для путешествий",
  });
  await expect(features.getByRole("article")).toHaveCount(6);
  await expect(
    features.getByText("Такси и доставка", { exact: true }),
  ).toBeVisible();
  await expect(
    features.getByText("Отели и авиабилеты", { exact: true }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Оформить карту", exact: true })
    .click();
  const popup = page.locator(".popup.modal-in");
  await expect(
    popup.getByRole("button", { name: "Виртуальная", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(state.calls).toHaveLength(0);
});

test("third offer is premium physical with free delivery in description and checkout", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 3", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Премиальная", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByText("Физическая карта · Бесплатная доставка", { exact: true }),
  ).toBeVisible();
  const features = main.getByRole("region", {
    name: "Возможности премиальной карты",
  });
  await expect(features.getByRole("article")).toHaveCount(6);
  await expect(
    features.getByText("Оплата картой офлайн", { exact: true }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Оформить карту", exact: true })
    .click();
  const popup = page.locator(".popup.modal-in");
  await expect(
    popup.getByRole("button", { name: "Физическая", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(popup.getByText("Бесплатно", { exact: true })).toBeVisible();
  await expect(
    popup.locator('input[autocomplete="street-address"]'),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
});
