import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from bip_utils import Bip39SeedGenerator
from wallet_backend import Ledger, ApiError
from wallet_custody import Custody, prepare, derive
from wallet_custody_tools import init_key
from wallet_chain import ChainReader, integer, units, SOL_USDT, TON_USDT, ERC20


class ChainTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        key = init_key(self.root / "vault")
        self.ledger = Ledger(str(self.root / "db"))
        prepare(self.ledger)
        self.ledger.account("tg:123")
        self.ledger.account("tg:999")
        self.custody = Custody(
            self.ledger, ApiError, True, key["public_file"], "mainnet"
        )
        self.reader = ChainReader(self.ledger, ApiError)

    async def asyncTearDown(self):
        await self.reader.close()
        self.ledger.book.verify()
        self.ledger.db.close()
        self.temp.cleanup()

    def wallet(self, network):
        return self.custody.create("tg:123", network)

    async def test_evm_native_and_token_decimals_are_exact(self):
        for network, asset, decimals in [
            ("ETH", "ETH", 18),
            ("BSC", "BNB", 18),
            ("ETH", "USDT", 6),
            ("BSC", "USDT", 18),
            ("ETH", "XAUT", 6),
        ]:
            raw = 123456789012345678901234567890

            async def rpc(url, method, params):
                if method == "eth_chainId":
                    return hex(1 if network == "ETH" else 56)
                if method == "eth_call":
                    self.assertEqual(params[0]["to"], ERC20[(network, asset)][0])
                    self.assertTrue(params[0]["data"].startswith("0x70a08231"))
                    return "0x" + format(raw, "064x")
                self.assertEqual(method, "eth_getBalance")
                return hex(raw)

            with patch.object(self.reader, "rpc", side_effect=rpc):
                amount, _ = await self.reader.read(self.wallet(network), asset)
            self.assertEqual(amount, units(raw, decimals))

    async def test_wrong_chain_and_empty_abi_never_become_zero(self):
        wallet = self.wallet("ETH")
        with patch.object(self.reader, "rpc", return_value="0x38"):
            self.assertEqual(
                (await self.reader.observe(wallet, "ETH"))["status"], "unavailable"
            )

        async def empty(url, method, params):
            return "0x1" if method == "eth_chainId" else "0x"

        with patch.object(self.reader, "rpc", side_effect=empty):
            with self.assertRaises(ValueError):
                await self.reader.read(wallet, "USDT")

    async def test_btc_confirmed_balance_ignores_mempool(self):
        w = self.wallet("BTC")
        payload = {
            "address": w["address"],
            "chain_stats": {"funded_txo_sum": 123456789, "spent_txo_sum": 100000000},
            "mempool_stats": {"funded_txo_sum": 9000000000},
        }
        with patch.object(self.reader, "request", return_value=payload):
            self.assertEqual(
                await self.reader.read(w, "BTC"), ("0.23456789", "confirmed")
            )
        payload["chain_stats"]["spent_txo_sum"] = 999999999
        with patch.object(self.reader, "request", return_value=payload):
            with self.assertRaises(ValueError):
                await self.reader.read(w, "BTC")

    async def test_solana_lamports_and_token_accounts(self):
        w = self.wallet("SOL")
        with patch.object(self.reader, "rpc", return_value={"value": 1234567890}):
            self.assertEqual(
                await self.reader.read(w, "SOL"), ("1.23456789", "finalized")
            )

        def account(amount):
            return {
                "account": {
                    "data": {
                        "parsed": {
                            "info": {
                                "owner": w["address"],
                                "mint": SOL_USDT,
                                "tokenAmount": {"amount": amount, "decimals": 6},
                            }
                        }
                    }
                }
            }

        payload = {"value": [account("1200000"), account("3400000")]}
        with patch.object(self.reader, "rpc", return_value=payload):
            self.assertEqual(await self.reader.read(w, "USDT"), ("4.6", "finalized"))
        payload["value"][0]["account"]["data"]["parsed"]["info"]["mint"] = "other"
        with patch.object(self.reader, "rpc", return_value=payload):
            with self.assertRaises(ValueError):
                await self.reader.read(w, "USDT")

    async def test_ton_native_zero_and_jetton_owner_validation(self):
        w = self.wallet("TON")
        with patch.object(
            self.reader, "request", return_value={"ok": True, "result": "0"}
        ):
            self.assertEqual(await self.reader.read(w, "TON"), ("0", "indexed"))
        with patch.object(self.reader, "request", return_value={"jetton_wallets": []}):
            self.assertEqual(await self.reader.read(w, "USDT"), ("0", "indexed"))
        payload = {
            "jetton_wallets": [
                {"owner": w["address"], "jetton": TON_USDT, "balance": "2500001"}
            ]
        }
        with patch.object(self.reader, "request", return_value=payload):
            self.assertEqual(await self.reader.read(w, "USDT"), ("2.500001", "indexed"))
        payload["jetton_wallets"][0]["owner"] = derive(
            bytes(range(32)), "TON", "mainnet"
        )["address"]
        with patch.object(self.reader, "request", return_value=payload):
            with self.assertRaises(ValueError):
                await self.reader.read(w, "USDT")

    async def test_tron_zero_and_usdt_constant_read_only(self):
        w = self.wallet("TRON")
        with patch.object(self.reader, "request", return_value={}):
            self.assertEqual(await self.reader.read(w, "TRX"), ("0", "confirmed"))
        payload = {
            "result": {"result": True},
            "constant_result": [format(1234567, "064x")],
        }
        with patch.object(self.reader, "request", return_value=payload) as request:
            self.assertEqual(
                await self.reader.read(w, "USDT"), ("1.234567", "confirmed")
            )
            self.assertTrue(
                request.call_args.args[0].endswith(
                    "/walletsolidity/triggerconstantcontract"
                )
            )
            self.assertEqual(
                request.call_args.args[1]["function_selector"], "balanceOf(address)"
            )

    async def test_timeout_and_malformed_balance_never_return_fabricated_zero(self):
        for failure in [asyncio.TimeoutError(), ValueError("malformed")]:
            self.ledger.db.execute("DELETE FROM custody_balance_cache")
            with patch.object(self.reader, "read", side_effect=failure):
                observed = await self.reader.observe(self.wallet("SOL"), "SOL")
                self.assertIsNone(observed["amount"])
                self.assertEqual(observed["status"], "unavailable")

    async def test_cache_singleflight_and_restart(self):
        w = self.wallet("SOL")

        async def read(*args):
            await asyncio.sleep(0.01)
            return "9.123456789", "finalized"

        with patch.object(self.reader, "read", side_effect=read) as call:
            rows = await asyncio.gather(
                *(self.reader.observe(w, "SOL") for _ in range(10))
            )
            self.assertEqual(call.await_count, 1)
            self.assertEqual(len({r["amount"] for r in rows}), 1)
        other = ChainReader(self.ledger, ApiError)
        try:
            with patch.object(other, "read", side_effect=AssertionError("cache lost")):
                self.assertEqual(
                    (await other.observe(w, "SOL"))["amount"], "9.123456789"
                )
        finally:
            await other.close()
        self.ledger.db.execute("UPDATE custody_balance_cache SET checked_at=0")
        with patch.object(self.reader, "read", side_effect=asyncio.TimeoutError()):
            self.assertIsNone((await self.reader.observe(w, "SOL"))["amount"])

    async def test_auto_creation_is_stable_and_not_a_ledger_credit(self):
        with patch.object(self.reader, "read", return_value=("1.25", "latest")):
            first = await self.reader.asset(self.custody, "tg:123", "ETH")
            second = await self.reader.asset(self.custody, "tg:123", "ETH")
        self.assertEqual(first["amount"], "1.25")
        self.assertEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[
                0
            ],
            1,
        )
        self.assertEqual(
            self.ledger.db.execute(
                "SELECT COUNT(*) FROM finance_transactions"
            ).fetchone()[0],
            0,
        )

    async def test_usdt_sums_only_usdt_not_gas_coin_and_unknown_network_is_not_zero(
        self,
    ):
        with patch.object(self.reader, "read", return_value=("1.000001", "latest")):
            result = await self.reader.asset(self.custody, "tg:123", "USDT")
        self.assertEqual(result["amount"], "5.000005")
        self.assertEqual(len(result["items"]), 5)
        self.ledger.db.execute("DELETE FROM custody_balance_cache")

        async def read(w, asset):
            if w["network"] == "SOL":
                raise asyncio.TimeoutError()
            return "1", "latest"

        with patch.object(self.reader, "read", side_effect=read):
            result = await self.reader.asset(self.custody, "tg:123", "USDT")
        self.assertIsNone(result["amount"])
        self.assertFalse(result["complete"])

    async def test_read_refresh_never_restores_hidden_wallet_or_creates_missing(self):
        with patch.object(self.reader, "read", return_value=("7", "latest")):
            w = (await self.reader.asset(self.custody, "tg:123", "ETH"))["items"][0]
            self.custody.hide("tg:123", w["id"])
            refreshed = await self.reader.asset(
                self.custody, "tg:123", "ETH", create=False
            )
            self.assertEqual(refreshed["items"], [])
            self.assertEqual(refreshed["amount"], "7")
            empty = await self.reader.asset(self.custody, "tg:999", "BTC", create=False)
            self.assertEqual(empty["items"], [])
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[
                0
            ],
            1,
        )

    async def test_ownership_and_testnet_token_separation(self):
        w = self.wallet("ETH")
        with self.assertRaises(ApiError) as err:
            await self.reader.balance(self.custody, "tg:999", w["id"], "ETH")
        self.assertEqual(err.exception.status, 404)
        w = {**w, "chain_env": "testnet"}
        with patch.object(
            self.reader, "request", side_effect=AssertionError("wrong network called")
        ):
            with self.assertRaises(ValueError):
                await self.reader.read(w, "USDT")

    async def test_unknown_token_cannot_create_wallet(self):
        for asset in ["GRAM", "http://attacker", "ETH;drop table"]:
            with self.assertRaises(ApiError):
                await self.reader.asset(self.custody, "tg:123", asset)
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[
                0
            ],
            0,
        )

    async def test_overview_does_not_create_and_keeps_failed_assets_unknown(self):
        self.wallet("ETH")

        async def read(w, asset):
            if asset == "USDT":
                raise asyncio.TimeoutError()
            return "0", "latest"

        with patch.object(self.reader, "read", side_effect=read):
            result = await self.reader.overview(self.custody, "tg:123")
        self.assertIn("USDT", result["unavailable_assets"])
        self.assertFalse(any(r["asset"] == "USDT" for r in result["balances"]))
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[
                0
            ],
            1,
        )

    async def test_integer_parser_rejects_non_integer_negative_and_overflow(self):
        for value in [True, False, -1, 1.5, "NaN", "-1", "1e6", str(2**256), None]:
            with self.assertRaises(ValueError):
                integer(value)
        self.assertEqual(
            units(2**256 - 1, 18),
            "115792089237316195423570985008687907853269984665640564039457.584007913129639935",
        )

    async def test_tron_derivation_known_vector_and_recovery_recipe(self):
        seed = Bip39SeedGenerator("abandon " * 11 + "about").Generate()
        w = derive(seed, "TRON", "mainnet")
        self.assertEqual(w["address"], "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH")
        self.assertEqual(w["specification"]["path"], "m/44'/195'/0'/0/0")
