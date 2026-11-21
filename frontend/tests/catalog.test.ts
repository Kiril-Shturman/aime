import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressesForAsset,
  currencyLabel,
  networkLabel,
  isRecipientAddress,
  depositNetworks,
  assetNetworks,
  availableDepositRoutes,
} from "../src/wallet/catalog.ts";

test("same-network addresses never leak across assets or accept untyped data", () => {
  const rows = [
    { asset: "USDT", network: "ETH", address: "usdt" },
    { asset: "ETH", network: "ETH", address: "ether" },
    { network: "ETH", address: "ambiguous" },
    { asset: "USDT", network: "BTC", address: "unsupported" },
  ];
  assert.deepEqual(
    addressesForAsset(rows, "USDT").map((row) => row.address),
    ["usdt"],
  );
});
test("TON recipient supports friendly and raw forms and rejects EVM addresses", () => {
  assert.equal(isRecipientAddress("TON", "UQ" + "a".repeat(46)), true);
  assert.equal(isRecipientAddress("TON", "0:" + "a".repeat(64)), true);
  assert.equal(isRecipientAddress("TON", "0x" + "a".repeat(40)), false);
  assert.equal(isRecipientAddress("ETH", "0x" + "a".repeat(40)), true);
  assert.equal(isRecipientAddress("TRON", "T" + "a".repeat(33)), true);
  assert.equal(isRecipientAddress("UNKNOWN", "anything"), false);
});
test("displaying an asset does not imply provider deposit support", () => {
  for (const code of ["GRAM", "BTC", "XAUT", "TRX"]) {
    assert.ok(assetNetworks[code].length);
    assert.equal(depositNetworks[code], undefined);
  }
  assert.ok(depositNetworks.USDT.includes("TON"));
});

test("Aura-only deposits do not inherit unsupported holdings networks", () => {
  assert.deepEqual(
    availableDepositRoutes({
      asset_routes: { USDT: ["TRON", "BSC"], TRX: ["TRON"], BNB: ["BSC"] },
      providers: { goswap: { configured: false } },
      deposit_modes: { USDT: { TRON: "address" } },
      capabilities: { crypto_processing: true },
    }),
    { USDT: ["TRON"] },
  );
  assert.deepEqual(
    availableDepositRoutes({
      asset_routes: { USDT: ["TRON"] },
      providers: { goswap: { configured: false } },
      deposit_modes: { USDT: { TRON: "disabled" } },
    }),
    {},
  );
});
test("legacy deposit support also excludes assets with no receiving API", () => {
  assert.deepEqual(
    availableDepositRoutes({
      asset_routes: { TRX: ["TRON"], BTC: ["BTC"], ETH: ["ETH"] },
      providers: { goswap: { configured: true } },
    }),
    { ETH: ["ETH"] },
  );
});


test("wallet catalog has consistent currency names and chain labels", () => {
  assert.equal(currencyLabel("USDT"), "Tether (USDT)");
  assert.equal(networkLabel("BSC", "USDT"), networkLabel("BEP-20", "USDT"));
  assert.equal(networkLabel("ETH", "ETH"), "Ethereum");
  assert.equal(networkLabel("NILE", "USDT"), "TRON Nile · TRC‑20");
});
