"""Native P2WPKH withdrawals from a wPay BIP84 Bitcoin wallet."""

import json
import re
import time
from decimal import Decimal, ROUND_UP

import requests
from embit import ec, script
from embit.transaction import Transaction, TransactionInput, TransactionOutput, Witness

API = "https://mempool.space/api"
DUST = 546
MAX_MONEY = 21_000_000 * 10**8


class Bitcoin:
    def __init__(self, atomic, units, error):
        self.atomic, self.units, self.error = atomic, units, error

    def request(self, path, raw=None, missing=False):
        method = "POST" if raw is not None else "GET"
        with requests.request(method, API + path, data=raw, timeout=(5, 12),
                              allow_redirects=False, stream=True) as response:
            if missing and response.status_code == 404:
                return None
            if response.status_code != 200:
                raise self.error("RPC_UNAVAILABLE")
            data = response.raw.read(1_048_577, decode_content=True)
            if len(data) > 1_048_576:
                raise self.error("RPC_UNAVAILABLE")
            return data.decode().strip()

    def estimate(self, source, recipient, amount):
        quantity = self.atomic(amount, 8)
        if not DUST <= quantity <= MAX_MONEY:
            raise ValueError("BTC amount out of range")
        source_script = script.address_to_scriptpubkey(source)
        script.address_to_scriptpubkey(recipient)
        utxos = json.loads(self.request(f"/address/{source}/utxo"))
        rates = json.loads(self.request("/fee-estimates"))
        rate = Decimal(str(rates.get("6", 0)))
        if not rate.is_finite() or not 0 < rate <= 1000:
            raise self.error("RPC_UNAVAILABLE")
        rate = int(rate.to_integral_value(rounding=ROUND_UP))
        eligible = sorted((u for u in utxos if u["status"].get("confirmed") is True),
                          key=lambda u: (-u["value"], u["txid"], u["vout"]))
        inputs = []
        seen = set()
        total = 0
        for utxo in eligible[:24]:
            txid, index = utxo["txid"], utxo["vout"]
            if not re.fullmatch(r"[a-f0-9]{64}", txid) or type(index) is not int or index < 0:
                raise ValueError("Invalid Bitcoin prevout")
            if (txid, index) in seen:
                raise ValueError("Duplicate Bitcoin prevout")
            seen.add((txid, index))
            parent = Transaction.parse(bytes.fromhex(self.request("/tx/" + txid + "/hex")))
            if parent.txid().hex() != txid or index >= len(parent.vout):
                raise ValueError("Bitcoin prevout identity mismatch")
            output = parent.vout[index]
            if output.script_pubkey != source_script or output.value != utxo["value"] or not 0 < output.value <= MAX_MONEY:
                raise ValueError("Bitcoin prevout ownership mismatch")
            inputs.append({"txid": txid, "n": index, "value": output.value})
            total += output.value
            fee = (74 + 69 * len(inputs)) * rate
            if total >= quantity + fee:
                change = total - quantity - fee
                if change < DUST:
                    fee += change
                    change = 0
                return {
                    "asset": "BTC", "network": "BTC", "amount": amount, "source_address": source,
                    "recipient": recipient, "native_balance": self.units(total, 8),
                    "max_fee": self.units(fee, 8), "fee_currency": "BTC",
                    "expires_at": int(time.time()) + 90,
                    "unsigned": {"inputs": inputs, "quantity": quantity, "change": change},
                }
        raise self.error("NO_GAS" if total >= quantity else "NO_FUNDS")

    def expected(self, quote):
        unsigned = quote["unsigned"]
        outputs = [TransactionOutput(unsigned["quantity"], script.address_to_scriptpubkey(quote["recipient"]))]
        if unsigned["change"]:
            outputs.append(TransactionOutput(unsigned["change"], script.address_to_scriptpubkey(quote["source_address"])))
        return Transaction(vin=[TransactionInput(bytes.fromhex(row["txid"]), row["n"])
                                for row in unsigned["inputs"]], vout=outputs)

    def digest(self, tx, quote, index, public):
        return tx.sighash_segwit(index, script.p2pkh(public), quote["unsigned"]["inputs"][index]["value"])

    def sign(self, quote, secret):
        key = ec.PrivateKey(secret)
        public = key.get_public_key()
        if script.p2wpkh(public) != script.address_to_scriptpubkey(quote["source_address"]):
            raise ValueError("Bitcoin signing key mismatch")
        tx = self.expected(quote)
        for index, txin in enumerate(tx.vin):
            signature = key.sign(self.digest(tx, quote, index, public))
            txin.witness = Witness([signature.serialize() + b"\x01", public.sec()])
        return {"raw": tx.serialize().hex()}, tx.txid().hex()

    def verify(self, quote, payload, txid):
        tx = Transaction.parse(bytes.fromhex(payload["raw"]))
        if tx.txid().hex() != txid or self.expected(quote).txid() != tx.txid():
            raise ValueError("Bitcoin transaction mismatch")
        for index, txin in enumerate(tx.vin):
            signature, public_key = txin.witness.items
            public = ec.PublicKey.parse(public_key)
            if (script.p2wpkh(public) != script.address_to_scriptpubkey(quote["source_address"])
                    or signature[-1:] != b"\x01"
                    or not public.verify(ec.Signature.parse(signature[:-1]), self.digest(tx, quote, index, public))):
                raise ValueError("Bitcoin witness mismatch")

    def receipt(self, quote, txid):
        raw = self.request("/tx/" + txid + "/status", missing=True)
        if raw is None:
            return None
        status = json.loads(raw)
        if status.get("confirmed") is not True:
            return None
        height = status["block_height"]
        if int(self.request("/blocks/tip/height")) < height + 5:
            return None
        return self.request(f"/block-height/{height}") == status["block_hash"]

    def broadcast(self, quote, payload, txid):
        if self.request("/tx", raw=payload["raw"]) != txid:
            raise self.error("OUTCOME_UNKNOWN")
