import { test, expect, type Page } from "@playwright/test";
async function setup(
  page: Page,
  enabled = true,
  theme = "light",
  nativeBack = false,
) {
  const state = {
    contact: null as null | { phone: string; email: string },
    verified: false,
    posts: [] as { action: string; body: unknown }[],
  };
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
    const w = window as any;
    w.cameraCalls = 0;
    w.cameraStops = 0;
    w.cameraDenied = false;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          w.cameraCalls++;
          if (w.cameraDenied)
            throw new DOMException("Denied", "NotAllowedError");
          return {
            getTracks: () => [
              {
                stop: () => {
                  w.cameraStops++;
                },
              },
            ],
          };
        },
      },
    });
  }, theme);
  await page.route("https://verify.example/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><title>Identity check</title><h1>Защищённая проверка</h1><input aria-label="Документ">',
    }),
  );
  await page.route("**/api/**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!;
    if (route.request().method() === "POST")
      state.posts.push({ action, body: route.request().postDataJSON() });
    if (action === "status")
      return route.fulfill({
        json: {
          configured: true,
          providers: { aura: { enabled, configured: enabled } },
        },
      });
    if (action === "aura-customer") {
      if (route.request().method() === "POST") {
        state.contact = route.request().postDataJSON();
        return route.fulfill({ json: { registered: true } });
      }
      return state.contact
        ? route.fulfill({ json: state.contact })
        : route.fulfill({
            status: 404,
            json: { error: { name: "CUSTOMER_NOT_REGISTERED" } },
          });
    }
    if (action === "aura-kyc")
      return route.fulfill({
        json: {
          status: state.verified
            ? "completed"
            : state.posts.some((p) => p.action === "aura-kyc")
              ? "pending"
              : "none",
          verified: state.verified,
          terminal: state.verified,
          ...(route.request().method() === "POST"
            ? { session_url: "https://verify.example/session-private" }
            : {}),
        },
      });
    return route.fulfill({
      json: {
        items: [],
        balances: [],
        rates: [],
        transactions: [],
        configured: false,
      },
    });
  });
  await page.route(
    /https:\/\/(?:api\.kraken|data-api\.binance|api\.gateio)/,
    (route) => route.abort(),
  );
  await page.goto(
    nativeBack ? "/wallet#tgWebAppVersion=6.1&tgWebAppPlatform=ios" : "/wallet",
  );
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  return state;
}

async function contacts(page: Page, native = false) {
  const state = await setup(page, true, "light", native);
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  return state;
}
async function openDocuments(page: Page) {
  await page.locator("#verification-phone").fill("+79991234567");
  await page.locator("#verification-email").fill("test@example.com");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Данные паспорта" }),
  ).toBeVisible();
}
async function fillDocuments(page: Page) {
  for (const [key, value] of Object.entries({
    first_name: "Иван",
    last_name: "Иванов",
    birth_date: "1990-01-01",
    passport: "1234 567890",
    passport_issue_date: "2015-01-01",
  })) {
    await page.locator(`#identity-${key}`).fill(value);
  }
  await page
    .getByRole("checkbox", {
      name: "Я проверил(а) данные — всё совпадает с паспортом",
    })
    .check();
}
test("contacts lead to own documents form; only filled identity is submitted", async ({
  page,
}) => {
  const state = await contacts(page);
  await openDocuments(page);
  expect(state.posts.map((p) => p.action)).toEqual(["aura-customer"]);
  await expect(page.locator("iframe")).toHaveCount(0);
  await fillDocuments(page);
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(
    page
      .getByRole("region", { name: "Проверка личности", exact: true })
      .getByRole("status"),
  ).toContainText("Документы на проверке");
  expect(state.posts[1]).toEqual({
    action: "aura-kyc",
    body: {
      first_name: "Иван",
      last_name: "Иванов",
      birth_date: "1990-01-01",
      passport: "1234567890",
      passport_issue_date: "2015-01-01",
    },
  });
});
test("invalid passport stays on form without identity POST", async ({
  page,
}) => {
  const state = await contacts(page);
  await openDocuments(page);
  await fillDocuments(page);
  await page.locator("#identity-passport").fill("123");
  await page
    .getByRole("checkbox", {
      name: "Я проверил(а) данные — всё совпадает с паспортом",
    })
    .check();
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(page.getByRole("alert")).toContainText("4 цифры");
  expect(state.posts).toHaveLength(1);
});
test("Telegram back returns documents to contacts and then intro", async ({
  page,
}) => {
  await contacts(page, true);
  await openDocuments(page);
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(
    page.getByRole("heading", { name: "Ваши контакты" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("back_button_pressed", {}),
  );
  await expect(
    page.getByRole("button", { name: "Начать", exact: true }),
  ).toBeVisible();
});
test("email gates Continue and iOS inserted full phone replaces default prefix", async ({
  page,
}) => {
  await contacts(page, true);
  const next = page.getByRole("button", { name: "Продолжить", exact: true });
  await expect(next).toHaveCount(0);
  await page.locator("#verification-email").fill("test@");
  await expect(next).toHaveCount(0);
  await page.locator("#verification-email").fill("test@example.com");
  await expect(next).toBeVisible();
  await page.locator("#verification-phone").fill("+7+7 (999) 123-45-67");
  await expect(page.locator("#verification-phone")).toHaveValue("+79991234567");
  await page.locator("#verification-email").fill("");
  await expect(next).toHaveCount(0);
});
for (const theme of ["light", "dark"])
  test(`documents form fits mobile in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, true, theme);
    await page
      .getByRole("link", { name: "Верификация Подтверждение личности" })
      .click();
    await page.getByRole("button", { name: "Начать", exact: true }).click();
    await openDocuments(page);
    const region = page.getByRole("region", {
      name: "Документы для верификации",
    });
    expect(
      await region.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("button", { name: "Отправить на проверку" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`passport-${theme}.png`),
      animations: "disabled",
    });
  });
test("provider validation error keeps identity editable", async ({ page }) => {
  await contacts(page);
  await openDocuments(page);
  await fillDocuments(page);
  await page.route("**/api/wallet/aura-kyc", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 400,
          json: { error: { name: "INVALID_REQUEST" } },
        })
      : route.fulfill({
          json: { status: "none", verified: false, terminal: false },
        }),
  );
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(page.getByRole("alert")).toContainText("данные паспорта");
  await expect(page.locator("#identity-first_name")).toHaveValue("Иван");
});

test("passport form has manual inputs only and never loads OCR models", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await contacts(page);
  await openDocuments(page);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  for (const name of [
    "Сфотографировать",
    "Загрузить фото",
    "Ввести вручную",
    "Распознать паспорт",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(page.getByText(/Фото распознаётся/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
  await fillDocuments(page);
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toBeVisible();
  expect(
    requests.some(
      (url) => url.includes("/ocr/") || url.includes("paddle-ocr.worker"),
    ),
  ).toBe(false);
});

test("passport fields follow keyboard resize inside their own scroller", async ({
  page,
}) => {
  await contacts(page, true);
  await openDocuments(page);
  await page.evaluate(() => {
    const w = window as any;
    w.keyboardHeight = window.innerHeight;
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      get: () => w.keyboardHeight,
    });
    w.backCalls = [];
    const back = w.Telegram.WebApp.BackButton;
    for (const name of ["show", "hide"]) {
      const original = back[name].bind(back);
      back[name] = () => {
        w.backCalls.push(name);
        return original();
      };
    }
  });
  await page
    .locator("#identity-passport_issue_date")
    .evaluate((input: HTMLInputElement) =>
      input.focus({ preventScroll: true }),
    );
  await page.evaluate(() => {
    (window as any).keyboardHeight = 450;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      page
        .locator("#identity-passport_issue_date")
        .evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(434);
  await expect
    .poll(() =>
      page
        .locator(".wpay-verification-identity-body")
        .evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  await page
    .locator("#identity-first_name")
    .evaluate((input: HTMLInputElement) =>
      input.focus({ preventScroll: true }),
    );
  await expect
    .poll(() =>
      page
        .locator("#identity-first_name")
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(12);
  await expect
    .poll(() =>
      page
        .locator("#identity-first_name")
        .evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(434);
  expect(await page.evaluate(() => (window as any).backCalls)).toEqual([]);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    (window as any).keyboardHeight = window.innerHeight;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      page
        .locator(".wpay-verification-contact-form")
        .evaluate((el) => (el as HTMLElement).style.maxHeight),
    )
    .toBe("");
});
test("contacts scroll focused email above the Telegram keyboard", async ({
  page,
}) => {
  await contacts(page, true);
  await page.evaluate(() => {
    const w = window as any;
    w.keyboardHeight = window.innerHeight;
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      get: () => w.keyboardHeight,
    });
  });
  await page
    .locator("#verification-email")
    .evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }));
  await page.evaluate(() => {
    (window as any).keyboardHeight = 430;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      page
        .locator("#verification-email")
        .evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(414);
  await page.locator("#verification-email").fill("test@example.com");
  await expect(page.locator("#verification-email")).toBeFocused();
});

test("Telegram viewport events keep fields visible when visual viewport is unchanged", async ({
  page,
}) => {
  await contacts(page, true);
  await page
    .locator("#verification-email")
    .evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }));
  await page.evaluate(() =>
    (window as any).Telegram.WebView.receiveEvent("viewport_changed", {
      height: 420,
      is_state_stable: false,
      is_expanded: true,
    }),
  );
  await expect
    .poll(() =>
      page
        .locator("#verification-email")
        .evaluate((el) => el.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(404);
});

test("identity submission shows native preloader and never offers retry after rejection", async ({
  page,
}) => {
  await contacts(page);
  await openDocuments(page);
  await fillDocuments(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let posts = 0;
  await page.route("**/api/wallet/aura-kyc", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        json: { status: "rejected", verified: false, terminal: true },
      });
      return;
    }
    posts++;
    await pending;
    await route.fulfill({
      status: 422,
      json: { error: { name: "kyc_rejected" } },
    });
  });
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  const sending = page.getByRole("button", { name: "Отправляем…" });
  await expect(sending).toBeDisabled();
  await expect(sending).toHaveAttribute("aria-busy", "true");
  await expect(sending.locator(".preloader")).toBeVisible();
  expect(posts).toBe(1);
  finish();
  await expect(page.getByRole("alert")).toContainText(
    "Данные верификации отклонены",
  );
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
  await expect(
    page.locator("p[role=status]").filter({ hasText: "Поможем разобраться" }),
  ).toContainText("Поможем разобраться");
  expect(posts).toBe(1);
});

for (const code of [
  "kyc_identity_locked",
  "kyc_passport_already_used",
  "kyc_pending",
]) {
  test(`Aura ${code} preserves reason and blocks another identity submission`, async ({
    page,
  }) => {
    await contacts(page);
    await openDocuments(page);
    await fillDocuments(page);
    let posts = 0;
    await page.route("**/api/wallet/aura-kyc", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        return route.fulfill({
          status: code === "kyc_pending" ? 412 : 422,
          json: {
            error: {
              name: code,
              type: "kyc_error",
              request_id: "test-request-1",
              param: "passport",
              details: {
                reason: "checks_failed",
                terminal: code !== "kyc_pending",
                status: code === "kyc_pending" ? "pending" : "rejected",
              },
            },
          },
        });
      }
      return route.fulfill({
        json: { status: "none", verified: false, terminal: false },
      });
    });
    await page.getByRole("button", { name: "Отправить на проверку" }).click();
    await expect(page.getByRole("alert")).toContainText(
      code === "kyc_pending" ? "Дождитесь результата" : "поддержку",
    );
    await expect(page.getByRole("alert")).toContainText("checks_failed");
    if (code !== "kyc_pending")
      await expect(
        page.locator(".wpay-verification-visible-code code"),
      ).toHaveText(code);
    await expect(
      page.getByRole("button", { name: "Отправить на проверку" }),
    ).toHaveCount(0);
    expect(posts).toBe(1);
  });
}

test("Aura invalid_argument identifies the field and permits correction", async ({
  page,
}) => {
  await contacts(page);
  await openDocuments(page);
  await fillDocuments(page);
  await page.route("**/api/wallet/aura-kyc", (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: "invalid_argument",
          type: "invalid_request_error",
          param: "passport_issue_date",
          details: {},
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(page.getByRole("alert")).toContainText("Дата выдачи паспорта");
  await expect(page.locator("#identity-first_name")).toHaveValue("Иван");
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toBeEnabled();
});

test("Aura rejected email returns to editable contacts", async ({ page }) => {
  await contacts(page);
  await openDocuments(page);
  await fillDocuments(page);
  await page.route("**/api/wallet/aura-kyc", (route) =>
    route.fulfill({
      status: 412,
      json: {
        error: { name: "kyc_email_rejected", details: {} },
      },
    }),
  );
  await page.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(page.getByRole("alert")).toContainText("Укажите другой адрес");
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: rejected verification has a readable status, collapsed diagnostics and support action`, async ({
    page,
  }) => {
    const state = await setup(page, true, theme);
    state.contact = { email: "test@example.com", phone: "+79991234567" };
    const reason = "need_complete_kyc:NeedCompleteKYC,PassportFailed";
    await page.route("**/api/wallet/aura-kyc", (route) =>
      route.fulfill({
        json: {
          status: "rejected",
          verified: false,
          terminal: false,
          reason,
        },
      }),
    );
    await page
      .getByRole("link", { name: "Верификация Подтверждение личности" })
      .click();
    const region = page.getByRole("region", {
      name: "Проверка личности",
      exact: true,
    });
    await expect(
      region.getByRole("heading", {
        name: "Проверка не пройдена",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      region.getByRole("heading", {
        name: "Паспорт не прошёл проверку",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "Начать", exact: true }),
    ).toHaveCount(0);
    await expect(
      region.locator(".wpay-verification-seal--rejected .lucide-ban"),
    ).toBeVisible();
    await expect(
      region.locator(".wpay-verification-seal .lucide-check"),
    ).toHaveCount(0);
    let finish!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route("**/api/wallet/aura-kyc", async (route) => {
      await pendingRefresh;
      await route.fulfill({
        json: { status: "rejected", verified: false, terminal: false, reason },
      });
    });
    await expect(
      region.locator(".wpay-verification-visible-code code"),
    ).toHaveText(reason);
    await expect(
      region.locator(".wpay-verification-visible-code code"),
    ).toBeVisible();
    const refreshButton = region.getByRole("button", {
      name: "Обновить статус",
      exact: true,
    });
    await refreshButton.click();
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toHaveAttribute("aria-busy", "true");
    await expect(refreshButton.locator(".preloader")).toBeVisible();
    await expect(refreshButton.locator(".lucide-refresh-cw")).toHaveCount(0);
    finish();
    await expect(refreshButton).toBeEnabled();
    await expect(refreshButton.locator(".preloader")).toHaveCount(0);
    await expect(
      region.locator(".wpay-verification-diagnostics code"),
    ).not.toBeVisible();
    await expect(
      region.getByText("Защищённая форма проверки", { exact: true }),
    ).toHaveCount(0);
    await expect(
      region.getByRole("button", { name: "Связаться с поддержкой" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`verification-rejected-${theme}.png`),
      animations: "disabled",
    });
    await region.getByText("Данные для поддержки", { exact: true }).click();
    await expect(
      region.locator(".wpay-verification-diagnostics code"),
    ).toHaveText(reason);
    await expect(
      region.locator(".wpay-verification-diagnostics code"),
    ).toBeVisible();
    await region
      .getByRole("button", { name: "Связаться с поддержкой" })
      .click();
    await expect(page.locator(".wpay-support-chat")).toBeVisible();
    expect(state.posts).toHaveLength(0);
  });
}

test("opening verification shows a skeleton badge and native loader until status is known", async ({
  page,
}) => {
  const state = await setup(page);
  state.contact = { email: "test@example.com", phone: "+79991234567" };
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/wallet/aura-kyc", async (route) => {
    await waiting;
    await route.fulfill({
      json: {
        status: "rejected",
        verified: false,
        terminal: true,
        reason: "PassportFailed",
      },
    });
  });
  await page
    .getByRole("link", { name: "Верификация Подтверждение личности" })
    .click();
  const region = page.getByRole("region", {
    name: "Проверка личности",
    exact: true,
  });
  await expect(region).toHaveAttribute("aria-busy", "true");
  await expect(
    region.locator(".wpay-verification-seal--loading"),
  ).toBeVisible();
  await expect(region.locator(".wpay-verification-seal svg")).toHaveCount(0);
  await expect(
    region
      .getByRole("status", { name: "Загрузка статуса проверки" })
      .locator(".preloader"),
  ).toBeVisible();
  await expect(
    region.getByText("Проверяем статус…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Начать", exact: true }),
  ).toHaveCount(0);
  finish();
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(region.locator(".wpay-verification-seal--loading")).toHaveCount(
    0,
  );
  await expect(
    region.locator(".wpay-verification-seal--rejected .lucide-ban"),
  ).toBeVisible();
  await expect(
    region.getByRole("button", { name: "Связаться с поддержкой" }),
  ).toBeVisible();
});
