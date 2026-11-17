"""Apply only the Aura error-envelope patch to an existing release copy.

Fails closed when integration points differ. Never pass a running release.
The release deployer must clone the current backend first; this preserves
unrelated admin/backend changes maintained on the production branch.
"""
import ast
import sys
from pathlib import Path


def apply(root):
    root = Path(root)
    backend = root / "wallet_backend.py"
    aura = root / "wallet_aura.py"
    b = backend.read_text()
    a = aura.read_text()
    old_response = "web.json_response({'ok': False, 'error': {'name': error.name}, 'detail': error.detail}, status=error.status"
    assert b.count(old_response) == 1, "Unexpected wallet error response; inspect before patching"
    assert "from wallet_aura_errors import" not in b, "Error patch already applied"
    b = b.replace("import asyncio\n", "import asyncio\nfrom wallet_aura_errors import wallet_error_payload\n", 1)
    b = b.replace(old_response, "web.json_response(wallet_error_payload(error), status=error.status")
    old_policy = 'def _retry_policy(code, status):\n    if code in FINAL_ERROR_CODES:\n        return "no"\n    if code in WAIT_ERROR_CODES:\n        return "wait"\n    if code in DELAY_ERROR_CODES:\n        return "after_delay"\n    if code in LATER_ERROR_CODES or status >= 500:\n        return "later"\n    return "after_fix"\n'
    assert a.count(old_policy) == 1, "Unexpected Aura retry policy; inspect before patching"
    a = a.replace(old_policy, "def _retry_policy(code, status):\n    return aura_retry_policy(code, status)\n")
    assert a.count("error.retry_policy = _retry_policy(code, response.status)") == 1
    a = a.replace("from aiohttp import ClientSession", "from wallet_aura_errors import CATALOG as ERROR_CATALOG, retry_policy as aura_retry_policy\n\nfrom aiohttp import ClientSession", 1)
    a = a.replace("error.retry_policy = _retry_policy(code, response.status)", """error.retry_policy = aura_retry_policy(code, response.status, error.details)
        rule = ERROR_CATALOG.get(code, {})
        if rule.get("recovery") in {"support", "fix"} or code in {"kyc_pending", "card_paused"}:
            error.retry_after = None
        elif not error.retry_after and rule.get("retrySeconds"):
            error.retry_after = str(rule["retrySeconds"])""")
    ast.parse(b)
    ast.parse(a)
    for path, content in ((backend, b), (aura, a)):
        # A release is cloned using hardlinks. Break links before writing.
        path.unlink()
        path.write_text(content)
    print("Aura error integration applied; existing backend preserved")

if __name__ == "__main__":
    apply(sys.argv[1])
