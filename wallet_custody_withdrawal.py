"""Browser-side BNB withdrawal intents for the isolated custody signer."""

import re
import time
import uuid
from decimal import Decimal

from aiohttp import web

from wallet_fixedfloat_orders import address


class CustodyWithdrawal:
    def __init__(self, funding, enabled):
        self.funding = funding
        self.ledger = funding.ledger
        self.enabled = enabled

    def owned(self, uid, job_id):
        return self.ledger.db.execute("""
            SELECT j.*, w.recipient, w.amount
            FROM custody_funding_jobs j JOIN custody_withdrawal_intents w ON w.job_id=j.id
            WHERE j.user_id=? AND j.id=?
        """, (uid, job_id)).fetchone()

    def public(self, row):
        view = self.funding.public(row)
        if row["error"] == "NO_FUNDS":
            view["detail"] = "На собственном кошельке недостаточно BNB."
        if row["error"] == "NO_GAS":
            view["detail"] = "Недостаточно BNB на сумму и сетевую комиссию."
        return {**view, "recipient": row["recipient"], "amount": row["amount"]}

    def prepare(self, uid, body):
        if not self.funding.signer("BSC", native_bnb=True):
            raise self.funding.error("SIGNER_UNAVAILABLE", "Подписант BNB временно недоступен", 503)
        if set(body) != {"address", "amount"}:
            raise ValueError("Укажите адрес и сумму BNB")
        recipient = "0x" + address("BSC", body["address"])
        raw = body["amount"]
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,18})?", raw):
            raise ValueError("Укажите сумму BNB с точностью до 18 знаков")
        amount = Decimal(raw)
        if amount <= 0:
            raise ValueError("Сумма должна быть больше нуля")
        wallet = self.funding.custody.create(uid, "BSC")
        if wallet["address"].lower() == recipient:
            raise ValueError("Укажите адрес другого кошелька")
        identifier = uuid.uuid4().hex
        stamp = time.time()
        self.ledger.begin("custody_withdrawal_prepare", uid, identifier)
        try:
            self.ledger.db.execute("""
                UPDATE custody_funding_jobs SET state='expired',error='QUOTE_EXPIRED'
                WHERE wallet_id=? AND state='quoted' AND json_extract(quote,'$.expires_at')<=?
            """, (wallet["id"], stamp))
            current = self.ledger.db.execute("""
                SELECT id FROM custody_funding_jobs WHERE wallet_id=? AND
                state IN ('estimating','quoted','confirmed','signing','signed','broadcast','unknown')
            """, (wallet["id"],)).fetchone()
            if current:
                row = self.owned(uid, current["id"])
                if not row or row["recipient"] != recipient or Decimal(row["amount"]) != amount:
                    raise self.funding.error("PAYMENT_IN_PROGRESS", "С этого адреса уже выполняется операция", 409)
                self.ledger.commit()
                return self.public(row)
            self.ledger.db.execute("""
                INSERT INTO custody_funding_jobs
                (id,intent_id,user_id,wallet_id,network,state,created_at,updated_at)
                VALUES (?,?,?,?,'BSC','estimating',?,?)
            """, (identifier, identifier, uid, wallet["id"], stamp, stamp))
            self.ledger.db.execute(
                "INSERT INTO custody_withdrawal_intents VALUES (?,?,?)", (identifier, recipient, raw),
            )
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        return self.public(self.owned(uid, identifier))

    async def route(self, request, action, uid):
        if action not in {"custody-withdrawal", "custody-withdrawal-prepare", "custody-withdrawal-confirm"}:
            return None
        configured = self.enabled and self.funding.custody.configured and self.funding.custody.chain_env == "mainnet"
        if action == "custody-withdrawal" and request.method == "GET":
            row = self.ledger.db.execute("""
                SELECT j.id FROM custody_funding_jobs j JOIN custody_withdrawal_intents w ON w.job_id=j.id
                WHERE j.user_id=? AND j.state IN
                    ('estimating','quoted','confirmed','signing','signed','broadcast','unknown')
                ORDER BY j.created_at DESC LIMIT 1
            """, (uid,)).fetchone()
            job_id = request.query.get("job_id") or (row["id"] if row else None)
            job = self.owned(uid, job_id) if job_id else None
            if request.query.get("job_id") and not job:
                raise self.funding.error("NOT_FOUND", "Вывод не найден", 404)
            return web.json_response({
                "enabled": configured and self.funding.signer("BSC", native_bnb=True),
                "job": self.public(job) if job else None,
            }, headers={"Cache-Control": "no-store"})
        if request.method != "POST" or action == "custody-withdrawal":
            raise self.funding.error("METHOD_NOT_ALLOWED", "Неверный метод", 405)
        if not configured:
            raise self.funding.error("NOT_CONFIGURED", "Вывод BNB пока недоступен", 503)
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Invalid withdrawal body")
        if action == "custody-withdrawal-prepare":
            return web.json_response(self.prepare(uid, body))
        if set(body) != {"job_id", "approval_id"} or any(
            not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value)
            for value in body.values()
        ):
            raise ValueError("Некорректные идентификаторы заявки")
        if not self.owned(uid, body["job_id"]):
            raise self.funding.error("NOT_FOUND", "Вывод не найден", 404)
        self.funding.confirm(uid, body["job_id"], body["approval_id"], native_bnb=True)
        return web.json_response(self.public(self.owned(uid, body["job_id"])))
