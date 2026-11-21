import sqlite3
import unittest
from types import SimpleNamespace

from wallet_exchange_routes import prepare, resolve, save_rule


class WalletExchangeRoutesTests(unittest.TestCase):
    def setUp(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        self.ledger = SimpleNamespace(db=db)
        prepare(self.ledger)
        self.providers = {
            ("USDT", "TRON"): "aura", ("USDT", "ETH"): "goswap",
            ("USDT", "BSC"): "goswap", ("ETH", "ETH"): "wpay", ("BTC", "BTC"): "wpay",
        }

    def method(self, source, destination):
        result = resolve(self.ledger, {
            "from_asset": source[0], "from_network": source[1],
            "to_asset": destination[0], "to_network": destination[1],
        }, lambda *pair: pair in self.providers, lambda *pair: self.providers[pair])
        self.assertEqual(result["execution_enabled"], result["method"] == "internal")
        return result["method"]

    def test_defaults_and_admin_override(self):
        eth, bsc, tron = ("USDT", "ETH"), ("USDT", "BSC"), ("USDT", "TRON")
        self.assertEqual(self.method(eth, bsc), "internal")
        self.assertEqual(self.method(bsc, tron), "fixedfloat")
        self.assertEqual(self.method(tron, bsc), "fixedfloat")
        self.assertEqual(self.method(("ETH", "ETH"), eth), "dex")
        self.assertEqual(self.method(("ETH", "ETH"), bsc), "fixedfloat")
        self.assertEqual(self.method(("BTC", "BTC"), eth), "fixedfloat")
        self.assertEqual(self.method(eth, eth), "disabled")
        save_rule(self.ledger, {"rule": "native_dex", "method": "fixedfloat"}, "admin")
        self.assertEqual(self.method(("ETH", "ETH"), eth), "fixedfloat")
        with self.assertRaises(ValueError):
            save_rule(self.ledger, {"rule": "cross_chain", "method": "internal"}, "admin")

    def test_internal_exchange_preserves_balance_and_deposit_return_provenance(self):
        from decimal import Decimal
        from tempfile import TemporaryDirectory

        from wallet_aura import prepare as prepare_aura
        from wallet_backend import ApiError, Ledger
        from wallet_inbox import prepare as prepare_inbox
        from wallet_exchange_routes import internal_exchange
        from wallet_operations import goswap_network_balances

        with TemporaryDirectory() as tmp:
            ledger = Ledger(tmp + "/wallet")
            self.addCleanup(ledger.db.close)
            prepare(ledger)
            prepare_inbox(ledger)
            prepare_aura(ledger)
            user_id = "tg:123"
            ref = ledger.account(user_id)
            ledger.deposit({"client_ref": ref, "deposit_id": "deposit-a", "asset": "USDT",
                            "credited": "10", "network": "ETH"})
            args = (lambda *pair: pair in self.providers, lambda *pair: self.providers[pair], ApiError)
            body = {"from_asset": "USDT", "to_asset": "USDT", "from_network": "ETH",
                    "to_network": "BSC", "amount": "3"}
            first = internal_exchange(ledger, user_id, body, "internal-exchange-1", *args)
            self.assertEqual(first["balances"], {"ETH": "7", "BSC": "3"})
            self.assertEqual(first, internal_exchange(ledger, user_id, body, "internal-exchange-1", *args))
            self.assertEqual(ledger.balance(user_id, "USDT"), (Decimal("10"), Decimal("0")))
            with self.assertRaises(ApiError):
                internal_exchange(ledger, user_id, {**body, "amount": "8"}, "internal-exchange-2", *args)
            ledger.db.execute("INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                              ("return", user_id, "USDT", "-10", "deposit_return", "2026-01-01",
                               '{"details":{"deposit_id":"deposit-a"}}'))
            self.assertFalse(any(goswap_network_balances(ledger, user_id, "USDT").values()))
            ledger.book.verify()
