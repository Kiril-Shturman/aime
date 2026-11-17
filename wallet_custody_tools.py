"""Offline key provisioning and recovery verification. Never imported by the web API."""

import argparse
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import quote

from nacl.public import PrivateKey, SealedBox

from wallet_custody import (
    PUBLIC_KEY_KIND,
    PRIVATE_KEY_KIND,
    decode,
    encode,
    fingerprint,
    derive,
    public_wallet,
)


def write_exclusive(path, document):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(document, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def init_key(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    private_path, public_path = directory / "private.json", directory / "public.json"
    if private_path.exists() or public_path.exists():
        raise ValueError("Key files already exist; refusing to overwrite")
    private = PrivateKey.generate()
    raw_public = bytes(private.public_key)
    identifier = fingerprint(raw_public)
    public = {
        "kind": PUBLIC_KEY_KIND,
        "key_id": identifier,
        "public_key": encode(raw_public),
    }
    secret = {**public, "kind": PRIVATE_KEY_KIND, "private_key": encode(bytes(private))}
    write_exclusive(private_path, secret)
    # If public-file creation fails, retain the private key for operator recovery.
    write_exclusive(public_path, public)
    return {
        "key_id": identifier,
        "public_file": str(public_path.resolve()),
        "private_file": str(private_path.resolve()),
    }


def load_private(path):
    path = Path(path)
    if path.stat().st_mode & 0o077:
        raise ValueError("Private file must be owner-readable only")
    document = json.loads(path.read_text())
    if (
        set(document) != {"kind", "key_id", "public_key", "private_key"}
        or document["kind"] != PRIVATE_KEY_KIND
    ):
        raise ValueError("Invalid private-key document")
    private = PrivateKey(decode(document["private_key"]))
    if (
        bytes(private.public_key) != decode(document["public_key"])
        or fingerprint(bytes(private.public_key)) != document["key_id"]
    ):
        raise ValueError("Private/public key mismatch")
    return private


def verify_wallet(row, private):
    if fingerprint(bytes(private.public_key)) != row["key_id"]:
        raise ValueError("Wrong recovery key")
    document = json.loads(SealedBox(private).decrypt(bytes(row["encrypted_secret"])))
    expected = {
        "format": "wpay.wallet.secret.v1",
        "wallet_id": row["id"],
        "user_id": row["user_id"],
        "network": row["network"],
        "chain_env": row["chain_env"],
        "key_id": row["key_id"],
        "address": row["address"],
        "public_key": row["public_key"],
        "specification": json.loads(row["specification"]),
    }
    if set(document) != set(expected) | {"seed"} or any(
        document[key] != value for key, value in expected.items()
    ):
        raise ValueError("Recovery ownership or recipe mismatch")
    seed = decode(document["seed"])
    try:
        derived = derive(seed, row["network"], row["chain_env"])
        if any(
            derived[key] != expected[key]
            for key in ("address", "public_key", "specification")
        ):
            raise ValueError("Address cannot be recovered")
    finally:
        del seed
    return {**public_wallet(row), "recovery_verified": True}


def readonly_db(path):
    connection = sqlite3.connect(
        "file:" + quote(str(Path(path).resolve()), safe="/") + "?mode=ro", uri=True
    )
    connection.row_factory = sqlite3.Row
    return connection


def main():
    parser = argparse.ArgumentParser(
        description="WPay offline custody tools; never prints wallet secrets"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init-key")
    init.add_argument("--directory", required=True)
    verify = sub.add_parser("verify-wallet")
    verify.add_argument("--database", required=True)
    verify.add_argument("--private-key", required=True)
    verify.add_argument("--wallet-id", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init-key":
            print(json.dumps(init_key(args.directory)))
        else:
            private = load_private(args.private_key)
            conn = readonly_db(args.database)
            try:
                row = conn.execute(
                    "SELECT * FROM custody_wallets WHERE id=?", (args.wallet_id,)
                ).fetchone()
                if not row:
                    raise ValueError("Wallet not found")
                print(json.dumps(verify_wallet(row, private)))
            finally:
                conn.close()
    except Exception:
        # Exceptions from crypto/JSON libraries must not echo recovery material.
        parser.exit(
            1,
            "Custody operation failed; check paths, permissions and the matching recovery key. Existing files were not overwritten.\n",
        )


if __name__ == "__main__":
    main()
