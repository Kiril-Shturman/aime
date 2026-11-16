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

test("local OCR fills photo fields without uploading an image or submitting identity", async ({
  page,
}) => {
  test.setTimeout(90000);
  const state = await contacts(page);
  await openDocuments(page);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1400, 1000);
    ctx.fillStyle = "#000";
    ctx.font = "42px Arial";
    [
      "Фамилия ИВАНОВ",
      "Имя ИВАН",
      "Отчество ИВАНОВИЧ",
      "Дата рождения 01.02.1990",
      "Дата выдачи 03.04.2010",
      "12 34 567890",
    ].forEach((line, i) => ctx.fillText(line, 70, 100 + i * 120));
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#identity-patronymic").fill("ПЕТРОВИЧ");
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") uploads.push(request.url());
  });
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Загрузить фото паспорта", { exact: true })
    .setInputFiles({
      name: "synthetic-passport.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(page.getByText(/Найдено полей:/)).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator("#identity-last_name")).toHaveValue("ИВАНОВ");
  await expect(page.locator("#identity-first_name")).toHaveValue("ИВАН");
  await expect(page.locator("#identity-passport")).toHaveValue("1234567890");
  await expect(page.locator("#identity-patronymic")).toHaveValue("ПЕТРОВИЧ");
  expect(uploads).toEqual([]);
  expect(state.posts).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "Я проверил(а) данные — всё совпадает с паспортом",
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Удалить фото" }).click();
  await expect(page.getByAltText("Выбранное фото паспорта")).toHaveCount(0);
  await expect(page.locator("#identity-last_name")).toHaveValue("ИВАНОВ");
});
test("camera picker requests rear camera and invalid file keeps manual input available", async ({
  page,
}) => {
  const state = await contacts(page);
  await openDocuments(page);
  await expect(
    page.getByLabel("Сфотографировать паспорт", { exact: true }),
  ).toHaveAttribute("capture", "environment");
  await page
    .getByLabel("Загрузить фото паспорта", { exact: true })
    .setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
  await expect(page.getByRole("alert")).toContainText("JPG");
  await page.getByRole("button", { name: "Ввести вручную" }).click();
  await expect(page.locator("#identity-last_name")).toBeFocused();
  expect(state.posts).toHaveLength(1);
});

test("cancelling OCR leaves manual fields usable without a delayed overwrite", async ({
  page,
}) => {
  const state = await contacts(page);
  await openDocuments(page);
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, 800, 600);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Загрузить фото паспорта", { exact: true })
    .setInputFiles({
      name: "blank.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByText("Распознавание отменено. Можно заполнить данные вручную."),
  ).toBeVisible();
  await page.locator("#identity-first_name").fill("ИВАН");
  await expect(page.locator("#identity-first_name")).toHaveValue("ИВАН");
  expect(state.posts).toHaveLength(1);
});

test("passport photo actions match wallet size and submit requires every field", async ({
  page,
}) => {
  await contacts(page);
  await openDocuments(page);
  for (const name of ["Сфотографировать", "Загрузить фото"]) {
    const button = page.getByRole("button", { name, exact: true });
    expect((await button.boundingBox())!.height).toBe(62);
    expect(
      await button.evaluate((el) => getComputedStyle(el).borderRadius),
    ).toBe("22px");
  }
  await page
    .getByRole("checkbox", {
      name: "Я проверил(а) данные — всё совпадает с паспортом",
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
  await fillDocuments(page);
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toBeVisible();
  await page.locator("#identity-first_name").fill("");
  await expect(
    page.getByRole("button", { name: "Отправить на проверку" }),
  ).toHaveCount(0);
});
