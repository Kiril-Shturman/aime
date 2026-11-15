import asyncio
import base64
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from bip_utils import Bip39SeedGenerator
from nacl.exceptions import CryptoError

from test_wallet_backend import BOT, init_data, FakeProvider
from wallet_backend import ApiError, Ledger, install_wallet
from wallet_custody import Custody, derive, prepare, public_wallet
from wallet_custody_tools import init_key, load_private, verify_wallet


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.files = init_key(self.root / "vault")
        self.private = load_private(self.files["private_file"])
        self.ledger = Ledger(str(self.root / "db"))
        prepare(self.ledger)
        self.ledger.account("tg:123")
        self.ledger.account("tg:999")
        self.custody = Custody(
            self.ledger, ApiError, True, self.files["public_file"], "testnet"
        )

    def tearDown(self):
        self.ledger.book.verify()
        self.ledger.db.close()
        self.temp.cleanup()

    def row(self, wallet):
        return self.ledger.db.execute(
            "SELECT * FROM custody_wallets WHERE id=?", (wallet["id"],)
        ).fetchone()

    def test_each_network_is_recoverable_and_no_plaintext_seed_is_stored(self):
        seed = bytes(range(32))
        with patch("wallet_custody.secrets.token_bytes", return_value=seed):
            for network in ["BTC", "ETH", "BSC", "TON", "SOL", "TRON"]:
                wallet = self.custody.create("tg:123", network)
                row = self.row(wallet)
                self.assertEqual(
                    verify_wallet(row, self.private)["address"], wallet["address"]
                )
                self.assertNotIn(seed, bytes(row["encrypted_secret"]))
                self.assertNotIn(base64.b64encode(seed).decode(), json.dumps(wallet))
                self.assertEqual(wallet["provider"], "wpay")
                self.assertFalse(wallet["deposit_enabled"])
                self.assertFalse(wallet["withdraw_enabled"])
                self.assertFalse(
                    {"seed", "encrypted_secret", "key_id", "user_id", "private_key"}
                    & set(wallet)
                )
        self.assertEqual(
            self.ledger.db.execute(
                "SELECT COUNT(*) FROM finance_transactions"
            ).fetchone()[0],
            0,
        )

    def test_hide_preserves_keys_is_idempotent_and_create_restores_same_wallet(self):
        wallet = self.custody.create("tg:123", "SOL")
        ciphertext = bytes(self.row(wallet)["encrypted_secret"])
        self.assertTrue(self.custody.hide("tg:123", wallet["id"])["hidden"])
        self.custody.hide("tg:123", wallet["id"])
        self.assertEqual(self.custody.wallets("tg:123"), [])
        self.assertEqual(bytes(self.row(wallet)["encrypted_secret"]), ciphertext)
        self.assertEqual(
            verify_wallet(self.row(wallet), self.private)["address"], wallet["address"]
        )
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_activity").fetchone()[
                0
            ],
            1,
        )
        self.assertEqual(self.custody.create("tg:123", "SOL"), wallet)
        self.assertEqual(len(self.custody.wallets("tg:123")), 1)
        self.assertEqual(
            self.ledger.db.execute(
                "SELECT COUNT(*) FROM finance_transactions"
            ).fetchone()[0],
            0,
        )

    def test_foreign_user_cannot_hide_wallet(self):
        wallet = self.custody.create("tg:123", "BTC")
        with self.assertRaises(ApiError) as raised:
            self.custody.hide("tg:999", wallet["id"])
        self.assertEqual(raised.exception.status, 404)
        self.assertEqual(len(self.custody.wallets("tg:123")), 1)

    def test_repeat_and_restart_return_same_wallet_without_new_generation(self):
        first = self.custody.create("tg:123", "BTC")
        with patch(
            "wallet_custody.derive", side_effect=AssertionError("duplicate generation")
        ):
            self.assertEqual(self.custody.create("tg:123", "BTC"), first)
            other = Ledger(str(self.root / "db"))
            prepare(other)
            try:
                self.assertEqual(
                    Custody(
                        other, ApiError, True, self.files["public_file"], "testnet"
                    ).create("tg:123", "BTC"),
                    first,
                )
            finally:
                other.db.close()
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_events").fetchone()[0],
            1,
        )

    def test_owners_and_networks_have_independent_keys(self):
        wallets = [
            self.custody.create(uid, net)
            for uid in ["tg:123", "tg:999"]
            for net in ["BTC", "ETH", "BSC", "TON", "SOL", "TRON"]
        ]
        self.assertEqual(len({item["address"] for item in wallets}), 12)
        self.assertEqual(len(self.custody.wallets("tg:123")), 6)
        self.assertFalse(
            set(item["id"] for item in self.custody.wallets("tg:123"))
            & set(item["id"] for item in self.custody.wallets("tg:999"))
        )

    def test_mainnet_and_testnet_are_distinct_and_explicit(self):
        main = Custody(
            self.ledger, ApiError, True, self.files["public_file"], "mainnet"
        )
        for network in ["BTC", "ETH", "BSC", "TON", "SOL", "TRON"]:
            test = self.custody.create("tg:123", network)
            real = main.create("tg:123", network)
            self.assertNotEqual(test["id"], real["id"])
            self.assertNotEqual(test["address"], real["address"])
            self.assertEqual(real["chain_env"], "mainnet")
        self.assertTrue(
            self.custody.create("tg:123", "BTC")["address"].startswith("tb1q")
        )
        self.assertTrue(main.create("tg:123", "BTC")["address"].startswith("bc1q"))
        self.assertTrue(
            self.custody.create("tg:123", "TON")["address"].startswith("0Q")
        )
        self.assertTrue(main.create("tg:123", "TON")["address"].startswith("UQ"))
        self.assertEqual(main.create("tg:123", "ETH")["specification"]["chain_id"], 1)
        self.assertEqual(main.create("tg:123", "BSC")["specification"]["chain_id"], 56)

    def test_separate_backend_connections_serialize_creation(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        barrier = Barrier(2)

        def create_once(_):
            ledger = Ledger(str(self.root / "db"))
            prepare(ledger)
            try:
                custody = Custody(
                    ledger, ApiError, True, self.files["public_file"], "testnet"
                )
                barrier.wait(timeout=5)
                return custody.create("tg:123", "BTC")
            finally:
                ledger.db.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(create_once, range(2)))
        self.assertEqual(rows[0], rows[1])
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[
                0
            ],
            1,
        )
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM custody_events").fetchone()[0],
            1,
        )

    def test_bad_public_document_and_small_order_key_fail_closed(self):
        from wallet_custody import fingerprint, PUBLIC_KEY_KIND

        path = self.root / "invalid-public.json"
        for document in [
            [],
            None,
            "bad",
            {
                "kind": PUBLIC_KEY_KIND,
                "public_key": base64.b64encode(bytes(32)).decode(),
                "key_id": fingerprint(bytes(32)),
            },
        ]:
            path.write_text(json.dumps(document))
            self.assertFalse(
                Custody(self.ledger, ApiError, True, str(path), "testnet").configured
            )

    def test_official_bip84_vector_and_evm_derivation(self):
        # Public BIP84 vector: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
        seed = Bip39SeedGenerator("abandon " * 11 + "about").Generate()
        self.assertEqual(
            derive(seed, "BTC", "mainnet")["address"],
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        )
        self.assertEqual(
            derive(seed, "ETH", "mainnet")["address"],
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        )
        self.assertEqual(
            derive(seed, "BSC", "mainnet")["address"],
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        )

    def test_solana_seed_vector_cluster_and_recovery(self):
        # Checked independently with @solana/web3.js Keypair.fromSeed.
        seed = bytes(range(32))
        vector = derive(seed, "SOL", "testnet")
        self.assertEqual(
            vector["address"], "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"
        )
        self.assertEqual(
            vector["public_key"],
            "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
        )
        self.assertEqual(
            vector["specification"],
            {"recipe": "solana-ed25519-seed-v1", "cluster": "devnet"},
        )
        main = derive(seed, "SOL", "mainnet")
        self.assertEqual(main["address"], vector["address"])
        self.assertEqual(main["specification"]["cluster"], "mainnet-beta")
        with self.assertRaises(ValueError):
            derive(bytes(64), "SOL", "testnet")
        first = self.custody.create("tg:123", "SOL")
        self.assertEqual(
            verify_wallet(self.row(first), self.private)["address"], first["address"]
        )
        other = Ledger(str(self.root / "db"))
        try:
            prepare(other)
            self.assertEqual(
                Custody(
                    other, ApiError, True, self.files["public_file"], "testnet"
                ).create("tg:123", "SOL"),
                first,
            )
        finally:
            other.db.close()

    def test_ton_v4r2_vector_and_recipe(self):
        vector = derive(bytes(range(32)), "TON", "mainnet")
        self.assertEqual(
            vector["address"], "UQDTcUOcJvwtMx4R6Vbb-uYCtJELCzAAvdD439fc2Y0UNpjM"
        )
        self.assertEqual(
            vector["public_key"],
            "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
        )
        self.assertEqual(vector["specification"]["wallet_version"], "v4r2")

    def test_encrypted_material_cannot_be_swapped_or_tampered(self):
        first = self.custody.create("tg:123", "ETH")
        second = self.custody.create("tg:999", "ETH")
        row = dict(self.row(first))
        other = self.row(second)
        for key, value in [
            ("user_id", "tg:999"),
            ("network", "BSC"),
            ("address", second["address"]),
            ("encrypted_secret", other["encrypted_secret"]),
        ]:
            changed = {**row, key: value}
            with self.assertRaises(ValueError):
                verify_wallet(changed, self.private)
        damaged = bytearray(row["encrypted_secret"])
        damaged[-1] ^= 1
        with self.assertRaises(CryptoError):
            verify_wallet({**row, "encrypted_secret": bytes(damaged)}, self.private)

    def test_wrong_private_key_and_public_only_cannot_unseal(self):
        wallet = self.custody.create("tg:123", "TON")
        files = init_key(self.root / "other")
        with self.assertRaises(ValueError):
            verify_wallet(self.row(wallet), load_private(files["private_file"]))
        self.assertNotIn(
            "private_key", json.loads(Path(self.files["public_file"]).read_text())
        )

    def test_key_rotation_preserves_old_wallet_and_its_recovery(self):
        old = self.custody.create("tg:123", "BTC")
        files = init_key(self.root / "next")
        newer = Custody(self.ledger, ApiError, True, files["public_file"], "testnet")
        self.assertEqual(newer.create("tg:123", "BTC"), old)
        new = newer.create("tg:123", "BSC")
        verify_wallet(self.row(old), self.private)
        verify_wallet(self.row(new), load_private(files["private_file"]))
        self.assertNotEqual(self.row(old)["key_id"], self.row(new)["key_id"])

    def test_crypto_failure_rolls_back_creation_and_audit(self):
        with patch(
            "wallet_custody.derive", side_effect=ValueError("crypto unavailable")
        ):
            with self.assertRaises(ValueError):
                self.custody.create("tg:123", "BTC")
        for table in ["custody_wallets", "custody_keys", "custody_events"]:
            self.assertEqual(
                self.ledger.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], 0
            )

    def test_invalid_configuration_fails_closed(self):
        broken = self.root / "bad.json"
        broken.write_text("{}")
        for path, chain in [
            (str(broken), "testnet"),
            (str(self.root / "missing"), "testnet"),
            (self.files["private_file"], "testnet"),
            (self.files["public_file"], "unknown"),
        ]:
            custody = Custody(self.ledger, ApiError, True, path, chain)
            self.assertFalse(custody.configured)
            with self.assertRaises(ApiError):
                custody.create("tg:123", "BTC")
        self.assertFalse(Custody(self.ledger, ApiError).configured)

    def test_storage_is_immutable(self):
        wallet = self.custody.create("tg:123", "BTC")
        for sql in [
            "UPDATE custody_wallets SET user_id='tg:999'",
            "DELETE FROM custody_wallets",
            "UPDATE custody_keys SET public_key='bad'",
            "DELETE FROM custody_keys",
        ]:
            with self.assertRaises(sqlite3.DatabaseError):
                self.ledger.db.execute(sql)
        verify_wallet(self.row(wallet), self.private)

    def test_key_provisioning_never_overwrites_existing_files(self):
        original = Path(self.files["private_file"]).read_bytes()
        self.assertEqual(Path(self.files["private_file"]).stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            init_key(self.root / "vault")
        self.assertEqual(Path(self.files["private_file"]).read_bytes(), original)
        os.chmod(self.files["private_file"], 0o644)
        with self.assertRaises(ValueError):
            load_private(self.files["private_file"])
        os.chmod(self.files["private_file"], 0o600)

    def test_offline_cli_verifies_recovery_without_printing_secrets(self):
        wallet = self.custody.create("tg:123", "TON")
        result = subprocess.run(
            [
                sys.executable,
                "wallet_custody_tools.py",
                "verify-wallet",
                "--database",
                str(self.root / "db"),
                "--private-key",
                self.files["private_file"],
                "--wallet-id",
                wallet["id"],
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["recovery_verified"])
        self.assertNotIn(
            json.loads(Path(self.files["private_file"]).read_text())["private_key"],
            result.stdout,
        )
        self.assertFalse(
            {"seed", "encrypted_secret", "private_key"} & set(json.loads(result.stdout))
        )


class CustodyRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.files = init_key(self.root / "vault")
        self.env = patch.dict(
            os.environ,
            {
                "GOSWAP_API_TOKEN": "",
                "WPAY_BOT_TOKEN": BOT,
                "BOARD_BOT_TOKEN": "",
                "WPAY_DB_PATH": str(self.root / "db"),
                "WPAY_FINANCE_WORKER": "0",
                "WPAY_CUSTODY_ENABLED": "1",
                "WPAY_CUSTODY_CHAIN_ENV": "testnet",
                "WPAY_CUSTODY_PUBLIC_KEY_FILE": self.files["public_file"],
            },
        )
        self.env.start()
        self.fake = patch("wallet_backend.GoSwap", FakeProvider)
        self.fake.start()
        self.app = web.Application()
        install_wallet(self.app, str(self.root), lambda key: key == "owner-test-key")
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.user = {"X-Telegram-Init-Data": init_data(123)}
        self.foreign = {"X-Telegram-Init-Data": init_data(999)}

    async def asyncTearDown(self):
        self.app["wpay_ledger"].book.verify()
        await self.client.close()
        self.fake.stop()
        self.env.stop()
        self.temp.cleanup()

    async def create(self, body, headers=None):
        return await self.client.post(
            "/api/wallet/custody-wallet", json=body, headers=headers or self.user
        )

    async def test_chain_routes_create_on_open_and_enforce_server_ownership(self):
        from unittest.mock import AsyncMock

        reader = self.app["wpay_chain"]
        with patch.object(
            reader, "read", new=AsyncMock(return_value=("2.5", "latest"))
        ):
            response = await self.client.post(
                "/api/wallet/custody-asset", json={"asset": "ETH"}
            )
            self.assertEqual(response.status, 401)
            response = await self.client.post(
                "/api/wallet/custody-asset", json={"asset": "ETH"}, headers=self.user
            )
            result = await response.json()
            self.assertEqual(response.status, 200)
            self.assertEqual(result["amount"], "2.5")
            wallet_id = result["items"][0]["id"]
            response = await self.client.get(
                "/api/wallet/custody-balance?wallet_id=" + wallet_id + "&asset=ETH",
                headers=self.foreign,
            )
            self.assertEqual(response.status, 404)
            response = await self.client.get(
                "/api/wallet/custody-balance?wallet_id=" + wallet_id + "&asset=ETH",
                headers=self.user,
            )
            self.assertEqual((await response.json())["amount"], "2.5")
            response = await self.client.get(
                "/api/wallet/custody-asset-balances?asset=ETH", headers=self.foreign
            )
            self.assertEqual((await response.json())["items"], [])
            response = await self.client.get(
                "/api/wallet/custody-overview", headers=self.foreign
            )
            self.assertEqual((await response.json())["balances"], [])
        self.assertEqual(self.app["wpay_provider"].calls, [])
        self.assertEqual(
            self.app["wpay_ledger"]
            .db.execute("SELECT COUNT(*) FROM finance_transactions")
            .fetchone()[0],
            0,
        )

    async def test_chain_routes_reject_browser_address_network_and_contract_parameters(
        self,
    ):
        for body in [
            {"asset": "ETH", "user_id": "tg:999"},
            {"asset": "USDT", "address": "0x123"},
            {"asset": "USDT", "contract": "0x123"},
            {"asset": "USDT", "network": "ETH"},
            {"asset": "GRAM"},
            {"asset": []},
        ]:
            response = await self.client.post(
                "/api/wallet/custody-asset", json=body, headers=self.user
            )
            self.assertEqual(response.status, 400)
        response = await self.client.get(
            "/api/wallet/custody-balance?wallet_id=x&asset=ETH&url=http://localhost",
            headers=self.user,
        )
        self.assertEqual(response.status, 400)
        self.assertEqual(
            self.app["wpay_ledger"]
            .db.execute("SELECT COUNT(*) FROM custody_wallets")
            .fetchone()[0],
            0,
        )

    async def test_ownership_and_auth_without_any_goswap_call(self):
        response = await self.client.get("/api/wallet/custody-status")
        self.assertEqual(response.status, 401)
        response = await self.client.get(
            "/api/wallet/custody-status", headers=self.user
        )
        status = await response.json()
        self.assertTrue(status["configured"])
        self.assertEqual(status["creation_fee"], "0")
        own = await (await self.create({"network": "BTC"})).json()
        response = await self.client.get(
            "/api/wallet/custody-wallets", headers=self.foreign
        )
        self.assertEqual((await response.json())["items"], [])
        foreign = await (await self.create({"network": "BTC"}, self.foreign)).json()
        self.assertNotEqual(own["address"], foreign["address"])
        self.assertEqual(self.app["wpay_provider"].calls, [])
        self.assertEqual(
            self.app["wpay_ledger"]
            .db.execute("SELECT COUNT(*) FROM finance_transactions")
            .fetchone()[0],
            0,
        )

    async def test_hide_route_checks_ownership_auth_and_payload(self):
        wallet = await (await self.create({"network": "ETH"})).json()
        url = "/api/wallet/custody-wallet-hide"
        body = {"wallet_id": wallet["id"]}
        response = await self.client.post(url, json=body)
        self.assertEqual(response.status, 401)
        response = await self.client.post(url, json=body, headers=self.foreign)
        self.assertEqual(response.status, 404)
        response = await self.client.post(
            url, json={**body, "user_id": "tg:999"}, headers=self.user
        )
        self.assertEqual(response.status, 400)
        for _ in range(2):
            response = await self.client.post(url, json=body, headers=self.user)
            self.assertEqual(response.status, 200)
        response = await self.client.get(
            "/api/wallet/custody-wallets", headers=self.user
        )
        self.assertEqual((await response.json())["items"], [])
        restored = await (await self.create({"network": "ETH"})).json()
        self.assertEqual(restored["address"], wallet["address"])
        self.assertEqual(self.app["wpay_provider"].calls, [])

    async def test_parallel_retries_create_exactly_one_wallet_and_audit_event(self):
        responses = await asyncio.gather(
            *[self.create({"network": "TON"}) for _ in range(8)]
        )
        rows = [await response.json() for response in responses]
        self.assertEqual([response.status for response in responses], [200] * 8)
        self.assertEqual(len({row["id"] for row in rows}), 1)
        ledger = self.app["wpay_ledger"]
        self.assertEqual(
            ledger.db.execute("SELECT COUNT(*) FROM custody_wallets").fetchone()[0], 1
        )
        self.assertEqual(
            ledger.db.execute("SELECT COUNT(*) FROM custody_events").fetchone()[0], 1
        )
        self.assertEqual(
            ledger.db.execute("SELECT actor FROM custody_events").fetchone()[0],
            "tg:123",
        )

    async def test_browser_cannot_choose_ownership_keys_or_mainnet(self):
        for body in [
            {"network": "BTC", "user_id": "tg:999"},
            {"network": "BTC", "chain_env": "mainnet"},
            {"network": "ETH", "seed": "00" * 32},
            {"network": "XRP"},
            {"network": "https://attacker"},
            {"network": []},
            {"network": "BTC", "private_key": "bad"},
        ]:
            self.assertEqual((await self.create(body)).status, 400)
        response = await self.client.get(
            "/api/wallet/custody-wallets?user_id=tg:999", headers=self.user
        )
        self.assertEqual(response.status, 400)

    async def test_api_and_admin_database_do_not_export_recovery_material(self):
        await self.create({"network": "ETH"})
        for action in ["custody-status", "custody-wallets"]:
            response = await self.client.get("/api/wallet/" + action, headers=self.user)
            payload = await response.json()
            self.assertFalse(
                any(
                    word in json.dumps(payload)
                    for word in ["private_key", "encrypted_secret", "key_id", "seed"]
                )
            )
        response = await self.client.get(
            "/api/wallet/admin-database?table=custody_wallets",
            headers={"X-Board-Key": "owner-test-key"},
        )
        self.assertEqual(response.status, 400)
