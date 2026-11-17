"""Shared Aura error semantics and a bounded, public error envelope.

The catalog is also consumed by the frontend. Do not include raw provider
requests, customer identifiers, passport data, or credentials in errors.
"""
import json
import math
import re
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("aura_error_catalog.json").read_text())
PUBLIC_DETAILS = frozenset({
    "reason", "terminal", "status", "min", "max", "limit", "remaining",
    "resets_at", "scope", "required_scope", "max_bytes", "code", "cause",
    "stage", "window", "window_seconds", "area",
})


def _text(value, length=500):
    text = re.sub(r"[\x00-\x1f\x7f]", "", str(value))[:length]
    return re.sub(r"(?:ak_(?:live|test)_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_-]+)", "[redacted]", text)


def recovery(code, details=None):
    details = details if isinstance(details, dict) else {}
    if code == "kyc_session_unavailable":
        if details.get("status") in {"pending", "in_review"}:
            return "wait"
        if details.get("reason") == "access_locked_contact_manager" and details.get("terminal") is not True:
            return "fix"
    return CATALOG.get(code, {}).get("recovery", "fix")


def retry_policy(code, status, details=None):
    kind = recovery(code, details)
    if code not in CATALOG and status >= 500:
        return "later"
    return {"support": "no", "fix": "after_fix", "wait": "wait",
            "delay": "after_delay", "later": "later", "same_request": "later"}[kind]


def wallet_error_payload(error):
    code = str(error.name)
    body = {"ok": False, "error": {"name": code}, "detail": _text(error.detail)}
    if getattr(error, "provider", None) != "aura":
        return body
    envelope = body["error"]
    envelope["code"] = code
    for name, attr in (("type", "provider_type"), ("param", "param"), ("request_id", "request_id")):
        value = getattr(error, attr, None)
        if isinstance(value, str) and value:
            envelope[name] = _text(value, 200)
    raw = getattr(error, "details", {})
    details = {}
    if isinstance(raw, dict):
        for key in PUBLIC_DETAILS:
            value = raw.get(key)
            if isinstance(value, str):
                details[key] = _text(value)
            elif isinstance(value, (bool, int)) or isinstance(value, float) and math.isfinite(value):
                details[key] = value
    envelope["details"] = details
    envelope["recovery"] = recovery(code, details)
    envelope["retry_policy"] = retry_policy(code, error.status, details)
    return body
