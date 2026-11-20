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

    def test_exact_atomic_precision(self):
        self.assertEqual(atomic('1.000001', 6), 1000001)
        for value in ['0', '-1', 'NaN', '1.0000001']:
            with self.assertRaises(ValueError): atomic(value, 6)
