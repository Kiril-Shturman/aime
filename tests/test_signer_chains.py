"""Offline signer tests. Never make a network request or broadcast real funds."""
import copy
import time
import unittest
from unittest.mock import patch

try:
    from wallet_signer_chains import Chains, PaymentError, calldata, atomic, tronhex
    from wallet_custody import derive
    from bip_utils import Bip44, Bip44Coins
    SIGNER_AVAILABLE = True
except ImportError:
    SIGNER_AVAILABLE = False


@unittest.skipUnless(SIGNER_AVAILABLE, 'Run with requirements-signer.txt in isolated signer environment')
class SignerChainTests(unittest.TestCase):
    def test_evm_signed_roundtrip_and_tampering(self):
        from eth_account import Account
        from wallet_chain import ERC20
        from eth_utils import to_checksum_address
        key = b'1' * 32
        for network, chain in [('BSC', 56), ('ETH', 1)]:
            source = Account.from_key(key).address
            quote = {'network': network, 'source_address': source, 'expires_at': time.time() + 60, 'unsigned': {
                'chainId': chain, 'nonce': 3, 'to': to_checksum_address(ERC20[(network, 'USDT')][0]), 'value': 0,
                'data': '0x' + calldata(network, source, 100), 'gas': 80000, 'gasPrice': 1000000000}}
            adapter = Chains(); payload, txid = adapter.sign(quote, key)
            adapter.verify(quote, payload, txid)
            changed = copy.deepcopy(quote); changed['unsigned']['nonce'] += 1
            with self.assertRaises(ValueError): adapter.verify(changed, payload, txid)
            with self.assertRaises(ValueError): adapter.verify(quote, payload, '0x' + '0' * 64)

    def test_tron_signed_roundtrip_and_tampering(self):
        from wallet_chain import TRON_USDT
        seed = b'2' * 32
        key = Bip44.FromSeed(seed, Bip44Coins.TRON).DeriveDefaultPath().PrivateKey().Raw().ToBytes()
        source = derive(seed, 'TRON', 'mainnet')['address']
        unsigned = {'ref_block_bytes': 'aabb', 'ref_block_hash': '0011223344556677', 'timestamp': int(time.time() * 1000),
                    'expiration': int(time.time() * 1000) + 120000, 'fee_limit': 10000000,
                    'contract': [{'type': 'TriggerSmartContract', 'parameter': {'type_url': 'type.googleapis.com/protocol.TriggerSmartContract',
                        'value': {'owner_address': tronhex(source), 'contract_address': tronhex(TRON_USDT), 'data': calldata('TRON', source, 100)}}}]}
        quote = {'network': 'TRON', 'source_address': source, 'expires_at': time.time() + 60, 'unsigned': unsigned}
        adapter = Chains(); payload, txid = adapter.sign(quote, key)
        adapter.verify(quote, payload, txid)
        changed = copy.deepcopy(payload); changed['raw_data']['fee_limit'] += 1
        with self.assertRaises(ValueError): adapter.verify(quote, changed, txid)

    def test_no_funds_and_no_gas_never_sign(self):
        adapter = Chains()
        with patch.object(adapter, 'balances', return_value=(0, 0)):
            with self.assertRaises(PaymentError) as error: adapter.estimate('BSC', '0x' + '1' * 40, '0x' + '2' * 40, '1', time.time() + 1000)
            self.assertEqual(error.exception.code, 'NO_FUNDS')
        def rpc(network, method, params):
            return {'eth_gasPrice': '0x3b9aca00', 'eth_estimateGas': '0xc350', 'eth_getTransactionCount': '0x1'}[method]
        with patch.object(adapter, 'balances', return_value=(10**20, 0)), patch.object(adapter, 'rpc', side_effect=rpc):
            with self.assertRaises(PaymentError) as error: adapter.estimate('BSC', '0x' + '1' * 40, '0x' + '2' * 40, '1', time.time() + 1000)
            self.assertEqual(error.exception.code, 'NO_GAS')

    def test_native_bnb_quote_signing_and_final_receipt(self):
        from eth_account import Account

        adapter = Chains()
        key = b"3" * 32
        source = Account.from_key(key).address
        recipient = "0x" + "2" * 40
        data = {"eth_chainId": "0x38", "eth_getBalance": hex(10**18),
                "eth_gasPrice": hex(10**9), "eth_estimateGas": hex(21000),
                "eth_getTransactionCount": "0x3"}
        with patch.object(adapter, "rpc", side_effect=lambda network, method, params: data[method]):
            quote = adapter.estimate_bnb(source, recipient, "0.1")
            self.assertEqual(quote["unsigned"]["value"], 10**17)
            self.assertEqual(quote["unsigned"]["data"], "0x")
            signed, txid = adapter.sign(quote, key)
            adapter.verify(quote, signed, txid)
            data["eth_getBalance"] = hex(10**17)
            with self.assertRaises(PaymentError) as error:
                adapter.estimate_bnb(source, recipient, "0.1")
            self.assertEqual(error.exception.code, "NO_GAS")

        receipt = {"transactionHash": txid, "blockNumber": "0x2", "blockHash": "0xab", "status": "0x1"}
        with patch.object(adapter, "rpc", side_effect=[receipt, {"number": "0x1"}]):
            self.assertIsNone(adapter.receipt(quote, txid))
        with patch.object(adapter, "rpc", side_effect=[receipt, {"number": "0x2"}, {"hash": "0xab"}]):
            self.assertTrue(adapter.receipt(quote, txid))

    def test_ethereum_native_and_xaut_quotes_target_different_recipients(self):
        from wallet_chain import ERC20

        adapter = Chains()
        source, recipient = '0x' + '1' * 40, '0x' + '2' * 40
        results = {"eth_chainId": "0x1", "eth_getBalance": hex(10**19),
                   "eth_gasPrice": hex(10**9), "eth_estimateGas": hex(65000),
                   "eth_getTransactionCount": "0x1", "eth_call": hex(10**6)}
        with patch.object(adapter, "rpc", side_effect=lambda net, method, params: results[method]):
            native = adapter.estimate_withdrawal("ETH", "ETH", source, recipient, "0.1")
            token = adapter.estimate_withdrawal("XAUT", "ETH", source, recipient, "0.1")
        self.assertEqual(native["unsigned"]["value"], 10**17)
        self.assertEqual(native["unsigned"]["to"].lower(), recipient)
        self.assertEqual(token["unsigned"]["value"], 0)
        self.assertEqual(token["unsigned"]["to"].lower(), ERC20[("ETH", "XAUT")][0])
        self.assertEqual(token["unsigned"]["data"], "0x" + calldata("ETH", recipient, 100_000))
        self.assertEqual(token["fee_currency"], "ETH")

    def test_trx_native_signed_roundtrip(self):
        adapter = Chains()
        seed = b"4" * 32
        key = Bip44.FromSeed(seed, Bip44Coins.TRON).DeriveDefaultPath().PrivateKey().Raw().ToBytes()
        source = derive(seed, "TRON", "mainnet")["address"]
        recipient = derive(b"5" * 32, "TRON", "mainnet")["address"]
        params = [{"key": key, "value": fee} for key, fee in (
            ("getTransactionFee", 1000), ("getCreateAccountFee", 100000),
            ("getCreateNewAccountFeeInSystemContract", 1000000),
        )]
        with patch.object(adapter, "tron", side_effect=[{"balance": 10000000},
                {"chainParameter": params}, {"blockID": "00" * 32}]):
            quote = adapter.estimate_withdrawal("TRX", "TRON", source, recipient, "1")
        payload, txid = adapter.sign(quote, key)
        adapter.verify(quote, payload, txid)
        self.assertEqual(quote["unsigned"]["contract"][0]["type"], "TransferContract")

    def test_sol_signed_roundtrip_and_finalized_status(self):
        from solders.hash import Hash

        adapter = Chains()
        seed = b"6" * 32
        source = derive(seed, "SOL", "mainnet")["address"]
        recipient = derive(b"7" * 32, "SOL", "mainnet")["address"]
        with patch.object(adapter, "rpc", side_effect=[
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dwy", {"value": 1000000000},
            {"value": {"blockhash": str(Hash.new_unique()), "lastValidBlockHeight": 500}},
            {"value": 5000},
        ]):
            quote = adapter.estimate_withdrawal("SOL", "SOL", source, recipient, "0.1")
        payload, txid = adapter.sign(quote, seed)
        adapter.verify(quote, payload, txid)
        with patch.object(adapter, "rpc", return_value={"value": [{"confirmationStatus": "finalized", "err": None}]}):
            self.assertTrue(adapter.receipt(quote, txid))

    def test_btc_only_uses_owned_confirmed_inputs_and_verifies_witness(self):
        from embit import ec, script
        from embit.transaction import Transaction, TransactionInput, TransactionOutput
        from wallet_signer_bitcoin import Bitcoin

        adapter = Chains()
        key = b"8" * 32
        public = ec.PrivateKey(key).get_public_key()
        prevout_script = script.p2wpkh(public)
        source = prevout_script.address()
        recipient = script.p2wpkh(ec.PrivateKey(b"9" * 32).get_public_key()).address()
        parent = Transaction(vin=[TransactionInput(b"X" * 32, 0)],
                             vout=[TransactionOutput(100000, prevout_script)])
        utxos = [{"txid": parent.txid().hex(), "vout": 0, "value": 100000,
                  "status": {"confirmed": True}}]
        import json
        with patch.object(Bitcoin, "request", side_effect=[json.dumps(utxos), '{"6":1}', parent.serialize().hex()]):
            quote = adapter.estimate_withdrawal("BTC", "BTC", source, recipient, "0.0005")
        payload, txid = adapter.sign(quote, key)
        adapter.verify(quote, payload, txid)
        self.assertEqual(quote["unsigned"]["quantity"], 50000)
        self.assertEqual(quote["unsigned"]["change"], 49857)
        with self.assertRaises(ValueError):
            adapter.verify(dict(quote, recipient=source), payload, txid)

    def test_exact_atomic_precision(self):
        self.assertEqual(atomic('1.000001', 6), 1000001)
        for value in ['0', '-1', 'NaN', '1.0000001']:
            with self.assertRaises(ValueError): atomic(value, 6)
