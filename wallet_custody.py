"""Offline address generation and public-key-only sealing of recovery material.

No deposits, network activation, signing, export of secrets, or provider calls.
"""

import base64
import hashlib
import json
import secrets
import time
import uuid
from pathlib import Path

from aiohttp import web
from bip_utils import (
    Base58Encoder,
    Bip44,
    Bip44Coins,
    Bip84,
    Bip84Coins,
    Ton,
    TonAddrVersions,
)
from nacl.public import PublicKey, SealedBox
from nacl.signing import SigningKey
from nacl.exceptions import CryptoError
from pytoniq_core import Address as TonAddress

NETWORKS = {
    "BTC": {"name": "Bitcoin", "asset": "BTC"},
    "ETH": {"name": "Ethereum", "asset": "ETH"},
    "BSC": {"name": "BNB Smart Chain", "asset": "BNB"},
    "TON": {"name": "TON", "asset": "TON"},
    "SOL": {"name": "Solana", "asset": "SOL"},
    "TRON": {"name": "TRON", "asset": "TRX"},
}
PUBLIC_KEY_KIND = "wpay.custody.public.v1"
PRIVATE_KEY_KIND = "wpay.custody.private.v1"


def encode(raw):
    return base64.b64encode(raw).decode("ascii")


def decode(raw):
    return base64.b64decode(raw, validate=True)


def fingerprint(public_key):
    return hashlib.sha256(public_key).hexdigest()


def derive(seed, network, chain_env):
    """Versioned, reproducible address recipe; no chain access or hidden defaults."""
    if (
        network not in NETWORKS
        or chain_env not in {"mainnet", "testnet"}
        or len(seed) not in {32, 64}
    ):
        raise ValueError("Unsupported wallet derivation")
    if network == "TRON":
        wallet = Bip44.FromSeed(seed, Bip44Coins.TRON).DeriveDefaultPath()
        address = wallet.PublicKey().ToAddress()
        public_key = wallet.PublicKey().RawCompressed().ToHex()
        specification = {
            "recipe": "bip44-tron-v1",
            "path": "m/44'/195'/0'/0/0",
            "chain": "tron" if chain_env == "mainnet" else "nile",
        }
    elif network == "SOL":
        # Solana Keypair.fromSeed-compatible Ed25519 key, not a mnemonic/HD path.
        if len(seed) != 32:
            raise ValueError("Solana requires a 32-byte Ed25519 seed")
        public_bytes = bytes(SigningKey(seed).verify_key)
        address = Base58Encoder.Encode(public_bytes)
        public_key = public_bytes.hex()
        specification = {
            "recipe": "solana-ed25519-seed-v1",
            "cluster": "mainnet-beta" if chain_env == "mainnet" else "devnet",
        }
    elif network == "TON":
        # A raw Ed25519 seed, not a TON/BIP39 mnemonic. Recovery uses these exact bytes.
        if len(seed) != 32:
            raise ValueError("TON requires a 32-byte Ed25519 seed")
        wallet = Ton.FromSeed(seed)
        address = TonAddress(wallet.GetAddress(version=TonAddrVersions.V4)).to_str(
            is_bounceable=False, is_test_only=chain_env == "testnet"
        )
        public_key = wallet.PublicKey().RawCompressed().ToBytes()[1:].hex()
        specification = {
            "recipe": "ton-ed25519-v4r2-v1",
            "wallet_version": "v4r2",
            "wallet_id": 698983191,
            "workchain": 0,
            "bounceable": False,
            "test_only": chain_env == "testnet",
        }
    else:
        if network == "BTC":
            coin = (
                Bip84Coins.BITCOIN
                if chain_env == "mainnet"
                else Bip84Coins.BITCOIN_TESTNET
            )
            wallet = Bip84.FromSeed(seed, coin).DeriveDefaultPath()
            specification = {
                "recipe": "bip84-p2wpkh-v1",
                "path": "m/84'/%d'/0'/0/0" % (0 if chain_env == "mainnet" else 1),
                "script_type": "p2wpkh",
                "chain": "bitcoin" if chain_env == "mainnet" else "bitcoin-testnet4",
            }
        else:
            coin = (
                Bip44Coins.ETHEREUM
                if network == "ETH"
                else Bip44Coins.BINANCE_SMART_CHAIN
            )
            wallet = Bip44.FromSeed(seed, coin).DeriveDefaultPath()
            chain_id = (
                (1 if network == "ETH" else 56)
                if chain_env == "mainnet"
                else (11155111 if network == "ETH" else 97)
            )
            specification = {
                "recipe": "bip44-evm-eoa-v1",
                "path": "m/44'/60'/0'/0/0",
                "chain_id": chain_id,
            }
        address = wallet.PublicKey().ToAddress()
        public_key = wallet.PublicKey().RawCompressed().ToHex()
    return {
        "address": address,
        "public_key": public_key,
        "specification": specification,
    }


def prepare(ledger):
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS custody_keys (key_id TEXT PRIMARY KEY,public_key TEXT NOT NULL,created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS custody_wallets (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES wallet_accounts(user_id),
        network TEXT NOT NULL,chain_env TEXT NOT NULL,address TEXT NOT NULL,public_key TEXT NOT NULL,
        specification TEXT NOT NULL,key_id TEXT NOT NULL REFERENCES custody_keys(key_id),
        encrypted_secret BLOB NOT NULL,created_at REAL NOT NULL,
        UNIQUE(user_id,network,chain_env),UNIQUE(network,chain_env,address)
      );
      CREATE TABLE IF NOT EXISTS custody_hidden (wallet_id TEXT PRIMARY KEY REFERENCES custody_wallets(id),user_id TEXT NOT NULL,hidden_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS custody_activity (id TEXT PRIMARY KEY,wallet_id TEXT NOT NULL REFERENCES custody_wallets(id),actor TEXT NOT NULL,action TEXT NOT NULL,created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS custody_events (wallet_id TEXT PRIMARY KEY REFERENCES custody_wallets(id),actor TEXT NOT NULL,action TEXT NOT NULL,created_at REAL NOT NULL);
      CREATE TRIGGER IF NOT EXISTS custody_wallets_immutable_update BEFORE UPDATE ON custody_wallets BEGIN SELECT RAISE(ABORT,'immutable custody wallet'); END;
      CREATE TRIGGER IF NOT EXISTS custody_wallets_immutable_delete BEFORE DELETE ON custody_wallets BEGIN SELECT RAISE(ABORT,'immutable custody wallet'); END;
      CREATE TRIGGER IF NOT EXISTS custody_keys_immutable_update BEFORE UPDATE ON custody_keys BEGIN SELECT RAISE(ABORT,'immutable custody key'); END;
      CREATE TRIGGER IF NOT EXISTS custody_keys_immutable_delete BEFORE DELETE ON custody_keys BEGIN SELECT RAISE(ABORT,'immutable custody key'); END;
    """
    )
    ledger.begin("migration", "system", "Custody address schema v1")
    try:
        ledger.db.execute(
            "INSERT OR IGNORE INTO finance_migrations VALUES (?,?)",
            ("custody-addresses-v1", time.time()),
        )
        ledger.db.execute(
            "INSERT OR IGNORE INTO finance_migrations VALUES (?,?)",
            ("custody-visibility-v1", time.time()),
        )
        ledger.commit()
    except Exception:
        ledger.rollback()
        raise


def public_wallet(row):
    # Explicit allowlist: never return encrypted secrets, key identifiers, or recovery envelopes.
    return {
        "id": row["id"],
        "network": row["network"],
        "chain_env": row["chain_env"],
        "asset": NETWORKS[row["network"]]["asset"],
        "address": row["address"],
        "created_at": row["created_at"],
        "specification": json.loads(row["specification"]),
        "provider": "wpay",
        "deposit_enabled": False,
        "withdraw_enabled": False,
    }


class Custody:
    def __init__(
        self, ledger, error, enabled=False, public_key_file="", chain_env="testnet"
    ):
        self.ledger, self.error = ledger, error
        self.chain_env = chain_env
        self.public_key = None
        self.configuration_error = False
        if enabled:
            try:
                if chain_env not in {"testnet", "mainnet"}:
                    raise ValueError("Invalid chain environment")
                document = json.loads(Path(public_key_file).read_text())
                if (
                    not isinstance(document, dict)
                    or document.get("kind") != PUBLIC_KEY_KIND
                    or set(document)
                    != {
                        "kind",
                        "key_id",
                        "public_key",
                    }
                ):
                    raise ValueError("Public encryption key required")
                raw = decode(document["public_key"])
                if len(raw) != 32 or document["key_id"] != fingerprint(raw):
                    raise ValueError("Invalid public key")
                candidate = PublicKey(raw)
                # Reject invalid/small-order keys before ever generating client material.
                SealedBox(candidate).encrypt(b"wpay-key-validation-v1")
                self.public_key = candidate
            except (
                ValueError,
                TypeError,
                KeyError,
                OSError,
                RuntimeError,
                CryptoError,
            ):
                self.configuration_error = True
        self.key_id = fingerprint(bytes(self.public_key)) if self.public_key else None

    @property
    def configured(self):
        return self.public_key is not None and not self.configuration_error

    def capabilities(self):
        return {
            "configured": self.configured,
            "chain_env": (
                self.chain_env if self.chain_env in {"mainnet", "testnet"} else None
            ),
            "generation_enabled": self.configured,
            "deposit_enabled": False,
            "withdraw_enabled": False,
            "creation_fee": "0",
            "networks": [{"network": key, **value} for key, value in NETWORKS.items()],
        }

    def create(self, uid, network):
        if network not in NETWORKS:
            raise ValueError("Unsupported network")
        if not self.configured:
            raise self.error(
                "CUSTODY_NOT_CONFIGURED", "Создание кошельков пока недоступно", 503
            )
        ledger = self.ledger
        # One write transaction serializes creation across processes. No remote I/O inside.
        ledger.begin("custody_create", uid, "Create free local wallet address")
        try:
            row = ledger.db.execute(
                "SELECT * FROM custody_wallets WHERE user_id=? AND network=? AND chain_env=?",
                (uid, network, self.chain_env),
            ).fetchone()
            if row:
                if ledger.db.execute(
                    "DELETE FROM custody_hidden WHERE wallet_id=? AND user_id=?",
                    (row["id"], uid),
                ).rowcount:
                    ledger.db.execute(
                        "INSERT INTO custody_activity VALUES (?,?,?,?,?)",
                        (
                            uuid.uuid4().hex,
                            row["id"],
                            uid,
                            "wallet_restored",
                            time.time(),
                        ),
                    )
                ledger.commit()
                return public_wallet(row)
            wallet_id, created_at = uuid.uuid4().hex, time.time()
            seed = secrets.token_bytes(32)
            try:
                derived = derive(seed, network, self.chain_env)
                envelope = {
                    "format": "wpay.wallet.secret.v1",
                    "wallet_id": wallet_id,
                    "user_id": uid,
                    "network": network,
                    "chain_env": self.chain_env,
                    "key_id": self.key_id,
                    **derived,
                    "seed": encode(seed),
                }
                encrypted = SealedBox(self.public_key).encrypt(
                    json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()
                )
            finally:
                # Python cannot guarantee zeroization; avoid retaining plaintext after sealing.
                del seed
            del envelope
            encoded_key = encode(bytes(self.public_key))
            stored = ledger.db.execute(
                "SELECT public_key FROM custody_keys WHERE key_id=?", (self.key_id,)
            ).fetchone()
            if stored and stored[0] != encoded_key:
                raise ValueError("Public key registry mismatch")
            ledger.db.execute(
                "INSERT OR IGNORE INTO custody_keys VALUES (?,?,?)",
                (self.key_id, encoded_key, created_at),
            )
            ledger.db.execute(
                "INSERT INTO custody_wallets(id,user_id,network,chain_env,address,public_key,specification,key_id,encrypted_secret,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    wallet_id,
                    uid,
                    network,
                    self.chain_env,
                    derived["address"],
                    derived["public_key"],
                    json.dumps(derived["specification"], sort_keys=True),
                    self.key_id,
                    encrypted,
                    created_at,
                ),
            )
            ledger.db.execute(
                "INSERT INTO custody_events VALUES (?,?,?,?)",
                (wallet_id, uid, "wallet_created", created_at),
            )
            row = ledger.db.execute(
                "SELECT * FROM custody_wallets WHERE id=?", (wallet_id,)
            ).fetchone()
            ledger.commit()
            return public_wallet(row)
        except Exception:
            ledger.rollback()
            raise

    def hide(self, uid, wallet_id):
        ledger = self.ledger
        ledger.begin("custody_hide", uid, "Hide wallet without removing recovery keys")
        try:
            row = ledger.db.execute(
                "SELECT id FROM custody_wallets WHERE id=? AND user_id=?",
                (wallet_id, uid),
            ).fetchone()
            if not row:
                raise self.error("NOT_FOUND", "Кошелёк не найден", 404)
            if ledger.db.execute(
                "INSERT OR IGNORE INTO custody_hidden VALUES (?,?,?)",
                (wallet_id, uid, time.time()),
            ).rowcount:
                ledger.db.execute(
                    "INSERT INTO custody_activity VALUES (?,?,?,?,?)",
                    (uuid.uuid4().hex, wallet_id, uid, "wallet_hidden", time.time()),
                )
            ledger.commit()
            return {"hidden": True, "id": wallet_id}
        except Exception:
            ledger.rollback()
            raise

    def wallets(self, uid):
        return [
            public_wallet(row)
            for row in self.ledger.db.execute(
                "SELECT w.* FROM custody_wallets w WHERE w.user_id=? AND NOT EXISTS (SELECT 1 FROM custody_hidden h WHERE h.wallet_id=w.id) ORDER BY w.created_at,w.id",
                (uid,),
            )
        ]


async def custody_route(request, action, uid, custody):
    if action not in {
        "custody-status",
        "custody-wallets",
        "custody-wallet",
        "custody-wallet-hide",
        "custody-asset",
        "custody-asset-balances",
        "custody-balance",
        "custody-overview",
    }:
        return None
    if action == "custody-overview" and request.method == "GET":
        if request.query:
            raise ValueError("No ownership filters accepted")
        if not custody.configured:
            raise custody.error("CUSTODY_NOT_CONFIGURED", "Кошельки не подключены", 503)
        return web.json_response(await request.app["wpay_chain"].overview(custody, uid))
    if action == "custody-asset-balances" and request.method == "GET":
        if set(request.query) != {"asset"}:
            raise ValueError("Only asset is accepted")
        if not custody.configured:
            raise custody.error("CUSTODY_NOT_CONFIGURED", "Кошельки не подключены", 503)
        return web.json_response(
            await request.app["wpay_chain"].asset(
                custody, uid, request.query["asset"], create=False
            )
        )
    if action == "custody-asset" and request.method == "POST":
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"asset"}
            or not isinstance(body["asset"], str)
        ):
            raise ValueError("Only asset is accepted")
        return web.json_response(
            await request.app["wpay_chain"].asset(custody, uid, body["asset"])
        )
    if action == "custody-balance" and request.method == "GET":
        if set(request.query) != {"wallet_id", "asset"}:
            raise ValueError("Only wallet_id and asset are accepted")
        return web.json_response(
            await request.app["wpay_chain"].balance(
                custody, uid, request.query["wallet_id"], request.query["asset"]
            )
        )
    if action == "custody-status" and request.method == "GET":
        return web.json_response(custody.capabilities())
    if action == "custody-wallets" and request.method == "GET":
        if request.query:
            raise ValueError("No browser ownership filters")
        return web.json_response({"items": custody.wallets(uid)})
    if action == "custody-wallet-hide" and request.method == "POST":
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"wallet_id"}
            or not isinstance(body["wallet_id"], str)
            or not 1 <= len(body["wallet_id"]) <= 64
        ):
            raise ValueError("Only wallet_id is accepted")
        return web.json_response(custody.hide(uid, body["wallet_id"]))
    if action == "custody-wallet" and request.method == "POST":
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"network"}
            or not isinstance(body["network"], str)
        ):
            raise ValueError("Only network is accepted")
        return web.json_response(custody.create(uid, body["network"]))
    raise custody.error("METHOD_NOT_ALLOWED", "Неверный метод запроса", 405)
