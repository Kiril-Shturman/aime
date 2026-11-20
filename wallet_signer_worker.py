"""Operator-side signer controller. No HTTP listener and no recovery secret on web host."""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import uuid
from decimal import Decimal
from pathlib import Path

import requests
from bip_utils import Bip44, Bip44Coins, Bip84, Bip84Coins
from nacl.public import SealedBox

from wallet_custody import decode, fingerprint
from wallet_custody_tools import load_private, verify_wallet
from wallet_fixedfloat_orders import Orders, address
from wallet_signer_chains import Chains, PaymentError, atomic
from wallet_exchange_funding import CUSTODY_WITHDRAWAL_NETWORKS, CUSTODY_WITHDRAWAL_CAPABILITIES
from wallet_custody_withdrawal import CustodyWithdrawal


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


class Controller:
    def __init__(self, config, bridge=None, chains=None, fetch=None):
        self.config = config
        self.private = load_private(config['private_key_file'])
        self.key_id = fingerprint(bytes(self.private.public_key))
        self.seal_key = hmac.new(bytes(self.private), b'wpay.exchange.approval.v1', hashlib.sha256).digest()
        self.worker_id = config['worker_id']
        self.bridge_call = bridge or self.ssh
        self.chains = chains or Chains()
        self.fetch = fetch or self.fetch_order
        self.read_times = []

    def bridge(self, op, **body):
        return self.bridge_call({'op': op, 'worker_id': self.worker_id, **body})

    def ssh(self, body):
        # The root-only bridge accepts bounded JSON via stdin; never interpolate a job into shell code.
        command = ('wpay_release=$(systemctl show wpay -p WorkingDirectory --value); '
                   'exec "$wpay_release/.venv/bin/python" "$wpay_release/scripts/wpay_signer_bridge.py" '
                   '/opt/wpay/shared/wpay-aura-test.sqlite3')
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                 self.config['ssh_host'], command], input=canonical(body), capture_output=True, timeout=35)
        if result.returncode or len(result.stdout) > 262144:
            raise RuntimeError('Signer bridge unavailable')
        data = json.loads(result.stdout)
        if data.get('ok') is False:
            raise RuntimeError('Signer bridge failed')
        return data

    def fetch_order(self, order):
        # Separate process has a strict 20/min read-only budget; the web process reserves 200/min.
        stamp = time.monotonic()
        self.read_times = [v for v in self.read_times if v > stamp - 60]
        if len(self.read_times) >= 20:
            raise PaymentError('RPC_UNAVAILABLE')
        self.read_times.append(stamp)
        raw = canonical({'id': order['provider_id'], 'token': order['access_token']})
        signature = hmac.new(self.config['fixedfloat_secret'].encode(), raw, hashlib.sha256).hexdigest()
        with requests.post('https://ff.io/api/v2/order', data=raw,
                           headers={'X-API-KEY': self.config['fixedfloat_key'], 'X-API-SIGN': signature,
                                    'Content-Type': 'application/json'},
                           timeout=(5, 15), allow_redirects=False, stream=True) as response:
            if response.status_code != 200:
                raise PaymentError('RPC_UNAVAILABLE')
            result = response.raw.read(1048577, decode_content=True)
            if len(result) > 1048576:
                raise PaymentError('RPC_UNAVAILABLE')
            data = json.loads(result)
        if data.get('code') != 0:
            raise PaymentError('RPC_UNAVAILABLE')
        return data['data']

    def payable(self, item):
        job, wallet, order = item['job'], item['wallet'], item['order']
        if (job['user_id'] != wallet['user_id'] or job['user_id'] != order['user_id'] or
                job['wallet_id'] != wallet['id'] or job['intent_id'] != order['id'] or
                wallet['chain_env'] != 'mainnet' or wallet['network'] != job['network'] or
                wallet['key_id'] != self.key_id):
            raise ValueError('Owner/network/key mismatch')
        params = json.loads(order['params'])
        if params['from_network'] != job['network']:
            raise ValueError('Wrong source network')
        snapshot = Orders.snapshot(None, self.fetch(order), params, order['provider_id'], creating=True)
        if snapshot['status'] != 'NEW' or snapshot['pay_tx_hash'] or snapshot['pay_tag'] or snapshot['expires_at'] < time.time() + 60:
            raise PaymentError('ORDER_NOT_PAYABLE')
        old = json.loads(order['snapshot'])
        if (address(job['network'], old['pay_address']) != address(job['network'], snapshot['pay_address']) or
                old['from_amount'] != snapshot['from_amount']):
            raise ValueError('Provider changed payment instructions')
        return snapshot

    def instructions(self, item):
        if 'withdrawal' not in item:
            return self.payable(item)
        job, wallet, withdrawal = item['job'], item['wallet'], item['withdrawal']
        if (
            job['id'] != withdrawal['job_id'] or job['wallet_id'] != wallet['id']
            or job['user_id'] != wallet['user_id']
            or CUSTODY_WITHDRAWAL_NETWORKS.get(withdrawal['asset']) != job['network']
            or wallet['network'] != job['network'] or wallet['chain_env'] != 'mainnet'
            or wallet['key_id'] != self.key_id
        ):
            raise ValueError('Invalid BNB withdrawal binding')
        return {
            'pay_address': CustodyWithdrawal.recipient(job['network'], withdrawal['recipient']),
            'from_amount': withdrawal['amount'],
        }

    def approval_binding(self, item):
        job, wallet = item['job'], item['wallet']
        binding = {'job_id': job['id'], 'intent_id': job['intent_id'], 'user_id': job['user_id'],
                   'wallet_id': wallet['id']}
        if 'withdrawal' in item:
            binding['kind'] = 'custody_withdrawal'
            binding['asset'] = item['withdrawal']['asset']
        else:
            binding['provider_id'] = item['order']['provider_id']
        return binding

    def estimate(self, item, instructions):
        job, wallet = item['job'], item['wallet']
        if 'withdrawal' in item:
            quote = self.chains.estimate_withdrawal(item['withdrawal']['asset'], job['network'], wallet['address'],
                                                    instructions['pay_address'], instructions['from_amount'],
                                                    public_key=wallet['public_key'])
            quote['recipient'] = instructions['pay_address']
            return quote
        return self.chains.estimate(job['network'], wallet['address'], instructions['pay_address'],
                                    instructions['from_amount'], instructions['expires_at'])

    def seal(self, value):
        return hmac.new(self.seal_key, canonical(value), hashlib.sha256).hexdigest()

    def check_quote(self, item, quote):
        clean = {k: v for k, v in quote.items() if k != 'seal'}
        if not hmac.compare_digest(self.seal(clean), quote['seal']):
            raise ValueError('Approval tampered')
        wallet = item['wallet']
        binding = self.approval_binding(item)
        legacy = 'withdrawal' in item and item['withdrawal']['asset'] == 'BNB' and quote['binding'].get('kind') == 'bnb_withdrawal'
        if legacy:
            binding = {**binding, 'kind': 'bnb_withdrawal'}
            del binding['asset']
        if quote['binding'] != binding or quote['network'] != wallet['network'] or quote['source_address'] != wallet['address']:
            raise ValueError('Approval belongs to another job')

    def key(self, wallet):
        wallet = {**wallet, 'encrypted_secret': base64.b64decode(wallet['encrypted_secret'], validate=True)}
        verify_wallet(wallet, self.private)
        document = json.loads(SealedBox(self.private).decrypt(wallet['encrypted_secret']))
        seed = decode(document['seed'])
        try:
            if wallet['network'] in {'SOL', 'TON'}:
                return seed
            if wallet['network'] == 'BTC':
                return Bip84.FromSeed(seed, Bip84Coins.BITCOIN).DeriveDefaultPath().PrivateKey().Raw().ToBytes()
            coin = {'TRON': Bip44Coins.TRON, 'ETH': Bip44Coins.ETHEREUM, 'BSC': Bip44Coins.BINANCE_SMART_CHAIN}[wallet['network']]
            return Bip44.FromSeed(seed, coin).DeriveDefaultPath().PrivateKey().Raw().ToBytes()
        finally:
            del seed, document

    def process(self, item):
        job, wallet = item['job'], item['wallet']
        identifier = job['id']
        persisted = job['signed_payload']
        try:
            if persisted:
                quote = json.loads(job['quote'])
                self.check_quote(item, quote)
                payload, txid = json.loads(persisted), job['tx_hash']
                self.chains.verify(quote, payload, txid)
                if self.chains.receipt(quote, txid):
                    self.bridge('status', job_id=identifier, state='done')
                    return
                # No re-signing, even after expiry/restart. EVM transactions have no chain expiry.
                fresh = self.instructions(item)
                if fresh['pay_address'] != quote['recipient'] or fresh['from_amount'] != quote['amount']:
                    raise ValueError('Payment instructions changed')
                self.chains.broadcast(quote, payload, txid)
                self.bridge('status', job_id=identifier, state='broadcast')
                return
            fresh = self.instructions(item)
            if job['state'] == 'estimating':
                quote = self.estimate(item, fresh)
                quote['approval_id'] = uuid.uuid4().hex
                quote['binding'] = self.approval_binding(item)
                quote['seal'] = self.seal(quote)
                self.bridge('quote', job_id=identifier, quote=quote)
                return
            if job['state'] not in {'signing', 'confirmed'}:
                raise ValueError('No user approval')
            quote = json.loads(job['quote'])
            self.check_quote(item, quote)
            if fresh['pay_address'] != quote['recipient'] or fresh['from_amount'] != quote['amount']:
                raise ValueError('Payment instructions changed')
            # Re-estimation validates live balances, nonce, fee and execution; never silently alter approval.
            current = self.estimate(item, fresh)
            if job['network'] in {'BSC','ETH'} and (current['unsigned']['nonce'] != quote['unsigned']['nonce']):
                raise PaymentError('QUOTE_EXPIRED')
            if Decimal(current['max_fee']) > Decimal(quote['max_fee']):
                raise PaymentError('QUOTE_EXPIRED')
            if 'withdrawal' in item and job['network'] in {'BSC','ETH'}:
                if current['unsigned']['gas'] > quote['unsigned']['gas']:
                    raise PaymentError('QUOTE_EXPIRED')
                approved_cost = quote['unsigned']['value'] + quote['unsigned']['gas'] * quote['unsigned']['gasPrice']
                if atomic(current['native_balance'], 18) < approved_cost:
                    raise PaymentError('NO_GAS')
            if job['network'] == 'TON' and current['unsigned']['seqno'] != quote['unsigned']['seqno']:
                raise PaymentError('QUOTE_EXPIRED')
            if job['network'] == 'BTC' and current['unsigned'] != quote['unsigned']:
                raise PaymentError('QUOTE_EXPIRED')
            private_key = self.key(wallet)
            try:
                payload, txid = self.chains.sign(quote, private_key)
            finally:
                del private_key
            # Persist-before-broadcast. If the bridge times out, do not broadcast until recovery.
            stored = self.bridge('signed', job_id=identifier, payload=payload, tx_hash=txid)
            self.chains.verify(quote, stored['payload'], stored['tx_hash'])
            self.chains.broadcast(quote, stored['payload'], stored['tx_hash'])
            self.bridge('status', job_id=identifier, state='broadcast')
        except Exception as error:
            code = error.code if isinstance(error, PaymentError) else 'SIGNER_ERROR'
            # Read the canonical DB state: signed acknowledgements may have been lost.
            self.bridge('status', job_id=identifier, state='failed', error=code)

    def process_export(self, item):
        from Cryptodome.PublicKey import RSA
        from Cryptodome.Cipher import PKCS1_OAEP
        from Cryptodome.Hash import SHA256
        job, wallet = item['job'], item['wallet']
        try:
            if (job['user_id'] != wallet['user_id'] or job['wallet_id'] != wallet['id'] or
                    wallet['network'] not in {'ETH','BSC'} or wallet['key_id'] != self.key_id or
                    job['expires_at'] <= time.time()):
                raise ValueError('Invalid export ownership')
            recipient = RSA.import_key(base64.b64decode(job['public_key'], validate=True))
            if recipient.has_private() or recipient.size_in_bits() != 3072 or recipient.e != 65537:
                raise ValueError('Invalid export recipient')
            key = self.key(wallet)
            try:
                document = {'job_id': job['id'], 'wallet_id': wallet['id'], 'network': wallet['network'],
                            'address': wallet['address'], 'private_key': key.hex()}
                encrypted = PKCS1_OAEP.new(recipient, hashAlgo=SHA256).encrypt(canonical(document))
            finally:
                del key
            del document
            self.bridge('export-complete', job_id=job['id'], ciphertext=base64.b64encode(encrypted).decode())
        except Exception:
            self.bridge('export-complete', job_id=job['id'], ciphertext=None)

    def cycle(self):
        self.bridge('heartbeat', networks=['BSC', 'ETH', 'TRON', 'SOL', 'BTC', 'TON', *CUSTODY_WITHDRAWAL_CAPABILITIES.values()], key_id=self.key_id)
        export = self.bridge('export-claim')
        if export.get('job'):
            self.process_export(export)
        item = self.bridge('claim', custody_withdrawals=True)
        if item.get('job'):
            self.process(item)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    path = Path(args.config)
    if path.stat().st_mode & 0o077:
        raise ValueError('Config permissions must be 600')
    controller = Controller(json.loads(path.read_text()))
    while True:
        try:
            controller.cycle()
        except Exception:
            # Do not log provider tokens, raw payloads, URLs, recovery data, or exception strings.
            print('Signer cycle unavailable', flush=True)
        time.sleep(5)


if __name__ == '__main__':
    os.umask(0o077)
    main()
