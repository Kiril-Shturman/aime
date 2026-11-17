import { test, expect, type Page } from "@playwright/test";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function openChat(page: Page, theme = "light") {
  let writes = 0;
  await page.addInitScript((theme) => {
    localStorage.setItem("ui-theme", theme);
    localStorage.setItem("wpay:intro:v1", "seen");
  }, theme);
  await page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({
      json: {
        configured: true,
        balances: [],
        rates: [],
        items: [],
        transactions: [],
      },
    });
  });
  await page.goto("/wallet#tgWebAppVersion=6.1&tgWebAppPlatform=ios");
  await page
    .getByRole("button", { name: "Профиль", exact: true })
    .last()
    .click();
  await page
    .getByRole("link", { name: "Помощь и поддержка", exact: true })
    .click();
  await page.getByRole("link", { name: /Чат с поддержкой/ }).click();
  const chat = page.locator(".wpay-support-chat");
  await expect(chat).toBeVisible();
  await expect
    .poll(() =>
      chat
        .locator(".messages")
        .evaluate((node) =>
          Boolean((node as HTMLElement & { f7Messages?: unknown }).f7Messages),
        ),
    )
    .toBe(true);
  await expect(chat.locator(".message-received")).toContainText(
    "Автоматическая подсказка",
  );
  await expect(chat.locator(".message-received .message-avatar")).toBeVisible();
  await expect(chat.locator(".message-received")).toHaveClass(/message-tail/);
  await expect(
    chat.getByRole("heading", { name: "Чем можем помочь?" }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      chat
        .locator(".messagebar")
        .evaluate((node) =>
          Boolean(
            (node as HTMLElement & { f7Messagebar?: unknown }).f7Messagebar,
          ),
        ),
    )
    .toBe(true);
  return { chat, writes: () => writes };
}
for (const theme of ["light", "dark"]) {
  test(`${theme}: Framework7 composer previews, removes and saves photos with a caption`, async ({
    page,
  }) => {
    const { chat, writes } = await openChat(page, theme);
    const input = chat.getByRole("textbox", { name: "Сообщение поддержке" });
    await expect(input).toBeVisible();
    const paneStyle = await chat
      .locator(".messagebar .toolbar-pane")
      .first()
      .evaluate((node) => getComputedStyle(node).boxShadow);
    expect(paneStyle).not.toBe("none");
    expect(
      await chat
        .getByRole("link", { name: "Отправить сообщение" })
        .evaluate((node) => getComputedStyle(node).color),
    ).toBe("rgb(153, 153, 153)");
    const fieldStyle = await input.evaluate((node) => {
      const css = getComputedStyle(node);
      return {
        background: css.backgroundColor,
        radius: parseFloat(css.borderTopLeftRadius),
      };
    });
    expect(fieldStyle.background).toBe(
      theme === "dark" ? "rgba(50, 50, 50, 0.5)" : "rgba(255, 255, 255, 0.75)",
    );
    expect(fieldStyle.radius).toBeGreaterThanOrEqual(20);
    await page.screenshot({
      path: test.info().outputPath(`support-empty-${theme}.png`),
      animations: "disabled",
    });
    await expect(
      chat.getByRole("link", { name: "Отправить сообщение" }),
    ).toHaveAttribute("aria-disabled", "true");
    const chooserEvent = page.waitForEvent("filechooser");
    await chat.getByRole("link", { name: "Прикрепить фото" }).click();
    const chooser = await chooserEvent;
    await chooser.setFiles([
      { name: "screen-1.png", mimeType: "image/png", buffer: image },
      { name: "screen-2.png", mimeType: "image/png", buffer: image },
    ]);
    await expect(chat.locator(".messagebar-attachment")).toHaveCount(2);
    await chat
      .getByRole("button", { name: "Удалить фото screen-1.png" })
      .click();
    await expect(chat.locator(".messagebar-attachment")).toHaveCount(1);
    await input.fill("Не получается пополнить карту");
    await expect(
      chat.getByRole("link", { name: "Отправить сообщение" }),
    ).toHaveAttribute("aria-disabled", "false");
    await page.screenshot({
      path: test.info().outputPath(`support-compose-${theme}.png`),
      animations: "disabled",
    });
    await chat.getByRole("link", { name: "Отправить сообщение" }).click();
    await expect(chat.locator(".messagebar-attachment")).toHaveCount(0);
    await expect(input).toHaveValue("");
    await expect(chat.getByRole("log")).toContainText(
      "Не получается пополнить карту",
    );
    await expect(
      chat.getByRole("log").getByAltText("screen-2.png"),
    ).toBeVisible();
    await expect(chat.getByRole("log")).toContainText("Не отправлено");
    expect(writes()).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("photo-only drafts are supported, bad types and excessive attachment counts are rejected", async ({
  page,
}) => {
  const { chat, writes } = await openChat(page);
  const file = chat.getByLabel("Выбрать фотографии");
  await file.setInputFiles({
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(chat.getByRole("alert")).toContainText("Выберите фотографию");
  await expect(chat.locator(".messagebar-attachment")).toHaveCount(0);
  await file.setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(chat.getByRole("alert")).toContainText("до 10 МБ");
  await expect(chat.locator(".messagebar-attachment")).toHaveCount(0);
  await file.setInputFiles(
    Array.from({ length: 6 }, (_, i) => ({
      name: `screen-${i}.png`,
      mimeType: "image/png",
      buffer: image,
    })),
  );
  await expect(chat.getByRole("alert")).toContainText("до 5 фотографий");
  await expect(chat.locator(".messagebar-attachment")).toHaveCount(5);
  await chat.getByRole("link", { name: "Отправить сообщение" }).click();
  await expect(
    chat.getByRole("log").locator(".support-photo-grid img"),
  ).toHaveCount(5);
  await expect(chat.locator(".messagebar-attachment")).toHaveCount(0);
  expect(writes()).toBe(0);
});
