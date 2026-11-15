"""Read-only on-chain observations. Never ledger credit, sign, or broadcast."""

import asyncio
import json
import re
import time
from decimal import Decimal, localcontext
from urllib.parse import quote
from aiohttp import ClientSession, ClientTimeout, ClientError
from bip_utils import Base58Decoder
from pytoniq_core import Address as TonAddress

ASSET_NETWORKS = {
    "BTC": ["BTC"],
    "ETH": ["ETH"],
    "BNB": ["BSC"],
    "TON": ["TON"],
    "SOL": ["SOL"],
    "TRX": ["TRON"],
    "USDT": ["BSC", "ETH", "TON", "SOL", "TRON"],
    "XAUT": ["ETH"],
}
NATIVE = {
    "BTC": "BTC",
    "ETH": "ETH",
    "BSC": "BNB",
    "TON": "TON",
    "SOL": "SOL",
    "TRON": "TRX",
}
ERC20 = {
    ("ETH", "USDT"): ("0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
    ("BSC", "USDT"): ("0x55d398326f99059ff775485246999027b3197955", 18),
    ("ETH", "XAUT"): ("0x68749665ff8d2d112fa859aa293f07a622782f38", 6),
}
SOL_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
TON_USDT = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"
TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"


def integer(value, hexadecimal=False):
    if type(value) is int:
        number = value
    elif isinstance(value, str) and re.fullmatch(
        r"0x[0-9a-fA-F]{1,64}" if hexadecimal else r"[0-9]{1,78}", value
    ):
        number = int(value, 16 if hexadecimal else 10)
    else:
        raise ValueError("Invalid atomic balance")
    if not 0 <= number < 2**256:
        raise ValueError("Invalid atomic balance range")
    return number


def units(value, decimals):
    with localcontext() as ctx:
        ctx.prec = 100
        return format(Decimal(value) / (Decimal(10) ** decimals), "f")


def total(values):
    with localcontext() as ctx:
        ctx.prec = 100
        return format(sum((Decimal(v) for v in values), Decimal(0)), "f")


class ChainReader:
    def __init__(self, ledger, error):
        self.ledger, self.error = ledger, error
        self.session = None
        self.semaphore = asyncio.Semaphore(6)
        self.pending = {}
        ledger.db.execute(
            "CREATE TABLE IF NOT EXISTS custody_balance_cache (wallet_id TEXT NOT NULL REFERENCES custody_wallets(id),asset TEXT NOT NULL,payload TEXT NOT NULL,checked_at REAL NOT NULL,PRIMARY KEY(wallet_id,asset))"
        )
        ledger.db.execute(
            "INSERT OR IGNORE INTO finance_migrations VALUES (?,?)",
            ("custody-chain-observations-v1", time.time()),
        )

    async def close(self):
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self.session:
            await self.session.close()

    async def request(self, url, body=None):
        if self.session is None:
            self.session = ClientSession(
                timeout=ClientTimeout(total=12),
                headers={"User-Agent": "WPay/1.0", "Accept": "application/json"},
            )
        async with self.semaphore:
            async with self.session.request(
                "GET" if body is None else "POST", url, json=body, allow_redirects=False
            ) as r:
                if r.status != 200:
                    raise ValueError("Chain endpoint unavailable")
                chunks = []
                size = 0
                async for chunk in r.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > 1024 * 1024:
                        raise ValueError("Oversized chain response")
                    chunks.append(chunk)
                data = json.loads(b"".join(chunks))
                if not isinstance(data, dict) or "error" in data or "Error" in data:
                    raise ValueError("Invalid chain response")
                return data

    async def rpc(self, url, method, params):
        data = await self.request(
            url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        )
        if data.get("id") != 1 or "result" not in data:
            raise ValueError("Invalid RPC response")
        return data["result"]

    async def read(self, wallet, asset):
        network, env, address = (
            wallet["network"],
            wallet["chain_env"],
            wallet["address"],
        )
        if network not in ASSET_NETWORKS.get(asset, []):
            raise ValueError("Unsupported asset/network")
        if asset != NATIVE[network] and env != "mainnet":
            raise ValueError("Mainnet token is not a testnet token")
        if network in {"ETH", "BSC"}:
            urls = (
                {
                    "ETH": [
                        "https://ethereum-rpc.publicnode.com",
                        "https://eth.llamarpc.com",
                    ],
                    "BSC": [
                        "https://bsc-rpc.publicnode.com",
                        "https://bsc-dataseed.binance.org",
                    ],
                }
                if env == "mainnet"
                else {
                    "ETH": ["https://ethereum-sepolia-rpc.publicnode.com"],
                    "BSC": ["https://bsc-testnet-rpc.publicnode.com"],
                }
            )[network]
            for url in urls:
                try:
                    chain_id = (
                        (1 if network == "ETH" else 56)
                        if env == "mainnet"
                        else (11155111 if network == "ETH" else 97)
                    )
                    if (
                        integer(await self.rpc(url, "eth_chainId", []), True)
                        != chain_id
                    ):
                        raise ValueError("Wrong EVM chain")
                    if asset == NATIVE[network]:
                        raw = await self.rpc(url, "eth_getBalance", [address, "latest"])
                        decimals = 18
                    else:
                        contract, decimals = ERC20[(network, asset)]
                        raw = await self.rpc(
                            url,
                            "eth_call",
                            [
                                {
                                    "to": contract,
                                    "data": "0x70a08231"
                                    + address[2:].lower().rjust(64, "0"),
                                },
                                "latest",
                            ],
                        )
                        if not isinstance(raw, str) or len(raw) != 66:
                            raise ValueError("Invalid ERC20 ABI word")
                    return units(integer(raw, True), decimals), "latest"
                except (
                    OSError,
                    ClientError,
                    ValueError,
                    KeyError,
                    TypeError,
                    asyncio.TimeoutError,
                ):
                    continue
            raise ValueError("EVM balance unavailable")
        if network == "BTC":
            root = (
                "https://mempool.space/api"
                if env == "mainnet"
                else "https://mempool.space/testnet4/api"
            )
            data = await self.request(root + "/address/" + quote(address, safe=""))
            if data.get("address") != address:
                raise ValueError("Wrong Bitcoin address")
            stats = data["chain_stats"]
            amount = integer(stats["funded_txo_sum"]) - integer(stats["spent_txo_sum"])
            if amount < 0:
                raise ValueError("Invalid Bitcoin balance")
            return units(amount, 8), "confirmed"
        if network == "SOL":
            urls = (
                [
                    "https://api.mainnet-beta.solana.com",
                    "https://solana-rpc.publicnode.com",
                ]
                if env == "mainnet"
                else ["https://api.devnet.solana.com"]
            )
            for url in urls:
                try:
                    if asset == "SOL":
                        data = await self.rpc(
                            url, "getBalance", [address, {"commitment": "finalized"}]
                        )
                        return units(integer(data["value"]), 9), "finalized"
                    data = await self.rpc(
                        url,
                        "getTokenAccountsByOwner",
                        [
                            address,
                            {"mint": SOL_USDT},
                            {"encoding": "jsonParsed", "commitment": "finalized"},
                        ],
                    )
                    if not isinstance(data["value"], list):
                        raise ValueError("Invalid token accounts")
                    amount = 0
                    for row in data["value"]:
                        info = row["account"]["data"]["parsed"]["info"]
                        token = info["tokenAmount"]
                        if (
                            info["owner"] != address
                            or info["mint"] != SOL_USDT
                            or token["decimals"] != 6
                        ):
                            raise ValueError("Wrong SPL token account")
                        amount += integer(token["amount"])
                    return units(amount, 6), "finalized"
                except (
                    OSError,
                    ClientError,
                    ValueError,
                    KeyError,
                    TypeError,
                    asyncio.TimeoutError,
                ):
                    continue
            raise ValueError("Solana balance unavailable")
        if network == "TON":
            host = (
                "https://toncenter.com"
                if env == "mainnet"
                else "https://testnet.toncenter.com"
            )
            if asset == "TON":
                data = await self.request(
                    host
                    + "/api/v2/getAddressBalance?address="
                    + quote(address, safe="")
                )
                if data.get("ok") is not True:
                    raise ValueError("TON balance unavailable")
                return units(integer(data["result"]), 9), "indexed"
            data = await self.request(
                host
                + "/api/v3/jetton/wallets?"
                + "owner_address="
                + quote(address, safe="")
                + "&jetton_address="
                + quote(TON_USDT, safe="")
                + "&limit=1000"
            )
            rows = data["jetton_wallets"]
            if not isinstance(rows, list) or len(rows) >= 1000:
                raise ValueError("Incomplete jetton response")
            amount = 0
            for row in rows:
                if TonAddress(row["owner"]).to_str(False) != TonAddress(address).to_str(
                    False
                ) or TonAddress(row["jetton"]).to_str(False) != TonAddress(
                    TON_USDT
                ).to_str(
                    False
                ):
                    raise ValueError("Wrong jetton wallet")
                amount += integer(row["balance"])
            return units(amount, 6), "indexed"
        if network == "TRON":
            host = (
                "https://api.trongrid.io"
                if env == "mainnet"
                else "https://nile.trongrid.io"
            )
            if asset == "TRX":
                data = await self.request(
                    host + "/walletsolidity/getaccount",
                    {"address": address, "visible": True},
                )
                if data and data.get("address") != address:
                    raise ValueError("Wrong TRON account")
                return units(integer(data.get("balance", 0)), 6), "confirmed"
            parameter = Base58Decoder.CheckDecode(address)[1:].hex().rjust(64, "0")
            data = await self.request(
                host + "/walletsolidity/triggerconstantcontract",
                {
                    "owner_address": address,
                    "contract_address": TRON_USDT,
                    "function_selector": "balanceOf(address)",
                    "parameter": parameter,
                    "visible": True,
                },
            )
            if (
                not isinstance(data.get("result"), dict)
                or data["result"].get("result") is not True
            ):
                raise ValueError("TRC20 call failed")
            raw = data["constant_result"]
            if (
                not isinstance(raw, list)
                or len(raw) != 1
                or not isinstance(raw[0], str)
                or len(raw[0]) != 64
            ):
                raise ValueError("Invalid TRC20 word")
            return units(integer("0x" + raw[0], True), 6), "confirmed"
        raise ValueError("Unsupported network")

    async def observe(self, wallet, asset):
        key = (wallet["id"], asset)
        cached = self.ledger.db.execute(
            "SELECT payload,checked_at FROM custody_balance_cache WHERE wallet_id=? AND asset=?",
            key,
        ).fetchone()
        if cached and time.time() - cached["checked_at"] < 30:
            return json.loads(cached["payload"])
        if key not in self.pending:
            self.pending[key] = asyncio.create_task(self._observe(wallet, asset))
            self.pending[key].add_done_callback(
                lambda task: self.pending.pop(key, None)
            )
        return await asyncio.shield(self.pending[key])

    async def _observe(self, wallet, asset):
        result = {
            "wallet_id": wallet["id"],
            "network": wallet["network"],
            "chain_env": wallet["chain_env"],
            "asset": asset,
            "amount": None,
            "checked_at": time.time(),
            "status": "unavailable",
            "error": "Не удалось прочитать баланс сети",
        }
        try:
            amount, finality = await self.read(wallet, asset)
            result.update(amount=amount, status="ok", error=None, finality=finality)
        except (
            OSError,
            ClientError,
            ValueError,
            KeyError,
            TypeError,
            asyncio.TimeoutError,
        ):
            pass
        result["checked_at"] = time.time()
        self.ledger.db.execute(
            "INSERT OR REPLACE INTO custody_balance_cache VALUES (?,?,?,?)",
            (wallet["id"], asset, json.dumps(result), time.time()),
        )
        return result

    async def asset(self, custody, uid, asset, create=True):
        if asset not in ASSET_NETWORKS:
            raise self.error(
                "ASSET_UNSUPPORTED",
                "Этот токен ещё не подключён: нужен проверенный контракт",
                400,
            )
        if create:
            wallets = [
                custody.create(uid, network) for network in ASSET_NETWORKS[asset]
            ]
        else:
            from wallet_custody import public_wallet

            wallets = [
                public_wallet(row)
                for row in self.ledger.db.execute(
                    "SELECT * FROM custody_wallets WHERE user_id=? AND chain_env=?",
                    (uid, custody.chain_env),
                )
                if row["network"] in ASSET_NETWORKS[asset]
            ]
        observations = await asyncio.gather(*(self.observe(w, asset) for w in wallets))
        for wallet, observation in zip(wallets, observations):
            wallet["balance"] = observation
        complete = all(b["status"] == "ok" for b in observations)
        hidden = {
            row[0]
            for row in self.ledger.db.execute(
                "SELECT wallet_id FROM custody_hidden WHERE user_id=?", (uid,)
            )
        }
        return {
            "asset": asset,
            "items": [w for w in wallets if w["id"] not in hidden],
            "amount": total(b["amount"] for b in observations) if complete else None,
            "complete": complete,
        }

    async def balance(self, custody, uid, wallet_id, asset):
        row = self.ledger.db.execute(
            "SELECT * FROM custody_wallets WHERE id=? AND user_id=?", (wallet_id, uid)
        ).fetchone()
        if not row:
            raise self.error("NOT_FOUND", "Кошелёк не найден", 404)
        if row["network"] not in ASSET_NETWORKS.get(asset, []):
            raise self.error(
                "ASSET_UNSUPPORTED", "Монета не поддерживается в этой сети", 400
            )
        return await self.observe(row, asset)

    async def overview(self, custody, uid):
        rows = list(
            self.ledger.db.execute(
                "SELECT * FROM custody_wallets WHERE user_id=? AND chain_env=?",
                (uid, custody.chain_env),
            )
        )
        jobs = [
            (row, asset)
            for row in rows
            for asset, networks in ASSET_NETWORKS.items()
            if row["network"] in networks
        ]
        observations = await asyncio.gather(
            *(self.observe(row, asset) for row, asset in jobs)
        )
        balances = []
        unavailable = []
        for asset in ASSET_NETWORKS:
            selected = [b for b in observations if b["asset"] == asset]
            if selected and all(b["status"] == "ok" for b in selected):
                balances.append(
                    {
                        "asset": asset,
                        "available": total(b["amount"] for b in selected),
                        "reserved": "0",
                    }
                )
            elif selected:
                unavailable.append(asset)
        return {
            "custody": True,
            "balances": balances,
            "unavailable_assets": unavailable,
            "rates": [],
            "transactions": [],
            "observed_at": time.time(),
        }
