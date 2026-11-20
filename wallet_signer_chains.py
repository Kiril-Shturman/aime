"""Isolated signer adapters. Import only in the operator process, never the web API.

Only USDT.transfer to an independently verified FixedFloat pay address is allowed.
Signed bytes are persisted by the controller before any broadcast.
"""
import hashlib
import json
import time
from decimal import Decimal, localcontext

import requests
from bip_utils import Base58Decoder
from eth_account import Account
from eth_account._utils.legacy_transactions import Transaction as EvmTransaction
from eth_utils import keccak, to_checksum_address
from tronpy.keys import PrivateKey as TronKey, Signature
from tronpy.proto import calculate_txid_from_raw_data

from wallet_chain import ERC20, TRON_USDT, units

URLS = {'ETH': 'https://ethereum-rpc.publicnode.com',
        'BSC': 'https://bsc-rpc.publicnode.com', 'TRON': 'https://api.trongrid.io'}
CHAIN_IDS = {'ETH': 1, 'BSC': 56}
TRANSFER_TOPIC = keccak(text='Transfer(address,address,uint256)').hex()


class PaymentError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def atomic(value, decimals):
    with localcontext() as ctx:
        ctx.prec = 100
        number = Decimal(value) * (Decimal(10) ** decimals)
        if not number.is_finite() or number <= 0 or number != number.to_integral_value() or number >= 2**256:
            raise ValueError('Invalid transfer amount')
        return int(number)


def tronhex(address):
    raw = Base58Decoder.CheckDecode(address)
    if len(raw) != 21 or raw[0] != 65:
        raise ValueError('Invalid TRON address')
    return raw.hex()


def calldata(network, recipient, quantity):
    raw = tronhex(recipient)[2:] if network == 'TRON' else recipient[2:]
    if len(raw) != 40 or len(bytes.fromhex(raw)) != 20:
        raise ValueError('Invalid recipient')
    return 'a9059cbb' + raw.lower().rjust(64, '0') + format(quantity, '064x')


def http(url, body):
    with requests.post(url, json=body, timeout=(5, 15), allow_redirects=False, stream=True) as response:
        if response.status_code != 200 or int(response.headers.get('Content-Length', '0')) > 1048576:
            raise PaymentError('RPC_UNAVAILABLE')
        content = response.raw.read(1048577, decode_content=True)
        if len(content) > 1048576:
            raise PaymentError('RPC_UNAVAILABLE')
        result = json.loads(content)
        if not isinstance(result, dict) or 'error' in result or 'Error' in result:
            raise PaymentError('RPC_UNAVAILABLE')
        return result


class Chains:
    def rpc(self, network, method, params):
        data = http(URLS[network], {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
        if data.get('id') != 1 or 'result' not in data:
            raise PaymentError('RPC_UNAVAILABLE')
        return data['result']

    def tron(self, path, body):
        return http(URLS['TRON'] + path, body)

    def balances(self, network, source):
        if network == 'TRON':
            account = self.tron('/walletsolidity/getaccount', {'address': source, 'visible': True})
            token = self.tron('/walletsolidity/triggerconstantcontract', {
                'owner_address': source, 'contract_address': TRON_USDT,
                'function_selector': 'balanceOf(address)',
                'parameter': tronhex(source)[2:].rjust(64, '0'), 'visible': True})
            if not token.get('result', {}).get('result') or len(token.get('constant_result', [])) != 1:
                raise PaymentError('RPC_UNAVAILABLE')
            return int(token['constant_result'][0], 16), int(account.get('balance', 0))
        if int(self.rpc(network, 'eth_chainId', []), 16) != CHAIN_IDS[network]:
            raise PaymentError('RPC_UNAVAILABLE')
        contract, _ = ERC20[(network, 'USDT')]
        token = self.rpc(network, 'eth_call', [{'to': contract, 'data': '0x70a08231' + source[2:].lower().rjust(64, '0')}, 'latest'])
        return int(token, 16), int(self.rpc(network, 'eth_getBalance', [source, 'pending']), 16)

    def estimate(self, network, source, recipient, amount, deadline):
        decimals = 6 if network == 'TRON' else ERC20[(network, 'USDT')][1]
        quantity = atomic(amount, decimals)
        tokens, native = self.balances(network, source)
        if tokens < quantity:
            raise PaymentError('NO_FUNDS')
        data = calldata(network, recipient, quantity)
        expiry = min(int(time.time()) + 90, int(deadline) - 60)
        if expiry <= time.time() + 15:
            raise PaymentError('QUOTE_EXPIRED')
        if network == 'TRON':
            simulation = self.tron('/wallet/triggerconstantcontract', {
                'owner_address': source, 'contract_address': TRON_USDT,
                'function_selector': 'transfer(address,uint256)', 'parameter': data[8:], 'visible': True})
            if not simulation.get('result', {}).get('result') or int(simulation.get('energy_used', 0)) <= 0:
                raise PaymentError('RPC_UNAVAILABLE')
            parameters = {p['key']: int(p.get('value', 0)) for p in self.tron('/wallet/getchainparameters', {}).get('chainParameter', [])}
            energy_price, byte_price = parameters.get('getEnergyFee', 0), parameters.get('getTransactionFee', 0)
            if energy_price <= 0 or byte_price <= 0:
                raise PaymentError('RPC_UNAVAILABLE')
            # Ignore staked resources: conservative ceiling, never promise a smaller fee.
            fee_limit = (int(simulation['energy_used']) * 3 // 2 + 1) * energy_price
            bandwidth = 1024 * byte_price
            max_fee = fee_limit + bandwidth
            if fee_limit > 200_000_000:
                raise PaymentError('RPC_UNAVAILABLE')
            block = self.tron('/walletsolidity/getnowblock', {})
            block_id = block['blockID']
            stamp = int(time.time() * 1000)
            unsigned = {'ref_block_bytes': block_id[12:16], 'ref_block_hash': block_id[16:32],
                        'expiration': min(stamp + 180000, int(deadline * 1000) - 30000),
                        'timestamp': stamp, 'fee_limit': fee_limit,
                        'contract': [{'type': 'TriggerSmartContract', 'parameter': {
                            'type_url': 'type.googleapis.com/protocol.TriggerSmartContract',
                            'value': {'owner_address': tronhex(source), 'contract_address': tronhex(TRON_USDT), 'data': data}}}]}
            fee_decimals, currency = 6, 'TRX'
        else:
            contract, _ = ERC20[(network, 'USDT')]
            gas_price = int(self.rpc(network, 'eth_gasPrice', []), 16) * 12 // 10 + 1
            gas = int(self.rpc(network, 'eth_estimateGas', [{'from': source, 'to': contract, 'value': '0x0', 'data': '0x' + data}]), 16) * 13 // 10 + 1
            if gas > 250000 or gas_price > 500_000_000_000:
                raise PaymentError('RPC_UNAVAILABLE')
            max_fee = gas * gas_price
            unsigned = {'chainId': CHAIN_IDS[network], 'nonce': int(self.rpc(network, 'eth_getTransactionCount', [source, 'pending']), 16),
                        'to': to_checksum_address(contract),
                        'value': 0, 'data': '0x' + data, 'gas': gas, 'gasPrice': gas_price}
            fee_decimals, currency = 18, 'BNB' if network == 'BSC' else 'ETH'
        if native < max_fee:
            raise PaymentError('NO_GAS')
        return {'amount': amount, 'token_balance': units(tokens, decimals), 'native_balance': units(native, fee_decimals),
                'max_fee': units(max_fee, fee_decimals), 'fee_currency': currency, 'expires_at': expiry,
                'source_address': source, 'recipient': recipient, 'network': network, 'unsigned': unsigned}

    def estimate_bnb(self, source, recipient, amount):
        network = 'BSC'
        quantity = atomic(amount, 18)
        if int(self.rpc(network, 'eth_chainId', []), 16) != CHAIN_IDS[network]:
            raise PaymentError('RPC_UNAVAILABLE')
        recipient = to_checksum_address(recipient)
        native = int(self.rpc(network, 'eth_getBalance', [source, 'pending']), 16)
        if native < quantity:
            raise PaymentError('NO_FUNDS')
        gas_price = int(self.rpc(network, 'eth_gasPrice', []), 16) * 12 // 10 + 1
        gas = int(self.rpc(network, 'eth_estimateGas', [
            {'from': source, 'to': recipient, 'value': hex(quantity), 'data': '0x'},
        ]), 16) * 13 // 10 + 1
        if not 21000 <= gas <= 250000 or not 0 < gas_price <= 500_000_000_000:
            raise PaymentError('RPC_UNAVAILABLE')
        max_fee = gas * gas_price
        if native < quantity + max_fee:
            raise PaymentError('NO_GAS')
        unsigned = {
            'chainId': CHAIN_IDS[network], 'to': recipient, 'value': quantity, 'data': '0x',
            'nonce': int(self.rpc(network, 'eth_getTransactionCount', [source, 'pending']), 16),
            'gas': gas, 'gasPrice': gas_price,
        }
        return {
            'asset': 'BNB', 'amount': amount, 'native_balance': units(native, 18),
            'max_fee': units(max_fee, 18), 'fee_currency': 'BNB', 'expires_at': int(time.time()) + 90,
            'source_address': source, 'recipient': recipient, 'network': network, 'unsigned': unsigned,
        }

    def sign(self, quote, private_key):
        if quote['expires_at'] <= time.time():
            raise PaymentError('QUOTE_EXPIRED')
        network, unsigned = quote['network'], quote['unsigned']
        if network == 'TRON':
            txid = calculate_txid_from_raw_data(unsigned)
            payload = {'txID': txid, 'raw_data': unsigned,
                       'signature': [TronKey(private_key).sign_msg_hash(bytes.fromhex(txid)).hex()]}
        else:
            signed = Account.sign_transaction(unsigned, private_key)
            txid = '0x' + signed.hash.hex().removeprefix('0x')
            payload = {'raw': '0x' + signed.raw_transaction.hex().removeprefix('0x')}
        self.verify(quote, payload, txid)
        return payload, txid

    def verify(self, quote, payload, txid):
        network, expected = quote['network'], quote['unsigned']
        if network == 'TRON':
            if payload['raw_data'] != expected or calculate_txid_from_raw_data(expected) != txid or payload['txID'] != txid or len(payload['signature']) != 1:
                raise ValueError('Signed TRON payload mismatch')
            signer = Signature(bytes.fromhex(payload['signature'][0])).recover_public_key_from_msg_hash(bytes.fromhex(txid)).to_base58check_address()
        else:
            raw = bytes.fromhex(payload['raw'][2:])
            decoded = EvmTransaction.from_bytes(raw).as_dict()
            v = decoded.pop('v'); decoded.pop('r'); decoded.pop('s')
            actual = {**decoded, 'chainId': (v - 35) // 2, 'to': '0x' + decoded['to'].hex(), 'data': '0x' + decoded['data'].hex()}
            normalized = {**expected, 'to': expected['to'].lower()}
            if actual != normalized or '0x' + keccak(raw).hex() != txid:
                raise ValueError('Signed EVM payload mismatch')
            signer = Account.recover_transaction(raw)
        if signer.lower() != quote['source_address'].lower():
            raise ValueError('Signer ownership mismatch')

    def receipt(self, quote, txid):
        """Only finalized/successful token Transfer logs count as payment."""
        network = quote['network']
        if network == 'TRON':
            receipt = self.tron('/walletsolidity/gettransactioninfobyid', {'value': txid})
            if not receipt:
                return None
            if receipt.get('id') != txid:
                raise ValueError('Receipt mismatch')
            if receipt.get('receipt', {}).get('result') != 'SUCCESS':
                raise PaymentError('TX_FAILED')
            logs, contract = receipt.get('log', []), tronhex(TRON_USDT)[2:]
            source, target = tronhex(quote['source_address'])[2:], tronhex(quote['recipient'])[2:]
            decimals = 6
        else:
            receipt = self.rpc(network, 'eth_getTransactionReceipt', [txid])
            if not receipt:
                return None
            if receipt.get('transactionHash', '').lower() != txid.lower():
                raise ValueError('Receipt mismatch')
            # Release only after consensus finality, not an arbitrary head confirmation count.
            finalized = self.rpc(network, 'eth_getBlockByNumber', ['finalized', False])
            if not finalized or int(finalized['number'], 16) < int(receipt['blockNumber'], 16):
                return None
            canonical = self.rpc(network, 'eth_getBlockByNumber', [receipt['blockNumber'], False])
            if not canonical or canonical['hash'].lower() != receipt['blockHash'].lower():
                return None
            if int(receipt['status'], 16) != 1:
                raise PaymentError('TX_FAILED')
            if network == 'BSC' and quote.get('asset') == 'BNB':
                return True
            logs, contract = receipt['logs'], ERC20[(network, 'USDT')][0][2:]
            source, target = quote['source_address'][2:], quote['recipient'][2:]
            decimals = ERC20[(network, 'USDT')][1]
        quantity = atomic(quote['amount'], decimals)
        for log in logs:
            topics = [v.lower().removeprefix('0x') for v in log.get('topics', [])]
            if (log.get('address', '').lower().removeprefix('0x') == contract.lower() and
                    topics == [TRANSFER_TOPIC, source.lower().rjust(64, '0'), target.lower().rjust(64, '0')] and
                    int(log['data'], 16) == quantity):
                return True
        # status=SUCCESS alone is insufficient proof of a token transfer.
        raise ValueError('Expected transfer log missing')

    def broadcast(self, quote, payload, txid):
        self.verify(quote, payload, txid)
        if quote['network'] == 'TRON':
            if payload['raw_data']['expiration'] <= time.time() * 1000:
                raise PaymentError('OUTCOME_UNKNOWN')
            result = self.tron('/wallet/broadcasttransaction', payload)
            if result.get('result') is not True or result.get('txid') != txid:
                raise PaymentError('OUTCOME_UNKNOWN')
        else:
            result = self.rpc(quote['network'], 'eth_sendRawTransaction', [payload['raw']])
            if result.lower() != txid.lower():
                raise PaymentError('OUTCOME_UNKNOWN')
