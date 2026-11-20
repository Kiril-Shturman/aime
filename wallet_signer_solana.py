"""Native Solana transactions for the isolated custody signer."""

import base64
import time

from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import TransferParams, transfer
from solders.transaction import Transaction


def message(source, recipient, lamports, blockhash):
    sender = Pubkey.from_string(source)
    return Message.new_with_blockhash(
        [transfer(TransferParams(
            from_pubkey=sender, to_pubkey=Pubkey.from_string(recipient), lamports=lamports,
        ))],
        sender,
        Hash.from_string(blockhash),
    )


class Solana:
    def __init__(self, rpc, atomic, units, error):
        self.rpc, self.atomic, self.units, self.error = rpc, atomic, units, error

    def estimate(self, source, recipient, amount):
        quantity = self.atomic(amount, 9)
        if quantity >= 2**64:
            raise ValueError("SOL amount out of range")
        if self.rpc("getGenesisHash", []) != "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dwy":
            raise self.error("RPC_UNAVAILABLE")
        commitment = {"commitment": "confirmed"}
        native = self.rpc("getBalance", [source, commitment])["value"]
        if native < quantity:
            raise self.error("NO_FUNDS")
        latest = self.rpc("getLatestBlockhash", [commitment])["value"]
        blockhash = latest["blockhash"]
        unsigned = message(source, recipient, quantity, blockhash)
        fee = self.rpc("getFeeForMessage", [base64.b64encode(bytes(unsigned)).decode(), commitment])["value"]
        if not isinstance(fee, int) or not 0 < fee <= 100_000_000:
            raise self.error("RPC_UNAVAILABLE")
        if native < quantity + fee:
            raise self.error("NO_GAS")
        return {
            "asset": "SOL", "network": "SOL", "amount": amount,
            "source_address": source, "recipient": recipient,
            "native_balance": self.units(native, 9), "max_fee": self.units(fee, 9), "fee_currency": "SOL",
            "expires_at": int(time.time()) + 35,
            "unsigned": {"blockhash": blockhash, "last_valid_height": latest["lastValidBlockHeight"]},
        }

    def expected(self, quote):
        return message(quote["source_address"], quote["recipient"], self.atomic(quote["amount"], 9),
                       quote["unsigned"]["blockhash"])

    def sign(self, quote, seed):
        tx = Transaction.new_unsigned(self.expected(quote))
        tx.sign([Keypair.from_seed(seed)], tx.message.recent_blockhash)
        return {"raw": base64.b64encode(bytes(tx)).decode()}, str(tx.signatures[0])

    def verify(self, quote, payload, txid):
        tx = Transaction.from_bytes(base64.b64decode(payload["raw"], validate=True))
        if tx.message != self.expected(quote) or len(tx.signatures) != 1 or str(tx.signatures[0]) != txid:
            raise ValueError("Signed Solana payload mismatch")
        tx.verify()

    def receipt(self, quote, txid):
        status = self.rpc("getSignatureStatuses", [[txid], {"searchTransactionHistory": True}])["value"][0]
        if status and status.get("confirmationStatus") == "finalized":
            if status.get("err") is not None:
                raise self.error("TX_FAILED")
            return True
        # Missing history after expiry is inconclusive. Keep the existing signed job.
        return None

    def broadcast(self, quote, payload, txid):
        height = self.rpc("getBlockHeight", [{"commitment": "confirmed"}])
        if height > quote["unsigned"]["last_valid_height"]:
            raise self.error("OUTCOME_UNKNOWN")
        result = self.rpc("sendTransaction", [payload["raw"], {
            "encoding": "base64", "maxRetries": 0, "preflightCommitment": "confirmed",
        }])
        if result != txid:
            raise ValueError("RPC returned another Solana signature")
