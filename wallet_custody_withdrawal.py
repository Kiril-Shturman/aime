"""Browser-side custody withdrawal intents for the isolated custody signer."""

import json
import re
import time
import uuid
from decimal import Decimal, localcontext

from aiohttp import web
from bip_utils import P2WPKHAddrDecoder

from wallet_fixedfloat_orders import address
from wallet_custody import require_wallet_active
from wallet_exchange_funding import CUSTODY_WITHDRAWAL_NETWORKS, DEX_CAPABILITY


class CustodyWithdrawal:
    def __init__(self, funding, enabled, bnb_enabled=False):
        self.funding = funding
        self.ledger = funding.ledger
        self.enabled = enabled
        self.bnb_enabled = bnb_enabled

    def owned(self, uid, job_id, *, dex=False):
        return self.ledger.db.execute("""
            SELECT j.*, w.recipient, w.amount, w.asset, w.requested_by, w.dex_minimum
            FROM custody_funding_jobs j JOIN custody_withdrawal_intents w ON w.job_id=j.id
            WHERE j.user_id=? AND j.id=? AND (w.dex_minimum IS NOT NULL)=?
        """, (uid, job_id, dex)).fetchone()

    def public(self, row):
        view = self.funding.public(row)
        if row["error"] == "NO_FUNDS":
            view["detail"] = f"На собственном кошельке недостаточно {row['asset']}."
        if row["error"] == "NO_GAS":
            view["detail"] = "Недостаточно валюты сети для оплаты комиссии."
        quote = view["quote"]
        if quote and row["dex_minimum"] is not None:
            quote["minimum_usdt"] = json.loads(row["quote"])["minimum_usdt"]
        if quote and quote.get("fee_currency") == row["asset"]:
            with localcontext() as context:
                context.prec = 50
                total = Decimal(row["amount"]) + Decimal(quote["max_fee"])
                quote["estimated_total"] = format(total, "f")
        return {**view, "recipient": row["recipient"], "amount": row["amount"], "asset": row["asset"]}

    @staticmethod
    def recipient(network, value):
        if network == "BTC":
            if not isinstance(value, str) or not re.fullmatch(r"bc1q[a-z0-9]{38}", value):
                raise ValueError("Укажите адрес Bitcoin mainnet формата bc1q")
            P2WPKHAddrDecoder.DecodeAddr(value, hrp="bc")
            return value
        normalized = address(network, value)
        if network == "TON":
            return normalized
        return value if network in {"TRON", "SOL"} else "0x" + normalized

    def prepare(self, uid, body, *, actor=None, wallet_id=None, audit=None, dex_minimum=None):
        asset = body.get("asset", "BNB")
        if not isinstance(asset, str) or asset not in CUSTODY_WITHDRAWAL_NETWORKS:
            raise ValueError("Монета не поддерживается для вывода")
        network = CUSTODY_WITHDRAWAL_NETWORKS[asset]
        dex = dex_minimum is not None
        if not self.funding.signer(network, withdrawal_asset=asset, capability=DEX_CAPABILITY if dex else None):
            raise self.funding.error("SIGNER_UNAVAILABLE", f"Подписант {asset} временно недоступен", 503)
        if set(body) - {"address", "amount", "asset"} or not {"address", "amount"} <= set(body):
            raise ValueError("Укажите адрес и сумму")
        recipient = self.recipient(network, body["address"])
        raw = body["amount"]
        precision = {"XAUT": 6, "TRX": 6, "SOL": 9, "BTC": 8, "GRAM": 9}.get(asset, 18)
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1," + str(precision) + r"})?", raw):
            raise ValueError(f"Укажите сумму с точностью до {precision} знаков")
        amount = Decimal(raw)
        if amount <= 0:
            raise ValueError("Сумма должна быть больше нуля")
        if wallet_id:
            wallet = self.ledger.db.execute(
                "SELECT id,address FROM custody_wallets WHERE id=? AND user_id=? AND network=? AND chain_env='mainnet'",
                (wallet_id, uid, network),
            ).fetchone()
            if not wallet:
                raise self.funding.error("NOT_FOUND", "Кошелёк не найден", 404)
        else:
            wallet = self.funding.custody.create(uid, network)
        if self.recipient(network, wallet["address"]) == recipient:
            raise ValueError("Укажите адрес другого кошелька")
        identifier = uuid.uuid4().hex
        stamp = time.time()
        self.ledger.begin("custody_withdrawal_prepare", actor or uid, identifier)
        try:
            require_wallet_active(self.ledger.db, wallet["id"], self.funding.error)
            self.ledger.db.execute("""
                UPDATE custody_funding_jobs SET state='expired',error='QUOTE_EXPIRED'
                WHERE wallet_id=? AND state='quoted' AND json_extract(quote,'$.expires_at')<=?
            """, (wallet["id"], stamp))
            current = self.ledger.db.execute("""
                SELECT id FROM custody_funding_jobs WHERE wallet_id=? AND
                state IN ('estimating','quoted','confirmed','signing','signed','broadcast','unknown')
            """, (wallet["id"],)).fetchone()
            if current:
                row = self.owned(uid, current["id"], dex=dex)
                if not row or row["requested_by"] != actor or row["asset"] != asset or row["recipient"] != recipient or Decimal(row["amount"]) != amount:
                    raise self.funding.error("PAYMENT_IN_PROGRESS", "С этого адреса уже выполняется операция", 409)
                self.ledger.commit()
                return self.public(row)
            self.ledger.db.execute("""
                INSERT INTO custody_funding_jobs
                (id,intent_id,user_id,wallet_id,network,state,created_at,updated_at)
                VALUES (?,?,?,?,?,'estimating',?,?)
            """, (identifier, identifier, uid, wallet["id"], network, stamp, stamp))
            self.ledger.db.execute(
                "INSERT INTO custody_withdrawal_intents (job_id,recipient,amount,asset,requested_by,dex_minimum) VALUES (?,?,?,?,?,?)", (identifier, recipient, raw, asset, actor, dex_minimum),
            )
            if actor and audit:
                audit(actor, "wallet.withdrawal_requested", uid,
                      detail={"wallet_id": wallet["id"], "job_id": identifier, "asset": asset, "amount": raw})
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        return self.public(self.owned(uid, identifier, dex=dex))

    async def route(self, request, action, uid, require_asset_enabled, *, actor=None, wallet_id=None, audit=None):
        if action not in {"custody-withdrawal", "custody-withdrawal-prepare", "custody-withdrawal-confirm"}:
            return None
        def available(asset):
            enabled = self.enabled or (asset == "BNB" and self.bnb_enabled)
            return enabled and self.funding.custody.configured and self.funding.custody.chain_env == "mainnet"
        if action == "custody-withdrawal" and request.method == "GET":
            asset = request.query.get("asset", "BNB")
            if asset not in CUSTODY_WITHDRAWAL_NETWORKS:
                raise ValueError("Монета не поддерживается для вывода")
            row = self.ledger.db.execute("""
                SELECT j.id FROM custody_funding_jobs j JOIN custody_withdrawal_intents w ON w.job_id=j.id
                WHERE j.user_id=? AND w.asset=? AND w.requested_by IS ? AND w.dex_minimum IS NULL
                  AND (? IS NULL OR j.wallet_id=?) AND j.state IN
                    ('estimating','quoted','confirmed','signing','signed','broadcast','unknown')
                ORDER BY j.created_at DESC LIMIT 1
            """, (uid, asset, actor, wallet_id, wallet_id)).fetchone()
            job_id = request.query.get("job_id") or (row["id"] if row else None)
            job = self.owned(uid, job_id) if job_id else None
            if request.query.get("job_id") and (not job or job["asset"] != asset or job["requested_by"] != actor or (wallet_id and job["wallet_id"] != wallet_id)):
                raise self.funding.error("NOT_FOUND", "Вывод не найден", 404)
            return web.json_response({
                "enabled": available(asset) and self.funding.signer(CUSTODY_WITHDRAWAL_NETWORKS[asset], withdrawal_asset=asset),
                "job": self.public(job) if job else None,
            }, headers={"Cache-Control": "no-store"})
        if request.method != "POST" or action == "custody-withdrawal":
            raise self.funding.error("METHOD_NOT_ALLOWED", "Неверный метод", 405)
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Invalid withdrawal body")
        if action == "custody-withdrawal-prepare":
            asset = body.get("asset", "BNB")
            if not isinstance(asset, str) or asset not in CUSTODY_WITHDRAWAL_NETWORKS:
                raise ValueError("Монета не поддерживается для вывода")
            if not available(asset):
                raise self.funding.error("NOT_CONFIGURED", "Вывод пока недоступен", 503)
            require_asset_enabled(asset, CUSTODY_WITHDRAWAL_NETWORKS[asset])
            return web.json_response(self.prepare(uid, body, actor=actor, wallet_id=wallet_id, audit=audit))
        if set(body) != {"job_id", "approval_id"} or any(
            not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value)
            for value in body.values()
        ):
            raise ValueError("Некорректные идентификаторы заявки")
        job = self.owned(uid, body["job_id"])
        if not job or job["requested_by"] != actor or (wallet_id and job["wallet_id"] != wallet_id):
            raise self.funding.error("NOT_FOUND", "Вывод не найден", 404)
        if not available(job["asset"]):
            raise self.funding.error("NOT_CONFIGURED", "Вывод пока недоступен", 503)
        require_asset_enabled(job["asset"], job["network"])
        self.funding.confirm(uid, body["job_id"], body["approval_id"], native_bnb=True, actor=actor, audit=audit)
        return web.json_response(self.public(self.owned(uid, body["job_id"])))
