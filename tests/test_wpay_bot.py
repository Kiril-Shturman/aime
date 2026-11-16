import json
import unittest
from unittest import mock

from server import (
    _wpay_amount, _wpay_audit_line, _wpay_audit_response_detail,
    _wpay_bot_view, _wpay_presence_payload,
)


class FakeRequest(dict):
    path = "/api/wallet/aura-cards"
    method = "POST"
    headers = {"Authorization": "secret", "X-API-Key": "secret"}


class WPayRichBotTests(unittest.TestCase):
    def test_start_has_description_and_only_open_button(self):
        rich, plain, markup = _wpay_bot_view(
            "start",
            {"first_name": "Кирилл"},
            [{"asset": "USDT", "available": "20", "reserved": "0"}],
            [{"status": "active"}],
            "https://wallet.example/wallet",
            admin_url="https://wallet.example/admin?v=1",
        )
        self.assertIn("виртуальная карта", plain.lower())
        self.assertNotIn("20 USDT", plain)
        self.assertNotIn("Кирилл", plain)
        self.assertIn('type="web_app"', rich)
        self.assertEqual(len(markup["inline_keyboard"]), 1)
        self.assertEqual(len(markup["inline_keyboard"][0]), 1)
        self.assertEqual(markup["inline_keyboard"][0][0]["text"], "Открыть WPay")
        self.assertEqual(
            markup["inline_keyboard"][0][0]["web_app"]["url"],
            "https://wallet.example/wallet",
        )

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

    def test_referral_view_exposes_only_personal_link_and_count(self):
        rich, plain, markup = _wpay_bot_view(
            "referral", {"first_name": "User"}, [], [],
            "https://wallet.example/wallet",
            referral={"invited": 3, "link": "https://t.me/Workingpaybot?start=ref_abc1234567"},
        )
        self.assertIn("Приглашено: <b>3</b>", rich)
        self.assertIn("ref_abc1234567", plain)
        self.assertTrue(any(
            button.get("callback_data") == "wpay:referral"
            for row in markup["inline_keyboard"] for button in row
        ))

    def test_amount_keeps_precision_and_trims_only_zeroes(self):
        self.assertEqual(_wpay_amount("20.000000"), "20")
        self.assertEqual(_wpay_amount("0.0012300"), "0.00123")
        self.assertEqual(_wpay_amount(None), "0")

    def test_audit_line_contains_metadata_but_never_headers_or_body(self):
        request = FakeRequest(
            wpay_profile={"id": 123, "email": "private@example.com"},
            wpay_audit_detail="card:create",
        )
        line = _wpay_audit_line(request, 201, 42)
        self.assertIn("POST · aura-cards · 201 · tg:123 · 42ms · card:create", line)
        self.assertNotIn("private@example.com", line)
        self.assertNotIn("secret", line)

    def test_audit_response_extracts_ids_but_not_personal_data(self):
        class Response:
            body = json.dumps({
                "data": {"card_id": "card-1", "email": "private@example.com", "cvv": "123"},
                "request_id": "request-1",
            }).encode()
        detail = _wpay_audit_response_detail(Response())
        self.assertIn("card_id=card-1", detail)
        self.assertIn("request_id=request-1", detail)
        self.assertNotIn("private@example.com", detail)
        self.assertNotIn("123", detail)

    def test_presence_card_has_profile_and_open_chat_button(self):
        with mock.patch.dict("os.environ", {"WPAY_LOG_CHAT_ID": "-5519457168"}):
            payload = _wpay_presence_payload({
                "id": 123, "username": "alice", "first_name": "Ali\nce",
                "last_name": "Test", "language_code": "ru", "is_premium": True,
                "allows_write_to_pm": True, "photo_url": "https://example.test/photo",
            }, "Mini App", "campaign-one")
        self.assertEqual(payload["chat_id"], -5519457168)
        self.assertIn("Username: @alice", payload["text"])
        self.assertIn("Имя: Ali ce", payload["text"])
        self.assertIn("Premium: да", payload["text"])
        self.assertIn("Start param: campaign-one", payload["text"])
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][0]["url"],
            "tg://user?id=123",
        )


if __name__ == "__main__":
    unittest.main()
