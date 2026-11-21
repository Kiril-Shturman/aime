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
        self.assertFalse(result["execution_enabled"])
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
