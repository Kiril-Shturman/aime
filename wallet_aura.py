"""Aura Partner API adapter and restart-safe testnet integration.

The module is disabled unless ``WPAY_AURA_ENABLED=1``.  It never falls back
from testnet to production and never exposes provider secrets to HTTP clients.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import re
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import quote, urlsplit

from wallet_aura_errors import CATALOG as ERROR_CATALOG, retry_policy as aura_retry_policy

from aiohttp import ClientSession, ClientTimeout, TCPConnector, web
from wallet_notifications import enqueue as enqueue_notification, prepare as prepare_notifications
from wallet_tariffs import calculate as calculate_tariff, resolve_card_plan, prepare as prepare_tariffs


TEST_BASE_URL = "https://testnet-api.aurawallet.co/v1/partner"
LIVE_BASE_URL = "https://api.aurawallet.co/v1/partner"
FINAL_ERROR_CODES = {
    "kyc_rejected", "card_kind_unavailable", "card_already_requested",
    "card_request_not_cancelable", "card_not_active",
    "card_controls_unavailable", "unauthenticated", "ip_not_allowed",
    "sbp_buy_blocked", "sbp_buy_bank_not_found", "sbp_buy_bank_unsupported",
    "sbp_buy_pending_qr_limit", "kyc_passport_already_used",
    "qr_unsupported", "card_not_activatable", "kyc_identity_locked",
    "kyc_session_unavailable", "sbp_buy_not_enabled", "cards_not_enabled",
    "crypto_processing_not_enabled", "qr_pay_not_enabled", "card_frozen",
}
WAIT_ERROR_CODES = {
    "kyc_pending", "card_paused", "pin_change_rate_limited",
    "withdrawal_limit_exceeded", "resource_exhausted",
}
DELAY_ERROR_CODES = {"rate_limited"}
LATER_ERROR_CODES = {
    "card_float_exhausted", "unavailable", "internal", "rate_unavailable",
    "sbp_buy_temporarily_unavailable", "sbp_buy_daily_qr_limit",
    "sbp_buy_daily_paid_qr_limit", "sbp_buy_fiat_daily_limit",
    "sbp_buy_fiat_monthly_limit",
}
WEBHOOK_EVENT_TYPES = {
    "card.opened", "card.failed", "card.status_changed", "card.operation",
    "card.cancelled", "card.otp", "order.completed", "order.expired",
    "order.failed", "order.cancelled", "customer.kyc.updated",
    "deposit.confirmed", "withdraw.sent", "withdraw.confirmed",
    "withdraw.failed", "customer.deposit.pending",
    "customer.deposit.confirmed", "customer.deposit.rejected",
    "qr_payment.completed", "qr_payment.failed", "qr_payment.refunded",
}
BALANCE_OPERATION_TYPES = {
    "deposit", "sandbox_credit", "cards_platform_topup", "withdraw",
    "cards_platform_withdrawal", "card_fee", "card_recharge", "qr_payment",
}
BALANCE_OPERATION_STATUSES = {"pending", "confirmed", "failed"}
WITHDRAWAL_STATUSES = {"processing", "broadcast", "completed", "failed"}
QR_PAYMENT_STATUSES = {"processing", "completed", "failed", "refunded", "unspecified"}
SBP_ORDER_STATUSES = {
    "awaiting_payment", "completed", "expired", "failed", "cancelled", "unspecified",
}


def prepare(ledger):
    prepare_tariffs(ledger)
    """Install additive tables. Existing GoSwap rows and routes stay untouched."""
    prepare_notifications(ledger)
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_provider_routes (
        product TEXT NOT NULL, asset TEXT NOT NULL, network TEXT NOT NULL,
        environment TEXT NOT NULL, provider TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        updated_at REAL NOT NULL, PRIMARY KEY(product,asset,network,environment)
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_entities (
        provider TEXT NOT NULL, environment TEXT NOT NULL, entity_type TEXT NOT NULL,
        local_id TEXT NOT NULL, remote_id TEXT, user_id TEXT, status TEXT,
        idempotency_key TEXT, request_body TEXT, provider_updated_at TEXT,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(provider,environment,entity_type,local_id),
        UNIQUE(provider,environment,entity_type,remote_id)
      );
      CREATE TABLE IF NOT EXISTS wallet_profile_contacts (
        user_id TEXT NOT NULL, environment TEXT NOT NULL,
        email TEXT, phone TEXT, updated_at REAL NOT NULL,
        PRIMARY KEY(user_id,environment)
      );
      CREATE TABLE IF NOT EXISTS aura_customers (
        user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL,
        environment TEXT NOT NULL, state TEXT NOT NULL, email_hash TEXT, phone_hash TEXT,
        provider_updated_at TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_kyc_cases (
        user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL,
        environment TEXT NOT NULL, status TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0, terminal INTEGER NOT NULL DEFAULT 0,
        reason TEXT, provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_cards (
        card_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        environment TEXT NOT NULL, kind TEXT, status TEXT NOT NULL,
        frozen INTEGER NOT NULL DEFAULT 0, masked_pan TEXT, delivery_status TEXT,
        tracking TEXT,
        provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_card_operations (
        operation_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, user_id TEXT NOT NULL,
        environment TEXT NOT NULL, operation_type TEXT, status TEXT NOT NULL,
        asset TEXT, amount TEXT, fee TEXT, merchant TEXT,
        original_amount TEXT, original_currency TEXT, refunded_amount TEXT,
        balance_before TEXT, balance_after TEXT, merchant_country TEXT, mcc TEXT,
        merchant_category TEXT, previous_status TEXT, decline_reason TEXT,
        decline_message TEXT, provider_created_at TEXT,
        provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_sbp_orders (
        order_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        environment TEXT NOT NULL, status TEXT NOT NULL,
        rub_amount TEXT, usdt_amount TEXT, fee TEXT,
        provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_qr_payments (
        payment_id TEXT PRIMARY KEY, environment TEXT NOT NULL, status TEXT NOT NULL,
        amount_rub TEXT, rate TEXT, total_usdt TEXT, merchant TEXT,
        provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_withdrawals (
        withdrawal_id TEXT PRIMARY KEY, environment TEXT NOT NULL, status TEXT NOT NULL,
        amount TEXT, fee TEXT, recipient TEXT, transaction_hash TEXT,
        provider_updated_at TEXT, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_deposit_addresses (
        address_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        environment TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL,
        label TEXT, is_default INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        UNIQUE(environment,address)
      );
      CREATE TABLE IF NOT EXISTS aura_deposits (
        deposit_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        address_id TEXT, environment TEXT NOT NULL, status TEXT NOT NULL,
        asset TEXT NOT NULL, network TEXT NOT NULL, gross TEXT NOT NULL,
        fee TEXT, net TEXT, transaction_hash TEXT, confirmations INTEGER,
        provider_updated_at TEXT, body TEXT NOT NULL, created_at REAL NOT NULL,
        updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_positions (
        provider TEXT NOT NULL, environment TEXT NOT NULL, user_id TEXT NOT NULL,
        asset TEXT NOT NULL, available TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0',
        updated_at REAL NOT NULL,
        PRIMARY KEY(provider,environment,user_id,asset)
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_reconciliation (
        provider TEXT NOT NULL, environment TEXT NOT NULL, asset TEXT NOT NULL,
        provider_available TEXT NOT NULL, allocated TEXT NOT NULL, difference TEXT NOT NULL,
        state TEXT NOT NULL, checked_at REAL NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY(provider,environment,asset)
      );
      CREATE TABLE IF NOT EXISTS aura_runtime_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_sensitive_access_audit (
        access_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, card_id TEXT NOT NULL,
        environment TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
        created_at REAL NOT NULL, completed_at REAL
      );
    """
    )
    columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(wallet_webhook_inbox)")}
    if "provider" not in columns:
        ledger.db.execute(
            "ALTER TABLE wallet_webhook_inbox ADD COLUMN provider TEXT NOT NULL DEFAULT 'goswap'"
        )
    if "provider_event_id" not in columns:
        ledger.db.execute("ALTER TABLE wallet_webhook_inbox ADD COLUMN provider_event_id TEXT")
    card_columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(aura_cards)")}
    if "delivery_status" not in card_columns:
        ledger.db.execute("ALTER TABLE aura_cards ADD COLUMN delivery_status TEXT")
    if "tracking" not in card_columns:
        ledger.db.execute("ALTER TABLE aura_cards ADD COLUMN tracking TEXT")
    if "plan_id" not in card_columns:
        ledger.db.execute("ALTER TABLE aura_cards ADD COLUMN plan_id TEXT")
    operation_columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(aura_card_operations)")}
    for name in (
        "original_amount", "original_currency", "refunded_amount", "balance_before",
        "balance_after", "merchant_country", "mcc", "merchant_category",
        "previous_status", "decline_reason", "decline_message", "provider_created_at",
    ):
        if name not in operation_columns:
            ledger.db.execute("ALTER TABLE aura_card_operations ADD COLUMN " + name + " TEXT")
    qr_columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(aura_qr_payments)")}
    for name in ("user_id", "customer_id", "payment_type"):
        if name not in qr_columns:
            ledger.db.execute("ALTER TABLE aura_qr_payments ADD COLUMN " + name + " TEXT")
    ledger.db.execute(
        "CREATE INDEX IF NOT EXISTS wallet_webhook_provider_pending "
        "ON wallet_webhook_inbox(provider,processed_at,next_attempt_at)"
    )
    stamp = time.time()
    ledger.db.execute(
        "INSERT OR IGNORE INTO wallet_provider_routes VALUES (?,?,?,?,?,?,?)",
        ("crypto_deposit", "USDT", "TRON", "test", "aura", 0, stamp),
    )


def _decimal(value, *, allow_zero=False):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid Aura decimal")
    if not result.is_finite() or result < 0 or (not allow_zero and result == 0):
        raise ValueError("Invalid Aura decimal")
    if result.as_tuple().exponent < -18:
        raise ValueError("Aura decimal has too many places")
    return result


def _signed_decimal(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid Aura decimal")
    if not result.is_finite() or result.as_tuple().exponent < -18:
        raise ValueError("Invalid Aura decimal")
    return result


SENSITIVE_CARD_KEYS = {
    "pan", "card_number", "number", "cvv", "cvc", "pin", "otp", "code",
    "credentials", "activation_code",
}


def _redact_card_data(value):
    if isinstance(value, dict):
        return {
            str(key): ("[REDACTED]" if str(key).lower() in SENSITIVE_CARD_KEYS
                       else _redact_card_data(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_card_data(item) for item in value]
    return value


def _safe_identifier(value, label):
    value = str(value or "")
    if not value or len(value) > 200 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise ValueError("Invalid Aura " + label)
    return value


def _secret_hash(value):
    if not isinstance(value, str) or not value:
        raise ValueError("Invalid Aura secret value")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _card_request_body(owner_id, kind, shipping_address=None):
    owner_id = _safe_identifier(owner_id, "card owner id")
    kind = str(kind)
    if kind not in {"virtual", "physical"}:
        raise ValueError("Invalid Aura card kind")
    body = {"owner_id": owner_id, "kind": kind}
    if shipping_address is not None:
        if kind != "physical" or not isinstance(shipping_address, dict):
            raise ValueError("Aura shipping address is valid only for a physical card")
        required = {"full_name", "phone", "country", "city", "postal_code", "address_line"}
        if set(shipping_address) != required:
            raise ValueError("Invalid Aura shipping address fields")
        address = {key: str(shipping_address[key]).strip() for key in required}
        limits = {
            "full_name": (2, 64), "city": (1, 64), "postal_code": (3, 12),
            "address_line": (5, 120), "phone": (9, 16), "country": (2, 2),
        }
        if any(
            not limits[key][0] <= len(value) <= limits[key][1]
            or any(ord(char) < 32 or ord(char) > 126 for char in value)
            for key, value in address.items()
        ):
            raise ValueError("Invalid Aura shipping address value")
        if not re.fullmatch(r"[A-Za-z]{2}", address["country"]):
            raise ValueError("Invalid Aura shipping country")
        address["country"] = address["country"].upper()
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", address["phone"]):
            raise ValueError("Invalid Aura shipping phone")
        if not re.fullmatch(r"[A-Za-z0-9 -]{3,12}", address["postal_code"]):
            raise ValueError("Invalid Aura shipping postal code")
        body["shipping_address"] = address
    elif kind == "physical":
        raise ValueError("Aura physical card requires a shipping address")
    return body


def _card_recharge_body(amount=None, amount_spend=None):
    if (amount is None) == (amount_spend is None):
        raise ValueError("Provide exactly one of amount or amount_spend")
    key, value = ("amount", amount) if amount is not None else ("amount_spend", amount_spend)
    return {key: str(_decimal(value))}


def _card_recharge_result(payload, request_body):
    required = {
        "charged_amount", "currency", "failure_reason", "fee",
        "operation_id", "recharge_amount", "status",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura card recharge response")
    if payload.get("currency") != "USDT":
        raise ValueError("Invalid Aura card recharge currency")
    status = str(payload.get("status") or "")
    if status not in {"requested", "sent", "completed", "failed"}:
        raise ValueError("Invalid Aura card recharge status")
    charged = _decimal(payload.get("charged_amount"), allow_zero=status == "failed")
    recharge = _decimal(payload.get("recharge_amount"), allow_zero=status == "failed")
    fee = _decimal(payload.get("fee"), allow_zero=True)
    if charged != recharge + fee:
        raise ValueError("Invalid Aura card recharge amounts")
    if (status != "failed" and "amount" in request_body
            and recharge != _decimal(request_body["amount"])):
        raise ValueError("Aura card recharge amount changed")
    if (status != "failed" and "amount_spend" in request_body
            and charged != _decimal(request_body["amount_spend"])):
        raise ValueError("Aura card recharge spend changed")
    failure_reason = payload.get("failure_reason")
    if status == "failed":
        if failure_reason not in {"provider_rejected", "provider_unavailable"}:
            failure_reason = "provider_rejected"
    elif failure_reason is not None:
        raise ValueError("Unexpected Aura card recharge failure reason")
    return {
        "charged_amount": str(charged), "currency": "USDT",
        "failure_reason": failure_reason, "fee": str(fee),
        "operation_id": _safe_identifier(payload.get("operation_id"), "operation id"),
        "recharge_amount": str(recharge), "status": status,
    }


def _card_credentials_result(payload, expected_card_id):
    required = {"card_id", "cvv", "expiry", "number"}
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura card credentials response")
    card_id = _safe_identifier(payload.get("card_id"), "card id")
    if card_id != expected_card_id:
        raise ValueError("Aura card credentials card_id mismatch")
    number = payload.get("number")
    expiry = payload.get("expiry")
    cvv = payload.get("cvv")
    if not isinstance(number, str) or not re.fullmatch(r"\d+", number):
        raise ValueError("Invalid Aura card number")
    if not isinstance(expiry, str) or not re.fullmatch(r"(0[1-9]|1[0-2])/\d{2}", expiry):
        raise ValueError("Invalid Aura card expiry")
    if cvv is not None and (not isinstance(cvv, str) or not cvv):
        raise ValueError("Invalid Aura card CVV")
    return {"card_id": card_id, "cvv": cvv, "expiry": expiry, "number": number}


def _aura_datetime(value, label):
    if not isinstance(value, str) or not value:
        raise ValueError("Invalid Aura " + label)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Invalid Aura " + label)
    if parsed.tzinfo is None:
        raise ValueError("Invalid Aura " + label)
    return parsed


def _event_result(payload, expected_event_id=None):
    required = {
        "api_version", "created_at", "data", "delivery", "id",
        "occurred_at", "type",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura event response")
    event_id = str(payload.get("id") or "")
    try:
        uuid.UUID(event_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid Aura event id")
    if expected_event_id is not None and event_id != expected_event_id:
        raise ValueError("Aura event id mismatch")
    event_type = payload.get("type")
    if event_type not in WEBHOOK_EVENT_TYPES:
        raise ValueError("Invalid Aura event type")
    api_version = payload.get("api_version")
    if api_version is not None and (not isinstance(api_version, str) or not api_version):
        raise ValueError("Invalid Aura event api_version")
    _aura_datetime(payload.get("created_at"), "event created_at")
    occurred_at = payload.get("occurred_at")
    if occurred_at is not None:
        _aura_datetime(occurred_at, "event occurred_at")
    if not isinstance(payload.get("data"), dict):
        raise ValueError("Invalid Aura event data")
    delivery = payload.get("delivery")
    delivery_required = {
        "attempts", "delivered_at", "failed_at", "last_status_code",
        "next_attempt_at", "status",
    }
    if not isinstance(delivery, dict) or set(delivery) != delivery_required:
        raise ValueError("Invalid Aura event delivery")
    attempts = delivery.get("attempts")
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 0:
        raise ValueError("Invalid Aura event delivery attempts")
    if delivery.get("status") not in {"pending", "delivered", "failed"}:
        raise ValueError("Invalid Aura event delivery status")
    last_status = delivery.get("last_status_code")
    if last_status is not None and (
        isinstance(last_status, bool) or not isinstance(last_status, int)
    ):
        raise ValueError("Invalid Aura event delivery status code")
    for key in ("delivered_at", "failed_at", "next_attempt_at"):
        value = delivery.get(key)
        if value is not None:
            _aura_datetime(value, "event delivery " + key)
    return {
        "api_version": api_version, "created_at": payload["created_at"],
        "data": payload["data"], "delivery": dict(delivery), "id": event_id,
        "occurred_at": occurred_at, "type": event_type,
    }


def _uuid(value, label):
    value = str(value or "")
    try:
        uuid.UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid Aura " + label)
    return value


def _balance_history_entry(payload, expected_operation_id=None):
    required = {"id", "type", "status", "amount", "currency", "created_at"}
    optional = {"recipient", "reference_operation_id", "source", "transaction_hash"}
    if not isinstance(payload, dict) or not required.issubset(payload) or set(payload) - required - optional:
        raise ValueError("Invalid Aura balance history entry")
    operation_id = _uuid(payload.get("id"), "balance operation id")
    if expected_operation_id is not None and operation_id != expected_operation_id:
        raise ValueError("Aura balance operation id mismatch")
    operation_type = payload.get("type")
    status = payload.get("status")
    if operation_type not in BALANCE_OPERATION_TYPES or status not in BALANCE_OPERATION_STATUSES:
        raise ValueError("Invalid Aura balance operation state")
    if payload.get("currency") != "USDT":
        raise ValueError("Invalid Aura balance operation currency")
    amount = _decimal(payload.get("amount"), allow_zero=True)
    _aura_datetime(payload.get("created_at"), "balance operation created_at")
    result = {
        "id": operation_id, "type": operation_type, "status": status,
        "amount": str(amount), "currency": "USDT",
        "created_at": payload["created_at"],
    }
    for key in optional:
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 500):
            raise ValueError("Invalid Aura balance operation " + key)
        result[key] = value
    return result


def _withdrawal_result(payload, expected_withdrawal_id=None):
    required = {
        "address", "amount", "completed_at", "created_at", "currency",
        "failure_reason", "fee", "network", "status", "tx_hash",
        "withdrawal_id",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura withdrawal response")
    withdrawal_id = _uuid(payload.get("withdrawal_id"), "withdrawal id")
    if expected_withdrawal_id is not None and withdrawal_id != expected_withdrawal_id:
        raise ValueError("Aura withdrawal id mismatch")
    address = payload.get("address")
    if not isinstance(address, str) or not re.fullmatch(r"T[1-9A-HJ-NP-Za-km-z]{33}", address):
        raise ValueError("Invalid Aura withdrawal address")
    status = payload.get("status")
    if status not in WITHDRAWAL_STATUSES or payload.get("network") != "TRC20":
        raise ValueError("Invalid Aura withdrawal state")
    if payload.get("currency") != "USDT":
        raise ValueError("Invalid Aura withdrawal currency")
    amount = _decimal(payload.get("amount"))
    fee = _decimal(payload.get("fee"), allow_zero=True)
    _aura_datetime(payload.get("created_at"), "withdrawal created_at")
    completed_at = payload.get("completed_at")
    if completed_at is not None:
        _aura_datetime(completed_at, "withdrawal completed_at")
    failure_reason = payload.get("failure_reason")
    if status == "failed":
        if failure_reason not in {"insufficient_funds", "reverted_on_chain", "rejected"}:
            raise ValueError("Invalid Aura withdrawal failure reason")
    elif failure_reason is not None:
        raise ValueError("Unexpected Aura withdrawal failure reason")
    tx_hash = payload.get("tx_hash")
    if tx_hash is not None and (not isinstance(tx_hash, str) or not tx_hash or len(tx_hash) > 200):
        raise ValueError("Invalid Aura withdrawal transaction hash")
    if status in {"broadcast", "completed"} and tx_hash is None:
        raise ValueError("Aura broadcast withdrawal has no transaction hash")
    if status in {"processing", "broadcast"} and completed_at is not None:
        raise ValueError("Pending Aura withdrawal has completed_at")
    return {
        "address": address, "amount": str(amount), "completed_at": completed_at,
        "created_at": payload["created_at"], "currency": "USDT",
        "failure_reason": failure_reason, "fee": str(fee), "network": "TRC20",
        "status": status, "tx_hash": tx_hash, "withdrawal_id": withdrawal_id,
    }


def _deposit_address_result(payload, *, expected_address_id=None,
                            expected_customer_id=None, environment=None):
    required = {
        "address", "created_at", "currency", "customer_id", "id",
        "is_default", "label", "network",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura deposit address response")
    address_id = _uuid(payload.get("id"), "deposit address id")
    customer_id = _safe_identifier(payload.get("customer_id"), "customer id")
    if expected_address_id is not None and address_id != expected_address_id:
        raise ValueError("Aura deposit address id mismatch")
    if expected_customer_id is not None and customer_id != expected_customer_id:
        raise ValueError("Aura deposit address owner mismatch")
    address = payload.get("address")
    if not isinstance(address, str) or not re.fullmatch(r"T[1-9A-HJ-NP-Za-km-z]{33}", address):
        raise ValueError("Invalid Aura TRON deposit address")
    network = payload.get("network")
    if network not in {"nile", "mainnet"} or payload.get("currency") != "USDT":
        raise ValueError("Invalid Aura deposit address network")
    if environment is not None and network != ("nile" if environment == "test" else "mainnet"):
        raise ValueError("Aura deposit address environment mismatch")
    label = payload.get("label")
    if label is not None and (not isinstance(label, str) or not 1 <= len(label) <= 64):
        raise ValueError("Invalid Aura deposit address label")
    if not isinstance(payload.get("is_default"), bool):
        raise ValueError("Invalid Aura deposit address default flag")
    _aura_datetime(payload.get("created_at"), "deposit address created_at")
    return {
        "address": address, "created_at": payload["created_at"],
        "currency": "USDT", "customer_id": customer_id, "id": address_id,
        "is_default": payload["is_default"], "label": label, "network": network,
    }


def _identity_request_body(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid Aura customer identity")
    required = {"first_name", "last_name", "birth_date", "passport", "passport_issue_date"}
    optional = {
        "country_of_passport_issue", "inn", "patronymic",
        "registration_apartment", "registration_building", "registration_city",
        "registration_city_en", "registration_country", "registration_house",
        "registration_index", "registration_state", "registration_street",
        "registration_street_en",
    }
    if not required.issubset(payload) or set(payload) - required - optional:
        raise ValueError("Invalid Aura customer identity fields")
    result = {key: str(value).strip() for key, value in payload.items()}
    name_pattern = r"[А-Яа-яЁё -]+"
    for key in ("first_name", "last_name"):
        if not re.fullmatch(name_pattern, result[key]) or len(result[key]) > 100:
            raise ValueError("Invalid Aura identity " + key)
    if "patronymic" in result and (
        not re.fullmatch(name_pattern, result["patronymic"])
        or len(result["patronymic"]) > 100
    ):
        raise ValueError("Invalid Aura identity patronymic")
    try:
        birth_date = datetime.strptime(result["birth_date"], "%Y-%m-%d").date()
        issue_date = datetime.strptime(result["passport_issue_date"], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Invalid Aura identity date")
    if issue_date <= birth_date or issue_date > datetime.now(timezone.utc).date():
        raise ValueError("Invalid Aura passport issue date")
    passport = result["passport"].replace(" ", "")
    if not re.fullmatch(r"[0-9]{10}", passport):
        raise ValueError("Invalid Aura passport")
    result["passport"] = passport
    country = result.get("country_of_passport_issue", "RUS")
    if not re.fullmatch(r"[A-Z]{3}", country):
        raise ValueError("Invalid Aura passport country")
    result["country_of_passport_issue"] = country
    if "inn" in result and not re.fullmatch(r"[0-9]{12}", result["inn"]):
        raise ValueError("Invalid Aura identity inn")
    if "registration_country" in result and not re.fullmatch(
        r"[A-Z]{3}", result["registration_country"]
    ):
        raise ValueError("Invalid Aura registration country")
    for key in optional - {"country_of_passport_issue", "inn", "patronymic", "registration_country"}:
        if key in result and (not result[key] or len(result[key]) > 200):
            raise ValueError("Invalid Aura identity " + key)
    return result


def _kyc_result(payload):
    required = {"status", "verified", "reason", "terminal", "checked_at"}
    optional = {"message", "next_action", "session_expires_at"}
    if not isinstance(payload, dict) or not required.issubset(payload) or set(payload) - required - optional:
        raise ValueError("Invalid Aura KYC response")
    status = payload.get("status")
    if status not in {"none", "pending", "completed", "rejected"}:
        raise ValueError("Invalid Aura KYC status")
    if not isinstance(payload.get("verified"), bool) or not isinstance(payload.get("terminal"), bool):
        raise ValueError("Invalid Aura KYC flags")
    if payload["verified"] and status != "completed":
        raise ValueError("Invalid Aura verified KYC state")
    checked_at = payload.get("checked_at")
    if checked_at is not None:
        _aura_datetime(checked_at, "KYC checked_at")
    reason = payload.get("reason")
    message = payload.get("message")
    if reason is not None and (not isinstance(reason, str) or len(reason) > 500):
        raise ValueError("Invalid Aura KYC reason")
    if message is not None and (not isinstance(message, str) or len(message) > 1000):
        raise ValueError("Invalid Aura KYC message")
    next_action = payload.get("next_action")
    if next_action not in {None, "start_kyc", "wait", "update_phone"}:
        raise ValueError("Invalid Aura KYC next_action")
    session_expires_at = payload.get("session_expires_at")
    if session_expires_at is not None:
        _aura_datetime(session_expires_at, "KYC session_expires_at")
    return {
        "status": status, "verified": payload["verified"], "reason": reason,
        "terminal": payload["terminal"], "checked_at": checked_at,
        "message": message, "next_action": next_action,
        "session_expires_at": session_expires_at,
    }


def _sbp_rate_result(payload):
    required = {
        "rate", "fiat_currency", "crypto_currency", "min_fiat_amount",
        "max_fiat_amount", "quoted_at",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura SBP rate response")
    rate = _decimal(payload.get("rate"))
    minimum = _decimal(payload.get("min_fiat_amount"))
    maximum = _decimal(payload.get("max_fiat_amount"))
    if minimum > maximum or payload.get("fiat_currency") != "RUB" \
            or payload.get("crypto_currency") != "USDT":
        raise ValueError("Invalid Aura SBP rate bounds")
    _aura_datetime(payload.get("quoted_at"), "SBP rate quoted_at")
    return {
        "rate": str(rate), "fiat_currency": "RUB", "crypto_currency": "USDT",
        "min_fiat_amount": str(minimum), "max_fiat_amount": str(maximum),
        "quoted_at": payload["quoted_at"],
    }


def _sbp_quote_result(payload, expected_customer_id):
    required = {
        "quote_token", "customer_id", "fiat_amount", "provider_fee", "fiat_net",
        "fiat_currency", "crypto_amount", "crypto_currency", "rate", "expires_at",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura SBP quote response")
    customer_id = _safe_identifier(payload.get("customer_id"), "customer id")
    if customer_id != expected_customer_id:
        raise ValueError("Aura SBP quote customer mismatch")
    token = payload.get("quote_token")
    if not isinstance(token, str) or not token or len(token) > 4096:
        raise ValueError("Invalid Aura SBP quote token")
    fiat_amount = _decimal(payload.get("fiat_amount"))
    provider_fee = _decimal(payload.get("provider_fee"), allow_zero=True)
    fiat_net = _decimal(payload.get("fiat_net"))
    crypto_amount = _decimal(payload.get("crypto_amount"))
    rate = _decimal(payload.get("rate"))
    if provider_fee >= fiat_amount or fiat_net != fiat_amount - provider_fee:
        raise ValueError("Invalid Aura SBP quote amounts")
    if payload.get("fiat_currency") != "RUB" or payload.get("crypto_currency") != "USDT":
        raise ValueError("Invalid Aura SBP quote currencies")
    _aura_datetime(payload.get("expires_at"), "SBP quote expires_at")
    return {
        "quote_token": token, "customer_id": customer_id,
        "fiat_amount": str(fiat_amount), "provider_fee": str(provider_fee),
        "fiat_net": str(fiat_net), "fiat_currency": "RUB",
        "crypto_amount": str(crypto_amount), "crypto_currency": "USDT",
        "rate": str(rate), "expires_at": payload["expires_at"],
    }


def _sbp_order_result(payload, expected_order_id=None, expected_customer_id=None):
    required = {
        "id", "customer_id", "status", "fiat_amount", "provider_fee", "fiat_net",
        "fiat_currency", "crypto_amount", "crypto_currency", "rate", "qr_url",
        "qr_png_base64", "payer_phone_masked", "expires_at", "created_at",
        "completed_at", "failure_reason",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura SBP order response")
    order_id = _uuid(payload.get("id"), "SBP order id")
    customer_id = _safe_identifier(payload.get("customer_id"), "customer id")
    if expected_order_id is not None and order_id != expected_order_id:
        raise ValueError("Aura SBP order id mismatch")
    if expected_customer_id is not None and customer_id != expected_customer_id:
        raise ValueError("Aura SBP order customer mismatch")
    status = payload.get("status")
    if status not in SBP_ORDER_STATUSES:
        raise ValueError("Invalid Aura SBP order status")
    fiat_amount = _decimal(payload.get("fiat_amount"))
    provider_fee = _decimal(payload.get("provider_fee"), allow_zero=True)
    fiat_net = _decimal(payload.get("fiat_net"))
    crypto_amount = _decimal(payload.get("crypto_amount"))
    rate = _decimal(payload.get("rate"))
    if provider_fee >= fiat_amount or fiat_net != fiat_amount - provider_fee:
        raise ValueError("Invalid Aura SBP order amounts")
    if payload.get("fiat_currency") != "RUB" or payload.get("crypto_currency") != "USDT":
        raise ValueError("Invalid Aura SBP order currencies")
    for key in ("created_at", "expires_at"):
        _aura_datetime(payload.get(key), "SBP order " + key)
    completed_at = payload.get("completed_at")
    if completed_at is not None:
        _aura_datetime(completed_at, "SBP order completed_at")
    for key in ("qr_url", "qr_png_base64", "payer_phone_masked", "failure_reason"):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > 2_000_000):
            raise ValueError("Invalid Aura SBP order " + key)
    if status == "awaiting_payment" and not payload.get("qr_url"):
        raise ValueError("Active Aura SBP order has no QR")
    return {
        "id": order_id, "customer_id": customer_id, "status": status,
        "fiat_amount": str(fiat_amount), "provider_fee": str(provider_fee),
        "fiat_net": str(fiat_net), "fiat_currency": "RUB",
        "crypto_amount": str(crypto_amount), "crypto_currency": "USDT",
        "rate": str(rate), "qr_url": payload.get("qr_url"),
        "qr_png_base64": payload.get("qr_png_base64"),
        "payer_phone_masked": payload.get("payer_phone_masked"),
        "expires_at": payload["expires_at"], "created_at": payload["created_at"],
        "completed_at": completed_at, "failure_reason": payload.get("failure_reason"),
    }


def _qr_quote_result(payload):
    required = {
        "quote_token", "merchant_name", "payment_type", "amount_rub",
        "rate", "total_usdt", "expires_at",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura QR quote response")
    token = payload.get("quote_token")
    if not isinstance(token, str) or not token or len(token) > 4096:
        raise ValueError("Invalid Aura QR quote token")
    merchant = payload.get("merchant_name")
    payment_type = payload.get("payment_type")
    if merchant is not None and (not isinstance(merchant, str) or len(merchant) > 500):
        raise ValueError("Invalid Aura QR quote merchant")
    if payment_type not in {None, "nspk", "st00012", "gibdd_uin"}:
        raise ValueError("Invalid Aura QR quote payment type")
    amount_rub = _decimal(payload.get("amount_rub"))
    rate = _decimal(payload.get("rate"))
    total_usdt = _decimal(payload.get("total_usdt"))
    _aura_datetime(payload.get("expires_at"), "QR quote expires_at")
    return {
        "quote_token": token, "merchant_name": merchant, "payment_type": payment_type,
        "amount_rub": str(amount_rub), "rate": str(rate),
        "total_usdt": str(total_usdt), "expires_at": payload["expires_at"],
    }


def _qr_payment_result(payload, expected_payment_id=None, expected_customer_id=None):
    required = {
        "id", "customer_id", "status", "merchant_name", "payment_type",
        "amount_rub", "rate", "total_usdt", "created_at", "completed_at",
        "failed_at", "refunded_at", "failure_reason",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura QR payment response")
    payment_id = _uuid(payload.get("id"), "QR payment id")
    customer_id = payload.get("customer_id")
    if customer_id is not None:
        customer_id = _safe_identifier(customer_id, "customer id")
    if expected_payment_id is not None and payment_id != expected_payment_id:
        raise ValueError("Aura QR payment id mismatch")
    if expected_customer_id is not None and customer_id != expected_customer_id:
        raise ValueError("Aura QR payment customer mismatch")
    status = payload.get("status")
    if status not in QR_PAYMENT_STATUSES:
        raise ValueError("Invalid Aura QR payment status")
    merchant = payload.get("merchant_name")
    payment_type = payload.get("payment_type")
    if merchant is not None and (not isinstance(merchant, str) or len(merchant) > 500):
        raise ValueError("Invalid Aura QR payment merchant")
    if payment_type not in {None, "nspk", "st00012", "gibdd_uin"}:
        raise ValueError("Invalid Aura QR payment type")
    amount_rub = _decimal(payload.get("amount_rub"))
    rate = _decimal(payload.get("rate"))
    total_usdt = _decimal(payload.get("total_usdt"))
    _aura_datetime(payload.get("created_at"), "QR payment created_at")
    for key in ("completed_at", "failed_at", "refunded_at"):
        if payload.get(key) is not None:
            _aura_datetime(payload[key], "QR payment " + key)
    reason = payload.get("failure_reason")
    if status == "failed":
        if reason not in {"expired", "cancelled", "failed"}:
            raise ValueError("Invalid Aura QR payment failure reason")
    elif reason is not None:
        raise ValueError("Unexpected Aura QR payment failure reason")
    return {
        "id": payment_id, "customer_id": customer_id, "status": status,
        "merchant_name": merchant, "payment_type": payment_type,
        "amount_rub": str(amount_rub), "rate": str(rate),
        "total_usdt": str(total_usdt), "created_at": payload["created_at"],
        "completed_at": payload.get("completed_at"), "failed_at": payload.get("failed_at"),
        "refunded_at": payload.get("refunded_at"), "failure_reason": reason,
    }


def _card_otp_result(payload, expected_card_id):
    if payload is None:
        return None
    required = {
        "card_id", "card_number_masked", "code", "consumed_at", "expires_at",
        "id", "received_at", "subject",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Invalid Aura card OTP response")
    card_id = _safe_identifier(payload.get("card_id"), "card id")
    if card_id != expected_card_id:
        raise ValueError("Aura card OTP card_id mismatch")
    otp_id = _safe_identifier(payload.get("id"), "OTP id")
    code = payload.get("code")
    if not isinstance(code, str) or not code or len(code) > 100:
        raise ValueError("Invalid Aura card OTP code")
    masked = payload.get("card_number_masked")
    if masked is not None and (not isinstance(masked, str) or len(masked) > 64):
        raise ValueError("Invalid Aura card OTP masked number")
    subject = payload.get("subject")
    if subject is not None and (not isinstance(subject, str) or len(subject) > 500):
        raise ValueError("Invalid Aura card OTP subject")
    received = _aura_datetime(payload.get("received_at"), "card OTP received_at")
    expires = _aura_datetime(payload.get("expires_at"), "card OTP expires_at")
    if expires - received != timedelta(minutes=2):
        raise ValueError("Invalid Aura card OTP lifetime")
    consumed_at = payload.get("consumed_at")
    if consumed_at is not None:
        _aura_datetime(consumed_at, "card OTP consumed_at")
    return {
        "card_id": card_id, "card_number_masked": masked, "code": code,
        "consumed_at": consumed_at, "expires_at": payload["expires_at"],
        "id": otp_id, "received_at": payload["received_at"], "subject": subject,
    }


def _card_control_result(payload, expected_card_id, expected_frozen):
    required = {
        "balance", "card_id", "card_number_masked", "currency", "frozen",
        "operations_count", "operations_value", "owner_id", "status",
    }
    if not isinstance(payload, dict) or not required.issubset(payload):
        raise ValueError("Invalid Aura card control response")
    card_id = _safe_identifier(payload.get("card_id"), "card id")
    if card_id != expected_card_id:
        raise ValueError("Aura card control card_id mismatch")
    owner_id = _safe_identifier(payload.get("owner_id"), "card owner id")
    frozen = payload.get("frozen")
    if payload.get("currency") != "USDT" or not isinstance(frozen, bool):
        raise ValueError("Invalid Aura card control state")
    if expected_frozen is not None and frozen is not expected_frozen:
        raise ValueError("Unexpected Aura card frozen state")
    status = str(payload.get("status") or "")
    if status != "opened":
        raise ValueError("Controlled Aura card must remain opened")
    balance = str(_decimal(payload.get("balance"), allow_zero=True))
    operations_value = str(_decimal(payload.get("operations_value"), allow_zero=True))
    operations_count = payload.get("operations_count")
    if (isinstance(operations_count, bool) or not isinstance(operations_count, int)
            or operations_count < 0):
        raise ValueError("Invalid Aura card operations_count")
    masked = payload.get("card_number_masked")
    if not isinstance(masked, str) or len(masked) > 64:
        raise ValueError("Invalid Aura masked card number")
    result = {
        "balance": balance, "card_id": card_id, "card_number_masked": masked,
        "currency": "USDT", "frozen": frozen,
        "operations_count": operations_count, "operations_value": operations_value,
        "owner_id": owner_id, "status": status,
    }
    date_fields = ("activated_at", "shipped_at")
    for key in date_fields:
        if key in payload:
            if payload[key] is not None:
                _aura_datetime(payload[key], "card " + key)
            result[key] = payload[key]
    delivery_status = payload.get("delivery_status")
    if delivery_status is not None and delivery_status not in {
        "issuing", "issued", "out_for_delivery", "activated",
    }:
        raise ValueError("Invalid Aura card delivery_status")
    shipment_stage = payload.get("shipment_stage")
    if shipment_stage is not None and shipment_stage not in {
        "issuing", "packing", "sent", "activated",
    }:
        raise ValueError("Invalid Aura card shipment_stage")
    if delivery_status is not None and shipment_stage is not None:
        legacy = {
            "issuing": "issuing", "packing": "issued",
            "sent": "out_for_delivery", "activated": "activated",
        }
        if legacy[shipment_stage] != delivery_status:
            raise ValueError("Aura card delivery aliases disagree")
    if "delivery_status" in payload:
        result["delivery_status"] = delivery_status
    if "shipment_stage" in payload:
        result["shipment_stage"] = shipment_stage
    if "shipping_address" in payload:
        address = payload["shipping_address"]
        if address is not None:
            address = _card_request_body(owner_id, "physical", address)["shipping_address"]
        result["shipping_address"] = address
    if "tracking" in payload:
        tracking = payload["tracking"]
        if tracking is not None:
            if not isinstance(tracking, dict) or set(tracking) != {"carrier", "number", "url"}:
                raise ValueError("Invalid Aura card tracking")
            carrier = tracking["carrier"]
            number = tracking["number"]
            url = tracking["url"]
            parsed = urlsplit(url) if isinstance(url, str) else None
            if (carrier is not None and (not isinstance(carrier, str) or len(carrier) > 100)):
                raise ValueError("Invalid Aura card tracking carrier")
            if not isinstance(number, str) or not number or len(number) > 200:
                raise ValueError("Invalid Aura card tracking number")
            if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Invalid Aura card tracking URL")
            tracking = {"carrier": carrier, "number": number, "url": url}
        result["tracking"] = tracking
    return result


def _retry_policy(code, status):
    return aura_retry_policy(code, status)


class AuraClient:
    def __init__(self, api_key, environment, error_cls, base_url=None, session=None):
        if environment not in {"test", "live"}:
            raise ValueError("AURA_ENVIRONMENT must be test or live")
        self.api_key = api_key
        self.environment = environment
        self.error_cls = error_cls
        official = TEST_BASE_URL if environment == "test" else LIVE_BASE_URL
        self.base_url = (base_url or official).rstrip("/")
        if base_url and self.base_url != official:
            host = (urlsplit(self.base_url).hostname or "").lower()
            if environment != "test" or host not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("Custom Aura URL is allowed only for a local test mock")
        if api_key:
            expected = "ak_test_" if environment == "test" else "ak_live_"
            if not api_key.startswith(expected):
                raise ValueError("Aura key prefix does not match environment")
        self.session = session
        self._owns_session = session is None
        self._limit_lock = asyncio.Lock()
        self.remaining = None
        self.reset_at = 0.0
        self._me_cache = None
        self._me_cache_until = 0.0
        self._credentials_lock = asyncio.Lock()
        self._credentials_reveals = []

    @property
    def configured(self):
        return bool(self.api_key)

    async def _throttle(self):
        async with self._limit_lock:
            delay = self.reset_at - time.monotonic()
            if self.remaining == 0 and delay > 30:
                raise self.error_cls("rate_limited", "Aura request budget is recovering", 429, str(int(delay) + 1))
            if self.remaining == 0 and delay > 0:
                await asyncio.sleep(delay)
            if delay <= 0:
                self.remaining = None

    def _observe_limits(self, headers):
        try:
            remaining = int(headers.get("X-RateLimit-Remaining", ""))
            reset = float(headers.get("X-RateLimit-Reset", "0"))
        except (TypeError, ValueError):
            return
        self.remaining = max(0, remaining)
        self.reset_at = time.monotonic() + max(0, reset)

    def _error(self, response, body):
        envelope = body.get("error") if isinstance(body, dict) else None
        envelope = envelope if isinstance(envelope, dict) else {}
        code = str(envelope.get("code") or "provider_error")[:100]
        message = str(envelope.get("message") or "Aura temporarily unavailable")[:500]
        retry_after = response.headers.get("Retry-After")
        error = self.error_cls(code, message, response.status, retry_after)
        error.provider = "aura"
        error.provider_type = str(envelope.get("type") or "")[:100]
        error.request_id = str(envelope.get("request_id") or response.headers.get("X-Request-Id") or "")[:200]
        error.doc_url = str(envelope.get("doc_url") or "")[:1000]
        error.param = str(envelope.get("param") or "")[:200]
        error.details = envelope.get("details") if isinstance(envelope.get("details"), dict) else {}
        error.retry_policy = aura_retry_policy(code, response.status, error.details)
        rule = ERROR_CATALOG.get(code, {})
        if rule.get("recovery") in {"support", "fix"} or code in {"kyc_pending", "card_paused"}:
            error.retry_after = None
        elif not error.retry_after and rule.get("retrySeconds"):
            error.retry_after = str(rule["retrySeconds"])
        return error

    async def request(self, method, path, *, params=None, body=None, idempotency_key=None,
                      allow_null=False):
        if not self.api_key:
            raise self.error_cls("aura_not_configured", "Aura is not configured", 503)
        await self._throttle()
        if self.session is None:
            self.session = ClientSession(timeout=ClientTimeout(total=20), connector=TCPConnector(family=socket.AF_INET))
        # Mutation endpoints such as freeze/unfreeze still require a JSON
        # representation when they have no fields. Never send a bodyless POST.
        if method.upper() == "POST" and body is None:
            body = {}
        headers = {"X-API-Key": self.api_key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            idempotency_key = str(idempotency_key)
            if not 1 <= len(idempotency_key) <= 200 or "\r" in idempotency_key or "\n" in idempotency_key:
                raise ValueError("Invalid Aura idempotency key")
            headers["Idempotency-Key"] = idempotency_key
        try:
            async with self.session.request(
                method, self.base_url + path, headers=headers, params=params,
                **({"json": body} if body is not None else {}),
            ) as response:
                self._observe_limits(response.headers)
                try:
                    payload = await response.json(content_type=None)
                except (ValueError, TypeError):
                    raise self.error_cls("aura_invalid_response", "Aura returned invalid JSON", 502)
                if response.status < 200 or response.status >= 300:
                    raise self._error(response, payload)
                if payload is None and allow_null:
                    return None
                if not isinstance(payload, (dict, list)):
                    raise self.error_cls("aura_invalid_response", "Aura returned an invalid response", 502)
                return payload
        except (asyncio.TimeoutError, OSError):
            error = self.error_cls(
                "aura_timeout", "Aura outcome is unknown; reconcile before another monetary request", 504
            )
            error.provider = "aura"
            error.retry_policy = "later"
            raise error

    async def diagnostic_request(self, method, path, *, params=None, body=None,
                                 idempotency_key=None):
        """Return a safe HTTP transcript for the allowlisted admin console."""
        if not self.api_key:
            return {'http_status': 503, 'headers': {}, 'body': {
                'error': {'code': 'aura_not_configured', 'message': 'Aura is not configured'}
            }}
        await self._throttle()
        if self.session is None:
            self.session = ClientSession(timeout=ClientTimeout(total=20), connector=TCPConnector(family=socket.AF_INET))
        if method.upper() == 'POST' and body is None:
            body = {}
        headers = {'X-API-Key': self.api_key, 'Accept': 'application/json'}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        if idempotency_key:
            key = str(idempotency_key)
            if not 1 <= len(key) <= 200 or '\r' in key or '\n' in key:
                raise ValueError('Invalid Aura idempotency key')
            headers['Idempotency-Key'] = key
        safe_headers = {
            'x-request-id', 'retry-after', 'x-ratelimit-limit',
            'x-ratelimit-remaining', 'x-ratelimit-reset', 'cache-control',
            'deprecation', 'sunset', 'link',
        }
        try:
            async with self.session.request(
                method, self.base_url + path, headers=headers, params=params,
                **({'json': body} if body is not None else {}),
            ) as response:
                self._observe_limits(response.headers)
                raw = await response.text()
                try:
                    payload = json.loads(raw) if raw else None
                except (ValueError, TypeError):
                    payload = raw[:100000]
                def redact(value):
                    if isinstance(value, list):
                        return [redact(item) for item in value]
                    if not isinstance(value, dict):
                        return value
                    result = {key: redact(item) for key, item in value.items()}
                    for key in ('pan', 'cvv', 'cvc', 'pin', 'otp', 'activation_code'):
                        if key in result:
                            result[key] = '[REDACTED]'
                    if result.get('type') == 'card.otp' and isinstance(result.get('data'), dict):
                        if 'code' in result['data']:
                            result['data']['code'] = '[REDACTED]'
                    return result
                return {
                    'http_status': response.status,
                    'headers': {
                        key: value for key, value in response.headers.items()
                        if key.lower() in safe_headers
                    },
                    'body': redact(payload),
                }
        except (asyncio.TimeoutError, OSError):
            return {'http_status': 504, 'headers': {}, 'body': {
                'error': {
                    'code': 'aura_timeout',
                    'message': 'Aura outcome is unknown; reconcile before retrying',
                }
            }}

    async def get_me(self, *, refresh=False):
        if not refresh and self._me_cache is not None and time.monotonic() < self._me_cache_until:
            return self._me_cache
        result = await self.request("GET", "/me")
        if not isinstance(result, dict) or not isinstance(result.get("products"), dict):
            raise self.error_cls("aura_invalid_response", "Aura /me has no products map", 502)
        self._me_cache = result
        self._me_cache_until = time.monotonic() + 60
        return result

    async def product_enabled(self, product):
        result = await self.get_me()
        return result["products"].get(str(product)) is True

    async def upsert_customer(self, customer_id, *, email=None, phone=None):
        body = {"id": _safe_identifier(customer_id, "customer id")}
        if email:
            email = str(email).strip()
            if len(email) > 320 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                raise ValueError("Invalid Aura customer email")
            body["email"] = email
        if phone:
            phone = str(phone).strip()
            if not re.fullmatch(r"\+7\d{10}", phone):
                raise ValueError("Aura SBP phone must be a Russian mobile number in +7 format")
            body["phone"] = phone
        return await self.request("POST", "/customers", body=body)

    async def get_customer(self, customer_id):
        customer_id = quote(_safe_identifier(customer_id, "customer id"), safe="")
        return await self.request("GET", "/customers/" + customer_id)

    async def list_customers(self, *, cursor=None, limit=100):
        params = {"limit": min(max(int(limit), 1), 100)}
        if cursor:
            params["cursor"] = str(cursor)
        return await self.request("GET", "/customers", params=params)

    async def get_kyc(self, customer_id):
        customer_id = quote(_safe_identifier(customer_id, "customer id"), safe="")
        return await self.request("GET", "/customers/" + customer_id + "/kyc")

    async def start_kyc(self, customer_id):
        customer_id = quote(_safe_identifier(customer_id, "customer id"), safe="")
        return await self.request("POST", "/customers/" + customer_id + "/kyc", body={})

    async def submit_customer_identity(self, customer_id, identity):
        customer_id = _safe_identifier(customer_id, "customer id")
        payload = await self.request(
            "POST", "/customers/" + quote(customer_id, safe="") + "/kyc/identity",
            body=_identity_request_body(identity),
        )
        return _kyc_result(payload)

    async def get_card_fees(self):
        return await self.request("GET", "/cards-fees")

    async def create_card(self, owner_id, *, kind="virtual", idempotency_key,
                          shipping_address=None):
        body = _card_request_body(owner_id, kind, shipping_address)
        return await self.request(
            "POST", "/cards", body=body, idempotency_key=idempotency_key
        )

    async def recharge_card(self, card_id, *, idempotency_key, amount=None,
                            amount_spend=None):
        card_id = quote(_safe_identifier(card_id, "card id"), safe="")
        body = _card_recharge_body(amount, amount_spend)
        return await self.request(
            "POST", "/cards/" + card_id + "/recharge",
            body=body, idempotency_key=idempotency_key,
        )

    async def cancel_card(self, card_id):
        card_id = quote(_safe_identifier(card_id, "card id"), safe="")
        return await self.request("POST", "/cards/" + card_id + "/cancel")

    async def freeze_card(self, card_id):
        card_id = _safe_identifier(card_id, "card id")
        path_id = quote(card_id, safe="")
        payload = await self.request("POST", "/cards/" + path_id + "/freeze")
        return _card_control_result(payload, card_id, True)

    async def unfreeze_card(self, card_id):
        card_id = _safe_identifier(card_id, "card id")
        path_id = quote(card_id, safe="")
        payload = await self.request("POST", "/cards/" + path_id + "/unfreeze")
        return _card_control_result(payload, card_id, False)

    async def activate_card(self, card_id, activation_code):
        card_id = _safe_identifier(card_id, "card id")
        activation_code = str(activation_code).strip()
        if not re.fullmatch(r"[A-Za-z0-9]{4,16}", activation_code):
            raise ValueError("Aura activation_code must be 4-16 letters or digits")
        path_id = quote(card_id, safe="")
        payload = await self.request(
            "POST", "/cards/" + path_id + "/activate",
            body={"activation_code": activation_code},
        )
        result = _card_control_result(payload, card_id, None)
        if result.get("delivery_status") != "activated":
            raise ValueError("Aura physical card was not activated")
        return result

    async def set_card_pin(self, card_id, pin):
        card_id = _safe_identifier(card_id, "card id")
        pin = str(pin)
        if not re.fullmatch(r"[0-9]{6}", pin):
            raise ValueError("Aura card account PIN must be exactly six digits")
        path_id = quote(card_id, safe="")
        payload = await self.request(
            "POST", "/cards/" + path_id + "/pin", body={"pin": pin}
        )
        return _card_control_result(payload, card_id, None)

    async def list_cards(self, *, cursor=None, limit=100):
        params = {"limit": min(max(int(limit), 1), 100)}
        if cursor:
            params["cursor"] = str(cursor)
        return await self.request("GET", "/cards", params=params)

    async def get_card(self, card_id):
        card_id = quote(_safe_identifier(card_id, "card id"), safe="")
        return await self.request("GET", "/cards/" + card_id)

    async def get_card_credentials(self, card_id):
        card_id = _safe_identifier(card_id, "card id")
        async with self._credentials_lock:
            stamp = time.monotonic()
            self._credentials_reveals = [
                seen for seen in self._credentials_reveals if seen > stamp - 60
            ]
            if len(self._credentials_reveals) >= 5:
                retry_after = max(1, int(61 - (stamp - self._credentials_reveals[0])))
                error = self.error_cls(
                    "rate_limited", "Aura card credentials reveal limit reached",
                    429, str(retry_after),
                )
                error.provider = "aura"
                error.details = {"scope": "credentials_reveal"}
                error.retry_policy = "after_delay"
                raise error
            self._credentials_reveals.append(stamp)
        path_id = quote(card_id, safe="")
        payload = await self.request("GET", "/cards/" + path_id + "/credentials")
        return _card_credentials_result(payload, card_id)

    async def get_latest_card_otp(self, card_id):
        card_id = _safe_identifier(card_id, "card id")
        path_id = quote(card_id, safe="")
        payload = await self.request(
            "GET", "/cards/" + path_id + "/otp/latest", allow_null=True
        )
        return _card_otp_result(payload, card_id)

    async def list_card_operations(self, card_id=None, *, cursor=None, limit=100):
        params = {"limit": min(max(int(limit), 1), 100)}
        if cursor:
            params["cursor"] = str(cursor)
        path = "/cards/operations"
        if card_id is not None:
            card_id = quote(_safe_identifier(card_id, "card id"), safe="")
            path = "/cards/" + card_id + "/operations"
        return await self.request("GET", path, params=params)

    async def list_events(self, *, event_types=None, created_after=None,
                          created_before=None, cursor=None, limit=25):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura events limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura events limit")
        params = [("limit", str(limit))]
        if event_types is not None:
            if isinstance(event_types, str):
                event_types = [event_types]
            if not isinstance(event_types, (list, tuple)) or not event_types:
                raise ValueError("Invalid Aura event types")
            for event_type in event_types:
                event_type = str(event_type)
                if event_type not in WEBHOOK_EVENT_TYPES:
                    raise ValueError("Invalid Aura event type")
                params.append(("type", event_type))
        for name, value in (
            ("created_after", created_after), ("created_before", created_before),
        ):
            if value is not None:
                _aura_datetime(value, "events " + name)
                params.append((name, value))
        if cursor:
            params.append(("cursor", str(cursor)))
        payload = await self.request("GET", "/events", params=params)
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"}:
            raise ValueError("Invalid Aura event list")
        if not isinstance(payload["data"], list):
            raise ValueError("Invalid Aura event list data")
        next_cursor = payload["next_cursor"]
        if next_cursor is not None and not isinstance(next_cursor, str):
            raise ValueError("Invalid Aura event cursor")
        return {
            "data": [_event_result(item) for item in payload["data"]],
            "next_cursor": next_cursor,
        }

    async def get_event(self, event_id):
        event_id = str(event_id)
        try:
            uuid.UUID(event_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Invalid Aura event id")
        payload = await self.request("GET", "/events/" + quote(event_id, safe=""))
        return _event_result(payload, event_id)

    async def redeliver_event(self, event_id, *, idempotency_key):
        event_id = str(event_id)
        try:
            uuid.UUID(event_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Invalid Aura event id")
        payload = await self.request(
            "POST", "/events/" + quote(event_id, safe="") + "/redeliver",
            idempotency_key=idempotency_key,
        )
        result = _event_result(payload, event_id)
        if result["delivery"]["status"] != "pending":
            raise ValueError("Aura event redelivery is not pending")
        return result

    async def get_sbp_rate(self):
        return _sbp_rate_result(await self.request("GET", "/rate"))

    async def create_sbp_quote(self, customer_id, fiat_amount):
        customer_id = _safe_identifier(customer_id, "customer id")
        body = {"customer_id": customer_id, "fiat_amount": str(_decimal(fiat_amount))}
        return _sbp_quote_result(
            await self.request("POST", "/quotes", body=body), customer_id
        )

    async def create_sbp_order(self, customer_id, quote_token, *, idempotency_key):
        customer_id = _safe_identifier(customer_id, "customer id")
        if not isinstance(quote_token, str) or not quote_token or len(quote_token) > 4096:
            raise ValueError("Invalid Aura SBP quote token")
        payload = await self.request(
            "POST", "/orders",
            body={"customer_id": customer_id, "quote_token": quote_token},
            idempotency_key=idempotency_key,
        )
        return _sbp_order_result(payload, expected_customer_id=customer_id)

    async def list_sbp_orders(self, *, customer_id=None, statuses=None,
                              created_from=None, created_to=None, cursor=None, limit=20):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura SBP order limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura SBP order limit")
        params = [("limit", str(limit))]
        if customer_id is not None:
            params.append(("customer_id", _safe_identifier(customer_id, "customer id")))
        if statuses is not None:
            if isinstance(statuses, str):
                statuses = [statuses]
            if not isinstance(statuses, (list, tuple)) or not statuses:
                raise ValueError("Invalid Aura SBP order statuses")
            for status in statuses:
                if status not in SBP_ORDER_STATUSES:
                    raise ValueError("Invalid Aura SBP order status")
                params.append(("status", status))
        for name, value in (("created_from", created_from), ("created_to", created_to)):
            if value is not None:
                _aura_datetime(value, "SBP order " + name)
                params.append((name, value))
        if cursor:
            params.append(("cursor", str(cursor)))
        payload = await self.request("GET", "/orders", params=params)
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"} \
                or not isinstance(payload["data"], list):
            raise ValueError("Invalid Aura SBP order list")
        if payload["next_cursor"] is not None and not isinstance(payload["next_cursor"], str):
            raise ValueError("Invalid Aura SBP order cursor")
        return {
            "data": [_sbp_order_result(item) for item in payload["data"]],
            "next_cursor": payload["next_cursor"],
        }

    async def get_sbp_order(self, order_id):
        order_id = _uuid(order_id, "SBP order id")
        return _sbp_order_result(
            await self.request("GET", "/orders/" + quote(order_id, safe="")),
            expected_order_id=order_id,
        )

    async def cancel_sbp_order(self, order_id):
        order_id = _uuid(order_id, "SBP order id")
        return _sbp_order_result(
            await self.request("POST", "/orders/" + quote(order_id, safe="") + "/cancel"),
            expected_order_id=order_id,
        )

    async def list_qr_payments(self, *, customer_id=None, statuses=None,
                               created_from=None, created_to=None, cursor=None, limit=20):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura QR payment limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura QR payment limit")
        params = [("limit", str(limit))]
        if customer_id is not None:
            params.append(("customer_id", _safe_identifier(customer_id, "customer id")))
        if statuses is not None:
            if isinstance(statuses, str):
                statuses = [statuses]
            if not isinstance(statuses, (list, tuple)) or not statuses:
                raise ValueError("Invalid Aura QR payment statuses")
            for status in statuses:
                if status not in QR_PAYMENT_STATUSES:
                    raise ValueError("Invalid Aura QR payment status")
                params.append(("status", status))
        for name, value in (("created_from", created_from), ("created_to", created_to)):
            if value is not None:
                _aura_datetime(value, "QR payment " + name)
                params.append((name, value))
        if cursor:
            params.append(("cursor", str(cursor)))
        payload = await self.request("GET", "/qr-payments", params=params)
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"} \
                or not isinstance(payload["data"], list):
            raise ValueError("Invalid Aura QR payment list")
        if payload["next_cursor"] is not None and not isinstance(payload["next_cursor"], str):
            raise ValueError("Invalid Aura QR payment cursor")
        return {
            "data": [_qr_payment_result(item) for item in payload["data"]],
            "next_cursor": payload["next_cursor"],
        }

    async def create_qr_quote(self, qr_payload, *, customer_id=None):
        if not isinstance(qr_payload, str) or not qr_payload or len(qr_payload) > 8192:
            raise ValueError("Invalid Aura QR payload")
        body = {"qr_payload": qr_payload}
        if customer_id is not None:
            body["customer_id"] = _safe_identifier(customer_id, "customer id")
        return _qr_quote_result(
            await self.request("POST", "/qr-payments/quotes", body=body)
        )

    async def create_qr_payment(self, customer_id, quote_token, qr_payload, *, idempotency_key):
        customer_id = _safe_identifier(customer_id, "customer id")
        if not isinstance(quote_token, str) or not quote_token or len(quote_token) > 4096:
            raise ValueError("Invalid Aura QR quote token")
        if not isinstance(qr_payload, str) or not qr_payload or len(qr_payload) > 8192:
            raise ValueError("Invalid Aura QR payload")
        payload = await self.request(
            "POST", "/qr-payments",
            body={"customer_id": customer_id, "quote_token": quote_token,
                  "qr_payload": qr_payload},
            idempotency_key=idempotency_key,
        )
        return _qr_payment_result(payload, expected_customer_id=customer_id)

    async def get_qr_payment(self, payment_id):
        payment_id = _uuid(payment_id, "QR payment id")
        return _qr_payment_result(
            await self.request("GET", "/qr-payments/" + quote(payment_id, safe="")),
            expected_payment_id=payment_id,
        )

    async def list_withdrawals(self, *, status=None, cursor=None, limit=100):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura withdrawals limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura withdrawals limit")
        params = {"limit": limit}
        if status is not None:
            if status not in WITHDRAWAL_STATUSES:
                raise ValueError("Invalid Aura withdrawal status")
            params["status"] = status
        if cursor:
            params["cursor"] = str(cursor)
        payload = await self.request("GET", "/withdrawals", params=params)
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"}:
            raise ValueError("Invalid Aura withdrawal list")
        if not isinstance(payload["data"], list):
            raise ValueError("Invalid Aura withdrawal list data")
        if payload["next_cursor"] is not None and not isinstance(payload["next_cursor"], str):
            raise ValueError("Invalid Aura withdrawal cursor")
        return {
            "data": [_withdrawal_result(item) for item in payload["data"]],
            "next_cursor": payload["next_cursor"],
        }

    async def get_withdrawal(self, withdrawal_id):
        withdrawal_id = _uuid(withdrawal_id, "withdrawal id")
        payload = await self.request("GET", "/withdrawals/" + quote(withdrawal_id, safe=""))
        return _withdrawal_result(payload, withdrawal_id)

    async def create_withdrawal(self, amount, address, *, idempotency_key, note=None):
        amount = str(_decimal(amount))
        address = str(address)
        if not re.fullmatch(r"T[1-9A-HJ-NP-Za-km-z]{33}", address):
            raise ValueError("Invalid Aura withdrawal address")
        body = {"amount": amount, "address": address}
        if note is not None:
            note = str(note)
            if not 1 <= len(note) <= 140:
                raise ValueError("Invalid Aura withdrawal note")
            body["note"] = note
        payload = await self.request(
            "POST", "/withdrawals", body=body, idempotency_key=idempotency_key
        )
        return _withdrawal_result(payload)

    async def deposit_addresses(self, customer_id, *, cursor=None, limit=100):
        customer_id = _safe_identifier(customer_id, "customer id")
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura deposit address limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura deposit address limit")
        params = {"limit": limit}
        if cursor:
            params["cursor"] = str(cursor)
        payload = await self.request(
            "GET", "/customers/" + quote(customer_id, safe="") + "/deposit-addresses",
            params=params,
        )
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"}:
            raise ValueError("Invalid Aura deposit address list")
        if not isinstance(payload["data"], list) or not payload["data"]:
            raise ValueError("Aura returned no deposit address")
        if payload["next_cursor"] is not None and not isinstance(payload["next_cursor"], str):
            raise ValueError("Invalid Aura deposit address cursor")
        return {
            "data": [
                _deposit_address_result(
                    item, expected_customer_id=customer_id, environment=self.environment
                ) for item in payload["data"]
            ],
            "next_cursor": payload["next_cursor"],
        }

    async def create_deposit_address(self, customer_id, *, label=None):
        customer_id = _safe_identifier(customer_id, "customer id")
        body = {}
        if label is not None:
            label = str(label)
            if not 1 <= len(label) <= 64:
                raise ValueError("Invalid Aura deposit address label")
            body["label"] = label
        payload = await self.request(
            "POST", "/customers/" + quote(customer_id, safe="") + "/deposit-addresses",
            body=body,
        )
        return _deposit_address_result(
            payload, expected_customer_id=customer_id, environment=self.environment
        )

    async def get_deposit_address(self, address_id):
        address_id = _uuid(address_id, "deposit address id")
        payload = await self.request(
            "GET", "/deposit-addresses/" + quote(address_id, safe="")
        )
        return _deposit_address_result(
            payload, expected_address_id=address_id, environment=self.environment
        )

    async def list_deposits(self, *, cursor=None, limit=100, customer_id=None):
        params = {"limit": min(max(int(limit), 1), 100)}
        if cursor:
            params["cursor"] = str(cursor)
        if customer_id:
            params["customer_id"] = _safe_identifier(customer_id, "customer id")
        return await self.request("GET", "/deposits", params=params)

    async def get_deposit(self, deposit_id):
        deposit_id = quote(_safe_identifier(deposit_id, "deposit id"), safe="")
        return await self.request("GET", "/deposits/" + deposit_id)

    async def get_deposit_fees(self):
        return await self.request("GET", "/deposits-fees")

    async def get_balance(self):
        return await self.request("GET", "/balance")

    async def list_balance_history(self, *, operation_type=None, status=None,
                                   sort="created_at", order="desc", date_from=None,
                                   date_to=None, cursor=None, limit=100):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            raise ValueError("Invalid Aura balance history limit")
        if not 1 <= limit <= 100:
            raise ValueError("Invalid Aura balance history limit")
        if operation_type is not None and operation_type not in BALANCE_OPERATION_TYPES:
            raise ValueError("Invalid Aura balance operation type")
        if status is not None and status not in BALANCE_OPERATION_STATUSES:
            raise ValueError("Invalid Aura balance operation status")
        if sort not in {"created_at", "status"} or order not in {"asc", "desc"}:
            raise ValueError("Invalid Aura balance history ordering")
        params = {"limit": limit, "sort": sort, "order": order}
        if operation_type is not None:
            params["type"] = operation_type
        if status is not None:
            params["status"] = status
        if date_from is not None:
            _aura_datetime(date_from, "balance history from")
            params["from"] = date_from
        if date_to is not None:
            _aura_datetime(date_to, "balance history to")
            params["to"] = date_to
        if cursor:
            params["cursor"] = str(cursor)
        payload = await self.request("GET", "/balance/history", params=params)
        if not isinstance(payload, dict) or set(payload) != {"data", "next_cursor"}:
            raise ValueError("Invalid Aura balance history")
        if not isinstance(payload["data"], list):
            raise ValueError("Invalid Aura balance history data")
        if payload["next_cursor"] is not None and not isinstance(payload["next_cursor"], str):
            raise ValueError("Invalid Aura balance history cursor")
        return {
            "data": [_balance_history_entry(item) for item in payload["data"]],
            "next_cursor": payload["next_cursor"],
        }

    async def get_balance_operation(self, operation_id):
        operation_id = _uuid(operation_id, "balance operation id")
        payload = await self.request(
            "GET", "/balance/history/" + quote(operation_id, safe="")
        )
        return _balance_history_entry(payload, operation_id)

    async def close(self):
        if self.session is not None and self._owns_session:
            await self.session.close()
        self.session = None


def _list_data(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("Invalid Aura list")
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(payload.get("items"), list):
        return payload["items"]
    raise ValueError("Invalid Aura list")


class AuraService:
    def __init__(self, ledger, client, environment):
        self.ledger, self.client, self.environment = ledger, client, environment

    async def ensure_customer(self, uid, client_ref, email=None, phone=None):
        row = self.ledger.db.execute("SELECT * FROM aura_customers WHERE user_id=?", (uid,)).fetchone()
        customer_id = row["customer_id"] if row else client_ref
        if row and row["environment"] != self.environment:
            raise ValueError("Aura customer environment mismatch")
        if row and email is None and phone is None:
            return customer_id
        if email is not None:
            if not isinstance(email, str) or not email.strip():
                raise ValueError("Invalid customer email")
            email = email.strip()
        if phone is not None:
            if not isinstance(phone, str) or not phone.strip():
                raise ValueError("Invalid customer phone")
            phone = phone.strip()
        result = await self.client.upsert_customer(customer_id, email=email, phone=phone)
        provider_id = str(result.get("id") or result.get("customer_id") or customer_id)
        if provider_id != customer_id:
            raise ValueError("Aura customer identity mismatch")
        stamp = time.time()
        digest = lambda value: hashlib.sha256(str(value).encode()).hexdigest() if value else None
        self.ledger.db.execute("SAVEPOINT aura_profile_save")
        try:
            self.ledger.db.execute(
                "INSERT INTO aura_customers VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,email_hash=COALESCE(excluded.email_hash,aura_customers.email_hash),"
                "phone_hash=COALESCE(excluded.phone_hash,aura_customers.phone_hash),provider_updated_at=excluded.provider_updated_at,updated_at=excluded.updated_at",
                (uid, customer_id, self.environment, str(result.get("status") or "registered"),
                 digest(email), digest(phone), result.get("updated_at"), stamp, stamp),
            )
            if email is not None or phone is not None:
                self.ledger.db.execute(
                    "INSERT INTO wallet_profile_contacts VALUES (?,?,?,?,?) "
                    "ON CONFLICT(user_id,environment) DO UPDATE SET "
                    "email=COALESCE(excluded.email,wallet_profile_contacts.email),"
                    "phone=COALESCE(excluded.phone,wallet_profile_contacts.phone),updated_at=excluded.updated_at",
                    (uid, self.environment, email, phone, stamp),
                )
        except Exception:
            self.ledger.db.execute("ROLLBACK TO aura_profile_save")
            self.ledger.db.execute("RELEASE aura_profile_save")
            raise
        self.ledger.db.execute("RELEASE aura_profile_save")
        return customer_id

    def saved_contacts(self, uid):
        row = self.ledger.db.execute(
            "SELECT email,phone FROM wallet_profile_contacts WHERE user_id=? AND environment=?",
            (uid, self.environment),
        ).fetchone()
        return dict(row) if row else None

    def _store_kyc(self, uid, customer_id, payload):
        if not isinstance(payload, dict):
            raise ValueError("Invalid Aura KYC state")
        status = str(payload.get("status") or payload.get("state") or (
            "verified" if payload.get("verified") is True else "pending"
        ))[:100]
        verified = payload.get("verified") is True or status == "verified"
        terminal = payload.get("terminal") is True
        reason = payload.get("reason")
        if reason is None and isinstance(payload.get("details"), dict):
            reason = payload["details"].get("reason")
        reason = str(reason)[:500] if reason is not None else None
        updated = payload.get("updated_at") or payload.get("provider_updated_at")
        safe_body = {
            "status": status, "verified": verified, "terminal": terminal,
            "reason": reason, "updated_at": updated,
        }
        stamp = time.time()
        current = self.ledger.db.execute(
            "SELECT provider_updated_at FROM aura_kyc_cases WHERE user_id=?", (uid,)
        ).fetchone()
        if current and updated and current[0] and str(updated) <= str(current[0]):
            return self.kyc_state(uid)
        self.ledger.db.execute(
            "INSERT INTO aura_kyc_cases VALUES (?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,"
            "verified=excluded.verified,terminal=excluded.terminal,reason=excluded.reason,"
            "provider_updated_at=excluded.provider_updated_at,body=excluded.body,"
            "updated_at=excluded.updated_at",
            (uid, customer_id, self.environment, status, int(verified), int(terminal),
             reason, updated, json.dumps(safe_body, separators=(",", ":")), stamp, stamp),
        )
        title = "Верификация пройдена" if verified else "Верификация обновлена"
        message = (
            "Личность подтверждена. Теперь доступны функции, требующие KYC."
            if verified else
            ("Проверка отклонена. Откройте WPay, чтобы посмотреть статус и повторить действие."
             if terminal else "Документы приняты, проверка продолжается.")
        )
        enqueue_notification(
            self.ledger, f"aura:kyc:{customer_id}:{updated or status}:{status}",
            uid, "kyc", title, message,
        )
        return safe_body

    def kyc_state(self, uid):
        row = self.ledger.db.execute(
            "SELECT status,verified,terminal,reason,provider_updated_at "
            "FROM aura_kyc_cases WHERE user_id=?", (uid,)
        ).fetchone()
        if not row:
            return None
        return {
            "status": row["status"], "verified": bool(row["verified"]),
            "terminal": bool(row["terminal"]), "reason": row["reason"],
            "updated_at": row["provider_updated_at"],
        }

    async def get_kyc(self, uid, client_ref):
        row = self.ledger.db.execute("SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?", (uid, self.environment)).fetchone()
        if not row:
            return {"status": "not_started", "verified": False, "terminal": False, "reason": None}
        customer_id = row["customer_id"]
        return self._store_kyc(uid, customer_id, await self.client.get_kyc(customer_id))

    async def notification_otp(self, notice):
        event_key = notice["source_key"].removesuffix(":notice")
        row = self.ledger.db.execute(
            "SELECT raw_body FROM wallet_webhook_inbox "
            "WHERE event_key=? AND provider='aura' AND update_type='card.otp' AND signature_valid=1",
            (event_key,),
        ).fetchone()
        if not row:
            return None
        data = json.loads(row["raw_body"])["data"]
        otp_id = data.get("id")
        if not otp_id or _aura_datetime(data.get("expires_at"), "OTP expiry").timestamp() <= time.time():
            return None
        card_id = data["card_id"]
        owned = self.ledger.db.execute(
            "SELECT 1 FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?",
            (card_id, notice["user_id"], self.environment),
        ).fetchone()
        if not owned:
            return None
        otp = await self.client.get_latest_card_otp(card_id)
        if (
            otp and otp["id"] == otp_id and otp["consumed_at"] is None
            and _aura_datetime(otp["expires_at"], "OTP expiry").timestamp() > time.time()
        ):
            return otp["code"]
        return None

    async def start_kyc(self, uid, client_ref, *, email=None, phone=None):
        customer_id = await self.ensure_customer(
            uid, client_ref, email=email, phone=phone
        )
        result = await self.client.start_kyc(customer_id)
        state = self._store_kyc(uid, customer_id, result)
        session_url = result.get("kyc_url") or result.get("url") or result.get("session_url") or result.get("verification_url")
        if session_url is not None:
            session_url = str(session_url)
            if not session_url.startswith("https://") or len(session_url) > 2048:
                raise ValueError("Invalid Aura KYC session URL")
        return {**state, "session_url": session_url}

    async def submit_identity(self, uid, customer_id, identity):
        row = self.ledger.db.execute(
            "SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?",
            (uid, self.environment),
        ).fetchone()
        if not row or row["customer_id"] != customer_id:
            raise ValueError("Unknown Aura customer identity owner")
        result = await self.client.submit_customer_identity(customer_id, identity)
        return self._store_kyc(uid, customer_id, result)

    def _store_sbp_api_order(self, uid, item):
        customer = self.ledger.db.execute(
            "SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?",
            (uid, self.environment),
        ).fetchone()
        if not customer or item["customer_id"] != customer["customer_id"]:
            raise ValueError("Aura SBP order owner mismatch")
        safe = dict(item)
        safe["qr_png_base64"] = None
        _store_sbp_order(
            self.ledger, self.environment, "order." + item["status"],
            {**safe, "order_id": item["id"], "rub_amount": item["fiat_amount"],
             "usdt_amount": item["crypto_amount"], "fee": item["provider_fee"],
             "updated_at": item.get("completed_at") or item["created_at"]},
        )
        return item

    async def create_sbp_quote(self, uid, client_ref, fiat_amount):
        customer_id = await self.ensure_customer(uid, client_ref)
        return await self.client.create_sbp_quote(customer_id, fiat_amount)

    async def create_sbp_order(self, uid, client_ref, quote_token, *, idempotency_key):
        customer_id = await self.ensure_customer(uid, client_ref)
        idempotency_key = str(idempotency_key)
        request_body = {
            "customer_id": customer_id, "quote_token_hash": _secret_hash(quote_token),
        }
        existing = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='sbp_order' AND local_id=?",
            (self.environment, idempotency_key),
        ).fetchone()
        if existing:
            if json.loads(existing["request_body"]) != request_body:
                raise ValueError("Aura idempotency key reused with another SBP order")
            if existing["status"] == "rejected":
                raise self.client.error_cls(
                    "sbp_order_rejected",
                    "The original Aura order was rejected; use a new idempotency key", 409,
                )
        else:
            stamp = time.time()
            self.ledger.db.execute(
                "INSERT INTO wallet_provider_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                ("aura", self.environment, "sbp_order", idempotency_key, None,
                 uid, "submitting", idempotency_key,
                 json.dumps(request_body, sort_keys=True, separators=(",", ":")),
                 None, stamp, stamp),
            )
        try:
            item = await self.client.create_sbp_order(
                customer_id, quote_token, idempotency_key=idempotency_key
            )
        except Exception as error:
            if getattr(error, "retry_policy", None) in {"no", "after_fix"}:
                self.ledger.db.execute(
                    "UPDATE wallet_provider_entities SET status='rejected',updated_at=? "
                    "WHERE provider='aura' AND environment=? AND entity_type='sbp_order' "
                    "AND local_id=?", (time.time(), self.environment, idempotency_key),
                )
            raise
        item = self._store_sbp_api_order(uid, item)
        self.ledger.db.execute(
            "UPDATE wallet_provider_entities SET remote_id=?,status=?,updated_at=? "
            "WHERE provider='aura' AND environment=? AND entity_type='sbp_order' "
            "AND local_id=?",
            (item["id"],
             item["status"] if item["status"] == "awaiting_payment" else "submitted",
             time.time(), self.environment, idempotency_key),
        )
        _settle_sbp_order(self.ledger, self.environment, item["id"], item["status"])
        return item

    async def get_sbp_order(self, uid, order_id):
        row = self.ledger.db.execute(
            "SELECT 1 FROM aura_sbp_orders WHERE order_id=? AND user_id=? AND environment=?",
            (order_id, uid, self.environment),
        ).fetchone()
        if not row:
            raise self.client.error_cls("not_found", "Order not found", 404)
        return self._store_sbp_api_order(uid, await self.client.get_sbp_order(order_id))

    async def cancel_sbp_order(self, uid, order_id):
        row = self.ledger.db.execute(
            "SELECT 1 FROM aura_sbp_orders WHERE order_id=? AND user_id=? AND environment=?",
            (order_id, uid, self.environment),
        ).fetchone()
        if not row:
            raise self.client.error_cls("not_found", "Order not found", 404)
        return self._store_sbp_api_order(uid, await self.client.cancel_sbp_order(order_id))

    def _store_qr_api_payment(self, uid, item):
        customer = self.ledger.db.execute(
            "SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?",
            (uid, self.environment),
        ).fetchone()
        if not customer or item["customer_id"] != customer["customer_id"]:
            raise ValueError("Aura QR payment owner mismatch")
        _store_qr_payment(
            self.ledger, self.environment, "qr_payment." + item["status"],
            {**item, "payment_id": item["id"],
             "updated_at": item.get("refunded_at") or item.get("failed_at")
             or item.get("completed_at") or item["created_at"]},
        )
        return item

    async def create_qr_quote(self, uid, client_ref, qr_payload):
        customer_id = await self.ensure_customer(uid, client_ref)
        item = await self.client.create_qr_quote(qr_payload, customer_id=customer_id)
        token_hash = _secret_hash(item["quote_token"])
        safe = {
            "customer_id": customer_id, "quote_token_hash": token_hash,
            "qr_payload_hash": _secret_hash(qr_payload),
            "total_usdt": item["total_usdt"], "expires_at": item["expires_at"],
        }
        stamp = time.time()
        self.ledger.db.execute(
            "INSERT INTO wallet_provider_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(provider,environment,entity_type,local_id) DO UPDATE SET "
            "user_id=excluded.user_id,status=excluded.status,request_body=excluded.request_body,"
            "updated_at=excluded.updated_at",
            ("aura", self.environment, "qr_quote", token_hash, None, uid, "quoted",
             None, json.dumps(safe, sort_keys=True, separators=(",", ":")),
             None, stamp, stamp),
        )
        return item

    async def create_qr_payment(self, uid, client_ref, quote_token, qr_payload,
                                *, idempotency_key):
        customer_id = await self.ensure_customer(uid, client_ref)
        idempotency_key = str(idempotency_key)
        token_hash, payload_hash = _secret_hash(quote_token), _secret_hash(qr_payload)
        quote_row = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='qr_quote' AND local_id=? AND user_id=?",
            (self.environment, token_hash, uid),
        ).fetchone()
        if not quote_row:
            raise self.client.error_cls("quote_expired", "Aura QR quote not found", 409)
        quote_body = json.loads(quote_row["request_body"])
        if (quote_body.get("customer_id") != customer_id
                or quote_body.get("qr_payload_hash") != payload_hash):
            raise ValueError("Aura QR quote owner or payload mismatch")
        expiry = datetime.fromisoformat(quote_body["expires_at"].replace("Z", "+00:00"))
        prior = self.ledger.db.execute(
            "SELECT 1 FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='qr_payment' AND local_id=?",
            (self.environment, idempotency_key),
        ).fetchone()
        if expiry <= datetime.now(timezone.utc) and not prior:
            raise self.client.error_cls("quote_expired", "Aura QR quote expired", 409)
        reserve_amount = _decimal(quote_body["total_usdt"])
        request_body = {
            "customer_id": customer_id, "quote_token_hash": token_hash,
            "qr_payload_hash": payload_hash, "reserve_amount": str(reserve_amount),
            "held_amount": str(reserve_amount),
        }
        existing = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='qr_payment' AND local_id=?",
            (self.environment, idempotency_key),
        ).fetchone()
        if existing:
            stored = json.loads(existing["request_body"])
            immutable = {key: request_body[key] for key in (
                "customer_id", "quote_token_hash", "qr_payload_hash", "reserve_amount"
            )}
            if {key: stored.get(key) for key in immutable} != immutable:
                raise ValueError("Aura idempotency key reused with another QR payment")
            if existing["status"] == "rejected":
                raise self.client.error_cls(
                    "qr_payment_rejected",
                    "The original Aura QR payment was rejected; use a new idempotency key", 409,
                )
        else:
            debt_row = self.ledger.db.execute(
                "SELECT amount FROM wallet_debts WHERE user_id=? AND asset='USDT'", (uid,)
            ).fetchone()
            if debt_row and Decimal(debt_row[0]) > 0:
                raise self.client.error_cls(
                    "insufficient_funds", "Outstanding wallet debt must be repaid first", 409
                )
            available, reserved = self.ledger.balance(uid, "USDT")
            self.ledger.begin("aura_qr_reserve", uid, idempotency_key)
            try:
                self.ledger.put_balance(
                    uid, "USDT", available - reserve_amount, reserved + reserve_amount
                )
                # Aura removes the money from its available pooled balance when the
                # payment is created. Keep the user hold in wallet.reserved, but do
                # not count it as provider-backed available capital.
                _position_adjust(
                    self.ledger, self.environment, uid, "USDT", -reserve_amount, Decimal(0)
                )
                stamp = time.time()
                self.ledger.db.execute(
                    "INSERT INTO wallet_provider_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("aura", self.environment, "qr_payment", idempotency_key, None,
                     uid, "reserved", idempotency_key,
                     json.dumps(request_body, sort_keys=True, separators=(",", ":")),
                     None, stamp, stamp),
                )
                self.ledger.commit()
            except Exception:
                self.ledger.rollback()
                raise
        try:
            item = await self.client.create_qr_payment(
                customer_id, quote_token, qr_payload, idempotency_key=idempotency_key
            )
        except Exception as error:
            if getattr(error, "retry_policy", None) in {"no", "after_fix"}:
                _release_qr_reserve(
                    self.ledger, self.environment, idempotency_key, "rejected"
                )
            raise
        item = self._store_qr_api_payment(uid, item)
        charged = _decimal(item["total_usdt"])
        if charged > reserve_amount:
            self.ledger.db.execute(
                "UPDATE wallet_provider_entities SET remote_id=?,status='needs_reconciliation',"
                "updated_at=? WHERE provider='aura' AND environment=? "
                "AND entity_type='qr_payment' AND local_id=?",
                (item["id"], time.time(), self.environment, idempotency_key),
            )
            raise self.client.error_cls(
                "qr_settlement_exceeded_reserve",
                "Aura QR payment exceeded the reserved amount; reconciliation is required", 502,
            )
        self.ledger.begin("aura_qr_submitted", uid, idempotency_key)
        try:
            current = self.ledger.db.execute(
                "SELECT request_body,status FROM wallet_provider_entities WHERE provider='aura' "
                "AND environment=? AND entity_type='qr_payment' AND local_id=?",
                (self.environment, idempotency_key),
            ).fetchone()
            stored = json.loads(current["request_body"])
            held = _decimal(stored["held_amount"], allow_zero=True)
            if current["status"] in {"reserved", "submitting"}:
                release = held - charged
                available, reserved = self.ledger.balance(uid, "USDT")
                self.ledger.put_balance(
                    uid, "USDT", available + release, reserved - held + charged
                )
                _position_adjust(
                    self.ledger, self.environment, uid, "USDT", release, Decimal(0)
                )
                stored["held_amount"] = str(charged)
            self.ledger.db.execute(
                "UPDATE wallet_provider_entities SET remote_id=?,status=?,request_body=?,updated_at=? "
                "WHERE provider='aura' AND environment=? AND entity_type='qr_payment' "
                "AND local_id=?",
                (item["id"],
                 item["status"] if item["status"] in {"processing", "unspecified"}
                 else "processing",
                 json.dumps(stored, sort_keys=True, separators=(",", ":")),
                 time.time(), self.environment, idempotency_key),
            )
            _settle_qr_payment(
                self.ledger, self.environment, item["id"], item["status"]
            )
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        return item

    async def get_qr_payment(self, uid, payment_id):
        row = self.ledger.db.execute(
            "SELECT 1 FROM aura_qr_payments WHERE payment_id=? AND user_id=? AND environment=?",
            (payment_id, uid, self.environment),
        ).fetchone()
        if not row:
            raise self.client.error_cls("not_found", "QR payment not found", 404)
        return self._store_qr_api_payment(uid, await self.client.get_qr_payment(payment_id))

    def require_card_funds(self, uid, amount):
        row=self.ledger.db.execute("SELECT available FROM wallet_provider_positions WHERE provider='aura' AND environment=? AND user_id=? AND asset='USDT'",(self.environment,uid)).fetchone()
        backed=Decimal(row['available']) if row else Decimal(0)
        if backed < amount:
            raise self.client.error_cls('AURA_FUNDS_UNAVAILABLE','Для оплаты карты недостаточно средств, подтверждённых в Aura. Пополнение общего баланса вручную не пополняет этот остаток.',409)

    async def create_card_request(self, uid, client_ref, *, kind="virtual",
                                  idempotency_key, shipping_address=None, plan_id=None, price_guard=None):
        customer_id = await self.ensure_customer(uid, client_ref)
        idempotency_key = str(idempotency_key)
        request_fields = _card_request_body(customer_id, kind, shipping_address)
        kind = request_fields["kind"]
        plan_id, _plan = resolve_card_plan(plan_id, kind)
        shipping_address = request_fields.get("shipping_address")
        existing = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='card_request' AND local_id=?",
            (self.environment, idempotency_key),
        ).fetchone()
        if existing:
            stored = json.loads(existing["request_body"])
            comparable = {key: value for key, value in stored.items() if key not in {
                "fee", "provider_fee", "service_fee", "tariff_version", "plan_id"
            }}
            if comparable != request_fields:
                raise ValueError("Aura idempotency key reused with another card request")
            if stored.get("plan_id", plan_id) != plan_id:
                raise ValueError("Aura idempotency key reused with another card tariff")
            if existing["remote_id"]:
                return {"card_id": existing["remote_id"], "status": existing["status"]}
            if existing["status"] == "rejected":
                raise self.client.error_cls(
                    "card_request_rejected",
                    "The original Aura card request was rejected; use a new idempotency key",
                    409,
                )
            fee = _decimal(stored["fee"])
        else:
            fees = await self.client.get_card_fees()
            if not isinstance(fees, dict) or fees.get("currency") != "USDT":
                raise ValueError("Invalid Aura card fees")
            fee_field = "open_physical_card_fee" if kind == "physical" else "open_virtual_card_fee"
            if fees.get(fee_field) in {None, ""}:
                raise self.client.error_cls(
                    "card_kind_unavailable", "Aura card kind is unavailable", 412
                )
            provider_fee = _decimal(fees[fee_field])
            service_fee, tariff = calculate_tariff(
                self.ledger, plan_id, provider_fee, operation="issue",
            )
            fee = provider_fee + service_fee
            if price_guard: price_guard(fee, tariff.get("version_id"))
            self.ledger.begin("aura_card_reserve", uid, idempotency_key)
            try:
                self.require_card_funds(uid, fee)
                available, reserved = self.ledger.balance(uid, "USDT")
                self.ledger.put_balance(uid, "USDT", available - fee, reserved + fee)
                _position_adjust(
                    self.ledger, self.environment, uid, "USDT", -fee, fee
                )
                stamp = time.time()
                stored_body = {
                    **request_fields, "fee": str(fee),
                    "provider_fee": str(provider_fee), "service_fee": str(service_fee),
                    "tariff_version": tariff.get("version_id"), "plan_id": plan_id,
                }
                self.ledger.db.execute(
                    "INSERT INTO wallet_provider_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("aura", self.environment, "card_request", idempotency_key, None,
                     uid, "reserved", idempotency_key,
                     json.dumps(stored_body, sort_keys=True, separators=(",", ":")),
                     None, stamp, stamp),
                )
                self.ledger.commit()
            except Exception:
                self.ledger.rollback()
                raise
        try:
            result = await self.client.create_card(
                customer_id, kind=kind, idempotency_key=idempotency_key,
                shipping_address=shipping_address,
            )
        except Exception as error:
            if getattr(error, "retry_policy", None) in {"no", "after_fix"}:
                self.ledger.begin("aura_card_release", uid, idempotency_key)
                try:
                    available, reserved = self.ledger.balance(uid, "USDT")
                    self.ledger.put_balance(uid, "USDT", available + fee, reserved - fee)
                    _position_adjust(
                        self.ledger, self.environment, uid, "USDT", fee, -fee
                    )
                    self.ledger.db.execute(
                        "UPDATE wallet_provider_entities SET status='rejected',updated_at=? "
                        "WHERE provider='aura' AND environment=? AND entity_type='card_request' "
                        "AND local_id=?", (time.time(), self.environment, idempotency_key),
                    )
                    self.ledger.commit()
                except Exception:
                    self.ledger.rollback()
                    raise
            raise
        if not isinstance(result, dict) or set(result) != {"card_id"}:
            raise ValueError("Invalid Aura card creation response")
        card_id = _safe_identifier(result["card_id"], "card id")
        self.ledger.begin("aura_card_submitted", uid, idempotency_key)
        try:
            available, reserved = self.ledger.balance(uid, "USDT")
            self.ledger.put_balance(uid, "USDT", available, reserved - fee)
            _position_adjust(
                self.ledger, self.environment, uid, "USDT", Decimal(0), -fee
            )
            _store_card_event(
                self.ledger, self.environment, "card.requested",
                {"card_id": card_id, "owner_id": customer_id, "kind": kind,
                 "status": "processing"},
            )
            self.ledger.db.execute(
                "UPDATE aura_cards SET plan_id=? WHERE card_id=? AND user_id=? AND environment=?",
                (plan_id, card_id, uid, self.environment),
            )
            self.ledger.db.execute(
                "UPDATE wallet_provider_entities SET remote_id=?,status='processing',updated_at=? "
                "WHERE provider='aura' AND environment=? AND entity_type='card_request' "
                "AND local_id=?", (card_id, time.time(), self.environment, idempotency_key),
            )
            record_card_issue_history(self.ledger,self.environment,idempotency_key)
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        return {"card_id": card_id, "status": "processing"}

    async def recharge_card_request(self, uid, card_id, *, idempotency_key,
                                    amount=None, amount_spend=None, price_guard=None):
        card_id = _safe_identifier(card_id, "card id")
        idempotency_key = str(idempotency_key)
        request_fields = _card_recharge_body(amount, amount_spend)
        card = self.ledger.db.execute(
            "SELECT kind,frozen,plan_id FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?",
            (card_id, uid, self.environment),
        ).fetchone()
        if not card:
            raise self.client.error_cls("card_not_found", "Card not found", 404)
        existing = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
            "AND entity_type='card_recharge' AND local_id=?",
            (self.environment, idempotency_key),
        ).fetchone()
        if existing:
            stored = json.loads(existing["request_body"])
            if stored.get("request") != request_fields or stored.get("card_id") != card_id:
                raise ValueError("Aura idempotency key reused with another card recharge")
            if stored.get("result"):
                result = dict(stored["result"])
                if existing["status"] in {"completed", "failed"}:
                    result["status"] = existing["status"]
                return result
            if existing["status"] == "rejected":
                raise self.client.error_cls(
                    "card_recharge_rejected",
                    "The original Aura recharge was rejected; use a new idempotency key",
                    409,
                )
            reserve_amount = _decimal(stored["reserve_amount"])
            service_fee = _decimal(stored.get("service_fee", "0"), allow_zero=True)
        else:
            if bool(card["frozen"]):
                raise self.client.error_cls(
                    "card_frozen", "Frozen Aura card cannot be recharged", 409
                )
            tariff_base = _decimal(request_fields.get("amount_spend") or request_fields.get("amount"))
            plan_id, _plan = resolve_card_plan(card["plan_id"], card["kind"])
            service_fee, tariff = calculate_tariff(
                self.ledger, plan_id, tariff_base, operation="recharge",
            )
            if "amount_spend" in request_fields:
                reserve_amount = _decimal(request_fields["amount_spend"])
            else:
                fees = await self.client.get_card_fees()
                if not isinstance(fees, dict) or fees.get("currency") != "USDT":
                    raise ValueError("Invalid Aura card fees")
                recharge_amount = _decimal(request_fields["amount"])
                minimum = _decimal(fees.get("minimum_recharge_amount"))
                if recharge_amount < minimum:
                    raise self.client.error_cls(
                        "amount_out_of_range", "Recharge amount is below Aura minimum", 400
                    )
                pct_field = "physical_recharge_fee_pct" if card["kind"] == "physical" else "recharge_fee_pct"
                if fees.get(pct_field) in {None, ""}:
                    raise self.client.error_cls(
                        "card_kind_unavailable", "Aura card kind is unavailable", 412
                    )
                fee_pct = _decimal(fees[pct_field], allow_zero=True)
                with localcontext() as ctx:
                    ctx.prec = 80
                    reserve_amount = recharge_amount + recharge_amount * fee_pct / Decimal(100)
                    # Aura says the percentage is an estimate. Keep a small six-decimal
                    # settlement cushion and release it as soon as the exact response arrives.
                    reserve_amount += Decimal("0.01")
            reserve_amount += service_fee
            if price_guard: price_guard(reserve_amount, tariff.get("version_id"))
            self.ledger.begin("aura_card_recharge_reserve", uid, idempotency_key)
            try:
                self.require_card_funds(uid, reserve_amount)
                available, reserved = self.ledger.balance(uid, "USDT")
                self.ledger.put_balance(
                    uid, "USDT", available - reserve_amount, reserved + reserve_amount
                )
                _position_adjust(
                    self.ledger, self.environment, uid, "USDT", -reserve_amount, reserve_amount
                )
                stamp = time.time()
                stored = {
                    "card_id": card_id, "request": request_fields,
                    "reserve_amount": str(reserve_amount),
                    "service_fee": str(service_fee),
                    "tariff_version": tariff.get("version_id"), "plan_id": plan_id,
                }
                self.ledger.db.execute(
                    "INSERT INTO wallet_provider_entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("aura", self.environment, "card_recharge", idempotency_key, None,
                     uid, "reserved", idempotency_key,
                     json.dumps(stored, sort_keys=True, separators=(",", ":")),
                     None, stamp, stamp),
                )
                self.ledger.commit()
            except Exception:
                self.ledger.rollback()
                raise
        try:
            raw_result = await self.client.recharge_card(
                card_id, idempotency_key=idempotency_key,
                amount=request_fields.get("amount"),
                amount_spend=request_fields.get("amount_spend"),
            )
        except Exception as error:
            if getattr(error, "retry_policy", None) in {"no", "after_fix"}:
                self.ledger.begin("aura_card_recharge_release", uid, idempotency_key)
                try:
                    available, reserved = self.ledger.balance(uid, "USDT")
                    self.ledger.put_balance(
                        uid, "USDT", available + reserve_amount, reserved - reserve_amount
                    )
                    _position_adjust(
                        self.ledger, self.environment, uid, "USDT", reserve_amount, -reserve_amount
                    )
                    self.ledger.db.execute(
                        "UPDATE wallet_provider_entities SET status='rejected',updated_at=? "
                        "WHERE provider='aura' AND environment=? AND entity_type='card_recharge' "
                        "AND local_id=?",
                        (time.time(), self.environment, idempotency_key),
                    )
                    self.ledger.commit()
                except Exception:
                    self.ledger.rollback()
                    raise
            raise
        result = _card_recharge_result(raw_result, request_fields)
        provider_charged = _decimal(result["charged_amount"])
        charged = provider_charged + service_fee
        result["provider_charged_amount"] = str(provider_charged)
        result["service_fee"] = str(service_fee)
        result["charged_amount"] = str(charged)
        if charged > reserve_amount:
            stored["result"] = result
            self.ledger.db.execute(
                "UPDATE wallet_provider_entities SET remote_id=?,status='needs_reconciliation',"
                "request_body=?,updated_at=? WHERE provider='aura' AND environment=? "
                "AND entity_type='card_recharge' AND local_id=?",
                (result["operation_id"], json.dumps(stored, sort_keys=True, separators=(",", ":")),
                 time.time(), self.environment, idempotency_key),
            )
            raise self.client.error_cls(
                "recharge_settlement_exceeded_reserve",
                "Aura charged more than the reserved recharge amount; reconciliation is required",
                502,
            )
        self.ledger.begin("aura_card_recharge_settle", uid, idempotency_key)
        try:
            available, reserved = self.ledger.balance(uid, "USDT")
            status = result["status"]
            if status == "failed":
                release = reserve_amount
                held = Decimal(0)
            else:
                release = reserve_amount - charged
                held = charged if status in {"requested", "sent"} else Decimal(0)
            self.ledger.put_balance(
                uid, "USDT", available + release, reserved - reserve_amount + held
            )
            _position_adjust(
                self.ledger, self.environment, uid, "USDT", release,
                -reserve_amount + held,
            )
            stored["result"] = result
            stored["held_amount"] = str(held)
            self.ledger.db.execute(
                "UPDATE wallet_provider_entities SET remote_id=?,status=?,request_body=?,updated_at=? "
                "WHERE provider='aura' AND environment=? AND entity_type='card_recharge' "
                "AND local_id=?",
                (result["operation_id"], status,
                 json.dumps(stored, sort_keys=True, separators=(",", ":")),
                 time.time(), self.environment, idempotency_key),
            )
            if status in {"requested", "sent"}:
                already_delivered = self.ledger.db.execute(
                    "SELECT status FROM aura_card_operations WHERE operation_id=? AND environment=?",
                    (result["operation_id"], self.environment),
                ).fetchone()
                if already_delivered:
                    _settle_card_recharge(
                        self.ledger, self.environment, result["operation_id"],
                        already_delivered["status"],
                    )
            record_card_recharge_history(self.ledger,self.environment,idempotency_key)
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        return result

    async def get_or_create_deposit_address(self, uid, client_ref):
        customer_id = await self.ensure_customer(uid, client_ref)
        payload = await self.client.deposit_addresses(customer_id)
        rows = _list_data(payload)
        if not rows:
            raise ValueError("Aura returned no deposit address")
        stamp = time.time()
        selected = None
        for item in rows:
            if not isinstance(item, dict):
                raise ValueError("Invalid Aura deposit address")
            address_id = _safe_identifier(item.get("id") or item.get("address_id"), "address id")
            address = str(item.get("address") or "")
            network = str(item.get("network") or "")
            if not address or len(address) > 200 or network not in {"nile", "mainnet"}:
                raise ValueError("Invalid Aura deposit address")
            if (self.environment == "test" and network != "nile") or (self.environment == "live" and network != "mainnet"):
                raise ValueError("Aura address network mismatch")
            self.ledger.db.execute(
                "INSERT INTO aura_deposit_addresses VALUES (?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(address_id) DO UPDATE SET label=excluded.label,is_default=excluded.is_default,"
                "body=excluded.body,updated_at=excluded.updated_at",
                (address_id, uid, customer_id, self.environment, network, address,
                 item.get("label"), int(bool(item.get("is_default"))),
                 json.dumps(item, separators=(",", ":"), ensure_ascii=False), stamp, stamp),
            )
            if selected is None or item.get("is_default"):
                selected = item
        return {
            "provider": "aura", "asset": "USDT", "network": "TRON",
            "chain": selected.get("network"), "address": selected.get("address"),
            "address_id": selected.get("id") or selected.get("address_id"),
            "customer_id": customer_id,
        }

    def _store_deposit_address(self, uid, customer_id, item):
        item = _deposit_address_result(
            item, expected_customer_id=customer_id, environment=self.environment
        )
        stamp = time.time()
        self.ledger.db.execute(
            "INSERT INTO aura_deposit_addresses VALUES (?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(address_id) DO UPDATE SET label=excluded.label,"
            "is_default=excluded.is_default,body=excluded.body,updated_at=excluded.updated_at",
            (item["id"], uid, customer_id, self.environment, item["network"],
             item["address"], item["label"], int(item["is_default"]),
             json.dumps(item, separators=(",", ":"), ensure_ascii=False), stamp, stamp),
        )
        return item

    async def create_additional_deposit_address(self, uid, client_ref, *, label=None):
        customer_id = await self.ensure_customer(uid, client_ref)
        item = await self.client.create_deposit_address(customer_id, label=label)
        return self._store_deposit_address(uid, customer_id, item)


def verify_signature(secret, raw, header, now_seconds=None, tolerance=300):
    if not secret or not header:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        if key == "t" and value.isdigit():
            timestamp = value
        elif key == "v1" and re.fullmatch(r"[0-9a-f]{64}", value):
            signatures.append(value)
    if timestamp is None:
        return False
    now_seconds = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now_seconds - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


def store_webhook(ledger, raw, signature, headers, secret, partner_id=None):
    failures = [] if verify_signature(secret, raw, signature) else ["hmac_or_timestamp_window"]
    try:
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise ValueError("Invalid Aura envelope")
        kind = _safe_identifier(event.get("event"), "event type")
        is_test = kind == "webhook.test"
        if not is_test and not isinstance(event.get("data"), dict):
            raise ValueError("Invalid Aura envelope")
        # The portal's signed test delivery uses a small camelCase envelope,
        # while normal API events use the documented snake_case envelope.
        # Keep the compatibility exception deliberately limited to webhook.test.
        event_id = _safe_identifier(
            event.get("event_id") or (event.get("eventId") if is_test else None),
            "event id",
        )
        if headers.get("X-Aura-Event-Id") not in {None, "", event_id}:
            failures.append("event_id_header")
        if headers.get("X-Aura-Event") not in {None, "", kind}:
            failures.append("event_type_header")
        signature_timestamp = next(
            (part.strip().partition("=")[2] for part in signature.split(",")
             if part.strip().startswith("t=")), None
        )
        header_timestamp = headers.get("X-Aura-Timestamp")
        if header_timestamp not in {None, ""} and str(header_timestamp) != signature_timestamp:
            failures.append("timestamp_header")
        attempt = headers.get("X-Aura-Attempt")
        if attempt not in {None, ""} and (not str(attempt).isdigit() or int(attempt) < 1):
            failures.append("attempt_header")
        event_partner_id = event.get("partner_id")
        if is_test and event_partner_id is None:
            event_partner_id = event.get("partnerId")
        if partner_id and str(event_partner_id) != partner_id:
            failures.append("partner_id")
        stored_event = event
        if kind == "card.otp":
            data = event.get("data") or {}
            stored_event = {
                **event,
                "data": {
                    "card_id": data.get("card_id"),
                    "id": data.get("id"),
                    "expires_at": data.get("expires_at"),
                    "redacted": True,
                    "sensitive_payload_sha256": hashlib.sha256(raw).hexdigest(),
                },
            }
        stored_raw = json.dumps(
            stored_event, separators=(",", ":"), ensure_ascii=False
        ).encode()
    except (ValueError, TypeError, json.JSONDecodeError):
        event_id, kind = hashlib.sha256(raw).hexdigest(), "invalid"
        failures.append("envelope")
        stored_raw = b"{}"
    valid = not failures
    if failures:
        logging.getLogger(__name__).warning(
            "Aura webhook rejected: %s", ",".join(failures)
        )
    key = "aura:" + event_id if valid else "aura:invalid:" + hashlib.sha256(raw + signature.encode()).hexdigest()
    ledger.begin("aura_webhook_receive", "aura", key)
    try:
        ledger.db.execute(
            "INSERT OR IGNORE INTO wallet_webhook_inbox "
            "(event_key,raw_body,signature,signature_valid,origin,update_type,entity_id,"
            "received_at,error,provider,provider_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (key, stored_raw, signature, int(valid), "webhook", kind, event_id, time.time(),
             None if valid else "BAD_AURA_SIGNATURE", "aura", event_id),
        )
        row = ledger.db.execute("SELECT * FROM wallet_webhook_inbox WHERE event_key=?", (key,)).fetchone()
        if valid and row and bytes(row["raw_body"]) != stored_raw:
            valid = False
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET signature_valid=0,error='AURA_EVENT_ID_REUSED' WHERE id=?",
                (row["id"],),
            )
        ledger.commit()
        return row, valid
    except Exception:
        ledger.rollback()
        raise


async def receive_webhook(request, ledger, secret, error_cls, partner_id=None):
    raw = await request.read()
    signature = request.headers.get("X-Aura-Signature-V2", "")
    _, valid = store_webhook(ledger, raw, signature, request.headers, secret, partner_id)
    if not valid:
        raise error_cls("BAD_AURA_SIGNATURE", "Invalid Aura webhook signature", 400)
    return web.Response(status=200)


def _position_add(ledger, environment, uid, asset, amount):
    _position_adjust(ledger, environment, uid, asset, amount, Decimal(0))


def _position_adjust(ledger, environment, uid, asset, available_delta, reserved_delta):
    row = ledger.db.execute(
        "SELECT available,reserved FROM wallet_provider_positions "
        "WHERE provider='aura' AND environment=? AND user_id=? AND asset=?",
        (environment, uid, asset),
    ).fetchone()
    old_available, reserved = (Decimal(row[0]), Decimal(row[1])) if row else (Decimal(0), Decimal(0))
    with localcontext() as ctx:
        ctx.prec = 80
        available = old_available + available_delta
        reserved = reserved + reserved_delta
    if available < 0 or reserved < 0:
        raise ValueError("Insufficient Aura-backed position")
    ledger.db.execute(
        "INSERT INTO wallet_provider_positions VALUES ('aura',?,?,?,?,?,?) "
        "ON CONFLICT(provider,environment,user_id,asset) DO UPDATE SET "
        "available=excluded.available,reserved=excluded.reserved,updated_at=excluded.updated_at",
        (environment, uid, asset, str(available), str(reserved), time.time()),
    )


def record_card_issue_history(ledger, environment, local_id):
    """History projection only. Never debit or credit a balance here."""
    entity=ledger.db.execute("SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND entity_type='card_request' AND local_id=?",(environment,local_id)).fetchone()
    if not entity or not entity['remote_id'] or entity['status'] not in {'processing','opened','refunded'}:return
    stored=json.loads(entity['request_body']);fee=_decimal(stored['fee'],allow_zero=True)
    card=ledger.db.execute('SELECT kind,masked_pan,status FROM aura_cards WHERE environment=? AND user_id=? AND card_id=?',(environment,entity['user_id'],entity['remote_id'])).fetchone()
    kind=(card['kind'] if card else None) or stored.get('kind','virtual')
    plan_id,plan=resolve_card_plan(stored.get('plan_id'),kind)
    digits=re.sub(r'\D','',(card['masked_pan'] if card else None) or '')[-4:]
    detail={'status':'processing' if entity['status']=='processing' else 'completed',
            'card_id':entity['remote_id'],'card':('Физическая' if kind=='physical' else 'Виртуальная')+(' · •• '+digits if digits else ''),
            'plan_id':plan_id,'plan':plan['label'],'provider_fee':str(stored.get('provider_fee',fee)),
            'service_fee':str(stored.get('service_fee','0')),'environment':environment}
    event_id='aura:'+environment+':card_issue:'+local_id
    stamp=datetime.fromtimestamp(entity['created_at'],timezone.utc).isoformat()
    ledger.db.execute("INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET detail=excluded.detail",(event_id,entity['user_id'],'USDT',str(-fee),'card_issue',stamp,json.dumps(detail,ensure_ascii=False)))
    if entity['status']=='refunded':
        refund={**detail,'status':'completed','reason':'Возврат стоимости выпуска карты'}
        refund_stamp=datetime.fromtimestamp(entity['updated_at'],timezone.utc).isoformat()
        ledger.db.execute('INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)',(event_id+':refund',entity['user_id'],'USDT',str(fee),'card_issue_refund',refund_stamp,json.dumps(refund,ensure_ascii=False)))


def backfill_card_issue_history(ledger):
    rows=ledger.db.execute("SELECT environment,local_id FROM wallet_provider_entities WHERE provider='aura' AND entity_type='card_request' AND remote_id IS NOT NULL AND status IN ('processing','opened','refunded')").fetchall()
    for row in rows:record_card_issue_history(ledger,row['environment'],row['local_id'])
    return len(rows)


def record_card_recharge_history(ledger, environment, local_id):
    """Project the existing recharge settlement into history; no monetary postings."""
    entity=ledger.db.execute("SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND entity_type='card_recharge' AND local_id=?",(environment,local_id)).fetchone()
    if not entity or not entity['remote_id'] or entity['status'] not in {'requested','sent','completed','failed'}:return
    stored=json.loads(entity['request_body']);result=stored.get('result')
    if not isinstance(result,dict):return
    charged=_decimal(result['charged_amount'],allow_zero=True)
    credit=_decimal(result['recharge_amount'],allow_zero=True)
    card=ledger.db.execute('SELECT kind,masked_pan FROM aura_cards WHERE environment=? AND user_id=? AND card_id=?',(environment,entity['user_id'],stored['card_id'])).fetchone()
    digits=re.sub(r'\D','',(card['masked_pan'] if card else None) or '')[-4:]
    detail={'status':'completed' if entity['status']=='completed' else 'failed' if entity['status']=='failed' else 'processing',
            'card_id':stored['card_id'],'card':('Физическая' if card and card['kind']=='physical' else 'Виртуальная')+(' · •• '+digits if digits else ''),
            'card_credit':str(credit),'provider_fee':str(result.get('fee','0')),'service_fee':str(result.get('service_fee',stored.get('service_fee','0'))),
            'operation_id':entity['remote_id'],'environment':environment}
    stamp=datetime.fromtimestamp(entity['created_at'],timezone.utc).isoformat()
    ledger.db.execute("INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET amount=excluded.amount,detail=excluded.detail",('aura:'+environment+':card_topup:'+local_id,entity['user_id'],'USDT','0' if entity['status']=='failed' else str(charged.copy_negate()),'card_topup',stamp,json.dumps(detail,ensure_ascii=False)))


def backfill_card_recharge_history(ledger):
    rows=ledger.db.execute("SELECT environment,local_id FROM wallet_provider_entities WHERE provider='aura' AND entity_type='card_recharge' AND remote_id IS NOT NULL AND status IN ('requested','sent','completed','failed')").fetchall()
    for row in rows:record_card_recharge_history(ledger,row['environment'],row['local_id'])
    return len(rows)


def _settle_card_request(ledger, environment, card_id, status):
    entity = ledger.db.execute(
        "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='card_request' AND remote_id=?", (environment, card_id),
    ).fetchone()
    if not entity:
        return
    if status == "opened":
        if entity["status"] == "processing":
            ledger.db.execute(
                "UPDATE wallet_provider_entities SET status='opened',updated_at=? "
                "WHERE provider='aura' AND environment=? AND entity_type='card_request' "
                "AND local_id=?", (time.time(), environment, entity["local_id"]),
            )
        return
    if status not in {"failed_to_open", "cancelled"} or entity["status"] in {
        "refunded", "failed_to_open", "cancelled",
    }:
        return
    request_body = json.loads(entity["request_body"])
    fee = _decimal(request_body.get("fee"))
    available, reserved = ledger.balance(entity["user_id"], "USDT")
    ledger.put_balance(entity["user_id"], "USDT", available + fee, reserved)
    _position_adjust(
        ledger, environment, entity["user_id"], "USDT", fee, Decimal(0)
    )
    ledger.db.execute(
        "UPDATE wallet_provider_entities SET status='refunded',updated_at=? "
        "WHERE provider='aura' AND environment=? AND entity_type='card_request' "
        "AND local_id=?", (time.time(), environment, entity["local_id"]),
    )


def _settle_card_recharge(ledger, environment, operation_id, status):
    if status not in {"completed", "failed", "declined", "cancelled"}:
        return
    entity = ledger.db.execute(
        "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='card_recharge' AND remote_id=?",
        (environment, operation_id),
    ).fetchone()
    if not entity or entity["status"] not in {"requested", "sent"}:
        return
    stored = json.loads(entity["request_body"])
    held = _decimal(stored.get("held_amount"))
    available, reserved = ledger.balance(entity["user_id"], "USDT")
    failed = status in {"failed", "declined", "cancelled"}
    release = held if failed else Decimal(0)
    ledger.put_balance(
        entity["user_id"], "USDT", available + release, reserved - held
    )
    _position_adjust(
        ledger, environment, entity["user_id"], "USDT", release, -held
    )
    if isinstance(stored.get("result"), dict):
        stored["result"]["status"] = "failed" if failed else "completed"
        if failed and stored["result"].get("failure_reason") is None:
            stored["result"]["failure_reason"] = "provider_rejected"
    stored["held_amount"] = "0"
    ledger.db.execute(
        "UPDATE wallet_provider_entities SET status=?,request_body=?,updated_at=? "
        "WHERE provider='aura' AND environment=? AND entity_type='card_recharge' "
        "AND local_id=?",
        ("failed" if failed else "completed",
         json.dumps(stored, sort_keys=True, separators=(",", ":")),
         time.time(), environment, entity["local_id"]),
    )
    record_card_recharge_history(ledger,environment,entity["local_id"])


def _release_qr_reserve(ledger, environment, local_id, final_status):
    entity = ledger.db.execute(
        "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='qr_payment' AND local_id=?", (environment, local_id),
    ).fetchone()
    if not entity or entity["status"] not in {"reserved", "submitting", "processing", "unspecified"}:
        return False
    stored = json.loads(entity["request_body"])
    held = _decimal(stored.get("held_amount"), allow_zero=True)
    managed = not ledger.db.in_transaction
    if managed:
        ledger.begin("aura_qr_release", entity["user_id"], str(local_id))
    try:
        if held:
            available, reserved = ledger.balance(entity["user_id"], "USDT")
            ledger.put_balance(
                entity["user_id"], "USDT", available + held, reserved - held
            )
            _position_adjust(
                ledger, environment, entity["user_id"], "USDT", held, Decimal(0)
            )
        stored["held_amount"] = "0"
        stored["settled_amount"] = str(held)
        ledger.db.execute(
            "UPDATE wallet_provider_entities SET status=?,request_body=?,updated_at=? "
            "WHERE provider='aura' AND environment=? AND entity_type='qr_payment' "
            "AND local_id=?",
            (final_status, json.dumps(stored, sort_keys=True, separators=(",", ":")),
             time.time(), environment, local_id),
        )
        if managed:
            ledger.commit()
        return True
    except Exception:
        if managed:
            ledger.rollback()
        raise


def _settle_qr_payment(ledger, environment, payment_id, status):
    if status not in {"processing", "unspecified", "completed", "failed", "refunded"}:
        return False
    entity = ledger.db.execute(
        "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='qr_payment' AND remote_id=?", (environment, payment_id),
    ).fetchone()
    payment = ledger.db.execute(
        "SELECT total_usdt,provider_updated_at FROM aura_qr_payments "
        "WHERE payment_id=? AND environment=?", (payment_id, environment),
    ).fetchone()
    if not entity or not payment:
        return False
    stored = json.loads(entity["request_body"])
    old = entity["status"]
    held = _decimal(stored.get("held_amount"), allow_zero=True)
    settled = _decimal(stored.get("settled_amount", "0"), allow_zero=True)
    provider_amount = _decimal(payment["total_usdt"])
    expected = held if held else settled
    if expected and provider_amount != expected:
        raise ValueError("Aura QR payment amount does not match reserved settlement")
    if old in {"completed", "failed", "refunded", "rejected", "needs_reconciliation"}:
        if old == "completed" and status == "refunded":
            pass
        else:
            return False
    if status in {"processing", "unspecified"}:
        if old in {"reserved", "submitting"}:
            ledger.db.execute(
                "UPDATE wallet_provider_entities SET status=?,provider_updated_at=?,updated_at=? "
                "WHERE provider='aura' AND environment=? AND entity_type='qr_payment' "
                "AND local_id=?",
                (status, payment["provider_updated_at"], time.time(), environment,
                 entity["local_id"]),
            )
            return True
        return False
    managed = not ledger.db.in_transaction
    if managed:
        ledger.begin("aura_qr_" + status, "aura", payment_id)
    try:
        uid = entity["user_id"]
        available, reserved = ledger.balance(uid, "USDT")
        event_amount = None
        if status == "completed":
            ledger.put_balance(uid, "USDT", available, reserved - held)
            stored["settled_amount"], stored["held_amount"] = str(held), "0"
            event_amount = -held
        elif status == "failed":
            ledger.put_balance(uid, "USDT", available + held, reserved - held)
            _position_adjust(ledger, environment, uid, "USDT", held, Decimal(0))
            stored["settled_amount"], stored["held_amount"] = str(held), "0"
        elif status == "refunded":
            amount = settled if old == "completed" else held
            ledger.put_balance(
                uid, "USDT", available + amount,
                reserved if old == "completed" else reserved - held,
            )
            _position_adjust(ledger, environment, uid, "USDT", amount, Decimal(0))
            stored["settled_amount"], stored["held_amount"] = str(amount), "0"
            event_amount = amount
        ledger.db.execute(
            "UPDATE wallet_provider_entities SET status=?,request_body=?,provider_updated_at=?,"
            "updated_at=? WHERE provider='aura' AND environment=? "
            "AND entity_type='qr_payment' AND local_id=?",
            (status, json.dumps(stored, sort_keys=True, separators=(",", ":")),
             payment["provider_updated_at"], time.time(), environment, entity["local_id"]),
        )
        if event_amount is not None:
            ledger.db.execute(
                "INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                ("aura:qr:" + payment_id + ":" + status, uid, "USDT",
                 str(event_amount), "qr_" + status, datetime.now(timezone.utc).isoformat(),
                 json.dumps({"provider": "aura", "payment_id": payment_id,
                             "status": status}, separators=(",", ":"))),
            )
        if managed:
            ledger.commit()
        return True
    except Exception:
        if managed:
            ledger.rollback()
        raise


def _settle_sbp_order(ledger, environment, order_id, status):
    entity = ledger.db.execute(
        "SELECT * FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='sbp_order' AND remote_id=?", (environment, order_id),
    ).fetchone()
    order = ledger.db.execute(
        "SELECT usdt_amount,provider_updated_at FROM aura_sbp_orders "
        "WHERE order_id=? AND environment=?", (order_id, environment),
    ).fetchone()
    if not entity or not order or entity["status"] in {
        "completed", "failed", "expired", "cancelled", "rejected"
    }:
        return False
    if status not in {"completed", "failed", "expired", "cancelled"}:
        return False
    managed = not ledger.db.in_transaction
    if managed:
        ledger.begin("aura_sbp_" + status, "aura", order_id)
    try:
        if status == "completed":
            amount = _decimal(order["usdt_amount"])
            uid = entity["user_id"]
            available, reserved = ledger.balance(uid, "USDT")
            ledger.put_balance(uid, "USDT", available + amount, reserved)
            _position_add(ledger, environment, uid, "USDT", amount)
            ledger.db.execute(
                "INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                ("aura:sbp:" + order_id + ":completed", uid, "USDT", str(amount),
                 "sbp_completed", datetime.now(timezone.utc).isoformat(),
                 json.dumps({"provider": "aura", "order_id": order_id,
                             "status": status}, separators=(",", ":"))),
            )
        ledger.db.execute(
            "UPDATE wallet_provider_entities SET status=?,provider_updated_at=?,updated_at=? "
            "WHERE provider='aura' AND environment=? AND entity_type='sbp_order' "
            "AND local_id=?",
            (status, order["provider_updated_at"], time.time(), environment,
             entity["local_id"]),
        )
        if managed:
            ledger.commit()
        return True
    except Exception:
        if managed:
            ledger.rollback()
        raise


def _store_card_event(ledger, environment, kind, data, occurred_at=None):
    if not isinstance(data, dict):
        raise ValueError("Aura card event data must be an object")
    card_id = _safe_identifier(data.get("card_id") or data.get("id"), "card id")
    existing = ledger.db.execute(
        "SELECT * FROM aura_cards WHERE card_id=? AND environment=?",
        (card_id, environment),
    ).fetchone()
    if kind == "card.status_changed":
        if set(data) != {"card_id", "status"} or data.get("status") != "frozen":
            raise ValueError("Invalid Aura card.status_changed data")
        if not existing:
            raise ValueError("Unknown Aura card for status change")
    if kind == "card.delivery_updated":
        required = {"card_id", "customer_id", "delivery_status", "owner_id", "tracking"}
        if set(data) != required or not existing:
            raise ValueError("Invalid Aura card.delivery_updated data")
        if existing["kind"] != "physical":
            raise ValueError("Aura delivery update belongs to a non-physical card")
        _safe_identifier(data.get("customer_id"), "Aura internal customer id")
        if data.get("delivery_status") not in {
            "issuing", "issued", "out_for_delivery", "activated",
        }:
            raise ValueError("Invalid Aura card delivery_status")
        tracking_value = data.get("tracking")
        if tracking_value is not None:
            if not isinstance(tracking_value, dict) or set(tracking_value) != {
                "carrier", "number", "url",
            }:
                raise ValueError("Invalid Aura delivery tracking")
            carrier = tracking_value["carrier"]
            number = tracking_value["number"]
            url = tracking_value["url"]
            parsed = urlsplit(url) if isinstance(url, str) else None
            if carrier is not None and (
                not isinstance(carrier, str) or not carrier or len(carrier) > 100
            ):
                raise ValueError("Invalid Aura delivery carrier")
            if not isinstance(number, str) or not number or len(number) > 200:
                raise ValueError("Invalid Aura delivery tracking number")
            if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Invalid Aura delivery tracking URL")
    # Webhook customer_id is Aura's internal UUID. Ownership is deliberately
    # resolved through owner_id, which is the partner's own customer id.
    customer_id = data.get("owner_id") or (existing["customer_id"] if existing else None)
    if customer_id is None and data.get("customer_id") is not None:
        # Compatibility with events emitted before owner_id was documented.
        customer_id = data.get("customer_id")
    customer_id = _safe_identifier(customer_id, "card owner id")
    owner = ledger.db.execute(
        "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
        (customer_id, environment),
    ).fetchone()
    if not owner or (existing and existing["user_id"] != owner[0]):
        raise ValueError("Unknown Aura card owner")
    incoming_updated = str(data.get("updated_at") or occurred_at or "")
    if (existing and incoming_updated and existing["provider_updated_at"]
            and incoming_updated <= existing["provider_updated_at"]):
        return
    if kind == "card.delivery_updated" and existing["delivery_status"]:
        stage_rank = {
            "issuing": 0, "issued": 1, "out_for_delivery": 2, "activated": 3,
        }
        if stage_rank[data["delivery_status"]] < stage_rank.get(
            existing["delivery_status"], -1
        ):
            return
    event_status = {
        "card.opened": "opened", "card.failed": "failed_to_open",
        "card.cancelled": "cancelled",
    }.get(kind)
    if kind in {"card.status_changed", "card.delivery_updated"}:
        # `frozen` is a control flag, not a lifecycle status. Aura explicitly
        # says partial card events leave the rest of the card unchanged.
        status = existing["status"]
        frozen = True if kind == "card.status_changed" else bool(existing["frozen"])
    else:
        status = str(data.get("status") or event_status or "unknown")[:100]
        frozen = data.get("frozen") is True or status == "frozen"
    kind_value = data.get("kind") or data.get("card_type") or data.get("type")
    kind_value = str(kind_value)[:100] if kind_value is not None else None
    masked_pan = data.get("card_number_masked") or data.get("masked_pan") or data.get("last4")
    masked_pan = str(masked_pan)[:32] if masked_pan is not None else None
    delivery_status = data.get("delivery_status")
    if delivery_status is None and data.get("shipment_stage") is not None:
        delivery_status = {
            "packing": "issued", "sent": "out_for_delivery",
        }.get(str(data["shipment_stage"]), str(data["shipment_stage"]))
    delivery_status = str(delivery_status)[:100] if delivery_status is not None else None
    tracking = data.get("tracking")
    if isinstance(tracking, dict):
        tracking = {
            "carrier": str(tracking.get("carrier"))[:100] if tracking.get("carrier") is not None else None,
            "number": str(tracking.get("number"))[:200] if tracking.get("number") is not None else None,
            "url": str(tracking.get("url"))[:2048] if tracking.get("url") is not None else None,
        }
    else:
        tracking = None
    safe = _redact_card_data(data)
    if kind in {"card.status_changed", "card.delivery_updated"}:
        try:
            prior = json.loads(existing["body"])
        except (TypeError, ValueError, json.JSONDecodeError):
            prior = {}
        safe = {
            **prior, **safe, "card_id": card_id,
            "status": status, "frozen": frozen,
        }
    stamp = time.time()
    ledger.db.execute(
        "INSERT INTO aura_cards "
        "(card_id,user_id,customer_id,environment,kind,status,frozen,masked_pan,"
        "delivery_status,tracking,provider_updated_at,body,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(card_id) DO UPDATE SET kind=COALESCE(excluded.kind,aura_cards.kind),"
        "status=excluded.status,frozen=excluded.frozen,"
        "masked_pan=COALESCE(excluded.masked_pan,aura_cards.masked_pan),"
        "delivery_status=COALESCE(excluded.delivery_status,aura_cards.delivery_status),"
        "tracking=COALESCE(excluded.tracking,aura_cards.tracking),"
        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,"
        "updated_at=excluded.updated_at",
        (card_id, owner[0], customer_id, environment, kind_value, status, int(frozen),
         masked_pan, delivery_status,
         json.dumps(tracking, separators=(",", ":")) if tracking else None,
         incoming_updated or None,
         json.dumps(safe, separators=(",", ":"), ensure_ascii=False), stamp, stamp),
    )
    _settle_card_request(ledger, environment, card_id, status)
    issue=ledger.db.execute("SELECT local_id FROM wallet_provider_entities WHERE provider='aura' AND environment=? AND entity_type='card_request' AND remote_id=?",(environment,card_id)).fetchone()
    if issue:record_card_issue_history(ledger,environment,issue['local_id'])
    card_text = {
        "opened": "Карта выпущена и появилась в WPay.",
        "failed_to_open": "Выпустить карту не удалось. Средства будут обработаны по статусу заявки.",
        "cancelled": "Карта закрыта.",
    }.get(status, "Статус карты изменён: " + status + ".")
    if kind == "card.delivery_updated" and delivery_status:
        card_text = "Статус доставки физической карты: " + delivery_status + "."
    if kind == "card.status_changed" and frozen:
        card_text = "Карта заморожена."
    enqueue_notification(
        ledger, f"aura:card:{card_id}:{incoming_updated or kind}:{status}:{delivery_status or ''}",
        owner[0], "card", "Обновление карты", card_text,
    )


def _store_card_operation(ledger, environment, data, *, notify=True):
    if not isinstance(data, dict):
        raise ValueError("Aura card operation data must be an object")
    required = {
        "amount", "balance_after", "balance_before", "card_id", "created_at",
        "currency", "decline_message", "decline_reason", "mcc",
        "merchant_category", "merchant_country", "merchant_name", "operation_id",
        "original_amount", "original_currency", "previous_status",
        "refunded_amount", "status", "type", "updated_at",
    }
    missing = sorted(required - data.keys())
    if missing:
        raise ValueError(
            "Aura card operation missing required fields: " + ", ".join(missing)
        )
    operation_id = _safe_identifier(data.get("operation_id"), "card operation id")
    card_id = _safe_identifier(data.get("card_id"), "card id")
    card = ledger.db.execute(
        "SELECT user_id FROM aura_cards WHERE card_id=? AND environment=?",
        (card_id, environment),
    ).fetchone()
    if not card:
        raise ValueError("Unknown Aura card operation owner")
    existing = ledger.db.execute(
        "SELECT status,balance_before,balance_after,provider_updated_at "
        "FROM aura_card_operations WHERE operation_id=?",
        (operation_id,),
    ).fetchone()
    incoming_updated = str(data.get("updated_at") or "")
    if not incoming_updated:
        raise ValueError("Aura card operation updated_at is required")
    provider_created_at = str(data.get("created_at") or "")
    if not provider_created_at:
        raise ValueError("Aura card operation created_at is required")
    if (existing and existing["provider_updated_at"]
            and incoming_updated <= existing["provider_updated_at"]):
        return
    amount_value = _decimal(data["amount"])
    amount = str(amount_value)
    fee = None if data.get("fee") is None else str(_decimal(data["fee"], allow_zero=True))
    asset = str(data["currency"]).upper()
    if asset != "USDT":
        raise ValueError("Aura card operation currency must be USDT")
    merchant = data.get("merchant_name")
    merchant = str(merchant)[:300] if merchant is not None else None
    operation_types = {"purchase", "refund", "reversal", "fee", "topup", "other"}
    operation_type = str(data["type"])
    if operation_type not in operation_types:
        raise ValueError("Unknown Aura card operation type")
    statuses = {
        "completed", "pending", "declined", "cancelled", "refunded",
        "partially_refunded",
    }
    status = str(data["status"])
    if status not in statuses:
        raise ValueError("Unknown Aura card operation status")
    optional_amount = lambda key: (
        None if data.get(key) is None else str(_decimal(data[key], allow_zero=True))
    )
    original_amount = optional_amount("original_amount")
    refunded_amount = optional_amount("refunded_amount")
    refunded_value = _decimal(data["refunded_amount"], allow_zero=True)
    balance_before = optional_amount("balance_before")
    balance_after = optional_amount("balance_after")
    original_currency = data.get("original_currency")
    original_currency = str(original_currency).upper() if original_currency is not None else None
    if original_currency is not None and not re.fullmatch(r"[A-Z]{3}", original_currency):
        raise ValueError("Invalid Aura card operation original_currency")
    merchant_country = data.get("merchant_country")
    merchant_country = str(merchant_country)[:100] if merchant_country is not None else None
    mcc = data.get("mcc")
    mcc = str(mcc) if mcc is not None else None
    if mcc is not None and not re.fullmatch(r"\d{4}", mcc):
        raise ValueError("Invalid Aura card operation MCC")
    merchant_category = data.get("merchant_category")
    merchant_category = str(merchant_category)[:200] if merchant_category is not None else None
    previous_status = data.get("previous_status")
    previous_status = str(previous_status) if previous_status is not None else None
    if previous_status is not None and previous_status not in statuses:
        raise ValueError("Unknown Aura card operation previous_status")
    decline_reason = data.get("decline_reason")
    decline_reason = str(decline_reason) if decline_reason is not None else None
    if decline_reason is not None and decline_reason not in {"insufficient_balance", "other"}:
        raise ValueError("Unknown Aura card operation decline_reason")
    if status != "declined" and decline_reason is not None:
        raise ValueError("Aura card operation decline_reason requires declined status")
    decline_message = data.get("decline_message")
    decline_message = str(decline_message)[:500] if decline_message is not None else None
    if status == "declined" and balance_before is not None and balance_after is not None:
        if Decimal(balance_before) != Decimal(balance_after):
            raise ValueError("Declined Aura card operation must not change balance")
    if status == "partially_refunded" and not (Decimal("0") < refunded_value < amount_value):
        raise ValueError("Invalid partially refunded Aura card operation amount")
    if status == "refunded" and refunded_value < amount_value:
        raise ValueError("Invalid fully refunded Aura card operation amount")
    if existing and existing["status"] == "pending" and status == "completed":
        for key, incoming in (
            ("balance_before", balance_before), ("balance_after", balance_after)
        ):
            prior = existing[key]
            if prior is not None and incoming is not None and Decimal(prior) != Decimal(incoming):
                raise ValueError(
                    "Completed Aura card operation changed pending authorization balances"
                )
    stamp = time.time()
    ledger.db.execute(
        "INSERT INTO aura_card_operations "
        "(operation_id,card_id,user_id,environment,operation_type,status,asset,amount,fee,merchant,"
        "original_amount,original_currency,refunded_amount,balance_before,balance_after,merchant_country,mcc,"
        "merchant_category,previous_status,decline_reason,decline_message,provider_created_at,"
        "provider_updated_at,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(operation_id) DO UPDATE SET operation_type=excluded.operation_type,"
        "status=excluded.status,asset=excluded.asset,amount=excluded.amount,fee=excluded.fee,"
        "merchant=excluded.merchant,provider_updated_at=excluded.provider_updated_at,"
        "original_amount=excluded.original_amount,original_currency=excluded.original_currency,"
        "refunded_amount=excluded.refunded_amount,balance_before=excluded.balance_before,"
        "balance_after=excluded.balance_after,previous_status=excluded.previous_status,"
        "decline_reason=excluded.decline_reason,decline_message=excluded.decline_message,"
        "provider_created_at=excluded.provider_created_at,"
        "merchant_country=excluded.merchant_country,mcc=excluded.mcc,"
        "merchant_category=excluded.merchant_category,"
        "body=excluded.body,updated_at=excluded.updated_at",
        (operation_id, card_id, card[0], environment, operation_type, status, asset,
         amount, fee, merchant, original_amount, original_currency, refunded_amount,
         balance_before, balance_after, merchant_country, mcc, merchant_category,
         previous_status, decline_reason, decline_message, provider_created_at,
         incoming_updated,
         json.dumps(_redact_card_data(data), separators=(",", ":"), ensure_ascii=False),
         stamp, stamp),
    )
    _settle_card_recharge(ledger, environment, operation_id, status)
    if not notify:return
    operation_name = {
        "purchase": "Покупка", "refund": "Возврат", "reversal": "Отмена",
        "fee": "Комиссия", "topup": "Пополнение карты", "other": "Операция",
    }.get(operation_type, "Операция")
    message = f"{operation_name}: {amount} USDT. Статус: {status}."
    if merchant:
        message += " Получатель: " + merchant + "."
    enqueue_notification(
        ledger, f"aura:card-operation:{operation_id}:{incoming_updated}:{status}",
        card[0], "card_operation", "Операция по карте", message,
    )


def _store_sbp_order(ledger, environment, kind, data):
    order_id = _safe_identifier(data.get("order_id") or data.get("id"), "SBP order id")
    existing = ledger.db.execute(
        "SELECT * FROM aura_sbp_orders WHERE order_id=? AND environment=?",
        (order_id, environment),
    ).fetchone()
    customer_id = data.get("customer_id") or (existing["customer_id"] if existing else None)
    customer_id = _safe_identifier(customer_id, "customer id")
    owner = ledger.db.execute(
        "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
        (customer_id, environment),
    ).fetchone()
    if not owner or (existing and existing["user_id"] != owner[0]):
        raise ValueError("Unknown Aura SBP order owner")
    incoming_updated = str(data.get("updated_at") or "")
    if (existing and incoming_updated and existing["provider_updated_at"]
            and incoming_updated <= existing["provider_updated_at"]):
        return
    status = str(data.get("status") or kind.removeprefix("order."))[:100]

    def amount(*names):
        for name in names:
            if data.get(name) is not None:
                return str(_decimal(data[name], allow_zero=True))
        return None

    rub_amount = amount("rub_amount", "amount_rub", "fiat_amount")
    usdt_amount = amount("usdt_amount", "amount_usdt", "net_amount")
    fee = amount("fee", "fee_amount")
    safe_body = {
        "order_id": order_id, "customer_id": customer_id, "status": status,
        "rub_amount": rub_amount, "usdt_amount": usdt_amount, "fee": fee,
        "updated_at": incoming_updated or None,
    }
    stamp = time.time()
    ledger.db.execute(
        "INSERT INTO aura_sbp_orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,"
        "rub_amount=COALESCE(excluded.rub_amount,aura_sbp_orders.rub_amount),"
        "usdt_amount=COALESCE(excluded.usdt_amount,aura_sbp_orders.usdt_amount),"
        "fee=COALESCE(excluded.fee,aura_sbp_orders.fee),"
        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,"
        "updated_at=excluded.updated_at",
        (order_id, owner[0], customer_id, environment, status, rub_amount,
         usdt_amount, fee, incoming_updated or None,
         json.dumps(safe_body, separators=(",", ":"), ensure_ascii=False), stamp, stamp),
    )
    _settle_sbp_order(ledger, environment, order_id, status)
    message = "Статус покупки через СБП: " + status + "."
    if rub_amount:
        message += " Сумма: " + rub_amount + " RUB."
    enqueue_notification(
        ledger, f"aura:sbp:{order_id}:{incoming_updated or kind}:{status}",
        owner[0], "sbp", "Покупка через СБП", message,
    )


def _store_qr_payment(ledger, environment, kind, data):
    payment_id = _safe_identifier(
        data.get("payment_id") or data.get("id"), "QR payment id"
    )
    existing = ledger.db.execute(
        "SELECT provider_updated_at FROM aura_qr_payments WHERE payment_id=? AND environment=?",
        (payment_id, environment),
    ).fetchone()
    updated = str(data.get("updated_at") or "")
    if existing and updated and existing[0] and updated <= existing[0]:
        return
    status = str(data.get("status") or kind.removeprefix("qr_payment."))[:100]
    if status not in QR_PAYMENT_STATUSES:
        raise ValueError("Invalid Aura QR payment status")
    value = lambda key: (None if data.get(key) is None else str(_decimal(data[key], allow_zero=True)))
    amount_rub, rate, total_usdt = value("amount_rub"), value("rate"), value("total_usdt")
    merchant = data.get("merchant_name") or data.get("merchant")
    merchant = str(merchant)[:300] if merchant is not None else None
    customer_id = data.get("customer_id")
    user_id = None
    if customer_id is not None:
        customer_id = _safe_identifier(customer_id, "customer id")
        owner = ledger.db.execute(
            "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
            (customer_id, environment),
        ).fetchone()
        if not owner:
            raise ValueError("Unknown Aura QR payment owner")
        user_id = owner[0]
    payment_type = data.get("payment_type")
    safe = {
        "payment_id": payment_id, "status": status, "amount_rub": amount_rub,
        "rate": rate, "total_usdt": total_usdt, "merchant": merchant,
        "updated_at": updated or None, "customer_id": customer_id,
        "payment_type": payment_type,
    }
    stamp = time.time()
    ledger.db.execute(
        "INSERT INTO aura_qr_payments "
        "(payment_id,environment,status,amount_rub,rate,total_usdt,merchant,provider_updated_at,"
        "body,created_at,updated_at,user_id,customer_id,payment_type) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,"
        "amount_rub=COALESCE(excluded.amount_rub,aura_qr_payments.amount_rub),"
        "rate=COALESCE(excluded.rate,aura_qr_payments.rate),"
        "total_usdt=COALESCE(excluded.total_usdt,aura_qr_payments.total_usdt),"
        "merchant=COALESCE(excluded.merchant,aura_qr_payments.merchant),"
        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,updated_at=excluded.updated_at,"
        "user_id=COALESCE(excluded.user_id,aura_qr_payments.user_id),"
        "customer_id=COALESCE(excluded.customer_id,aura_qr_payments.customer_id),"
        "payment_type=COALESCE(excluded.payment_type,aura_qr_payments.payment_type)",
        (payment_id, environment, status, amount_rub, rate, total_usdt, merchant,
         updated or None, json.dumps(safe, separators=(",", ":")), stamp, stamp,
         user_id, customer_id, payment_type),
    )
    _settle_qr_payment(ledger, environment, payment_id, status)
    if user_id:
        message = "Статус оплаты QR: " + status + "."
        if amount_rub:
            message += " Сумма: " + amount_rub + " RUB."
        enqueue_notification(
            ledger, f"aura:qr:{payment_id}:{updated or kind}:{status}",
            user_id, "qr", "Оплата по QR", message,
        )


def _store_withdrawal(ledger, environment, kind, data):
    withdrawal_id = _safe_identifier(
        data.get("withdrawal_id") or data.get("id"), "withdrawal id"
    )
    existing = ledger.db.execute(
        "SELECT provider_updated_at FROM aura_withdrawals WHERE withdrawal_id=? AND environment=?",
        (withdrawal_id, environment),
    ).fetchone()
    updated = str(data.get("updated_at") or "")
    if existing and updated and existing[0] and updated <= existing[0]:
        return
    status = str(data.get("status") or kind.removeprefix("withdraw."))[:100]
    value = lambda key: (None if data.get(key) is None else str(_decimal(data[key], allow_zero=True)))
    amount, fee = value("amount"), value("fee")
    recipient = data.get("recipient") or data.get("address")
    recipient = str(recipient)[:200] if recipient is not None else None
    transaction_hash = data.get("transaction_hash") or data.get("tx_hash")
    transaction_hash = str(transaction_hash)[:200] if transaction_hash is not None else None
    safe = {
        "withdrawal_id": withdrawal_id, "status": status, "amount": amount,
        "fee": fee, "recipient": recipient, "transaction_hash": transaction_hash,
        "updated_at": updated or None,
    }
    stamp = time.time()
    ledger.db.execute(
        "INSERT INTO aura_withdrawals VALUES (?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(withdrawal_id) DO UPDATE SET status=excluded.status,"
        "amount=COALESCE(excluded.amount,aura_withdrawals.amount),"
        "fee=COALESCE(excluded.fee,aura_withdrawals.fee),"
        "recipient=COALESCE(excluded.recipient,aura_withdrawals.recipient),"
        "transaction_hash=COALESCE(excluded.transaction_hash,aura_withdrawals.transaction_hash),"
        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,updated_at=excluded.updated_at",
        (withdrawal_id, environment, status, amount, fee, recipient, transaction_hash,
         updated or None, json.dumps(safe, separators=(",", ":")), stamp, stamp),
    )
    owner = ledger.db.execute(
        "SELECT user_id FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
        "AND entity_type='withdrawal' AND (remote_id=? OR local_id=?) LIMIT 1",
        (environment, withdrawal_id, withdrawal_id),
    ).fetchone()
    if owner:
        message = "Статус вывода: " + status + "."
        if amount:
            message += " Сумма: " + amount + " USDT."
        enqueue_notification(
            ledger, f"aura:withdrawal:{withdrawal_id}:{updated or kind}:{status}",
            owner[0], "withdrawal", "Вывод средств", message,
        )


def store_withdrawal_snapshot(ledger, environment, data):
    """Persist an authenticated read/create response using the webhook projection."""
    result = _withdrawal_result(data)
    _store_withdrawal(ledger, environment, "withdraw.snapshot", result)
    return result


def process_inbox(ledger, environment, limit=20):
    rows = ledger.db.execute(
        "SELECT * FROM wallet_webhook_inbox WHERE provider='aura' AND signature_valid=1 "
        "AND processed_at IS NULL AND next_attempt_at<=? ORDER BY id LIMIT ?",
        (time.time(), limit),
    ).fetchall()
    processed = 0
    for row in rows:
        try:
            event = json.loads(row["raw_body"])
            kind, data = event.get("event"), event.get("data")
            ledger.begin("aura_webhook", "aura", row["event_key"])
            current = ledger.db.execute(
                "SELECT processed_at FROM wallet_webhook_inbox WHERE id=?", (row["id"],)
            ).fetchone()
            if current[0] is not None:
                ledger.commit()
                continue
            if kind in {"withdraw.sent", "withdraw.confirmed", "withdraw.failed"}:
                _store_withdrawal(ledger, environment, kind, data)
            elif kind in {"qr_payment.completed", "qr_payment.failed", "qr_payment.refunded"}:
                _store_qr_payment(ledger, environment, kind, data)
            elif kind in {"order.completed", "order.failed", "order.expired", "order.cancelled"}:
                _store_sbp_order(ledger, environment, kind, data)
            elif kind in {"card.opened", "card.failed", "card.cancelled", "card.status_changed", "card.delivery_updated"}:
                if kind in {"card.status_changed", "card.delivery_updated"}:
                    if not isinstance(event.get("api_version"), str) or not event["api_version"]:
                        raise ValueError("Invalid Aura partial card event api_version")
                    _aura_datetime(
                        event.get("occurred_at"), kind + " occurred_at"
                    )
                _store_card_event(
                    ledger, environment, kind, data, event.get("occurred_at")
                )
            elif kind == "card.operation":
                _store_card_operation(ledger, environment, data)
            elif kind == "card.otp":
                card_id = _safe_identifier(data.get("card_id"), "card id")
                expires_at = _aura_datetime(data.get("expires_at"), "OTP expiry")
                if expires_at.timestamp() > time.time():
                    owner = ledger.db.execute(
                        "SELECT user_id FROM aura_cards WHERE card_id=? AND environment=?",
                        (card_id, environment),
                    ).fetchone()
                    if owner:
                        enqueue_notification(
                            ledger, f"{row['event_key']}:notice", owner["user_id"],
                            "card_otp", "Код 3DS для карты",
                            "Посмотрите код в wPay: Карты → Управление картой → Код 3DS. "
                            "Код действует две минуты с момента получения.",
                        )
            elif kind == "customer.kyc.updated":
                customer_id = _safe_identifier(
                    data.get("customer_id") or data.get("id"), "customer id"
                )
                owner = ledger.db.execute(
                    "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
                    (customer_id, environment),
                ).fetchone()
                if not owner:
                    raise ValueError("Unknown Aura KYC owner")
                AuraService(ledger, None, environment)._store_kyc(
                    owner[0], customer_id, data
                )
            elif kind == "customer.deposit.confirmed":
                deposit_id = _safe_identifier(data.get("id") or data.get("deposit_id"), "deposit id")
                customer_id = _safe_identifier(data.get("customer_id") or data.get("owner_id"), "customer id")
                owner = ledger.db.execute(
                    "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
                    (customer_id, environment),
                ).fetchone()
                if not owner:
                    raise ValueError("Unknown Aura deposit owner")
                gross = _decimal(data.get("amount"))
                fee = _decimal(data.get("fee", "0"), allow_zero=True)
                net = _decimal(data.get("net_amount"))
                if gross - fee != net:
                    raise ValueError("Aura deposit amount mismatch")
                asset = str(data.get("currency") or data.get("asset") or "USDT").upper()
                network = str(data.get("network") or ("nile" if environment == "test" else "mainnet"))
                if asset != "USDT" or network != ("nile" if environment == "test" else "mainnet"):
                    raise ValueError("Unexpected Aura deposit asset/network")
                existing = ledger.db.execute(
                    "SELECT * FROM aura_deposits WHERE deposit_id=?", (deposit_id,)
                ).fetchone()
                canonical = json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
                if existing and existing["status"] == "confirmed" and (
                    existing["customer_id"] != customer_id
                    or Decimal(existing["gross"]) != gross
                    or Decimal(existing["fee"]) != fee
                    or Decimal(existing["net"]) != net
                ):
                    raise ValueError("Confirmed Aura deposit economics changed")
                if existing and existing["status"] == "rejected":
                    raise ValueError("Rejected Aura deposit became confirmed")
                ledger.db.execute(
                    "INSERT INTO aura_deposits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(deposit_id) DO UPDATE SET status='confirmed',fee=excluded.fee,"
                    "net=excluded.net,transaction_hash=excluded.transaction_hash,"
                    "confirmations=excluded.confirmations,provider_updated_at=excluded.provider_updated_at,"
                    "body=excluded.body,updated_at=excluded.updated_at",
                    (deposit_id, owner[0], customer_id, data.get("address_id"), environment,
                     "confirmed", asset, network, str(gross), str(fee), str(net),
                     data.get("transaction_hash"), data.get("confirmations"), data.get("updated_at"),
                     canonical, time.time(), time.time()),
                )
                namespaced_id = "aura:" + environment + ":" + deposit_id
                credited = ledger.deposit(
                    {"deposit_id": namespaced_id, "client_ref": customer_id, "asset": asset,
                     "credited": str(net), "credited_at": data.get("confirmed_at"),
                     "provider": "aura", "gross": str(gross), "fee": str(fee)},
                    manage_transaction=False,
                )
                if credited:
                    _position_add(ledger, environment, owner[0], asset, net)
            elif kind in {"customer.deposit.pending", "customer.deposit.rejected"}:
                deposit_id = _safe_identifier(data.get("id") or data.get("deposit_id"), "deposit id")
                customer_id = _safe_identifier(data.get("customer_id") or data.get("owner_id"), "customer id")
                owner = ledger.db.execute("SELECT user_id FROM aura_customers WHERE customer_id=?", (customer_id,)).fetchone()
                if not owner:
                    raise ValueError("Unknown Aura deposit owner")
                status = "pending" if kind.endswith("pending") else "rejected"
                gross = _decimal(data.get("amount"))
                canonical = json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
                existing = ledger.db.execute(
                    "SELECT status,provider_updated_at FROM aura_deposits WHERE deposit_id=?",
                    (deposit_id,),
                ).fetchone()
                incoming_updated = str(data.get("updated_at") or "")
                stale = bool(
                    existing and (
                        existing["status"] == "confirmed"
                        or (existing["status"] == "rejected" and status == "pending")
                        or (incoming_updated and existing["provider_updated_at"]
                            and incoming_updated <= existing["provider_updated_at"])
                    )
                )
                if not stale:
                    ledger.db.execute(
                        "INSERT INTO aura_deposits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                        "ON CONFLICT(deposit_id) DO UPDATE SET status=excluded.status,confirmations=excluded.confirmations,"
                        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,updated_at=excluded.updated_at",
                        (deposit_id, owner[0], customer_id, data.get("address_id"), environment,
                         status, "USDT", str(data.get("network") or ("nile" if environment == "test" else "mainnet")), str(gross), None, None,
                         data.get("transaction_hash"), data.get("confirmations"), data.get("updated_at"),
                         canonical, time.time(), time.time()),
                    )
            else:
                # Forward compatibility: preserve and acknowledge unknown events.
                ledger.db.execute(
                    "UPDATE wallet_webhook_inbox SET processed_at=?,error=? WHERE id=?",
                    (time.time(), "IGNORED_UNKNOWN_AURA_EVENT", row["id"]),
                )
                ledger.commit()
                processed += 1
                continue
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET processed_at=?,error=NULL,attempts=attempts+1 WHERE id=?",
                (time.time(), row["id"]),
            )
            ledger.commit()
            processed += 1
        except Exception as error:
            if ledger.db.in_transaction:
                ledger.rollback()
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET error=?,attempts=attempts+1,next_attempt_at=? WHERE id=?",
                (str(error)[:1000], time.time() + min(3600, 2 ** min(row["attempts"] + 1, 11)), row["id"]),
            )
    return processed


def _platform_balance(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid Aura balance")
    candidates = [
        payload.get("platform_balance"), payload.get("available"), payload.get("balance")
    ]
    if isinstance(payload.get("platform"), dict):
        candidates.extend([payload["platform"].get("available"), payload["platform"].get("balance")])
    for value in candidates:
        if value is not None and not isinstance(value, (dict, list)):
            return _decimal(value, allow_zero=True)
    raise ValueError("Aura platform balance missing")


async def reconcile(ledger, client, environment):
    external = _platform_balance(await client.get_balance())
    with localcontext() as ctx:
        ctx.prec = 80
        allocated = sum(
            (Decimal(row[0]) + Decimal(row[1]) for row in ledger.db.execute(
                "SELECT available,reserved FROM wallet_provider_positions "
                "WHERE provider='aura' AND environment=? AND asset='USDT'", (environment,)
            )), Decimal(0)
        )
        difference = external - allocated
    detail = {
        "provider": "aura", "environment": environment, "asset": "USDT",
        "provider_available": str(external), "allocated": str(allocated),
        "difference": str(difference), "state": "ok" if difference == 0 else "deficit" if difference < 0 else "reserve",
    }
    ledger.db.execute(
        "INSERT OR REPLACE INTO wallet_provider_reconciliation VALUES (?,?,?,?,?,?,?,?,?)",
        ("aura", environment, "USDT", str(external), str(allocated), str(difference),
         detail["state"], time.time(), json.dumps(detail, separators=(",", ":"))),
    )
    return detail


async def reconcile_pending(ledger, client, environment, limit=20):
    """Recover terminal state with read-only GETs; never replay monetary POSTs."""
    result = {"qr_payments": 0, "sbp_orders": 0, "withdrawals": 0, "errors": []}
    for row in ledger.db.execute(
        "SELECT payment_id FROM aura_qr_payments WHERE environment=? "
        "AND status IN ('processing','unspecified') ORDER BY updated_at LIMIT ?",
        (environment, limit),
    ).fetchall():
        try:
            item = await client.get_qr_payment(row["payment_id"])
            _store_qr_payment(ledger, environment, "qr_payment." + item["status"], item)
            result["qr_payments"] += 1
        except Exception as error:
            result["errors"].append("qr:" + row["payment_id"] + ":" + str(error)[:200])
    for row in ledger.db.execute(
        "SELECT order_id FROM aura_sbp_orders WHERE environment=? "
        "AND status IN ('awaiting_payment','unspecified') ORDER BY updated_at LIMIT ?",
        (environment, limit),
    ).fetchall():
        try:
            item = await client.get_sbp_order(row["order_id"])
            _store_sbp_order(ledger, environment, "order." + item["status"], item)
            result["sbp_orders"] += 1
        except Exception as error:
            result["errors"].append("order:" + row["order_id"] + ":" + str(error)[:200])
    for row in ledger.db.execute(
        "SELECT withdrawal_id FROM aura_withdrawals WHERE environment=? "
        "AND status IN ('processing','broadcast') ORDER BY updated_at LIMIT ?",
        (environment, limit),
    ).fetchall():
        try:
            store_withdrawal_snapshot(
                ledger, environment, await client.get_withdrawal(row["withdrawal_id"])
            )
            result["withdrawals"] += 1
        except Exception as error:
            result["errors"].append(
                "withdrawal:" + row["withdrawal_id"] + ":" + str(error)[:200]
            )
    return result


async def run_worker(ledger, client, environment, interval=10):
    last_reconcile = 0.0
    while True:
        try:
            process_inbox(ledger, environment)
            if client.configured:
                pending = await reconcile_pending(ledger, client, environment)
                ledger.db.execute(
                    "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                    ("pending_recovery", json.dumps(pending, separators=(",", ":")), time.time()),
                )
            if client.configured and time.time() - last_reconcile >= 60:
                result = await reconcile(ledger, client, environment)
                ledger.db.execute(
                    "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                    ("reconciliation", json.dumps(result, separators=(",", ":")), time.time()),
                )
                last_reconcile = time.time()
            ledger.db.execute(
                "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                ("health", "healthy", time.time()),
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            ledger.db.execute(
                "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                ("health", "degraded:" + str(error)[:500], time.time()),
            )
        await asyncio.sleep(interval)
