import { test, expect } from "@playwright/test";
import { publicEncrypt, constants, createPublicKey } from "node:crypto";

for (const stale of [false, true]) {
  test(
    stale
      ? "stale authentication explains reopening Telegram without revealing a key"
      : "explicit confirmation decrypts only in-browser and clears the key when hidden",
    async ({ page }) => {
      const walletId = "a".repeat(32),
        jobId = "b".repeat(32);
      const address = "0x1111111111111111111111111111111111111111";
      const privateKey = "2".repeat(64); // Disposable fixture, never a real wallet.
      let recipient = "",
        exports = 0,
        reveals = 0;
      const row = {
        id: walletId,
        network: "BSC",
        chain_env: "mainnet",
        address,
        balance: { status: "ok", amount: "0" },
      };
      await page.addInitScript(() => {
        localStorage.setItem("wpay:intro:v1", "seen");
      });
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          action = new URL(req.url()).pathname.split("/").pop();
        if (action === "status")
          return route.fulfill({
            json: { configured: true, asset_routes: { USDT: ["BSC"] } },
          });
        if (action === "overview")
          return route.fulfill({
            json: {
              balances: [{ asset: "USDT", available: "0", reserved: "0" }],
              rates: [],
              transactions: [],
            },
          });
        if (action === "custody-status")
          return route.fulfill({
            json: { configured: true, chain_env: "mainnet" },
          });
        if (action === "custody-wallet") return route.fulfill({ json: row });
        if (action === "custody-asset-balances")
          return route.fulfill({ json: { items: [row] } });
        if (action === "custody-export-prepare") {
          exports++;
          const body = req.postDataJSON();
          expect(body.wallet_id).toBe(walletId);
          expect(body.acknowledged).toBe(true);
          expect(Object.keys(body).sort()).toEqual([
            "acknowledged",
            "public_key",
            "wallet_id",
          ]);
          recipient = body.public_key;
          if (stale)
            return route.fulfill({
              status: 403,
              json: {
                detail: "Закройте миниапку и откройте её заново из Telegram",
              },
            });
          return route.fulfill({ json: { job_id: jobId, state: "pending" } });
        }
        if (action === "custody-export-status")
          return route.fulfill({ json: { job_id: jobId, state: "ready" } });
        if (action === "custody-export-reveal") {
          reveals++;
          const ciphertext = publicEncrypt(
            {
              key: createPublicKey({
                key: Buffer.from(recipient, "base64"),
                format: "der",
                type: "spki",
              }),
              padding: constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: "sha256",
            },
            Buffer.from(
              JSON.stringify({
                job_id: jobId,
                wallet_id: walletId,
                network: "BSC",
                address,
                private_key: privateKey,
              }),
            ),
          ).toString("base64");
          return route.fulfill({ json: { job_id: jobId, ciphertext } });
        }
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
      await page
        .getByRole("button", {
          name: "Открыть собственный адрес BSC",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Экспорт приватного ключа", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Показать ключ", exact: true }),
      ).toBeDisabled();
      expect(exports).toBe(0);
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Показать ключ", exact: true })
        .click();
      if (stale) {
        await expect(
          page
            .getByRole("region", { name: "Экспорт собственного кошелька" })
            .getByRole("alert"),
        ).toContainText("откройте её заново из Telegram");
        await expect(page.locator("[data-private-key]")).toHaveCount(0);
        expect(reveals).toBe(0);
      } else {
        await expect(page.locator("[data-private-key]")).toHaveText(privateKey);
        expect(exports).toBe(1);
        expect(reveals).toBe(1);
        expect(
          await page.evaluate(
            () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
          ),
        ).not.toContain(privateKey);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect(page.locator("[data-private-key]")).toHaveCount(0);
      }
    },
  );
}
