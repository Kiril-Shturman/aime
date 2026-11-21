import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from wallet_dex import ROUTER, quote_bnb


class DexTests(unittest.IsolatedAsyncioTestCase):
    async def test_quote_reads_expected_bsc_contract_and_rejects_wrong_chain(self):
        payload = "0x" + "".join(f"{value:064x}" for value in (32, 2, 10**17, 54 * 10**18))
        rpc = AsyncMock(side_effect=["0x61", "0x38", payload])
        quote = await quote_bnb(SimpleNamespace(rpc=rpc), "0.1")
        self.assertEqual(quote, {"provider": "pancakeswap_v2", "to_amount": "54"})
        _, method, params = rpc.await_args.args
        self.assertEqual(method, "eth_call")
        self.assertEqual(params[0]["to"], ROUTER)
        self.assertTrue(params[0]["data"].startswith("0xd06ca61f"))
        self.assertEqual(rpc.await_count, 3)

    async def test_disallows_invalid_or_zero_amount_before_rpc(self):
        rpc = AsyncMock()
        for value in ("0", "-1", "1e-4"):
            with self.assertRaises(ValueError):
                await quote_bnb(SimpleNamespace(rpc=rpc), value)
        rpc.assert_not_awaited()
