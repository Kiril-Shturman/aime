import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal


REFERRAL_PARAM = re.compile(r"^ref_([A-Za-z0-9]{10,24})$")


def _now():
    return datetime.now(timezone.utc).isoformat()


def prepare(ledger):
    ledger.db.executescript("""
      CREATE TABLE IF NOT EXISTS wallet_referral_codes (
        user_id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_referrals (
        referred_user_id TEXT PRIMARY KEY, referrer_user_id TEXT NOT NULL,
        code TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
        CHECK (referred_user_id <> referrer_user_id)
      );
      CREATE INDEX IF NOT EXISTS wallet_referrals_referrer
        ON wallet_referrals(referrer_user_id, created_at);
      CREATE TABLE IF NOT EXISTS wallet_referral_rewards (
        reward_id TEXT PRIMARY KEY, referrer_user_id TEXT NOT NULL,
        referred_user_id TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT NOT NULL, event_id TEXT UNIQUE,
        created_at TEXT NOT NULL, paid_at TEXT
      );
      CREATE INDEX IF NOT EXISTS wallet_referral_rewards_referrer
        ON wallet_referral_rewards(referrer_user_id, created_at);
    """)


def ensure_code(ledger, user_id):
    row = ledger.db.execute(
        "SELECT code FROM wallet_referral_codes WHERE user_id=?", (user_id,)
    ).fetchone()
    if row:
        return row["code"]
    for _ in range(8):
        code = secrets.token_hex(6)
        try:
            ledger.db.execute(
                "INSERT INTO wallet_referral_codes(user_id,code,created_at) VALUES (?,?,?)",
                (user_id, code, _now()),
            )
            return code
        except Exception as error:
            if "UNIQUE constraint failed: wallet_referral_codes.code" not in str(error):
                raise
    raise RuntimeError("Could not allocate a unique referral code")


def capture(ledger, referred_user_id, start_param, source, is_new_account):
    """Attribute a new account once. Existing accounts and self-referrals are ignored."""
    match = REFERRAL_PARAM.fullmatch(str(start_param or ""))
    if not match or not is_new_account:
        return False
    owner = ledger.db.execute(
        "SELECT user_id FROM wallet_referral_codes WHERE code=?", (match.group(1),)
    ).fetchone()
    if not owner or owner["user_id"] == referred_user_id:
        return False
    cursor = ledger.db.execute(
        "INSERT OR IGNORE INTO wallet_referrals"
        "(referred_user_id,referrer_user_id,code,source,created_at) VALUES (?,?,?,?,?)",
        (referred_user_id, owner["user_id"], match.group(1), str(source)[:32], _now()),
    )
    return cursor.rowcount == 1


def summary(ledger, user_id, bot_username):
    code = ensure_code(ledger, user_id)
    reward_rows = ledger.db.execute(
        "SELECT asset,amount FROM wallet_referral_rewards "
        "WHERE referrer_user_id=? AND status='paid' ORDER BY created_at",
        (user_id,),
    ).fetchall()
    rewards = {}
    for row in reward_rows:
        rewards[row["asset"]] = rewards.get(row["asset"], Decimal(0)) + Decimal(row["amount"])
    invitees = ledger.db.execute("""
      SELECT r.referred_user_id,r.created_at,a.first_name,a.telegram_username
      FROM wallet_referrals r LEFT JOIN wallet_accounts a ON a.user_id=r.referred_user_id
      WHERE r.referrer_user_id=? ORDER BY r.created_at DESC LIMIT 100
    """, (user_id,)).fetchall()
    activity = ledger.db.execute("""
      SELECT SUBSTR(created_at,1,10) day,COUNT(*) count
      FROM wallet_referrals WHERE referrer_user_id=?
      GROUP BY SUBSTR(created_at,1,10) ORDER BY day
    """, (user_id,)).fetchall()
    invited = ledger.db.execute(
        "SELECT COUNT(*) FROM wallet_referrals WHERE referrer_user_id=?", (user_id,)
    ).fetchone()[0]
    username = re.sub(r"[^A-Za-z0-9_]", "", str(bot_username or "Workingpaybot")) or "Workingpaybot"
    return {
        "code": code, "start_param": "ref_" + code,
        "link": f"https://t.me/{username}?start=ref_{code}",
        "invited": invited,
        "rewards": {asset: str(amount) for asset, amount in rewards.items()},
        "invitees": [dict(row) for row in invitees],
        "activity": [dict(row) for row in activity],
        "rewards_enabled": False,
    }
