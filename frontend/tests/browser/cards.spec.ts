import { test, expect, type Page } from "@playwright/test";

async function setup(
  page: Page,
  theme = "dark",
  failRecharge = false,
  noCards = false,
) {
  const state = {
    cards: noCards
      ? [
          {
            card_id: "wpay-ui-demo-card",
            kind: "virtual",
            status: "opened",
            frozen: false,
            masked_pan: "•••• 4242",
            delivery_status: null,
            demo: true,
          },
        ]
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
    if (action === "card-quote") {
      const body = req.postDataJSON();
      const physical =
        body.plan_id === "card_premium" || body.plan_id === "card_platinum";
      const fee = body.operation === "issue" ? (physical ? "20" : "2") : "0.10";
      return route.fulfill({
        json: {
          quote_id: "quote-" + (body.plan_id ?? body.card_id),
          total:
            body.operation === "issue"
              ? fee
              : String(Number(body.amount) + 0.1),
          reserve:
            body.operation === "issue"
              ? fee
              : String(Number(body.amount) + 0.11),
          service_fee: "0",
          provider_fee: fee,
          can_afford: true,
          expires_at: Date.now() / 1000 + 120,
          estimated: body.operation === "recharge",
        },
      });
    }
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
  if (noCards) {
    await page
      .getByRole("main", { name: "Мои карты" })
      .getByRole("button", { name: "Карта 2", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Для подписок", exact: true }),
    ).toBeVisible();
  }
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
    await expect(
      main.getByRole("heading", { name: "Мои карты", exact: true }),
    ).toHaveCount(0);
    await expect(
      main.getByText("Выпустить карту", { exact: true }),
    ).toHaveCount(0);
    await expect(
      main.getByRole("heading", { name: "Платежи по карте", exact: true }),
    ).toBeVisible();
    await expect(main.locator(".wpay-bank-card")).toHaveCount(6);
    await expect(
      main.getByText("Онлайн-сервис", { exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Карты Aura", { exact: true })).toHaveCount(0);
    await expect(main.locator("input")).toHaveCount(0);
    expect(state.calls).toHaveLength(0);
    await main.getByRole("button", { name: "Реквизиты", exact: true }).click();
    await expect(
      main
        .getByRole("group", { name: "Реквизиты карты" })
        .getByText("4111 1111 1111 1234", { exact: true }),
    ).toBeVisible();
    await expect(popup(page)).not.toBeVisible();
    await main.getByRole("button", { name: "Скрыть", exact: true }).click();
    await expect(
      page.getByText("4111 1111 1111 1234", { exact: true }),
    ).toHaveCount(0);
    await main.getByRole("button", { name: "Заморозить", exact: true }).click();
    await page
      .locator(".dialog.modal-in")
      .getByText("Заморозить", { exact: true })
      .click();
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
  expect(calls[1].body).toEqual({
    card_id: "card-v",
    amount: "10",
    quote_id: "quote-card-v",
  });
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
    await expect(
      main.locator(
        `.wpay-aura-carousel-item[aria-label^="Заказать"] .wpay-card-skin--${appearance}`,
      ),
    ).toHaveCount(1);
  }
  await main.getByRole("button", { name: "Карта 5", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Платина", exact: true }),
  ).toBeVisible();
  const features = main.getByRole("region", {
    name: "Возможности премиальной карты",
  });
  await expect(features.getByRole("article")).toHaveCount(7);
  const illustrations = features.locator(".wpay-card-benefit-art > img");
  await expect(illustrations).toHaveCount(5);
  await expect(
    features.locator(".wpay-feature-card .wpay-card-skin--graphite"),
  ).toHaveCount(2);
  await expect(
    features.getByRole("article", {
      name: "Физическая карта с доставкой",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      illustrations.evaluateAll((images) =>
        images.every(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
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
  await main.getByRole("button", { name: "Карта 4", exact: true }).click();
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
  await main.getByRole("button", { name: "Карта 3", exact: true }).click();
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
  await main.getByRole("button", { name: "Карта 4", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Премиальная", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByText("Физическая карта · Бесплатная доставка", { exact: true }),
  ).toBeVisible();
  const features = main.getByRole("region", {
    name: "Возможности премиальной карты",
  });
  await expect(features.getByRole("article")).toHaveCount(7);
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

test("slow card loading shows structured placeholders until data arrives", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Кошелёк", exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/wallet/aura-cards", async (route) => {
    await gate;
    await route.fulfill({ json: { data: [] } });
  });
  await page.getByRole("link", { name: "Карты", exact: true }).click();
  try {
    await expect(
      page.getByRole("status", { name: "Загружаем карты" }),
    ).toBeVisible();
    await expect(
      page.locator(".wpay-cards-loading-actions > span"),
    ).toHaveCount(4);
    await expect(page.locator(".wpay-cards-loading-tiles > div")).toHaveCount(
      6,
    );
  } finally {
    release();
  }
  await expect(page.locator(".wpay-cards-loading")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Для подписок", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wpay-owned-card-item")).toHaveCount(0);
});

test("demo owned card precedes offers and its controls never call provider", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 1", exact: true }).click();
  await expect(
    main.getByRole("region", { name: "Действия с картой" }).getByRole("button"),
  ).toHaveCount(4);
  await main.getByRole("button", { name: "Заморозить", exact: true }).click();
  await page
    .locator(".dialog.modal-in")
    .getByText("Заморозить", { exact: true })
    .click();
  await expect(
    main.getByRole("button", { name: "Разморозить", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Реквизиты", exact: true }).click();
  await expect(
    main
      .getByRole("group", { name: "Реквизиты карты" })
      .getByText("0000 0000 0000 4242", { exact: true }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
});

test("bottom tabs always start at top after scrolling card details", async ({
  page,
}) => {
  await setup(page, "dark", false, true);
  const scroll = page.locator(".wpay-desktop-page");
  for (const destination of ["Кошелёк", "История", "Профиль"]) {
    await page.getByRole("link", { name: "Карты", exact: true }).click();
    const main = page.getByRole("main", { name: "Мои карты" });
    await main.getByRole("button", { name: "Карта 2", exact: true }).click();
    await expect(
      main.getByRole("heading", { name: "Для подписок", exact: true }),
    ).toBeVisible();
    await scroll.evaluate((el) => (el.scrollTop = 650));
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    await page.getByRole("link", { name: destination, exact: true }).click();
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  }
});

for (const theme of ["dark", "light"])
  test(`${theme}: titleless card popup keeps close button round`, async ({
    page,
  }) => {
    await setup(page, theme);
    await page
      .getByRole("main", { name: "Мои карты" })
      .locator(".wpay-aura-carousel-item")
      .first()
      .click();
    await expect(popup(page)).toBeVisible();
    const closeButton = popup(page).getByLabel("Закрыть окно карты");
    const bounds = await closeButton.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(44, 0);
    expect(bounds!.height).toBeCloseTo(44, 0);
    const glass = await popup(page).locator(".navbar .right").boundingBox();
    expect(glass!.height).toBeCloseTo(44, 0);
    await close(page);
  });

test("CVV stays hidden until eye is pressed and resets after hiding card", async ({
  page,
}) => {
  await setup(page);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Реквизиты", exact: true }).click();
  const back = main.getByRole("group", {
    name: "Реквизиты карты",
    exact: true,
  });
  await expect(back.getByText("123", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Показать CVV", exact: true }).click();
  await expect(back.getByText("123", { exact: true })).toBeVisible();
  await expect(main.locator(".wpay-card-flip--revealed")).toHaveCount(1);
  await main.getByRole("button", { name: "Скрыть CVV", exact: true }).click();
  await expect(back.getByText("123", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Показать CVV", exact: true }).click();
  await main.getByRole("button", { name: "Скрыть", exact: true }).click();
  await main.getByRole("button", { name: "Реквизиты", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Показать CVV", exact: true }),
  ).toBeVisible();
  await expect(back.getByText("123", { exact: true })).toHaveCount(0);
});

test("pulling cards moves the description with the carousel and keeps the offer action fixed", async ({
  page,
}) => {
  await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  const carousel = main.locator(".wpay-aura-carousel");
  const title = main.getByRole("heading", {
    name: "Для подписок",
    exact: true,
  });
  const action = page.getByRole("button", { name: "Оформить карту", exact: true });
  const before = await carousel.boundingBox(),
    titleBefore = await title.boundingBox(),
    actionBefore = await action.boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const x = before!.x + before!.width / 2,
    y = before!.y + 45;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  try {
    for (let step = 1; step <= 8; step++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + step * 7 }],
      });
    const after = await carousel.boundingBox(),
      titleAfter = await title.boundingBox(),
      actionAfter = await action.boundingBox();
    const shift = after!.y - before!.y;
    expect(shift).toBeGreaterThan(8);
    expect(titleAfter!.y - titleBefore!.y).toBeCloseTo(shift, 0);
    expect(actionAfter!.y).toBeCloseTo(actionBefore!.y, 0);
    expect(await carousel.evaluate((el) => el.scrollTop)).toBe(0);
  } finally {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await expect
    .poll(() =>
      carousel.evaluate(
        (el) => el.closest(".wpay-desktop-body")!.getBoundingClientRect().top,
      ),
    )
    .toBeGreaterThanOrEqual(0);
});

test("native freeze confirmation cancels without calling provider", async ({
  page,
}) => {
  const state = await setup(page);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Заморозить", exact: true }).click();
  const dialog = page.locator(".dialog.modal-in");
  await expect(
    dialog.getByText("Заморозить карту?", { exact: true }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
  await dialog.getByText("Отмена", { exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    main.getByRole("button", { name: "Заморозить", exact: true }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(0);
});

test("demo card has withdrawal preview and confirmed local deletion", async ({
  page,
}) => {
  const state = await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 1", exact: true }).click();
  await main.getByRole("button", { name: "Ещё", exact: true }).click();
  await popup(page)
    .getByRole("button", { name: "Вывести с карты", exact: true })
    .click();
  await popup(page).getByLabel("Сумма вывода с карты").fill("10");
  await popup(page)
    .getByRole("button", { name: "Вывести", exact: true })
    .click();
  expect(state.calls).toHaveLength(0);
  await close(page);
  await main.getByRole("button", { name: "Ещё", exact: true }).click();
  await popup(page)
    .getByRole("button", { name: "Удалить карту", exact: true })
    .click();
  await page
    .locator(".dialog.modal-in")
    .getByText("Отмена", { exact: true })
    .click();
  await expect(main.locator(".wpay-aura-carousel-item")).toHaveCount(5);
  await popup(page)
    .getByRole("button", { name: "Удалить карту", exact: true })
    .click();
  await page
    .locator(".dialog.modal-in")
    .getByText("Удалить", { exact: true })
    .click();
  await expect(main.locator(".wpay-aura-carousel-item")).toHaveCount(4);
  expect(state.calls).toHaveLength(0);
});

test("touch swipes settle cards exactly into place in both directions", async ({
  page,
}) => {
  await setup(page, "dark", false, true);
  const main = page.getByRole("main", { name: "Мои карты" }),
    rail = main.locator(".wpay-aura-carousel");
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const swipe = async (direction: number) => {
    const b = (await rail.boundingBox())!,
      x = direction < 0 ? b.x + b.width - 30 : b.x + 30,
      y = b.y + 55;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 12; i++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: x + (direction * 220 * i) / 12, y: y + (3 * i) / 12 },
        ],
      });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const aligned = async (index: number) =>
    rail.evaluate(
      (el, index) =>
        Math.abs(
          el.children[index].getBoundingClientRect().left -
            el.getBoundingClientRect().left,
        ),
      index,
    );
  await swipe(-1);
  await expect.poll(() => aligned(2)).toBeLessThan(1.5);
  await expect(
    main.getByRole("heading", { name: "Для путешествий", exact: true }),
  ).toBeVisible();
  await swipe(1);
  await expect.poll(() => aligned(1)).toBeLessThan(1.5);
  await expect(
    main.getByRole("heading", { name: "Для подписок", exact: true }),
  ).toBeVisible();
});

test("chosen travel tariff and server quote are sent with issuance, never a browser price", async ({ page }) => {
  const state = await setup(page, "light", false, true);
  await page.route("**/api/wallet/card-quote", route => {
    expect(route.request().postDataJSON().plan_id).toBe("card_travel");
    return route.fulfill({json:{quote_id:"travel-priced",total:"29",reserve:"29",provider_fee:"2",service_fee:"27",can_afford:true,estimated:false,expires_at:Date.now()/1000+120}});
  });
  const main = page.getByRole("main", { name: "Мои карты" });
  await main.getByRole("button", { name: "Карта 3", exact: true }).click();
  await main.getByRole("button", { name: "Оформить карту", exact: true }).click();
  await expect(popup(page)).toContainText("29 USDT");
  await popup(page).getByRole("button", {name:"Выпустить карту",exact:true}).click();
  await expect.poll(() => state.calls.filter(c=>c.action==="aura-cards").length).toBe(1);
  const issue=state.calls.find(c=>c.action==="aura-cards")!;
  expect(issue.body).toEqual({kind:"virtual",plan_id:"card_travel",quote_id:"travel-priced"});
  expect(issue.key).toBeTruthy();
});

test("insufficient balance in server quote disables issuance", async ({page}) => {
  const state=await setup(page,"dark",false,true);
  await page.route("**/api/wallet/card-quote", route=>route.fulfill({json:{quote_id:"unfunded",total:"29",reserve:"29",provider_fee:"2",service_fee:"27",can_afford:false,expires_at:Date.now()/1000+120}}));
  await page.getByRole("main",{name:"Мои карты"}).getByRole("button",{name:"Оформить карту",exact:true}).click();
  await expect(popup(page)).toContainText("Недостаточно USDT");
  await expect(popup(page).getByRole("button",{name:"Выпустить карту",exact:true})).toBeDisabled();
  expect(state.calls).toHaveLength(0);
});

test("unbacked wallet balance explains card funding and never issues a card", async ({page}) => {
  const state=await setup(page,"dark",false,true);
  await page.route("**/api/wallet/card-quote",route=>route.fulfill({json:{quote_id:"unbacked",total:"25",reserve:"25",provider_fee:"15",service_fee:"10",can_afford:false,spendable:"0",funding_error:"AURA_FUNDS_UNAVAILABLE",expires_at:Date.now()/1000+120}}));
  await page.getByRole("main",{name:"Мои карты"}).getByRole("button",{name:"Оформить карту",exact:true}).click();
  await expect(popup(page)).toContainText("Для оплаты карты доступно 0 USDT");
  await expect(popup(page).getByRole("button",{name:"Выпустить карту",exact:true})).toBeDisabled();
  expect(state.calls).toHaveLength(0);
});


test("open issue sheet refreshes its funding quote when returning to the app", async ({page}) => {
  const state=await setup(page,"light",false,true);
  let funded=false, calls=0;
  await page.route("**/api/wallet/card-quote",route=>{calls++;return route.fulfill({json:{quote_id:"refresh-"+calls,total:"25",reserve:"25",provider_fee:"15",service_fee:"10",can_afford:funded,spendable:funded?"25":"0",funding_error:funded?null:"AURA_FUNDS_UNAVAILABLE",expires_at:Date.now()/1000+120}})});
  await page.getByRole("main",{name:"Мои карты"}).getByRole("button",{name:"Оформить карту",exact:true}).click();
  await expect(popup(page)).toContainText("Для оплаты карты доступно 0 USDT");
  await expect(popup(page).getByRole("button",{name:"Выпустить карту",exact:true})).toBeDisabled();
  funded=true;
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(popup(page).getByRole("button",{name:"Выпустить карту",exact:true})).toBeEnabled();
  await expect(popup(page)).not.toContainText("Для оплаты карты доступно 0 USDT");
  expect(calls).toBeGreaterThan(1);expect(state.calls).toHaveLength(0);
});


test("card number and expiry copy separately without hiding details or revealing CVV", async ({page}) => {
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{const w=window as unknown as {copiedCardValues?:string[]};w.copiedCardValues??=[];w.copiedCardValues.push(value)}}})});
  await setup(page);
  const main=page.getByRole("main",{name:"Мои карты"});
  await expect(main.getByRole("button",{name:"Скопировать номер карты",exact:true})).toHaveCount(0);
  await main.getByRole("button",{name:"Реквизиты",exact:true}).click();
  const back=main.getByRole("group",{name:"Реквизиты карты",exact:true});
  const number=(await back.locator('.wpay-card-back-number > span').innerText()).replace(/\s/g,'');
  const expiry=await back.locator('.wpay-card-back-fields > span').first().locator('b').innerText();
  await main.getByRole("button",{name:"Скопировать номер карты",exact:true}).click();
  await main.getByRole("button",{name:"Скопировать срок действия",exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {copiedCardValues:string[]}).copiedCardValues)).toEqual([number,expiry]);
  await expect(main.locator('.wpay-card-flip--revealed')).toHaveCount(1);
  await expect(main.getByRole("button",{name:"Показать CVV",exact:true})).toBeVisible();
  await main.getByRole("button",{name:"Скрыть",exact:true}).click();
  await expect(main.getByRole("button",{name:"Скопировать номер карты",exact:true})).toHaveCount(0);
});

test("card topup appears as positive dollar credit",async({page})=>{
  await setup(page,"light");
  await page.route("**/api/wallet/aura-card-operations**",route=>route.fulfill({json:{data:[{operation_id:"fixture-topup",operation_type:"topup",status:"completed",asset:"USDT",amount:"15",fee:null,merchant:null,decline_message:null,provider_created_at:new Date().toISOString()}]}}));
  await page.reload();
  await page.getByRole("link",{name:"Карты",exact:true}).click();
  await expect(page.getByText("+$15.00",{exact:true})).toBeVisible();
  await expect(page.getByText("Пополнение",{exact:true})).toBeVisible();
});

test("GoSwap quote opens a swipe-step sheet and pays only after confirmation", async ({ page }) => {
  await setup(page, "light");
  await page.route("**/api/wallet/status", route => route.fulfill({ json: {
    configured: true, capabilities: { cards: true, sbp_buy: true }, asset_routes: { USDT: ["TRON"] },
  } }));
  await page.route("**/api/wallet/aura-cards", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/wallet/aura-card-fees", route => route.fulfill({ json: {
    currency: "USDT", open_virtual_card_fee: "2",
    storefront: [{ plan_id: "goswap_card_sg_1", label: "Для подписок", kind: "virtual", skin: "silver",
      issue_fee: "10", available: true, provider: "GoSwap", total_recharge_pct: "2.8" }],
  } }));
  await page.route("**/api/wallet/goswap-card-quote", route => route.fulfill({ json: {
    intent_id: "goswap-intent", label: "Для подписок", state: "quoted", total: "10", wallet_available: "42",
  } }));
  let payments = 0;
  await page.route("**/api/wallet/goswap-card-issue", route => {
    payments++;
    expect(route.request().postDataJSON()).toEqual({ intent_id: "goswap-intent" });
    return route.fulfill({ json: { state: "completed" } });
  });
  await page.reload();
  await page.getByRole("link", { name: "Карты", exact: true }).click();
  await page.getByRole("button", { name: "Оформить карту" }).click();
  const sheet = page.locator(".wpay-goswap-order-sheet");
  await expect(sheet).toHaveClass(/wpay-goswap-order-sheet--collapsed/);
  const art = sheet.locator(".wpay-goswap-order-art");
  await expect(art).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Оплатить", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 10, gamma: 0 }));
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 15 }));
  });
  await expect.poll(() => art.evaluate(el => (el as HTMLElement).style.getPropertyValue("--card-tilt-x"))).toBe("9deg");
  const touch = await page.context().newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const box = (await art.boundingBox())!;
  const sheetTop = (await sheet.boundingBox())!.y;
  const x = box.x + box.width / 2;
  const y = box.y + 20;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const delta of [35, 85, 145, 210]) {
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + delta }] });
  }
  await expect.poll(async () => (await sheet.boundingBox())!.y - sheetTop).toBeGreaterThan(100);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Оформить карту" }).click();
  await expect(sheet.getByRole("button", { name: "Оплатить", exact: true })).toBeEnabled();
  await expect(sheet.locator(".wpay-goswap-order-summary").getByText("10 USDT", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Итого:", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "С кошелька" })).toBeChecked();
  await expect(sheet.getByText("Баланс: 42 USDT")).toBeVisible();
  const activeCheck = sheet.locator("input:checked ~ .wpay-goswap-payment-check");
  await expect(activeCheck).toBeVisible();
  await expect(sheet.locator(".wpay-goswap-payment-check:visible")).toHaveCount(1);
  await expect(sheet.locator(".wpay-goswap-order-terms")).toBeHidden();
  await sheet.getByRole("radio", { name: "Через СБП" }).check();
  await expect(sheet.getByText("Баланс: 42 USDT")).toBeHidden();
  await expect(sheet.getByRole("button", { name: "Пополнить через СБП" })).toBeVisible();
  await expect(sheet.locator(".wpay-goswap-payment-check:visible")).toHaveCount(1);
  await sheet.getByRole("radio", { name: "С кошелька" }).check();
  expect(payments).toBe(0);
  const handle = sheet.getByRole("button", { name: "Раскрыть условия карты" });
  const openedArt = (await art.boundingBox())!;
  const upwardX = openedArt.x + openedArt.width / 2;
  const upwardY = openedArt.y + 80;
  const collapsedTop = (await sheet.boundingBox())!.y;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: upwardX, y: upwardY }] });
  for (const delta of [25, 50, 80]) {
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: upwardX, y: upwardY - delta }] });
  }
  await expect.poll(async () => collapsedTop - (await sheet.boundingBox())!.y).toBeGreaterThan(10);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(sheet).not.toHaveClass(/wpay-goswap-order-sheet--collapsed/);
  await expect(sheet.getByText("Минимум пополнения", { exact: true })).toBeInViewport();
  await sheet.getByRole("button", { name: "Оплатить", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(payments).toBe(1);
});
