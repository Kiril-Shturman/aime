import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressesForAsset,
  isRecipientAddress,
  depositNetworks,
  assetNetworks,
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
