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

    def test_swap_encoding_binds_recipient_minimum_deadline_and_fixed_path(self):
        from wallet_dex import ERC20, WBNB, swap_calldata

        recipient = "0x" + "ab" * 20
        data = swap_calldata(recipient, 500, 1234)
        self.assertEqual(data[:10], "0x7ff36ab5")
        words = [int(data[i:i+64], 16) for i in range(10, len(data), 64)]
        self.assertEqual(words, [
            500, 128, int(recipient, 16), 1234, 2, int(WBNB, 16), int(ERC20["BSC", "USDT"][0], 16),
        ])
        with self.assertRaises(ValueError):
            swap_calldata(recipient, 0, 1234)

    async def test_quotes_eth_sol_and_gram_for_same_network_usdt(self):
        from wallet_dex import SOL_USDT, TON_NATIVE, TON_USDT, UNISWAP_ROUTER, WSOL, quote_native, supports_pair

        payload = "0x" + "".join(f"{value:064x}" for value in (32, 2, 10**17, 200_500_000))
        chain = SimpleNamespace(rpc=AsyncMock(side_effect=["0x1", payload]))
        self.assertEqual(await quote_native(chain, "ETH", "0.1"), {"provider": "uniswap_v2", "to_amount": "200.5"})
        self.assertEqual(chain.rpc.await_args.args[2][0]["to"], UNISWAP_ROUTER)
        chain.request = AsyncMock(side_effect=[
            {"inputMint": WSOL, "outputMint": SOL_USDT, "inAmount": "1000000000", "outAmount": "105100000"},
            {"offer_address": TON_NATIVE, "ask_address": TON_USDT, "offer_units": "1000000000", "ask_units": "1500000"},
            {"offer_address": TON_NATIVE, "ask_address": "wrong token", "offer_units": "1000000000", "ask_units": "1500000"},
        ])
        self.assertEqual(await quote_native(chain, "SOL", "1"), {"provider": "jupiter", "to_amount": "105.1"})
        self.assertEqual(await quote_native(chain, "GRAM", "1"), {"provider": "ston_fi", "to_amount": "1.5"})
        self.assertIsNone(await quote_native(chain, "GRAM", "1"))
        for asset, net in (("BNB", "BSC"), ("ETH", "ETH"), ("SOL", "SOL"), ("GRAM", "TON")):
            pair = {"from_asset": asset, "from_network": net, "to_asset": "USDT", "to_network": net}
            self.assertTrue(supports_pair(pair))
            self.assertFalse(supports_pair({**pair, "to_network": "TRON"}))
