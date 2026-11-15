import test from "node:test";
import assert from "node:assert/strict";
import { chainAmount } from "../src/lib/chain-amount.ts";
test("on-chain balances preserve wei and large values without floating point rounding", () => {
  assert.equal(chainAmount("0.000000000000000001"),"0.000000000000000001");
  assert.equal(chainAmount("12345678901234567890.123456789012345678"),"12,345,678,901,234,567,890.123456789012345678");
  assert.equal(chainAmount("0.000000"),"0");
  assert.equal(chainAmount("NaN"),"—");
});
