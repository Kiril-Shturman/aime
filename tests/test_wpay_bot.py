import unittest

from server import _wpay_amount, _wpay_bot_view


class WPayRichBotTests(unittest.TestCase):
    def test_home_is_rich_and_escapes_profile(self):
        rich, plain, markup = _wpay_bot_view(
            "home",
            {"first_name": "<Кирилл>"},
            [{"asset": "USDT", "available": "20.000", "reserved": "1.50"}],
            [],
            "https://wallet.example/wallet",
            admin_url="https://wallet.example/admin?v=1",
        )
        self.assertIn("<h1>WPay</h1>", rich)
        self.assertIn("&lt;Кирилл&gt;", rich)
        self.assertNotIn("<Кирилл>", rich)
        self.assertIn('type="web_app"', rich)
        self.assertIn('data="wpay:deposit"', rich)
        self.assertIn("20 USDT", plain)
        self.assertEqual(markup["inline_keyboard"][0][0]["web_app"]["url"], "https://wallet.example/wallet")
        self.assertEqual(markup["inline_keyboard"][-1][0]["web_app"]["url"], "https://wallet.example/admin?v=1")

    def test_balance_and_cards_do_not_expose_card_credentials(self):
        rich, plain, _ = _wpay_bot_view(
            "cards",
            {"first_name": "User"},
            [],
            [{
                "kind": "virtual", "status": "active", "frozen": 0,
                "masked_pan": "4444 **** **** 1111", "delivery_status": None,
            }],
            "https://wallet.example/wallet",
        )
        self.assertIn("4444 **** **** 1111", rich)
        self.assertNotIn("CVV", rich.upper())
        self.assertNotIn("PIN", plain.upper())

    def test_amount_keeps_precision_and_trims_only_zeroes(self):
        self.assertEqual(_wpay_amount("20.000000"), "20")
        self.assertEqual(_wpay_amount("0.0012300"), "0.00123")
        self.assertEqual(_wpay_amount(None), "0")


if __name__ == "__main__":
    unittest.main()
