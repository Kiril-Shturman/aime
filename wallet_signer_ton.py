"""Native GRAM transfers from isolated TON Wallet V4R2 keys."""

import base64
import json
import os
import time

import requests
from nacl.signing import SigningKey, VerifyKey
from pytoniq_core import Address
from tonsdk.boc import Cell
from tonsdk.contract import Contract
from tonsdk.contract.wallet import WalletV4ContractR2
from tonsdk.utils import Address as SdkAddress


def boc(cell):
    return base64.b64encode(bytes(cell.to_boc(False))).decode()


def raw_address(value):
    return Address(value).to_str(is_user_friendly=False)


class Ton:
    def __init__(self, atomic, units, error):
        self.atomic, self.units, self.error = atomic, units, error

    def request(self, path, *, body=None, params=None):
        key = os.environ.get("WPAY_TONCENTER_API_KEY")
        headers = {"X-API-Key": key} if key else {}
        with requests.request(
            "POST" if body is not None else "GET", "https://toncenter.com/api/" + path,
            json=body, params=params, headers=headers, timeout=(5, 15), stream=True,
            allow_redirects=False,
        ) as response:
            if response.status_code != 200:
                raise self.error("RPC_UNAVAILABLE")
            data = response.raw.read(1_048_577, decode_content=True)
            if len(data) > 1_048_576:
                raise self.error("RPC_UNAVAILABLE")
            result = json.loads(data)
        if path.startswith("v2/"):
            if result.get("ok") is not True:
                raise self.error("RPC_UNAVAILABLE")
            return result["result"]
        return result

    def cells(self, quote, signature=None):
        data = quote["unsigned"]
        public = bytes.fromhex(data["public_key"])
        if len(public) != 32:
            raise ValueError("Invalid TON public key")
        wallet = WalletV4ContractR2(public_key=public, private_key=b"", wc=0, wallet_id=698983191)
        if raw_address(wallet.address.to_string(False)) != raw_address(quote["source_address"]):
            raise ValueError("TON wallet identity mismatch")
        seqno = data["seqno"]
        signing = Cell()
        signing.bits.write_uint(698983191, 32)
        signing.bits.write_uint(data["valid_until"], 32)
        signing.bits.write_uint(seqno, 32)
        signing.bits.write_uint(0, 8)
        signing.bits.write_uint(3, 8)
        header = Contract.create_internal_message_header(
            SdkAddress(raw_address(quote["recipient"])),
            self.atomic(quote["amount"], 9), bounce=False,
        )
        signing.refs.append(Contract.create_common_msg_info(header))
        signed = Cell()
        signed.bits.write_bytes(signature if signature is not None else bytes(64))
        signed.write_cell(signing)
        deploy = wallet.create_state_init() if seqno == 0 else None
        external_header = Contract.create_external_message_header(wallet.address)
        external = Contract.create_common_msg_info(
            external_header, deploy["state_init"] if deploy else None, signed,
        )
        return signing, signed, external, deploy

    def estimate(self, source, recipient, amount, public_key):
        quantity = self.atomic(amount, 9)
        if quantity >= 2**120:
            raise ValueError("GRAM amount out of range")
        account = self.request("v2/getWalletInformation", body={"address": source})
        native = int(account["balance"])
        if native < quantity:
            raise self.error("NO_FUNDS")
        state = account["account_state"]
        if state not in {"active", "uninitialized"}:
            raise self.error("RPC_UNAVAILABLE")
        seqno = 0
        if state == "active":
            if account.get("wallet") is not True or int(account.get("wallet_id", -1)) != 698983191:
                raise self.error("RPC_UNAVAILABLE")
            seqno = int(account["seqno"])
        stamp = int(time.time())
        quote = {
            "asset": "GRAM", "network": "TON", "amount": amount, "source_address": source,
            "recipient": recipient, "native_balance": self.units(native, 9), "fee_currency": "GRAM",
            "expires_at": stamp + 50,
            "unsigned": {"seqno": seqno, "public_key": public_key, "valid_until": stamp + 100},
        }
        _, body, _, deploy = self.cells(quote)
        request = {"address": source, "body": boc(body), "ignore_chksig": True}
        if deploy:
            request.update(init_code=boc(deploy["code"]), init_data=boc(deploy["data"]))
        fees = self.request("v2/estimateFee", body=request)["source_fees"]
        total = sum(int(fees[field]) for field in ("in_fwd_fee", "storage_fee", "gas_fee", "fwd_fee"))
        if not 0 < total <= 1_000_000_000:
            raise self.error("RPC_UNAVAILABLE")
        budget = total * 2
        if native < quantity + budget:
            raise self.error("NO_GAS")
        return {**quote, "max_fee": self.units(budget, 9)}

    def sign(self, quote, seed):
        signing, _, _, _ = self.cells(quote)
        signature = SigningKey(seed).sign(bytes(signing.bytes_hash())).signature
        _, body, external, _ = self.cells(quote, signature)
        return {"raw": boc(external), "signature": signature.hex()}, body.bytes_hash().hex()

    def verify(self, quote, payload, txid):
        signature = bytes.fromhex(payload["signature"])
        signing, body, external, _ = self.cells(quote, signature)
        VerifyKey(bytes.fromhex(quote["unsigned"]["public_key"])).verify(bytes(signing.bytes_hash()), signature)
        if body.bytes_hash().hex() != txid or boc(external) != payload["raw"]:
            raise ValueError("Signed TON payload mismatch")

    def receipt(self, quote, txid):
        result = self.request("v3/transactionsByMessage", params={
            "body_hash": txid, "direction": "in", "limit": 10,
        })
        expected = base64.b64encode(bytes.fromhex(txid)).decode()
        for row in result["transactions"]:
            if raw_address(row["account"]) != raw_address(quote["source_address"]):
                continue
            if row["in_msg"]["message_content"]["hash"] != expected:
                continue
            if row["description"].get("aborted") is True or not row["out_msgs"]:
                raise self.error("TX_FAILED")
            for output in row["out_msgs"]:
                if (raw_address(output["destination"]) == raw_address(quote["recipient"])
                        and int(output["value"]) == self.atomic(quote["amount"], 9)):
                    recipient = self.request("v3/transactionsByMessage", params={
                        "msg_hash": output["hash"], "direction": "in", "limit": 5,
                    })
                    return next((
                        True for incoming in recipient["transactions"]
                        if raw_address(incoming["account"]) == raw_address(quote["recipient"])
                        and incoming["in_msg"]["hash"] == output["hash"]
                        and incoming["in_msg"].get("bounced") is False
                        and int(incoming["in_msg"]["value"]) == self.atomic(quote["amount"], 9)
                    ), None)
        return None

    def broadcast(self, quote, payload, txid):
        if time.time() >= quote["unsigned"]["valid_until"]:
            raise self.error("OUTCOME_UNKNOWN")
        self.request("v2/sendBoc", body={"boc": payload["raw"]})
