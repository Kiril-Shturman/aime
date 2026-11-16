import unittest

from wallet_backend import Ledger
from wallet_tariffs import calculate, create_version, snapshot


class TariffTests(unittest.TestCase):
    def test_tariffs_default_to_disabled_and_are_versioned(self):
        ledger = Ledger(":memory:")
        self.assertEqual(calculate(ledger, "card_virtual_issue", "10")[0], 0)
        first = create_version(
            ledger, "card_virtual_issue", enabled=True, fixed_fee="1",
            percent_fee="10", minimum_fee="0", note="launch", created_by="tg:1",
        )
        self.assertEqual(str(calculate(ledger, "card_virtual_issue", "10")[0]), "2")
        second = create_version(
            ledger, "card_virtual_issue", enabled=False, fixed_fee="1",
            percent_fee="10", minimum_fee="0", note="pause", created_by="tg:1",
        )
        data = snapshot(ledger)
        self.assertNotEqual(first["version_id"], second["version_id"])
        self.assertEqual(len(data["history"]), 2)
        self.assertEqual(calculate(ledger, "card_virtual_issue", "10")[0], 0)

    def test_unconnected_tariff_cannot_be_enabled(self):
        ledger = Ledger(":memory:")
        with self.assertRaisesRegex(ValueError, "not connected"):
            create_version(
                ledger, "qr_pay", enabled=True, fixed_fee="1", percent_fee="0",
                minimum_fee="0", note="", created_by="tg:1",
            )


if __name__ == "__main__":
    unittest.main()
