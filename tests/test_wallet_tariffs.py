import unittest

from wallet_backend import Ledger
from wallet_tariffs import calculate, create_version, resolve_card_plan, snapshot


class TariffTests(unittest.TestCase):
    def test_tariffs_default_to_disabled_and_are_versioned(self):
        ledger = Ledger(":memory:")
        self.assertEqual(calculate(ledger, "card_subscriptions", "10")[0], 0)
        first = create_version(
            ledger, "card_subscriptions", enabled=True, fixed_fee="1",
            percent_fee="10", minimum_fee="0", note="launch", created_by="tg:1",
        )
        self.assertEqual(str(calculate(ledger, "card_subscriptions", "10")[0]), "1")
        self.assertEqual(str(calculate(
            ledger, "card_subscriptions", "10", operation="recharge"
        )[0]), "1")
        second = create_version(
            ledger, "card_subscriptions", enabled=False, fixed_fee="1",
            percent_fee="10", minimum_fee="0", note="pause", created_by="tg:1",
        )
        data = snapshot(ledger)
        self.assertNotEqual(first["version_id"], second["version_id"])
        self.assertEqual(len(data["history"]), 2)
        self.assertEqual(calculate(ledger, "card_subscriptions", "10")[0], 0)

    def test_unconnected_tariff_cannot_be_enabled(self):
        ledger = Ledger(":memory:")
        with self.assertRaisesRegex(ValueError, "not connected"):
            create_version(
                ledger, "qr_pay", enabled=True, fixed_fee="1", percent_fee="0",
                minimum_fee="0", note="", created_by="tg:1",
            )

    def test_card_plan_must_match_aura_card_kind(self):
        self.assertEqual(resolve_card_plan("card_travel", "virtual")[0], "card_travel")
        self.assertEqual(resolve_card_plan("card_platinum", "physical")[0], "card_platinum")
        with self.assertRaisesRegex(ValueError, "Invalid card tariff plan"):
            resolve_card_plan("card_platinum", "virtual")


if __name__ == "__main__":
    unittest.main()
